'use strict'

/**
 * diagnosisEngineService.js
 *
 * Builds a rich, structured diagnosis result from any lead record and saves it.
 * Works from whatever data is available — full Telegram intake gives the best
 * result, but even a single Instagram comment produces a useful output.
 *
 * Public API:
 *   diagnoseLead(leadId)                    — fetch → diagnose → save
 *   buildDiagnosisFromLead(lead)            — pure: produce result object
 *   saveDiagnosisResult(leadId, result)     — write result to DB
 */

const prisma = require('../lib/prisma')
const { analyzeLead } = require('./diagnosisService')
const { sendTelegramToUser } = require('./telegramService')

// Keep in sync with actionEngineService ACADEMY_FIT_THRESHOLD
const ACADEMY_FIT_THRESHOLD = parseInt(process.env.ACADEMY_FIT_THRESHOLD || '65', 10)

const LEAD_BOT_TOKEN = process.env.TELEGRAM_LEAD_BOT_TOKEN
const WHATSAPP_LINK  = process.env.WHATSAPP_LINK || 'https://wa.me/+2348140468759'

// ── Concern inference ─────────────────────────────────────────────────────────

function inferPrimaryConcern(lead) {
  const t = [
    lead.telegramConcern,
    lead.telegramRoutineGoal,
    lead.skinConcern,
    lead.intent,
    lead.intentTag,
    lead.message,
  ].filter(Boolean).join(' ').toLowerCase()

  if (/acne|pimple|breakout|blemish|spot|cystic/.test(t)) return 'acne'
  if (/hyperpigment|dark spot|dark mark|pigment|discolou?r|uneven tone|melasma/.test(t)) return 'hyperpigmentation'
  if (/stretch mark|stretchmark/.test(t)) return 'stretch_marks'
  if (/dry|dehydrat|flak|tight skin|peeling/.test(t)) return 'dry_skin'
  if (/oily|sebum|shine|pore|greasy/.test(t)) return 'oily_skin'
  if (/eczema|dermatit/.test(t)) return 'eczema'
  if (/sensitiv|react|irritat|redness|rash|sting|burn/.test(t)) return 'sensitivity'
  if (/body|back|chest|arm|leg|stomach|thigh/.test(t)) return 'body_care'
  if (/glow|bright|even tone|radiant|luminous|routine|routine building/.test(t)) return 'routine_building'
  return 'unknown'
}

function inferSecondaryConcern(lead, primaryConcern) {
  const t = [
    lead.telegramConcern,
    lead.telegramRoutineGoal,
    lead.telegramGoal,
    lead.message,
  ].filter(Boolean).join(' ').toLowerCase()

  const candidates = []
  if (/acne|pimple|breakout/.test(t) && primaryConcern !== 'acne') candidates.push('acne')
  if (/hyperpigment|dark spot|discolou?r/.test(t) && primaryConcern !== 'hyperpigmentation') candidates.push('hyperpigmentation')
  if (/dry|dehydrat/.test(t) && primaryConcern !== 'dry_skin') candidates.push('dry_skin')
  if (/oily|sebum/.test(t) && primaryConcern !== 'oily_skin') candidates.push('oily_skin')
  if (/sensitiv|react|irritat/.test(t) && primaryConcern !== 'sensitivity') candidates.push('sensitivity')
  if (/dark spot|post.?acne/.test(t) && primaryConcern !== 'hyperpigmentation') candidates.push('hyperpigmentation')

  return candidates[0] || null
}

// ── Routine type inference ────────────────────────────────────────────────────

function inferRoutineType(lead, primaryConcern) {
  const routineLevel = (lead.telegramRoutineLevel || '').toLowerCase()
  const skinSensitive = /sensitiv|react|easily/.test(
    (lead.telegramSensitivity || '') + ' ' + (lead.telegramSkinType || '')
  )

  if (primaryConcern === 'acne') {
    return skinSensitive ? 'barrier_repair' : 'acne_control'
  }
  if (primaryConcern === 'hyperpigmentation') return 'brightening'
  if (primaryConcern === 'dry_skin') return 'hydration_repair'
  if (primaryConcern === 'eczema' || primaryConcern === 'sensitivity') return 'barrier_repair'
  if (primaryConcern === 'body_care') return 'body_treatment'
  if (primaryConcern === 'stretch_marks') return 'body_treatment'

  if (/simple/.test(routineLevel)) return 'simple_routine'
  if (/complete/.test(routineLevel)) return 'complete_routine'
  if (/balanced/.test(routineLevel)) return 'balanced_routine'

  return 'balanced_routine'
}

