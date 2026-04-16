'use strict'

/**
 * conversionEngineService.js — Conversion Trigger Layer (Phase 21)
 *
 * Detects buying signals from post-diagnosis replies and moves leads
 * toward product purchase, consultation, or academy enrollment.
 *
 * Supports:
 *   - Automatic conversion triggers (reply-triggered, queued for action engine)
 *   - Manual operator actions (immediate send from CRM, no scheduling needed)
 *   - Offer state tracking + full audit logs
 *
 * Conversion paths:
 *   product_offer | consult_offer | academy_offer | no_offer
 *
 * Intent buckets (from telegramFollowUpService.classifyFollowUpIntent):
 *   progress_positive | no_change_yet | irritation | confused_about_routine |
 *   has_not_started | needs_product_help | wants_human_support | general_update
 *
 * Safety guarantees:
 *   - 24-hour auto cooldown per lead (lastConversionTriggerAt)
 *   - Per-offer-type sent flags prevent duplicate sends (productOfferSent etc.)
 *   - Manual sends always log; 1-hour window warns but does NOT block (admin override)
 *   - Closed leads always blocked
 *   - No telegramChatId → blocked, logged
 *   - manual_consult_required leads: product push blocked, consult offer only
 */

const prisma = require('../lib/prisma')
const { sendTelegramToUser } = require('./telegramService')
const { muteBot, MANUAL_MUTE_MS } = require('./conversationBrainService')

// ── Constants ─────────────────────────────────────────────────────────────────

const ACADEMY_LINK  = process.env.ACADEMY_LINK  || 'https://micahskin-growth-engine.vercel.app/academy'
const WHATSAPP_LINK = process.env.WHATSAPP_LINK || 'https://wa.me/+2348140468759'
const ACADEMY_FIT_THRESHOLD = parseInt(process.env.ACADEMY_FIT_THRESHOLD || '65', 10)

// 24 hours cooldown before auto-triggering another conversion offer on the same lead
const AUTO_COOLDOWN_MS = 24 * 60 * 60 * 1000

// Delay (ms) from when a reply is received to when the queued offer fires.
// 0 = picked up on next action engine tick (≈60s). Set longer for passive signals.
const OFFER_DELAY_MS = {
  needs_product_help:      2  * 60 * 1000,   // 2 min
  wants_human_support:     2  * 60 * 1000,   // 2 min
  progress_positive:       20 * 60 * 1000,   // 20 min — good signal, don't rush
  irritation:              30 * 60 * 1000,   // 30 min — let first advice land
  confused_about_routine:  10 * 60 * 1000,   // 10 min
  has_not_started:         15 * 60 * 1000,   // 15 min — address blocker first
  no_change_yet:           null,             // skip auto
  general_update:          null,             // skip auto
}

// ── Intent evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluate a post-diagnosis reply intent and produce a conversion recommendation.
 *
 * @param {object} lead      Full Lead record
 * @param {string} intent    Intent bucket from classifyFollowUpIntent
 * @returns {{ conversionPath: string, shouldAutoSend: boolean, delayMs: number|null }}
 */
function evaluateConversionIntentFromReply(lead, intent) {
  const needsManualConsult =
    lead.urgencyLevel === 'high' || lead.nextBestAction === 'manual_consult'

  const delayMs = OFFER_DELAY_MS[intent] ?? null
  if (delayMs === null) {
    console.log(`[ConversionEngine] intent=${intent} → no auto offer (passive signal)`)
    return { conversionPath: 'no_offer', shouldAutoSend: false, delayMs: null }
  }

  // High-urgency / clinical leads: consult only, no product push
  if (needsManualConsult) {
    console.log(`[ConversionEngine] intent=${intent} → consult_offer (manual_consult override)`)
    return { conversionPath: 'consult_offer', shouldAutoSend: true, delayMs }
  }

  const path = determineConversionPath(lead, intent)
  const shouldAutoSend = path !== 'no_offer'

  console.log(`[ConversionEngine] intent=${intent} → path=${path} shouldAutoSend=${shouldAutoSend}`)
  return { conversionPath: path, shouldAutoSend, delayMs }
}

