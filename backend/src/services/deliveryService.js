/**
 * Delivery Service — outbound channel routing for lead messages.
 *
 * Channel priority order:
 *   1. whatsapp         — lead has a phone number   → WhatsApp Cloud API
 *   2. email            — lead has an email address → SendGrid
 *   3. telegram_fallback — no direct contact info   → Telegram admin relay (manual send)
 *
 * Telegram admin alerts (new lead notifications, reply ingestion, scheduler alerts)
 * bypass this service entirely and call sendAndLogTelegramMessage() directly.
 *
 * WhatsApp failure path:
 *   On a failed WhatsApp send this service writes a 'failed' MessageLog entry,
 *   fires a Telegram admin alert with the reason, then re-throws so the caller
 *   does NOT mark the reply as sent or advance the lead's status.
 */

const prisma = require('../lib/prisma')
const { sendEmail } = require('./emailService')
const { sendWhatsAppText, maskPhone } = require('./whatsappService')
const { sendTelegramMessage } = require('./telegramService')

console.log('[Delivery] lead priority = whatsapp > email > telegram_fallback')

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
 * @returns {'email'|'whatsapp'|'telegram_fallback'}
 */
function resolveChannel(lead) {
  if (lead.phone)  return 'whatsapp'
  if (lead.email)  return 'email'
  return 'telegram_fallback'
}

/**
 * Delivers a message to a lead via the best available channel.
 * Logs every attempt to message_logs with full delivery metadata.
 *
 * @param {object}  params
 * @param {object}  params.lead           - Lead record from DB (must have .id, .phone / .email)
 * @param {string}  params.message        - Plain text message body
 * @param {string}  params.subject        - Email subject (email channel only)
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
 * @throws {Error} when WhatsApp send fails (failed log + Telegram alert already written before throw)
 */
async function deliverToLead({ lead, message, subject, messageType, auto = false, triggerReason = null }) {
  const channel = resolveChannel(lead)
  const fallbackUsed = channel === 'telegram_fallback'
  let result
  let recipient
  let logChannel

  // ── Email ────────────────────────────────────────────────────────────────────
  if (channel === 'email') {
    recipient  = lead.email
    logChannel = 'email'
    result     = await sendEmail({ to: lead.email, subject, text: message })
    console.log(`[Delivery] email → ${lead.email} (${lead.id}) type=${messageType}`)

  // ── WhatsApp ─────────────────────────────────────────────────────────────────
  } else if (channel === 'whatsapp') {
    recipient  = lead.phone
    logChannel = 'whatsapp'
    result     = await sendWhatsAppText({ to: lead.phone, body: message })
    console.log(`[Delivery] whatsapp → ${maskPhone(lead.phone)} lead=${lead.id} type=${messageType} success=${result.success}`)

    if (!result.success) {
      // 1. Write the failed log entry immediately
      prisma.messageLog.create({
        data: {
          type: 'lead',
          recordId: lead.id,
          channel: 'whatsapp',
          status: 'failed',
          providerResponse: result.providerResponse ? JSON.stringify(result.providerResponse) : null,
          error: result.error ? String(result.error) : null,
          auto,
          triggerReason,
          recipient: lead.phone,
          deliveryChannel: 'whatsapp',
          fallbackUsed: false,
        },
      }).catch((e) => console.error('[Delivery] MessageLog (failed) write error:', e.message))

      // 2. Alert the admin via Telegram so the message can be relayed manually
      const alertText = buildWhatsAppFailureAlert({ lead, message, messageType, error: result.error, auto, triggerReason })
      sendTelegramMessage(alertText).catch(() => {})

      // 3. Throw so the caller does not advance timestamps or mark as sent
      const err = new Error(`WhatsApp delivery failed for lead ${lead.id} (${maskPhone(lead.phone)}): ${result.error}`)
      err.status = 502
      err.providerResponse = result.providerResponse
      throw err
    }

  // ── Telegram admin relay ─────────────────────────────────────────────────────
  } else {
    recipient  = 'telegram_admin'
    logChannel = 'telegram'
    const relayText = buildRelayText({ lead, message, messageType, auto, triggerReason })
    result = await sendTelegramMessage(relayText)
    console.log(`[Delivery] telegram_fallback relay (lead ${lead.id}) type=${messageType}`)
  }

  // ── Persist successful/skipped delivery to message_logs ───────────────────────
  const logStatus = result.skipped ? 'skipped' : result.success ? 'sent' : 'failed'
  prisma.messageLog.create({
    data: {
      type: 'lead',
      recordId: lead.id,
      channel: logChannel,
      status: logStatus,
      providerResponse: result.providerResponse ? JSON.stringify(result.providerResponse) : null,
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
 * Builds the admin Telegram alert fired when a WhatsApp send fails.
 * Includes the original message body so the admin can relay it manually.
 */
function buildWhatsAppFailureAlert({ lead, message, messageType, error, auto, triggerReason }) {
  const label = TYPE_LABELS[messageType] || 'MESSAGE'
  const autoFlag = auto ? ' · <i>AUTO</i>' : ''

  return (
    `⚠️ <b>WhatsApp send FAILED — ${label}${autoFlag}</b>\n\n` +
    `<b>Lead:</b> ${lead.fullName}` + (lead.handle ? ` · @${lead.handle}` : '') + `\n` +
    `<b>Phone:</b> ${lead.phone}\n` +
    `<b>Platform:</b> ${lead.sourcePlatform}\n` +
    `<b>Error:</b> ${error || 'unknown'}\n\n` +
    `<b>Message to relay manually:</b>\n${message}` +
    (triggerReason ? `\n\n<i>Trigger: ${triggerReason}</i>` : '')
  )
}

/**
 * Builds the Telegram relay notification for leads with no direct contact channel.
 * Only shown when the lead has neither email nor phone.
 */
function buildRelayText({ lead, message, messageType, auto, triggerReason }) {
  const label = TYPE_LABELS[messageType] || '✅ MESSAGE SENT'
  const autoFlag = auto ? ' · <i>AUTO</i>' : ''

  return (
    `${label}${autoFlag}\n\n` +
    `<b>Lead:</b> ${lead.fullName}` + (lead.handle ? ` · @${lead.handle}` : '') + `\n` +
    `<b>Platform:</b> ${lead.sourcePlatform}` + (lead.sourceType ? ` · ${lead.sourceType}` : '') + `\n` +
    (lead.skinConcern ? `<b>Concern:</b> ${lead.skinConcern.replace(/_/g, ' ')}\n` : '') +
    `\n<b>Message to send:</b>\n${message}` +
    `\n<i>📭 No email or phone on file — please relay this message manually</i>` +
    (triggerReason ? `\n\n<i>Trigger: ${triggerReason}</i>` : '')
  )
}

module.exports = { deliverToLead, resolveChannel }
