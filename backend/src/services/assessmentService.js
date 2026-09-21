'use strict'

/**
 * assessmentService.js
 *
 * Paid Personalized Skin Assessment (₦10,000 — see config/assessmentConfig.js).
 * This fee is its own standalone commercial transaction — it carries no
 * product-credit, discount, or deposit relationship. Never derive product/
 * bundle pricing from it.
 *
 * State machine (AssessmentSession.status):
 *   started -> intake_in_progress -> intake_completed(*) -> payment_required ->
 *   payment_initialized -> unlocked -> analysis_processing -> results_ready
 *   (* intake_completed is transient — completeIntake() moves straight to
 *      payment_required in the same call)
 *   failure/abandonment: payment_failed | abandoned — never reachable once
 *   the session has reached unlocked/results_ready.
 *
 * Reuses rather than replaces:
 *   - diagnosisEngineService.diagnoseLead() is the ONE analysis engine —
 *     intake answers are mapped onto the same Lead.telegram* fields the
 *     Telegram flow already writes, so the existing engine runs unmodified.
 *   - PaymentTransaction / the paystackPost·paystackGet·webhook pattern from
 *     paystackController.js — the webhook branch that calls into this file
 *     lives in paystackController.js, not a second webhook.
 */

const crypto = require('crypto')
const https = require('https')
const prisma = require('../lib/prisma')
const { normalizePhoneNumber } = require('../utils/phoneUtils')
const { diagnoseLead } = require('./diagnosisEngineService')
const { sendTelegramToUser } = require('./telegramService')
const { logFunnelEvent } = require('./funnelEventService')
const {
  ASSESSMENT_FEE_NGN,
  ASSESSMENT_FEE_KOBO,
  ASSESSMENT_PAYMENT_TYPE,
  ASSESSMENT_CURRENCY,
} = require('../config/assessmentConfig')

const LEAD_BOT_TOKEN = process.env.TELEGRAM_LEAD_BOT_TOKEN
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID

// Statuses from which a session may never be moved backward — payment is final.
const LOCKED_STATUSES = ['unlocked', 'payment_success', 'analysis_processing', 'results_ready']

// ── Intake option lists — single source of truth, also served via GET /config ──

const CONCERN_OPTIONS = [
  'acne', 'hyperpigmentation', 'dry_skin', 'oily_skin',
  'eczema', 'sensitivity', 'body_care', 'stretch_marks', 'routine_building',
]
const SKIN_TYPE_OPTIONS = ['oily', 'dry', 'combination', 'normal', 'sensitive']
const SENSITIVITY_OPTIONS = ['reacts_easily', 'occasionally_reactive', 'no_reactions']
const SEVERITY_OPTIONS = ['mild', 'moderate', 'severe']
const ROUTINE_LEVEL_OPTIONS = ['simple', 'balanced', 'complete']
const BUDGET_OPTIONS = ['budget', 'mid_range', 'premium']

// ── Paystack helpers (mirrors paystackController.js — same host/auth pattern) ──

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

// ── Helpers ────────────────────────────────────────────────────────────────────

function httpError(status, message, errors) {
  const err = new Error(message)
  err.status = status
  if (errors) err.errors = errors
  return err
}

async function getSessionOrThrow(sessionId) {
  const session = await prisma.assessmentSession.findUnique({ where: { id: sessionId } })
  if (!session) throw httpError(404, 'Assessment session not found')
  return session
}

// ── Session lifecycle ───────────────────────────────────────────────────────────

async function startSession() {
  const session = await prisma.assessmentSession.create({ data: { status: 'started' } })
  logFunnelEvent({ eventType: 'assessment_started', sessionId: session.id }).catch(() => {})
  console.log(`[Assessment] started | sessionId=${session.id}`)
  return session
}