/**
 * Determine the most appropriate conversion path for this lead + intent combo.
 *
 * Priority order:
 *   1. consult_offer  — wants direct human help OR has irritation
 *   2. product_offer  — knows what they want / positive progress / confused
 *   3. academy_offer  — strong fit score, appropriate context
 *   4. no_offer       — fallback
 *
 * @param {object} lead
 * @param {string} intent
 * @returns {string}  conversionPath
 */
function determineConversionPath(lead, intent) {
  // Explicit human-support signals → consult
  if (intent === 'wants_human_support' || intent === 'irritation') {
    return 'consult_offer'
  }

  // Direct product-help request → product offer immediately
  if (intent === 'needs_product_help') {
    return 'product_offer'
  }

  // Positive progress → push the exact recommended products
  if (intent === 'progress_positive') {
    // If academy fit is very strong, upsell to academy
    if (
      lead.academyFitScore != null &&
      lead.academyFitScore >= ACADEMY_FIT_THRESHOLD &&
      !lead.academyOfferSent
    ) {
      return 'academy_offer'
    }
    return 'product_offer'
  }

  // Confused about routine → offer the exact product set + simple explanation
  if (intent === 'confused_about_routine') {
    return 'product_offer'
  }

  // Has not started → offer a simplified starter product path
  if (intent === 'has_not_started') {
    return 'product_offer'
  }

  return 'no_offer'
}

// ── Offer decision guards ─────────────────────────────────────────────────────

/**
 * Returns true if the product offer should be sent for this lead.
 * Blocked when: manual_consult required, already sent, or lead converted.
 *
 * @param {object} lead
 * @param {string} intent
 */
function shouldSendProductOffer(lead, intent) {
  if (lead.status === 'closed') return false
  if (lead.productOfferSent) return false
  if (lead.conversionType) return false  // already converted
  if (lead.urgencyLevel === 'high' || lead.nextBestAction === 'manual_consult') return false
  return true
}

/**
 * Returns true if the consult offer should be sent for this lead.
 * Blocked when: already sent, or lead converted.
 *
 * @param {object} lead
 * @param {string} intent
 */
function shouldSendConsultOffer(lead, intent) {
  if (lead.status === 'closed') return false
  if (lead.consultOfferSent) return false
  if (lead.conversionType) return false
  return true
}

/**
 * Returns true if the academy offer should be sent for this lead.
 * Blocked when: academy not a fit, already sent, or lead converted.
 *
 * @param {object} lead
 * @param {string} intent
 */
function shouldSendAcademyOffer(lead, intent) {
  if (lead.status === 'closed') return false
  if (lead.academyOfferSent) return false
  if (lead.conversionType === 'academy_paid') return false
  if (lead.academyFitScore == null || lead.academyFitScore < ACADEMY_FIT_THRESHOLD) return false
  if (lead.urgencyLevel === 'high' || lead.nextBestAction === 'manual_consult') return false
  return true
}

// ── Message builders ──────────────────────────────────────────────────────────

function _firstName(lead) {
  return (lead.fullName || '').split(' ')[0] || 'there'
}

function _concern(lead) {
  return (lead.primaryConcern || lead.skinConcern || 'your skin concern').replace(/_/g, ' ')
}

/**
 * Build a product offer message — explicit purchase CTA with product detail.
 *
 * @param {object} lead
 * @param {object} [opts]
 * @param {string} [opts.context]  Optional override context (e.g., 'has_not_started')
 * @returns {string}
 */
function buildProductOfferMessage(lead, opts = {}) {
  const firstName = _firstName(lead)
  const concern   = _concern(lead)
  const context   = opts.context || lead.followUpIntent || 'general'

  let intro = ''
  if (context === 'progress_positive') {
    intro =
      `Great news — if your skin is tolerating the routine well, it means you're ready for the next step.\n\n` +
      `The real difference between okay results and visible results is usually having the <b>right active ingredients</b> — not just any moisturiser.`
  } else if (context === 'has_not_started') {
    intro =
      `No problem. Let me make this as simple as possible for you.\n\n` +
      `You don't need to do everything at once. Here's the one product to start with — it addresses ${concern} directly without overwhelming your skin.`
  } else if (context === 'confused_about_routine') {
    intro =
      `Let me simplify this. Instead of guessing which products work for ${concern}, here are the exact ones — matched to what you shared.`
  } else if (context === 'needs_product_help') {
    intro =
      `Happy to point you in the right direction.\n\n` +
      `Based on what you shared about ${concern}, here's what I'd recommend specifically:`
  } else {
    intro =
      `Based on your skin profile and what you've shared about ${concern}, here are the exact products I'd suggest:`
  }

  const productSection = lead.recommendedProductsText
    ? `\n\n<b>Your personalised product set:</b>\n${lead.recommendedProductsText}`
    : ''

  const budgetNote = lead.telegramBudget
    ? `\n\nThese are matched to your ${lead.telegramBudget} budget range.`
    : ''

  const cta =
    `\n\nTo get these or check availability, message us directly:\n` +
    `👉 ${WHATSAPP_LINK}\n\n` +
    `Or reply here with any questions — I'm happy to help you pick the best starting point.`

  return `${intro}${productSection}${budgetNote}${cta}`
}

