'use strict'

/**
 * skinTaxonomy.js
 *
 * Single centralized canonical vocabulary for skin types / skin concerns /
 * body-care categories. Extends (does not replace) the existing taxonomy
 * that already lived inline in productNormalizationService.js.
 *
 * Explicitly does NOT touch:
 *   - diagnosisEngineService.js's own regex classification (Vocabulary A)
 *   - diagnosisService.js's clinical TEMPLATES / normalizeConcern (Vocabulary B)
 *   - deepConsultService.js's RED_FLAG_PATTERNS (a separate, safety-only
 *     vocabulary that must never be conflated with cosmetic skin concerns —
 *     see CONCEPT_CLASSIFICATION.CONDITION_RED_FLAG note below)
 * Those remain the source of truth for the Telegram diagnosis pipeline. This
 * module exists for product tagging / catalog ingestion / future matching
 * improvements, feeding INTO that pipeline's existing inputs — never a
 * second diagnosis engine.
 *
 * Flow:
 *   RAW USER/SOURCE LANGUAGE → normalizeConcern() (alias lookup) → CANONICAL CONCEPT
 */

// ── Skin types (never concerns) ────────────────────────────────────────────────

const SKIN_TYPES = ['oily', 'dry', 'combination', 'normal', 'sensitive']

// ── Canonical concerns ──────────────────────────────────────────────────────────
// Superset of the previous productNormalizationService.js VALID_CONCERNS.
// dark_spots is deliberately NOT in this list — it is consolidated as an
// alias of hyperpigmentation (see CONCERN_ALIASES) rather than kept as an
// independent, competing concept.

const CANONICAL_CONCERNS = [
  'acne',
  'hyperpigmentation',
  'dry_skin',
  'oily_skin',
  'sensitivity',
  'eczema',
  'damaged_barrier',
  'fine_lines',
  'wrinkles',
  'dullness',
  'uneven_texture',
  'large_pores',
  'blackheads',
  'whiteheads',
  'sun_damage',
  'keratosis_pilaris',
  'body_care',
  'stretch_marks',
  'routine_building',
]

// ── Classification — documentation/admin-grouping metadata only. ──────────────
// Storage stays a flat concernsSupported String[] on SkincareProduct; this
// map never changes how data is stored, only how it's labeled/grouped.
//
// CONDITION_RED_FLAG concepts (bleeding, severe_pain, etc.) live exclusively
// in deepConsultService.js's RED_FLAG_PATTERNS and are intentionally absent
// from this map — a product must never be tagged with a medical red flag,
// and the presence of a cosmetic concern like "eczema" here does NOT mean
// the system is making a medical diagnosis. Customer-facing copy must stay
// "Personalized Skin Assessment / Analysis / Recommendation", never
// "diagnosis" — unchanged from the existing convention.

const CONCEPT_CLASSIFICATION = {
  oily: 'SKIN_TYPE',
  dry: 'SKIN_TYPE',
  combination: 'SKIN_TYPE',
  normal: 'SKIN_TYPE',
  sensitive: 'SKIN_TYPE',

  acne: 'SKIN_CONCERN',
  hyperpigmentation: 'SKIN_CONCERN',
  dry_skin: 'SKIN_CONCERN',
  oily_skin: 'SKIN_CONCERN',
  sensitivity: 'SKIN_CONCERN',
  eczema: 'SKIN_CONCERN',
  damaged_barrier: 'SKIN_CONCERN',
  fine_lines: 'SKIN_CONCERN',
  wrinkles: 'SKIN_CONCERN',
  dullness: 'SKIN_CONCERN',
  uneven_texture: 'SKIN_CONCERN',
  large_pores: 'SKIN_CONCERN',
  blackheads: 'SKIN_CONCERN',
  whiteheads: 'SKIN_CONCERN',
  sun_damage: 'SKIN_CONCERN',
  routine_building: 'SKIN_CONCERN',

  body_care: 'BODY_CARE_CATEGORY',
  stretch_marks: 'BODY_CARE_CATEGORY',
  keratosis_pilaris: 'BODY_CARE_CATEGORY',
}

