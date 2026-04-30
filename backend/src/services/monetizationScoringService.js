'use strict'

/**
 * monetizationScoringService.js — Phase 29: Monetization Intelligence
 *
 * Calculates three 0-100 intent scores for each lead and derives a
 * recommended next offer. Scores are stored on the Lead record and
 * displayed in the CRM "Monetization Intelligence" panel.
 *
 * Scoring inputs:
 *   primaryConcern, urgencyLevel, confidenceScore, academyFitScore,
 *   telegramBudget, imageUploadStatus, lastUserIntent, conversationMode,
 *   DeepConsultation (red flags, needsHumanReview)
 *
 * Rules:
 *   • Red flags / needsHumanReview → human_consult
 *   • High urgency / low confidence → consult / human_consult
 *   • Budget given + stable concern + product intent → product
 *   • High academy fit + academy signals → academy
 */

const prisma = require('../lib/prisma')

async function scoreLeadMonetization(leadId) {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } })
    if (!lead) return null

    // Latest non-abandoned deep consult
    const deepConsult = await prisma.deepConsultation.findFirst({
      where:   { leadId, status: { not: 'abandoned' } },
      orderBy: { createdAt: 'desc' },
    })

    const scores = _calculateScores(lead, deepConsult)

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        productIntentScore:   scores.product,
        consultIntentScore:   scores.consult,
        academyIntentScore:   scores.academy,
        recommendedNextOffer: scores.recommended,
        monetizationReason:   scores.reason,
      },
    })

    // Best-effort log
    prisma.flowEventLog.create({
      data: {
        leadId,
        eventType: 'monetization_scored',
        fromFlow:  lead.currentFlow || null,
        toFlow:    lead.currentFlow || null,
        reason:    `recommended: ${scores.recommended}`,
        metadata:  { product: scores.product, consult: scores.consult, academy: scores.academy },
      },
    }).catch(() => {})

    console.log(
      `[MonetizationScoring] scored leadId=${leadId} ` +
      `product=${scores.product} consult=${scores.consult} academy=${scores.academy} ` +
      `recommended=${scores.recommended}`
    )

    return scores
  } catch (err) {
    console.error(`[MonetizationScoring] failed for leadId=${leadId}:`, err.message)
    return null
  }
}

function _calculateScores(lead, deepConsult) {
  // Red flags → immediately route to human consult
  if (deepConsult?.needsHumanReview) {
    const flags = (deepConsult.redFlags || []).join(', ') || 'unspecified'
    return {
      product:     10,
      consult:     40,
      academy:     5,
      recommended: 'human_consult',
      reason:      `Red flags in deep consult: ${flags}`,
    }
  }

  let product = 45
  let consult  = 45
  let academy  = 35

  const concern       = (lead.primaryConcern || '').toLowerCase()
  const urgency       = (lead.urgencyLevel   || '').toLowerCase()
  const confidence    = lead.confidenceScore != null ? lead.confidenceScore : 70
  const academyFit    = lead.academyFitScore  != null ? lead.academyFitScore  : 0
  const budget        = lead.telegramBudget   || ''
  const imageStatus   = lead.imageUploadStatus || ''
  const lastIntent    = lead.lastUserIntent    || ''
  const convMode      = lead.conversationMode  || ''

  // ── Consult signals ──────────────────────────────────────────────────────────
  const clinicalConcerns = ['eczema', 'severe_acne', 'chronic', 'sensitivity']
  if (clinicalConcerns.includes(concern)) { consult += 20; product -= 10 }
  if (urgency === 'high')   { consult += 20; product -= 10 }
  if (urgency === 'medium') { consult +=  8 }
  if (confidence < 50)      { consult += 15 }
  if (confidence < 35)      { consult += 10 }
  if (lastIntent === 'consult_interest')     { consult += 25 }
  if (lastIntent === 'irritation_or_side_effect') { consult += 10 }
  if (convMode  === 'consult_active')        { consult += 10 }

  // ── Product signals ──────────────────────────────────────────────────────────
  if (budget && urgency !== 'high')                  { product += 15 }
  if (lastIntent === 'product_buying_intent')        { product += 25 }
  if (lastIntent === 'product_question')             { product += 10 }
  if (convMode  === 'product_reco_active')           { product += 10 }
  if (imageStatus === 'uploaded')                    { product +=  8 }
  if (lead.telegramBudget && urgency === 'low')      { product +=  5 }

  // ── Academy signals ──────────────────────────────────────────────────────────
  if (academyFit >= 80)     academy += 35
  else if (academyFit >= 65) academy += 20
  else if (academyFit >= 50) academy +=  8
  else if (academyFit  < 30) academy -= 20
  if (lastIntent === 'academy_interest')   { academy += 30 }
  if (lastIntent === 'academy_objection')  { academy += 10 }
  if (convMode  === 'academy_pitch_active') { academy += 10 }

  // Clamp 0–100
  const clamp = v => Math.max(0, Math.min(100, Math.round(v)))
  product = clamp(product)
  consult  = clamp(consult)
  academy  = clamp(academy)

  // ── Recommendation ───────────────────────────────────────────────────────────
  let recommended = 'none'
  let reason      = 'Scores are inconclusive — manual review needed'

  const max = Math.max(product, consult, academy)

  if (max === consult && consult >= 65) {
    const needsHuman = urgency === 'high' || confidence < 50
    recommended = needsHuman ? 'human_consult' : 'consult'
    reason = urgency === 'high'
      ? `High-urgency concern (${concern || 'unknown'}) — direct consultation recommended`
      : confidence < 50
        ? `Low diagnosis confidence (${confidence}%) — human review recommended`
        : `Consult signals are strongest (${consult}/100)`
  } else if (max === product && product >= 60) {
    recommended = 'product'
    reason = budget
      ? `Clear buying intent with stated budget: ${budget}`
      : `Product interest signals are strongest (${product}/100)`
  } else if (max === academy && academy >= 60) {
    recommended = 'academy'
    reason = academyFit >= 65
      ? `Strong academy fit score (${academyFit}/100)`
      : `Academy interest signals present — fit score ${academyFit}/100`
  }

  return { product, consult, academy, recommended, reason }
}

module.exports = { scoreLeadMonetization }
