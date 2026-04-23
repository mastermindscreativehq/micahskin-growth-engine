'use strict'

/**
 * actionEngineService.js — Phase 17: Action Engine
 *
 * Converts diagnosis results + follow-up schedules into deterministic,
 * automated message execution. Handles 4 action types:
 *
 *   1. diagnosis      — T+1h  — personalised diagnosis + routine
 *   2. check_in       — T+24h — gentle check-in on routine progress
 *   3. product_reco   — T+3d  — targeted product recommendation
 *   4. academy_offer  — T+5d+ — academy pitch when fit score is strong
 *
 * Safety guarantees:
 *   - Atomic boolean-claim prevents duplicate sends across concurrent runs
 *   - Rich status field (diagnosisStatus etc.) records outcome per action
 *   - Closed leads skipped silently
 *   - No telegram chatId → blocked with reason "no_delivery_channel"
 *   - urgencyLevel=high or nextBestAction=manual_consult → product_reco +
 *     academy_offer are blocked, actionBlockedReason written to lead record
 *   - Send failure reverts the claim so next tick retries
 *
 * Replaces followUpService.js as the sole scheduled execution layer.
 * Does NOT replace the admin-alert schedulerService or autoTriggerService.
 */

const prisma = require('../lib/prisma')
const { sendTelegramToUser } = require('./telegramService')
const { processQueuedConversionOffers } = require('./conversionEngineService')
const { shouldSendAutomation } = require('./conversationBrainService')

const LEAD_BOT_TOKEN = process.env.TELEGRAM_LEAD_BOT_TOKEN

// Configurable via env var — keep in sync with diagnosisEngineService threshold
const ACADEMY_FIT_THRESHOLD = parseInt(process.env.ACADEMY_FIT_THRESHOLD || '65', 10)

// Concerns that always route to a consult (clinical / chronic conditions)
const CONSULT_CONCERN_LIST = ['eczema', 'severe_acne', 'chronic']

// Conversion link constants — override via env vars in production
const ACADEMY_LINK  = process.env.ACADEMY_LINK  || 'https://micahskin-growth-engine.vercel.app/academy'
const WHATSAPP_LINK = process.env.WHATSAPP_LINK || 'https://wa.me/+2348140468759'

// ── Conversion decision logic ─────────────────────────────────────────────────

/**
 * Returns true when this lead should receive a direct consultation offer
 * (WhatsApp redirect). Consult takes absolute priority over course.
 *
 * @param {object} lead
 * @returns {boolean}
 */
function shouldSendConsultOffer(lead) {
  return (
    lead.urgencyLevel === 'high' ||
    lead.nextBestAction === 'manual_consult' ||
    (lead.confidenceScore != null && lead.confidenceScore < 70) ||
    CONSULT_CONCERN_LIST.includes(lead.primaryConcern)
  )
}

/**
 * Returns true when this lead should receive a course / scalable offer.
 * Automatically blocked when shouldSendConsultOffer is true.
 *
 * @param {object} lead
 * @returns {boolean}
 */
function shouldSendCourseOffer(lead) {
  return (
    lead.academyFitScore != null &&
    lead.academyFitScore >= ACADEMY_FIT_THRESHOLD &&
    lead.nextBestAction !== 'manual_consult' &&
    lead.urgencyLevel !== 'high'
  )
}

// ── Message builders ──────────────────────────────────────────────────────────

/**
 * T+1h — Personalised diagnosis message.
 * Reads from lead.diagnosis / lead.routine / lead.products (clinical JSON fields).
 * Does NOT use diagnosisSummary — that field is operator-only CRM display text.
 *
 * @param {object} lead
 * @returns {string|null}
 */
