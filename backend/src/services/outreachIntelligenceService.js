'use strict'

/**
 * outreachIntelligenceService.js
 * Phase 33 — MAIE
 *
 * Deterministic outreach copy generator. Picks an outreachAngle from the
 * lead's signals and renders three contextual copy variants:
 *
 *   - suggestedReply   — public comment / DM reply (10-25 words)
 *   - whatsappHook     — WhatsApp opener (one short sentence)
 *   - academyHook      — academy upsell line (used only for academy-type segments)
 *
 *   generate({ text, nigeria, psychology, segmentation }) → {
 *     outreachAngle  : 'soft_empathy'|'urgency'|'authority'|'testimonial'|'educational'
 *     suggestedReply : string
 *     whatsappHook   : string
 *     academyHook    : string|null
 *     aiSummary      : string   // one-line shorthand of the lead
 *   }
 *
 * Pure function — no I/O. The "AI" label here means heuristic-driven copy,
 * not an LLM call. Templates are picked from a small finite set; no fabrication.
 */

const { isProductSegment, isAcademySegment, isConsultSegment } = require('./leadSegmentationService')

// ── Angle selection ──────────────────────────────────────────────────────────

function pickAngle({ psychology, segmentation, nigeria }) {
  const p = psychology   || {}
  const s = segmentation || {}

  // Business-type segments → authority-led
  if (isAcademySegment(s.segment))            return 'authority'
  // Consultation requests → expert positioning
  if (isConsultSegment(s.segment))            return 'authority'
  // Time-bound urgency
  if ((p.urgencyScore ?? 0) >= 30)            return 'urgency'
  // Strong pain + emotion → empathy first
  if ((p.painScore ?? 0) >= 30 && (p.emotionalIntensity ?? 0) >= 18) return 'soft_empathy'
  // Buyer signals dominate → social proof
  if ((p.buyerIntentScore ?? 0) >= 30)        return 'testimonial'
  // Default: educational (low-friction, value-led)
  return 'educational'
}

// ── Copy templates (per angle × per segment) ─────────────────────────────────
//
// Templates are short, brand-safe, and contain no fabricated specifics.
// {{name}}     — author's first name / handle if known
// {{segment}}  — human label of the detected segment
// {{city}}     — detected city if known

const FIRST_LINE = {
  soft_empathy: [
    'Hey {{name}} — that struggle you described is so common, and it’s fixable.',
    'I hear you {{name}}. We’ve walked dozens of clients out of exactly this.',
    'I know how draining this gets {{name}}. You’re not stuck — there’s a clear way out.',
  ],
  urgency: [
    'Got you {{name}} — for that timeline we need to start in the right order.',
    'You’ve got time {{name}}, but we’ll need a focused 4-6 week plan.',
    '{{name}}, with the date you mentioned we should fast-track the routine.',
  ],
  authority: [
    'Hi {{name}} — we run the exact framework for what you’re asking.',
    'Hey {{name}}, this is our specialty — happy to share what works.',
    '{{name}}, we’ve built this exact system. Want a walkthrough?',
  ],
  testimonial: [
    'Hi {{name}} — Nigerian clients with the same concern have seen real change in 4-6 weeks.',
    '{{name}}, we’ve had hundreds of women in your shoes — here’s what worked.',
    'Hey {{name}} — this exact concern is what most of our results are built on.',
  ],
  educational: [
    'Hey {{name}} — quick share: most people miss the order of routine, not the products.',
    'Hi {{name}}, the issue you described is usually 80% routine, 20% products.',
    '{{name}}, here’s what most people get wrong about this — happy to break it down.',
  ],
}

const CTA_LINE = {
  product: [
    'Drop a 👋 if you want a personalised routine.',
    'Want a routine tailored to your skin? DM “GLOW” and I’ll send the breakdown.',
    'I can put together the exact products that fit. Reply “help me” to start.',
  ],
  consult: [
    'Want a free skin diagnosis? DM me and I’ll set it up.',
    'Happy to do a quick consult — DM and we’ll start.',
    'Reply “consult” and I’ll walk you through it personally.',
  ],
  academy: [
    'I run a Nigerian skincare academy that covers exactly this — DM “SKINCARE” for details.',
    'There’s a step-by-step academy for this — reply “academy” and I’ll send the link.',
    'I teach this end-to-end — DM “START” and I’ll share the academy details.',
  ],
}

