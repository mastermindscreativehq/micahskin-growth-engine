'use strict'

/**
 * leadHeatEngine.js
 * Phase 33 — MAIE
 *
 * Combines deterministic signals into a single 0..100 leadHeatScore and,
 * when a hard threshold fails, produces a structured rejectionReason.
 *
 *   evaluate({
 *     nigeria,        // result of nigeriaSignalService.detect()
 *     psychology,     // result of leadPsychologyService.analyze()
 *     engagement,     // { likes, comments } — optional, from raw scrape
 *     duplicate,      // boolean — set true by caller if dedup hit
 *     rejectNonNigerian, // boolean — when true, low-NG leads auto-fail
 *   }) → {
 *     leadHeatScore     : 0..100
 *     rejectionReason   : string|null   // duplicate|spam|low_intent|fake_profile|non_nigerian|low_heat
 *     rejectionDetail   : string|null
 *     heatBreakdown     : { component: weight }   // human-readable composition
 *   }
 *
 * Pure function — no I/O.
 */

// ── Phase 36 — relaxed thresholds for human-assisted conversion ─────────────
//   hot  ≥ 60   (was 70) — outreach queue, priority high
//   warm ≥ 35   (was 50) — injected, priority low
//   cold ≥ 15            — stored only, surfaced in queue, no Lead row
const HOT_THRESHOLD       = 60
const WARM_THRESHOLD      = 35
const COLD_THRESHOLD      = 15
const INJECT_THRESHOLD    = WARM_THRESHOLD
const MIN_AUTHENTICITY    = 25      // <25  → fake_profile reject (was 35)
const MIN_PAIN_OR_BUYER   = 5       // Phase 36 — buyer-only intent qualifies (was 10/18)
const MIN_NIGERIA_HARD    = 18      // strict mode reject threshold

// Weighted composition — must sum to 1.0 across positive weights.
//
//   nigeriaConfidence   30 %   — proves we're talking to the right market
//   painScore           20 %   — emotional gravity drives reply rate
//   buyerIntentScore    25 %   — proves they're shopping, not lurking
//   urgencyScore        12 %   — collapses the consideration window
//   emotionalIntensity   8 %   — amplifier on top of pain
//   authenticityScore   ×0.01  — multiplier (low authenticity drags everything)
//   engagementBoost      0..5  — light bias toward content with traction
const W_NIGERIA   = 0.30
const W_PAIN      = 0.20
const W_BUYER     = 0.25
const W_URGENCY   = 0.12
const W_EMOTION   = 0.08
// remaining 5% is the engagement boost ceiling

function _engagementBoost(eng) {
  if (!eng) return 0
  const likes    = Number(eng.likes)    || 0
  const comments = Number(eng.comments) || 0
  // Sub-linear boost: 1k likes ≈ +2.5, 10k+ likes saturates around +5.
  const likeBoost    = Math.min(Math.log10(likes + 1)    * 1.4, 4)
  const commentBoost = Math.min(Math.log10(comments + 1) * 0.6, 1)
  return Math.round((likeBoost + commentBoost) * 100) / 100
}