function buildDiagnosisMessage(lead) {
  const firstName = lead.fullName ? lead.fullName.split(' ')[0] : 'there'

  const diag    = lead.diagnosis || {}
  const routine = lead.routine   || {}
  const prods   = lead.products  || {}

  const assessmentText = diag.text || null
  const notes    = Array.isArray(diag.notes)              ? diag.notes              : []
  const morning  = Array.isArray(routine.morning)         ? routine.morning         : []
  const night    = Array.isArray(routine.night)           ? routine.night           : []
  const products = Array.isArray(prods.recommendations)   ? prods.recommendations   : []

  if (!assessmentText && morning.length === 0 && night.length === 0) return null

  const lines = []

  lines.push(`Hi ${firstName},`)
  lines.push('')
  lines.push('We reviewed everything you shared about your skin, and here is the routine we put together for you.')

  if (assessmentText) {
    lines.push('')
    lines.push('<b>Assessment:</b>')
    lines.push(assessmentText)
  }

  if (morning.length > 0) {
    lines.push('')
    lines.push('<b>Morning routine:</b>')
    morning.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
  }

  if (night.length > 0) {
    lines.push('')
    lines.push('<b>Night routine:</b>')
    night.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
  }

  if (products.length > 0) {
    lines.push('')
    lines.push('<b>Recommended products:</b>')
    products.forEach(p => lines.push(`- ${p}`))
  }

  if (notes.length > 0) {
    lines.push('')
    lines.push('<b>Important notes:</b>')
    notes.forEach(n => lines.push(`- ${n}`))
  }

  lines.push('')
  lines.push('Stay consistent for 2–3 weeks and monitor how your skin responds. Reply anytime if you want us to adjust the routine for you.')

  return lines.join('\n')
}

/**
 * T+24h — Gentle check-in message after the routine has been shared.
 *
 * @param {object} lead
 * @returns {string}
 */
function buildCheckInMessage(lead) {
  const firstName  = lead.fullName.split(' ')[0]
  const routineName = lead.routineType
    ? `the ${lead.routineType.replace(/_/g, ' ')} routine`
    : 'the routine'

  return (
    `Hi ${firstName} 👋\n\n` +
    `Just checking in — have you been able to start ${routineName} we shared?\n\n` +
    `Any tightness, irritation, early improvements, or questions? ` +
    `Reply here and I'll help you adjust.`
  )
}

/**
 * T+3d — Targeted product recommendation.
 * Prefers enriched recommendedProductsText over raw products JSON.
 *
 * @param {object} lead
 * @returns {string|null}
 */
function buildProductRecommendationMessage(lead) {
  const firstName = lead.fullName.split(' ')[0]
  const concern   = lead.primaryConcern
    ? lead.primaryConcern.replace(/_/g, ' ')
    : 'your skin concern'

  // Enriched path
  if (lead.recommendedProductsText) {
    return (
      `Hi ${firstName} ✨\n\n` +
      `For faster results with ${concern}, here are the specific products our team recommends:\n\n` +
      `${lead.recommendedProductsText}\n\n` +
      `These are matched to your skin type and concern. ` +
      `Reply if you need help getting them or adding them to your routine.`
    )
  }

  // Clinical fallback
  const products = lead.products?.recommendations || []
  if (products.length === 0) return null

  const lines = products.map((p, i) => `${i + 1}. ${p}`).join('\n')
  return (
    `Hi ${firstName} ✨\n\n` +
    `For faster, more targeted results, here are our recommended products for your skin:\n\n` +
    `${lines}\n\n` +
    `These are matched to your exact skin type and concern. ` +
    `Reply if you'd like guidance on where to get them.`
  )
}

/**
 * Academy offer — only sent when fit score is strong.
 * Outcome-driven, practical framework positioning.
 *
 * @param {object} lead
 * @returns {string}
 */
function buildAcademyOfferMessage(lead) {
  const firstName = lead.fullName.split(' ')[0]
  const trackableLink = `${ACADEMY_LINK}?leadId=${lead.id}`

  return (
    `Hi ${firstName} 👋\n\n` +
    `Based on what you shared, I think you'd benefit from the MICAHSKIN Academy.\n\n` +
    `This is not just a skincare class.\n\n` +
    `It shows you how to:\n` +
    `• understand skin properly\n` +
    `• build routines that actually make sense\n` +
    `• choose products with confidence\n` +
    `• grow a skincare brand the smart way\n` +
    `• attract clients and build a real customer system\n\n` +
    `So instead of guessing, wasting money, or struggling alone, you get a practical framework you can actually use.\n\n` +
    `If you're serious about getting results for yourself or building something real in skincare, this is the next step.\n\n` +
    `Register here:\n` +
    `${trackableLink}\n\n` +
    `If you want, reply ACADEMY and I'll guide you further.`
  )
}

