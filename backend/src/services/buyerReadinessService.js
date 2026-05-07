'use strict'

/**
 * buyerReadinessService.js
 * Phase 35 — MICAHSKIN Pain Signal Classifier
 *
 * Detects whether the writer is ready to BUY — distinct from whether they're
 * in pain. A frustrated lurker is not the same as someone asking "how much".
 *
 * Pure function — no I/O, no AI.
 *
 *   evaluate(text, opts?)  →  {
 *     buyerReadinessScore  : 0..100
 *     buyingStage          : 'unaware' | 'problem_aware' | 'solution_aware'
 *                           | 'product_aware' | 'most_aware'
 *     matchedBuyerSignals  : Array<{ tag, phrase, weight }>
 *     buyerPhrases         : string[]
 *     buyerTags            : string[]
 *     hasPriceQuestion     : boolean   // narrows offer type
 *     hasLocationQuestion  : boolean   // narrows shipping/availability
 *     hasRecommendAsk      : boolean   // narrows "what should I use" branches
 *     recommendedAction    : 'consult_offer' | 'product_offer' | 'academy_offer'
 *                           | 'reseller_offer' | 'nurture_only' | 'reject'
 *   }
 *
 * `opts.painClassification` is the result of painSignalClassifierService.classify(),
 * `opts.segmentation` is the result of leadSegmentationService.classify(). Both
 * are optional — when present they refine the recommended-action branch. When
 * absent the function still returns a sensible default.
 */

const {
  BUYER_SIGNALS,
  LOCALITY_SIGNALS,
  PROBLEM_SIGNALS,
} = require('../config/painSignals')

const RECOMMEND_TAGS = new Set([
  'recommend_something',
  'what_recommend',
  'best_for',
  'what_works_for',
  'has_anyone_tried',
  'anyone_suggest',
  'which_is_better',
  'does_anyone_know',
  'what_cream_works',
  'what_should_i_use',
  'what_did_you_use',
])

const PRICE_TAGS = new Set([
  'how_much',
  'whats_the_price',
  'price_question',
])

const LOCATION_TAGS = new Set([
  'where_can_i_buy',
  'how_do_i_order',
  'do_you_ship_ng',
  'available_in_ng',
  'where_in_lagos',
  'available_question',
])

const HARD_BUYER_TAGS = new Set([
  ...PRICE_TAGS, ...LOCATION_TAGS,
  'link_please', 'send_me_link', 'dm_me_details', 'send_details',
  'i_need_this', 'i_want_this', 'taking_my_money',
])

function _runLexicon(text, lex, cap = 100) {
  const hits = []
  let total = 0
  for (const entry of lex) {
    if (entry.pattern.test(text)) {
      total += entry.weight
      hits.push({ tag: entry.tag, phrase: entry.phrase, weight: entry.weight })
    }
  }
  return { score: Math.max(0, Math.min(cap, total)), hits }
}

function _round(n) { return Math.round(n * 100) / 100 }

// ── Buying stage — refined view that uses BOTH pain awareness AND buyer signal
function _buyingStage({ buyerHits, hasHardBuyer, hasRecommend, painAware }) {
  if (hasHardBuyer)                       return 'most_aware'
  if (hasRecommend)                       return 'product_aware'
  if (buyerHits.length > 0)               return 'solution_aware'
  if (painAware)                          return 'problem_aware'
  return 'unaware'
}

