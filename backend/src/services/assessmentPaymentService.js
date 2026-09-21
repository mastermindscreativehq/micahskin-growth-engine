'use strict'

/**
 * assessmentPaymentService.js
 *
 * Inserts a ₦10,000 Paystack payment gate INTO the existing Telegram
 * diagnosis pipeline. This is NOT a second assessment system — it only
 * delays the existing diagnoseLead(leadId) call (diagnosisEngineService.js)
 * until payment is verified, then calls it unchanged.
 *
 * Call sites that used to call diagnoseLead() directly now call
 * requireAssessmentPayment() instead:
 *   - telegramSessionService.js (ASK_IMAGE / SKIP branch)
 *   - skinImageService.js (5th-photo-upload branch)
 *
 * Reuses the existing generic PaymentTransaction model (type: 'skin_assessment',
 * quoteId left null) — no new payment/session model. Reuses the existing
 * Paystack webhook branch in paystackController.js (metadata.type routing,
 * already in place) and the same reference-based idempotency pattern used by
 * the product-quote flow (handleProductQuotePayment).
 *
 * The ₦10,000 fee is its own standalone transaction — it is never written to
 * Lead.paymentStatus/paidAt/lastPaidAmount (those fields are reserved for
 * product-purchase semantics elsewhere in the CRM); Lead.telegramStage plus
 * the PaymentTransaction row are the only records of this payment.
 */

const crypto = require('crypto')
const https = require('https')
const prisma = require('../lib/prisma')
const { diagnoseLead } = require('./diagnosisEngineService')
const { sendTelegramToUser, sendTelegramMessage } = require('./telegramService')
const { logFunnelEvent } = require('./funnelEventService')
const {
  ASSESSMENT_FEE_NGN,
  ASSESSMENT_FEE_KOBO,
  ASSESSMENT_PAYMENT_TYPE,
  ASSESSMENT_CURRENCY,
} = require('../config/assessmentConfig')

const LEAD_BOT_TOKEN = process.env.TELEGRAM_LEAD_BOT_TOKEN

// ── Paystack helpers (same pattern as paystackController.js / productQuoteService.js) ──

function paystackPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function paystackGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path,
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    }
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

// Telegram-sourced leads usually have no email — Paystack's /transaction/initialize
// requires a non-empty email string. This placeholder is never used for
// communication (all messaging stays in Telegram); a real lead.email is
// preferred whenever one exists.
function resolveEmail(lead, chatId) {
  return lead.email || `tg${chatId}@micahskin.ng`
}

// ── Payment gate — replaces the direct diagnoseLead() call at intake completion ──

/**
 * Called at the exact point the existing pipeline used to call diagnoseLead()
 * directly: after the questionnaire + image stage complete. Sends a Paystack
 * link over Telegram and puts the Lead in a payment-pending stage. Preserves
 * all existing Lead/TelegramSession data untouched — no data is duplicated
 * into a new system.
 *
 * @param {string} leadId
 * @param {string} chatId  Telegram chat id (same as lead.telegramChatId)
 */
async function requireAssessmentPayment(leadId, chatId) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) {
    console.error(`[AssessmentPayment] lead not found | leadId=${leadId}`)
    return
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: { telegramStage: 'awaiting_assessment_payment' },
  })

  if (!process.env.PAYSTACK_SECRET_KEY) {
    console.error('[AssessmentPayment] PAYSTACK_SECRET_KEY not set — cannot generate payment link')
    await sendTelegramToUser(
      chatId,
      "We're unable to process payments right now. Please contact us and we'll sort this out.",
      LEAD_BOT_TOKEN
    ).catch(() => {})
    return
  }

  const reference = `msk_assess_${leadId.slice(-8)}_${crypto.randomBytes(4).toString('hex')}`
  const email = resolveEmail(lead, chatId)

  console.log(`[AssessmentPayment] initializing | leadId=${leadId} reference=${reference} amount=₦${ASSESSMENT_FEE_NGN}`)

  const paystackRes = await paystackPost('/transaction/initialize', {
    email,
    amount: ASSESSMENT_FEE_KOBO,
    reference,
    currency: ASSESSMENT_CURRENCY,
    metadata: { leadId, type: ASSESSMENT_PAYMENT_TYPE },
  }).catch((err) => {
    console.error(`[AssessmentPayment] Paystack request failed | leadId=${leadId}:`, err.message)
    return null
  })

  if (!paystackRes || !paystackRes.status || !paystackRes.data?.authorization_url) {
    console.error(`[AssessmentPayment] Paystack init failed | leadId=${leadId}`, paystackRes)
    await sendTelegramToUser(
      chatId,
      "We couldn't generate your payment link just now. Please try again shortly, or contact us.",
      LEAD_BOT_TOKEN
    ).catch(() => {})
    await sendTelegramMessage(
      `⚠️ <b>Assessment payment link failed</b>\n\n` +
      `<b>Lead:</b> ${lead.fullName}\n` +
      `<b>Lead ID:</b> ${leadId}\n\n` +
      `Customer is awaiting the ₦${ASSESSMENT_FEE_NGN.toLocaleString('en-NG')} payment prompt — please follow up manually.`
    ).catch(() => {})
    return
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: { paymentLinkLastSentAt: new Date() },
  })

  const message = [
    `👉 <b>Unlock your Personalized Skin Assessment</b>`,
    '',
    `One-time fee: <b>₦${ASSESSMENT_FEE_NGN.toLocaleString('en-NG')}</b>`,
    '',
    'This fee covers your personalized skin assessment only — it is not a product purchase or deposit.',
    '',
    `${paystackRes.data.authorization_url}`,
    '',
    "Once payment is confirmed, we'll send your personalized diagnosis and recommendations right here.",
  ].join('\n')

  await sendTelegramToUser(chatId, message, LEAD_BOT_TOKEN).catch((err) =>
    console.error(`[AssessmentPayment] payment prompt send failed | leadId=${leadId}:`, err.message)
  )

  logFunnelEvent({
    eventType: 'assessment_payment_started',
    leadId,
    value: ASSESSMENT_FEE_NGN,
  }).catch(() => {})

  console.log(`[AssessmentPayment] payment_required | leadId=${leadId} reference=${reference}`)
}

