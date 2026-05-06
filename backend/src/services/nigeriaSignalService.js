'use strict'

/**
 * nigeriaSignalService.js
 * Phase 33 — MICAHSKIN Acquisition Intelligence Engine (MAIE)
 *
 * Deterministic Nigerian-identity detector. Pure function — no I/O, no AI.
 *
 *   detect(text, opts?)  →  {
 *     nigeriaConfidence  : 0..100        // weighted likelihood the author is Nigerian
 *     countryConfidence  : 0..100        // confidence we know the country (any country)
 *     detectedCity       : string|null   // strongest single match
 *     detectedCountry    : 'NG'|'other'|null
 *     detectedLanguage   : 'en-NG'|'pidgin'|'en'|null
 *     locationSignals    : string[]      // every distinct hit, ordered by strength
 *   }
 *
 *  Inputs may be a single string or an array of strings (caption + comments + bio).
 *  Username and hashtag may be passed via opts to add additional handle-level signal.
 */

// ── Lexicons ──────────────────────────────────────────────────────────────────

// Cities are weighted because "Lagos" / "Abuja" are far stronger than "Owerri".
// Weight ≥ 25 alone is enough to lift confidence above the inject threshold.
const NIGERIAN_CITIES = [
  // Tier 1 — instantly recognisable, high weight
  { city: 'Lagos',         weight: 30, patterns: [/\blagos\b/i, /\bLDN\b/, /\beko\b/i] },
  { city: 'Abuja',         weight: 30, patterns: [/\babuja\b/i, /\bfct\b/i] },
  { city: 'Port Harcourt', weight: 28, patterns: [/\bport\s*harcourt\b/i, /\bp\.?h\.?\b/i, /\bpitakwa\b/i] },
  // Tier 2 — major cities
  { city: 'Ibadan',        weight: 22, patterns: [/\bibadan\b/i] },
  { city: 'Kano',          weight: 22, patterns: [/\bkano\b/i] },
  { city: 'Benin City',    weight: 22, patterns: [/\bbenin\s*city\b/i, /\bedo\s*state\b/i] },
  { city: 'Enugu',         weight: 22, patterns: [/\benugu\b/i] },
  { city: 'Kaduna',        weight: 22, patterns: [/\bkaduna\b/i] },
  { city: 'Warri',         weight: 22, patterns: [/\bwarri\b/i] },
  { city: 'Owerri',        weight: 20, patterns: [/\bowerri\b/i] },
  { city: 'Calabar',       weight: 20, patterns: [/\bcalabar\b/i] },
  { city: 'Aba',           weight: 18, patterns: [/\baba\b/i] },
  { city: 'Onitsha',       weight: 18, patterns: [/\bonitsha\b/i] },
  { city: 'Uyo',           weight: 18, patterns: [/\buyo\b/i] },
  { city: 'Jos',           weight: 18, patterns: [/\bjos\b/i] },
  { city: 'Ilorin',        weight: 18, patterns: [/\bilorin\b/i] },
  { city: 'Asaba',         weight: 18, patterns: [/\basaba\b/i] },
  { city: 'Akure',         weight: 18, patterns: [/\bakure\b/i] },
  { city: 'Abeokuta',      weight: 18, patterns: [/\babeokuta\b/i] },
  { city: 'Yenagoa',       weight: 18, patterns: [/\byenagoa\b/i] },
  { city: 'Lekki',         weight: 22, patterns: [/\blekki\b/i, /\bvi\b/i, /\bvictoria\s*island\b/i, /\bikoyi\b/i] },
  { city: 'Ikeja',         weight: 22, patterns: [/\bikeja\b/i, /\bsurulere\b/i, /\bgbagada\b/i, /\byaba\b/i] },
  { city: 'Wuse',          weight: 18, patterns: [/\bwuse\b/i, /\bmaitama\b/i, /\bgwarinpa\b/i, /\bjabi\b/i] },
]

