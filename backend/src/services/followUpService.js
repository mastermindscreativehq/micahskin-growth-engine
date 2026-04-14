'use strict'

const prisma = require('../lib/prisma')
const { sendTelegramToUser } = require('./telegramService')

// ── Message builders ──────────────────────────────────────────────────────────

/**
 * T+1h — Sends the full diagnosis + personalised routine.
 * Uses the diagnosis/routine stored in the Lead record after intake_complete.
 */
function buildDiagnosisMessage(lead) {
  const firstName = lead.fullName.split(' ')[0]
  const diag = lead.diagnosis   // { text: string, notes: string[] }
  const routine = lead.routine  // { morning: string[], night: string[] }

  if (!diag || !routine) return null

  const diagText  = diag.text || ''
  const notes     = Array.isArray(diag.notes) ? diag.notes : []
  const morning   = Array.isArray(routine.morning) ? routine.morning : []
  const night     = Array.isArray(routine.night) ? routine.night : []

  const morningLines = morning.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const nightLines   = night.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const notesBlock   = notes.length > 0
    ? `\n\n<b>Important notes for your skin:</b>\n` + notes.map(n => `• ${n}`).join('\n')
    : ''

  return (
    `Hi ${firstName} 🌿\n\n` +
    `Based on everything you shared, here is what is happening with your skin:\n\n` +
    `<b>${diagText}</b>\n\n` +
    `Here is your personalised routine:\n\n` +
    `<b>Morning</b>\n${morningLines}\n\n` +
    `<b>Night</b>\n${nightLines}` +
    notesBlock +
    `\n\nFollow this consistently for 2–3 weeks and monitor your skin's response. ` +
    `Reply here if you have any questions — I will help you adjust.`
  )
}

/**
 * T+24h — Gentle check-in after the first day of the new routine.
 */
function buildCheckInMessage(lead) {
  const firstName = lead.fullName.split(' ')[0]
  return (
    `Hi ${firstName} 👋\n\n` +
    `Just checking in — how is your skin responding so far?\n\n` +
    `Any tightness, irritation, improvement, or questions about the routine? ` +
    `Reply here and I will help you adjust for your skin's reaction.`
  )
}

/**
 * T+3 days — Targeted product recommendation for faster results.
 */
function buildProductRecoMessage(lead) {
  const firstName = lead.fullName.split(' ')[0]
  const products  = lead.products?.recommendations || []

  if (products.length === 0) return null

  const lines = products.map((p, i) => `${i + 1}. ${p}`).join('\n')

  return (
    `Hi ${firstName} ✨\n\n` +
    `For faster, more targeted results with your skin concern, here are the specific products our team recommends:\n\n` +
    `${lines}\n\n` +
    `These are matched to your exact skin type and concern. ` +
    `Reply if you'd like guidance on where to get them or how to work them into your routine.`
  )
}

// ── Send workers ──────────────────────────────────────────────────────────────

/**
 * Sends diagnosis messages to all leads whose T+1h window has arrived.
 * Uses atomic DB claim to prevent duplicate sends across concurrent runs.
 */
async function sendDiagnosisMessages() {
  const now = new Date()

  const leads = await prisma.lead.findMany({
    where: {
      diagnosisSendAfter: { lte: now },
      diagnosisSent: false,
      telegramChatId: { not: null },
      telegramStage: 'intake_complete',
    },
  })

  for (const lead of leads) {
    // Atomically claim this record
    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, diagnosisSent: false },
      data:  { diagnosisSent: true },
    })
    if (claimed.count === 0) continue // another process got there first

    try {
      const msg = buildDiagnosisMessage(lead)
      if (!msg) {
        console.warn(`[FollowUp] No diagnosis data for lead ${lead.id} — skipping diagnosis send`)
        continue
      }

      await sendTelegramToUser(lead.telegramChatId, msg)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  { diagnosisSentAt: new Date() },
      })
      console.log(`[FollowUp] Diagnosis sent → ${lead.fullName} (${lead.id})`)

    } catch (err) {
      console.error(`[FollowUp] Diagnosis send FAILED for ${lead.id}:`, err.message)
      // Un-claim so the next tick retries
      await prisma.lead.update({
        where: { id: lead.id },
        data:  { diagnosisSent: false },
      }).catch(() => {})
    }
  }
}

/**
 * Sends 24h check-in messages.
 * Only fires after the diagnosis has already been confirmed sent.
 */
async function sendCheckIns() {
  const now = new Date()

  const leads = await prisma.lead.findMany({
    where: {
      checkInSendAfter: { lte: now },
      checkInSent: false,
      diagnosisSent: true,      // only check in after diagnosis was delivered
      telegramChatId: { not: null },
      telegramStage: 'intake_complete',
    },
  })

  for (const lead of leads) {
    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, checkInSent: false },
      data:  { checkInSent: true },
    })
    if (claimed.count === 0) continue

    try {
      const msg = buildCheckInMessage(lead)
      await sendTelegramToUser(lead.telegramChatId, msg)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  { checkInSentAt: new Date() },
      })
      console.log(`[FollowUp] Check-in sent → ${lead.fullName} (${lead.id})`)

    } catch (err) {
      console.error(`[FollowUp] Check-in FAILED for ${lead.id}:`, err.message)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  { checkInSent: false },
      }).catch(() => {})
    }
  }
}

/**
 * Sends T+3 day product recommendation messages.
 * Only fires after the diagnosis has been confirmed sent.
 */
async function sendProductRecos() {
  const now = new Date()

  const leads = await prisma.lead.findMany({
    where: {
      productRecoSendAfter: { lte: now },
      productRecoSent: false,
      diagnosisSent: true,
      telegramChatId: { not: null },
      telegramStage: 'intake_complete',
    },
  })

  for (const lead of leads) {
    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, productRecoSent: false },
      data:  { productRecoSent: true },
    })
    if (claimed.count === 0) continue

    try {
      const msg = buildProductRecoMessage(lead)
      if (!msg) continue  // no product recommendations stored — skip silently

      await sendTelegramToUser(lead.telegramChatId, msg)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  { productRecoSentAt: new Date() },
      })
      console.log(`[FollowUp] Product reco sent → ${lead.fullName} (${lead.id})`)

    } catch (err) {
      console.error(`[FollowUp] Product reco FAILED for ${lead.id}:`, err.message)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  { productRecoSent: false },
      }).catch(() => {})
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs one full follow-up cycle (diagnosis → check-in → product reco).
 * Called by the poller every 60s.
 */
async function processFollowUps() {
  try {
    await sendDiagnosisMessages()
    await sendCheckIns()
    await sendProductRecos()
  } catch (err) {
    console.error('[FollowUpService] Unhandled error in processFollowUps:', err.message)
  }
}

/**
 * Starts the background poller for automated diagnosis follow-ups.
 * Runs every 60 seconds — no additional dependencies required.
 */
function startFollowUpService() {
  console.log('✅ Follow-up service started (diagnosis auto-send every 60s)')
  // Catch up on any sends missed during downtime
  processFollowUps()
  setInterval(processFollowUps, 60 * 1000)
}

module.exports = { startFollowUpService, processFollowUps }
