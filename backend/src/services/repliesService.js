const prisma = require('../lib/prisma')
const { sendAndLogTelegramMessage } = require('./telegramService')
const { detectIntent, intentToLeadAction, generateIntentResponse } = require('./intentService')

const VALID_CHANNELS = ['telegram', 'instagram', 'tiktok', 'manual']

/**
 * Receives an incoming reply from a lead, stores it, detects intent,
 * updates lead status, and triggers the appropriate response via Telegram.
 *
 * @param {{ leadId: string, message: string, channel: string }} data
 * @returns {Promise<{ reply: object, lead: object, responseSent: boolean }>}
 */
async function ingestReply({ leadId, message, channel }) {
  // ── Validate ───────────────────────────────────────────────────────────────
  const errors = []
  if (!leadId || typeof leadId !== 'string' || leadId.trim() === '') {
    errors.push('leadId is required')
  }
  if (!message || typeof message !== 'string' || message.trim() === '') {
    errors.push('message is required')
  }
  if (!channel || !VALID_CHANNELS.includes(channel)) {
    errors.push(`channel must be one of: ${VALID_CHANNELS.join(', ')}`)
  }
  if (errors.length > 0) {
    const err = new Error('Validation failed')
    err.status = 400
    err.errors = errors
    throw err
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId.trim() } })
  if (!lead) {
    const err = new Error('Lead not found')
    err.status = 404
    throw err
  }

  // ── Intent Detection ───────────────────────────────────────────────────────
  const intent = detectIntent(message)
  const { newStatus, rescheduleFollowUp } = intentToLeadAction(intent)

  // ── Persist Reply ──────────────────────────────────────────────────────────
  const reply = await prisma.reply.create({
    data: {
      leadId: lead.id,
      message: message.trim(),
      channel,
      detectedIntent: intent,
    },
  })

  console.log(`[Replies] Stored reply ${reply.id} | lead=${lead.id} | intent=${intent} | channel=${channel}`)

  // ── Update Lead ────────────────────────────────────────────────────────────
  const leadUpdate = {}

  if (newStatus && newStatus !== lead.status) {
    leadUpdate.status = newStatus
    console.log(`[Replies] Lead ${lead.id} status: ${lead.status} → ${newStatus}`)
  }

  // DELAY: push follow-ups forward 24h from now so the scheduler re-alerts
  if (rescheduleFollowUp) {
    const base = Date.now()
    leadUpdate.followUp1 = new Date(base + 1 * 60 * 60 * 1000)   // +1h
    leadUpdate.followUp2 = new Date(base + 6 * 60 * 60 * 1000)   // +6h
    leadUpdate.followUp3 = new Date(base + 24 * 60 * 60 * 1000)  // +24h
    // Reset sent flags so scheduler will re-alert on the new times
    leadUpdate.followUp1Sent = false
    leadUpdate.followUp2Sent = false
    leadUpdate.followUp3Sent = false
    leadUpdate.followUp1SentAt = null
    leadUpdate.followUp2SentAt = null
    leadUpdate.followUp3SentAt = null
    console.log(`[Replies] Lead ${lead.id} follow-ups rescheduled from now (DELAY intent)`)
  }

  const updatedLead = Object.keys(leadUpdate).length > 0
    ? await prisma.lead.update({ where: { id: lead.id }, data: leadUpdate })
    : lead

  // ── Send Response ──────────────────────────────────────────────────────────
  const responseMessage = generateIntentResponse(intent, updatedLead)
  const telegramText = formatReplyNotification({ lead: updatedLead, incomingMessage: message, intent, responseMessage })

  const sendResult = await sendAndLogTelegramMessage(telegramText, {
    type: 'lead',
    recordId: lead.id,
    triggerReason: 'reply_response',
  })

  const responseSent = sendResult.success === true

  console.log(`[Replies] Response for intent=${intent} sent via Telegram: ${responseSent ? 'OK' : 'FAILED'}`)

  return { reply, lead: updatedLead, responseSent }
}

/**
 * Returns all replies for a given lead, newest first.
 */
async function getRepliesForLead(leadId) {
  return prisma.reply.findMany({
    where: { leadId },
    orderBy: { createdAt: 'desc' },
  })
}

// ── Telegram notification formatter ───────────────────────────────────────────

const INTENT_EMOJI = {
  PRICE: '💰',
  HOT:   '🔥',
  DELAY: '⏳',
  DEAD:  '🚫',
  UNKNOWN: '❓',
}

function formatReplyNotification({ lead, incomingMessage, intent, responseMessage }) {
  const emoji = INTENT_EMOJI[intent] || '❓'
  const statusLine = (() => {
    switch (intent) {
      case 'PRICE':  return `Status updated → <b>interested</b>`
      case 'HOT':    return `Status updated → <b>engaged</b>`
      case 'DELAY':  return `Status: <b>contacted</b> (follow-ups rescheduled)`
      case 'DEAD':   return `Status updated → <b>closed</b>`
      default:       return `Status unchanged`
    }
  })()

  return (
    `${emoji} <b>INCOMING REPLY — ${intent}</b>\n\n` +
    `<b>Lead:</b> ${lead.fullName}` + (lead.handle ? ` · @${lead.handle}` : '') + `\n` +
    `<b>Platform:</b> ${lead.sourcePlatform}` + (lead.sourceType ? ` · ${lead.sourceType}` : '') + `\n` +
    `<b>${statusLine}</b>\n\n` +
    `<b>Their message:</b>\n${incomingMessage}\n\n` +
    `<b>Suggested response to send:</b>\n${responseMessage}`
  )
}

module.exports = { ingestReply, getRepliesForLead }
