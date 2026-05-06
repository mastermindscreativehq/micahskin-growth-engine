'use strict'

/**
 * conversationRouter.js — Phase 34 (MCE)
 *
 * Smart conversation router. Layers ON TOP of MAIE's intelligence outputs
 * (leadHeatScore, leadSegment, painSignals, buyerSignals, outreachAngle)
 * and the existing 12-bucket conversation brain — and adds:
 *
 *   • funnelType         — product | consult | academy | reseller
 *   • conversationPath   — diagnosis_first | direct_buy | consult_first | academy_first | reseller_first
 *   • routingReason      — short human-readable explanation
 *   • emotionalPainScore — 0-100 derived from MAIE pain + emotion
 *   • budgetSignal       — strong | weak | none
 *   • academyScore       — 0-100, includes reseller weighting
 *
 * Deterministic. No LLM. Persists results to the Lead row and emits a
 * `route_assigned` event to LeadTimeline.
 *
 * Called from leadAcquisitionService.injectToLead() on lead injection,
 * and (idempotently) on every inbound reply that suggests a route change.
 */

const prisma = require('../../lib/prisma')
const resellerIntent = require('./resellerIntentService')
const leadTimeline   = require('./leadTimelineService')

// ── Budget language detector ──────────────────────────────────────────────────

const BUDGET_STRONG_RE = [
  /\b(my\s+budget\s+is|i\s+can\s+(spend|do|afford))\s+₦?\s*\d+/i,
  /\b₦\s*\d{2,}/,
  /\b\d{2,}k\s+(naira|budget)?\b/i,
  /\bany\s+(price|amount)\s+is\s+fine\b/i,
  /\bmoney\s+is\s+not\s+(an\s+)?issue\b/i,
  /\bhow\s+much\s+(is\s+it|do\s+i\s+pay|to\s+(start|order))\b/i,
  /\bsend\s+(me\s+)?(account|payment|details)\b/i,
]

const BUDGET_WEAK_RE = [
  /\bnot\s+(too\s+)?(much|expensive)\b/i,
  /\bsmall\s+budget\b/i,
  /\bany\s+cheap(er)?\s+option\b/i,
  /\bstart\s+(small|with\s+something\s+small)\b/i,
  /\baffordable\b/i,
]

function _detectBudgetSignal(text) {
  if (!text) return 'none'
  if (BUDGET_STRONG_RE.some(r => r.test(text))) return 'strong'
  if (BUDGET_WEAK_RE.some(r => r.test(text)))   return 'weak'
  return 'none'
}

// ── Emotional pain score (derived from MAIE) ─────────────────────────────────

function _emotionalPainScore({ painScore, emotionalIntensity, urgencyScore }) {
  const p = Number(painScore || 0)
  const e = Number(emotionalIntensity || 0)
  const u = Number(urgencyScore || 0)
  const raw = p * 1.4 + e * 1.6 + u * 0.8
  return Math.max(0, Math.min(100, Math.round(raw)))
}

// ── Buyer signal detector (consumer buy intent) ─────────────────────────────

const BUYER_RE = [
  /\b(buy|purchase|order|get\s+(it|them|this))\b/i,
  /\bhow\s+(much|do\s+i\s+pay)\b/i,
  /\bwhere\s+(can|to)\s+(i\s+)?(buy|order|get)\b/i,
  /\bsend\s+(me\s+)?(account|details|price|link)\b/i,
  /\bi\s+want\s+(to\s+)?(buy|order)\b/i,
  /\bready\s+to\s+(buy|order|pay)\b/i,
]

function _hasBuyerSignal(text) {
  return BUYER_RE.some(r => r.test(text))
}

// ── Consult signal detector ──────────────────────────────────────────────────

const CONSULT_RE = [
  /\b(consult(ation)?|book\s+(a\s+)?(call|appointment|session))\b/i,
  /\bspeak\s+(to|with)\s+(you|someone|a\s+person)\b/i,
  /\b(one[-\s]?on[-\s]?one|1[-\s]?on[-\s]?1)\b/i,
  /\bi\s+(need|want)\s+(personal|direct|expert)\s+help\b/i,
]

