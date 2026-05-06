'use strict'

/**
 * mceFollowUpService.js — Phase 34 (MCE)
 *
 * Multi-stage objection-aware follow-up engine. COMPLEMENTS (does not replace)
 * autoFollowUpService.js — that one runs the post-quote / post-diagnosis
 * Telegram ladder. THIS service runs the post-CTA-touch ladder for leads
 * who have engaged with the WhatsApp bridge / a routed offer but have not
 * yet replied OR have replied with an objection.
 *
 * Ladder (per lead):
 *   1h_no_reply       — gentle nudge after 1h silence following whatsapp_click
 *   6h_objection      — variant by objection type (pricing/trust/timing/skepticism)
 *   24h_re_engage     — broader re-engage with city-localised opener
 *   3d_final          — last-call message; sets ignoredFollowupCount += 1
 *
 * Honours the same Reply Governor as autoFollowUpService:
 *   • botMutedUntil
 *   • followupSuppressed
 *   • currentFlow ∈ {academy_locked, closed}
 *   • status = closed
 *   • lead.followUpStopped
 *
 * Dedup is via FollowUpLog with new mce_* followUpType values so it never
 * collides with Phase-31 logs.
 *
 * Channel selection:
 *   • Prefer Telegram if telegramChatId is set (we have a bot relationship)
 *   • Otherwise, no automated send — lead is dashboard-only until they
 *     either click the wa.me CTA (which moves them to a real channel) or
 *     reply on Telegram. We never DM cold WhatsApp numbers without their
 *     having opened a session via wa.me first.
 */

const prisma = require('../../lib/prisma')
const { sendTelegramToLead } = require('../telegramService')
const { localize } = require('./nigerianCopyLocalizer')

let globalPaused = false

const BLOCKED_FLOWS = ['academy_locked', 'closed']

const FOLLOWUP_TYPES = {
  ONE_HOUR:    'mce_1h_no_reply',
  SIX_HOUR:    'mce_6h_objection',
  TWENTY_FOUR: 'mce_24h_re_engage',
  THREE_DAY:   'mce_3d_final',
}

// ── Safety helpers ────────────────────────────────────────────────────────────

function isSafeToFollowUp(lead) {
  if (globalPaused) return false
  if (lead.followUpStopped) return false
  if (lead.status === 'closed') return false
  if (BLOCKED_FLOWS.includes(lead.currentFlow)) return false
  if (lead.followupSuppressed) return false
  if (lead.botMutedUntil && new Date(lead.botMutedUntil) > new Date()) return false
  if (!lead.telegramChatId) return false  // Telegram-only for now
  return true
}

async function hasFollowUpLog(leadId, followUpType) {
  const count = await prisma.followUpLog.count({ where: { leadId, followUpType } })
  return count > 0
}

async function recordAndSend(lead, followUpType, message, variant = null) {
  let logId
  try {
    const log = await prisma.followUpLog.create({
      data: { leadId: lead.id, followUpType, message },
    })
    logId = log.id
  } catch {
    return // Unique-constraint race; another process claimed it
  }

  try {
    await sendTelegramToLead(lead.id, message)
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        mceLastFollowUpType: followUpType,
        mceLastFollowUpAt:   new Date(),
        lastFollowUpAt:      new Date(),
        followUpCount:       { increment: 1 },
        ...(followUpType === FOLLOWUP_TYPES.THREE_DAY
          ? { ignoredFollowupCount: { increment: 1 } }
          : {}),
      },
    })

    // Write timeline event (best-effort)
    prisma.leadTimeline.create({
      data: {
        leadId:     lead.id,
        eventType:  'followup_sent',
        channel:    'telegram',
        funnelType: lead.funnelType || null,
        payload:    { followUpType, variant },
      },
    }).catch(() => {})

    if (variant) {
      console.log(`[MCE/FollowUp] objection-aware leadId=${lead.id} variant=${variant}`)
    }
    console.log(
      `[MCE/FollowUp] sent leadId=${lead.id} type=${followUpType} via=telegram` +
      ` funnel=${lead.funnelType || '—'}`,
    )
  } catch (err) {
    console.error(`[MCE/FollowUp] FAILED ${followUpType} → ${lead.id}:`, err.message)
    await prisma.followUpLog.delete({ where: { id: logId } }).catch(() => {})
  }
}

