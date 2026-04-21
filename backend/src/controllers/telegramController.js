const prisma = require('../lib/prisma')
const { sendTelegramToUser, sendTelegramMessage } = require('../services/telegramService')
const { handleTelegramMessage } = require('../services/telegramSessionService')
const { isPostDiagnosisLead, classifyFollowUpIntent } = require('../services/telegramFollowUpService')
const { processPaidEnrollment } = require('../services/academyOnboardingService')
const { handlePremiumIntakeReply } = require('../services/premiumDeliveryService')
const { maybeTriggerAutomaticConversion } = require('../services/conversionEngineService')
const { handleInboundReply, classifyInboundIntent } = require('../services/conversationBrainService')
const { handleAcademyMemberReply } = require('../services/academyExperienceService')

const LEAD_BOT_TOKEN    = process.env.TELEGRAM_LEAD_BOT_TOKEN
const ACADEMY_BOT_TOKEN = process.env.TELEGRAM_ACADEMY_BOT_TOKEN

// Intents where we should NOT queue an automatic conversion offer
// (stop/thanks/greeting are terminal or noise — conversion engine shouldn't act on them)
const NO_CONVERSION_INTENTS = new Set([
  'stop_or_not_interested',
  'thanks_acknowledgement',
  'greeting',
  'academy_objection',
  'payment_question',
])

// ── Lead webhook ──────────────────────────────────────────────────────────────

/**
 * POST /api/telegram/webhook/lead
 *
 * Receives updates only from the leads bot.
 *   /start lead_<id>    → link chatId to an existing Lead, begin intake
 *   /start (no payload) → start fresh intake session
 *   any other text      → run through session state machine or conversation brain
 */
async function handleLeadWebhook(req, res) {
  res.sendStatus(200)

  try {
    const update = req.body
    const message = update?.message

    if (!message || !message.text) return

    const chatId    = String(message.chat.id)
    const username  = message.from?.username   || null
    const text      = message.text.trim()

    if (text.startsWith('/start')) {
      const payload = text.slice('/start'.length).trim()

      if (payload.startsWith('lead_')) {
        await linkLead({ leadId: payload.slice('lead_'.length), chatId, username, botToken: LEAD_BOT_TOKEN })
        return
      }

      // Plain /start — begin or restart intake
      const reply = await handleTelegramMessage(chatId, '/start')
      if (reply) await sendTelegramToUser(chatId, reply, LEAD_BOT_TOKEN)
      return
    }

    // ── Post-diagnosis leads get context-aware follow-up handler ─────────────
    // Must be checked BEFORE the intake state machine to prevent a stale or
    // missing TelegramSession from routing diagnosed leads back into the intake
    // question flow (e.g. asking skin type after a check-in reply).
    const lead = await prisma.lead.findFirst({
      where: { telegramChatId: chatId },
    })
    if (lead && isPostDiagnosisLead(lead)) {
      // ── Conversation Brain routes and responds ────────────────────────────
      // Brain classifies with the richer 12-bucket taxonomy, applies governor
      // rules, builds context-aware reply, and persists conversation state.
      const brainIntent = classifyInboundIntent(text)
      const reply = await handleInboundReply(lead, text)
      if (reply) await sendTelegramToUser(chatId, reply, LEAD_BOT_TOKEN)

      // Queue automatic conversion offer only for actionable buying signals.
      // Use legacy 8-bucket classifier for the conversion engine (it was built for that).
      if (!NO_CONVERSION_INTENTS.has(brainIntent)) {
        const conversionIntent = classifyFollowUpIntent(text)
        maybeTriggerAutomaticConversion(lead, conversionIntent).catch(err =>
          console.error('[ConversionEngine] auto trigger error:', err.message)
        )
      }
      return
    }

    // ── All other messages → session state machine ───────────────────────────
    const reply = await handleTelegramMessage(chatId, text)
    if (reply) {
      await sendTelegramToUser(chatId, reply, LEAD_BOT_TOKEN)
    }

  } catch (err) {
    console.error('[Lead Webhook] Error processing update:', err.message)
  }
}

// ── Academy webhook ───────────────────────────────────────────────────────────

/**
 * POST /api/telegram/webhook/academy
 *
 * Receives updates only from the academy bot.
 *   /start academy_<id> → link chatId to an AcademyRegistration
 *   any other text      → route through academy reply handler
 */
