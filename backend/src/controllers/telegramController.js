const prisma = require('../lib/prisma')
const { sendTelegramToUser, sendTelegramMessage } = require('../services/telegramService')
const { handleTelegramMessage } = require('../services/telegramSessionService')
const { isPostDiagnosisLead, classifyFollowUpIntent } = require('../services/telegramFollowUpService')
const { processPaidEnrollment } = require('../services/academyOnboardingService')
const { handlePremiumIntakeReply } = require('../services/premiumDeliveryService')
const { maybeTriggerAutomaticConversion } = require('../services/conversionEngineService')
const { handleInboundReply, classifyInboundIntent, buildConsultInterestReply, updateConversationState } = require('../services/conversationBrainService')
const { handleAcademyMemberReply } = require('../services/academyExperienceService')
const { generateQuoteForLead } = require('../services/productQuoteService')
const { handleIncomingPhoto } = require('../services/skinImageService')
const { startDeepConsult, handleDeepConsultReply } = require('../services/deepConsultService')
const { logFlowEvent } = require('../services/flowGuardService')
const { scoreLeadMonetization } = require('../services/monetizationScoringService')

// Telegram stages where we are collecting delivery details before sending the product quote
const DELIVERY_COLLECTION_STAGES = new Set([
  'collecting_delivery_name',
  'collecting_delivery_phone',
  'collecting_delivery_city',
  'collecting_delivery_address',
])

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

    if (!message) return

    const chatId   = String(message.chat.id)
    const username = message.from?.username || null

    // ── Photo messages — only accepted during the awaiting_images stage ────────
    if (message.photo) {
      console.log(`[LeadWebhook] photo message | chatId=${chatId}`)
      const photoLead = await prisma.lead.findFirst({
        where: { telegramChatId: chatId },
        orderBy: { createdAt: 'desc' },
      })

      if (photoLead && photoLead.telegramStage === 'awaiting_images') {
        await handleIncomingPhoto(message, photoLead, chatId)
      } else {
        console.log(`[LeadWebhook] photo ignored — stage=${photoLead?.telegramStage || 'none'} | chatId=${chatId}`)
      }
      return
    }

    if (!message.text) return

    const text = message.text.trim()

    console.log(`[LeadWebhook] incoming | chatId=${chatId} username=${username || 'none'} text="${text.slice(0, 80)}"`)

    if (text.startsWith('/start')) {
      const payload = text.slice('/start'.length).trim()

      if (payload.startsWith('lead_')) {
        const leadId = payload.slice('lead_'.length)
        console.log(`[LeadWebhook] deep-link connect | leadId=${leadId} chatId=${chatId}`)
        await linkLead({ leadId, chatId, username, botToken: LEAD_BOT_TOKEN })
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
    // Use orderBy createdAt desc so the most-recently-created lead takes priority
    // when a user has multiple records with the same chatId.
    const lead = await prisma.lead.findFirst({
      where: { telegramChatId: chatId },
      orderBy: { createdAt: 'desc' },
    })

    console.log(
      `[LeadWebhook] lead lookup | chatId=${chatId} ` +
      `found=${!!lead} leadId=${lead?.id || 'none'} ` +
      `stage=${lead?.telegramStage || 'none'} diagnosisSent=${lead?.diagnosisSent || false}`
    )

    // ── Phase 29: Global Flow Guard ──────────────────────────────────────────
    // Check currentFlow (authoritative) then fall back to legacy leadStage.
    // Guards are ordered by priority. Each guard either returns early or
    // allows execution to fall through to the normal routing below.
    if (lead) {
      const flow = lead.currentFlow

      // Academy locked — silently drop all inbound messages
      if (flow === 'academy_locked' || lead.leadStage === 'academy_locked') {
        console.log(`[FlowGuard] academy_locked_ignore | leadId=${lead.id} chatId=${chatId}`)
        logFlowEvent(lead.id, 'academy_locked_ignore', flow, null, 'inbound_dropped').catch(() => {})
        prisma.lead.update({
          where: { id: lead.id },
          data:  { lastFlowGuardReason: 'academy_locked_ignore' },
        }).catch(() => {})
        return
      }

      // Closed — silently drop all inbound messages
      if (flow === 'closed' || lead.status === 'closed') {
        console.log(`[FlowGuard] closed_no_response | leadId=${lead.id} chatId=${chatId}`)
        logFlowEvent(lead.id, 'closed_no_response', flow, null, 'lead_closed').catch(() => {})
        return
      }

      // Product quote pending admin review — tell user once, block regen
      if (flow === 'product_quote_pending_review') {
        const alreadyTold = lead.lastFlowGuardReason === 'pending_review_msg_sent'
        if (!alreadyTold) {
          await sendTelegramToUser(
            chatId,
            'Your product recommendation is being reviewed by our team. ' +
            "We'll send the final list and payment link once it's confirmed.",
            LEAD_BOT_TOKEN
          ).catch(() => {})
          prisma.lead.update({
            where: { id: lead.id },
            data:  { lastFlowGuardReason: 'pending_review_msg_sent' },
          }).catch(() => {})
        }
        logFlowEvent(lead.id, 'blocked_auto_quote_pending_review', flow, null, 'quote_under_admin_review').catch(() => {})
        console.log(`[FlowGuard] product_quote_pending_review | leadId=${lead.id}`)
        return
      }

      // Human consult pending — resend WhatsApp link, don't trigger other flows
      if (flow === 'human_consult_pending') {
        const reply = buildConsultInterestReply(lead)
        await sendTelegramToUser(chatId, reply, LEAD_BOT_TOKEN).catch(() => {})
        logFlowEvent(lead.id, 'human_consult_pending_reminder', flow, null, 'reminded_whatsapp_link').catch(() => {})
        console.log(`[FlowGuard] human_consult_pending reminder sent | leadId=${lead.id}`)
        return
      }

      // deep_consult_active — handled further down via existing conversationMode check;
      // just log that we're routing there
      if (flow === 'deep_consult_active') {
        logFlowEvent(lead.id, 'routed_to_deep_consult', flow, flow, 'currentFlow=deep_consult_active').catch(() => {})
        // fall through — existing conversationMode === 'deep_consult_active' handler takes it
      }
    }

    // Always track the latest inbound message on the lead record.
    // This powers the "Last message" line in the CRM during intake
    // (otherwise admin shows "No reply yet" for the entire 6-question flow).
    if (lead) {
      prisma.lead.update({
        where: { id: lead.id },
        data: {
          telegramLastMessage:   text,
          telegramLastMessageAt: new Date(),
        },
      }).catch(err => console.error('[LeadWebhook] message tracking failed:', err.message))
    }

    // ── Delivery address collection (highest priority after /start) ──────────
    // Fires when lead has just paid and we're waiting for their shipping details.
    if (lead && lead.telegramStage === 'awaiting_delivery_address') {
      await handleDeliveryAddressReply(lead, text, chatId)
      return
    }

    if (lead && isPostDiagnosisLead(lead)) {
      // ── Delivery detail collection (step-by-step pre-payment intake) ──────
      if (DELIVERY_COLLECTION_STAGES.has(lead.telegramStage)) {
        await handleDeliveryCollection(lead, text, chatId)
        return
      }

      // ── PRODUCT keyword — begin delivery detail collection ────────────────
      if (text.trim().toUpperCase() === 'PRODUCT') {
        await handleProductRequest(lead, chatId)
        return
      }

      // ── Deep consult in-progress — route to consult engine ───────────────
      if (lead.conversationMode === 'deep_consult_active') {
        await handleDeepConsultReply(lead, text, chatId)
        return
      }

      // ── CONSULT keyword — start AI diagnostic consult engine ─────────────
      if (text.trim().toUpperCase() === 'CONSULT') {
        logFlowEvent(lead.id, 'routed_to_deep_consult', lead.currentFlow, 'deep_consult_active', 'keyword_consult').catch(() => {})
        scoreLeadMonetization(lead.id).catch(() => {})
        await startDeepConsult(lead, chatId)
        return
      }

      // ── HUMAN CONSULT / PRIVATE CONSULT — route to human consult offer ───
      // Does NOT enter the AI diagnostic engine. Sends existing WhatsApp booking link.
      {
        const upper = text.trim().toUpperCase()
        if (upper === 'HUMAN CONSULT' || upper === 'PRIVATE CONSULT') {
          const reply = buildConsultInterestReply(lead)
          await sendTelegramToUser(chatId, reply, LEAD_BOT_TOKEN)
            .catch(err => console.error('[LeadWebhook] human consult offer failed:', err.message))
          await updateConversationState(lead.id, {
            conversationMode:    'consult_active',
            currentFlow:         'human_consult_pending',
            lastUserIntent:      'human_consult_request',
            lastBotIntent:       'human_consult_offer',
            lastMeaningfulBotAt: new Date(),
            consultOfferCount:   { increment: 1 },
          })
          logFlowEvent(lead.id, 'routed_to_human_consult', lead.currentFlow, 'human_consult_pending', 'keyword_human_consult').catch(() => {})
          scoreLeadMonetization(lead.id).catch(() => {})
          return
        }
      }

      // ── Conversation Brain routes and responds ────────────────────────────
      const brainIntent = classifyInboundIntent(text)
      console.log(`[LeadWebhook] post-diagnosis route | leadId=${lead.id} intent=${brainIntent}`)
      const reply = await handleInboundReply(lead, text)
      if (reply) {
        const sendResult = await sendTelegramToUser(chatId, reply, LEAD_BOT_TOKEN)
        console.log(`[LeadWebhook] brain reply | leadId=${lead.id} success=${sendResult.success} skipped=${sendResult.skipped}`)
      }

      // Queue automatic conversion offer only for actionable buying signals.
      if (!NO_CONVERSION_INTENTS.has(brainIntent)) {
        const conversionIntent = classifyFollowUpIntent(text)
        maybeTriggerAutomaticConversion(lead, conversionIntent).catch(err =>
          console.error('[ConversionEngine] auto trigger error:', err.message)
        )
      }
      return
    }

    // ── All other messages → session state machine ───────────────────────────
    console.log(`[LeadWebhook] intake route | chatId=${chatId} leadId=${lead?.id || 'anonymous'}`)
    const reply = await handleTelegramMessage(chatId, text)
    if (reply) {
      const sendResult = await sendTelegramToUser(chatId, reply, LEAD_BOT_TOKEN)
      console.log(
        `[LeadWebhook] intake reply sent | chatId=${chatId} ` +
        `success=${sendResult.success} skipped=${sendResult.skipped || false} ` +
        `error=${sendResult.error ? JSON.stringify(sendResult.error) : 'none'}`
      )
    } else {
      console.log(`[LeadWebhook] intake returned null | chatId=${chatId} (session completed or unknown stage)`)
    }

  } catch (err) {
    console.error('[Lead Webhook] Error processing update:', err.message, err.stack)
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

  console.log(`[LeadWebhook] Lead ${leadId} linked | chatId=${chatId} username=${username || 'none'}`)
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

// ── Delivery address collection ───────────────────────────────────────────────

/**
 * Receives the lead's delivery details after payment confirmation.
 * Finds the most recent FulfillmentOrder awaiting an address, saves it,
 * and marks the order ready for packing.
 */
async function handleDeliveryAddressReply(lead, text, chatId) {
  console.log(`[Fulfillment] receiving address | leadId=${lead.id}`)

  const order = await prisma.fulfillmentOrder.findFirst({
    where: { leadId: lead.id, status: 'awaiting_address' },
    orderBy: { createdAt: 'desc' },
  })

  if (!order) {
    console.warn(`[Fulfillment] no awaiting_address order found | leadId=${lead.id}`)
    await prisma.lead.update({
      where: { id: lead.id },
      data: { telegramStage: 'diagnosis_sent' },
    })
    return
  }

  const now = new Date()

  await prisma.fulfillmentOrder.update({
    where: { id: order.id },
    data: {
      deliveryAddress: text,
      status:          'pending_packing',
      customerPhone:   order.customerPhone || lead.phone || null,
    },
  })

  await prisma.lead.update({
    where: { id: lead.id },
    data: { telegramStage: 'diagnosis_sent' },
  })

  console.log(`[Fulfillment] address saved | orderId=${order.id} leadId=${lead.id}`)

  await sendTelegramToUser(
    chatId,
    'Thank you! Your delivery details have been saved.\n\n' +
    'Our team will process your order and reach out once it is ready to ship. 🌿',
    LEAD_BOT_TOKEN
  ).catch(e => console.error('[Fulfillment] address confirmation send failed:', e.message))

  // Admin alert
  await sendTelegramMessage(
    `📦 <b>Delivery address received</b>\n\n` +
    `<b>Name:</b> ${lead.fullName}\n` +
    `<b>Order:</b> ...${order.id.slice(-8)}\n` +
    `<b>Details:</b>\n${text.slice(0, 400)}`
  ).catch(() => {})
}

// ── PRODUCT intent handler ────────────────────────────────────────────────────

/**
 * Entry point when a lead replies PRODUCT after receiving their diagnosis.
 * Starts the 4-step delivery detail collection flow instead of immediately
 * creating and sending the quote — humanises the experience and collects
 * shipping info before payment.
 */
async function handleProductRequest(lead, chatId) {
  console.log(`[ProductQuote] PRODUCT intent → starting delivery collection | leadId=${lead.id}`)

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      telegramStage:    'collecting_delivery_name',
      conversationMode: 'product_reco_active',
      lastUserIntent:   'product_buying_intent',
    },
  })

  await sendTelegramToUser(
    chatId,
    'Let me prepare your routine and confirm your delivery details first.\n\n' +
    'What is your full name for delivery?',
    LEAD_BOT_TOKEN
  ).catch(e => console.error('[ProductQuote] delivery prompt failed:', e.message))
}

