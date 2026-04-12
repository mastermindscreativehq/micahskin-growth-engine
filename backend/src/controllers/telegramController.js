const prisma = require('../lib/prisma')
const { sendTelegramToUser, sendTelegramMessage } = require('../services/telegramService')

// ── Intent detection ──────────────────────────────────────────────────────────

/**
 * Maps free-text Telegram message to one of four intent buckets.
 * Checked in order — first match wins.
 */
function detectIntent(text) {
  const t = text.toLowerCase()
  if (/acne|pimple|breakout|blemish/.test(t)) return 'acne'
  if (/hyperpigment|pigment|dark spot|discolou?r|uneven tone/.test(t)) return 'hyperpigmentation'
  if (/stretch mark|stretchmark/.test(t)) return 'stretch_marks'
  return 'general'
}

const INTENT_LABEL = {
  acne: 'acne',
  hyperpigmentation: 'hyperpigmentation',
  stretch_marks: 'stretch marks',
  general: 'skin concerns',
}

// ── Engagement scoring ────────────────────────────────────────────────────────

/**
 * Scores this lead's Telegram engagement.
 * high  — they've sent multiple messages, OR first reply within 15 min of connecting
 * medium — first reply but took longer than 15 min
 * low   — not used here (default for leads that never reply; we only call this on a reply)
 */
function computeEngagementScore(lead, now) {
  // Already replied before → multiple messages → high
  if (lead.telegramLastMessageAt) return 'high'

  // First message — score by how quickly they replied after connecting
  if (lead.telegramConnectedAt) {
    const elapsed = now - new Date(lead.telegramConnectedAt).getTime()
    if (elapsed < 15 * 60 * 1000) return 'high'
  }

  return 'medium'
}

// ── Webhook handler ───────────────────────────────────────────────────────────

/**
 * POST /api/telegram/webhook
 *
 * Receives raw Telegram Bot API updates and:
 *   - Detects /start commands with deep-link payloads → links lead/academy record
 *   - Handles regular messages from already-connected leads:
 *       saves telegramLastMessage, detects intent, scores engagement, sends auto-response
 *
 * Always responds 200 immediately — Telegram retries if it gets anything else.
 */
async function handleWebhook(req, res) {
  res.sendStatus(200)

  try {
    const update = req.body
    const message = update?.message

    if (!message || !message.text) return

    const chatId = String(message.chat.id)
    const username = message.from?.username || null
    const firstName = message.from?.first_name || null
    const text = message.text.trim()

    // ── /start command ────────────────────────────────────────────────────────
    if (text.startsWith('/start')) {
      const payload = text.slice('/start'.length).trim()

      if (payload.startsWith('lead_')) {
        await linkLead({ leadId: payload.slice('lead_'.length), chatId, username })

      } else if (payload.startsWith('academy_')) {
        await linkAcademy({ registrationId: payload.slice('academy_'.length), chatId, username })

      } else {
        const greeting = firstName ? `Hi ${firstName}!` : 'Hi!'
        await sendTelegramToUser(
          chatId,
          `${greeting} Welcome to <b>MICAHSKIN</b> 🌿\n\nTo connect your account, please use the link from your registration form and tap <b>Start</b>.`
        )
      }
      return
    }

    // ── Regular reply from a connected lead ───────────────────────────────────
    await handleLeadReply({ chatId, text, firstName })

  } catch (err) {
    console.error('[Telegram Webhook] Error processing update:', err.message)
  }
}

// ── Reply handler ─────────────────────────────────────────────────────────────

/**
 * Handles any non-/start message from a chatId that belongs to a known lead.
 * Saves the message, detects intent, scores engagement, sends an auto-response.
 */