// ── Urgency inference ─────────────────────────────────────────────────────────

function inferUrgencyLevel(lead) {
  const t = [
    lead.telegramConcern,
    lead.telegramSeverity,
    lead.message,
    lead.telegramGoal,
  ].filter(Boolean).join(' ').toLowerCase()

  if (
    /severe|very bad|extreme|urgent|asap|emergency|really bad|unbearable|painful|spreading/.test(t) ||
    lead.engagementScore === 'high' ||
    lead.priority === 'high'
  ) return 'high'

  if (
    /moderate|getting worse|months|years|tried many|long time/.test(t) ||
    lead.engagementScore === 'medium' ||
    lead.priority === 'medium'
  ) return 'medium'

  return 'low'
}

// ── Academy fit scoring ───────────────────────────────────────────────────────

function inferAcademyFitScore(lead) {
  let score = 0
  const t = [
    lead.message,
    lead.telegramRoutineGoal,
    lead.telegramGoal,
    lead.intentTag,
  ].filter(Boolean).join(' ').toLowerCase()

  // Intake completion = shows serious engagement
  if (lead.telegramStage === 'intake_complete') score += 20
  else if (lead.telegramStage && lead.telegramStage !== 'connected') score += 8

  // Routine interest (people who want to learn routines fit the academy)
  if (/routine|step|regimen|how to|build/.test(t)) score += 15
  if (lead.telegramFlowType === 'routine') score += 10

  // Learning / business signals
  if (/learn|understand|educate|train|brand|business|formul|knowledge|know/.test(t)) score += 25

  // Complete routine preference = willing to invest effort
  if (/complete/.test((lead.telegramRoutineLevel || '').toLowerCase())) score += 10
  else if (/balanced/.test((lead.telegramRoutineLevel || '').toLowerCase())) score += 6

  // Budget signals: premium budget = more likely to invest in education
  if (/premium|high|luxury/.test((lead.telegramBudget || '').toLowerCase())) score += 8

  // Engagement depth
  if (lead.engagementScore === 'high') score += 15
  else if (lead.engagementScore === 'medium') score += 7

  // Explicitly tagged as academy prospect
  if (lead.intentTag && /academy/.test(lead.intentTag)) score += 30

  return Math.min(score, 100)
}

// ── Conversion intent ─────────────────────────────────────────────────────────

function inferConversionIntent(lead, primaryConcern, academyFitScore) {
  const t = [lead.message, lead.intentTag, lead.telegramRoutineGoal].filter(Boolean).join(' ').toLowerCase()

  if (academyFitScore >= 50) return 'academy'
  if (lead.intentTag && /academy/.test(lead.intentTag)) return 'academy'
  if (/consult|doctor|dermato|professional|speak to someone/.test(t)) return 'consultation'

  // Lead completed full intake + has a clear concern = ready for product recommendation
  if (lead.telegramStage === 'intake_complete' && primaryConcern !== 'unknown') return 'product'
  if (['acne', 'hyperpigmentation', 'dry_skin', 'body_care', 'oily_skin'].includes(primaryConcern)) return 'product'

  return 'undecided'
}

// ── Next best action ──────────────────────────────────────────────────────────

function inferNextBestAction(lead, conversionIntent, urgencyLevel, academyFitScore) {
  if (academyFitScore >= 60) return 'push_academy'
  if (conversionIntent === 'consultation') return 'manual_consult'
  if (urgencyLevel === 'high') return 'manual_consult'

  if (lead.telegramStage === 'intake_complete') {
    return conversionIntent === 'product' ? 'recommend_product' : 'recommend_routine'
  }

  if (conversionIntent === 'product') return 'recommend_product'
  if (conversionIntent === 'academy') return 'push_academy'

  return 'nurture'
}