/**
 * Build a consultation offer message — personal guidance framing.
 *
 * @param {object} lead
 * @param {object} [opts]
 * @param {string} [opts.context]
 * @returns {string}
 */
function buildConsultOfferMessage(lead, opts = {}) {
  const firstName = _firstName(lead)
  const concern   = _concern(lead)
  const context   = opts.context || lead.followUpIntent || 'general'

  let urgencyNote = ''
  if (context === 'irritation') {
    urgencyNote =
      `\n\nGiven that your skin is reacting, this is exactly when a quick one-on-one guidance session matters most — ` +
      `before you try anything new that could make things worse.`
  } else if (lead.urgencyLevel === 'high') {
    urgencyNote =
      `\n\nBased on the severity of your concern, we'd prefer to speak with you directly rather than give a generic answer.`
  }

  return (
    `Hi ${firstName} 👋\n\n` +
    `For ${concern}, the best next step is a direct consultation — so we can look at your specific situation properly.\n\n` +
    `This isn't about products. It's about figuring out exactly what works for <b>your</b> skin.` +
    urgencyNote +
    `\n\nHere's what a consult covers:\n` +
    `• Your exact skin concern — what's driving it\n` +
    `• What to avoid (products or habits making it worse)\n` +
    `• A realistic timeline and routine that fits your life\n` +
    `• The fastest safe next action\n\n` +
    `Message us directly to get started:\n` +
    `👉 ${WHATSAPP_LINK}`
  )
}

/**
 * Build an academy offer message — outcome-led, referencing their journey.
 *
 * @param {object} lead
 * @param {object} [opts]
 * @returns {string}
 */
function buildAcademyOfferMessage(lead, opts = {}) {
  const firstName = _firstName(lead)
  const concern   = _concern(lead)
  const trackableLink = `${ACADEMY_LINK}?leadId=${lead.id}`

  return (
    `Hi ${firstName} 🎯\n\n` +
    `You've been asking the right questions about ${concern} — which tells me you're someone who actually wants to understand their skin, not just get a quick fix.\n\n` +
    `That's exactly the kind of person the MICAHSKIN Academy is built for.\n\n` +
    `<b>What you'll learn:</b>\n` +
    `• Why ${concern} happens and what drives it\n` +
    `• Which ingredients actually work — and which to avoid\n` +
    `• How to build a routine that delivers visible results in weeks\n` +
    `• How to stop wasting money on the wrong products\n\n` +
    `This is a full framework — not tips content.\n\n` +
    `👉 Register here:\n` +
    `${trackableLink}\n\n` +
    `Reply <b>ACADEMY</b> if you'd like more details before you decide.`
  )
}

/**
 * Build a context-aware message seed for admin custom messages.
 * Returns a suggested draft based on lead diagnosis + journey context.
 *
 * @param {object} lead
 * @returns {string}
 */
function buildCustomConversionContext(lead) {
  const firstName = _firstName(lead)
  const concern   = _concern(lead)

  const diagNote = lead.diagnosisSummary
    ? `Diagnosis: ${lead.diagnosisSummary.slice(0, 120)}${lead.diagnosisSummary.length > 120 ? '…' : ''}`
    : ''
  const productNote = lead.recommendedProductsText
    ? `Products: ${lead.recommendedProductsText.slice(0, 120)}${lead.recommendedProductsText.length > 120 ? '…' : ''}`
    : ''
  const intentNote = lead.followUpIntent
    ? `Last reply intent: ${lead.followUpIntent.replace(/_/g, ' ')}`
    : ''

  const context = [diagNote, productNote, intentNote].filter(Boolean).join('\n')

  return (
    `Hi ${firstName},\n\n` +
    `Following up on your ${concern} journey — just wanted to check in and see how things are going.\n\n` +
    `[Edit this message with your specific offer or question]\n\n` +
    `${context ? `\n---\nContext:\n${context}` : ''}`
  )
}