async function saveIntake(sessionId, answers) {
  const session = await getSessionOrThrow(sessionId)
  if (!['started', 'intake_in_progress'].includes(session.status)) {
    throw httpError(409, 'Intake can no longer be edited for this session')
  }
  const merged = { ...(session.intakeAnswers || {}), ...(answers || {}) }
  return prisma.assessmentSession.update({
    where: { id: sessionId },
    data: { intakeAnswers: merged, status: 'intake_in_progress' },
  })
}

/**
 * Finalises intake + contact details, creates a brand-new Lead (never merges
 * into an existing one — avoids disturbing any Telegram/product-quote/academy
 * automation already in progress for that email elsewhere in the CRM), and
 * advances the session straight to payment_required.
 */
async function completeIntake(sessionId, payload = {}) {
  const session = await getSessionOrThrow(sessionId)
  if (LOCKED_STATUSES.includes(session.status)) {
    throw httpError(409, 'This assessment has already been paid for and cannot be re-submitted')
  }

  const { fullName, email, phone, answers } = payload
  const merged = { ...(session.intakeAnswers || {}), ...(answers || {}) }

  const errors = []
  if (!fullName || typeof fullName !== 'string' || !fullName.trim()) errors.push('fullName is required')
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('a valid email is required')
  if (!merged.concern || !CONCERN_OPTIONS.includes(merged.concern)) {
    errors.push(`concern is required and must be one of: ${CONCERN_OPTIONS.join(', ')}`)
  }
  if (!merged.skinType || !SKIN_TYPE_OPTIONS.includes(merged.skinType)) {
    errors.push(`skinType is required and must be one of: ${SKIN_TYPE_OPTIONS.join(', ')}`)
  }
  if (!merged.severity || !SEVERITY_OPTIONS.includes(merged.severity)) {
    errors.push(`severity is required and must be one of: ${SEVERITY_OPTIONS.join(', ')}`)
  }
  if (!merged.routineLevel || !ROUTINE_LEVEL_OPTIONS.includes(merged.routineLevel)) {
    errors.push(`routineLevel is required and must be one of: ${ROUTINE_LEVEL_OPTIONS.join(', ')}`)
  }

  let normalizedPhone = null
  if (phone) {
    try { normalizedPhone = normalizePhoneNumber(phone) } catch (e) { errors.push(e.message) }
  }

  if (errors.length > 0) throw httpError(400, 'Validation failed', errors)

  const concernLabel = merged.concern.replace(/_/g, ' ')
  const telegramConcernText = [concernLabel, merged.goal, merged.notes].filter(Boolean).join(' — ')

  // Fresh Lead every time — never merges into an existing record for this email.
  const lead = await prisma.lead.create({
    data: {
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: normalizedPhone,
      sourcePlatform: 'Other',
      sourceType: 'web_assessment',
      skinConcern: merged.concern,
      message: merged.notes || merged.goal || 'Personalized Skin Assessment intake',
      telegramConcern: telegramConcernText || null,
      telegramSkinType: merged.skinType,
      telegramSensitivity: merged.sensitivity || null,
      telegramSeverity: merged.severity,
      telegramDuration: merged.duration || null,
      telegramRoutineLevel: merged.routineLevel,
      telegramBudget: merged.budget || null,
      telegramGoal: merged.goal || null,
    },
  })

  const now = new Date()
  const updated = await prisma.assessmentSession.update({
    where: { id: sessionId },
    data: {
      leadId: lead.id,
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: normalizedPhone,
      intakeAnswers: merged,
      intakeCompletedAt: now,
      status: 'payment_required',
    },
  })

  logFunnelEvent({ eventType: 'intake_completed', leadId: lead.id, sessionId }).catch(() => {})
  console.log(`[Assessment] intake_completed | sessionId=${sessionId} leadId=${lead.id}`)

  return { session: updated, leadId: lead.id }
}

/**
 * Initialises (or re-initialises, for retry) a Paystack transaction for the
 * exact configured assessment fee. Always generates a fresh reference —
 * never reuses a stale authorization_url, mirroring productQuoteService.js.
 */