// ── Follow-up angle ───────────────────────────────────────────────────────────

function inferFollowupAngle(primaryConcern, nextBestAction) {
  if (nextBestAction === 'push_academy') return 'emphasize_brand_building_and_education'
  if (nextBestAction === 'manual_consult') return 'personal_attention_high_urgency'
  if (nextBestAction === 'recommend_product') return `targeted_product_for_${primaryConcern}`
  if (nextBestAction === 'recommend_routine') return `routine_education_for_${primaryConcern}`
  return 'gentle_nurture_low_pressure'
}

// ── Confidence score ──────────────────────────────────────────────────────────

function inferConfidenceScore(lead) {
  let score = 10 // base — at minimum we have a lead record

  if (lead.telegramStage === 'intake_complete') score += 40
  else if (lead.telegramStage && lead.telegramStage !== 'connected') score += 15

  if (lead.telegramSkinType) score += 10
  if (lead.telegramConcern || lead.telegramRoutineGoal) score += 15
  if (lead.telegramSeverity) score += 5
  if (lead.telegramBudget) score += 5
  if (lead.telegramSensitivity) score += 5
  if (lead.skinConcern && lead.skinConcern !== 'other') score += 5
  if (lead.message && lead.message.length > 50) score += 5

  return Math.min(score, 100)
}

// ── Diagnosis summary ─────────────────────────────────────────────────────────

function buildDiagnosisSummary(lead, primaryConcern, secondaryConcern, routineType, urgencyLevel, conversionIntent, academyFitScore) {
  const concern = primaryConcern.replace(/_/g, ' ')
  const skinType = lead.telegramSkinType || null
  const sensitive = /sensitiv|react/.test(
    (lead.telegramSensitivity || '') + ' ' + (lead.telegramSkinType || '')
  )

  const leadDesc = [
    `Likely ${concern} lead`,
    skinType ? `with ${skinType} skin` : null,
    sensitive ? 'and sensitivity noted' : null,
    secondaryConcern ? `(secondary: ${secondaryConcern.replace(/_/g, ' ')})` : null,
  ].filter(Boolean).join(' ')

  const routineDesc = `Best fit: ${routineType.replace(/_/g, ' ')}`
  const urgencyDesc = `${urgencyLevel} urgency`
  const academyDesc = academyFitScore >= 60
    ? 'Academy fit: high'
    : academyFitScore >= 30
      ? 'Academy fit: medium'
      : 'Academy fit: low'
  const intentDesc = conversionIntent !== 'undecided'
    ? `Best path: ${conversionIntent}`
    : null

  return [leadDesc, routineDesc, urgencyDesc, academyDesc, intentDesc]
    .filter(Boolean)
    .join('. ') + '.'
}

// ── Product recommendation JSON ───────────────────────────────────────────────

function buildProductRecommendation(analysisResult) {
  const products = analysisResult.productRecommendations || []
  const rec = { cleanser: null, treatment: null, moisturizer: null, sunscreen: null, notes: analysisResult.notes || [] }

  for (const p of products) {
    const pl = p.toLowerCase()
    if (!rec.cleanser && /cleanser|wash|clean/.test(pl)) rec.cleanser = p
    else if (!rec.sunscreen && /spf|sunscreen|sun/.test(pl)) rec.sunscreen = p
    else if (!rec.moisturizer && /moistur|cream|lotion|butter|balm/.test(pl)) rec.moisturizer = p
    else if (!rec.treatment) rec.treatment = p
  }

  return rec
}

// ── Plain-text products summary ───────────────────────────────────────────────

function buildRecommendedProductsText(analysisResult) {
  const morning = analysisResult.routine?.morning || []
  const night = analysisResult.routine?.night || []

  if (morning.length === 0 && night.length === 0) {
    return 'No specific routine available for this concern type.'
  }

  const parts = []
  if (morning.length > 0) parts.push(`Morning: ${morning.slice(0, 3).join(' → ')}`)
  if (night.length > 0) parts.push(`Night: ${night.slice(0, 3).join(' → ')}`)

  return parts.join(' | ')
}

