'use strict'

/**
 * academyOnboardingService.js — Phase 19: Post-Payment Onboarding Automation
 *
 * Turns a confirmed payment into a complete CRM state transition + onboarding delivery.
 *
 * Responsibilities:
 *   - processPaidEnrollment(registrationId, amountNgn)
 *       Called from the Paystack webhook immediately after charge.success.
 *       Updates all CRM fields, tracks lead conversion, sends onboarding message
 *       if Telegram is connected, or queues pending if not yet connected.
 *
 *   - runPendingOnboardings()
 *       Background poller (60s). Sends onboarding to paid registrants whose
 *       Telegram connected after the payment webhook fired. Also notifies admin
 *       about premium students needing implementation follow-up.
 *
 * Safety guarantees:
 *   - Atomic boolean claim (onboardingSent: false → true) prevents duplicate sends
 *     across concurrent webhook retries and poller ticks
 *   - Lead conversion write guarded against duplicate via conversionType check
 *   - Premium follow-up alert claimed atomically via premiumFollowupSentAt
 *   - All send failures revert the claim so next tick retries
 */

const prisma = require('../lib/prisma')
const { sendTelegramToUser, sendTelegramMessage } = require('./telegramService')
const { triggerPremiumDelivery, runPendingPremiumOnboardings } = require('./premiumDeliveryService')

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Process a confirmed payment for an academy registration.
 *
 * Handles all post-payment state transitions:
 *   1. Updates AcademyRegistration CRM fields
 *   2. Records conversion on the linked Lead (by email)
 *   3. Sends onboarding message via Telegram if connected
 *   4. Queues pending state for later delivery if Telegram not yet connected
 *
 * Safe on webhook retries — atomic claim prevents duplicate sends.
 *
 * @param {string} registrationId  AcademyRegistration.id (from Paystack metadata.leadId)
 * @param {number} amountNgn       Amount paid in Naira (converted from Paystack kobo)
 */
async function processPaidEnrollment(registrationId, amountNgn) {
  const now = new Date()

  const registration = await prisma.academyRegistration.findUnique({
    where: { id: registrationId },
  })

  if (!registration) {
    console.error(`[AcademyOnboarding] registration not found: ${registrationId}`)
    return
  }

  // Idempotency guard — already onboarded, nothing to do
  if (registration.onboardingSent === true) {
    console.log(`[AcademyOnboarding] skipped duplicate — already onboarded: ${registrationId}`)
    return
  }

  console.log(`[AcademyOnboarding] payment confirmed — ${registration.fullName} (${registrationId})`)

  const isPremium     = registration.academyPackage === 'premium'
  const onboardingPath = isPremium ? 'premium' : 'basic'

  // ── Step 1: Update AcademyRegistration CRM state ─────────────────────────
  await prisma.academyRegistration.update({
    where: { id: registrationId },
    data: {
      paymentStatus:          'paid',
      academyStatus:          'enrolled',
      enrollmentStatus:       'enrolled',
      onboardingPath,
      premiumFollowupRequired: isPremium,
      status:                 'paid',
    },
  })

  // ── Step 2: Record conversion on linked Lead ──────────────────────────────
  if (registration.email) {
    const matchedLead = await prisma.lead.findFirst({
      where:   { email: registration.email },
      orderBy: { createdAt: 'desc' },
    })
    if (matchedLead && matchedLead.conversionType !== 'academy_paid') {
      await prisma.lead.update({
        where: { id: matchedLead.id },
        data: {
          leadStage:         'converted',
          conversionType:    'academy_paid',
          conversionValue:   amountNgn,
          conversionAt:      now,
          lastInteractionAt: now,
        },
      })
      console.log(`[AcademyOnboarding] lead conversion tracked → leadId: ${matchedLead.id} | value: ${amountNgn}`)
    }
  }

  // ── Step 3: Route by package ──────────────────────────────────────────────
  if (isPremium) {
    // Premium → dedicated implementation pipeline (handles its own send + CRM state)
    await triggerPremiumDelivery(registrationId)
  } else if (registration.telegramChatId) {
    await _claimAndSend(registrationId, registration, now)
  } else {
    // Basic, Telegram not connected yet — poller delivers when they tap /start
    await prisma.academyRegistration.update({
      where: { id: registrationId },
      data:  { onboardingStatus: 'pending' },
    })
    console.log(`[AcademyOnboarding] no Telegram connected — queued pending: ${registrationId}`)
  }
}