async function initializePayment(sessionId) {
  const session = await getSessionOrThrow(sessionId)

  if (LOCKED_STATUSES.includes(session.status)) {
    throw httpError(409, 'This assessment is already unlocked')
  }
  if (!session.leadId || !session.email) {
    throw httpError(422, 'Complete the intake form before starting payment')
  }
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw httpError(503, 'Payments are not configured on this server')
  }

  const reference = `assess_${session.id.slice(-8)}_${crypto.randomBytes(4).toString('hex')}`
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  const callbackUrl = `${frontendUrl}/assessment/result?token=${session.accessToken}`

  const paystackRes = await paystackPost('/transaction/initialize', {
    email: session.email,
    amount: ASSESSMENT_FEE_KOBO,
    reference,
    currency: ASSESSMENT_CURRENCY,
    metadata: {
      sessionId: session.id,
      leadId: session.leadId,
      type: ASSESSMENT_PAYMENT_TYPE,
      fullName: session.fullName,
    },
    callback_url: callbackUrl,
  })

  if (!paystackRes.status || !paystackRes.data?.authorization_url) {
    console.error('[Assessment] Paystack init failed', paystackRes)
    throw httpError(502, 'Failed to create payment link')
  }

  const finalReference = paystackRes.data.reference || reference

  await prisma.assessmentSession.update({
    where: { id: sessionId },
    data: {
      paystackReference: finalReference,
      paymentInitializedAt: new Date(),
      status: 'payment_initialized',
      failureReason: null,
    },
  })

  logFunnelEvent({
    eventType: 'assessment_payment_started',
    leadId: session.leadId,
    sessionId,
    value: ASSESSMENT_FEE_NGN,
  }).catch(() => {})

  console.log(`[Assessment] payment_initialized | sessionId=${sessionId} reference=${finalReference}`)

  return { authorizationUrl: paystackRes.data.authorization_url, reference: finalReference }
}

/**
 * Frontend-reported failure/cancellation (Paystack has no "failed" webhook
 * event — only charge.success calls the webhook). Never downgrades a session
 * that has already been paid/unlocked.
 */
async function markPaymentFailed(sessionId, reason) {
  const session = await getSessionOrThrow(sessionId)
  if (LOCKED_STATUSES.includes(session.status)) {
    return session
  }
  const updated = await prisma.assessmentSession.update({
    where: { id: sessionId },
    data: { status: 'payment_failed', failureReason: reason || 'Payment was not completed' },
  })
  logFunnelEvent({
    eventType: 'assessment_payment_failed',
    leadId: session.leadId,
    sessionId,
    metadata: reason ? { reason } : undefined,
  }).catch(() => {})
  console.log(`[Assessment] payment_failed | sessionId=${sessionId} reason=${reason || 'n/a'}`)
  return updated
}

/**
 * Webhook entry point — called from paystackController.js's paystackWebhook
 * when metadata.type === 'skin_assessment'. Never called directly from any
 * frontend-facing route; the frontend can only ever ask a payment to start,
 * never assert that it succeeded.
 */
