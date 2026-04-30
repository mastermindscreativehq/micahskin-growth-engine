'use strict'

const prisma = require('../lib/prisma')
const { sendTelegramToLead } = require('./telegramService')

// Admin-controlled global pause (in-memory; resets on restart — acceptable for operational control)
let globalPaused = false

const BLOCKED_FLOWS = ['academy_locked', 'closed']

// ── Message builders ──────────────────────────────────────────────────────────

function buildQuoteReminder2h(lead) {
  const name = lead.fullName.split(' ')[0]
  return (
    `Hi ${name} 👋\n\n` +
    `Just a reminder — your personalised product plan is ready and waiting.\n\n` +
    `Reply <b>YES</b> to go ahead, or ask if you have any questions.`
  )
}

function buildQuoteReminder24h(lead) {
  const name = lead.fullName.split(' ')[0]
  return (
    `Hi ${name} ⏰\n\n` +
    `Your skincare plan is still available. Clients who start early typically see results within 2–3 weeks.\n\n` +
    `Don't let your skin wait longer than it needs to — reply <b>YES</b> to confirm your order.`
  )
}

function buildQuoteLastCall(lead) {
  const name = lead.fullName.split(' ')[0]
  return (
    `Hi ${name} 🔔 <b>Last notice</b>\n\n` +
    `This is our final reminder about your product plan. ` +
    `If you're no longer interested, just reply <b>STOP</b> and we'll close it out.\n\n` +
    `Otherwise, reply <b>YES</b> to confirm today.`
  )
}

function buildPendingReviewNotice(lead) {
  const name = lead.fullName.split(' ')[0]
  return (
    `Hi ${name} 👋\n\n` +
    `Your product plan is being reviewed by our team. You'll receive it shortly — usually within a few hours.\n\n` +
    `We'll notify you as soon as it's ready.`
  )
}

function buildConsultNudge(lead, nudgeNumber) {
  const name = lead.fullName.split(' ')[0]
  return nudgeNumber === 1
    ? (
      `Hi ${name} 🌿\n\n` +
      `We're still here whenever you're ready to continue your skin consultation. ` +
      `Just reply with your next answer — no rush at all.`
    )
    : (
      `Hi ${name},\n\n` +
      `Still here if you'd like to continue. If you'd rather stop, just reply <b>STOP</b> and I'll leave you be.`
    )
}

function buildDiagnosisNextAction(lead) {
  const name = lead.fullName.split(' ')[0]
  const offer = lead.recommendedNextOffer || 'product'

  if (offer === 'consult') {
    return (
      `Hi ${name} 🔬\n\n` +
      `Based on your skin concern, a deeper analysis could help get you faster results.\n\n` +
      `Reply <b>CONSULT</b> to start your in-depth skin consultation.`
    )
  }
  if (offer === 'academy') {
    return (
      `Hi ${name} 📚\n\n` +
      `Many people with your concern have transformed their skin through a structured education programme.\n\n` +
      `Reply <b>ACADEMY</b> to learn more about our skincare academy.`
    )
  }
  // Default: product
  return (
    `Hi ${name} ✨\n\n` +
    `Your diagnosis is ready — now let's get the right products working on your skin.\n\n` +
    `Reply <b>PRODUCTS</b> and we'll put together a personalised product plan for you.`
  )
}

function buildReEngagement(lead) {
  const name = lead.fullName.split(' ')[0]
  return (
    `Hi ${name} 👋\n\n` +
    `We noticed it's been a while. Your skin journey matters to us and we're still here.\n\n` +
    `Reply whenever you're ready and we'll pick up right where we left off.`
  )
}

// ── Core helpers ──────────────────────────────────────────────────────────────

async function hasFollowUpLog(leadId, followUpType) {
  const count = await prisma.followUpLog.count({ where: { leadId, followUpType } })
  return count > 0
}

async function getFollowUpLogCount(leadId, followUpType) {
  return prisma.followUpLog.count({ where: { leadId, followUpType } })
}

async function recordAndSend(lead, followUpType, message) {
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
        lastFollowUpAt: new Date(),
        followUpCount: { increment: 1 },
      },
    })
    console.log(`[AutoFollowUp] ${followUpType} → ${lead.fullName} (${lead.id})`)
  } catch (err) {
    console.error(`[AutoFollowUp] FAILED ${followUpType} → ${lead.id}:`, err.message)
    // Un-claim so the next cycle can retry
    await prisma.followUpLog.delete({ where: { id: logId } }).catch(() => {})
  }
}

function isSafeToFollowUp(lead) {
  if (globalPaused) return false
  if (lead.followUpStopped) return false
  if (BLOCKED_FLOWS.includes(lead.currentFlow)) return false
  if (!lead.telegramChatId) return false
  return true
}

// ── Rule 1: Product Quote Not Paid ────────────────────────────────────────────
// Sends 3 escalating reminders at 2h / 24h / 48h after the quote was sent.
// Each message fires independently so downtime catch-up works correctly.
// Stop conditions: paymentStatus=paid or currentFlow leaves product_quote_sent.