// ── Send worker ───────────────────────────────────────────────────────────────

/**
 * Atomically claims the onboarding slot and sends the message.
 * Used by both processPaidEnrollment (immediate path) and the background poller.
 *
 * @param {string} registrationId
 * @param {object} registration   Full AcademyRegistration record (must have telegramChatId)
 * @param {Date}   now
 */
async function _claimAndSend(registrationId, registration, now) {
  // Atomic claim — prevents concurrent sends from webhook retries + poller overlap
  const claimed = await prisma.academyRegistration.updateMany({
    where: { id: registrationId, onboardingSent: false },
    data:  { onboardingSent: true },
  })
  if (claimed.count === 0) {
    console.log(`[AcademyOnboarding] skipped duplicate claim: ${registrationId}`)
    return
  }

  const msg = _buildOnboardingMessage(registration)

  try {
    const result = await sendTelegramToUser(registration.telegramChatId, msg)

    if (!result.success && !result.skipped) {
      throw new Error(result.error ? JSON.stringify(result.error) : 'telegram send failed')
    }

    await prisma.academyRegistration.update({
      where: { id: registrationId },
      data:  { onboardingStatus: 'sent', onboardingSentAt: now },
    })

    await prisma.messageLog.create({
      data: {
        type:             'academy',
        recordId:         registrationId,
        channel:          'telegram',
        status:           'sent',
        auto:             true,
        triggerReason:    'onboarding_payment_confirmed',
        recipient:        registration.telegramChatId,
        deliveryChannel:  'telegram',
        fallbackUsed:     false,
        providerResponse: result.data ? JSON.stringify(result.data) : null,
      },
    }).catch(e => console.error('[AcademyOnboarding] MessageLog write failed:', e.message))

    console.log(`[AcademyOnboarding] onboarding sent → ${registration.fullName} (${registrationId})`)

  } catch (err) {
    // Revert claim so next poller tick can retry
    await prisma.academyRegistration.update({
      where: { id: registrationId },
      data:  { onboardingSent: false, onboardingStatus: 'failed' },
    }).catch(() => {})

    await prisma.messageLog.create({
      data: {
        type:            'academy',
        recordId:        registrationId,
        channel:         'telegram',
        status:          'failed',
        auto:            true,
        triggerReason:   'onboarding_payment_confirmed',
        recipient:       registration.telegramChatId,
        deliveryChannel: 'telegram',
        fallbackUsed:    false,
        error:           String(err.message),
      },
    }).catch(e => console.error('[AcademyOnboarding] MessageLog write failed:', e.message))

    console.error(`[AcademyOnboarding] onboarding send failed — will retry: ${registrationId}`, err.message)
  }
}

// ── Message builders ──────────────────────────────────────────────────────────

