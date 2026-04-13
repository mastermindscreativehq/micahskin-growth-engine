/**
 * intentClassifierService.js
 * Deterministic rule-based intent classification for social media posts/captions.
 *
 * No LLMs, no external API calls.
 * Classification order: NOISE → ACADEMY → CONSUMER → UNCLASSIFIED
 */

// ── Signal Dictionaries ───────────────────────────────────────────────────────

/**
 * Noise signals that indicate spam, ads, promos, or irrelevant content.
 * A single match from this list marks the item as noise immediately.
 */
const NOISE_SIGNALS = [
  'giveaway',
  'discount code',
  'use code',
  'promo code',
  'paid partnership',
  'gifted by',
  'link in bio',
  '#ad',
  ' ad ',       // space-bounded to avoid "glad", "add"
  'collab',
  'ambassador',
  'influencer',
  'celebrity',
  'gossip',
  'meme',
  'funny',
  'lol ',
  '#meme',
  '#funny',
  'repost this',
  'follow for follow',
  'f4f',
  '#spam',
  'onlyfans',
]

/**
 * Academy / business-builder signals.
 * Phrase-level matching (all lower-cased).
 */
const ACADEMY_SIGNALS = [
  { phrase: 'start skincare brand',     intent: 'start_brand' },
  { phrase: 'start a skincare brand',   intent: 'start_brand' },
  { phrase: 'launch my skincare',       intent: 'start_brand' },
  { phrase: 'launch a skincare',        intent: 'start_brand' },
  { phrase: 'my skincare line',         intent: 'start_brand' },
  { phrase: 'skincare line',            intent: 'start_brand' },
  { phrase: 'skincare brand',           intent: 'start_brand' },
  { phrase: 'skincare business',        intent: 'skincare_business' },
  { phrase: 'beauty business',          intent: 'beauty_business' },
  { phrase: 'cosmetic business',        intent: 'cosmetic_business' },
  { phrase: 'body butter business',     intent: 'body_butter_business' },
  { phrase: 'formulate product',        intent: 'formulation' },
  { phrase: 'formulating product',      intent: 'formulation' },
  { phrase: 'private label',            intent: 'private_label' },
  { phrase: 'white label',              intent: 'private_label' },
  { phrase: 'skincare class',           intent: 'skincare_training' },
  { phrase: 'skincare training',        intent: 'skincare_training' },
  { phrase: 'skincare course',          intent: 'skincare_training' },
  { phrase: 'esthetician student',      intent: 'esthetician' },
  { phrase: 'aesthetician student',     intent: 'esthetician' },
  { phrase: 'branding product',         intent: 'branding' },
  { phrase: 'product branding',         intent: 'branding' },
  { phrase: 'sell skincare',            intent: 'skincare_business' },
  { phrase: 'selling skincare',         intent: 'skincare_business' },
  { phrase: 'skincare entrepreneur',    intent: 'skincare_business' },
]

/**
 * Consumer skincare concern signals.
 * Each entry maps a keyword/phrase → concern bucket.
 * Earlier entries take priority when multiple match.
 */
