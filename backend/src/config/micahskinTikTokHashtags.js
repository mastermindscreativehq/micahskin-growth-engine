'use strict'

/**
 * micahskinTikTokHashtags.js
 * Canonical hashtag targeting config for MICAHSKIN TikTok lead acquisition.
 *
 * All hashtags are pre-sanitised:
 *   - No # prefix (Apify receives raw strings)
 *   - No spaces inside (e.g. "uneven skintone" → "unevenskintone")
 *   - No curly/smart quotes
 *   - No duplicates
 *   - Typos corrected (startaskincarebusiness)
 */

const MICAHSKIN_HASHTAG_TIERS = {
  // Tier 1 — Pain & condition signals. Highest-intent: people describing skin problems.
  pain_condition: [
    'acneskin',
    'darkspotcorrector',
    'hyperpigmentationtreatment',
    'evenskintone',
    'clearskinjourney',
    'glowingskin',
    'glowup',
  ],

  // Tier 2 — Local market identity. Nigerian / African audience.
  local_market: [
    'nigerianskincare',
    'naijaskincare',
    'blackgirlskincare',
    'melaninskincare',
    'wocskincare',
    'africanwomen',
    'lagosbeauty',
  ],

  // Tier 3 — Product discovery. People actively searching for skincare solutions.
  product_discovery: [
    'skincareproducts',
    'skincarethatworks',
    'skincarereview',
    'bodybutter',
    'luxuryskincare',
    'skincareroutine',
    'skincarejourney',
    'skintok',
    'niacinamide',
    'vitaminc',
    'selfcareroutine',
  ],

  // Tier 4 — Business & education. Entrepreneurs + academy audience.
  business_education: [
    'skincarebusiness',
    'beautyentrepreneur',
    'skincareentrepreneur',
    'masterclass',
    'aiautomation',
  ],
}

// Flat deduplicated list of all hashtags across every tier.
const ALL_HASHTAGS = [
  ...new Set([
    ...MICAHSKIN_HASHTAG_TIERS.pain_condition,
    ...MICAHSKIN_HASHTAG_TIERS.local_market,
    ...MICAHSKIN_HASHTAG_TIERS.product_discovery,
    ...MICAHSKIN_HASHTAG_TIERS.business_education,
  ]),
]

// Priority pool: Tier 1 + Tier 2. Most likely to surface in-pain local prospects.
const PRIORITY_HASHTAGS = [
  ...MICAHSKIN_HASHTAG_TIERS.pain_condition,
  ...MICAHSKIN_HASHTAG_TIERS.local_market,
]

// ── Batch rotation ────────────────────────────────────────────────────────────

const BATCH_SIZE = 10   // 8–12 per Apify run; 10 is the safe midpoint

let _batchIndex = 0

/**
 * getHashtagsForRun(mode)
 *
 * Returns a de-overlapping rotating batch of BATCH_SIZE hashtags each call.
 * The rotation ensures different tags are scraped on consecutive 30-min cycles
 * without repeating the same set every run.
 *
 * mode:
 *   'priority' (default) — rotate through PRIORITY_HASHTAGS (Tier 1 + 2)
 *   'all'                — rotate through ALL_HASHTAGS
 *   'full'               — return ALL_HASHTAGS without batching (manual use only)
 *
 * @param {string} [mode='priority']
 * @returns {string[]}
 */
function getHashtagsForRun(mode = 'priority') {
  if (mode === 'full') return ALL_HASHTAGS

  const pool = mode === 'all' ? ALL_HASHTAGS : PRIORITY_HASHTAGS

  const start = (_batchIndex * BATCH_SIZE) % pool.length
  const batch = []
  for (let i = 0; i < BATCH_SIZE; i++) {
    batch.push(pool[(start + i) % pool.length])
  }

  const currentBatch = _batchIndex
  _batchIndex++

  console.log(
    `[HashtagConfig] Batch #${currentBatch} selected — mode=${mode} start=${start} pool_size=${pool.length}`,
  )

  return batch
}

module.exports = {
  MICAHSKIN_HASHTAG_TIERS,
  ALL_HASHTAGS,
  PRIORITY_HASHTAGS,
  getHashtagsForRun,
}
