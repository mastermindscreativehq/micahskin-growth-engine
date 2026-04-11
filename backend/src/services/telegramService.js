const prisma = require('../lib/prisma')

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('Telegram config missing. Skipping Telegram send.')
    return { skipped: true }
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Telegram API error:', data)
      return { success: false, error: data }
    }

    return { success: true, data }
  } catch (error) {
    console.error('Telegram send failed:', error.message)
    return { success: false, error: error.message }
  }
}

/**
 * Sends a Telegram message and logs the attempt to message_logs.
 * @param {string} text - HTML-formatted message text
 * @param {{ type: string, recordId: string, auto?: boolean, triggerReason?: string }} meta
 */
async function sendAndLogTelegramMessage(text, { type, recordId, auto = false, triggerReason = null }) {
  const result = await sendTelegramMessage(text)

  const logStatus = result.skipped ? 'skipped' : result.success ? 'sent' : 'failed'

  prisma.messageLog.create({
    data: {
      type,
      recordId,
      channel: 'telegram',
      status: logStatus,
      providerResponse: result.data ? JSON.stringify(result.data) : null,
      error: result.error ? String(result.error) : null,
      auto,
      triggerReason,
    },
  }).catch((e) => console.error('MessageLog write failed:', e.message))

  return result
}

const PRIORITY_EMOJI = { high: '🔴', medium: '🟡', low: '⚪' }

function fmtFollowUpTime(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatLeadTelegramMessage(lead) {
  const priority = lead.priority || 'low'
  const emoji = PRIORITY_EMOJI[priority] || '⚪'

  return (
    `${emoji} <b>New Lead — ${priority.toUpperCase()} priority</b>\n\n` +
    `<b>Name:</b> ${lead.fullName}\n` +
    (lead.email ? `<b>Email:</b> ${lead.email}\n` : '') +
    (lead.phone ? `<b>Phone:</b> ${lead.phone}\n` : '') +
    `<b>Platform:</b> ${lead.sourcePlatform}` + (lead.sourceType ? ` · ${lead.sourceType}` : '') + `\n` +
    (lead.handle ? `<b>Handle:</b> @${lead.handle}\n` : '') +
    (lead.campaign ? `<b>Campaign:</b> ${lead.campaign}\n` : '') +
    (lead.intentTag ? `<b>Intent:</b> ${lead.intentTag}\n` : '') +
    `<b>Skin Concern:</b> ${lead.skinConcern}\n` +
    `<b>Message:</b> ${lead.message}\n\n` +
    `<b>Suggested Reply:</b>\n${lead.suggestedReply || '—'}\n\n` +
    `<b>Follow-up Schedule:</b>\n` +
    `• 1h  → ${fmtFollowUpTime(lead.followUp1)}\n` +
    `• 6h  → ${fmtFollowUpTime(lead.followUp2)}\n` +
    `• 24h → ${fmtFollowUpTime(lead.followUp3)}`
  )
}

function formatAcademyTelegramMessage(registration) {
  return (
    `<b>New Academy Registration</b>\n\n` +
    `<b>Name:</b> ${registration.fullName}\n` +
    `<b>Email:</b> ${registration.email}\n` +
    (registration.phone ? `<b>Phone:</b> ${registration.phone}\n` : '') +
    (registration.businessType ? `<b>Business Type:</b> ${registration.businessType}\n` : '') +
    `<b>Experience Level:</b> ${registration.experienceLevel}\n` +
    `<b>Platform:</b> ${registration.sourcePlatform}` + (registration.sourceType ? ` · ${registration.sourceType}` : '') + `\n` +
    (registration.handle ? `<b>Handle:</b> @${registration.handle}\n` : '') +
    (registration.campaign ? `<b>Campaign:</b> ${registration.campaign}\n` : '') +
    `<b>Goals:</b> ${registration.goals}`
  )
}

module.exports = {
  sendTelegramMessage,
  sendAndLogTelegramMessage,
  formatLeadTelegramMessage,
  formatAcademyTelegramMessage,
}
