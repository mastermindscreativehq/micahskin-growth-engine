'use strict'

/**
 * leadQualityGateService.js
 * Phase 35 — MICAHSKIN Pain Signal Classifier
 *
 * Final 0..100 score that combines pain, buyer-readiness, emotional pain, and
 * Nigeria confidence into a single quality grade. Decides whether the lead is
 * hot / warm / cold / reject and the recommended next action.
 *
 *   evaluate({
 *     painClassification,   // result of painSignalClassifierService.classify()
 *     buyerReadiness,       // result of buyerReadinessService.evaluate()
 *     nigeriaSignal,        // result of nigeriaSignalService.detect()
 *     segmentation,         // result of leadSegmentationService.classify()
 *   }) → {
 *     finalScore        : 0..100
 *     leadQuality       : 'hot' | 'warm' | 'cold' | 'reject'
 *     leadQualityReason : string   // why this grade was chosen
 *     recommendedAction : string   // mirrored from buyerReadiness, with overrides
 *     scoreBreakdown    : { pain, buyer, emotion, nigeria, raw }
 *   }
 *
 * Pure function — no I/O.
 */

const { SCORING_WEIGHTS, QUALITY_THRESHOLDS } = require('../config/painSignals')

const W_PAIN     = SCORING_WEIGHTS.pain
const W_BUYER    = SCORING_WEIGHTS.buyer
const W_EMOTION  = SCORING_WEIGHTS.emotion
const W_NIGERIA  = SCORING_WEIGHTS.nigeria

const HOT_THRESHOLD    = QUALITY_THRESHOLDS.hot   // 70
const WARM_THRESHOLD   = QUALITY_THRESHOLDS.warm  // 45
const COLD_THRESHOLD   = QUALITY_THRESHOLDS.cold  // 25

function _round(n) { return Math.round(n * 100) / 100 }
function _num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function evaluate({
  painClassification,
  buyerReadiness,
  nigeriaSignal,
  segmentation,
} = {}) {
  const pain    = _num(painClassification?.painSignalScore)
  const buyer   = _num(buyerReadiness?.buyerReadinessScore)
  const emotion = _num(painClassification?.emotionalPainLevel)
  const nigeria = _num(nigeriaSignal?.nigeriaConfidence)

  const isLikelySpam = Boolean(painClassification?.isLikelySpam)
  const lowQualityScore = _num(painClassification?.lowQualityScore)

  // ── Hard reject — spam / fake promo / emoji-only / brand promo ──────────
  if (isLikelySpam || lowQualityScore >= 50) {
    return {
      finalScore:        0,
      leadQuality:       'reject',
      leadQualityReason: `low_quality_signal score=${lowQualityScore}`,
      recommendedAction: 'reject',
      scoreBreakdown: { pain, buyer, emotion, nigeria, raw: 0 },
    }
  }

  // Weighted composite — 0..100
  const raw =
    pain    * W_PAIN +
    buyer   * W_BUYER +
    emotion * W_EMOTION +
    nigeria * W_NIGERIA

  const finalScore = _round(Math.max(0, Math.min(100, raw)))

  // Classify quality
  let leadQuality
  let reason
  if (finalScore >= HOT_THRESHOLD) {
    leadQuality = 'hot'
    reason = `score=${finalScore} >= ${HOT_THRESHOLD}`
  } else if (finalScore >= WARM_THRESHOLD) {
    leadQuality = 'warm'
    reason = `score=${finalScore} in ${WARM_THRESHOLD}-${HOT_THRESHOLD - 1}`
  } else if (finalScore >= COLD_THRESHOLD) {
    leadQuality = 'cold'
    reason = `score=${finalScore} in ${COLD_THRESHOLD}-${WARM_THRESHOLD - 1}`
  } else {
    leadQuality = 'reject'
    reason = `score=${finalScore} < ${COLD_THRESHOLD}`
  }

  // Recommended action — start from buyerReadiness's recommendation, then
  // override based on the final quality grade.
  let recommendedAction = buyerReadiness?.recommendedAction || 'nurture_only'

  if (leadQuality === 'reject') {
    recommendedAction = 'reject'
  } else if (leadQuality === 'cold') {
    // Cold leads are stored-only — never proactively pitched. Allow academy/
    // reseller branches to still surface so MAIE-driven academy funnel keeps
    // working, but downgrade product offers to nurture.
    if (recommendedAction === 'product_offer' || recommendedAction === 'consult_offer') {
      recommendedAction = 'nurture_only'
    }
  }

  // Segmentation override — if MAIE strongly classified them as reseller and
  // the final score is at least warm, prefer reseller funnel.
  if (
    leadQuality !== 'reject' &&
    segmentation?.segment === 'reseller' &&
    _num(segmentation?.segmentConfidence) >= 60
  ) {
    recommendedAction = 'reseller_offer'
  }

  return {
    finalScore,
    leadQuality,
    leadQualityReason: reason,
    recommendedAction,
    scoreBreakdown: {
      pain:    _round(pain    * W_PAIN),
      buyer:   _round(buyer   * W_BUYER),
      emotion: _round(emotion * W_EMOTION),
      nigeria: _round(nigeria * W_NIGERIA),
      raw:     _round(raw),
    },
  }
}

module.exports = {
  evaluate,
  HOT_THRESHOLD,
  WARM_THRESHOLD,
  COLD_THRESHOLD,
}