// ── Automatic conversion trigger ──────────────────────────────────────────────

/**
 * Called after a post-diagnosis reply has been handled.
 * Evaluates whether an automatic conversion offer should be queued.
 * Uses a 24-hour cooldown per lead and per-offer-type sent flags to prevent spam.
 *
 * This function is non-blocking — call it with .catch() in the controller.
 *
 * @param {object} lead   Lead record at the time of the reply (may be pre-update)
 * @param {string} intent Intent from classifyFollowUpIntent
 */
async function maybeTriggerAutomaticConversion(lead, intent) {
  // Fetch fresh lead state to work with up-to-date flags
  const freshLead = await prisma.lead.findUnique({ where: { id: lead.id } })
  if (!freshLead) return

  // Block conditions
  if (freshLead.status === 'closed') {
    console.log(`[ConversionEngine] blocked (lead closed) → ${freshLead.id}`)
    return
  }
  if (!freshLead.telegramChatId) {
    console.log(`[ConversionEngine] blocked (no telegram channel) → ${freshLead.id}`)
    return
  }
  if (freshLead.conversionType) {
    console.log(`[ConversionEngine] blocked (already converted: ${freshLead.conversionType}) → ${freshLead.id}`)
    return
  }

  // 24-hour cooldown
  if (freshLead.lastConversionTriggerAt) {
    const elapsed = Date.now() - new Date(freshLead.lastConversionTriggerAt).getTime()
    if (elapsed < AUTO_COOLDOWN_MS) {
      console.log(
        `[ConversionEngine] blocked (cooldown: ${Math.round(elapsed / 60000)}m elapsed of ${AUTO_COOLDOWN_MS / 60000}m) → ${freshLead.id}`
      )
      return
    }
  }

  const { conversionPath, shouldAutoSend, delayMs } = evaluateConversionIntentFromReply(freshLead, intent)

  if (!shouldAutoSend || conversionPath === 'no_offer') {
    console.log(`[ConversionEngine] no auto offer for intent=${intent} → ${freshLead.id}`)
    return
  }

  // Check if the specific offer type was already sent
  if (conversionPath === 'product_offer' && freshLead.productOfferSent) {
    console.log(`[ConversionEngine] blocked (productOfferSent already) → ${freshLead.id}`)
    return
  }
  if (conversionPath === 'consult_offer' && freshLead.consultOfferSent) {
    console.log(`[ConversionEngine] blocked (consultOfferSent already) → ${freshLead.id}`)
    return
  }
  if (conversionPath === 'academy_offer' && freshLead.academyOfferSent) {
    console.log(`[ConversionEngine] blocked (academyOfferSent already) → ${freshLead.id}`)
    return
  }

  const now         = new Date()
  const sendAfter   = new Date(now.getTime() + delayMs)

  // Queue the offer for the action engine to pick up
  await prisma.lead.update({
    where: { id: freshLead.id },
    data: {
      conversionOfferSendAfter:   sendAfter,
      conversionOfferSent:        false,
      conversionOfferStatus:      'pending',
      conversionOfferPath:        conversionPath,
      lastConversionIntent:       intent,
      lastConversionTriggerAt:    now,
      conversionStage:            'interested',
    },
  })

  console.log(
    `[ConversionEngine] auto send → queued ${conversionPath} for lead=${freshLead.id} ` +
    `intent=${intent} sendAfter=${sendAfter.toISOString()}`
  )
}

// ── Manual conversion action ──────────────────────────────────────────────────

/**
 * Send a conversion action immediately from the CRM.
 * Bypasses scheduling — sends right now.
 *
 * @param {object} params
 * @param {string} params.leadId
 * @param {string} params.actionType    product_offer | consult_offer | academy_offer | resend_payment | custom_message
 * @param {string} [params.adminName]   Who triggered it (for audit)
 * @param {string} [params.note]        Optional admin note
 * @param {string} [params.customMessage]  Required when actionType=custom_message
 * @returns {Promise<{ success: boolean, message?: string, sentPreview?: string, blocked?: string }>}
 */