async function handleAcademyWebhook(req, res) {
  res.sendStatus(200)

  try {
    const update = req.body
    const message = update?.message

    if (!message || !message.text) return

    const chatId   = String(message.chat.id)
    const username = message.from?.username || null
    const text     = message.text.trim()

    if (text.startsWith('/start')) {
      const payload = text.slice('/start'.length).trim()

      if (payload.startsWith('academy_')) {
        await linkAcademy({ registrationId: payload.slice('academy_'.length), chatId, username, botToken: ACADEMY_BOT_TOKEN })
        return
      }
      // Unrecognised /start on academy bot — ignore silently
      return
    }

    const academy = await prisma.academyRegistration.findFirst({
      where: { telegramChatId: chatId },
    })
    if (academy) {
      await handleAcademyReply({ academy, chatId, text, botToken: ACADEMY_BOT_TOKEN })
    }

  } catch (err) {
    console.error('[Academy Webhook] Error processing update:', err.message)
  }
}

// ── Academy reply handler ─────────────────────────────────────────────────────

/**
 * Routes a message from an AcademyRegistration member.
 *
 * Three-tier routing — strict priority order:
 *
 *   Tier 1 (premium): implementationClient === true
 *     → premium structured intake flow (handlePremiumIntakeReply)
 *     → never touches lesson engine
 *
 *   Tier 2 (enrolled basic member): academyStatus === 'enrolled' | 'graduated'
 *     → academy lesson experience (handleAcademyMemberReply)
 *     → hard gate: must never fall through to public lead/intake flow
 *
 *   Tier 3 (pre-enrollment / not yet paid): everything else
 *     → existing 2-step goal collection (connected → asked_goal → goal_received)
 *     → waits until payment is confirmed, then Tier 2 takes over
 */
async function handleAcademyReply({ academy, chatId, text, botToken }) {
  // ── Tier 0: revoked — block immediately ─────────────────────────────────────
  if (academy.academyStatus === 'revoked') {
    await sendTelegramToUser(chatId,
      `Your MICAHSKIN Academy access has been revoked. Please contact support if you believe this is an error.`,
      botToken
    )
    return
  }

  // ── Tier 1: premium implementation track ────────────────────────────────────
  if (academy.implementationClient === true) {
    await handlePremiumIntakeReply(academy, chatId, text)
    return
  }

  // ── Tier 2: enrolled academy member → lesson experience ────────────────────
  // academyStatus is set to 'enrolled' by processPaidEnrollment (payment confirmed).
  // 'graduated' is set by academyExperienceService once all lessons are complete.
  // Both states are hard-routed to the experience layer — no fallthrough.
  if (academy.academyStatus === 'enrolled' || academy.academyStatus === 'graduated') {
    await handleAcademyMemberReply(academy, chatId, text)
    return
  }

  // ── Tier 3: pre-enrollment — 2-step goal collection ─────────────────────────
  // Member has connected Telegram but payment is not yet confirmed.
  // Collect their goal so the team has context when onboarding fires.
  const stage = academy.telegramStage ?? 'connected'
  let newStage     = academy.telegramStage
  let autoResponse = null

  if (stage === 'connected') {
    autoResponse =
      `That\u2019s great to hear \ud83c\udf93\n\n` +
      `Quick one \u2014 what\u2019s your main goal for joining the Academy?\n\n` +
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
    await sendTelegramToUser(chatId, autoResponse, botToken)
  }

  console.log(`[Academy Webhook] Academy reply from reg ${academy.id} — stage=${newStage}`)
}

// ── Link helpers ──────────────────────────────────────────────────────────────

/**
 * Links a Telegram chatId to an existing Lead record and starts the intake flow.
 * Sends a single welcome + first question so the next user reply kicks off
 * the session state machine at ASK_GOAL.
 */
