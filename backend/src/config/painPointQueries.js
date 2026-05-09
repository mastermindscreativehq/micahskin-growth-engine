'use strict'

/**
 * painPointQueries.js
 * Phase 37 — Strict Africa-first, manual-only buyer-intent discovery.
 *
 * Replaces broad / global hashtag discovery with a country-aware pain-point +
 * buyer-intent batch generator. Operator picks a country (Nigeria / Ghana /
 * Kenya / South Africa) and we build a 10-tag batch from:
 *
 *   COUNTRY × PAIN × BUYER_INTENT
 *
 * The Apify TikTok actor only accepts hashtag-shaped tokens, so each phrase is
 * canonicalised (lowercase + alphanumeric only) before being sent. The
 * human-readable phrase pool is preserved for dashboards / logs.
 */

// ── Country-aware lexicons ───────────────────────────────────────────────────

const COUNTRY_PROFILES = {
  NG: {
    label:       'Nigeria',
    locations:   ['nigeria', 'lagos', 'abuja', 'port harcourt', 'naija', 'lekki', 'ibadan', 'benin', 'enugu'],
    languageHints: ['nigerian', 'naija', '9ja'],
  },
  GH: {
    label:       'Ghana',
    locations:   ['ghana', 'accra', 'kumasi', 'ghanaian'],
    languageHints: ['ghanaian'],
  },
  KE: {
    label:       'Kenya',
    locations:   ['kenya', 'nairobi', 'mombasa', 'kenyan'],
    languageHints: ['kenyan'],
  },
  ZA: {
    label:       'South Africa',
    locations:   ['south africa', 'johannesburg', 'cape town', 'durban', 'south african'],
    languageHints: ['south african'],
  },
}

const SUPPORTED_COUNTRIES = Object.keys(COUNTRY_PROFILES)
const DEFAULT_COUNTRY     = 'NG'

// Pain phrases — operator-defined, strictly skin-darkening / texture concerns.
const PAIN_TERMS = [
  'dark knuckles',
  'dark underarms',
  'hyperpigmentation',
  'stretch marks',
  'acne scars',
  'uneven skin tone',
  'body acne',
  'strawberry legs',
  'dark inner thighs',
  'dark spots',
  'melasma',
  'pimples scars',
  'black knees',
  'black elbows',
]

// Buyer-intent terms — collapse the funnel toward purchase / consult.
const BUYER_INTENT_TERMS = [
  'what can i use',
  'help me',
  'recommend',
  'how do i fix',
  'what worked',
  'where can i buy',
  'how much',
  'routine',
  'treatment',
  'cream for',
  'soap for',
]

// Soft Pidgin / colloquial markers — used only for relevance scoring.
const NG_PIDGIN_MARKERS = [
  'my face dark',
  'nothing works',
  'I don tire',
  'abeg help',
  'who has used',
  'where can I buy',
]

// ── Hashtag canonicalisation ─────────────────────────────────────────────────

function toHashtag(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function _hashtagsFor(phrases) {
  return [...new Set(phrases.map(toHashtag).filter(h => h.length >= 4))]
}

// Shared lookup: hashtag → phrase, for dashboards / logs.
const _hashtagToPhrase = (() => {
  const m = new Map()
  for (const p of PAIN_TERMS)         { const h = toHashtag(p); if (h && !m.has(h)) m.set(h, p) }
  for (const p of BUYER_INTENT_TERMS) { const h = toHashtag(p); if (h && !m.has(h)) m.set(h, p) }
  for (const profile of Object.values(COUNTRY_PROFILES)) {
    for (const loc of profile.locations) { const h = toHashtag(loc); if (h && !m.has(h)) m.set(h, loc) }
  }
  return m
})()

function _phraseForHashtag(h) {
  return _hashtagToPhrase.get(h) || h
}

// ── Country-aware combinations ───────────────────────────────────────────────
//
// Build EXAMPLE_QUERIES like "dark knuckles nigeria", "hyperpigmentation lagos"
// per country. Captures both pure pain terms, pain+location combos, and
// buyer-intent + pain phrases.

function buildCombinationsForCountry(country) {
  const profile = COUNTRY_PROFILES[country] || COUNTRY_PROFILES[DEFAULT_COUNTRY]

  const combos = []
  // Pain-only (canonicalises to e.g. darkknuckles)
  for (const pain of PAIN_TERMS) combos.push(pain)
  // Pain + primary country / city
  for (const pain of PAIN_TERMS) {
    for (const loc of profile.locations.slice(0, 3)) {
      combos.push(`${pain} ${loc}`)
    }
  }
  // Buyer intent + pain
  for (const intent of BUYER_INTENT_TERMS.slice(0, 6)) {
    for (const pain of PAIN_TERMS.slice(0, 6)) {
      combos.push(`${intent} ${pain}`)
    }
  }
  // Country-only pivots ("african skin", "melanin skin")
  combos.push('african skin', 'melanin skin', 'black skin')
  return combos
}

// ── Batch shape ──────────────────────────────────────────────────────────────
//
// Each manual run gets a 10-tag batch: 6 pain hashtags + 3 country/location
// hashtags + 1 buyer-intent hashtag. Pain dominates so the actor surfaces
// problem-language posts; locations lock the audience to the chosen country.

const BATCH_SIZE      = 10
const PAIN_PER_BATCH  = 6
const LOC_PER_BATCH   = 3
const INTENT_PER_BATCH = BATCH_SIZE - PAIN_PER_BATCH - LOC_PER_BATCH

// ── Rotation memory (per-country, 24h reuse block) ───────────────────────────

const _recentBatches = new Map()   // key → lastUsedAtMs
const BLOCK_MS = 24 * 60 * 60 * 1000

const _cursors = {} // { [country]: { pain, loc, intent } }
function _cursorFor(country) {
  if (!_cursors[country]) _cursors[country] = { pain: 0, loc: 0, intent: 0 }
  return _cursors[country]
}

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
  if (pool.length === 0) return out
  for (let i = 0; i < n; i++) out.push(pool[(cursorRef.value + i) % pool.length])
  cursorRef.value = (cursorRef.value + n) % pool.length
  return out
}

