'use strict'

/**
 * painPointQueries.js
 * Phase 35 — Pain-point-first Nigerian skincare lead discovery.
 *
 * Replaces hashtag-first scraping with intent-led queries: each batch is built
 * from a Nigerian pain-point query plus a Nigerian location modifier. Hashtags
 * stay available as a backup channel (see micahskinTikTokHashtags.js).
 *
 * The Apify TikTok actor only accepts hashtag-shaped tokens, so each query is
 * converted to its canonical hashtag form (lowercase + alphanumeric only)
 * before being sent. The original phrases are preserved alongside the canonical
 * form so the dashboard can display the human-readable batch.
 */

// ── Source phrases (kept verbatim for dashboard / logs) ──────────────────────

const PRIMARY_PAIN_POINTS = [
  'dark knuckles',
  'dark underarms',
  'dark spots',
  'acne scars',
  'hyperpigmentation',
  'stretch marks',
  'uneven skin tone',
  'pimples',
  'black spots on face',
  'skin bleaching damage',
  'face cream reaction',
  'body cream reaction',
  'clear skin journey',
  'how to remove dark spots',
  'best cream for dark spots Nigeria',
  'skincare plug Nigeria',
  'organic skincare Nigeria',
  'skin care vendor Nigeria',
  'start skincare business Nigeria',
]

const NG_LOCATION_MODIFIERS = [
  'Nigeria',
  'Lagos',
  'Abuja',
  'Port Harcourt',
  'Ibadan',
  'Lekki',
  'Benin',
  'Enugu',
  'Nigerian',
  'Naija',
]

// Pidgin / colloquial markers — not hashtag-shaped, but used by the
// psychology + Nigeria-signal services for relevance scoring on scraped text.
const NG_PIDGIN_MARKERS = [
  'my face dark',
  'nothing works',
  'I don tire',
  'abeg help',
  'who has used',
  'where can I buy',
]

// ── Hashtag canonicalisation ──────────────────────────────────────────────────

function toHashtag(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

const PAIN_HASHTAGS = [
  ...new Set(PRIMARY_PAIN_POINTS.map(toHashtag).filter(h => h.length >= 4)),
]

const LOCATION_HASHTAGS = [
  ...new Set(
    NG_LOCATION_MODIFIERS
      .filter(s => /^[a-zA-Z]/.test(s))
      .map(toHashtag)
      .filter(h => h.length >= 4),
  ),
]

// ── Batch shape ──────────────────────────────────────────────────────────────
//
// Each Apify run gets a 10-tag batch: 7 pain hashtags + 3 location modifiers.
// Pain dominates so the actor surfaces problem-language posts; locations bias
// toward Nigerian audiences without overspending the batch on geo signal.

const BATCH_SIZE     = 10
const PAIN_PER_BATCH = 7
const LOC_PER_BATCH  = BATCH_SIZE - PAIN_PER_BATCH

// ── Rotation memory (24h reuse block) ────────────────────────────────────────
//
// In-memory ledger of recently used batches. Keyed by sorted-canonical batch
// string. Entries auto-expire after BLOCK_MS so the rotation doesn't grow
// unbounded for long-running processes.

const _recentBatches = new Map()  // key → lastUsedAtMs
const BLOCK_MS = 24 * 60 * 60 * 1000

let _painCursor = 0
let _locCursor  = 0

function _canon(arr) {
  return [...arr].sort().join('|')
}

function _wasUsedRecently(key) {
  const ts = _recentBatches.get(key)
  if (!ts) return false
  if (Date.now() - ts > BLOCK_MS) {
    _recentBatches.delete(key)
    return false
  }
  return true
}

function _markUsed(key) {
  _recentBatches.set(key, Date.now())
}

function _pick(pool, cursorRef, n) {
  const out = []
  for (let i = 0; i < n; i++) out.push(pool[(cursorRef.value + i) % pool.length])
  cursorRef.value = (cursorRef.value + n) % pool.length
  return out
}

/**
 * getNextPainBatch
 *
 * Returns the next pain-point batch that has NOT been scraped within the last
 * 24 hours. If every cursor offset yields a recently used batch, falls back to
 * the next cursor-rotated batch and overwrites the oldest reservation — this
 * guarantees we always make progress, even when the rotation pool is small.
 */
function getNextPainBatch() {
  const totalCombos = Math.max(
    1,
    Math.floor(PAIN_HASHTAGS.length / Math.max(1, PAIN_PER_BATCH)),
  )

  const painRef = { value: _painCursor }
  const locRef  = { value: _locCursor }

  for (let attempt = 0; attempt <= totalCombos; attempt++) {
    const pain = _pick(PAIN_HASHTAGS,    painRef, PAIN_PER_BATCH)
    const loc  = _pick(LOCATION_HASHTAGS, locRef,  LOC_PER_BATCH)
    const batch = [...pain, ...loc]
    const key = _canon(batch)
    if (!_wasUsedRecently(key)) {
      _painCursor = painRef.value
      _locCursor  = locRef.value
      _markUsed(key)
      return {
        mode:     'pain_point_first',
        batch,
        key,
        // Map canonical hashtags back to human-readable source phrases for the
        // dashboard. `null` for any hashtag that doesn't have a 1:1 phrase
        // (e.g. when two phrases collide on the same canonical form).
        phrases:  batch.map(h => _phraseForHashtag(h)),
      }
    }
  }

  // Fallthrough — every offset was recently used. Force-rotate by advancing
  // the cursor and overwriting the LRU reservation.
  const pain = _pick(PAIN_HASHTAGS,    painRef, PAIN_PER_BATCH)
  const loc  = _pick(LOCATION_HASHTAGS, locRef,  LOC_PER_BATCH)
  const batch = [...pain, ...loc]
  _painCursor = painRef.value
  _locCursor  = locRef.value
  const key = _canon(batch)
  _markUsed(key)
  return {
    mode:    'pain_point_first',
    batch,
    key,
    phrases: batch.map(h => _phraseForHashtag(h)),
    forced:  true,
  }
}

// Reverse lookup so the dashboard can show "dark knuckles" rather than
// "darkknuckles". Build once on module load.
const _hashtagToPhrase = (() => {
  const m = new Map()
  for (const phrase of PRIMARY_PAIN_POINTS) {
    const h = toHashtag(phrase)
    if (h && !m.has(h)) m.set(h, phrase)
  }
  for (const loc of NG_LOCATION_MODIFIERS) {
    const h = toHashtag(loc)
    if (h && !m.has(h)) m.set(h, loc)
  }
  return m
})()

function _phraseForHashtag(h) {
  return _hashtagToPhrase.get(h) || h
}

function getRecentBatchSnapshot() {
  return Array.from(_recentBatches.entries())
    .map(([key, ts]) => ({ key, lastUsedAt: new Date(ts).toISOString() }))
    .sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1))
}

module.exports = {
  PRIMARY_PAIN_POINTS,
  NG_LOCATION_MODIFIERS,
  NG_PIDGIN_MARKERS,
  PAIN_HASHTAGS,
  LOCATION_HASHTAGS,
  BATCH_SIZE,
  toHashtag,
  getNextPainBatch,
  getRecentBatchSnapshot,
  // Test/debug helpers
  _resetRotation: () => {
    _recentBatches.clear()
    _painCursor = 0
    _locCursor  = 0
  },
}
