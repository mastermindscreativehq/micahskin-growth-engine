const prisma = require('../lib/prisma')
const { sendTelegramMessage } = require('./telegramService')

// Statuses that stop follow-up alerts
const STOP_STATUSES = ['engaged', 'interested', 'closed']

/**
 * Sends a scheduler ALERT to Telegram notifying admin that a follow-up is due.
 * Does NOT send the actual message body — the admin must execute via CRM button.
 * Does NOT create a MessageLog entry (this is an internal operational alert, not a send).
 */
async function sendSchedulerAlert(lead, followUpNumber) {
  const labels = {
    1: '⏰ FOLLOW-UP 1 DUE — +1h',
    2: '⏰ FOLLOW-UP 2 DUE — +6h',
    3: '🔔 FOLLOW-UP 3 DUE — +24h (FINAL)',
  }
  const concern = (lead.skinConcern || 'skin concern').replace(/_/g, ' ')

  const text =
    `${labels[followUpNumber]}\n\n` +
    `<b>Lead:</b> ${lead.fullName}` + (lead.handle ? ` · @${lead.handle}` : '') + `\n` +
    `<b>Platform:</b> ${lead.sourcePlatform}\n` +
    `<b>Concern:</b> ${concern}\n\n` +
    `→ Open CRM and click <b>Send FU${followUpNumber}</b> to execute`

  return sendTelegramMessage(text).catch(() => {})
}

/**
 * Queries the DB for leads with overdue follow-ups and sends admin alerts.
 *
 * IMPORTANT: This function only ALERTS. It does NOT set SentAt timestamps.
 * Sent timestamps (followUp1SentAt etc.) are set exclusively by the CRM execution endpoints.
 *
 * The boolean flags (followUp1Sent etc.) are set here to prevent duplicate alerts —
 * they do NOT indicate the message was actually sent to the lead.
 *
 * Uses atomic updateMany to claim each record before alerting, preventing
 * duplicate alerts even if processFollowUps() runs concurrently.
 */
async function processFollowUps() {
  const now = new Date()

  try {
    // ── Follow-up 1 (+1h) ────────────────────────────────────────────────────
    const fu1Leads = await prisma.lead.findMany({
      where: {
        followUp1:      { lte: now },
        followUp1Sent:  false,        // scheduler hasn't alerted yet
        followUp1SentAt: null,        // CRM hasn't executed the send yet
        status: { notIn: STOP_STATUSES },
      },
    })

    for (const lead of fu1Leads) {
      // Atomically claim: prevents duplicate alerts if two processes run simultaneously
      const claimed = await prisma.lead.updateMany({
        where: { id: lead.id, followUp1Sent: false, followUp1SentAt: null },
        data:  { followUp1Sent: true },
      })
      if (claimed.count === 0) continue

      await sendSchedulerAlert(lead, 1)
      console.log(`[Scheduler] Follow-up 1 alert → ${lead.fullName} (${lead.id})`)
    }

    // ── Follow-up 2 (+6h) ────────────────────────────────────────────────────
    const fu2Leads = await prisma.lead.findMany({
      where: {
        followUp2:      { lte: now },
        followUp2Sent:  false,
        followUp2SentAt: null,
        status: { notIn: STOP_STATUSES },
      },
    })

    for (const lead of fu2Leads) {
      const claimed = await prisma.lead.updateMany({
        where: { id: lead.id, followUp2Sent: false, followUp2SentAt: null },
        data:  { followUp2Sent: true },
      })
      if (claimed.count === 0) continue

      await sendSchedulerAlert(lead, 2)
      console.log(`[Scheduler] Follow-up 2 alert → ${lead.fullName} (${lead.id})`)
    }

    // ── Follow-up 3 (+24h) ───────────────────────────────────────────────────
    const fu3Leads = await prisma.lead.findMany({
      where: {
        followUp3:      { lte: now },
        followUp3Sent:  false,
        followUp3SentAt: null,
        status: { notIn: STOP_STATUSES },
      },
    })

    for (const lead of fu3Leads) {
      const claimed = await prisma.lead.updateMany({
        where: { id: lead.id, followUp3Sent: false, followUp3SentAt: null },
        data:  { followUp3Sent: true },
      })
      if (claimed.count === 0) continue

      await sendSchedulerAlert(lead, 3)
      console.log(`[Scheduler] Follow-up 3 alert → ${lead.fullName} (${lead.id})`)
    }

  } catch (err) {
    console.error('[Scheduler] processFollowUps error:', err.message)
  }
}

/**
 * Starts the background follow-up alert scheduler.
 * Runs every minute using setInterval (no extra dependencies).
 * Also runs once immediately on boot to catch any follow-ups missed during downtime.
 */
function startScheduler() {
  console.log('✅ Follow-up scheduler started (checks every 60s)')

  // Catch up on any follow-ups missed while the server was down
  processFollowUps()

  setInterval(processFollowUps, 60 * 1000)
}

module.exports = { startScheduler, processFollowUps }
