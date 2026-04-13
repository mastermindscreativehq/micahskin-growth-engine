/**
 * leadScoringService.js
 * Deterministic point-based scoring for social media items.
 *
 * Scoring table:
 *   +30  explicit skin problem mentioned (acne, dark spots, etc.)
 *   +25  explicit help/advice request ("what can I use", "help me", etc.)
 *   +30  academy / business-builder intent detected
 *   +10  post is recent (≤ 7 days old)
 *   +10  strong engagement (≥ 50 likes + comments combined)
 *   −30  soft noise signal (1 noise keyword)
 *   −50  hard noise signal (2+ noise keywords, or sponsored/ad flag)
 *
 * Thresholds → temperature:
 *   ≥ 70  hot
 *   45–69 warm
 *   20–44 cold
 *   < 20  reject
 *
 * Items classified as intentType='noise' are capped at 15 (always reject).
 */

// Phrases that earn the "explicit problem" bonus
const EXPLICIT_PROBLEM_PHRASES = [
  'acne', 'pimple', 'breakout', 'cystic', 'blackhead', 'whitehead',
  'hyperpigmentation', 'dark spot', 'dark patch', 'melasma',
  'stretch mark', 'eczema', 'psoriasis',
  'oily skin', 'dry skin', 'flaky skin', 'dehydrated skin',
  'sensitive skin', 'skin rash', 'itchy skin',
  'uneven tone', 'uneven skin tone', 'skin discoloration',
]

// Phrases that earn the "help request" bonus
const HELP_REQUEST_PHRASES = [
  'what can i use', 'what should i use', 'what do i use',
  'please help', 'help me', 'need routine', 'need a routine',
  'recommend product', 'recommend a product', 'product recommendation',
]

// Soft noise phrases (one hit = −30)
const NOISE_PHRASES = [
  'giveaway', 'discount code', 'use code', 'promo code',
  'gifted by', 'link in bio', '#ad', 'collab', 'ambassador',
  'influencer', 'paid partnership', 'follow for follow', 'f4f',
]

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Score a normalised item given its intent classification.
 *
 * @param {import('./apifyService').NormalisedItem} item
 * @param {import('./intentClassifierService').ClassificationResult} classification
 * @returns {ScoringResult}
 */
function scoreItem(item, classification) {
  const lower = (item.text || '').toLowerCase()
  let total = 0
  const breakdown = []

  // ── Positive signals ────────────────────────────────────────────────────────

  // Explicit skin problem (+30 max, +15 per unique keyword hit)
  const problemHits = EXPLICIT_PROBLEM_PHRASES.filter(p => lower.includes(p))
  if (problemHits.length > 0) {
    const gain = Math.min(problemHits.length * 15, 30)
    total += gain
    breakdown.push(`+${gain} explicit problem (${problemHits.slice(0, 3).join(', ')})`)
  }

  // Help request (+25, once)
  const helpHits = HELP_REQUEST_PHRASES.filter(p => lower.includes(p))
  if (helpHits.length > 0) {
    total += 25
    breakdown.push(`+25 help request (${helpHits.slice(0, 2).join(', ')})`)
  }

  // Academy intent (+30)
  if (classification.intentType === 'academy') {
    total += 30
    breakdown.push(`+30 academy intent (${classification.academyIntent || 'detected'})`)
  }

  // Recency (+10 if posted within last 7 days)
  if (item.postedAt) {
    const ageMs = Date.now() - new Date(item.postedAt).getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)
    if (ageDays <= 7) {
      total += 10
      breakdown.push(`+10 recent post (${Math.round(ageDays * 10) / 10}d old)`)
    }
  }

  // Strong engagement (+10 if ≥ 50 total interactions)
  const engagement = (item.likesCount || 0) + (item.commentsCount || 0)
  if (engagement >= 50) {
    total += 10
    breakdown.push(`+10 strong engagement (${engagement} interactions)`)
  }

  // ── Negative signals ────────────────────────────────────────────────────────

  const noiseHits = NOISE_PHRASES.filter(p => lower.includes(p))
  if (noiseHits.length >= 2) {
    total -= 50
    breakdown.push(`−50 hard noise (${noiseHits.slice(0, 3).join(', ')})`)
  } else if (noiseHits.length === 1) {
    total -= 30
    breakdown.push(`−30 soft noise (${noiseHits[0]})`)
  }

  // Cap noise-classified items so they always fall into reject territory
  if (classification.intentType === 'noise') {
    if (total > 15) {
      breakdown.push(`capped 15 (intentType=noise, was ${total})`)
      total = 15
    }
  }

  const temperature = assignTemperature(total)
  const decision = temperature === 'hot' || temperature === 'warm' ? 'ingest' : 'reject'

  return { score: total, temperature, decision, breakdown }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function assignTemperature(score) {
  if (score >= 70) return 'hot'
  if (score >= 45) return 'warm'
  if (score >= 20) return 'cold'
  return 'reject'
}

// ── Types (JSDoc) ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} ScoringResult
 * @property {number} score
 * @property {'hot'|'warm'|'cold'|'reject'} temperature
 * @property {'ingest'|'reject'} decision
 * @property {string[]} breakdown  Human-readable point-by-point explanation
 */

module.exports = { scoreItem }