const CONSUMER_SIGNALS = [
  // Acne / breakouts
  { phrase: 'acne',             concern: 'acne' },
  { phrase: 'pimple',           concern: 'acne' },
  { phrase: 'breakout',         concern: 'acne' },
  { phrase: 'cystic',           concern: 'acne' },
  { phrase: 'blackhead',        concern: 'acne' },
  { phrase: 'whitehead',        concern: 'acne' },
  // Hyperpigmentation
  { phrase: 'hyperpigmentation', concern: 'hyperpigmentation' },
  { phrase: 'dark spot',        concern: 'hyperpigmentation' },
  { phrase: 'dark patch',       concern: 'hyperpigmentation' },
  { phrase: 'melasma',          concern: 'hyperpigmentation' },
  { phrase: 'uneven tone',      concern: 'hyperpigmentation' },
  { phrase: 'uneven skin tone', concern: 'hyperpigmentation' },
  { phrase: 'skin discoloration', concern: 'hyperpigmentation' },
  // Stretch marks
  { phrase: 'stretch mark',     concern: 'stretch_marks' },
  { phrase: 'stretchmark',      concern: 'stretch_marks' },
  // Eczema / sensitivity
  { phrase: 'eczema',           concern: 'sensitive_skin' },
  { phrase: 'psoriasis',        concern: 'sensitive_skin' },
  { phrase: 'sensitive skin',   concern: 'sensitive_skin' },
  { phrase: 'skin rash',        concern: 'sensitive_skin' },
  { phrase: 'itchy skin',       concern: 'sensitive_skin' },
  // Oily / dry
  { phrase: 'oily skin',        concern: 'oily_skin' },
  { phrase: 'dry skin',         concern: 'dry_skin' },
  { phrase: 'flaky skin',       concern: 'dry_skin' },
  { phrase: 'dehydrated skin',  concern: 'dry_skin' },
  // General help requests — map to 'general'
  { phrase: 'what can i use',   concern: 'general' },
  { phrase: 'what should i use', concern: 'general' },
  { phrase: 'what do i use',    concern: 'general' },
  { phrase: 'please help',      concern: 'general' },
  { phrase: 'help me',          concern: 'general' },
  { phrase: 'need routine',     concern: 'general' },
  { phrase: 'need a routine',   concern: 'general' },
  { phrase: 'recommend product', concern: 'general' },
  { phrase: 'recommend a product', concern: 'general' },
  { phrase: 'product recommendation', concern: 'general' },
  { phrase: 'my skin',          concern: 'general' },
  { phrase: 'skincare routine', concern: 'general' },
  { phrase: 'skin routine',     concern: 'general' },
  { phrase: 'skin care',        concern: 'general' },
  { phrase: 'skincare',         concern: 'general' },
  { phrase: 'skin goal',        concern: 'general' },
  { phrase: 'glowing skin',     concern: 'general' },
  { phrase: 'clear skin',       concern: 'general' },
]

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Classify text from a scraped social post.
 *
 * @param {string|null} text  Caption, comment, or bio text.
 * @returns {ClassificationResult}
 */
function classify(text) {
  if (!text || text.trim().length < 3) {
    return {
      intentType: 'noise',
      concern: null,
      academyIntent: null,
      matchedPhrases: [],
      reason: 'empty or too-short text',
    }
  }

  const lower = text.toLowerCase()

  // 1 — Noise check (exit early)
  for (const signal of NOISE_SIGNALS) {
    if (lower.includes(signal)) {
      return {
        intentType: 'noise',
        concern: null,
        academyIntent: null,
        matchedPhrases: [signal],
        reason: `noise signal matched: "${signal}"`,
      }
    }
  }

  // 2 — Academy / business-builder check
  for (const signal of ACADEMY_SIGNALS) {
    if (lower.includes(signal.phrase)) {
      return {
        intentType: 'academy',
        concern: null,
        academyIntent: signal.intent,
        matchedPhrases: [signal.phrase],
        reason: `academy signal matched: "${signal.phrase}"`,
      }
    }
  }

  // 3 — Consumer skincare concern check (collect all matches for scoring)
  const consumerMatches = CONSUMER_SIGNALS.filter(s => lower.includes(s.phrase))

  if (consumerMatches.length > 0) {
    // Primary concern = first matched entry (order matters in CONSUMER_SIGNALS)
    const primaryConcern = consumerMatches[0].concern
    return {
      intentType: 'consumer',
      concern: primaryConcern,
      academyIntent: null,
      matchedPhrases: consumerMatches.map(s => s.phrase),
      reason: `consumer signals matched: ${consumerMatches.map(s => `"${s.phrase}"`).join(', ')}`,
    }
  }

  // 4 — No match
  return {
    intentType: 'noise',
    concern: null,
    academyIntent: null,
    matchedPhrases: [],
    reason: 'no intent signals matched',
  }
}

// ── Types (JSDoc) ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} ClassificationResult
 * @property {'consumer'|'academy'|'noise'} intentType
 * @property {string|null} concern
 * @property {string|null} academyIntent
 * @property {string[]} matchedPhrases
 * @property {string} reason
 */

module.exports = { classify }
