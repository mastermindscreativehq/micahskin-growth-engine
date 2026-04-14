'use strict'

/**
 * actionEngineService.js — Phase 17: Action Engine
 *
 * Converts diagnosis results + follow-up schedules into deterministic,
 * automated message execution. Handles 4 action types:
 *
 *   1. diagnosis      — T+1h  — personalised diagnosis + routine
 *   2. check_in       — T+24h — gentle check-in on routine progress
 *   3. product_reco   — T+3d  — targeted product recommendation
 *   4. academy_offer  — T+5d+ — academy pitch when fit score is strong
 *
 * Safety guarantees:
 *   - Atomic boolean-claim prevents duplicate sends across concurrent runs
 *   - Rich status field (diagnosisStatus etc.) records outcome per action
 *   - Closed leads skipped silently
 *   - No telegram chatId → blocked with reason "no_delivery_channel"
 *   - urgencyLevel=high or nextBestAction=manual_consult → product_reco +
 *     academy_offer are blocked, actionBlockedReason written to lead record
 *   - Send failure reverts the claim so next tick retries
 *
 * Replaces followUpService.js as the sole scheduled execution layer.
 * Does NOT replace the admin-alert schedulerService or autoTriggerService.
 */

const prisma = require('../lib/prisma')
const { sendTelegramToUser } = require('./telegramService')

// Configurable via env var — keep in sync with diagnosisEngineService threshold
const ACADEMY_FIT_THRESHOLD = parseInt(process.env.ACADEMY_FIT_THRESHOLD || '65', 10)

// ── Message builders ──────────────────────────────────────────────────────────

/**
 * T+1h — Personalised diagnosis message.
 * Prefers enriched diagnosisSummary + recommendedProductsText over raw JSON.
 *
 * @param {object} lead
 * @returns {string|null}
 */
function buildDiagnosisMessage(lead) {
  const firstName = lead.fullName.split(' ')[0]

  // Enriched path: use diagnosis engine summary + product text
  if (lead.diagnosisSummary) {
    const concern = lead.primaryConcern
      ? `your ${lead.primaryConcern.replace(/_/g, ' ')}`
      : 'your skin concern'

    const routineSection = lead.recommendedProductsText
      ? `\n\n<b>Recommended routine:</b>\n${lead.recommendedProductsText}`
      : ''

    const urgencyNote = lead.urgencyLevel === 'high'
      ? '\n\n⚠️ <b>Your concern shows some severity.</b> Follow this closely and reply if anything worsens.'
      : ''

    return (
      `Hi ${firstName} 🌿\n\n` +
      `We've reviewed everything you shared about ${concern}.\n\n` +
      `<b>Here's what we found:</b>\n${lead.diagnosisSummary}` +
      routineSection +
      urgencyNote +
      `\n\nStay consistent for 2–3 weeks. Reply anytime if you need to adjust.`
    )
  }

  // Clinical fallback: use diagnosis + routine JSON (set by diagnosisService)
  const diag    = lead.diagnosis
  const routine = lead.routine
  if (!diag || !routine) return null

  const diagText     = diag.text || ''
  const notes        = Array.isArray(diag.notes)    ? diag.notes    : []
  const morning      = Array.isArray(routine.morning) ? routine.morning : []
  const night        = Array.isArray(routine.night)   ? routine.night   : []
  const morningLines = morning.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const nightLines   = night.map((s, i)   => `${i + 1}. ${s}`).join('\n')
  const notesBlock   = notes.length > 0
    ? `\n\n<b>Important notes for your skin:</b>\n` + notes.map(n => `• ${n}`).join('\n')
    : ''

  return (
    `Hi ${firstName} 🌿\n\n` +
    `Based on everything you shared, here is what is happening with your skin:\n\n` +
    `<b>${diagText}</b>\n\n` +
    `<b>Your personalised routine:</b>\n\n` +
    `<b>Morning</b>\n${morningLines}\n\n` +
    `<b>Night</b>\n${nightLines}` +
    notesBlock +
    `\n\nFollow this consistently for 2–3 weeks and monitor your skin's response. ` +
    `Reply here if you have any questions.`
  )
}

