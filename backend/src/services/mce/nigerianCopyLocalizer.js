'use strict'

/**
 * nigerianCopyLocalizer.js — Phase 34 (MCE)
 *
 * Layered city × angle copy overlays for Nigerian leads. Pure function,
 * no I/O. Returns localised opening lines that overlay on top of the
 * outreachIntelligence base copy. Falls back to a generic Nigerian opener
 * when city is unknown.
 *
 * Cities: Lagos, Abuja, Port Harcourt, Ibadan, Lekki, Benin, Enugu
 *
 * Slang variants are kept brand-safe: light, warm, never patronising.
 */

const CITY_OPENERS = {
  Lagos: [
    'Lagos love 💛 — your skin journey starts here.',
    'For my Lagos sis — clear skin without the stress.',
    'From one Lagosian to another — let’s sort this skin out properly.',
  ],
  Abuja: [
    'Abuja ✨ — you deserve skincare that actually works.',
    'For our Abuja queen — let’s map a routine that fits your schedule.',
    'Capital city skin, capital city results. Let’s build it.',
  ],
  'Port Harcourt': [
    'PH girlies, this one is for you 💚',
    'Port Harcourt humidity is no joke — let’s get a routine that holds up.',
    'For my PH lady — soft skin in this weather is possible.',
  ],
  Ibadan: [
    'Ibadan 🌿 — calm skin, calm mind.',
    'For our Ibadan gem — gentle routine, real results.',
    'Ibadan beauty — your glow up starts now.',
  ],
  Lekki: [
    'Lekki babe — your skin is about to match the lifestyle 💎',
    'For our Lekki queen — premium results, premium routine.',
    'Lekki sun is real — let’s give your skin the protection it deserves.',
  ],
  Benin: [
    'Benin City ✨ — clear skin is loading.',
    'For our Benin sister — proper routine, proper results.',
  ],
  Enugu: [
    'Enugu beauty 🌸 — let’s sort this skin out properly.',
    'For our Enugu lady — gentle products, real change.',
  ],
}

const GENERIC_NG_OPENERS = [
  'Naija sis — your skin deserves better. Let’s do this properly 💛',
  'For my Nigerian queen — clear skin is coming.',
  'Sis, breathe. We’ve walked dozens of women out of exactly this concern. ✨',
  'Naija babe — gentle, real, proven. That’s what we do here.',
]

const TRUST_LINES = [
  'We’re fully Nigeria-based — no shipping wahala, no fake products.',
  'Real Nigerian women, real before/after results — not international filters.',
  'Built for Nigerian skin in Nigerian climate. That part matters.',
]

const URGENCY_LINES_NG = [
  'For event timelines, we always start the routine 4–6 weeks ahead.',
  'Owambe season is no joke — let’s start now, glow on time.',
  'You don’t have time to keep guessing. Let’s lock in a real plan.',
]

const PAY_LANGUAGE_NG = {
  weak:   'And we have flexible options — no pressure to do everything at once.',
  none:   'Tell me what works for your budget and we’ll match the routine to it.',
  strong: 'You’ll get full pricing upfront — no surprise charges.',
}

function _pick(arr, seed) {
  if (!arr || arr.length === 0) return ''
  const i = Math.abs(seed || 0) % arr.length
  return arr[i]
}

function _seedFromLead(lead) {
  // Stable per-lead seed so the same person sees the same variant on repeat
  // generations — avoids the disorientation of rotating openers.
  const id = lead?.id || ''
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return hash
}

/**
 * Build the localiser overlay block.
 *
 *   localize({ lead, city, urgency, budgetSignal }) →
 *     { opener: string, trustLine: string, urgencyLine: string|null, payLine: string }
 *
 * @param {object} args
 * @param {object} args.lead          Lead record
 * @param {string} [args.city]        Detected city
 * @param {string} [args.urgency]     'high' | 'medium' | 'low'
 * @param {string} [args.budgetSignal]'strong' | 'weak' | 'none'
 */
function localize({ lead, city = null, urgency = 'low', budgetSignal = 'none' }) {
  const seed = _seedFromLead(lead)
  const list = (city && CITY_OPENERS[city]) ? CITY_OPENERS[city] : GENERIC_NG_OPENERS
  const opener = _pick(list, seed)
  const trustLine = _pick(TRUST_LINES, seed >> 1)
  const urgencyLine = urgency === 'high' ? _pick(URGENCY_LINES_NG, seed >> 2) : null
  const payLine = PAY_LANGUAGE_NG[budgetSignal] || PAY_LANGUAGE_NG.none

  console.log(
    `[MCE/Localizer] applied city=${city || 'generic_ng'}` +
    ` urgency=${urgency} budget=${budgetSignal} leadId=${lead?.id || '—'}`,
  )

  return {
    opener,
    trustLine,
    urgencyLine,
    payLine,
  }
}

module.exports = { localize, CITY_OPENERS }