/**
 * Consult offer — personal guidance framing, drives to WhatsApp.
 * Fires for: urgencyLevel=high | nextBestAction=manual_consult |
 *            confidenceScore<70 | clinical concern (eczema/severe_acne/chronic)
 *
 * @param {object} lead
 * @returns {string}
 */
function buildConsultMessage(lead) {
  const firstName = lead.fullName.split(' ')[0]
  const trackableLink = `${WHATSAPP_LINK}?leadId=${lead.id}`

  return (
    `Hi ${firstName} 👋\n\n` +
    `I reviewed what you shared, and your case looks like something that needs more personal guidance.\n\n` +
    `Rather than guessing with random products, the best next step is a direct consultation so we can look at:\n` +
    `• your exact skin concern\n` +
    `• what may be making it worse\n` +
    `• what routine or products make sense for you\n` +
    `• the fastest safe next action\n\n` +
    `Message here to continue:\n` +
    `${trackableLink}`
  )
}

/**
 * Course offer — positions the course as a system, not just content.
 * Transformation-led copy, drives to course link.
 * Fires for: academyFitScore>=65, urgencyLevel≠high, nextBestAction≠manual_consult.
 *
 * @param {object} lead
 * @returns {string}
 */
function buildCourseMessage(lead) {
  const firstName = lead.fullName.split(' ')[0]
  const concern   = lead.primaryConcern
    ? lead.primaryConcern.replace(/_/g, ' ')
    : 'your skin concern'

  return (
    `Hi ${firstName} 🎯\n\n` +
    `Here's the truth about ${concern}: products alone don't fix it. ` +
    `You need to understand <b>why</b> it happens and build a system that stops it.\n\n` +
    `That's exactly what our skincare course teaches.\n\n` +
    `<b>What you'll learn:</b>\n` +
    `• Why your skin reacts the way it does\n` +
    `• Which ingredients actually work for ${concern} — and which make it worse\n` +
    `• How to build a routine that delivers visible results in weeks\n` +
    `• How to read product labels and stop wasting money on the wrong things\n\n` +
    `This isn't tips content. It's a complete system — built around your exact concern.\n\n` +
    `👉 Get full access here:\n` +
    `YOUR_COURSE_LINK\n\n` +
    `Reply <b>COURSE</b> if you'd like more details before you decide.`
  )
}

// ── Evaluation (pure — no DB writes) ─────────────────────────────────────────

/**
 * Inspects a single lead and returns what the next due action would be.
 * Used by CRM and for introspection. No side effects.
 *
 * @param {object} lead  Full Lead record from DB
 * @returns {{ action: string|null, blocked: boolean, reason: string|null }}
 */