/**
 * T+24h — Gentle check-in message after the routine has been shared.
 *
 * @param {object} lead
 * @returns {string}
 */
function buildCheckInMessage(lead) {
  const firstName  = lead.fullName.split(' ')[0]
  const routineName = lead.routineType
    ? `the ${lead.routineType.replace(/_/g, ' ')} routine`
    : 'the routine'

  return (
    `Hi ${firstName} 👋\n\n` +
    `Just checking in — have you been able to start ${routineName} we shared?\n\n` +
    `Any tightness, irritation, early improvements, or questions? ` +
    `Reply here and I'll help you adjust.`
  )
}

/**
 * T+3d — Targeted product recommendation.
 * Prefers enriched recommendedProductsText over raw products JSON.
 *
 * @param {object} lead
 * @returns {string|null}
 */
function buildProductRecommendationMessage(lead) {
  const firstName = lead.fullName.split(' ')[0]
  const concern   = lead.primaryConcern
    ? lead.primaryConcern.replace(/_/g, ' ')
    : 'your skin concern'

  // Enriched path
  if (lead.recommendedProductsText) {
    return (
      `Hi ${firstName} ✨\n\n` +
      `For faster results with ${concern}, here are the specific products our team recommends:\n\n` +
      `${lead.recommendedProductsText}\n\n` +
      `These are matched to your skin type and concern. ` +
      `Reply if you need help getting them or adding them to your routine.`
    )
  }

  // Clinical fallback
  const products = lead.products?.recommendations || []
  if (products.length === 0) return null

  const lines = products.map((p, i) => `${i + 1}. ${p}`).join('\n')
  return (
    `Hi ${firstName} ✨\n\n` +
    `For faster, more targeted results, here are our recommended products for your skin:\n\n` +
    `${lines}\n\n` +
    `These are matched to your exact skin type and concern. ` +
    `Reply if you'd like guidance on where to get them.`
  )
}

/**
 * Academy offer — only sent when fit score is strong.
 * Human, benefit-led, not spam.
 *
 * @param {object} lead
 * @returns {string}
 */
function buildAcademyOfferMessage(lead) {
  const firstName = lead.fullName.split(' ')[0]

  return (
    `Hi ${firstName} 🎓\n\n` +
    `Based on what you've shared about your skin goals, I think you'd genuinely benefit ` +
    `from our Skincare Academy — it's designed for people who want to properly understand ` +
    `their skin, not just follow generic advice.\n\n` +
    `You'll learn how to build effective routines, understand ingredients, ` +
    `and achieve results that last.\n\n` +
    `Reply <b>ACADEMY</b> and I'll send you the full details.`
  )
}

// ── Evaluation (pure — no DB writes) ─────────────────────────────────────────

/**
 * Inspects a single lead and returns what the next due action would be.
 * Used by CRM and for introspection. No side effects.
 *
 * @param {object} lead  Full Lead record from DB
 * @returns {{ action: string|null, blocked: boolean, reason: string|null }}
 */