async function processQuoteFollowUps() {
  const now = new Date()
  const h2  = new Date(now.getTime() -  2 * 60 * 60 * 1000)
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const h48 = new Date(now.getTime() - 48 * 60 * 60 * 1000)

  const leads = await prisma.lead.findMany({
    where: {
      currentFlow:   'product_quote_sent',
      paymentStatus: { not: 'paid' },
      status:        { not: 'closed' },
      telegramChatId: { not: null },
      followUpStopped: false,
    },
    include: {
      quotes: {
        where:   { status: 'sent', paymentStatus: { not: 'paid' } },
        orderBy: { sentAt: 'desc' },
        take: 1,
      },
    },
  })

  for (const lead of leads) {
    if (!isSafeToFollowUp(lead)) continue
    const quote = lead.quotes[0]
    if (!quote?.sentAt) continue

    const sentAt = new Date(quote.sentAt)

    if (sentAt <= h2 && !(await hasFollowUpLog(lead.id, 'quote_reminder_2h')))
      await recordAndSend(lead, 'quote_reminder_2h', buildQuoteReminder2h(lead))

    if (sentAt <= h24 && !(await hasFollowUpLog(lead.id, 'quote_reminder_24h')))
      await recordAndSend(lead, 'quote_reminder_24h', buildQuoteReminder24h(lead))

    if (sentAt <= h48 && !(await hasFollowUpLog(lead.id, 'quote_reminder_48h')))
      await recordAndSend(lead, 'quote_reminder_48h', buildQuoteLastCall(lead))
  }
}

// ── Rule 2: Product Quote Pending Review ─────────────────────────────────────
// Sends exactly one courtesy notice so the lead knows their quote is being processed.

async function processPendingReviewNotices() {
  const leads = await prisma.lead.findMany({
    where: {
      currentFlow:    'product_quote_pending_review',
      status:         { not: 'closed' },
      telegramChatId: { not: null },
      followUpStopped: false,
    },
  })

  for (const lead of leads) {
    if (!isSafeToFollowUp(lead)) continue
    const sent = await hasFollowUpLog(lead.id, 'quote_pending_review_notice')
    if (!sent) await recordAndSend(lead, 'quote_pending_review_notice', buildPendingReviewNotice(lead))
  }
}

// ── Rule 3: Deep Consult Inactive ─────────────────────────────────────────────
// Nudges lead to continue their in-progress consultation after 30 min of silence.
// 2nd nudge requires 60 min of total inactivity. Max 2 nudges per consultation.

async function processConsultNudges() {
  const now = new Date()
  const m30 = new Date(now.getTime() - 30 * 60 * 1000)
  const m60 = new Date(now.getTime() - 60 * 60 * 1000)

  const leads = await prisma.lead.findMany({
    where: {
      currentFlow:    'deep_consult_active',
      status:         { not: 'closed' },
      telegramChatId: { not: null },
      followUpStopped: false,
      // Only nudge if no recent lead message
      OR: [
        { telegramLastMessageAt: { lt: m30 } },
        { telegramLastMessageAt: null, lastInteractionAt: { lt: m30 } },
        { telegramLastMessageAt: null, lastInteractionAt: null, updatedAt: { lt: m30 } },
      ],
      // Only nudge if the consult is still in progress
      deepConsultations: { some: { status: 'in_progress' } },
    },
  })

  for (const lead of leads) {
    if (!isSafeToFollowUp(lead)) continue

    const count = await getFollowUpLogCount(lead.id, 'consult_nudge')
    if (count >= 2) continue

    // Second nudge only after 60 min of inactivity
    if (count === 1) {
      const lastMsg = lead.telegramLastMessageAt || lead.lastInteractionAt
      if (lastMsg && new Date(lastMsg) > m60) continue
    }

    await recordAndSend(lead, 'consult_nudge', buildConsultNudge(lead, count + 1))
  }
}

// ── Rule 4: Diagnosis Sent, No Action After 24h ──────────────────────────────
// After 24h of inactivity following a diagnosis, suggests the best next step
// based on the lead's monetization score (recommendedNextOffer field).

async function processDiagnosisNoAction() {
  const now = new Date()
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const leads = await prisma.lead.findMany({
    where: {
      currentFlow:    'diagnosis_sent',
      status:         { not: 'closed' },
      telegramChatId: { not: null },
      followUpStopped: false,
      OR: [
        { diagnosisSentAt: { lt: h24 } },
        { diagnosisSentAt: null, lastInteractionAt: { lt: h24 } },
      ],
    },
  })

  for (const lead of leads) {
    if (!isSafeToFollowUp(lead)) continue
    const sent = await hasFollowUpLog(lead.id, 'diagnosis_no_action')
    if (!sent) await recordAndSend(lead, 'diagnosis_no_action', buildDiagnosisNextAction(lead))
  }
}

