const prisma = require('../lib/prisma')
const { sendTelegramToUser, sendTelegramMessage } = require('../services/telegramService')

// ── Concern classification ────────────────────────────────────────────────────

/**
 * Maps free-text Telegram message to a skin-concern bucket.
 * Rule-based only — checked in order, first match wins.
 */
function classifyConcern(text) {
  const t = text.toLowerCase()
  if (/acne|pimple|breakout|blemish|spot/.test(t)) return 'acne'
  if (/hyperpigment|pigment|dark spot|discolou?r|uneven tone|dark mark/.test(t)) return 'hyperpigmentation'
  if (/stretch mark|stretchmark/.test(t)) return 'stretch_marks'
  if (/dry|dehydrat|flak|tight skin/.test(t)) return 'dry_skin'
  if (/sensitiv|react|irritat|redness|rash/.test(t)) return 'sensitive_skin'
  if (/body|back|chest|arm|leg|stomach|torso/.test(t)) return 'body_care'
  return 'general'
}

/**
 * Detects purchase or urgency signals in any message, at any stage.
 * Returns an intent string if matched, null otherwise.
 */
function detectPurchaseIntent(text) {
  const t = text.toLowerCase()
  if (/i want to buy|want to buy|ready to buy|how do i order|how to order/.test(t)) return 'price'
  if (/\bprice\b|\bprices\b|\bcost\b|\bcosts\b|how much|pricing/.test(t)) return 'price'
  if (/\broutine\b|full routine|skincare routine/.test(t)) return 'routine'
  if (/\burgent\b|\basap\b|right now|need it now/.test(t)) return 'urgent'
  return null
}

// ── Engagement scoring ────────────────────────────────────────────────────────

/**
 * Scores this lead's Telegram engagement based on reply speed, message
 * length, and whether they have replied more than once.
 */