function evaluateNextActionForLead(lead) {
  const now = new Date()

  if (!lead.telegramChatId) {
    return { action: null, blocked: true, reason: 'no_delivery_channel' }
  }

  if (lead.status === 'closed') {
    return { action: null, blocked: true, reason: 'lead_closed' }
  }

  const needsManualConsult =
    lead.urgencyLevel === 'high' || lead.nextBestAction === 'manual_consult'

  // A. Diagnosis
  if (
    lead.diagnosedAt &&
    lead.diagnosisSendAfter &&
    new Date(lead.diagnosisSendAfter) <= now &&
    !lead.diagnosisSent
  ) {
    return { action: 'diagnosis', blocked: false, reason: null }
  }

  // B. Check-in (requires diagnosis already sent)
  if (
    lead.diagnosisSent &&
    lead.checkInSendAfter &&
    new Date(lead.checkInSendAfter) <= now &&
    !lead.checkInSent
  ) {
    return { action: 'check_in', blocked: false, reason: null }
  }

  // C. Product recommendation (blocked for manual consult)
  if (
    lead.diagnosisSent &&
    lead.productRecoSendAfter &&
    new Date(lead.productRecoSendAfter) <= now &&
    !lead.productRecoSent
  ) {
    if (needsManualConsult) {
      return { action: null, blocked: true, reason: 'manual_consult_required' }
    }
    const hasProducts =
      lead.recommendedProductsText ||
      (Array.isArray(lead.products?.recommendations) && lead.products.recommendations.length > 0)
    const actionIsProduct =
      lead.nextBestAction === 'recommend_product' ||
      lead.nextBestAction === 'recommend_routine'
    if (hasProducts || actionIsProduct) {
      return { action: 'product_reco', blocked: false, reason: null }
    }
  }

  // D. Academy offer (blocked for manual consult)
  if (
    lead.academyFitScore != null &&
    lead.academyFitScore >= ACADEMY_FIT_THRESHOLD &&
    lead.academyOfferSendAfter &&
    new Date(lead.academyOfferSendAfter) <= now &&
    !lead.academyOfferSent
  ) {
    if (needsManualConsult) {
      return { action: null, blocked: true, reason: 'manual_consult_required' }
    }
    return { action: 'academy_offer', blocked: false, reason: null }
  }

  return { action: null, blocked: false, reason: null }
}

// ── Audit log helper ──────────────────────────────────────────────────────────

async function _logAction(leadId, chatId, actionType, sendResult) {
  await prisma.messageLog.create({
    data: {
      type:             'lead',
      recordId:         leadId,
      channel:          'telegram',
      status:           sendResult.success ? 'sent' : 'skipped',
      auto:             true,
      triggerReason:    `action_engine_${actionType}`,
      recipient:        String(chatId),
      deliveryChannel:  'telegram',
      fallbackUsed:     false,
      providerResponse: sendResult.data ? JSON.stringify(sendResult.data) : null,
      error:            sendResult.error ? String(sendResult.error) : null,
    },
  }).catch(e => console.error('[ActionEngine] MessageLog write failed:', e.message))
}

// ── Send workers ──────────────────────────────────────────────────────────────

/**
 * A. Diagnosis sends — T+1h after intake_complete.
 */
async function _processDiagnosisSends() {
  const now = new Date()

  const leads = await prisma.lead.findMany({
    where: {
      diagnosedAt:        { not: null },
      diagnosisSendAfter: { lte: now },
      diagnosisSent:      false,
      telegramChatId:     { not: null },
    },
  })

  for (const lead of leads) {
    if (lead.status === 'closed') {
      console.log(`[ActionEngine] skipped diagnosis (lead closed) → ${lead.id}`)
      continue
    }

    // Atomic claim
    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, diagnosisSent: false },
      data:  { diagnosisSent: true },
    })
    if (claimed.count === 0) continue  // another process claimed it first

    console.log(`[ActionEngine] evaluating lead ${lead.id} (${lead.fullName}) for diagnosis`)

    try {
      const msg = buildDiagnosisMessage(lead)
      if (!msg) {
        console.warn(`[ActionEngine] skipped diagnosis (no data) → ${lead.id}`)
        await prisma.lead.update({
          where: { id: lead.id },
          data:  { diagnosisStatus: 'skipped', lastActionType: 'diagnosis', lastActionAt: now },
        })
        continue
      }

      const result = await sendTelegramToUser(lead.telegramChatId, msg)
      if (!result.success && !result.skipped) throw new Error(JSON.stringify(result.error) || 'telegram send failed')

      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          diagnosisSentAt:    now,
          diagnosisStatus:    'sent',
          lastActionType:     'diagnosis',
          lastActionAt:       now,
          actionBlockedReason: null,
        },
      })
      await _logAction(lead.id, lead.telegramChatId, 'diagnosis', result)
      console.log(`[ActionEngine] diagnosis sent → ${lead.fullName} (${lead.id})`)

    } catch (err) {
      console.error(`[ActionEngine] diagnosis FAILED for ${lead.id}:`, err.message)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          diagnosisSent:   false,  // revert claim so next tick retries
          diagnosisStatus: 'failed',
          lastActionType:  'diagnosis',
          lastActionAt:    now,
        },
      }).catch(() => {})
    }
  }
}