function _hasConsultSignal(text) {
  return CONSULT_RE.some(r => r.test(text))
}

// ── Academy signal detector (course / education buyer) ─────────────────────

const ACADEMY_RE = [
  /\b(academy|masterclass|course|training|enroll|enrolment|register)\b/i,
  /\b(skincare|beauty)\s+(class|course|education)\b/i,
  /\blearn\s+(skincare|how\s+to\s+(start|build|launch))\b/i,
]

function _hasAcademySignal(text) {
  return ACADEMY_RE.some(r => r.test(text))
}

// ── Core decision ────────────────────────────────────────────────────────────

/**
 * Decide funnelType + conversationPath from current MAIE-flavoured signals.
 *
 * Priority:
 *   1. Reseller intent ≥ 30  → reseller / reseller_first
 *   2. Academy signal + low MAIE academyFitScore < 40 + no reseller → academy / academy_first
 *      (academy without reseller intent = student-buyer, still academy funnel)
 *   3. Consult signal OR clinical urgency ≥ high → consult / consult_first
 *   4. Strong buyer + budget + no academy/consult signals → product / direct_buy
 *   5. Default → product / diagnosis_first
 */
function _decideRoute({
  text,
  resellerScore,
  budgetSignal,
  hasBuyer,
  hasConsult,
  hasAcademy,
  urgencyLevel,
  maieAcademyFit,
  maieSegment,
}) {
  // 1. Reseller wins outright
  if (resellerScore >= 30) {
    return {
      funnelType:       'reseller',
      conversationPath: 'reseller_first',
      reason:           `Reseller intent score ${resellerScore} — routing to reseller funnel`,
    }
  }

  // 2. Direct academy/student-buyer signal (without reseller)
  if (hasAcademy) {
    return {
      funnelType:       'academy',
      conversationPath: 'academy_first',
      reason:           hasBuyer
        ? 'Academy + buyer language — academy funnel, ready-to-enrol'
        : 'Academy interest signal detected',
    }
  }

  // 3. Consult / clinical urgency
  if (hasConsult || urgencyLevel === 'high') {
    return {
      funnelType:       'consult',
      conversationPath: 'consult_first',
      reason:           hasConsult
        ? 'Direct consult ask in inbound text'
        : `High urgency (${urgencyLevel}) — needs consult before product`,
    }
  }

  // 4. Strong buyer with budget — skip diagnosis funnel entry
  if (hasBuyer && budgetSignal === 'strong') {
    return {
      funnelType:       'product',
      conversationPath: 'direct_buy',
      reason:           'Strong buyer signal + stated budget — direct product funnel',
    }
  }

  // 4b. MAIE academy segment but no clear reseller — academy funnel, education-led
  if (maieSegment && /^(academy|reseller|entrepreneur|skincare_business)$/.test(maieSegment)) {
    return {
      funnelType:       'academy',
      conversationPath: 'academy_first',
      reason:           `MAIE segment=${maieSegment} — academy funnel`,
    }
  }

  // 5. Default — product funnel via diagnosis
  return {
    funnelType:       'product',
    conversationPath: 'diagnosis_first',
    reason:           'Default — diagnosis-first product funnel',
  }
}

// ── Academy score (split from monetization academyIntentScore) ──────────────