// ── Alias resolution ─────────────────────────────────────────────────────────
// Raw natural language / legacy stored values -> canonical concept.
// Extends the alias set that already existed in productNormalizationService.js
// (acne/hyperpigmentation/dry_skin/oily_skin/sensitivity/body_care aliases
// are carried over unchanged) with the new concepts' aliases.
//
// dehydration and redness are deliberately kept as ALIASES (not promoted to
// their own canonical concept) because the existing clinical template engine
// (diagnosisService.js) already treats them as identical to dry_skin and
// sensitivity respectively — no distinct treatment path exists for them, so
// promoting them would create a duplicate concept, not a genuinely new one.

const CONCERN_ALIASES = {
  // acne
  pimple: 'acne',
  pimples: 'acne',
  breakout: 'acne',
  breakouts: 'acne',
  blemish: 'acne',
  blemishes: 'acne',

  // hyperpigmentation — dark_spots consolidated here, not an independent concept
  'dark spot': 'hyperpigmentation',
  'dark spots': 'hyperpigmentation',
  dark_spots: 'hyperpigmentation',
  'dark mark': 'hyperpigmentation',
  'dark marks': 'hyperpigmentation',
  pigmentation: 'hyperpigmentation',
  'uneven tone': 'hyperpigmentation',
  'uneven skin tone': 'hyperpigmentation',
  uneven_skin_tone: 'hyperpigmentation',
  melasma: 'hyperpigmentation',
  'post acne marks': 'hyperpigmentation',
  'post-acne marks': 'hyperpigmentation',
  post_acne_marks: 'hyperpigmentation',
  pih: 'hyperpigmentation',

  // dry_skin / dehydration — one bucket, matches existing clinical templates
  dehydrated: 'dry_skin',
  dehydration: 'dry_skin',
  'dehydrated skin': 'dry_skin',
  'lack of hydration': 'dry_skin',
  dryness: 'dry_skin',

  // oily_skin
  'oily skin': 'oily_skin',
  oiliness: 'oily_skin',

  // sensitivity / redness — one bucket, matches existing clinical templates
  'sensitive skin': 'sensitivity',
  irritation: 'sensitivity',
  redness: 'sensitivity',

  // damaged_barrier
  'damaged skin barrier': 'damaged_barrier',
  'damaged barrier': 'damaged_barrier',
  'compromised barrier': 'damaged_barrier',
  'broken skin barrier': 'damaged_barrier',
  'weak skin barrier': 'damaged_barrier',

  // large_pores
  'visible pores': 'large_pores',
  'enlarged pores': 'large_pores',

  // blackheads / whiteheads
  'black heads': 'blackheads',
  'clogged black pores': 'blackheads',
  'white heads': 'whiteheads',
  'closed comedones': 'whiteheads',

  // keratosis_pilaris
  'chicken skin': 'keratosis_pilaris',
  kp: 'keratosis_pilaris',
  'rough bumps': 'keratosis_pilaris',

  // body_care
  'body care': 'body_care',
  'back acne': 'body_care',

  // stretch marks
  'stretch mark': 'stretch_marks',
  stretchmark: 'stretch_marks',
  'stretch marks': 'stretch_marks',
}

/**
 * Resolves any raw string to its canonical concern.
 * Preserves the caller's original raw input separately where the caller's
 * architecture supports it (e.g. Lead.skinConcern stores the raw value; this
 * function is for TAGGING/MATCHING, not for overwriting raw user input).
 *
 * @param {string} raw
 * @returns {string|null} canonical concern, or null if genuinely unrecognized
 *                          (never invents a concept for unrecognized input)
 */
function normalizeConcern(raw) {
  const t = (raw || '').toLowerCase().trim()
  if (!t) return null
  if (CANONICAL_CONCERNS.includes(t)) return t
  if (CONCERN_ALIASES[t]) return CONCERN_ALIASES[t]
  return null
}

/**
 * Normalizes an array of raw concern tags to a deduplicated array of
 * canonical concerns. Unrecognized entries are dropped, never invented.
 *
 * @param {string[]} tags
 * @returns {string[]}
 */
function normalizeConcernList(tags) {
  if (!Array.isArray(tags)) return []
  const resolved = tags.map(normalizeConcern).filter(Boolean)
  return [...new Set(resolved)]
}

function classify(concept) {
  return CONCEPT_CLASSIFICATION[concept] || 'OTHER'
}

module.exports = {
  SKIN_TYPES,
  CANONICAL_CONCERNS,
  CONCEPT_CLASSIFICATION,
  CONCERN_ALIASES,
  normalizeConcern,
  normalizeConcernList,
  classify,
}