// Pidgin / Naija slang — high-confidence linguistic markers.
const NIGERIAN_LINGUISTIC = [
  { token: 'naija',                weight: 25, pattern: /\bnaija\b/i },
  { token: '9ja',                  weight: 25, pattern: /\b9ja\b/i },
  { token: 'gidi',                 weight: 18, pattern: /\bgidi\b/i },
  { token: 'abeg',                 weight: 22, pattern: /\babeg\b/i },
  { token: 'oga',                  weight: 18, pattern: /\boga\b/i },
  { token: 'wahala',               weight: 22, pattern: /\bwahala\b/i },
  { token: 'una',                  weight: 18, pattern: /\buna\b/i },
  { token: 'sef',                  weight: 14, pattern: /\bsef\b/i },
  { token: 'sha',                  weight: 12, pattern: /\bsha\b/i },
  { token: 'biko',                 weight: 18, pattern: /\bbiko\b/i },
  { token: 'omo',                  weight: 14, pattern: /\bomo\b/i },
  { token: 'pls help',             weight: 10, pattern: /\bpls\s+help\b/i },
  { token: 'who get solution',     weight: 22, pattern: /\bwho\s+(get|sabi|know)\s+(solution|cream|cure|product)\b/i },
  { token: 'which cream work',     weight: 22, pattern: /\bwhich\s+(cream|product|soap|serum)\s+(dey\s+)?work\b/i },
  { token: 'face don spoil',       weight: 28, pattern: /\b(face|skin|body)\s+don\s+(spoil|change|black|dark)\b/i },
  { token: 'how I go do',          weight: 22, pattern: /\bhow\s+(i|we)\s+go\s+do\b/i },
  { token: 'I no know',            weight: 14, pattern: /\bi\s+no\s+(know|sabi)\b/i },
  { token: 'no be small',          weight: 14, pattern: /\bno\s+be\s+small\b/i },
  { token: 'na so',                weight: 14, pattern: /\bna\s+so\b/i },
  { token: 'wetin',                weight: 18, pattern: /\bwetin\b/i },
  { token: 'dey',                  weight: 10, pattern: /\bdey\b/i },
  { token: 'don',                  weight: 8,  pattern: /\b(face|skin|body|spot|pimple)s?\s+don\b/i },
  { token: 'comot',                weight: 14, pattern: /\bcomot\b/i },
  { token: 'jare',                 weight: 12, pattern: /\bjare\b/i },
  { token: 'shey',                 weight: 12, pattern: /\bshey\b/i },
  { token: 'pls advise',           weight: 10, pattern: /\bpls\s+(advise|advice|recommend)\b/i },
]

// Currency / payments / regulators — Nigeria-specific.
const NIGERIAN_COMMERCIAL = [
  { token: 'naira',           weight: 22, pattern: /\bnaira\b/i },
  { token: 'NGN',             weight: 22, pattern: /\bngn\b/i },
  { token: '₦ symbol',        weight: 28, pattern: /₦/ },
  { token: 'NAFDAC',          weight: 26, pattern: /\bnafdac\b/i },
  { token: 'paystack',        weight: 14, pattern: /\bpaystack\b/i },
  { token: 'flutterwave',     weight: 14, pattern: /\bflutterwave\b/i },
  { token: 'jumia',           weight: 14, pattern: /\bjumia\b/i },
  { token: '+234',            weight: 26, pattern: /\+?234\d{7,}/ },
  { token: 'gtb',             weight: 12, pattern: /\b(gtbank|gtb|access\s*bank|first\s*bank|zenith)\b/i },
]

// Hashtag handles that anchor a Nigerian audience.
const NIGERIAN_HASHTAGS = [
  /#?nigeria(n|ns)?\b/i,
  /#?naija\b/i,
  /#?9ja\b/i,
  /#?lagos\b/i,
  /#?abuja\b/i,
  /#?nigerianskincare\b/i,
  /#?skincarenigeria\b/i,
]