async function handleAssessmentWebhookPayment(event) {
  const { reference, channel, metadata, paid_at } = event.data || {}
  const { sessionId, leadId } = metadata || {}

  console.log(`[AssessmentWebhook] received | ref=${reference} sessionId=${sessionId} leadId=${leadId}`)

  if (!sessionId || !leadId) {
    console.error('[AssessmentWebhook] missing sessionId or leadId in metadata', metadata)
    return
  }

  // Idempotency — reference-based guard (same pattern as handleProductQuotePayment)
  const existingTx = await prisma.paymentTransaction.findUnique({ where: { paystackReference: reference } })
  if (existingTx) {
    console.log(`[AssessmentWebhook] already_processed | ref=${reference}`)
    return
  }

  // Verify with Paystack directly — never trust the webhook payload's own "success" claim alone
  const verify = await paystackGet(`/transaction/verify/${encodeURIComponent(reference)}`)
  if (!verify.status || verify.data?.status !== 'success') {
    console.error(`[AssessmentWebhook] verification failed | ref=${reference} paystackStatus=${verify.data?.status}`)
    return
  }

  const verifiedAmountNgn = (verify.data.amount ?? 0) / 100
  const verifiedCurrency = verify.data.currency

  if (verifiedCurrency !== ASSESSMENT_CURRENCY) {
    console.error(`[AssessmentWebhook] currency mismatch | ref=${reference} currency=${verifiedCurrency}`)
    return
  }
  if (Math.abs(verifiedAmountNgn - ASSESSMENT_FEE_NGN) > 0.5) {
    console.error(`[AssessmentWebhook] amount mismatch | ref=${reference} paid=₦${verifiedAmountNgn} expected=₦${ASSESSMENT_FEE_NGN}`)
    return
  }

  const session = await prisma.assessmentSession.findUnique({ where: { id: sessionId } })
  if (!session) {
    console.error(`[AssessmentWebhook] session not found | sessionId=${sessionId}`)
    return
  }
  if (session.leadId !== leadId) {
    console.error(`[AssessmentWebhook] leadId context mismatch | sessionId=${sessionId} sessionLeadId=${session.leadId} metadataLeadId=${leadId}`)
    return
  }
  if (session.paystackReference !== reference) {
    console.error(`[AssessmentWebhook] reference does not match this session's own transaction | sessionId=${sessionId} sessionReference=${session.paystackReference} eventReference=${reference}`)
    return
  }
  if (LOCKED_STATUSES.includes(session.status)) {
    console.log(`[AssessmentWebhook] session already unlocked — ignoring replay | sessionId=${sessionId} status=${session.status}`)
    return
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) {
    console.error(`[AssessmentWebhook] lead not found | leadId=${leadId}`)
    return
  }

  const paidAt = paid_at ? new Date(paid_at) : new Date()

  await prisma.$transaction(async (tx) => {
    await tx.paymentTransaction.create({
      data: {
        leadId,
        type: ASSESSMENT_PAYMENT_TYPE,
        assessmentSessionId: sessionId,
        paystackReference: reference,
        amount: verifiedAmountNgn,
        currency: verifiedCurrency,
        status: 'success',
        channel: channel || null,
        paidAt,
        rawPayload: event.data,
      },
    })

    await tx.assessmentSession.update({
      where: { id: sessionId },
      data: { status: 'unlocked', paidAt, unlockedAt: paidAt, failureReason: null },
    })

    // Payment fields only — this NEVER touches product/bundle pricing fields.
    await tx.lead.update({
      where: { id: leadId },
      data: {
        paymentStatus: 'paid',
        paidAt,
        lastPaidAmount: verifiedAmountNgn,
        conversionType: 'skin_assessment',
        conversionValue: verifiedAmountNgn,
        conversionAt: paidAt,
        conversionPath: 'skin_assessment_paid',
        leadStage: 'converted',
        lastInteractionAt: paidAt,
      },
    })
  })

  console.log(`[AssessmentWebhook] unlocked | sessionId=${sessionId} leadId=${leadId} amount=₦${verifiedAmountNgn}`)

  logFunnelEvent({ eventType: 'assessment_payment_success', leadId, sessionId, value: verifiedAmountNgn }).catch(() => {})
  logFunnelEvent({ eventType: 'assessment_unlocked', leadId, sessionId }).catch(() => {})

  if (ADMIN_CHAT_ID && LEAD_BOT_TOKEN) {
    const adminMsg = [
      '🧪 <b>Paid Skin Assessment</b>',
      '',
      `Lead: ${lead.fullName}`,
      `Email: ${lead.email || '—'}`,
      `Amount: ₦${verifiedAmountNgn.toLocaleString('en-NG')}`,
      `Ref: ${reference}`,
    ].join('\n')
    sendTelegramToUser(ADMIN_CHAT_ID, adminMsg, LEAD_BOT_TOKEN).catch(() => {})
  }

  // Analysis is fast + synchronous (rule-based, no external API call) but we
  // still defer it past the webhook's response so Paystack gets a quick ack.
  setImmediate(() => {
    runAssessmentAnalysis(sessionId).catch((e) =>
      console.error(`[Assessment] analysis failed | sessionId=${sessionId}:`, e.message)
    )
  })
}