async function linkLead({ leadId, chatId, username, botToken }) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })

  if (!lead) {
    await sendTelegramToUser(
      chatId,
      "Sorry, we couldn\u2019t find your registration. Please contact us directly.",
      botToken
    )
    return
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      telegramChatId:      chatId,
      telegramUsername:    username,
      telegramStarted:     true,
      telegramConnectedAt: new Date(),
      telegramStage:       'connected',
    },
  })

  // Pre-seed session so the user's next message is processed at ASK_GOAL
  await prisma.telegramSession.upsert({
    where: { userId: chatId },
    update: { stage: 'ASK_GOAL', data: {}, completed: false },
    create: { userId: chatId, stage: 'ASK_GOAL', data: {}, completed: false },
  })

  const firstName = lead.fullName.split(' ')[0]

  await sendTelegramToUser(
    chatId,
    `Hi ${firstName}! \ud83c\udf3f You\u2019re now connected to <b>MICAHSKIN</b>.\n\n` +
    `We\u2019re gathering a few details so our team can guide you properly.\n\n` +
    `<b>What skin concern would you like help with?</b>`,
    botToken
  )

  await sendTelegramMessage(
    `\u2705 <b>Lead connected Telegram</b>\n\n` +
    `<b>Name:</b> ${lead.fullName}\n` +
    `<b>Telegram:</b> ${username ? `@${username}` : chatId}\n` +
    `<b>Chat ID:</b> ${chatId}\n` +
    `<b>Lead ID:</b> ${leadId}\n` +
    `<b>Platform:</b> ${lead.sourcePlatform}` +
    (lead.sourceType ? ` \u00b7 ${lead.sourceType}` : '') + `\n` +
    (lead.skinConcern ? `<b>Concern:</b> ${lead.skinConcern.replace(/_/g, ' ')}` : '')
  ).catch(() => {})

  console.log(`[Lead Webhook] Lead ${leadId} linked to chatId=${chatId}`)
}

/**
 * Links a Telegram chatId to an AcademyRegistration and sends a confirmation.
 */
async function linkAcademy({ registrationId, chatId, username, botToken }) {
  const registration = await prisma.academyRegistration.findUnique({
    where: { id: registrationId },
  })

  if (!registration) {
    await sendTelegramToUser(
      chatId,
      "Sorry, we couldn\u2019t find your academy registration. Please contact us directly.",
      botToken
    )
    return
  }

  await prisma.academyRegistration.update({
    where: { id: registrationId },
    data: {
      telegramChatId:   chatId,
      telegramUsername: username,
      telegramStarted:  true,
      telegramStage:    'connected',
    },
  })

  const firstName = registration.fullName.split(' ')[0]

  // If payment already confirmed: skip generic welcome, send onboarding instead.
  // processPaidEnrollment re-fetches the registration (which now has the chatId)
  // and handles the full onboarding delivery + CRM state update idempotently.
  if (registration.paymentStatus === 'paid' && registration.onboardingSent === false) {
    processPaidEnrollment(registrationId, registration.academyAmount || 0).catch(err =>
      console.error('[linkAcademy] processPaidEnrollment error:', err.message)
    )
  } else if (registration.paymentStatus !== 'paid') {
    // Not yet paid — send the standard pre-payment welcome
    await sendTelegramToUser(
      chatId,
      `Hi ${firstName}! \ud83c\udf93 You\u2019re now connected to <b>MICAHSKIN Academy</b> on Telegram.\n\n` +
      `Welcome \u2014 once your payment is confirmed, your academy access will be activated here.\n\n` +
      `\u2705 Masterclass modules and training content\n` +
      `\u2705 Step-by-step guidance to build your skincare brand\n` +
      `\u2705 Direct support from the MICAHSKIN team\n\n` +
      `Stay tuned \u2014 feel free to reply with any questions \ud83c\udf93`,
      botToken
    )
  }
  // else: already onboarded (onboardingSent === true) — no message needed

  await sendTelegramMessage(
    `\u2705 <b>Academy registrant connected Telegram</b>\n\n` +
    `<b>Name:</b> ${registration.fullName}\n` +
    `<b>Email:</b> ${registration.email}\n` +
    `<b>Telegram:</b> ${username ? `@${username}` : chatId}\n` +
    `<b>Chat ID:</b> ${chatId}\n` +
    `<b>Registration ID:</b> ${registrationId}\n` +
    `<b>Payment:</b> ${registration.paymentStatus || 'not started'}\n` +
    `<b>Platform:</b> ${registration.sourcePlatform}` +
    (registration.sourceType ? ` \u00b7 ${registration.sourceType}` : '')
  ).catch(() => {})

  console.log(`[Academy Webhook] Academy registration ${registrationId} linked to chatId=${chatId}`)
}

module.exports = { handleLeadWebhook, handleAcademyWebhook }