function _composite(nigeria, psych, engagementBoost) {
  const ng     = Number(nigeria?.nigeriaConfidence)  || 0
  const pain   = Number(psych?.painScore)            || 0
  const buy    = Number(psych?.buyerIntentScore)     || 0
  const urg    = Number(psych?.urgencyScore)         || 0
  const emo    = Number(psych?.emotionalIntensity)   || 0
  const auth   = Number(psych?.authenticityScore)    ?? 100

  const weighted =
    ng    * W_NIGERIA +
    pain  * W_PAIN    +
    buy   * W_BUYER   +
    urg   * W_URGENCY +
    emo   * W_EMOTION +
    engagementBoost

  // authenticity acts as a multiplier — 100 = no penalty, 0 = full collapse
  const authMultiplier = 0.4 + 0.6 * (auth / 100)
  const final = weighted * authMultiplier

  return {
    score: Math.max(0, Math.min(100, Math.round(final * 100) / 100)),
    breakdown: {
      nigeria_x_w:      Math.round(ng    * W_NIGERIA  * 100) / 100,
      pain_x_w:         Math.round(pain  * W_PAIN     * 100) / 100,
      buyer_x_w:        Math.round(buy   * W_BUYER    * 100) / 100,
      urgency_x_w:      Math.round(urg   * W_URGENCY  * 100) / 100,
      emotion_x_w:      Math.round(emo   * W_EMOTION  * 100) / 100,
      engagement_boost: engagementBoost,
      authenticity_mul: Math.round(authMultiplier * 1000) / 1000,
    },
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

function evaluate({
  nigeria,
  psychology,
  segmentation,
  engagement,
  duplicate = false,
  rejectNonNigerian = false,
} = {}) {
  // Hard rejections — these short-circuit before scoring.
  if (duplicate) {
    return {
      leadHeatScore: 0,
      rejectionReason: 'duplicate',
      rejectionDetail: 'externalId already exists',
      heatBreakdown: {},
    }
  }

  const psych = psychology   || {}
  const ng    = nigeria      || {}
  const seg   = segmentation || {}

  if ((psych.authenticityScore ?? 100) < MIN_AUTHENTICITY) {
    return {
      leadHeatScore: 0,
      rejectionReason: 'fake_profile',
      rejectionDetail: `authenticity=${psych.authenticityScore ?? 0}`,
      heatBreakdown: {},
    }
  }

  // Business / academy / consultation intent equivalence —
  // a strong reseller/academy/skincare_business/consultation match is itself a
  // valid buyer signal, even when pain & product-buyer lexicons don't fire.
  const ACADEMY_LIKE = ['academy', 'reseller', 'entrepreneur', 'skincare_business']
  const isBusinessIntent =
    ACADEMY_LIKE.includes(seg.segment) && (seg.segmentConfidence ?? 0) >= 60
  const isConsultIntent =
    seg.segment === 'consultation' && (seg.segmentConfidence ?? 0) >= 60

  if (
    !isBusinessIntent && !isConsultIntent &&
    (psych.painScore ?? 0) < MIN_PAIN_OR_BUYER &&
    (psych.buyerIntentScore ?? 0) < MIN_PAIN_OR_BUYER
  ) {
    return {
      leadHeatScore: 0,
      rejectionReason: 'low_intent',
      rejectionDetail: `pain=${psych.painScore ?? 0} buy=${psych.buyerIntentScore ?? 0}`,
      heatBreakdown: {},
    }
  }

  if (rejectNonNigerian && (ng.nigeriaConfidence ?? 0) < MIN_NIGERIA_HARD) {
    return {
      leadHeatScore: 0,
      rejectionReason: 'non_nigerian',
      rejectionDetail: `ngConfidence=${ng.nigeriaConfidence ?? 0}`,
      heatBreakdown: {},
    }
  }

  // Score
  const engagementBoost = _engagementBoost(engagement)
  const { score: rawScore, breakdown } = _composite(ng, psych, engagementBoost)

  // Phase 36 — buyer-only floor.
  // User directive: "Buying intent alone can qualify." The weighted composite
  // drowns buyer-only signals when NG/pain are zero (e.g. global English
  // commenters asking product questions). Lift the score so a clear buyer
  // signal always reaches at least cold.
  let score = rawScore
  const buyerOnlyFloor = Math.round((Number(psych?.buyerIntentScore) || 0) * 0.6)
  if (buyerOnlyFloor > score) {
    breakdown.buyer_only_floor = buyerOnlyFloor
    score = buyerOnlyFloor
  }

  // Business / consult intent bonus — ensures academy/reseller/consult leads
  // with NG signal but no pain/buyer lexicon hits still cross the inject
  // threshold.
  if (isBusinessIntent || isConsultIntent) {
    const intentBonus = Math.min(35, 15 + (ng.nigeriaConfidence ?? 0) * 0.25)
    score = Math.max(0, Math.min(100, score + intentBonus))
    breakdown[isBusinessIntent ? 'business_intent_bonus' : 'consult_intent_bonus'] =
      Math.round(intentBonus * 100) / 100
  }

  // Soft non-Nigerian: low NG confidence + no buyer/pain signal → reject as
  // non_nigerian. Phase 36 — buyer-intent leads survive this gate even if
  // they're non-Nigerian (operator can decide whether to engage globally).
  const hasBuyerOrPainSignal =
    (psych.buyerIntentScore ?? 0) >= MIN_PAIN_OR_BUYER ||
    (psych.painScore        ?? 0) >= MIN_PAIN_OR_BUYER
  if ((ng.nigeriaConfidence ?? 0) < 12 && score < 45 && !hasBuyerOrPainSignal) {
    return {
      leadHeatScore: score,
      rejectionReason: 'non_nigerian',
      rejectionDetail: `ngConfidence=${ng.nigeriaConfidence ?? 0} heat=${score}`,
      heatBreakdown: breakdown,
    }
  }

  // Heat too low to inject
  if (score < INJECT_THRESHOLD) {
    return {
      leadHeatScore: score,
      rejectionReason: 'low_heat',
      rejectionDetail: `heat=${score} threshold=${INJECT_THRESHOLD}`,
      heatBreakdown: breakdown,
    }
  }

  return {
    leadHeatScore: score,
    rejectionReason: null,
    rejectionDetail: null,
    heatBreakdown: breakdown,
  }
}

function isHot(score)  { return Number(score) >= HOT_THRESHOLD  }
function isWarm(score) { return Number(score) >= WARM_THRESHOLD && Number(score) < HOT_THRESHOLD }
function isCold(score) { return Number(score) >= COLD_THRESHOLD && Number(score) < WARM_THRESHOLD }

function temperatureLabel(score) {
  const n = Number(score) || 0
  if (n >= HOT_THRESHOLD)  return 'hot'
  if (n >= WARM_THRESHOLD) return 'warm'
  if (n >= COLD_THRESHOLD) return 'cold'
  return 'reject'
}

module.exports = {
  evaluate,
  isHot,
  isWarm,
  isCold,
  temperatureLabel,
  HOT_THRESHOLD,
  WARM_THRESHOLD,
  COLD_THRESHOLD,
  INJECT_THRESHOLD,
}