// ── Latest objection lookup ──────────────────────────────────────────────────

async function getLatestObjection(leadId) {
  const last = await prisma.leadTimeline.findFirst({
    where:   { leadId, eventType: 'objection' },
    orderBy: { createdAt: 'desc' },
  })
  return last?.payload?.type || null
}

// ── Message builders ─────────────────────────────────────────────────────────

function _firstName(lead) { return (lead.fullName || '').split(' ')[0] || 'there' }

function build1hNoReply(lead) {
  const overlay = localize({
    lead,
    city: lead.deliveryCity || lead.telegramArea || null,
    urgency: lead.urgencyLevel || 'low',
    budgetSignal: lead.budgetSignal || 'none',
  })
  return (
    `${overlay.opener}\n\n` +
    `Hi ${_firstName(lead)} — just checking in. ` +
    `Did you get a moment to look at the WhatsApp link I shared earlier?\n\n` +
    `Reply here whenever you're ready, no pressure.`
  )
}

function build6hObjection(lead, objectionType) {
  const name = _firstName(lead)
  switch (objectionType) {
    case 'pricing':
      return (
        `Hey ${name} — I hear you on the price. \n\n` +
        `Two things worth saying:\n` +
        `• You don't pay for everything at once — we map a routine to YOUR budget\n` +
        `• Most clients spend more on products that don't work than on the right ones\n\n` +
        `Tell me a comfortable starting amount and I'll tailor the plan around it.`
      )
    case 'trust':
      return (
        `Hi ${name} 🌿 — totally fair to want proof first.\n\n` +
        `We're a fully Nigeria-based skincare team. Real before/afters from real Nigerian women, ` +
        `not international filters. I can share specific results for your concern — just let me know which.`
      )
    case 'timing':
      return (
        `No rush ${name} 🙏 — your skin will still be there next month.\n\n` +
        `One thing to flag: most concerns take 4–6 weeks of consistent routine to shift. ` +
        `So if there's a date you're working towards, sooner is better. Reply when you're ready.`
      )
    case 'skepticism':
      return (
        `${name}, fair. You've probably tried things that didn't work — most people have.\n\n` +
        `What we do differently: a routine matched to YOUR concern, your skin type, your budget. ` +
        `Not a generic shelf product. Want me to walk you through the assessment? It's free.`
      )
    default:
      return (
        `Hey ${name} — just following up. \n\n` +
        `Whenever you're ready to talk through your skin concern, I'm here. ` +
        `If something specific is holding you back, tell me — I'd rather sort it out properly.`
      )
  }
}

function build24hReEngage(lead) {
  const overlay = localize({
    lead,
    city: lead.deliveryCity || lead.telegramArea || null,
    urgency: lead.urgencyLevel || 'low',
    budgetSignal: lead.budgetSignal || 'none',
  })
  const name = _firstName(lead)
  return (
    `${overlay.opener}\n\n` +
    `${name}, popping back in 👋\n\n` +
    `Your skin concern is fixable, but it needs a real plan — not random products. ` +
    `${overlay.trustLine}\n\n` +
    `If now isn't right, just say so and I'll give you space.`
  )
}