// Soft non-Nigerian indicators — used to suppress confidence, never as auto-reject.
const NON_NIGERIAN_HINTS = [
  { country: 'US',    pattern: /\b(usa|america|nyc|los\s*angeles|texas|florida|california)\b/i },
  { country: 'UK',    pattern: /\b(london|manchester|uk|britain)\b/i },
  { country: 'IN',    pattern: /\b(india|mumbai|delhi|bangalore|kolkata)\b/i },
  { country: 'KE',    pattern: /\b(kenya|nairobi|mombasa)\b/i },
  { country: 'GH',    pattern: /\b(ghana|accra|kumasi)\b/i },
  { country: 'ZA',    pattern: /\b(south\s*africa|johannesburg|cape\s*town|durban)\b/i },
  { country: 'PH',    pattern: /\b(philippines|manila|filipino|filipina)\b/i },
  { country: 'CA',    pattern: /\b(canada|toronto|vancouver|montreal)\b/i },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function _toCorpus(input) {
  if (!input) return ''
  if (Array.isArray(input)) return input.filter(Boolean).map(String).join('\n')
  return String(input)
}

function _hashtagBoost(text) {
  let hits = 0
  for (const re of NIGERIAN_HASHTAGS) if (re.test(text)) hits++
  return hits * 12
}

// ── Detector ─────────────────────────────────────────────────────────────────

function detect(input, opts = {}) {
  const corpus = [
    _toCorpus(input),
    opts.username ? `@${opts.username}` : '',
    opts.hashtag  ? `#${opts.hashtag}`  : '',
    opts.bio      ? String(opts.bio)    : '',
  ].join('\n').trim()

  if (!corpus) {
    return {
      nigeriaConfidence: 0,
      countryConfidence: 0,
      detectedCity:      null,
      detectedCountry:   null,
      detectedLanguage:  null,
      locationSignals:   [],
    }
  }

  const signals = []
  let weight = 0
  let bestCity = null
  let bestCityWeight = 0

  // Cities
  for (const c of NIGERIAN_CITIES) {
    for (const pat of c.patterns) {
      if (pat.test(corpus)) {
        signals.push(`city:${c.city}`)
        weight += c.weight
        if (c.weight > bestCityWeight) {
          bestCity = c.city
          bestCityWeight = c.weight
        }
        break
      }
    }
  }

  // Linguistic
  let pidginHits = 0
  for (const t of NIGERIAN_LINGUISTIC) {
    if (t.pattern.test(corpus)) {
      signals.push(`slang:${t.token}`)
      weight += t.weight
      pidginHits++
    }
  }

  // Commercial
  for (const t of NIGERIAN_COMMERCIAL) {
    if (t.pattern.test(corpus)) {
      signals.push(`commercial:${t.token}`)
      weight += t.weight
    }
  }

  // Hashtag boost
  const hashtagBoost = _hashtagBoost(corpus)
  if (hashtagBoost > 0) {
    signals.push(`hashtag_boost:${hashtagBoost}`)
    weight += hashtagBoost
  }

  // Non-Nigerian penalty (soft) — caps the score, doesn't reject.
  let foreignCountry = null
  for (const h of NON_NIGERIAN_HINTS) {
    if (h.pattern.test(corpus)) {
      foreignCountry = h.country
      signals.push(`foreign_hint:${h.country}`)
      // Penalty only applied if there's no strong NG city/slang anchor.
      if (bestCityWeight < 25 && pidginHits < 2) weight -= 30
      break
    }
  }

  const nigeriaConfidence = Math.max(0, Math.min(100, weight))

  // detectedLanguage: pidgin trumps en-NG which trumps en
  let detectedLanguage = null
  if (pidginHits >= 2)                        detectedLanguage = 'pidgin'
  else if (nigeriaConfidence >= 30)           detectedLanguage = 'en-NG'
  else if (corpus.match(/[a-z]{3,}/i))        detectedLanguage = 'en'

  // detectedCountry — only commit when we have meaningful signal.
  let detectedCountry = null
  let countryConfidence = 0
  if (nigeriaConfidence >= 30) {
    detectedCountry   = 'NG'
    countryConfidence = nigeriaConfidence
  } else if (foreignCountry && nigeriaConfidence < 15) {
    detectedCountry   = foreignCountry
    countryConfidence = 60
  }

  return {
    nigeriaConfidence: Math.round(nigeriaConfidence * 100) / 100,
    countryConfidence: Math.round(countryConfidence * 100) / 100,
    detectedCity:      bestCity,
    detectedCountry,
    detectedLanguage,
    locationSignals:   signals,
  }
}

module.exports = { detect }