// ── Recommended reply draft ───────────────────────────────────────────────────

function buildRecommendedReply(lead, primaryConcern, nextBestAction) {
  const name = (lead.fullName || '').split(' ')[0] || 'there'
  const concern = primaryConcern.replace(/_/g, ' ')

  switch (nextBestAction) {
    case 'push_academy':
      return (
        `Hi ${name}! Based on what you've shared, I think you'd genuinely benefit from our Academy — ` +
        `it's built for people who want to properly understand skincare from the ground up. ` +
        `Want me to send you the details?`
      )
    case 'manual_consult':
      return (
        `Hi ${name}, I've reviewed what you shared and I'd like to speak with you directly about your skin. ` +
        `Can we do a quick voice note or call consultation?`
      )
    case 'recommend_product':
      return (
        `Hi ${name}! Based on your skin profile, I've put together a targeted product plan for your ${concern}. ` +
        `Want me to send the full recommendation?`
      )
    case 'recommend_routine':
      return (
        `Hi ${name}! I've built a personalised routine for you based on everything you shared — ` +
        `simple, consistent, and matched to your skin. Want me to send it over?`
      )
    default:
      return (
        `Hi ${name}, thank you for sharing your skin details! Our team has reviewed your profile ` +
        `and will get back to you with the right guidance very soon.`
      )
  }
}

// ── Determine diagnosis source ────────────────────────────────────────────────

function inferDiagnosisSource(lead) {
  if (lead.telegramStage === 'intake_complete') return 'telegram_intake'
  if (lead.sourceType === 'comment') return 'instagram_comment'
  if (lead.telegramStarted) return 'telegram_partial'
  return 'crm_data'
}

// ── Core builder (pure — no DB access) ───────────────────────────────────────

/**
 * Builds the full diagnosis result from a Lead record.
 * Calls analyzeLead() internally for the clinical template, then layers
 * rule-based business logic on top.
 *
 * @param {object} lead  Full Lead record (or merged lead + new intake data)
 * @returns {object}     All fields to write to the Lead record
 */
function buildDiagnosisFromLead(lead) {
  // Enrich lead data so analyzeLead can use message/intentTag as fallback signals
  const enrichedLead = {
    ...lead,
    telegramConcern: lead.telegramConcern || lead.message?.slice(0, 200) || null,
    intent: lead.intent || null,
  }

  const analysisResult = analyzeLead(enrichedLead)

  const primaryConcern    = inferPrimaryConcern(lead)
  const secondaryConcern  = inferSecondaryConcern(lead, primaryConcern)
  const routineType       = inferRoutineType(lead, primaryConcern)
  const urgencyLevel      = inferUrgencyLevel(lead)
  const academyFitScore   = inferAcademyFitScore(lead)
  const conversionIntent  = inferConversionIntent(lead, primaryConcern, academyFitScore)
  const nextBestAction    = inferNextBestAction(lead, conversionIntent, urgencyLevel, academyFitScore)
  const followupAngle     = inferFollowupAngle(primaryConcern, nextBestAction)
  const confidenceScore   = inferConfidenceScore(lead)
  const diagnosisSummary  = buildDiagnosisSummary(lead, primaryConcern, secondaryConcern, routineType, urgencyLevel, conversionIntent, academyFitScore)
  const productRecommendation   = buildProductRecommendation(analysisResult)
  const recommendedProductsText = buildRecommendedProductsText(analysisResult)
  const recommendedReply        = buildRecommendedReply(lead, primaryConcern, nextBestAction)
  const diagnosisSource         = inferDiagnosisSource(lead)
  const now = new Date()

  return {
    // ── Fields used by followUpService ────────────────────────────────────────
    diagnosis:            { text: analysisResult.diagnosis, notes: analysisResult.notes },
    routine:              analysisResult.routine,
    products:             { recommendations: analysisResult.productRecommendations },
    diagnosisGeneratedAt: now,

    // ── Enriched engine fields ────────────────────────────────────────────────
    diagnosisSummary,
    primaryConcern,
    secondaryConcern,
    routineType,
    productRecommendation,
    recommendedProductsText,
    academyFitScore,
    conversionIntent,
    urgencyLevel,
    confidenceScore,
    nextBestAction,
    followupAngle,
    recommendedReply,
    diagnosisSource,
    diagnosedAt: now,
  }
}