// ── Webhook handler — resumes the existing pipeline after verified payment ──

/**
 * Called from paystackController.js's webhook when metadata.type === 'skin_assessment'.
 * On verified success, calls the EXISTING diagnoseLead(leadId) — unchanged —
 * which resumes the pipeline exactly where it already was (actionEngineService.js's
 * existing 60s poller takes over delivery from there, with no changes to it).
 *
 * @param {object} event  Paystack webhook event (event.data.{reference,amount,currency,metadata,...})
 */
async function handleAssessmentPaymentWebhook(event) {
  const { reference, channel, metadata, paid_at } = event.data || {}
  const { leadId } = metadata || {}

  console.log(`[AssessmentPaymentWebhook] received | ref=${reference} leadId=${leadId}`)

  if (!leadId) {
    console.error('[AssessmentPaymentWebhook] missing leadId in metadata', metadata)
    return
  }

  // Idempotency — reference-based guard (same pattern as handleProductQuotePayment)
  const existingTx = await prisma.paymentTransaction.findUnique({ where: { paystackReference: reference } })
  if (existingTx) {
    console.log(`[AssessmentPaymentWebhook] already_processed | ref=${reference}`)
    return
  }

  // Verify with Paystack directly — never trust the webhook payload's own claim alone
  const verify = await paystackGet(`/transaction/verify/${encodeURIComponent(reference)}`)
  if (!verify.status || verify.data?.status !== 'success') {
    console.error(`[AssessmentPaymentWebhook] verification failed | ref=${reference} status=${verify.data?.status}`)
    return
  }

  const verifiedAmountNgn = (verify.data.amount ?? 0) / 100
  const verifiedCurrency = verify.data.currency

  if (verifiedCurrency !== ASSESSMENT_CURRENCY) {
    console.error(`[AssessmentPaymentWebhook] currency mismatch | ref=${reference} currency=${verifiedCurrency}`)
    return
  }
  if (Math.abs(verifiedAmountNgn - ASSESSMENT_FEE_NGN) > 0.5) {
    console.error(`[AssessmentPaymentWebhook] amount mismatch | ref=${reference} paid=₦${verifiedAmountNgn} expected=₦${ASSESSMENT_FEE_NGN}`)
    return
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) {
    console.error(`[AssessmentPaymentWebhook] lead not found | leadId=${leadId}`)
    return
  }

  // Ownership/context + replay guard: only a lead currently awaiting THIS payment
  // can be unlocked by it. Once unlocked, telegramStage moves off this value, so
  // a duplicate/late webhook for an already-progressed lead is a safe no-op.
  if (lead.telegramStage !== 'awaiting_assessment_payment') {
    console.log(`[AssessmentPaymentWebhook] lead not awaiting payment (stage=${lead.telegramStage}) — ignoring | leadId=${leadId} ref=${reference}`)
    return
  }

  const paidAt = paid_at ? new Date(paid_at) : new Date()

  await prisma.paymentTransaction.create({
    data: {
      leadId,
      type: ASSESSMENT_PAYMENT_TYPE,
      paystackReference: reference,
      amount: verifiedAmountNgn,
      currency: verifiedCurrency,
      status: 'success',
      channel: channel || null,
      paidAt,
      rawPayload: event.data,
    },
  })

  await prisma.lead.update({
    where: { id: leadId },
    data: { telegramStage: 'intake_complete' },
  })

  console.log(`[AssessmentPaymentWebhook] paid | leadId=${leadId} amount=₦${verifiedAmountNgn} ref=${reference}`)

  logFunnelEvent({
    eventType: 'assessment_payment_success',
    leadId,
    value: verifiedAmountNgn,
  }).catch(() => {})

  if (lead.telegramChatId) {
    await sendTelegramToUser(
      lead.telegramChatId,
      "Payment confirmed ✅\n\nWe're preparing your personalized skin assessment now — it will arrive here shortly.",
      LEAD_BOT_TOKEN
    ).catch(() => {})
  }

  // Resume the EXISTING diagnosis pipeline — unchanged function, unchanged behavior.
  setImmediate(() => {
    diagnoseLead(leadId).catch((err) =>
      console.error(`[AssessmentPaymentWebhook] diagnoseLead failed | leadId=${leadId}:`, err.message)
    )
  })
}

module.exports = { requireAssessmentPayment, handleAssessmentPaymentWebhook }