function _buildOnboardingMessage(registration) {
  const firstName      = registration.fullName.split(' ')[0]
  const pkg            = registration.academyPackage || 'basic'
  const amountFormatted = registration.academyAmount
    ? `₦${registration.academyAmount.toLocaleString()}`
    : ''

  if (pkg === 'premium') {
    return (
      `Hi ${firstName}! 🎉\n\n` +
      `Your payment is confirmed. Welcome to <b>MICAHSKIN Academy — Premium</b>.\n\n` +
      `📦 <b>Package:</b> Premium ${amountFormatted}\n` +
      `✅ Academy access: confirmed\n` +
      `🛠 System implementation support: included\n\n` +
      `<b>Here's what happens next:</b>\n` +
      `1. Your first academy materials will be delivered to this chat\n` +
      `2. Reply <b>SETUP</b> when you're ready to schedule your implementation session\n` +
      `3. Reach out anytime with questions — we're here\n\n` +
      `Welcome aboard. Let's build something real. 🌿`
    )
  }

  return (
    `Hi ${firstName}! 🎉\n\n` +
    `Your payment is confirmed. Welcome to <b>MICAHSKIN Academy</b>.\n\n` +
    `📦 <b>Package:</b> Basic ${amountFormatted}\n` +
    `✅ Academy access: confirmed\n\n` +
    `<b>Here's what happens next:</b>\n` +
    `1. Your first academy materials will be delivered to this chat\n` +
    `2. Reply anytime with questions — we're here\n\n` +
    `Welcome. Let's get started. 🌿`
  )
}

// ── Background poller ─────────────────────────────────────────────────────────

/**
 * Finds paid registrations where onboarding is still pending (Telegram connected
 * after payment was confirmed) and delivers the onboarding message.
 *
 * Also fires admin notifications for premium students needing implementation follow-up.
 */
async function runPendingOnboardings() {
  try {
    const now = new Date()

    // Paid + not yet sent + Telegram now connected
    const pending = await prisma.academyRegistration.findMany({
      where: {
        paymentStatus:  'paid',
        onboardingSent: false,
        telegramChatId: { not: null },
      },
    })

    for (const reg of pending) {
      console.log(`[AcademyOnboarding] processing pending: ${reg.id} (${reg.fullName})`)
      await _claimAndSend(reg.id, reg, now)
    }

    // Premium delivery: send onboarding to premium clients whose Telegram connected after payment
    await runPendingPremiumOnboardings()

    // Legacy admin alerts for premium students (kept for existing records)
    await _processPremiumFollowupAlerts()

  } catch (err) {
    console.error('[AcademyOnboarding] runPendingOnboardings error:', err.message)
  }
}

/**
 * Notifies the admin Telegram channel about premium registrants who need
 * their implementation setup session scheduled.
 * Fires once per registrant — atomic claim via premiumFollowupSentAt.
 */
async function _processPremiumFollowupAlerts() {
  const premiumPending = await prisma.academyRegistration.findMany({
    where: {
      academyPackage:         'premium',
      paymentStatus:          'paid',
      onboardingStatus:       'sent',
      premiumFollowupRequired: true,
      premiumFollowupSentAt:  null,
    },
  })

  for (const reg of premiumPending) {
    // Atomic claim — prevent duplicate admin notifications
    const claimed = await prisma.academyRegistration.updateMany({
      where: { id: reg.id, premiumFollowupSentAt: null },
      data:  { premiumFollowupSentAt: new Date() },
    })
    if (claimed.count === 0) continue

    await sendTelegramMessage(
      `🛠 <b>Premium Follow-up Required</b>\n\n` +
      `<b>Name:</b> ${reg.fullName}\n` +
      `<b>Email:</b> ${reg.email}\n` +
      `<b>Package:</b> Premium ₦${(reg.academyAmount || 60000).toLocaleString()}\n` +
      `<b>Registration ID:</b> ${reg.id}\n\n` +
      `This student has premium access with implementation support included.\n` +
      `Schedule their setup session.`
    ).catch(() => {})

    console.log(`[AcademyOnboarding] premium follow-up queued → ${reg.fullName} (${reg.id})`)
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────

/**
 * Starts the academy onboarding background poller.
 * Runs on boot + every 60 seconds.
 */
function startAcademyOnboarding() {
  console.log('✅ Academy Onboarding Service started (pending onboardings every 60s)')
  runPendingOnboardings()
  setInterval(runPendingOnboardings, 60 * 1000)
}

module.exports = {
  processPaidEnrollment,
  startAcademyOnboarding,
  runPendingOnboardings,
}
