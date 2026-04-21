'use strict'

/**
 * premiumDeliveryService.js — Phase 20: Premium Delivery Workflow
 *
 * Turns a confirmed premium payment into a full implementation pipeline.
 * This is a distinct fulfilment OS — not just an onboarding message.
 *
 * Responsibilities:
 *   - triggerPremiumDelivery(registrationId)
 *       Called from academyOnboardingService when package=premium.
 *       Marks buyer as implementationClient, initialises pipeline state,
 *       sends premium welcome + intake kickoff via Telegram (if connected).
 *       Safe on retries — atomic claim via implementationClient flag.
 *
 *   - handlePremiumIntakeReply(academy, chatId, text)
 *       Called from telegramController when an implementationClient sends a message.
 *       Advances the 11-step structured intake conversation.
 *       Safe on re-entry — ignores replies once stage=done.
 *
 *   - runPendingPremiumOnboardings()
 *       Background poller. Delivers premium welcome when Telegram connects
 *       after the payment webhook fired.
 *
 * Implementation stages (implementationStage):
 *   paid → onboarding_sent → intake_pending → intake_complete →
 *   review_pending → strategy_call_pending → strategy_call_booked →
 *   build_pending → build_in_progress → delivered → active
 *
 * Logging prefix: [PremiumDelivery]
 */

const prisma = require('../lib/prisma')
const { sendAcademyToUser: sendTelegramToUser, sendTelegramMessage } = require('./telegramService')

// ── Intake stage machine ───────────────────────────────────────────────────────
//
// Each entry: the current stage (what question the user is answering),
// the DB field to store the answer in (null = boolean yes/no logic),
// the next stage to advance to, and the question text to send next.

const INTAKE_STAGES = [
  {
    stage:    'intake_brand_name',
    field:    'intakeBrandName',
    next:     'intake_business_type',
    question: 'What type of business is this? (e.g. skincare brand, beauty salon, product reseller, online store)',
  },
  {
    stage:    'intake_business_type',
    field:    'intakeBusinessType',
    next:     'intake_business_stage',
    question: 'What stage is your business at? (e.g. just starting out, already selling, looking to scale)',
  },
  {
    stage:    'intake_business_stage',
    field:    'intakeBusinessStage',
    next:     'intake_products_services',
    question: 'What products or services do you currently offer — or plan to offer?',
  },
  {
    stage:    'intake_products_services',
    field:    'intakeProductsServices',
    next:     'intake_sales_channel',
    question: 'Where are you currently selling or finding clients? (e.g. Instagram, WhatsApp, physical store, website)',
  },
  {
    stage:    'intake_sales_channel',
    field:    'intakeSalesChannel',
    next:     'intake_top_problem',
    question: "What's your biggest business challenge right now? Be as specific as you can.",
  },
  {
    stage:    'intake_top_problem',
    field:    'intakeTopProblem',
    next:     'intake_main_goal',
    question: "What's your main goal from this programme? What does success look like for you in 90 days?",
  },
  {
    stage:    'intake_main_goal',
    field:    'intakeMainGoal',
    next:     'intake_lead_gen',
    question: 'Do you need help attracting more leads or clients? Reply <b>YES</b> or <b>NO</b>.',
  },
  {
    stage:    'intake_lead_gen',
    field:    null, // boolean — intakeNeedsLeadGen
    next:     'intake_automation',
    question: 'Do you need help setting up an automated follow-up or sales system? Reply <b>YES</b> or <b>NO</b>.',
  },
  {
    stage:    'intake_automation',
    field:    null, // boolean — intakeNeedsAutomation
    next:     'intake_content',
    question: 'Do you need help with content creation or growing your social media presence? Reply <b>YES</b> or <b>NO</b>.',
  },
  {
    stage:    'intake_content',
    field:    null, // boolean — intakeNeedsContent
    next:     'intake_support_method',
    question: 'How would you prefer to receive support? (e.g. voice notes, text messages, video calls, WhatsApp)',
  },
  {
    stage:    'intake_support_method',
    field:    'intakeSupportMethod',
    next:     'done',
    question: null, // completion — triggers confirmation message
  },
]