function evaluateNextActionForLead(lead) {
  const now = new Date()

  if (!lead.telegramChatId) {
    return { action: null, blocked: true, reason: 'no_delivery_channel' }
  }

  if (lead.status === 'closed') {
    return { action: null, blocked: true, reason: 'lead_closed' }
  }

  const needsManualConsult =
    lead.urgencyLevel === 'high' || lead.nextBestAction === 'manual_consult'

  // A. Diagnosis
  if (
    lead.diagnosedAt &&
    lead.diagnosisSendAfter &&
    new Date(lead.diagnosisSendAfter) <= now &&
    !lead.diagnosisSent
  ) {
    return { action: 'diagnosis', blocked: false, reason: null }
  }

  // B. Check-in (requires diagnosis already sent)
  if (
    lead.diagnosisSent &&
    lead.checkInSendAfter &&
    new Date(lead.checkInSendAfter) <= now &&
    !lead.checkInSent
  ) {
    return { action: 'check_in', blocked: false, reason: null }
  }

  // C. Product recommendation (blocked for manual consult)
  if (
    lead.diagnosisSent &&
    lead.productRecoSendAfter &&
    new Date(lead.productRecoSendAfter) <= now &&
    !lead.productRecoSent
  ) {
    if (needsManualConsult) {
      return { action: null, blocked: true, reason: 'manual_consult_required' }
    }
    const hasProducts =
      lead.recommendedProductsText ||
      (Array.isArray(lead.products?.recommendations) && lead.products.recommendations.length > 0)
    const actionIsProduct =
      lead.nextBestAction === 'recommend_product' ||
      lead.nextBestAction === 'recommend_routine'
    if (hasProducts || actionIsProduct) {
      return { action: 'product_reco', blocked: false, reason: null }
    }
  }

  // D. Academy offer (blocked for manual consult)
  if (
    lead.academyFitScore != null &&
    lead.academyFitScore >= ACADEMY_FIT_THRESHOLD &&
    lead.academyOfferSendAfter &&
    new Date(lead.academyOfferSendAfter) <= now &&
    !lead.academyOfferSent
  ) {
    if (needsManualConsult) {
      return { action: null, blocked: true, reason: 'manual_consult_required' }
    }
    return { action: 'academy_offer', blocked: false, reason: null }
  }

  // E. Consult offer — fires T+2h after diagnosis, for qualifying leads
  if (
    lead.consultOfferSendAfter &&
    new Date(lead.consultOfferSendAfter) <= now &&
    !lead.consultOfferSent
  ) {
    if (!shouldSendConsultOffer(lead)) {
      return { action: null, blocked: true, reason: 'consult_criteria_not_met' }
    }
    return { action: 'consult_offer', blocked: false, reason: null }
  }

  // F. Course offer — fires T+2d after diagnosis, for qualifying leads.
  //    Blocked if consult offer would also qualify (consult has absolute priority).
  if (
    lead.courseOfferSendAfter &&
    new Date(lead.courseOfferSendAfter) <= now &&
    !lead.courseOfferSent
  ) {
    if (shouldSendConsultOffer(lead)) {
      return { action: null, blocked: true, reason: 'consult_offer_priority' }
    }
    if (!shouldSendCourseOffer(lead)) {
      return { action: null, blocked: true, reason: 'course_criteria_not_met' }
    }
    return { action: 'course_offer', blocked: false, reason: null }
  }

  return { action: null, blocked: false, reason: null }
}

// ── Audit log helper ──────────────────────────────────────────────────────────

async function _logAction(leadId, chatId, actionType, sendResult) {
  await prisma.messageLog.create({
    data: {
      type:             'lead',
      recordId:         leadId,
      channel:          'telegram',
      status:           sendResult.success ? 'sent' : 'skipped',
      auto:             true,
      triggerReason:    `action_engine_${actionType}`,
      recipient:        String(chatId),
      deliveryChannel:  'telegram',
      fallbackUsed:     false,
      providerResponse: sendResult.data ? JSON.stringify(sendResult.data) : null,
      error:            sendResult.error ? String(sendResult.error) : null,
    },
  }).catch(e => console.error('[ActionEngine] MessageLog write failed:', e.message))
}

// ── Send workers ──────────────────────────────────────────────────────────────

/**
 * A. Diagnosis sends — T+1h after intake_complete.
 */
