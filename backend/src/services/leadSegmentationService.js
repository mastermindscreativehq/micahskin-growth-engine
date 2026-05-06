'use strict'

/**
 * leadSegmentationService.js
 * Phase 33 — MAIE
 *
 * Deterministic auto-classification into one of 11 segments.
 * The segment drives downstream funnel routing:
 *
 *   - acne / hyperpigmentation / darkspots / stretchmarks / glowup / bodycare
 *       → skincare sales funnel (product quote)
 *   - reseller / entrepreneur / skincare_business / academy
 *       → academy funnel
 *   - consultation
 *       → consultation funnel (deep consult engine)
 *
 *   classify(text, opts?) → { segment, segmentConfidence, secondarySegments[] }
 *
 * Pure function — no I/O.
 */

// Each bucket: { segment, weight, pattern }
// Weight breaks ties when multiple buckets match. Secondary matches are still
// returned for downstream multi-funnel routing.
const SEGMENT_RULES = [
  // ── Skincare concerns (product funnel) ───────────────────────────────────
  { segment: 'acne',               weight: 30, pattern: /\b(acne|pimples?|breakouts?|cystic|black\s*heads?|white\s*heads?|zits?|spots?\s+on\s+(my\s+)?face)\b/i },
  { segment: 'hyperpigmentation',  weight: 30, pattern: /\b(hyperpigmentation|uneven\s+(skin\s+)?tone|melanin|patchy\s+skin|post[-\s]?(acne|inflammat))/i },
  { segment: 'darkspots',          weight: 28, pattern: /\b(dark\s*spots?|dark\s*patches|dark\s*marks?|black\s*spots?|sun\s*spots?|spot\s+(on\s+)?(face|skin|cheek))\b/i },
  { segment: 'stretchmarks',       weight: 30, pattern: /\b(stretch\s*marks?|striae|pregnancy\s*marks?|tiger\s*stripes)\b/i },
  { segment: 'bodycare',           weight: 22, pattern: /\b(dark\s*knuckles?|dark\s*elbows?|dark\s*underarm|dark\s*armpit|dark\s*neck|dark\s*inner\s*thighs?|body\s+(soap|wash|cream|lotion)|knuckle\s*dark)/i },
  { segment: 'glowup',             weight: 20, pattern: /\b(glow\s*up|glow|brighten(ing)?|radian(t|ce)|even\s+tone|smooth\s+skin|skin\s+tone|fair\s*(er)?\s*skin|lighten(ing)?)\b/i },

  // ── Business / reseller (academy funnel) ─────────────────────────────────
  { segment: 'reseller',           weight: 32, pattern: /\b(want\s+to\s+(sell|resell)|i\s+sell\s+skincare|skincare\s+(reseller|vendor|distributor)|wholesale\s+(price|skincare)|distributor)\b/i },
  { segment: 'entrepreneur',       weight: 28, pattern: /\b(entrepreneur|biz\s*owner|build\s+(my|a)\s+brand|start\s+(my\s+)?(own\s+)?business|business\s+owner)\b/i },
  { segment: 'skincare_business',  weight: 30, pattern: /\b(skincare\s+(brand|business|line|company|formul)|formul(ate|ation)|private\s+label|launch\s+(a\s+)?skincare)\b/i },
  { segment: 'academy',            weight: 30, pattern: /\b(skincare\s+(course|academy|class|training|coaching)|how\s+(do|can|to)\s+i\s+start\s+(a\s+)?skincare|teach\s+me\s+skincare|learn\s+skincare\s+(business|formul))\b/i },

  // ── Consultation funnel ──────────────────────────────────────────────────
  { segment: 'consultation',       weight: 24, pattern: /\b(book\s+(a\s+)?consult\w*|skin\s+(consult\w*|expert|analysis|diagnosis)|need\s+(an?\s+)?(expert|consult\w*)|consultant|see\s+a\s+(derm|dermatologist)|dermatologist|skincare\s+expert|skin\s+coach)\b/i },
]

const FALLBACK_SEGMENT = 'glowup'   // Generic skincare interest if nothing else matches.

// ── Helpers ──────────────────────────────────────────────────────────────────

function _toCorpus(input) {
  if (!input) return ''
  if (Array.isArray(input)) return input.filter(Boolean).map(String).join('\n')
  return String(input)
}

// ── Public API ───────────────────────────────────────────────────────────────

function classify(input, opts = {}) {
  const corpus = [
    _toCorpus(input),
    opts.username ? `@${opts.username}` : '',
    opts.hashtag  ? `#${opts.hashtag}`  : '',
    opts.bio      ? String(opts.bio)    : '',
  ].join('\n').trim()

  if (!corpus) {
    return {
      segment:           FALLBACK_SEGMENT,
      segmentConfidence: 0,
      secondarySegments: [],
      allMatches:        [],
    }
  }

  const matches = []
  for (const rule of SEGMENT_RULES) {
    if (rule.pattern.test(corpus)) {
      matches.push({ segment: rule.segment, weight: rule.weight })
    }
  }

  if (matches.length === 0) {
    return {
      segment:           FALLBACK_SEGMENT,
      segmentConfidence: 20,           // weak — pure fallback
      secondarySegments: [],
      allMatches:        [],
    }
  }

  // Deduplicate by segment, summing weight on collisions.
  const aggregated = new Map()
  for (const m of matches) {
    aggregated.set(m.segment, (aggregated.get(m.segment) || 0) + m.weight)
  }
  const sorted = [...aggregated.entries()]
    .map(([segment, weight]) => ({ segment, weight }))
    .sort((a, b) => b.weight - a.weight)

  const top = sorted[0]
  const totalWeight = sorted.reduce((s, m) => s + m.weight, 0)

  return {
    segment:           top.segment,
    segmentConfidence: Math.min(100, Math.round((top.weight / Math.max(totalWeight, 1)) * 100)),
    secondarySegments: sorted.slice(1, 4).map(m => m.segment),
    allMatches:        sorted,
  }
}

// Convenience helpers consumed by the integrator.
function isProductSegment(segment) {
  return ['acne', 'hyperpigmentation', 'darkspots', 'stretchmarks', 'glowup', 'bodycare'].includes(segment)
}
function isAcademySegment(segment) {
  return ['reseller', 'entrepreneur', 'skincare_business', 'academy'].includes(segment)
}
function isConsultSegment(segment) {
  return segment === 'consultation'
}

// Map MAIE segments → the existing primaryConcern/skinConcern values used
// elsewhere in the system, so injected leads continue to slot into existing
// flows (diagnosis, product matcher, etc.) without schema changes.
function mapToConcernType(segment) {
  switch (segment) {
    case 'acne':              return 'acne'
    case 'hyperpigmentation': return 'hyperpigmentation'
    case 'darkspots':         return 'hyperpigmentation'      // darkspots roll up into HP
    case 'stretchmarks':      return 'stretch_marks'
    case 'bodycare':          return 'general'
    case 'glowup':            return 'general'
    default:                  return 'general'
  }
}

module.exports = {
  classify,
  isProductSegment,
  isAcademySegment,
  isConsultSegment,
  mapToConcernType,
}