async function sendManualConversionAction({ leadId, actionType, adminName = 'admin', note = '', customMessage = '' }) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) {
    return { success: false, blocked: 'lead_not_found' }
  }

  console.log(`[ConversionEngine] manual send → leadId=${leadId} action=${actionType} by=${adminName}`)

  // Block conditions
  if (lead.status === 'closed') {
    console.log(`[ConversionEngine] blocked (lead closed) → ${leadId}`)
    return { success: false, blocked: 'lead_closed', message: 'Lead is closed.' }
  }
  if (!lead.telegramChatId) {
    console.log(`[ConversionEngine] blocked (no telegram channel) → ${leadId}`)
    return { success: false, blocked: 'no_delivery_channel', message: 'No Telegram channel connected.' }
  }

  const now = new Date()

  // Build the message to send
  let msgText = ''
  const context = lead.followUpIntent || 'general'

  switch (actionType) {
    case 'product_offer':
      if (lead.urgencyLevel === 'high' || lead.nextBestAction === 'manual_consult') {
        console.log(`[ConversionEngine] blocked product push (manual consult required) → ${leadId}`)
        return {
          success: false,
          blocked: 'manual_consult_required',
          message: 'This lead requires a consultation — product push is blocked. Use "Send Consult Offer" instead.',
        }
      }
      msgText = buildProductOfferMessage(lead, { context })
      break

    case 'consult_offer':
      msgText = buildConsultOfferMessage(lead, { context })
      break

    case 'academy_offer':
      msgText = buildAcademyOfferMessage(lead)
      break

    case 'resend_payment':
      msgText = _buildPaymentLinkMessage(lead)
      break

    case 'custom_message':
      if (!customMessage || !customMessage.trim()) {
        return { success: false, blocked: 'empty_message', message: 'Custom message cannot be empty.' }
      }
      msgText = customMessage.trim()
      break

    default:
      return { success: false, blocked: 'invalid_action_type', message: `Unknown actionType: ${actionType}` }
  }

  // Send via Telegram
  let sendResult
  try {
    sendResult = await sendTelegramToUser(lead.telegramChatId, msgText)
  } catch (err) {
    console.error(`[ConversionEngine] Telegram send error for lead ${leadId}:`, err.message)
    sendResult = { success: false, error: err.message }
  }

  const sentOk = sendResult?.success === true || sendResult?.skipped === true

  // Log the send
  await prisma.messageLog.create({
    data: {
      type:             'lead',
      recordId:         leadId,
      channel:          'telegram',
      status:           sentOk ? 'sent' : 'failed',
      auto:             false,
      triggerReason:    `manual_${actionType}`,
      recipient:        String(lead.telegramChatId),
      deliveryChannel:  'telegram',
      fallbackUsed:     false,
      error:            sentOk ? null : String(sendResult?.error || 'send failed'),
    },
  }).catch(e => console.error('[ConversionEngine] MessageLog write failed:', e.message))

  if (!sentOk) {
    return { success: false, message: `Telegram delivery failed: ${sendResult?.error || 'unknown error'}` }
  }

  // Build the DB update based on action type
  const dbUpdate = {
    lastManualActionType:    actionType,
    lastManualActionAt:      now,
    lastManualActionBy:      adminName,
    manualOverrideNote:      note || null,
    lastSalesMessagePreview: msgText.slice(0, 300),
    conversionAttempts:      { increment: 1 },
    conversionStage:         'offer_sent',
  }

  // ── Conversation Brain: conversation mode + offer counters ──────────────────
  // Map action type → conversation mode the lead is now in
  const modeByAction = {
    product_offer:  'product_reco_active',
    consult_offer:  'consult_active',
    academy_offer:  'academy_pitch_active',
    resend_payment: 'payment_pending',
    custom_message: 'human_manual_mode',
  }
  dbUpdate.conversationMode   = modeByAction[actionType] || 'human_manual_mode'
  dbUpdate.lastBotIntent      = `manual_${actionType}`
  dbUpdate.lastMeaningfulBotAt = now

  if (actionType === 'product_offer') {
    dbUpdate.productOfferSent   = true
    dbUpdate.productOfferSentAt = now
    dbUpdate.productOfferStatus = 'sent'
    dbUpdate.conversionPath     = 'product_offer'
    dbUpdate.productOfferCount  = { increment: 1 }
  } else if (actionType === 'consult_offer') {
    dbUpdate.consultOfferSent   = true
    dbUpdate.consultOfferSentAt = now
    dbUpdate.consultOfferStatus = 'sent'
    dbUpdate.conversionPath     = 'consult_offer'
    dbUpdate.consultOfferCount  = { increment: 1 }
  } else if (actionType === 'academy_offer') {
    dbUpdate.academyOfferSent   = true
    dbUpdate.academyOfferSentAt = now
    dbUpdate.academyOfferStatus = 'sent'
    dbUpdate.conversionPath     = 'academy_offer'
    dbUpdate.academyPitchCount  = { increment: 1 }
  } else if (actionType === 'resend_payment') {
    dbUpdate.paymentLinkLastSentAt = now
    dbUpdate.conversionPath        = 'academy_offer'
  }

  await prisma.lead.update({ where: { id: leadId }, data: dbUpdate })

  // Mute automated follow-ups for 4 hours — admin has taken the wheel.
  // Non-blocking: if this fails the send result is still returned successfully.
  muteBot(leadId, MANUAL_MUTE_MS).catch(err =>
    console.error(`[ConversionEngine] muteBot failed for lead=${leadId}:`, err.message)
  )

  console.log(`[ConversionEngine] manual send success → ${actionType} to lead=${leadId} by=${adminName}`)

  return {
    success:     true,
    sentPreview: msgText.slice(0, 200) + (msgText.length > 200 ? '…' : ''),
  }
}