async function _processDiagnosisSends() {
  const now = new Date()

  const leads = await prisma.lead.findMany({
    where: {
      diagnosedAt:        { not: null },
      diagnosisSendAfter: { lte: now },
      diagnosisSent:      false,
      telegramChatId:     { not: null },
    },
  })

  for (const lead of leads) {
    if (lead.status === 'closed') {
      console.log(`[ActionEngine] skipped diagnosis (lead closed) → ${lead.id}`)
      continue
    }

    // Atomic claim
    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, diagnosisSent: false },
      data:  { diagnosisSent: true },
    })
    if (claimed.count === 0) continue  // another process claimed it first

    console.log(`[ActionEngine] evaluating lead ${lead.id} (${lead.fullName}) for diagnosis`)

    try {
      const msg = buildDiagnosisMessage(lead)
      if (!msg) {
        console.warn(`[ActionEngine] skipped diagnosis (no data) → ${lead.id}`)
        await prisma.lead.update({
          where: { id: lead.id },
          data:  { diagnosisStatus: 'skipped', lastActionType: 'diagnosis', lastActionAt: now },
        })
        continue
      }

      console.log(
        `[ActionEngine] diagnosis payload | lead=${lead.id} | chars=${msg.length} | ` +
        `sections=assessment:${!!lead.diagnosis?.text},morning:${Array.isArray(lead.routine?.morning)&&lead.routine.morning.length>0},` +
        `night:${Array.isArray(lead.routine?.night)&&lead.routine.night.length>0},` +
        `products:${Array.isArray(lead.products?.recommendations)&&lead.products.recommendations.length>0},` +
        `notes:${Array.isArray(lead.diagnosis?.notes)&&lead.diagnosis.notes.length>0}`
      )
      console.log(`[ActionEngine] sending diagnosis → lead=${lead.id} chatId=${lead.telegramChatId}`)
      const result = await sendTelegramToUser(lead.telegramChatId, msg, LEAD_BOT_TOKEN)
      if (!result.success && !result.skipped) throw new Error(JSON.stringify(result.error) || 'telegram send failed')

      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          diagnosisSentAt:     now,
          diagnosisStatus:     'sent',
          lastActionType:      'diagnosis',
          lastActionAt:        now,
          actionBlockedReason: null,
          telegramStage:       'diagnosis_sent',
        },
      })
      await _logAction(lead.id, lead.telegramChatId, 'diagnosis', result)
      console.log(`[ActionEngine] diagnosis sent → ${lead.fullName} (${lead.id})`)

    } catch (err) {
      console.error(`[ActionEngine] diagnosis FAILED for ${lead.id}:`, err.message)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          diagnosisSent:   false,  // revert claim so next tick retries
          diagnosisStatus: 'failed',
          lastActionType:  'diagnosis',
          lastActionAt:    now,
        },
      }).catch(() => {})
    }
  }
}

/**
 * B. Check-in sends — T+24h. Only fires after diagnosis has been delivered.
 */
async function _processCheckIns() {
  const now = new Date()

  const leads = await prisma.lead.findMany({
    where: {
      diagnosisSent:    true,
      checkInSendAfter: { lte: now },
      checkInSent:      false,
      telegramChatId:   { not: null },
    },
  })

  for (const lead of leads) {
    if (lead.status === 'closed') {
      console.log(`[ActionEngine] skipped check-in (lead closed) → ${lead.id}`)
      continue
    }

    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, checkInSent: false },
      data:  { checkInSent: true },
    })
    if (claimed.count === 0) continue

    // ── Reply Governor ────────────────────────────────────────────────────────
    const { allowed: ciAllowed, reason: ciReason } = shouldSendAutomation(lead, 'check_in')
    if (!ciAllowed) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          checkInStatus:       'suppressed',
          actionBlockedReason: ciReason,
          lastActionType:      'check_in_suppressed',
          lastActionAt:        now,
        },
      })
      console.log(`[ActionEngine] check-in suppressed (${ciReason}) → ${lead.id}`)
      continue
    }

    console.log(`[ActionEngine] evaluating lead ${lead.id} (${lead.fullName}) for check-in`)

    try {
      const msg    = buildCheckInMessage(lead)
      const result = await sendTelegramToUser(lead.telegramChatId, msg, LEAD_BOT_TOKEN)
      if (!result.success && !result.skipped) throw new Error(JSON.stringify(result.error) || 'telegram send failed')

      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          checkInSentAt:       now,
          checkInStatus:       'sent',
          lastActionType:      'check_in',
          lastActionAt:        now,
          telegramStage:       'awaiting_checkin_reply',
          // Brain state
          conversationMode:    'checkin_active',
          lastBotIntent:       'auto_check_in',
          lastMeaningfulBotAt: now,
        },
      })
      await _logAction(lead.id, lead.telegramChatId, 'check_in', result)
      console.log(`[ActionEngine] check-in sent → ${lead.fullName} (${lead.id})`)

    } catch (err) {
      console.error(`[ActionEngine] check-in FAILED for ${lead.id}:`, err.message)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          checkInSent:   false,
          checkInStatus: 'failed',
          lastActionType: 'check_in',
          lastActionAt:   now,
        },
      }).catch(() => {})
    }
  }
}

/**
 * C. Product recommendation sends — T+3d.
 * Blocked when urgencyLevel=high or nextBestAction=manual_consult.
 */
