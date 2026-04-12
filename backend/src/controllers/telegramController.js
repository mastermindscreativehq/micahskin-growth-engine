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
 */
function computeEngagementScore(lead, now) {
  if (lead.telegramLastMessageAt) return 'high'

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
 * Receives raw Telegram Bot API updates. Routes to the correct handler based
 * on whether the chatId belongs to a Lead, an AcademyRegistration, or is unknown.
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

    // ── Route to correct handler based on chatId lookup ───────────────────────
    const lead = await prisma.lead.findFirst({ where: { telegramChatId: chatId } })
    if (lead) {
      await handleLeadReply({ lead, chatId, text })
      return
    }

    const academy = await prisma.academyRegistration.findFirst({ where: { telegramChatId: chatId } })
    if (academy) {
      await handleAcademyReply({ academy, chatId, text })
      return
    }

    // Unknown chatId — prompt them to use the deep link
    const greeting = firstName ? `Hi ${firstName}!` : 'Hi!'
    await sendTelegramToUser(
      chatId,
      `${greeting} We don't have a connected account for this chat yet.\n\nPlease use the link from your registration form to connect your account 🌿`
    )

  } catch (err) {
    console.error('[Telegram Webhook] Error processing update:', err.message)
  }
}

// ── Lead reply handler ────────────────────────────────────────────────────────

/**
 * State machine for lead replies.
 *
 * Stage flow:
 *   "connected"       → first reply: send duration question → "asked_duration"
 *   "asked_duration"  → next reply: send acknowledgement    → "duration_received"
 *   anything else     → save message + intelligence, no auto-response
 *
 * Backwards-compatibility: leads with telegramStage=null and an existing
 * telegramLastMessage (already replied before this fix) are treated as
 * "duration_received" so the question is never repeated.
 */
async function handleLeadReply({ lead, chatId, text }) {
  const now = Date.now()
  const intent = detectIntent(text)
  const engagementScore = computeEngagementScore(lead, now)
  const stage = lead.telegramStage

  // Resolve effective stage for leads that pre-date the stage field
  const effectiveStage = stage ?? (lead.telegramLastMessage ? 'duration_received' : 'connected')

  let newStage = stage // may stay null for legacy leads in "duration_received" path
  let autoResponse = null

  if (effectiveStage === 'connected') {
    const intentLabel = INTENT_LABEL[intent] || 'skin concerns'
    autoResponse =
      `Got it 👍 We see a lot of people dealing with <b>${intentLabel}</b>.\n\n` +
      `We're preparing your personalised routine.\n\n` +
      `Quick one — how long have you been dealing with this?`
    newStage = 'asked_duration'
  } else if (effectiveStage === 'asked_duration') {
    autoResponse =
      `Thanks — that helps 🙏\n\n` +
      `Our team is reviewing your case and will message you with the best next steps.`
    newStage = 'duration_received'
  }
  // effectiveStage === 'duration_received' or later → no auto-response

  // Build update payload
  const updateData = {
    telegramLastMessage: text,
    telegramLastMessageAt: new Date(now),
    intent,
    engagementScore,
    telegramStage: newStage,
    ...(['new', 'contacted'].includes(lead.status) ? { status: 'engaged' } : {}),
  }
  if (newStage === 'asked_duration') {
    updateData.telegramQuestionSentAt = new Date(now)
  }

  await prisma.lead.update({ where: { id: lead.id }, data: updateData })

  if (autoResponse) {
    await sendTelegramToUser(chatId, autoResponse)
  }

  // Admin alert for high engagement
  if (engagementScore === 'high') {
    const intentLabel = INTENT_LABEL[intent] || 'skin concerns'
    await sendTelegramMessage(
      `🔥 <b>Hot lead reply</b>\n\n` +
      `<b>Name:</b> ${lead.fullName}\n` +
      `<b>Telegram:</b> ${lead.telegramUsername ? `@${lead.telegramUsername}` : chatId}\n` +
      `<b>Intent:</b> ${intentLabel}\n` +
      `<b>Message:</b> ${text.slice(0, 200)}\n` +
      `<b>Engagement:</b> ${engagementScore}\n` +
      `<b>Stage:</b> ${newStage}`
    ).catch(() => {})
  }

  console.log(`[Telegram Webhook] Reply from lead ${lead.id} — intent=${intent} score=${engagementScore} stage=${newStage}`)
}

// ── Academy reply handler ─────────────────────────────────────────────────────

/**
 * State machine for academy registrant replies.
 *
 * Stage flow:
 *   "connected"  → first reply: send goal question → "asked_goal"
 *   "asked_goal" → next reply: send acknowledgement → "goal_received"
 *   anything else → no auto-response
 */
async function handleAcademyReply({ academy, chatId, text }) {
  const stage = academy.telegramStage ?? 'connected'

  let newStage = academy.telegramStage
  let autoResponse = null

  if (stage === 'connected') {
    autoResponse =
      `That's great to hear 🎓\n\n` +
      `Quick one — what's your main goal for joining the Academy?\n\n` +
      `(e.g. building a skincare brand, learning formulation, growing a client base)`
    newStage = 'asked_goal'
  } else if (stage === 'asked_goal') {
    autoResponse =
      `Perfect — thank you! 🙏\n\n` +
      `Our team will reach out with your first steps. Keep an eye on this chat.`
    newStage = 'goal_received'
  }

  await prisma.academyRegistration.update({
    where: { id: academy.id },
    data: { telegramStage: newStage },
  })

  if (autoResponse) {
    await sendTelegramToUser(chatId, autoResponse)
  }

  console.log(`[Telegram Webhook] Academy reply from reg ${academy.id} — stage=${newStage}`)
}

// ── Link helpers ──────────────────────────────────────────────────────────────

/**
 * Links a Telegram user to a Lead record and sends a confirmation message.
 * Sets telegramStage = "connected" so the state machine knows this is a fresh link.
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
      telegramStage: 'connected',
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
    `Sit tight — we'll have your results ready shortly! Feel free to reply with any questions 🌿`
  )

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
 * Links a Telegram user to an AcademyRegistration record and sends a confirmation message.
 * Sets telegramStage = "connected" so the state machine knows this is a fresh link.
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
      telegramStage: 'connected',
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
    `We're excited to have you — stay tuned for your first module! Feel free to reply with any questions 🎓`
  )

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