// ── Recommended action — what to actually do with this lead ─────────────────
//
// Cascades from strongest commercial signal down. Segmentation-aware: if MAIE
// already classified them as reseller/academy, we honour that.
function _recommendedAction({
  buyerScore,
  painScore,
  hasHardBuyer,
  hasRecommend,
  hasPrice,
  hasLocation,
  segmentation,
  isLikelySpam,
}) {
  if (isLikelySpam) return 'reject'

  const seg = segmentation?.segment
  const segConfidence = Number(segmentation?.segmentConfidence) || 0
  const ACADEMY_LIKE = ['academy', 'reseller', 'entrepreneur', 'skincare_business']

  if (seg === 'reseller'      && segConfidence >= 50) return 'reseller_offer'
  if (ACADEMY_LIKE.includes(seg) && segConfidence >= 60) return 'academy_offer'

  // Hard buyer signals — price, link, "where can I buy", "I need this"
  if (hasHardBuyer || hasPrice || hasLocation) return 'product_offer'

  // High readiness even without hard buyer wording — still product-route
  if (buyerScore >= 50) return 'product_offer'

  if (seg === 'consultation' && segConfidence >= 50) return 'consult_offer'

  // Recommendation-seekers without price/location → product nurture
  if (hasRecommend && (painScore >= 30 || buyerScore >= 25)) return 'product_offer'

  // Painful but no commercial signal — nurture them via academy/diagnosis flow
  if (painScore >= 35) return 'nurture_only'

  // Mid-weak commercial signal (single buyer hit) → nurture
  if (buyerScore > 0) return 'nurture_only'

  // Nothing actionable
  return 'nurture_only'
}

function evaluate(input, opts = {}) {
  const corpus = Array.isArray(input)
    ? input.filter(Boolean).map(String).join('\n')
    : (input ? String(input) : '')

  if (!corpus.trim()) {
    return {
      buyerReadinessScore: 0,
      buyingStage:         'unaware',
      matchedBuyerSignals: [],
      buyerPhrases:        [],
      buyerTags:            [],
      hasPriceQuestion:    false,
      hasLocationQuestion: false,
      hasRecommendAsk:     false,
      recommendedAction:   'nurture_only',
    }
  }

  const buyer    = _runLexicon(corpus, BUYER_SIGNALS)
  const locality = _runLexicon(corpus, LOCALITY_SIGNALS)
  const problem  = _runLexicon(corpus, PROBLEM_SIGNALS)

  // Locality on its own isn't a buyer signal; it amplifies one when present.
  // ("Lagos" alone = nothing. "How much, Lagos" = +confidence on the buy intent.)
  const localityBoost = (buyer.score > 0 && locality.score > 0)
    ? Math.min(15, locality.score * 0.25)
    : 0

  const buyerReadinessScore = _round(
    Math.max(0, Math.min(100, buyer.score + localityBoost))
  )

  const buyerTags    = buyer.hits.map(h => h.tag)
  const buyerPhrases = buyer.hits.map(h => h.phrase)

  const hasPrice    = buyerTags.some(t => PRICE_TAGS.has(t))
  const hasLocation = buyerTags.some(t => LOCATION_TAGS.has(t))
  const hasRecommend = buyerTags.some(t => RECOMMEND_TAGS.has(t))
  const hasHardBuyer = buyerTags.some(t => HARD_BUYER_TAGS.has(t))

  const painAware = problem.hits.length > 0 || (opts.painClassification?.painSignalScore ?? 0) >= 25

  const buyingStage = _buyingStage({
    buyerHits: buyer.hits,
    hasHardBuyer,
    hasRecommend,
    painAware,
  })

  const recommendedAction = _recommendedAction({
    buyerScore:   buyerReadinessScore,
    painScore:    Number(opts.painClassification?.painSignalScore) || 0,
    hasHardBuyer,
    hasRecommend,
    hasPrice,
    hasLocation,
    segmentation:  opts.segmentation,
    isLikelySpam:  Boolean(opts.painClassification?.isLikelySpam),
  })

  return {
    buyerReadinessScore,
    buyingStage,
    matchedBuyerSignals: buyer.hits,
    buyerPhrases,
    buyerTags,
    hasPriceQuestion:    hasPrice,
    hasLocationQuestion: hasLocation,
    hasRecommendAsk:     hasRecommend,
    recommendedAction,
  }
}

module.exports = { evaluate }