// ── Delivery detail collection (4-step pre-payment flow) ─────────────────────

/**
 * Handles the step-by-step delivery detail collection triggered by PRODUCT.
 * Stages: collecting_delivery_name → phone → city → address
 * After address is saved, auto-generates and sends the product quote + Paystack link.
 */
async function handleDeliveryCollection(lead, text, chatId) {
  const stage = lead.telegramStage
  const now   = new Date()

  if (stage === 'collecting_delivery_name') {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        deliveryName:          text.trim(),
        telegramStage:         'collecting_delivery_phone',
        telegramLastMessage:   text,
        telegramLastMessageAt: now,
      },
    })
    await sendTelegramToUser(
      chatId,
      'Your phone number? (e.g. +234 801 234 5678)',
      LEAD_BOT_TOKEN
    ).catch(() => {})
    return
  }

  if (stage === 'collecting_delivery_phone') {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        deliveryPhone:         text.trim(),
        telegramStage:         'collecting_delivery_city',
        telegramLastMessage:   text,
        telegramLastMessageAt: now,
      },
    })
    await sendTelegramToUser(chatId, 'Which city are you in?', LEAD_BOT_TOKEN).catch(() => {})
    return
  }

  if (stage === 'collecting_delivery_city') {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        deliveryCity:          text.trim(),
        telegramStage:         'collecting_delivery_address',
        telegramLastMessage:   text,
        telegramLastMessageAt: now,
      },
    })
    await sendTelegramToUser(
      chatId,
      'Your full delivery address? (street, area, any landmark)',
      LEAD_BOT_TOKEN
    ).catch(() => {})
    return
  }

  if (stage === 'collecting_delivery_address') {
    // Save final field and return to normal post-diagnosis stage
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        deliveryAddress:       text.trim(),
        telegramStage:         'diagnosis_sent',
        telegramLastMessage:   text,
        telegramLastMessageAt: now,
      },
    })

    console.log(`[ProductQuote] delivery details complete | leadId=${lead.id}`)

    // Tell the lead their details are received and quote is being prepared by the team.
    // We do NOT auto-generate a Paystack link or send a quote here.
    await sendTelegramToUser(
      chatId,
      '✅ Delivery details received.\n\n' +
      'Our skincare team is preparing your product quote.\n' +
      "We'll send the final product list and payment link after review.",
      LEAD_BOT_TOKEN
    ).catch(e => console.error('[ProductQuote] delivery confirmation send failed:', e.message))

    // Re-fetch lead so deliveryAddress is populated for quote draft generation
    const freshLead = await prisma.lead.findUnique({ where: { id: lead.id } })

    try {
      const quote = await generateQuoteForLead(freshLead.id)
      if (!quote) throw new Error('generateQuoteForLead returned null')

      // Draft created — set flow to pending_review so flow guard blocks auto-regen
      await prisma.lead.update({
        where: { id: freshLead.id },
        data:  { currentFlow: 'product_quote_pending_review', lastFlowGuardReason: null },
      }).catch(() => {})
      logFlowEvent(freshLead.id, 'quote_draft_created', 'diagnosis_sent', 'product_quote_pending_review', 'delivery_collected').catch(() => {})

      // Trigger monetization scoring (non-blocking)
      scoreLeadMonetization(freshLead.id).catch(() => {})

      console.log(`[ProductQuote] draft_created awaiting_admin_review | leadId=${freshLead.id} quoteId=${quote.id}`)

      await sendTelegramMessage(
        `📋 <b>Product quote ready for review</b>\n\n` +
        `<b>Name:</b> ${freshLead.fullName}\n` +
        `<b>Concern:</b> ${(freshLead.primaryConcern || freshLead.skinConcern || '—').replace(/_/g, ' ')}\n` +
        `<b>City:</b> ${freshLead.deliveryCity || '—'}\n` +
        `<b>Address:</b> ${(freshLead.deliveryAddress || '—').slice(0, 120)}\n` +
        `<b>Quote ID:</b> ...${quote.id.slice(-8)}\n` +
        `<b>Draft Total:</b> ₦${(quote.totalAmount || 0).toLocaleString('en-NG')}\n\n` +
        `⚠️ Review prices in CRM before sending.`
      ).catch(() => {})

    } catch (err) {
      console.error(`[ProductQuote] draft generation failed | leadId=${freshLead.id}:`, err.message)

      await sendTelegramMessage(
        `⚡ <b>Delivery collected — quote generation failed</b>\n\n` +
        `<b>Name:</b> ${freshLead.fullName}\n` +
        `<b>City:</b> ${freshLead.deliveryCity || '—'}\n` +
        `<b>Address:</b> ${(freshLead.deliveryAddress || '—').slice(0, 120)}\n` +
        `<b>Error:</b> ${err.message}\n\n` +
        `Please generate and send the quote manually from the CRM.`
      ).catch(() => {})
    }
  }
}

module.exports = { handleLeadWebhook, handleAcademyWebhook }