/**
 * Runs the EXISTING diagnosis engine unmodified — diagnoseLead() already
 * reads Lead.telegram* fields regardless of which channel populated them.
 */
async function runAssessmentAnalysis(sessionId) {
  const session = await prisma.assessmentSession.findUnique({ where: { id: sessionId } })
  if (!session || !session.leadId) return
  if (session.status !== 'unlocked') {
    console.log(`[Assessment] skip analysis (unexpected status) | sessionId=${sessionId} status=${session.status}`)
    return
  }

  await prisma.assessmentSession.update({
    where: { id: sessionId },
    data: { status: 'analysis_processing', analysisStartedAt: new Date() },
  })

  await diagnoseLead(session.leadId)

  await prisma.assessmentSession.update({
    where: { id: sessionId },
    data: { status: 'results_ready', resultsReadyAt: new Date() },
  })

  console.log(`[Assessment] results_ready | sessionId=${sessionId} leadId=${session.leadId}`)
}

/**
 * Public, accessToken-gated read. Only ever returns customer-safe fields —
 * excludes operator-only diagnosis fields (academyFitScore, conversionIntent,
 * nextBestAction, followupAngle, recommendedReply, confidenceScore).
 */
async function getPublicSession(accessToken) {
  const session = await prisma.assessmentSession.findUnique({
    where: { accessToken },
    include: { lead: true },
  })
  if (!session) return null

  const base = {
    status: session.status,
    intakeCompletedAt: session.intakeCompletedAt,
    paidAt: session.paidAt,
    resultsReadyAt: session.resultsReadyAt,
    failureReason: session.failureReason,
  }

  if (session.status !== 'results_ready' || !session.lead) return base

  const lead = session.lead
  return {
    ...base,
    leadId: lead.id,
    fullName: lead.fullName,
    primaryConcern: lead.primaryConcern,
    secondaryConcern: lead.secondaryConcern,
    routineType: lead.routineType,
    urgencyLevel: lead.urgencyLevel,
    diagnosisSummary: lead.diagnosisSummary,
    routine: lead.routine,
    productRecommendation: lead.productRecommendation,
    recommendedProductsText: lead.recommendedProductsText,
  }
}

/**
 * sessionId-scoped read used by the intake/payment wizard while it still has
 * only the raw id (before payment — never exposes results early since it
 * mirrors getPublicSession's own results_ready gate).
 */
async function getSessionById(sessionId) {
  const session = await getSessionOrThrow(sessionId)
  return {
    id: session.id,
    accessToken: session.accessToken,
    status: session.status,
    intakeAnswers: session.intakeAnswers,
    fullName: session.fullName,
    email: session.email,
    phone: session.phone,
    failureReason: session.failureReason,
  }
}

module.exports = {
  CONCERN_OPTIONS,
  SKIN_TYPE_OPTIONS,
  SENSITIVITY_OPTIONS,
  SEVERITY_OPTIONS,
  ROUTINE_LEVEL_OPTIONS,
  BUDGET_OPTIONS,
  startSession,
  saveIntake,
  completeIntake,
  initializePayment,
  markPaymentFailed,
  handleAssessmentWebhookPayment,
  runAssessmentAnalysis,
  getPublicSession,
  getSessionById,
}