function _calculateAcademyScore({ maieAcademyFit, hasAcademy, resellerScore, urgencyLevel }) {
  // Floor on the existing MAIE fit score, then layer reseller + signal weight.
  let score = Math.max(0, Math.min(100, Number(maieAcademyFit || 0)))
  if (hasAcademy)        score += 20
  if (resellerScore >= 30) score += 25
  if (resellerScore >= 60) score += 15
  if (urgencyLevel === 'high') score -= 15  // urgency = consult, not academy
  return Math.max(0, Math.min(100, Math.round(score)))
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Assign a route to a lead and persist to DB. Idempotent — safe to re-run
 * on every inbound message.
 *
 * @param {object} lead    Full Lead record from Prisma. Must include `id` and
 *                         the MAIE-derived fields (academyFitScore, urgencyLevel,
 *                         primaryConcern, message). If running on inbound text,
 *                         pass the text via `inboundText` so the router can
 *                         reclassify on richer signals.
 * @param {object} [opts]
 * @param {string} [opts.inboundText] Inbound message to layer on lead.message
 * @param {object} [opts.maie]        MAIE per-lead snapshot:
 *                                    { painScore, emotionalIntensity, urgencyScore,
 *                                      leadSegment, detectedCity }
 *
 * @returns {Promise<object>}  The route + scores written to the lead.
 */
async function assign(lead, opts = {}) {
  if (!lead || !lead.id) return null

  const text = [
    opts.inboundText || '',
    lead.message || '',
    lead.suggestedReply || '',
  ].join(' ').trim()

  const reseller = resellerIntent.detect(text)
  const budgetSignal = _detectBudgetSignal(text)
  const hasBuyer = _hasBuyerSignal(text)
  const hasConsult = _hasConsultSignal(text)
  const hasAcademy = _hasAcademySignal(text)

  const route = _decideRoute({
    text,
    resellerScore:  reseller.score,
    budgetSignal,
    hasBuyer,
    hasConsult,
    hasAcademy,
    urgencyLevel:   lead.urgencyLevel || 'low',
    maieAcademyFit: lead.academyFitScore || 0,
    maieSegment:    opts.maie?.leadSegment || null,
  })

  const emotionalPainScore = _emotionalPainScore({
    painScore:          opts.maie?.painScore          || 0,
    emotionalIntensity: opts.maie?.emotionalIntensity || 0,
    urgencyScore:       opts.maie?.urgencyScore       || 0,
  })

  const academyScore = _calculateAcademyScore({
    maieAcademyFit: lead.academyFitScore || 0,
    hasAcademy,
    resellerScore: reseller.score,
    urgencyLevel:  lead.urgencyLevel || 'low',
  })

  // Persist
  try {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        funnelType:         route.funnelType,
        conversationPath:   route.conversationPath,
        routingReason:      route.reason,
        resellerIntent:     reseller.reseller,
        budgetSignal,
        emotionalPainScore,
        academyScore,
      },
    })
  } catch (err) {
    console.error(`[MCE/Router] persist failed leadId=${lead.id}:`, err.message)
  }

  console.log(
    `[MCE/Router] assigned leadId=${lead.id}` +
    ` funnelType=${route.funnelType}` +
    ` path=${route.conversationPath}` +
    ` reseller=${reseller.reseller}/${reseller.score}` +
    ` budget=${budgetSignal}` +
    ` empain=${emotionalPainScore}` +
    ` academy=${academyScore}` +
    ` reason="${route.reason}"`,
  )

  // Append timeline event (best-effort)
  await leadTimeline.record({
    leadId:     lead.id,
    eventType:  'route_assigned',
    channel:    'system',
    funnelType: route.funnelType,
    payload: {
      conversationPath:   route.conversationPath,
      reason:             route.reason,
      resellerScore:      reseller.score,
      resellerSignals:    reseller.signals,
      budgetSignal,
      emotionalPainScore,
      academyScore,
      maieSegment:        opts.maie?.leadSegment || null,
    },
  })

  return {
    funnelType:        route.funnelType,
    conversationPath:  route.conversationPath,
    routingReason:     route.reason,
    resellerIntent:    reseller.reseller,
    resellerScore:     reseller.score,
    budgetSignal,
    emotionalPainScore,
    academyScore,
  }
}

module.exports = {
  assign,
  // exposed for tests / admin endpoints
  _detectBudgetSignal,
  _emotionalPainScore,
  _decideRoute,
}
