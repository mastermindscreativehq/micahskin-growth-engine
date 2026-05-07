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

// 24h reuse-block memory — keyed by sorted-canonical batch string so the
// hashtag-backup channel never re-scrapes the same set within a day.
const _recentHashtagBatches = new Map()
const HASHTAG_REUSE_BLOCK_MS = 24 * 60 * 60 * 1000

function _canon(arr) {
  return [...arr].sort().join('|')
}

function _hashtagBatchUsedRecently(key) {
  const ts = _recentHashtagBatches.get(key)
  if (!ts) return false
  if (Date.now() - ts > HASHTAG_REUSE_BLOCK_MS) {
    _recentHashtagBatches.delete(key)
    return false
  }
  return true
}

function _pickBatch(pool, startIdx) {
  const batch = []
  for (let i = 0; i < BATCH_SIZE; i++) batch.push(pool[(startIdx + i) % pool.length])
  return batch
}

/**
 * getHashtagsForRun(mode)
 *
 * Returns a de-overlapping rotating batch of BATCH_SIZE hashtags each call.
 * Skips batches scraped within the last 24h so the backup channel keeps
 * rotating instead of replaying the same tags.
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
  const totalOffsets = Math.max(1, Math.ceil(pool.length / BATCH_SIZE))

  let chosenBatch = null
  let chosenStart = 0
  let chosenIndex = _batchIndex

  for (let attempt = 0; attempt < totalOffsets; attempt++) {
    const idx   = _batchIndex + attempt
    const start = (idx * BATCH_SIZE) % pool.length
    const batch = _pickBatch(pool, start)
    const key   = _canon(batch)
    if (!_hashtagBatchUsedRecently(key)) {
      chosenBatch = batch
      chosenStart = start
      chosenIndex = idx
      _recentHashtagBatches.set(key, Date.now())
      break
    }
  }

  // Fallthrough — every offset was used in last 24h. Force-rotate.
  if (!chosenBatch) {
    chosenStart  = (_batchIndex * BATCH_SIZE) % pool.length
    chosenBatch  = _pickBatch(pool, chosenStart)
    chosenIndex  = _batchIndex
    _recentHashtagBatches.set(_canon(chosenBatch), Date.now())
  }

  _batchIndex = chosenIndex + 1

  console.log(
    `[HashtagConfig] Batch #${chosenIndex} selected — mode=${mode}` +
    ` start=${chosenStart} pool_size=${pool.length}` +
    ` blocked_recent=${_recentHashtagBatches.size}`,
  )

  return chosenBatch
}

module.exports = {
  MICAHSKIN_HASHTAG_TIERS,
  ALL_HASHTAGS,
  PRIORITY_HASHTAGS,
  getHashtagsForRun,
}