/**
 * B. Check-in sends — T+24h. Only fires after diagnosis has been delivered.
 */
async function _processCheckIns() {
  const now = new Date()

  const leads = await prisma.lead.findMany({
    where: {
      diagnosisSent:    true,
      checkInSendAfter: { lte: now },
      checkInSent:      false,
      telegramChatId:   { not: null },
    },
  })

  for (const lead of leads) {
    if (lead.status === 'closed') {
      console.log(`[ActionEngine] skipped check-in (lead closed) → ${lead.id}`)
      continue
    }

    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, checkInSent: false },
      data:  { checkInSent: true },
    })
    if (claimed.count === 0) continue

    console.log(`[ActionEngine] evaluating lead ${lead.id} (${lead.fullName}) for check-in`)

    try {
      const msg    = buildCheckInMessage(lead)
      const result = await sendTelegramToUser(lead.telegramChatId, msg)
      if (!result.success && !result.skipped) throw new Error(JSON.stringify(result.error) || 'telegram send failed')

      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          checkInSentAt:  now,
          checkInStatus:  'sent',
          lastActionType: 'check_in',
          lastActionAt:   now,
        },
      })
      await _logAction(lead.id, lead.telegramChatId, 'check_in', result)
      console.log(`[ActionEngine] check-in sent → ${lead.fullName} (${lead.id})`)

    } catch (err) {
      console.error(`[ActionEngine] check-in FAILED for ${lead.id}:`, err.message)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          checkInSent:   false,
          checkInStatus: 'failed',
          lastActionType: 'check_in',
          lastActionAt:   now,
        },
      }).catch(() => {})
    }
  }
}

/**
 * C. Product recommendation sends — T+3d.
 * Blocked when urgencyLevel=high or nextBestAction=manual_consult.
 */
async function _processProductRecos() {
  const now = new Date()

  const leads = await prisma.lead.findMany({
    where: {
      diagnosisSent:        true,
      productRecoSendAfter: { lte: now },
      productRecoSent:      false,
      telegramChatId:       { not: null },
    },
  })

  for (const lead of leads) {
    if (lead.status === 'closed') {
      console.log(`[ActionEngine] skipped product reco (lead closed) → ${lead.id}`)
      continue
    }

    // Atomic claim (claim first, then decide block vs send)
    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, productRecoSent: false },
      data:  { productRecoSent: true },
    })
    if (claimed.count === 0) continue

    // Manual consult branch — write block record and stop here
    const needsManualConsult =
      lead.urgencyLevel === 'high' || lead.nextBestAction === 'manual_consult'

    if (needsManualConsult) {
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          productRecoStatus:   'blocked',
          actionBlockedReason: 'manual_consult_required',
          lastActionType:      'product_reco_blocked',
          lastActionAt:        now,
        },
      })
      console.log(`[ActionEngine] blocked product reco (manual consult required) → ${lead.id}`)
      continue
    }

    console.log(`[ActionEngine] evaluating lead ${lead.id} (${lead.fullName}) for product reco`)

    try {
      const msg = buildProductRecommendationMessage(lead)
      if (!msg) {
        console.warn(`[ActionEngine] skipped product reco (no product data) → ${lead.id}`)
        await prisma.lead.update({
          where: { id: lead.id },
          data:  { productRecoStatus: 'skipped', lastActionType: 'product_reco', lastActionAt: now },
        })
        continue
      }

      const result = await sendTelegramToUser(lead.telegramChatId, msg)
      if (!result.success && !result.skipped) throw new Error(JSON.stringify(result.error) || 'telegram send failed')

      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          productRecoSentAt: now,
          productRecoStatus: 'sent',
          lastActionType:    'product_reco',
          lastActionAt:      now,
        },
      })
      await _logAction(lead.id, lead.telegramChatId, 'product_reco', result)
      console.log(`[ActionEngine] product reco sent → ${lead.fullName} (${lead.id})`)

    } catch (err) {
      console.error(`[ActionEngine] product reco FAILED for ${lead.id}:`, err.message)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          productRecoSent:   false,
          productRecoStatus: 'failed',
          lastActionType:    'product_reco',
          lastActionAt:      now,
        },
      }).catch(() => {})
    }
  }
}