// ── DB writer ─────────────────────────────────────────────────────────────────

/**
 * Saves a diagnosis result to the Lead record.
 * Does NOT overwrite follow-up timing fields (diagnosisSendAfter etc.) —
 * those are set by the intake session and must not be reset here.
 */
async function saveDiagnosisResult(leadId, result) {
  return prisma.lead.update({
    where: { id: leadId },
    data: {
      diagnosis:            result.diagnosis,
      routine:              result.routine,
      products:             result.products,
      diagnosisGeneratedAt: result.diagnosisGeneratedAt,

      diagnosisSummary:         result.diagnosisSummary,
      primaryConcern:           result.primaryConcern,
      secondaryConcern:         result.secondaryConcern,
      routineType:              result.routineType,
      productRecommendation:    result.productRecommendation,
      recommendedProductsText:  result.recommendedProductsText,
      academyFitScore:          result.academyFitScore,
      conversionIntent:         result.conversionIntent,
      urgencyLevel:             result.urgencyLevel,
      confidenceScore:          result.confidenceScore,
      nextBestAction:           result.nextBestAction,
      followupAngle:            result.followupAngle,
      recommendedReply:         result.recommendedReply,
      diagnosisSource:          result.diagnosisSource,
      diagnosedAt:              result.diagnosedAt,
    },
  })
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Fetches a lead, runs the full diagnosis, saves the result.
 *
 * @param {string} leadId
 * @returns {Promise<object|null>}  diagnosis result, or null if lead not found
 */
async function diagnoseLead(leadId) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })

  if (!lead) {
    console.warn(`[DiagnosisEngine] Lead ${leadId} not found — skipping`)
    return null
  }

  console.log(
    `[DiagnosisEngine] Starting diagnosis | leadId=${leadId} | ` +
    `stage=${lead.telegramStage || 'n/a'} | source=${lead.sourceType || 'n/a'} | ` +
    `skinConcern=${lead.skinConcern || 'n/a'}`
  )

  const result = buildDiagnosisFromLead(lead)

  console.log(
    `[DiagnosisEngine] Result | leadId=${leadId} | ` +
    `primaryConcern=${result.primaryConcern} | ` +
    `routineType=${result.routineType} | ` +
    `urgencyLevel=${result.urgencyLevel} | ` +
    `academyFitScore=${result.academyFitScore} | ` +
    `conversionIntent=${result.conversionIntent} | ` +
    `nextBestAction=${result.nextBestAction} | ` +
    `confidence=${result.confidenceScore} | ` +
    `source=${result.diagnosisSource}`
  )

  await saveDiagnosisResult(leadId, result)
  console.log(`[DiagnosisEngine] Saved → leadId=${leadId}`)

  // Set consult + course offer timing (conversion engine — Phase 18).
  // Only set when lead has a Telegram chatId (delivery channel confirmed).
  // Never overwritten once set.
  if (lead.telegramChatId) {
    const timingUpdates = {}
    const base = result.diagnosedAt

    if (!lead.consultOfferSendAfter) {
      timingUpdates.consultOfferSendAfter = new Date(base.getTime() + 2 * 60 * 60 * 1000)
    }
    if (!lead.courseOfferSendAfter) {
      timingUpdates.courseOfferSendAfter = new Date(base.getTime() + 2 * 24 * 60 * 60 * 1000)
    }

    if (Object.keys(timingUpdates).length > 0) {
      await prisma.lead.update({ where: { id: leadId }, data: timingUpdates })
      console.log(
        `[DiagnosisEngine] conversion timing set | ` +
        `consultOffer=${timingUpdates.consultOfferSendAfter?.toISOString() ?? 'existing'} | ` +
        `courseOffer=${timingUpdates.courseOfferSendAfter?.toISOString() ?? 'existing'} | ` +
        `leadId=${leadId}`
      )
    }
  }

  // Set academyOfferSendAfter timing when fit score qualifies.
  // Timing = productRecoSendAfter + 2d, or diagnosedAt + 5d as fallback.
  // Only written once — never overwritten if already set.
  if (result.academyFitScore >= ACADEMY_FIT_THRESHOLD && !lead.academyOfferSendAfter) {
    const base = lead.productRecoSendAfter
      ? new Date(lead.productRecoSendAfter)
      : result.diagnosedAt
    const academyOfferSendAfter = new Date(base.getTime() + 2 * 24 * 60 * 60 * 1000)
    await prisma.lead.update({
      where: { id: leadId },
      data:  { academyOfferSendAfter },
    })
    console.log(
      `[DiagnosisEngine] academyOfferSendAfter set → ${academyOfferSendAfter.toISOString()} ` +
      `(score=${result.academyFitScore}, leadId=${leadId})`
    )
  }

  console.log(
    `[ProductQuote] skipped until user requests PRODUCT | ` +
    `leadId=${leadId} nextBestAction=${result.nextBestAction}`
  )

  return result
}

