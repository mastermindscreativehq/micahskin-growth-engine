'use strict'

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .trim()
}

function normalizeBrand(brand) {
  return normalizeName(brand)
}

function normalizeCategory(raw) {
  const t = (raw || '').toLowerCase()
  if (/cleanser|face wash|foam wash|gel cleanser/.test(t)) return 'cleanser'
  if (/toner|essence/.test(t)) return 'toner'
  if (/serum|ampoule/.test(t)) return 'serum'
  if (/moistur|face cream|day cream|night cream|gel cream/.test(t)) return 'moisturizer'
  if (/sunscreen|spf|sun protect|sun cream/.test(t)) return 'sunscreen'
  if (/spot|blemish|spot treatment/.test(t)) return 'spot_treatment'
  if (/facial oil|face oil/.test(t)) return 'oil'
  if (/body oil|body butter|body lotion|body wash|body cream/.test(t)) return 'body'
  if (/exfoliant|exfoliator|aha|bha|peeling|scrub/.test(t)) return 'exfoliant'
  if (/mask|sheet mask/.test(t)) return 'mask'
  if (/oil/.test(t)) return 'oil'
  return 'other'
}

// Concern normalization now delegates to the centralized canonical taxonomy
// (backend/src/config/skinTaxonomy.js) — that module is the single source of
// truth for the canonical concept list + alias map. Kept as thin wrappers
// here so every existing caller (productIngestionService.js etc.) keeps
// working unchanged.
//
// Unlike skinTaxonomy.normalizeConcern() (which returns null for anything
// unrecognized — the right behavior for strict external/n8n ingestion),
// this wrapper preserves the ORIGINAL fallback behavior: an unrecognized tag
// is kept as-is (lowercased/trimmed) rather than silently dropped, so no
// existing or future manually-entered custom tag is ever lost.
function normalizeConcernTag(tag) {
  const { normalizeConcern } = require('../config/skinTaxonomy')
  const t = (tag || '').toLowerCase().trim()
  if (!t) return null
  return normalizeConcern(t) || t
}

function normalizeConcernTags(tags) {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.map(normalizeConcernTag).filter(Boolean))]
}

const SKIN_TYPE_MAP = {
  all: 'all',
  'all skin types': 'all',
  'all types': 'all',
  normal: 'normal',
  oily: 'oily',
  dry: 'dry',
  combination: 'combination',
  combo: 'combination',
  sensitive: 'sensitive',
}

function normalizeSkinTypeTags(tags) {
  if (!Array.isArray(tags)) return []
  return [...new Set(
    tags.map(t => SKIN_TYPE_MAP[(t || '').toLowerCase().trim()] || (t || '').toLowerCase().trim()).filter(Boolean)
  )]
}

function normalizePriceBand(price, currency = 'NGN') {
  if (!price && price !== 0) return null
  const p = Number(price)
  if (isNaN(p)) return null
  if (currency === 'NGN') {
    if (p < 5000) return 'budget'
    if (p <= 15000) return 'mid-range'
    return 'premium'
  }
  if (p < 10) return 'budget'
  if (p <= 30) return 'mid-range'
  return 'premium'
}

function buildDedupKey(normalizedName, normalizedBrand, sourceStore) {
  return `${normalizedName}||${normalizedBrand || 'unknown'}||${sourceStore || 'manual'}`
}

function tokenSimilarity(a, b) {
  const tokensA = new Set((a || '').split('_').filter(Boolean))
  const tokensB = new Set((b || '').split('_').filter(Boolean))
  const intersection = [...tokensA].filter(t => tokensB.has(t))
  const union = new Set([...tokensA, ...tokensB])
  return union.size === 0 ? 0 : intersection.length / union.size
}

function isProbableDuplicate(nameA, brandA, nameB, brandB, threshold = 0.75) {
  if (brandA !== brandB) return false
  return tokenSimilarity(nameA, nameB) >= threshold
}

module.exports = {
  normalizeName,
  normalizeBrand,
  normalizeCategory,
  normalizeConcernTag,
  normalizeConcernTags,
  normalizeSkinTypeTags,
  normalizePriceBand,
  buildDedupKey,
  isProbableDuplicate,
  tokenSimilarity,
}