async function handleLeadReply({ chatId, text, firstName }) {
  const lead = await prisma.lead.findFirst({ where: { telegramChatId: chatId } })

  if (!lead) {
    // Unknown chatId — politely prompt them to use the deep link
    const greeting = firstName ? `Hi ${firstName}!` : 'Hi!'
    await sendTelegramToUser(
      chatId,
      `${greeting} We don't have a connected account for this chat yet.\n\nPlease use the link from your registration form to connect your account 🌿`
    )
    return
  }

  const now = Date.now()
  const intent = detectIntent(text)
  const engagementScore = computeEngagementScore(lead, now)

  // Persist the reply data
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      telegramLastMessage: text,
      telegramLastMessageAt: new Date(now),
      intent,
      engagementScore,
      // Advance status to engaged if still at new/contacted
      ...(['new', 'contacted'].includes(lead.status) ? { status: 'engaged' } : {}),
    },
  })

  // Auto-response
  const intentLabel = INTENT_LABEL[intent] || 'skin concerns'
  await sendTelegramToUser(
    chatId,
    `Got it 👍 We see a lot of people dealing with <b>${intentLabel}</b>.\n\n` +
    `We're preparing your personalised routine.\n\n` +
    `Quick one — how long have you been dealing with this?`
  )

  // Admin alert for high engagement
  if (engagementScore === 'high') {
    await sendTelegramMessage(
      `🔥 <b>Hot lead reply</b>\n\n` +
      `<b>Name:</b> ${lead.fullName}\n` +
      `<b>Telegram:</b> ${lead.telegramUsername ? `@${lead.telegramUsername}` : chatId}\n` +
      `<b>Intent:</b> ${intentLabel}\n` +
      `<b>Message:</b> ${text.slice(0, 200)}\n` +
      `<b>Engagement:</b> ${engagementScore}`
    ).catch(() => {})
  }

  console.log(`[Telegram Webhook] Reply from lead ${lead.id} — intent=${intent} score=${engagementScore}`)
}

// ── Link helpers ──────────────────────────────────────────────────────────────

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
      telegramConnectedAt: new Date(),
    },
  })

  const firstName = lead.fullName.split(' ')[0]
  const concernLabel = lead.skinConcern ? lead.skinConcern.replace(/_/g, ' ') : 'your skin'

  await sendTelegramToUser(
    chatId,
    `Hi ${firstName}! 🌿 You're now connected to <b>MICAHSKIN</b> on Telegram.\n\n` +
    `Your personalised skincare results are being prepared. Here's what you'll receive:\n\n` +
    `✅ A personalised skincare plan for <b>${concernLabel}</b>\n` +
    `✅ Product recommendations tailored to your skin\n` +
    `✅ Ongoing tips and direct support from our team\n\n` +
    `Sit tight — we'll have your results ready shortly!`
  )

  // Follow-up engagement question after 2 minutes
  setTimeout(async () => {
    try {
      await sendTelegramToUser(
        chatId,
        `Quick question — what's your biggest skin concern right now? 🌿\n\n` +
        `(This helps us make sure your results are as personalised as possible!)`
      )
    } catch (err) {
      console.error(`[Telegram Webhook] Follow-up question failed for chatId=${chatId}:`, err.message)
    }
  }, 2 * 60 * 1000)

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

  await sendTelegramToUser(
    chatId,
    `Hi ${firstName}! 🎓 You're now connected to <b>MICAHSKIN Academy</b> on Telegram.\n\n` +
    `Welcome — your academy access is confirmed. Here's what's coming your way:\n\n` +
    `✅ Masterclass modules and training content\n` +
    `✅ Step-by-step guidance to build your skincare brand\n` +
    `✅ Direct support from the MICAHSKIN team\n\n` +
    `We're excited to have you — stay tuned for your first module!`
  )

  setTimeout(async () => {
    try {
      await sendTelegramToUser(
        chatId,
        `Quick question — what's your main goal for joining the Academy? 🎓\n\n` +
        `(This helps us personalise your learning experience!)`
      )
    } catch (err) {
      console.error(`[Telegram Webhook] Academy follow-up question failed for chatId=${chatId}:`, err.message)
    }
  }, 2 * 60 * 1000)

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