function computeEngagementScore(lead, now, text = '') {
  // Multiple replies → high
  if (lead.telegramLastMessage) return 'high'

  // First reply — check speed and message length
  const fastReply =
    lead.telegramConnectedAt &&
    now - new Date(lead.telegramConnectedAt).getTime() < 15 * 60 * 1000

  if (fastReply || text.length >= 60) return 'high'

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
 * Structured intake state machine for lead replies.
 *
 * One user message → one bot reply, driven entirely by persisted telegramStage.
 * The bot acknowledges and asks the next intake question only — it does NOT
 * diagnose, prescribe, or give clinical advice.
 *
 * Stage flow:
 *   connected             → receive concern    → duration_pending
 *   duration_pending      → receive duration   → area_pending
 *   area_pending          → receive area       → skin_type_pending
 *   skin_type_pending     → receive skin type  → products_tried_pending
 *   products_tried_pending → receive products  → severity_pending
 *   severity_pending      → receive severity   → goal_pending
 *   goal_pending          → receive goal       → intake_complete
 *   intake_complete /
 *   awaiting_human_review → acknowledge only, no more questions
 *
 * Backward compat: leads with no telegramStage but existing telegramLastMessage
 * (pre-upgrade) are treated as intake_complete so no old question is ever repeated.
 */
async function handleLeadReply({ lead, chatId, text }) {
  const now = Date.now()

  // Resolve effective stage — safe fallback for pre-upgrade leads
  const effectiveStage =
    lead.telegramStage ??
    (lead.telegramLastMessage ? 'intake_complete' : 'connected')

  // Detect purchase / urgency signals that override the concern intent
  const purchaseIntent = detectPurchaseIntent(text)

  // Base update applied on every message
  const updateData = {
    telegramLastMessage: text,
    telegramLastMessageAt: new Date(now),
    engagementScore: computeEngagementScore(lead, now, text),
  }

  // Purchase intent always overrides the concern classification
  if (purchaseIntent) {
    updateData.intent = purchaseIntent
  }

  let autoResponse = null

  switch (effectiveStage) {

    case 'connected': {
      const concern = classifyConcern(text)
      updateData.telegramConcern = text
      updateData.intent = purchaseIntent ?? concern
      updateData.telegramStage = 'duration_pending'
      // Advance lead status if still cold
      if (['new', 'contacted'].includes(lead.status)) {
        updateData.status = 'engaged'
      }
      autoResponse = `Got it. How long have you been dealing with this?`
      break
    }

    case 'duration_pending': {
      updateData.telegramDuration = text
      updateData.telegramStage = 'area_pending'
      autoResponse = `Is it mainly on your face, body, or both?`
      break
    }

    case 'area_pending': {
      updateData.telegramArea = text
      updateData.telegramStage = 'skin_type_pending'
      autoResponse = `How would you describe your skin type: oily, dry, combination, sensitive, or not sure?`
      break
    }

    case 'skin_type_pending': {
      updateData.telegramSkinType = text
      updateData.telegramStage = 'products_tried_pending'
      autoResponse = `What products or remedies have you already tried for this?`
      break
    }

    case 'products_tried_pending': {
      updateData.telegramProductsTried = text
      updateData.telegramStage = 'severity_pending'
      autoResponse = `Would you say it is mild, moderate, or severe?`
      break
    }

    case 'severity_pending': {
      updateData.telegramSeverity = text
      updateData.telegramStage = 'goal_pending'
      autoResponse = `What result do you want most right now: clear breakouts, fade marks, smoother skin, hydration, or a full routine?`
      break
    }

    case 'goal_pending': {
      updateData.telegramGoal = text
      updateData.telegramStage = 'intake_complete'
      if (['new', 'contacted'].includes(lead.status)) {
        updateData.status = 'engaged'
      }
      autoResponse =
        `Perfect \u2014 I\u2019ve saved your details. Our team is preparing your personalised skincare guidance and will continue with you here shortly \ud83c\udf3f`
      break
    }

    default:
      // intake_complete, awaiting_human_review, concern_received, or any unknown stage
      // Acknowledge but never repeat intake questions
      autoResponse =
        `Thanks \u2014 I\u2019ve added that to your consultation notes. Our team will continue with you here shortly.`
      break
  }

  await prisma.lead.update({ where: { id: lead.id }, data: updateData })

  await sendTelegramToUser(chatId, autoResponse)

  // Admin alert for high engagement
  if (updateData.engagementScore === 'high') {
    await sendTelegramMessage(
      `\ud83d\udd25 <b>Hot lead reply</b>\n\n` +
      `<b>Name:</b> ${lead.fullName}\n` +
      `<b>Telegram:</b> ${lead.telegramUsername ? `@${lead.telegramUsername}` : chatId}\n` +
      `<b>Stage:</b> ${updateData.telegramStage ?? effectiveStage}\n` +
      `<b>Intent:</b> ${updateData.intent ?? lead.intent ?? 'unknown'}\n` +
      `<b>Message:</b> ${text.slice(0, 200)}`
    ).catch(() => {})
  }

  console.log(
    `[Telegram Webhook] Lead ${lead.id} — stage ${effectiveStage} → ${updateData.telegramStage ?? effectiveStage}` +
    ` | score=${updateData.engagementScore} | intent=${updateData.intent ?? lead.intent}`
  )
}

// ── Academy reply handler ─────────────────────────────────────────────────────

/**
 * State machine for academy registrant replies — untouched by lead upgrade.
 *
 * Stage flow:
 *   connected  → first reply: send goal question → asked_goal
 *   asked_goal → next reply: send acknowledgement → goal_received
 *   anything else → no auto-response
 */
async function handleAcademyReply({ academy, chatId, text }) {
  const stage = academy.telegramStage ?? 'connected'

  let newStage = academy.telegramStage
  let autoResponse = null

  if (stage === 'connected') {
    autoResponse =
      `That's great to hear \ud83c\udf93\n\n` +
      `Quick one \u2014 what's your main goal for joining the Academy?\n\n` +
      `(e.g. building a skincare brand, learning formulation, growing a client base)`
    newStage = 'asked_goal'
  } else if (stage === 'asked_goal') {
    autoResponse =
      `Perfect \u2014 thank you! \ud83d\ude4f\n\n` +
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
 * Links a Telegram user to a Lead record.
 * Sets telegramStage = "connected" and immediately asks the first intake question.
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

  await sendTelegramToUser(
    chatId,
    `Hi ${firstName}! \ud83c\udf3f You\u2019re now connected to <b>MICAHSKIN</b>.\n\n` +
    `We\u2019re gathering a few details so our team can guide you properly.\n\n` +
    `<b>What is the main skin issue you want help with right now?</b>`
  )

  await sendTelegramMessage(
    `\u2705 <b>Lead connected Telegram</b>\n\n` +
    `<b>Name:</b> ${lead.fullName}\n` +
    `<b>Telegram:</b> ${username ? `@${username}` : chatId}\n` +
    `<b>Chat ID:</b> ${chatId}\n` +
    `<b>Lead ID:</b> ${leadId}\n` +
    `<b>Platform:</b> ${lead.sourcePlatform}` + (lead.sourceType ? ` \u00b7 ${lead.sourceType}` : '') + `\n` +
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
    `Hi ${firstName}! \ud83c\udf93 You\u2019re now connected to <b>MICAHSKIN Academy</b> on Telegram.\n\n` +
    `Welcome \u2014 your academy access is confirmed. Here\u2019s what\u2019s coming your way:\n\n` +
    `\u2705 Masterclass modules and training content\n` +
    `\u2705 Step-by-step guidance to build your skincare brand\n` +
    `\u2705 Direct support from the MICAHSKIN team\n\n` +
    `We\u2019re excited to have you \u2014 stay tuned for your first module! Feel free to reply with any questions \ud83c\udf93`
  )

  await sendTelegramMessage(
    `\u2705 <b>Academy registrant connected Telegram</b>\n\n` +
    `<b>Name:</b> ${registration.fullName}\n` +
    `<b>Email:</b> ${registration.email}\n` +
    `<b>Telegram:</b> ${username ? `@${username}` : chatId}\n` +
    `<b>Chat ID:</b> ${chatId}\n` +
    `<b>Registration ID:</b> ${registrationId}\n` +
    `<b>Platform:</b> ${registration.sourcePlatform}` + (registration.sourceType ? ` \u00b7 ${registration.sourceType}` : '')
  )

  console.log(`[Telegram Webhook] Academy registration ${registrationId} linked to chatId=${chatId}`)
}

module.exports = { handleWebhook }
