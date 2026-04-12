/**
 * Delivery Service — outbound channel routing for lead messages.
 *
 * Channel priority order (Phase 10+ — Telegram primary):
 *   1. telegram_direct        — lead has telegramChatId (has started the bot)
 *   2. telegram_not_connected — no telegramChatId → admin alert to relay manually
 *
 * Email and WhatsApp are removed from the active delivery order. They can be
 * re-enabled here once Telegram is stable.
 *
 * Admin alerts (new lead notifications, reply ingestion, scheduler alerts)
 * bypass this service entirely and call sendAndLogTelegramMessage() directly.
 */

const prisma = require('../lib/prisma')
const { sendTelegramToUser, sendTelegramMessage } = require('./telegramService')

console.log('[Delivery] lead priority = telegram_direct > telegram_not_connected (admin relay)')

const TYPE_LABELS = {
  initial:     '✅ INITIAL REPLY SENT',
  follow_up_1: '✅ FOLLOW-UP 1 SENT',
  follow_up_2: '✅ FOLLOW-UP 2 SENT',
  follow_up_3: '✅ FOLLOW-UP 3 SENT',
}

/**
 * Determines the best delivery channel for a lead.
 *
 * @param {object} lead
 * @returns {'telegram_direct'|'telegram_not_connected'}
 */
function resolveChannel(lead) {
  if (lead.telegramChatId) return 'telegram_direct'
  return 'telegram_not_connected'
}

/**
 * Delivers a message to a lead via the best available channel.
 * Logs every attempt to message_logs with full delivery metadata.
 *
 * @param {object}  params
 * @param {object}  params.lead           - Lead record from DB (must have .id, .telegramChatId)
 * @param {string}  params.message        - Plain text message body
 * @param {string}  params.subject        - Kept for API compatibility; unused in Telegram channel
 * @param {string}  params.messageType    - 'initial' | 'follow_up_1' | 'follow_up_2' | 'follow_up_3'
 * @param {boolean} [params.auto]         - True if fired by auto-trigger service
 * @param {string}  [params.triggerReason] - 'initial_auto' | 'fu1_auto' | 'manual'
 * @returns {Promise<{
 *   success?: boolean,
 *   skipped?: boolean,
 *   channel: string,
 *   recipient: string,
 *   fallbackUsed: boolean,
 *   status: 'sent'|'skipped'
 * }>}
 */
async function deliverToLead({ lead, message, subject, messageType, auto = false, triggerReason = null }) {
  const channel = resolveChannel(lead)
  let result
  let recipient
  let fallbackUsed = false
  let logChannel = 'telegram'

  // ── Telegram direct — lead has started the bot ────────────────────────────
  if (channel === 'telegram_direct') {
    recipient = lead.telegramChatId
    result = await sendTelegramToUser(lead.telegramChatId, message)
    console.log(`[Delivery] telegram_direct → chatId=${lead.telegramChatId} lead=${lead.id} type=${messageType} success=${result.success}`)

  // ── No Telegram — admin relay alert ───────────────────────────────────────
  } else {
    recipient = 'telegram_admin'
    fallbackUsed = true
    const alertText = buildNoTelegramAlert({ lead, message, messageType, auto, triggerReason })
    result = await sendTelegramMessage(alertText)
    console.log(`[Delivery] telegram_not_connected relay (lead ${lead.id}) type=${messageType}`)
  }

  // ── Persist delivery attempt to message_logs ──────────────────────────────
  const logStatus = result.skipped ? 'skipped' : result.success ? 'sent' : 'failed'
  prisma.messageLog.create({
    data: {
      type: 'lead',
      recordId: lead.id,
      channel: logChannel,
      status: logStatus,
      providerResponse: result.data ? JSON.stringify(result.data) : null,
      error: result.error ? String(result.error) : null,
      auto,
      triggerReason,
      recipient,
      deliveryChannel: channel,
      fallbackUsed,
    },
  }).catch((e) => console.error('[Delivery] MessageLog write error:', e.message))

  const deliveryStatus = result.skipped ? 'skipped' : 'sent'
  return { ...result, channel, recipient, fallbackUsed, status: deliveryStatus }
}

/**
 * Builds the admin Telegram alert when a lead has not yet connected their Telegram.
 * Includes the full message so the admin can relay it manually via DM / comment.
 */
function buildNoTelegramAlert({ lead, message, messageType, auto, triggerReason }) {
  const label = TYPE_LABELS[messageType] || '✅ MESSAGE'
  const autoFlag = auto ? ' · <i>AUTO</i>' : ''

  return (
    `${label}${autoFlag}\n\n` +
    `<b>Lead:</b> ${lead.fullName}` + (lead.handle ? ` · @${lead.handle}` : '') + `\n` +
    `<b>Platform:</b> ${lead.sourcePlatform}` + (lead.sourceType ? ` · ${lead.sourceType}` : '') + `\n` +
    (lead.skinConcern ? `<b>Concern:</b> ${lead.skinConcern.replace(/_/g, ' ')}\n` : '') +
    `\n<b>Message to relay manually:</b>\n${message}` +
    `\n\n⚠️ <i>Telegram not connected — lead has not started the bot yet</i>` +
    (triggerReason ? `\n<i>Trigger: ${triggerReason}</i>` : '')
  )
}

module.exports = { deliverToLead, resolveChannel }