// ── Payment link helper ───────────────────────────────────────────────────────

function _buildPaymentLinkMessage(lead) {
  const firstName = _firstName(lead)
  const trackableLink = `${ACADEMY_LINK}?leadId=${lead.id}`

  return (
    `Hi ${firstName} 👋\n\n` +
    `Just following up on the Academy access — your spot is still reserved.\n\n` +
    `If you're ready to complete your registration, here's the link:\n` +
    `👉 ${trackableLink}\n\n` +
    `Feel free to reply if you have any questions before completing payment.`
  )
}

// ── Mark conversion event ─────────────────────────────────────────────────────

/**
 * Mark a conversion milestone on a lead record.
 *
 * @param {string} leadId
 * @param {string} eventType   offer_sent | payment_initiated | converted | declined
 * @param {object} [extras]    Additional fields to merge
 */
async function markConversionEvent(leadId, eventType, extras = {}) {
  const stageMap = {
    offer_sent:          'offer_sent',
    payment_initiated:   'payment_pending',
    converted:           'converted',
    declined:            'declined',
  }

  const data = {
    conversionStage: stageMap[eventType] || 'interested',
    ...extras,
  }

  await prisma.lead.update({ where: { id: leadId }, data }).catch(err => {
    console.error(`[ConversionEngine] markConversionEvent failed for ${leadId}:`, err.message)
  })
}

// ── Process queued conversion offers (called by action engine) ────────────────

/**
 * Pick up leads with a queued reply-triggered conversion offer that is now due.
 * Called every 60s by the action engine.
 */