const STAGE_MAP = Object.fromEntries(INTAKE_STAGES.map(s => [s.stage, s]))

// ── Public entry points ────────────────────────────────────────────────────────

/**
 * Process a confirmed premium payment.
 * Called exclusively from academyOnboardingService.processPaidEnrollment
 * when registration.academyPackage === 'premium'.
 *
 * @param {string} registrationId  AcademyRegistration.id
 */
async function triggerPremiumDelivery(registrationId) {
  const now = new Date()

  const registration = await prisma.academyRegistration.findUnique({
    where: { id: registrationId },
  })

  if (!registration) {
    console.error(`[PremiumDelivery] registration not found: ${registrationId}`)
    return
  }

  console.log(`[PremiumDelivery] premium payment confirmed — ${registration.fullName} (${registrationId})`)

  // ── Step 1: Initialise implementation pipeline ────────────────────────────
  // Atomic — only writes if not already initialised (implementationClient=false).
  // On webhook retries this is a no-op, and we still proceed to check onboarding.
  const claimed = await prisma.academyRegistration.updateMany({
    where: { id: registrationId, implementationClient: false },
    data: {
      deliveryTier:             'premium',
      implementationClient:     true,
      implementationStatus:     'active',
      implementationStage:      'paid',
      premiumIntakeStatus:      'pending',
      systemSetupStatus:        'not_started',
      taskIntakeReviewed:       false,
      taskScopeReady:           false,
      taskCallBooked:           false,
      taskBuildStarted:         false,
      taskDeliveryComplete:     false,
      // Prevent the legacy _processPremiumFollowupAlerts from firing a duplicate
      premiumFollowupSentAt:    now,
    },
  })

  if (claimed.count > 0) {
    console.log(`[PremiumDelivery] pipeline initialised: ${registrationId}`)
  } else {
    console.log(`[PremiumDelivery] skipped duplicate init — already active: ${registrationId}`)
  }

  // Re-read to get current state (includes telegramChatId if present)
  const reg = await prisma.academyRegistration.findUnique({ where: { id: registrationId } })

  // ── Step 2: Admin notification ────────────────────────────────────────────
  await _notifyAdminPremiumPaid(reg).catch(() => {})

  // ── Step 3: Send welcome + intake kickoff ────────────────────────────────
  if (reg.telegramChatId) {
    await _claimAndSendPremiumOnboarding(reg.id, reg, now)
  } else {
    // Telegram not connected yet — poller delivers when they tap /start
    console.log(`[PremiumDelivery] no Telegram connected — queued for later delivery: ${registrationId}`)
  }
}

/**
 * Handle a Telegram message from a premium implementation client.
 * Routes through the structured 11-step intake state machine.
 *
 * Called from telegramController.handleAcademyReply when
 * academy.implementationClient === true.
 *
 * @param {object} academy  Full AcademyRegistration record
 * @param {string} chatId
 * @param {string} text     Raw message text from user
 */
async function handlePremiumIntakeReply(academy, chatId, text) {
  const stage = academy.premiumIntakeStage

  // Intake already complete — allow free messages, don't re-run the machine
  if (stage === 'done' || academy.premiumIntakeStatus === 'complete') {
    return
  }

  // If onboarding was sent but stage not yet set, treat as start of intake
  if (!stage) {
    await _advanceIntakeStage(academy, chatId, text, 'intake_brand_name')
    return
  }

  await _advanceIntakeStage(academy, chatId, text, stage)
}

/**
 * Background poller — delivers premium welcome to buyers whose Telegram
 * connected after the payment webhook fired.
 *
 * Called from academyOnboardingService.runPendingOnboardings every 60s.
 */