// ── Auto product offer ─────────────────────────────────────────────────────────

/**
 * Builds a rich, customer-facing product offer message from fresh diagnosis data.
 * Uses result fields (diagnosis/routine/products) — NOT the operator-only diagnosisSummary.
 *
 * @param {object} lead   — lead record (for name, chatId, budget)
 * @param {object} result — fresh diagnosis result from buildDiagnosisFromLead()
 * @returns {string}
 */
function buildAutoProductOfferMessage(lead, result) {
  const firstName = (lead.fullName || 'there').split(' ')[0]

  const diag    = result.diagnosis || {}
  const routine = result.routine   || {}

  const assessmentText = diag.text || null
  const notes   = Array.isArray(diag.notes)      ? diag.notes      : []
  const morning = Array.isArray(routine.morning) ? routine.morning : []
  const night   = Array.isArray(routine.night)   ? routine.night   : []

  const lines = []

  lines.push(`Hi ${firstName} 🌿`)
  lines.push('')
  lines.push("Based on what you shared, here's your personalised skin recommendation.")

  if (assessmentText) {
    lines.push('')
    lines.push('<b>Assessment:</b>')
    lines.push(assessmentText)
  }

  if (morning.length > 0) {
    lines.push('')
    lines.push('<b>Morning routine:</b>')
    morning.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
  }

  if (night.length > 0) {
    lines.push('')
    lines.push('<b>Night routine:</b>')
    night.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
  }

  // Products — prefer enriched recommendedProductsText over raw JSON array
  if (result.recommendedProductsText) {
    lines.push('')
    lines.push('<b>Recommended products:</b>')
    lines.push(result.recommendedProductsText)
  } else {
    const recs = result.products?.recommendations || []
    if (recs.length > 0) {
      lines.push('')
      lines.push('<b>Recommended products:</b>')
      recs.forEach(p => lines.push(`• ${p}`))
    }
  }

  if (notes.length > 0) {
    lines.push('')
    lines.push('<b>Important notes:</b>')
    notes.forEach(n => lines.push(`• ${n}`))
  }

  lines.push('')
  lines.push(
    "If you'd like, I can also help you choose the best version of this routine " +
    'based on your budget and product availability.'
  )
  lines.push('')
  lines.push('Reply:')
  lines.push('- <b>PRODUCT</b> for the recommended products')
  lines.push('- <b>CONSULT</b> for private guidance')
  lines.push('- <b>ACADEMY</b> if you want to learn how to build your own skincare brand')
  lines.push('')
  lines.push(`Or message us directly:\n👉 ${WHATSAPP_LINK}`)

  return lines.join('\n')
}

/**
 * Fires immediately after diagnosis is saved.
 * Sends the product offer message when conversionIntent=product or
 * nextBestAction=recommend_product, then marks productOfferSent to prevent duplicates.
 *
 * @param {string} leadId
 * @param {object} lead   — original lead object (pre-save, used for chatId + name)
 * @param {object} result — fresh diagnosis result
 */