/**
 * D. Academy offer sends — fires when academyFitScore >= threshold
 *    and academyOfferSendAfter has elapsed.
 * Blocked when urgencyLevel=high or nextBestAction=manual_consult.
 */
async function _processAcademyOffers() {
  const now = new Date()

  const leads = await prisma.lead.findMany({
    where: {
      academyFitScore:      { gte: ACADEMY_FIT_THRESHOLD },
      academyOfferSendAfter: { lte: now },
      academyOfferSent:     false,
      telegramChatId:       { not: null },
    },
  })

  for (const lead of leads) {
    if (lead.status === 'closed') {
      console.log(`[ActionEngine] skipped academy offer (lead closed) → ${lead.id}`)
      continue
    }

    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, academyOfferSent: false },
      data:  { academyOfferSent: true },
    })
    if (claimed.count === 0) continue

    const needsManualConsult =
      lead.urgencyLevel === 'high' || lead.nextBestAction === 'manual_consult'

    if (needsManualConsult) {
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          academyOfferStatus:  'blocked',
          actionBlockedReason: 'manual_consult_required',
          lastActionType:      'academy_offer_blocked',
          lastActionAt:        now,
        },
      })
      console.log(`[ActionEngine] blocked academy offer (manual consult required) → ${lead.id}`)
      continue
    }

    console.log(`[ActionEngine] evaluating lead ${lead.id} (${lead.fullName}) for academy offer`)

    try {
      const msg    = buildAcademyOfferMessage(lead)
      const result = await sendTelegramToUser(lead.telegramChatId, msg)
      if (!result.success && !result.skipped) throw new Error(JSON.stringify(result.error) || 'telegram send failed')

      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          academyOfferSentAt: now,
          academyOfferStatus: 'sent',
          lastActionType:     'academy_offer',
          lastActionAt:       now,
        },
      })
      await _logAction(lead.id, lead.telegramChatId, 'academy_offer', result)
      console.log(`[ActionEngine] academy offer sent → ${lead.fullName} (${lead.id})`)

    } catch (err) {
      console.error(`[ActionEngine] academy offer FAILED for ${lead.id}:`, err.message)
      await prisma.lead.update({
        where: { id: lead.id },
        data:  {
          academyOfferSent:   false,
          academyOfferStatus: 'failed',
          lastActionType:     'academy_offer',
          lastActionAt:       now,
        },
      }).catch(() => {})
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs one full action engine cycle: diagnosis → check-in → product reco → academy offer.
 * Called every 60s by the background poller.
 */
async function runPendingLeadActions() {
  try {
    await _processDiagnosisSends()
    await _processCheckIns()
    await _processProductRecos()
    await _processAcademyOffers()
  } catch (err) {
    console.error('[ActionEngine] Unhandled error in runPendingLeadActions:', err.message)
  }
}

/**
 * Starts the Action Engine background poller.
 * Runs on boot + every 60 seconds.
 * Replaces startFollowUpService as the scheduled execution layer.
 */
function startActionEngine() {
  console.log(`✅ Action Engine started (automated lead actions every 60s | academy threshold: ${ACADEMY_FIT_THRESHOLD})`)
  runPendingLeadActions()
  setInterval(runPendingLeadActions, 60 * 1000)
}

module.exports = {
  startActionEngine,
  runPendingLeadActions,
  evaluateNextActionForLead,
  buildDiagnosisMessage,
  buildCheckInMessage,
  buildProductRecommendationMessage,
  buildAcademyOfferMessage,
}