async function _processProductRecos() {
  const now = new Date()

  const leads = await prisma.lead.findMany({
    where: {
      diagnosisSent:        true,
      productRecoSendAfter: { lte: now },
      productRecoSent:      false,
      telegramChatId:       { not: null },
    },
  })

  for (const lead of leads) {
    if (lead.status === 'closed') {
      console.log(`[ActionEngine] skipped product reco (lead closed) → ${lead.id}`)
      continue
    }

    // Atomic claim (claim first, then decide block vs send)
    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, productRecoSent: false },
      data:  { productRecoSent: true },
    })
    if (claimed.count === 0) continue

    // ── Reply Governor ────────────────────────────────────────────────────────
    const { allowed: prAllowed, reason: prReason } = shouldSendAutomation(lead, 'product_reco')
    if (!prAllowed) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          productRecoStatus:   'suppressed',
          actionBlockedReason: prReason,
          lastActionType:      'product_reco_suppressed',
          lastActionAt:        now,
        },
      })
      console.log(`[ActionEngine] product reco suppressed (${prReason}) → ${lead.id}`)
      continue
    }

    // Manual consult branch — write block record and stop here
    const needsManualConsult =
      lead.urgencyLevel === 'high' || lead.nextBestAction === 'manual_consult'

    if (needsManualConsult) {
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          productRecoStatus:   'blocked',
          actionBlockedReason: 'manual_consult_required',
          lastActionType:      'product_reco_blocked',
          lastActionAt:        now,
        },
      })
      console.log(`[ActionEngine] blocked product reco (manual consult required) → ${lead.id}`)
      continue
    }

    console.log(`[ActionEngine] evaluating lead ${lead.id} (${lead.fullName}) for product reco`)

    try {
      const msg = buildProductRecommendationMessage(lead)
      if (!msg) {
        console.warn(`[ActionEngine] skipped product reco (no product data) → ${lead.id}`)
        await prisma.lead.update({
          where: { id: lead.id },
          data:  { productRecoStatus: 'skipped', lastActionType: 'product_reco', lastActionAt: now },
        })
        continue
      }

      const result = await sendTelegramToUser(lead.telegramChatId, msg, LEAD_BOT_TOKEN)
      if (!result.success && !result.skipped) throw new Error(JSON.stringify(result.error) || 'telegram send failed')

      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          productRecoSentAt:   now,
          productRecoStatus:   'sent',
          lastActionType:      'product_reco',
          lastActionAt:        now,
          telegramStage:       'awaiting_product_reply',
          // Brain state
          conversationMode:    'product_reco_active',
          lastBotIntent:       'auto_product_reco',
          lastMeaningfulBotAt: now,
          productOfferCount:   { increment: 1 },
        },
      })
      await _logAction(lead.id, lead.telegramChatId, 'product_reco', result)
      console.log(`[ActionEngine] product reco sent → ${lead.fullName} (${lead.id})`)

    } catch (err) {
      console.error(`[ActionEngine] product reco FAILED for ${lead.id}:`, err.message)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          productRecoSent:   false,
          productRecoStatus: 'failed',
          lastActionType:    'product_reco',
          lastActionAt:      now,
        },
      }).catch(() => {})
    }
  }
}

/**
 * D. Academy offer sends — fires when academyFitScore >= threshold
 *    and academyOfferSendAfter has elapsed.
 * Blocked when urgencyLevel=high or nextBestAction=manual_consult.
 */