async function processQueuedConversionOffers() {
  const now = new Date()

  const leads = await prisma.lead.findMany({
    where: {
      conversionOfferSendAfter: { lte: now },
      conversionOfferSent:      false,
      conversionOfferPath:      { not: null },
      telegramChatId:           { not: null },
    },
  })

  for (const lead of leads) {
    if (lead.status === 'closed') {
      console.log(`[ConversionEngine] skipped queued offer (lead closed) → ${lead.id}`)
      // Mark as skipped so we don't keep re-evaluating
      await prisma.lead.update({
        where: { id: lead.id },
        data: { conversionOfferSent: true, conversionOfferStatus: 'skipped' },
      }).catch(() => {})
      continue
    }

    // Atomic claim
    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, conversionOfferSent: false },
      data:  { conversionOfferSent: true },
    })
    if (claimed.count === 0) continue  // claimed by concurrent process

    const path = lead.conversionOfferPath

    // Re-validate guards at send time (state may have changed since queuing)
    let blocked = null
    if (!lead.telegramChatId) blocked = 'no_delivery_channel'
    else if (path === 'product_offer' && (lead.productOfferSent || lead.urgencyLevel === 'high' || lead.nextBestAction === 'manual_consult')) blocked = 'product_blocked'
    else if (path === 'consult_offer' && lead.consultOfferSent)  blocked = 'consult_already_sent'
    else if (path === 'academy_offer' && lead.academyOfferSent)  blocked = 'academy_already_sent'
    else if (path === 'academy_offer' && (lead.academyFitScore == null || lead.academyFitScore < ACADEMY_FIT_THRESHOLD)) blocked = 'academy_fit_too_low'
    else if (lead.conversionType) blocked = 'already_converted'

    if (blocked) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          conversionOfferStatus:  'blocked',
          actionBlockedReason:    blocked,
        },
      })
      console.log(`[ConversionEngine] blocked queued offer (${blocked}) path=${path} → ${lead.id}`)
      continue
    }

    console.log(`[ConversionEngine] auto send → ${path} for lead=${lead.id}`)

    // Build message
    let msg = ''
    const context = lead.followUpIntent || 'general'
    try {
      if (path === 'product_offer')  msg = buildProductOfferMessage(lead, { context })
      else if (path === 'consult_offer') msg = buildConsultOfferMessage(lead, { context })
      else if (path === 'academy_offer') msg = buildAcademyOfferMessage(lead)
      else {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { conversionOfferStatus: 'skipped' },
        })
        continue
      }

      const result = await sendTelegramToUser(lead.telegramChatId, msg)
      if (!result.success && !result.skipped) throw new Error(JSON.stringify(result.error) || 'send failed')

      const now2 = new Date()
      const modeByPath = {
        product_offer: 'product_reco_active',
        consult_offer: 'consult_active',
        academy_offer: 'academy_pitch_active',
      }
      const offerUpdate = {
        conversionOfferSentAt:   now2,
        conversionOfferStatus:   'sent',
        conversionStage:         'offer_sent',
        conversionPath:          path,
        lastSalesMessagePreview: msg.slice(0, 300),
        conversionAttempts:      { increment: 1 },
        // Brain state
        conversationMode:        modeByPath[path] || 'product_reco_active',
        lastBotIntent:           `auto_${path}`,
        lastMeaningfulBotAt:     now2,
      }
      if (path === 'product_offer') {
        offerUpdate.productOfferSent   = true
        offerUpdate.productOfferSentAt = now2
        offerUpdate.productOfferStatus = 'sent'
        offerUpdate.productOfferCount  = { increment: 1 }
      } else if (path === 'consult_offer') {
        offerUpdate.consultOfferSent   = true
        offerUpdate.consultOfferSentAt = now2
        offerUpdate.consultOfferStatus = 'sent'
        offerUpdate.consultOfferCount  = { increment: 1 }
      } else if (path === 'academy_offer') {
        offerUpdate.academyOfferSent   = true
        offerUpdate.academyOfferSentAt = now2
        offerUpdate.academyOfferStatus = 'sent'
        offerUpdate.academyPitchCount  = { increment: 1 }
      }

      await prisma.lead.update({ where: { id: lead.id }, data: offerUpdate })

      // Log
      await prisma.messageLog.create({
        data: {
          type:            'lead',
          recordId:        lead.id,
          channel:         'telegram',
          status:          'sent',
          auto:            true,
          triggerReason:   `auto_conversion_${path}`,
          recipient:       String(lead.telegramChatId),
          deliveryChannel: 'telegram',
          fallbackUsed:    false,
        },
      }).catch(e => console.error('[ConversionEngine] MessageLog write failed:', e.message))

      console.log(`[ConversionEngine] auto send success → ${path} to lead=${lead.id}`)

    } catch (err) {
      console.error(`[ConversionEngine] queued offer FAILED for lead=${lead.id}:`, err.message)
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          conversionOfferSent:   false,  // revert claim so next tick retries
          conversionOfferStatus: 'failed',
        },
      }).catch(() => {})
    }
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  evaluateConversionIntentFromReply,
  determineConversionPath,
  shouldSendProductOffer,
  shouldSendConsultOffer,
  shouldSendAcademyOffer,
  buildProductOfferMessage,
  buildConsultOfferMessage,
  buildAcademyOfferMessage,
  buildCustomConversionContext,
  maybeTriggerAutomaticConversion,
  sendManualConversionAction,
  markConversionEvent,
  processQueuedConversionOffers,
}