// ── Rule 5: Abandoned Leads (48h no activity) ────────────────────────────────
// Sends a single gentle re-engagement message to Telegram-connected leads
// that have gone completely silent for 48h or more.

async function processAbandonedLeads() {
  const now = new Date()
  const h48 = new Date(now.getTime() - 48 * 60 * 60 * 1000)

  const leads = await prisma.lead.findMany({
    where: {
      telegramStarted: true,
      status:          { not: 'closed' },
      telegramChatId:  { not: null },
      followUpStopped: false,
      // Exclude hard-blocked flows
      NOT: { currentFlow: { in: ['academy_locked', 'closed'] } },
      OR: [
        { lastInteractionAt: { lt: h48 } },
        { lastInteractionAt: null, createdAt: { lt: h48 } },
      ],
    },
  })

  for (const lead of leads) {
    if (!isSafeToFollowUp(lead)) continue
    const sent = await hasFollowUpLog(lead.id, 're_engagement')
    if (!sent) await recordAndSend(lead, 're_engagement', buildReEngagement(lead))
  }
}

// ── Due-count for Command Center ──────────────────────────────────────────────

async function countFollowUpsDue() {
  const now = new Date()
  const h2  = new Date(now.getTime() -  2 * 60 * 60 * 1000)
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const h48 = new Date(now.getTime() - 48 * 60 * 60 * 1000)
  const m30 = new Date(now.getTime() - 30 * 60 * 1000)

  const safeBase = {
    followUpStopped: false,
    telegramChatId:  { not: null },
    status:          { not: 'closed' },
  }

  const [quoteDue, pendingDue, consultDue, diagnosisDue, abandonedDue] = await Promise.all([
    prisma.lead.count({
      where: {
        ...safeBase,
        currentFlow:   'product_quote_sent',
        paymentStatus: { not: 'paid' },
        quotes: { some: { status: 'sent', paymentStatus: { not: 'paid' }, sentAt: { lt: h2 } } },
      },
    }),
    prisma.lead.count({
      where: {
        ...safeBase,
        currentFlow: 'product_quote_pending_review',
        followUpLogs: { none: { followUpType: 'quote_pending_review_notice' } },
      },
    }),
    prisma.lead.count({
      where: {
        ...safeBase,
        currentFlow: 'deep_consult_active',
        deepConsultations: { some: { status: 'in_progress' } },
        followUpLogs: { none: { followUpType: 'consult_nudge' } },
        OR: [
          { telegramLastMessageAt: { lt: m30 } },
          { telegramLastMessageAt: null, lastInteractionAt: { lt: m30 } },
        ],
      },
    }),
    prisma.lead.count({
      where: {
        ...safeBase,
        currentFlow: 'diagnosis_sent',
        followUpLogs: { none: { followUpType: 'diagnosis_no_action' } },
        OR: [
          { diagnosisSentAt: { lt: h24 } },
          { diagnosisSentAt: null, lastInteractionAt: { lt: h24 } },
        ],
      },
    }),
    prisma.lead.count({
      where: {
        ...safeBase,
        telegramStarted: true,
        NOT: { currentFlow: { in: ['academy_locked', 'closed'] } },
        followUpLogs: { none: { followUpType: 're_engagement' } },
        OR: [
          { lastInteractionAt: { lt: h48 } },
          { lastInteractionAt: null, createdAt: { lt: h48 } },
        ],
      },
    }),
  ])

  return {
    quoteDue,
    pendingDue,
    consultDue,
    diagnosisDue,
    abandonedDue,
    total: quoteDue + pendingDue + consultDue + diagnosisDue + abandonedDue,
    paused: globalPaused,
  }
}

// ── Main poller ───────────────────────────────────────────────────────────────

async function processAutoFollowUps() {
  if (globalPaused) return
  try {
    await processQuoteFollowUps()
    await processPendingReviewNotices()
    await processConsultNudges()
    await processDiagnosisNoAction()
    await processAbandonedLeads()
  } catch (err) {
    console.error('[AutoFollowUp] Unhandled error:', err.message)
  }
}

// ── Admin controls ────────────────────────────────────────────────────────────

function pauseFollowUps()    { globalPaused = true;  console.log('[AutoFollowUp] Paused by admin') }
function resumeFollowUps()   { globalPaused = false; console.log('[AutoFollowUp] Resumed by admin') }
function isFollowUpsPaused() { return globalPaused }

// ── Boot ──────────────────────────────────────────────────────────────────────

function startAutoFollowUpService() {
  console.log('✅ Auto Follow-Up Conversion Engine started (runs every 5 min)')
  processAutoFollowUps()
  setInterval(processAutoFollowUps, 5 * 60 * 1000)
}

module.exports = {
  startAutoFollowUpService,
  processAutoFollowUps,
  countFollowUpsDue,
  pauseFollowUps,
  resumeFollowUps,
  isFollowUpsPaused,
}