async function _processAcademyOffers() {
  const now = new Date()

  const leads = await prisma.lead.findMany({
    where: {
      academyFitScore:      { gte: ACADEMY_FIT_THRESHOLD },
      academyOfferSendAfter: { lte: now },
      academyOfferSent:     false,
      telegramChatId:       { not: null },
      conversionType:       { not: 'academy_paid' }, // skip leads who already purchased
    },
  })

  for (const lead of leads) {
    if (lead.status === 'closed') {
      console.log(`[ActionEngine] skipped academy offer (lead closed) → ${lead.id}`)
      continue
    }

    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, academyOfferSent: false },
      data:  { academyOfferSent: true },
    })
    if (claimed.count === 0) continue

    // ── Reply Governor ────────────────────────────────────────────────────────
    const { allowed: aoAllowed, reason: aoReason } = shouldSendAutomation(lead, 'academy_offer')
    if (!aoAllowed) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          academyOfferStatus:  'suppressed',
          actionBlockedReason: aoReason,
          lastActionType:      'academy_offer_suppressed',
          lastActionAt:        now,
        },
      })
      console.log(`[ActionEngine] academy offer suppressed (${aoReason}) → ${lead.id}`)
      continue
    }

    const needsManualConsult =
      lead.urgencyLevel === 'high' || lead.nextBestAction === 'manual_consult'

    if (needsManualConsult) {
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          academyOfferStatus:  'blocked',
          actionBlockedReason: 'manual_consult_required',
          lastActionType:      'academy_offer_blocked',
          lastActionAt:        now,
        },
      })
      console.log(`[ActionEngine] blocked academy offer (manual consult required) → ${lead.id}`)
      continue
    }

    console.log(`[ActionEngine] evaluating lead ${lead.id} (${lead.fullName}) for academy offer`)

    try {
      const msg    = buildAcademyOfferMessage(lead)
      const result = await sendTelegramToUser(lead.telegramChatId, msg, LEAD_BOT_TOKEN)
      if (!result.success && !result.skipped) throw new Error(JSON.stringify(result.error) || 'telegram send failed')

      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          academyOfferSentAt:  now,
          academyOfferStatus:  'sent',
          lastActionType:      'academy_offer',
          lastActionAt:        now,
          // Brain state
          conversationMode:    'academy_pitch_active',
          lastBotIntent:       'auto_academy_offer',
          lastMeaningfulBotAt: now,
          academyPitchCount:   { increment: 1 },
        },
      })
      await _logAction(lead.id, lead.telegramChatId, 'academy_offer', result)
      console.log(`[ActionEngine] academy offer sent → ${lead.fullName} (${lead.id})`)

    } catch (err) {
      console.error(`[ActionEngine] academy offer FAILED for ${lead.id}:`, err.message)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          academyOfferSent:   false,
          academyOfferStatus: 'failed',
          lastActionType:     'academy_offer',
          lastActionAt:       now,
        },
      }).catch(() => {})
    }
  }
}

/**
 * E. Consult offer sends — T+2h after diagnosis.
 *
 * Fires when shouldSendConsultOffer() is true:
 *   urgencyLevel=high | nextBestAction=manual_consult |
 *   confidenceScore<70 | eczema/severe_acne/chronic
 *
 * If criteria not met → marks skipped (idempotent, no retry).
 */
async function _processConsultOffers() {
  const now = new Date()

  const leads = await prisma.lead.findMany({
    where: {
      consultOfferSendAfter: { lte: now },
      consultOfferSent:      false,
      telegramChatId:        { not: null },
      conversionType:        { not: 'academy_paid' }, // skip leads who already purchased
    },
  })

  for (const lead of leads) {
    if (lead.status === 'closed') {
      console.log(`[ActionEngine] skipped (lead closed) → ${lead.id}`)
      continue
    }

    // Atomic claim — prevents duplicate sends across concurrent ticks
    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, consultOfferSent: false },
      data:  { consultOfferSent: true },
    })
    if (claimed.count === 0) continue  // another process claimed it first

    if (!shouldSendConsultOffer(lead)) {
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          consultOfferStatus: 'skipped',
          lastActionType:     'consult_offer',
          lastActionAt:       now,
        },
      })
      console.log(`[ActionEngine] skipped (consult criteria not met) → ${lead.id}`)
      continue
    }

    console.log(`[ActionEngine] evaluating lead ${lead.id} (${lead.fullName}) for consult offer`)

    try {
      const msg    = buildConsultMessage(lead)
      const result = await sendTelegramToUser(lead.telegramChatId, msg, LEAD_BOT_TOKEN)
      if (!result.success && !result.skipped) throw new Error(JSON.stringify(result.error) || 'telegram send failed')

      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          consultOfferSentAt:  now,
          consultOfferStatus:  'sent',
          lastActionType:      'consult_offer',
          lastActionAt:        now,
          actionBlockedReason: null,
        },
      })
      await _logAction(lead.id, lead.telegramChatId, 'consult_offer', result)
      console.log(`[ActionEngine] consult offer sent → ${lead.id}`)

    } catch (err) {
      console.error(`[ActionEngine] consult offer FAILED for ${lead.id}:`, err.message)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          consultOfferSent:   false,   // revert claim so next tick retries
          consultOfferStatus: 'failed',
          lastActionType:     'consult_offer',
          lastActionAt:       now,
        },
      }).catch(() => {})
    }
  }
}