async function maybeAutoSendProductOffer(leadId, lead, result) {
  // Gate 1: product-fit check
  const isProductFit =
    result.conversionIntent === 'product' ||
    result.nextBestAction   === 'recommend_product'

  if (!isProductFit) {
    console.log(
      `[DiagnosisEngine] auto product decision | leadId=${leadId} ` +
      `nextBestAction=${result.nextBestAction} conversionIntent=${result.conversionIntent} → skip (not product-fit)`
    )
    return
  }

  // Gate 2: needs Telegram channel
  if (!lead.telegramChatId) {
    console.log(`[ProductOffer] skipped | leadId=${leadId} reason=no_telegram_chat_id`)
    return
  }

  // Gate 3: high urgency / manual consult leads go to consult, not product push
  if (result.urgencyLevel === 'high' || result.nextBestAction === 'manual_consult') {
    console.log(
      `[ProductOffer] skipped | leadId=${leadId} ` +
      `reason=manual_consult_required urgencyLevel=${result.urgencyLevel}`
    )
    return
  }

  // Gate 4: dedup — re-read from DB because lead object predates the save
  const freshLead = await prisma.lead.findUnique({
    where:  { id: leadId },
    select: { productOfferSent: true, status: true },
  })
  if (!freshLead) return
  if (freshLead.productOfferSent) {
    console.log(`[ProductOffer] skipped | leadId=${leadId} reason=already_sent`)
    return
  }
  if (freshLead.status === 'closed') {
    console.log(`[ProductOffer] skipped | leadId=${leadId} reason=lead_closed`)
    return
  }

  console.log(
    `[DiagnosisEngine] auto product decision | leadId=${leadId} ` +
    `nextBestAction=${result.nextBestAction} conversionIntent=${result.conversionIntent} → sending product offer`
  )

  console.log(`[ProductOffer] building message | leadId=${leadId}`)
  const msg   = buildAutoProductOfferMessage(lead, result)
  const botId = LEAD_BOT_TOKEN ? LEAD_BOT_TOKEN.split(':')[0] : 'missing'

  console.log(
    `[ProductOffer] sending | leadId=${leadId} chatId=${lead.telegramChatId} botId=${botId}`
  )
  const sendResult = await sendTelegramToUser(lead.telegramChatId, msg, LEAD_BOT_TOKEN)
  const now = new Date()

  if (sendResult?.success) {
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        productOfferSent:        true,
        productOfferSentAt:      now,
        productOfferStatus:      'sent',
        productOfferCount:       { increment: 1 },
        conversionPath:          'product_offer',
        conversionStage:         'offer_sent',
        conversationMode:        'product_reco_active',
        lastBotIntent:           'auto_product_offer',
        lastMeaningfulBotAt:     now,
        lastConversionIntent:    result.conversionIntent || 'product',
        lastConversionTriggerAt: now,
      },
    })
    await prisma.messageLog.create({
      data: {
        type:            'lead',
        recordId:        leadId,
        channel:         'telegram',
        status:          'sent',
        auto:            true,
        triggerReason:   'auto_product_offer_post_diagnosis',
        recipient:       String(lead.telegramChatId),
        deliveryChannel: 'telegram',
        fallbackUsed:    false,
      },
    }).catch(e =>
      console.error(`[ProductOffer] MessageLog write failed | leadId=${leadId}:`, e.message)
    )
    console.log(
      `[ProductOffer] sent | leadId=${leadId} messageId=${sendResult.data?.result?.message_id}`
    )
  } else if (sendResult?.skipped) {
    console.warn(`[ProductOffer] skipped | leadId=${leadId} reason=bot_token_missing`)
  } else {
    console.error(
      `[ProductOffer] failed | leadId=${leadId} error=${JSON.stringify(sendResult?.error)}`
    )
    await prisma.lead.update({
      where: { id: leadId },
      data:  { productOfferStatus: 'failed' },
    }).catch(e =>
      console.error(`[ProductOffer] status update failed | leadId=${leadId}:`, e.message)
    )
  }
}

module.exports = { diagnoseLead, buildDiagnosisFromLead, saveDiagnosisResult }