async function runPendingPremiumOnboardings() {
  try {
    const now = new Date()

    const pending = await prisma.academyRegistration.findMany({
      where: {
        implementationClient:  true,
        premiumOnboardingSent: false,
        telegramChatId:        { not: null },
      },
    })

    for (const reg of pending) {
      console.log(`[PremiumDelivery] processing pending onboarding: ${reg.id} (${reg.fullName})`)
      await _claimAndSendPremiumOnboarding(reg.id, reg, now)
    }
  } catch (err) {
    console.error('[PremiumDelivery] runPendingPremiumOnboardings error:', err.message)
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Atomically claim the onboarding slot and send the premium welcome message.
 * Claim flag: premiumOnboardingSent (false → true).
 * Failure reverts claim so the next poller tick retries.
 */
async function _claimAndSendPremiumOnboarding(registrationId, registration, now) {
  const claimed = await prisma.academyRegistration.updateMany({
    where: { id: registrationId, premiumOnboardingSent: false },
    data:  { premiumOnboardingSent: true },
  })
  if (claimed.count === 0) {
    console.log(`[PremiumDelivery] skipped duplicate onboarding claim: ${registrationId}`)
    return
  }

  const msg = _buildPremiumWelcomeMessage(registration)

  try {
    const result = await sendTelegramToUser(registration.telegramChatId, msg)

    if (!result.success && !result.skipped) {
      throw new Error(result.error ? JSON.stringify(result.error) : 'telegram send failed')
    }

    await prisma.academyRegistration.update({
      where: { id: registrationId },
      data: {
        premiumOnboardingSentAt: now,
        implementationStage:     'intake_pending',
        premiumIntakeStatus:     'in_progress',
        premiumIntakeStage:      'intake_brand_name',
        // Also satisfy the base onboarding fields so poller doesn't re-trigger
        onboardingStatus:        'sent',
        onboardingSentAt:        now,
        onboardingSent:          true,
      },
    })

    await prisma.messageLog.create({
      data: {
        type:             'academy',
        recordId:         registrationId,
        channel:          'telegram',
        status:           'sent',
        auto:             true,
        triggerReason:    'premium_onboarding_payment_confirmed',
        recipient:        registration.telegramChatId,
        deliveryChannel:  'telegram',
        fallbackUsed:     false,
        providerResponse: result.data ? JSON.stringify(result.data) : null,
      },
    }).catch(e => console.error('[PremiumDelivery] MessageLog write failed:', e.message))

    console.log(`[PremiumDelivery] onboarding sent → ${registration.fullName} (${registrationId})`)

  } catch (err) {
    // Revert claim so next poller tick can retry
    await prisma.academyRegistration.update({
      where: { id: registrationId },
      data:  { premiumOnboardingSent: false },
    }).catch(() => {})

    await prisma.messageLog.create({
      data: {
        type:            'academy',
        recordId:        registrationId,
        channel:         'telegram',
        status:          'failed',
        auto:            true,
        triggerReason:   'premium_onboarding_payment_confirmed',
        recipient:       registration.telegramChatId,
        deliveryChannel: 'telegram',
        fallbackUsed:    false,
        error:           String(err.message),
      },
    }).catch(() => {})

    console.error(`[PremiumDelivery] onboarding send failed — will retry: ${registrationId}`, err.message)
  }
}

/**
 * State machine step — save the user's answer, advance stage, ask next question.
 *
 * @param {object} academy       Full AcademyRegistration record
 * @param {string} chatId
 * @param {string} text          User's raw reply text
 * @param {string} currentStage  The stage being answered right now
 */
async function _advanceIntakeStage(academy, chatId, text, currentStage) {
  const stageDef = STAGE_MAP[currentStage]
  if (!stageDef) {
    console.warn(`[PremiumDelivery] unknown intake stage: "${currentStage}" — reg ${academy.id}`)
    return
  }

  const now     = new Date()
  const trimmed = text.trim()

  // Build DB update: advance stage + save answer
  const update = { premiumIntakeStage: stageDef.next }

  if (stageDef.field) {
    update[stageDef.field] = trimmed
  } else {
    // Boolean yes/no questions
    const isYes = trimmed.toLowerCase().startsWith('y')
    if (currentStage === 'intake_lead_gen')   update.intakeNeedsLeadGen    = isYes
    if (currentStage === 'intake_automation') update.intakeNeedsAutomation = isYes
    if (currentStage === 'intake_content')    update.intakeNeedsContent    = isYes
  }

  // Finalise if this is the last stage
  if (stageDef.next === 'done') {
    update.premiumIntakeStatus      = 'complete'
    update.premiumIntakeCompletedAt = now
    update.implementationStage      = 'intake_complete'
  }

  await prisma.academyRegistration.update({
    where: { id: academy.id },
    data:  update,
  })

  if (stageDef.next === 'done') {
    const firstName = academy.fullName.split(' ')[0]
    await sendTelegramToUser(
      chatId,
      `Thank you ${firstName}! 🙌\n\n` +
      `Your intake is complete.\n\n` +
      `Our team will review your details and reach out within <b>24 hours</b> to schedule your strategy session.\n\n` +
      `Your Academy content is fully available in this chat — feel free to start any time. 🌿`
    ).catch(() => {})

    await sendTelegramMessage(
      `📋 <b>Premium Intake Complete</b>\n\n` +
      `<b>Name:</b> ${academy.fullName}\n` +
      `<b>Email:</b> ${academy.email}\n` +
      `<b>Registration:</b> ${academy.id}\n\n` +
      `<b>Next action:</b> Review intake in CRM → advance to review_pending`
    ).catch(() => {})

    console.log(`[PremiumDelivery] intake completed — ${academy.fullName} (${academy.id})`)
    return
  }

  // Ask the next question
  const nextDef = STAGE_MAP[stageDef.next]
  if (nextDef?.question) {
    await sendTelegramToUser(chatId, nextDef.question).catch(() => {})
  }

  console.log(`[PremiumDelivery] intake advanced: ${currentStage} → ${stageDef.next} (${academy.id})`)
}

// ── Message builders ───────────────────────────────────────────────────────────

function _buildPremiumWelcomeMessage(registration) {
  const firstName = registration.fullName.split(' ')[0]
  const amount    = registration.academyAmount
    ? `₦${registration.academyAmount.toLocaleString()}`
    : '₦60,000'

  return (
    `Hi ${firstName}! 🎉\n\n` +
    `Your Premium payment is confirmed. Welcome to <b>MICAHSKIN Academy — Premium</b>.\n\n` +
    `📦 <b>Package:</b> Premium ${amount}\n` +
    `✅ Full Academy access: active\n` +
    `🛠 Growth system implementation: included\n\n` +
    `<b>Here's what happens next:</b>\n` +
    `1. Answer a few quick intake questions below\n` +
    `2. We review and prepare your implementation scope\n` +
    `3. Strategy session scheduled — we build your system together\n` +
    `4. Your growth system goes live\n\n` +
    `Let's get started.\n\n` +
    `<b>What is the name of your brand (or the brand you're building)?</b>`
  )
}

async function _notifyAdminPremiumPaid(registration) {
  await sendTelegramMessage(
    `💎 <b>Premium Payment Confirmed</b>\n\n` +
    `<b>Name:</b> ${registration.fullName}\n` +
    `<b>Email:</b> ${registration.email}\n` +
    `<b>Amount:</b> ₦${(registration.academyAmount || 60000).toLocaleString()}\n` +
    `<b>Registration ID:</b> ${registration.id}\n\n` +
    `Premium implementation pipeline started.\n` +
    `Monitor intake completion in CRM → advance pipeline when ready.`
  )
}

module.exports = {
  triggerPremiumDelivery,
  handlePremiumIntakeReply,
  runPendingPremiumOnboardings,
}