/**
 * F. Course offer sends — T+2d after diagnosis.
 *
 * Fires when shouldSendCourseOffer() is true AND shouldSendConsultOffer() is false.
 * Consult offer has absolute priority — if both conditions are met, course is blocked.
 */
async function _processCourseOffers() {
  const now = new Date()

  const leads = await prisma.lead.findMany({
    where: {
      courseOfferSendAfter: { lte: now },
      courseOfferSent:      false,
      telegramChatId:       { not: null },
      conversionType:       { not: 'academy_paid' }, // skip leads who already purchased
    },
  })

  for (const lead of leads) {
    if (lead.status === 'closed') {
      console.log(`[ActionEngine] skipped (lead closed) → ${lead.id}`)
      continue
    }

    // Atomic claim
    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, courseOfferSent: false },
      data:  { courseOfferSent: true },
    })
    if (claimed.count === 0) continue

    // Rule: if consult criteria are met, consult has absolute priority
    if (shouldSendConsultOffer(lead)) {
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          courseOfferStatus:   'blocked',
          actionBlockedReason: 'consult_offer_priority',
          lastActionType:      'course_offer_blocked',
          lastActionAt:        now,
        },
      })
      console.log(`[ActionEngine] skipped (consult offer has priority) → ${lead.id}`)
      continue
    }

    if (!shouldSendCourseOffer(lead)) {
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          courseOfferStatus: 'skipped',
          lastActionType:    'course_offer',
          lastActionAt:      now,
        },
      })
      console.log(`[ActionEngine] skipped (course criteria not met) → ${lead.id}`)
      continue
    }

    console.log(`[ActionEngine] evaluating lead ${lead.id} (${lead.fullName}) for course offer`)

    try {
      const msg    = buildCourseMessage(lead)
      const result = await sendTelegramToUser(lead.telegramChatId, msg, LEAD_BOT_TOKEN)
      if (!result.success && !result.skipped) throw new Error(JSON.stringify(result.error) || 'telegram send failed')

      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          courseOfferSentAt:   now,
          courseOfferStatus:   'sent',
          lastActionType:      'course_offer',
          lastActionAt:        now,
          actionBlockedReason: null,
        },
      })
      await _logAction(lead.id, lead.telegramChatId, 'course_offer', result)
      console.log(`[ActionEngine] course offer sent → ${lead.id}`)

    } catch (err) {
      console.error(`[ActionEngine] course offer FAILED for ${lead.id}:`, err.message)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          courseOfferSent:   false,    // revert claim so next tick retries
          courseOfferStatus: 'failed',
          lastActionType:    'course_offer',
          lastActionAt:      now,
        },
      }).catch(() => {})
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs one full action engine cycle:
 *   diagnosis → check-in → product reco → academy offer → consult offer → course offer
 * Called every 60s by the background poller.
 */
async function runPendingLeadActions() {
  try {
    await _processDiagnosisSends()
    await _processCheckIns()
    await _processProductRecos()
    await _processAcademyOffers()
    await _processConsultOffers()
    await _processCourseOffers()
    await processQueuedConversionOffers()
  } catch (err) {
    console.error('[ActionEngine] Unhandled error in runPendingLeadActions:', err.message)
  }
}

/**
 * Starts the Action Engine background poller.
 * Runs on boot + every 60 seconds.
 * Replaces startFollowUpService as the scheduled execution layer.
 */
function startActionEngine() {
  console.log(`✅ Action Engine started (automated lead actions every 60s | academy threshold: ${ACADEMY_FIT_THRESHOLD})`)
  runPendingLeadActions()
  setInterval(runPendingLeadActions, 60 * 1000)
}

module.exports = {
  startActionEngine,
  runPendingLeadActions,
  evaluateNextActionForLead,
  shouldSendConsultOffer,
  shouldSendCourseOffer,
  buildDiagnosisMessage,
  buildCheckInMessage,
  buildProductRecommendationMessage,
  buildAcademyOfferMessage,
  buildConsultMessage,
  buildCourseMessage,
}