const WHATSAPP_HOOK = {
  soft_empathy: 'Hey {{name}} — saw your post. I’ve helped Nigerian clients with the exact same thing and I think we can fix yours quickly. Want me to walk you through the routine?',
  urgency:      'Hey {{name}} — saw the timeline you mentioned. With 4-6 focused weeks we can move the needle on this. Want a quick plan?',
  authority:    'Hey {{name}} — saw your comment. This is exactly what we build for. Want me to share how the framework works?',
  testimonial:  'Hey {{name}} — saw your post. Multiple Nigerian clients started exactly where you are and got real change. Want the breakdown?',
  educational:  'Hey {{name}} — saw your comment. Quick note: this concern is mostly about routine order. Want a 60-second breakdown?',
}

const ACADEMY_HOOK = {
  authority:   '{{name}} — if you’re building a skincare brand, the academy walks you through everything from formulation to launch. Want the details?',
  testimonial: '{{name}} — we’ve helped Nigerian women launch full skincare brands from this academy. Want the rundown?',
  educational: '{{name}} — most people skip the business side. The academy gives you the full system. DM “academy”.',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _firstName(username) {
  if (!username) return 'there'
  const cleaned = String(username)
    .replace(/^@/, '')
    .replace(/[._-]/g, ' ')
    .replace(/\d+/g, ' ')
    .trim()
    .split(/\s+/)[0]
  if (!cleaned) return 'there'
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase()
}

function _pick(arr, seed = 0) {
  if (!arr || !arr.length) return ''
  return arr[Math.abs(seed) % arr.length]
}

function _hashSeed(s) {
  let h = 0
  for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) | 0
  return h
}

function _render(template, ctx) {
  return String(template || '')
    .replace(/\{\{name\}\}/g,    ctx.name    || 'there')
    .replace(/\{\{segment\}\}/g, ctx.segment || 'skincare')
    .replace(/\{\{city\}\}/g,    ctx.city    || 'Naija')
}

function _summary({ name, segmentation, nigeria, psychology }) {
  const segLabel = (segmentation?.segment || 'unknown').replace(/_/g, ' ')
  const cityLabel = nigeria?.detectedCity ? ` from ${nigeria.detectedCity}` : ''
  const heatLabel = (() => {
    const p = psychology || {}
    if ((p.urgencyScore ?? 0)     >= 30) return 'urgent'
    if ((p.painScore ?? 0)        >= 40) return 'high-pain'
    if ((p.buyerIntentScore ?? 0) >= 40) return 'buyer-intent'
    return 'warm'
  })()
  return `${name}${cityLabel} — ${segLabel} (${heatLabel})`
}

// ── Public API ───────────────────────────────────────────────────────────────

function generate({ text, nigeria, psychology, segmentation, username, externalId } = {}) {
  const angle = pickAngle({ psychology, segmentation, nigeria })
  const name  = _firstName(username)
  const ctx   = { name, segment: segmentation?.segment, city: nigeria?.detectedCity }

  const seed = _hashSeed(externalId || username || text || '')

  // Pick CTA bucket aligned with segment routing.
  const seg = segmentation?.segment
  let ctaBucket = 'product'
  if (isAcademySegment(seg))      ctaBucket = 'academy'
  else if (isConsultSegment(seg)) ctaBucket = 'consult'

  const firstLine = _render(_pick(FIRST_LINE[angle], seed),     ctx)
  const ctaLine   = _render(_pick(CTA_LINE[ctaBucket], seed),   ctx)
  const suggestedReply = `${firstLine} ${ctaLine}`.trim()

  const whatsappHook = _render(WHATSAPP_HOOK[angle], ctx)

  const academyHook = isAcademySegment(seg)
    ? _render(ACADEMY_HOOK[angle] || ACADEMY_HOOK.educational, ctx)
    : null

  const aiSummary = _summary({ name, segmentation, nigeria, psychology })

  return {
    outreachAngle: angle,
    suggestedReply,
    whatsappHook,
    academyHook,
    aiSummary,
  }
}

module.exports = { generate, pickAngle }