function _normaliseCountry(country) {
  const c = String(country || '').trim().toUpperCase()
  if (!c) return DEFAULT_COUNTRY
  // Allow long names too — "nigeria" → NG
  if (SUPPORTED_COUNTRIES.includes(c)) return c
  for (const [code, profile] of Object.entries(COUNTRY_PROFILES)) {
    if (profile.label.toUpperCase() === c) return code
  }
  return DEFAULT_COUNTRY
}

/**
 * getNextPainBatch
 *
 * Returns a country-aware Africa-first batch that has NOT been scraped within
 * the last 24h. Manual mode — the rotation block protects against operator
 * accidentally re-running the same batch back to back.
 */
/**
 * getNextPainBatch
 *
 * @param {object} [opts]
 * @param {string} [opts.country]  Country code (default DEFAULT_COUNTRY)
 * @param {boolean} [opts.peek]   If true, returns the next batch WITHOUT advancing
 *                                 the cursor or marking it as recently used.
 *                                 Safe to call from dry-run / preview endpoints.
 */
function getNextPainBatch({ country = DEFAULT_COUNTRY, peek = false } = {}) {
  const code     = _normaliseCountry(country)
  const profile  = COUNTRY_PROFILES[code]

  const painPool   = _hashtagsFor(PAIN_TERMS)
  const locPool    = _hashtagsFor(profile.locations)
  const intentPool = _hashtagsFor(BUYER_INTENT_TERMS)

  const cursors  = _cursorFor(code)
  const painRef  = { value: cursors.pain }
  const locRef   = { value: cursors.loc }
  const intentRef = { value: cursors.intent }

  const totalCombos = Math.max(
    1,
    Math.floor(painPool.length / Math.max(1, PAIN_PER_BATCH)),
  )

  for (let attempt = 0; attempt <= totalCombos; attempt++) {
    const pain   = _pick(painPool,   painRef,   PAIN_PER_BATCH)
    const loc    = _pick(locPool,    locRef,    LOC_PER_BATCH)
    const intent = _pick(intentPool, intentRef, INTENT_PER_BATCH)
    const batch  = [...pain, ...loc, ...intent].filter(Boolean)
    const key    = `${code}|${_canon(batch)}`
    if (!_wasUsedRecently(key)) {
      if (!peek) {
        cursors.pain   = painRef.value
        cursors.loc    = locRef.value
        cursors.intent = intentRef.value
        _markUsed(key)
      }
      return {
        mode:    'pain_point_first',
        country: code,
        countryLabel: profile.label,
        batch,
        key,
        phrases: batch.map(h => _phraseForHashtag(h)),
      }
    }
  }

  // Force-rotate fallback — overwrite the LRU reservation.
  {
    const pain   = _pick(painPool,   painRef,   PAIN_PER_BATCH)
    const loc    = _pick(locPool,    locRef,    LOC_PER_BATCH)
    const intent = _pick(intentPool, intentRef, INTENT_PER_BATCH)
    const batch  = [...pain, ...loc, ...intent].filter(Boolean)
    const key    = `${code}|${_canon(batch)}`
    if (!peek) {
      cursors.pain   = painRef.value
      cursors.loc    = locRef.value
      cursors.intent = intentRef.value
      _markUsed(key)
    }
    return {
      mode:    'pain_point_first',
      country: code,
      countryLabel: profile.label,
      batch,
      key,
      phrases: batch.map(h => _phraseForHashtag(h)),
      forced:  true,
    }
  }
}

function getRecentBatchSnapshot() {
  return Array.from(_recentBatches.entries())
    .map(([key, ts]) => ({ key, lastUsedAt: new Date(ts).toISOString() }))
    .sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1))
}

function getCountryProfile(country) {
  const code = _normaliseCountry(country)
  return { code, ...COUNTRY_PROFILES[code] }
}

function listSupportedCountries() {
  return SUPPORTED_COUNTRIES.map(code => ({ code, label: COUNTRY_PROFILES[code].label }))
}

module.exports = {
  PAIN_TERMS,
  BUYER_INTENT_TERMS,
  NG_PIDGIN_MARKERS,
  COUNTRY_PROFILES,
  SUPPORTED_COUNTRIES,
  DEFAULT_COUNTRY,
  BATCH_SIZE,
  toHashtag,
  getNextPainBatch,
  getRecentBatchSnapshot,
  getCountryProfile,
  listSupportedCountries,
  buildCombinationsForCountry,
  // Test/debug helpers
  _resetRotation: () => {
    _recentBatches.clear()
    for (const k of Object.keys(_cursors)) delete _cursors[k]
  },
}
