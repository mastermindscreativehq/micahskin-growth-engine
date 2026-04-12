const prisma = require('../lib/prisma')
const { sendTelegramToUser, sendTelegramMessage } = require('../services/telegramService')

/**
 * POST /api/telegram/webhook
 *
 * Receives raw Telegram Bot API updates and:
 *   - Detects /start commands with deep-link payloads
 *   - Parses lead_<leadId> or academy_<registrationId> payloads
 *   - Stores telegramChatId + telegramUsername on the matching record
 *   - Sends a welcome message to the user confirming the connection
 *   - Sends an admin alert with the linked record details
 *
 * Always responds 200 immediately — Telegram retries if it gets anything else.
 */
async function handleWebhook(req, res) {
  // Respond 200 right away so Telegram doesn't retry
  res.sendStatus(200)

  try {
    const update = req.body
    const message = update?.message

    if (!message || !message.text) return

    const chatId = String(message.chat.id)
    const username = message.from?.username || null
    const firstName = message.from?.first_name || null
    const text = message.text.trim()

    // Only handle /start commands
    if (!text.startsWith('/start')) return

    // Payload is everything after "/start " (may be empty for bare /start)
    const payload = text.slice('/start'.length).trim()

    if (payload.startsWith('lead_')) {
      const leadId = payload.slice('lead_'.length)
      await linkLead({ leadId, chatId, username })

    } else if (payload.startsWith('academy_')) {
      const registrationId = payload.slice('academy_'.length)
      await linkAcademy({ registrationId, chatId, username })

    } else {
      // Bare /start — bot is open but no payload; send a friendly prompt
      const greeting = firstName ? `Hi ${firstName}!` : 'Hi!'
      await sendTelegramToUser(
        chatId,
        `${greeting} Welcome to <b>MICAHSKIN</b> 🌿\n\nTo connect your account, please use the link from your registration form and tap <b>Start</b>.`
      )
    }
  } catch (err) {
    console.error('[Telegram Webhook] Error processing update:', err.message)
  }
}

/**
 * Links a Telegram user to a Lead record and sends confirmation messages.
 */
async function linkLead({ leadId, chatId, username }) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })

  if (!lead) {
    await sendTelegramToUser(chatId, "Sorry, we couldn't find your registration. Please contact us directly.")
    return
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      telegramChatId: chatId,
      telegramUsername: username,
      telegramStarted: true,
    },
  })

  const firstName = lead.fullName.split(' ')[0]

  // Welcome message to lead
  await sendTelegramToUser(
    chatId,
    `Hi ${firstName}! 🌿 You're now connected to <b>MICAHSKIN</b> on Telegram.\n\nWe'll send your personalised skincare advice right here. Our team will be in touch shortly!`
  )

  // Admin notification
  await sendTelegramMessage(
    `✅ <b>Lead connected Telegram</b>\n\n` +
    `<b>Name:</b> ${lead.fullName}\n` +
    `<b>Telegram:</b> ${username ? `@${username}` : chatId}\n` +
    `<b>Chat ID:</b> ${chatId}\n` +
    `<b>Lead ID:</b> ${leadId}\n` +
    `<b>Platform:</b> ${lead.sourcePlatform}` + (lead.sourceType ? ` · ${lead.sourceType}` : '') + `\n` +
    (lead.skinConcern ? `<b>Concern:</b> ${lead.skinConcern.replace(/_/g, ' ')}` : '')
  )

  console.log(`[Telegram Webhook] Lead ${leadId} linked to chatId=${chatId}`)
}

/**
 * Links a Telegram user to an AcademyRegistration record and sends confirmation messages.
 */
async function linkAcademy({ registrationId, chatId, username }) {
  const registration = await prisma.academyRegistration.findUnique({ where: { id: registrationId } })

  if (!registration) {
    await sendTelegramToUser(chatId, "Sorry, we couldn't find your academy registration. Please contact us directly.")
    return
  }

  await prisma.academyRegistration.update({
    where: { id: registrationId },
    data: {
      telegramChatId: chatId,
      telegramUsername: username,
      telegramStarted: true,
    },
  })

  const firstName = registration.fullName.split(' ')[0]

  // Welcome message to registrant
  await sendTelegramToUser(
    chatId,
    `Hi ${firstName}! 🎓 You're now connected to <b>MICAHSKIN Academy</b> on Telegram.\n\nWe'll send your masterclass updates and support messages right here. We're excited to have you!`
  )

  // Admin notification
  await sendTelegramMessage(
    `✅ <b>Academy registrant connected Telegram</b>\n\n` +
    `<b>Name:</b> ${registration.fullName}\n` +
    `<b>Email:</b> ${registration.email}\n` +
    `<b>Telegram:</b> ${username ? `@${username}` : chatId}\n` +
    `<b>Chat ID:</b> ${chatId}\n` +
    `<b>Registration ID:</b> ${registrationId}\n` +
    `<b>Platform:</b> ${registration.sourcePlatform}` + (registration.sourceType ? ` · ${registration.sourceType}` : '')
  )

  console.log(`[Telegram Webhook] Academy registration ${registrationId} linked to chatId=${chatId}`)
}

module.exports = { handleWebhook }