function build3dFinal(lead) {
  const name = _firstName(lead)
  return (
    `Last note from me, ${name} 🙏\n\n` +
    `I won't keep messaging — your inbox is precious. ` +
    `If you'd like to come back to this any time in the future, just send a message and we'll pick up.\n\n` +
    `Wishing you the best on your skin journey ✨`
  )
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/**
 * Rule 1: 1h after a whatsapp_click with no inbound reply since.
 */
async function process1hNoReply() {
  const now = new Date()
  const h1  = new Date(now.getTime() - 1 * 60 * 60 * 1000)
  const h2  = new Date(now.getTime() - 2 * 60 * 60 * 1000)

  const leads = await prisma.lead.findMany({
    where: {
      telegramChatId:  { not: null },
      followUpStopped: false,
      status:          { not: 'closed' },
      whatsappFirstClickAt: { gte: h2, lte: h1 },
      followUpLogs: {
        none: { followUpType: FOLLOWUP_TYPES.ONE_HOUR },
      },
    },
    take: 50,
  })

  for (const lead of leads) {
    if (!isSafeToFollowUp(lead)) {
      console.log(`[MCE/FollowUp] skipped leadId=${lead.id} reason=governor`)
      continue
    }
    // No inbound reply since the click
    if (lead.telegramLastMessageAt && new Date(lead.telegramLastMessageAt) >= new Date(lead.whatsappFirstClickAt)) {
      continue
    }
    await recordAndSend(lead, FOLLOWUP_TYPES.ONE_HOUR, build1hNoReply(lead))
  }
}

/**
 * Rule 2: 6h after the last objection event with no resolution since.
 */
async function process6hObjection() {
  const now = new Date()
  const h6  = new Date(now.getTime() - 6 * 60 * 60 * 1000)
  const h12 = new Date(now.getTime() - 12 * 60 * 60 * 1000)

  // Find leads with a recent objection that we haven't already 6h-followed-up on.
  const leadsWithObjections = await prisma.leadTimeline.findMany({
    where: {
      eventType: 'objection',
      createdAt: { gte: h12, lte: h6 },
    },
    orderBy: { createdAt: 'desc' },
    distinct: ['leadId'],
    take: 100,
    include: { lead: true },
  })

  for (const ev of leadsWithObjections) {
    const lead = ev.lead
    if (!lead) continue
    if (!isSafeToFollowUp(lead)) {
      console.log(`[MCE/FollowUp] skipped leadId=${lead.id} reason=governor`)
      continue
    }
    if (await hasFollowUpLog(lead.id, FOLLOWUP_TYPES.SIX_HOUR)) continue
    // Skip if a more recent inbound reply exists post the objection
    if (lead.telegramLastMessageAt && new Date(lead.telegramLastMessageAt) > new Date(ev.createdAt)) {
      continue
    }
    const objectionType = ev.payload?.type || null
    await recordAndSend(lead, FOLLOWUP_TYPES.SIX_HOUR, build6hObjection(lead, objectionType), `${objectionType || 'general'}_objection`)
  }
}

/**
 * Rule 3: 24h after the original CTA click for leads who never replied.
 */
async function process24hReEngage() {
  const now = new Date()
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const h36 = new Date(now.getTime() - 36 * 60 * 60 * 1000)

  const leads = await prisma.lead.findMany({
    where: {
      telegramChatId:  { not: null },
      followUpStopped: false,
      status:          { not: 'closed' },
      whatsappFirstClickAt: { gte: h36, lte: h24 },
      followUpLogs: { none: { followUpType: FOLLOWUP_TYPES.TWENTY_FOUR } },
    },
    take: 50,
  })

  for (const lead of leads) {
    if (!isSafeToFollowUp(lead)) continue
    if (lead.telegramLastMessageAt && new Date(lead.telegramLastMessageAt) >= new Date(lead.whatsappFirstClickAt)) continue
    await recordAndSend(lead, FOLLOWUP_TYPES.TWENTY_FOUR, build24hReEngage(lead))
  }
}

/**
 * Rule 4: 3d after the original CTA click — final message, increment ignored counter.
 */
async function process3dFinal() {
  const now = new Date()
  const d3  = new Date(now.getTime() - 3  * 24 * 60 * 60 * 1000)
  const d4  = new Date(now.getTime() - 4  * 24 * 60 * 60 * 1000)

  const leads = await prisma.lead.findMany({
    where: {
      telegramChatId:  { not: null },
      followUpStopped: false,
      status:          { not: 'closed' },
      whatsappFirstClickAt: { gte: d4, lte: d3 },
      followUpLogs: { none: { followUpType: FOLLOWUP_TYPES.THREE_DAY } },
    },
    take: 50,
  })

  for (const lead of leads) {
    if (!isSafeToFollowUp(lead)) continue
    if (lead.telegramLastMessageAt && new Date(lead.telegramLastMessageAt) >= new Date(lead.whatsappFirstClickAt)) continue
    await recordAndSend(lead, FOLLOWUP_TYPES.THREE_DAY, build3dFinal(lead))
  }
}

// ── Main poller ──────────────────────────────────────────────────────────────

async function processMceFollowUps() {
  if (globalPaused) return
  try {
    await process1hNoReply()
    await process6hObjection()
    await process24hReEngage()
    await process3dFinal()
  } catch (err) {
    console.error('[MCE/FollowUp] Unhandled error:', err.message)
  }
}

// ── Admin controls ───────────────────────────────────────────────────────────

function pauseMceFollowUps()    { globalPaused = true;  console.log('[MCE/FollowUp] Paused by admin') }
function resumeMceFollowUps()   { globalPaused = false; console.log('[MCE/FollowUp] Resumed by admin') }
function isMceFollowUpsPaused() { return globalPaused }

// ── Due-count for Command Center ─────────────────────────────────────────────

async function countMceDue() {
  const now = new Date()
  const h1  = new Date(now.getTime() - 1 * 60 * 60 * 1000)
  const h2  = new Date(now.getTime() - 2 * 60 * 60 * 1000)
  const h6  = new Date(now.getTime() - 6 * 60 * 60 * 1000)
  const h12 = new Date(now.getTime() - 12 * 60 * 60 * 1000)
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const h36 = new Date(now.getTime() - 36 * 60 * 60 * 1000)
  const d3  = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
  const d4  = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000)

  const safe = {
    telegramChatId:  { not: null },
    followUpStopped: false,
    status:          { not: 'closed' },
    followupSuppressed: false,
  }

  try {
    const [oneHourDue, twentyFourDue, threeDayDue, objectionsRecent] = await Promise.all([
      prisma.lead.count({
        where: {
          ...safe,
          whatsappFirstClickAt: { gte: h2, lte: h1 },
          followUpLogs: { none: { followUpType: FOLLOWUP_TYPES.ONE_HOUR } },
        },
      }),
      prisma.lead.count({
        where: {
          ...safe,
          whatsappFirstClickAt: { gte: h36, lte: h24 },
          followUpLogs: { none: { followUpType: FOLLOWUP_TYPES.TWENTY_FOUR } },
        },
      }),
      prisma.lead.count({
        where: {
          ...safe,
          whatsappFirstClickAt: { gte: d4, lte: d3 },
          followUpLogs: { none: { followUpType: FOLLOWUP_TYPES.THREE_DAY } },
        },
      }),
      prisma.leadTimeline.count({
        where: { eventType: 'objection', createdAt: { gte: h12, lte: h6 } },
      }),
    ])

    return {
      oneHourDue,
      sixHourObjectionDue: objectionsRecent,
      twentyFourDue,
      threeDayDue,
      total:               oneHourDue + objectionsRecent + twentyFourDue + threeDayDue,
      paused:              globalPaused,
    }
  } catch (err) {
    console.error('[MCE/FollowUp] countMceDue failed:', err.message)
    return {
      oneHourDue: 0, sixHourObjectionDue: 0, twentyFourDue: 0, threeDayDue: 0,
      total: 0, paused: globalPaused, error: err.message,
    }
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────

function startMceFollowUpService() {
  console.log('✅ MCE Follow-Up Engine started (runs every 5 min)')
  // First pass on boot — catches anything missed during downtime
  processMceFollowUps()
  setInterval(processMceFollowUps, 5 * 60 * 1000)
}

module.exports = {
  startMceFollowUpService,
  processMceFollowUps,
  countMceDue,
  pauseMceFollowUps,
  resumeMceFollowUps,
  isMceFollowUpsPaused,
  FOLLOWUP_TYPES,
}
