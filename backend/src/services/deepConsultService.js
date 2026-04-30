'use strict'

/**
 * deepConsultService.js — AI Consult Engine
 *
 * Triggered when a post-diagnosis lead replies CONSULT (the keyword).
 * Runs a 9-stage deep consultation collecting structured answers, then
 * auto-generates an assessment (Stage 10), treatment protocol (Stage 11),
 * and final options (Stage 12).
 *
 * Separate from the human consult offer (HUMAN CONSULT / PRIVATE CONSULT keyword)
 * which routes directly to WhatsApp booking — that path is unchanged.
 *
 * Flow:
 *   CONSULT keyword → startDeepConsult
 *   Mid-consult reply → handleDeepConsultReply
 *   After final stage → auto-generate assessment + protocol + options
 *   Status: in_progress → completed (or abandoned if admin marks it)
 *
 * Red flags trigger needsHumanReview = true and recommend HUMAN CONSULT.
 */

const prisma = require('../lib/prisma')
const { sendTelegramToUser, sendTelegramMessage } = require('./telegramService')

const LEAD_BOT_TOKEN = process.env.TELEGRAM_LEAD_BOT_TOKEN

// ── Stage definitions ─────────────────────────────────────────────────────────

function stageQuestion(stageNum, lead) {
  const name = (lead.fullName || '').split(' ')[0] || 'there'

  const questions = {
    1: (
      `📋 <b>Stage 1 — Patient Profile</b>\n\n` +
      `Hi ${name} — let's start with some background.\n\n` +
      `Please answer all four:\n\n` +
      `1. How old are you?\n` +
      `2. What is your biological sex? (Female / Male / Prefer not to say)\n` +
      `3. Where are you based? (city and country)\n` +
      `4. How would you describe your skin tone? (very fair / fair / medium / tan / deep)\n\n` +
      `Reply with all four answers in one message.`
    ),
    2: (
      `📋 <b>Stage 2 — Chief Complaint Deep Dive</b>\n\n` +
      `Tell me about your main skin concern in detail:\n\n` +
      `1. What exactly does it look like? (colour, texture, size, spread)\n` +
      `2. How long have you had this issue?\n` +
      `3. When did it first appear? (any event or change that came before it?)\n` +
      `4. Has it changed, spread, or gotten worse over time?\n\n` +
      `Reply with all your answers in one message.`
    ),
    3: (
      `📋 <b>Stage 3 — Symptom Interrogation</b>\n\n` +
      `1. How severe is your concern on a scale of 1–10?\n` +
      `2. Is it painful, itchy, burning, or purely visual?\n` +
      `3. Is it confined to one area or spreading to new areas?\n` +
      `4. Does it come and go (flare-ups) or is it constant?\n` +
      `5. Are there patterns — worse at certain times of month, in heat, cold, or humidity?\n\n` +
      `Reply with your answers.`
    ),
    4: (
      `📋 <b>Stage 4 — Medical & Hormonal History</b>\n\n` +
      `1. Do you have any diagnosed skin conditions? (eczema, psoriasis, rosacea, seborrheic dermatitis, etc.)\n` +
      `2. Any hormonal conditions? (PCOS, thyroid issues, insulin resistance, adrenal issues, etc.)\n` +
      `3. Are you currently pregnant or breastfeeding?\n` +
      `4. Any history of allergies — food, environmental, or contact?\n` +
      `5. Any chronic health conditions? (diabetes, autoimmune, kidney/liver issues, etc.)\n\n` +
      `Reply with your answers. Say "none" for anything that doesn't apply.`
    ),
    5: (
      `📋 <b>Stage 5 — Medication & Supplement Audit</b>\n\n` +
      `1. Are you currently taking any medications? (prescription or OTC)\n` +
      `2. Any hormonal contraceptives? (pill, injection, implant, IUD, patch)\n` +
      `3. Any supplements? (vitamins, collagen, biotin, herbal, iron, omega-3, etc.)\n` +
      `4. Have you recently started or stopped any medication or supplement?\n` +
      `5. Have you ever used steroid-based creams or skin-lightening / bleaching products?\n\n` +
      `Reply with your answers. Say "none" for anything that doesn't apply.`
    ),
    6: (
      `📋 <b>Stage 6 — Recent Exposure & Trigger Audit</b>\n\n` +
      `1. Have you recently traveled, changed city, or changed climate?\n` +
      `2. Any significant dietary changes? (more dairy, sugar, processed food, new diet?)\n` +
      `3. Have you been under unusual stress recently?\n` +
      `4. Any new skincare, haircare, or personal care products in the last 3 months?\n` +
      `5. Any changes at home or work? (new detergent, fabric, air conditioning, new building)\n` +
      `6. Has your water supply changed? (hard water, new area, borehole, etc.)\n\n` +
      `Reply with your answers.`
    ),
    7: (
      `📋 <b>Stage 7 — Current Skincare Routine Audit</b>\n\n` +
      `Walk me through your routine step by step:\n\n` +
      `1. <b>Morning:</b> What products do you use and in what order?\n` +
      `2. <b>Evening:</b> What products do you use and in what order?\n` +
      `3. Are you using any actives? (retinol, AHAs, BHAs, vitamin C, niacinamide, benzoyl peroxide, etc.)\n` +
      `4. How often do you exfoliate and what do you use?\n` +
      `5. Do you wear SPF every morning? (yes / no / sometimes)\n\n` +
      `Be as specific as possible — product names help if you have them.`
    ),
    8: (
      `📋 <b>Stage 8 — Lifestyle Factors</b>\n\n` +
      `1. How many hours of sleep do you typically get per night?\n` +
      `2. How much water do you drink daily? (glasses or litres)\n` +
      `3. How would you describe your typical diet? (balanced / high sugar / high dairy / vegan / junk food / etc.)\n` +
      `4. How often do you exercise? (daily / 3× per week / rarely / never)\n` +
      `5. Do you smoke, drink alcohol, or use anything else regularly? If so, how often?\n` +
      `6. On a typical day, how stressed are you on a scale of 1–10?\n\n` +
      `Reply with your answers.`
    ),
    9: (
      `📋 <b>Stage 9 — Photo Review</b>\n\n` +
      `Your skin images are on file. To help us correlate what you've described with what we can see:\n\n` +
      `1. Which area of your skin is shown in the photos?\n` +
      `2. Do the photos show your concern at its worst, average, or an improving day?\n` +
      `3. Is there anything visible in the photos you'd specifically like to flag for the assessment?\n\n` +
      `Reply with your answers.`
    ),
  }

  return questions[stageNum] || null
}

const STAGE_NAMES = {
  1:  'Patient Profile',
  2:  'Chief Complaint',
  3:  'Symptom Interrogation',
  4:  'Medical & Hormonal History',
  5:  'Medication & Supplement Audit',
  6:  'Trigger & Exposure Audit',
  7:  'Skincare Routine Audit',
  8:  'Lifestyle Factors',
  9:  'Photo Review',
  10: 'Diagnosis & Assessment',
  11: 'Treatment Protocol',
  12: 'Follow-up Protocol',
}

// ── Red flag detection ────────────────────────────────────────────────────────

const RED_FLAG_PATTERNS = [
  { re: /bleed(ing)?|blood|haemorrhag|hemorrhag/i,                                        flag: 'bleeding' },
  { re: /spreading (rapidly|fast|quickly|everywhere)|spread(ing)? all over/i,             flag: 'spreading_rapidly' },
  { re: /severe pain|extreme(ly)? pain(ful)?|unbearable|excruciating/i,                   flag: 'severe_pain' },
  { re: /pus|infected|infection|swollen|swelling|fever|discharge/i,                        flag: 'infection_signs' },
  { re: /pregnant|breastfeed(ing)?|nursing|postpartum/i,                                   flag: 'pregnancy_or_breastfeeding' },
  { re: /steroid|clobetasol|betamethasone|bleach(ing)?|toning soap|hydroquinone|mercury/i, flag: 'steroid_or_bleaching_misuse' },
  { re: /PCOS|polycystic|thyroid|insulin resistance|hormonal imbalance/i,                  flag: 'hormonal_systemic_issue' },
  { re: /autoimmune|lupus|psoriasis.{0,20}spreading|eczema.{0,20}(all over|full body)/i,  flag: 'systemic_autoimmune' },
]

function detectRedFlags(allAnswersText) {
  const flags = []
  for (const { re, flag } of RED_FLAG_PATTERNS) {
    if (re.test(allAnswersText) && !flags.includes(flag)) {
      flags.push(flag)
    }
  }
  return flags
}

// ── Assessment generator ──────────────────────────────────────────────────────

function buildAssessment(lead, answers, redFlags) {
  const concern   = (lead.primaryConcern || lead.skinConcern || 'your skin concern').replace(/_/g, ' ')
  const symptoms  = answers.stage_3 || ''
  const triggers  = answers.stage_6 || ''
  const lifestyle = answers.stage_8 || ''
  const meds      = answers.stage_5 || ''

  const severityMatch = symptoms.match(/\b([1-9]|10)\b/)
  const severity      = severityMatch ? severityMatch[0] : null

  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })

  let text =
    `🩺 <b>MICAHSKIN Skin Consultation — Assessment</b>\n\n` +
    `<b>Client:</b> ${lead.fullName}\n` +
    `<b>Primary Concern:</b> ${concern}\n` +
    `<b>Date:</b> ${today}\n\n` +
    `<b>─── Clinical Assessment ───</b>\n\n` +
    `Based on your detailed consultation, here is our assessment:\n\n` +
    `<b>1. Clinical Picture</b>\n` +
    `Your primary concern is <b>${concern}</b>. `

  if (severity) text += `You rate severity at ${severity}/10. `
  text +=
    `The history and symptom pattern you've described gives us a clear picture of what is happening at the skin barrier level.\n\n`

  // Contributing factor analysis
  const factors = []
  if (/stress|stressed|burnout|anxiety/i.test(triggers + lifestyle)) {
    factors.push('chronic stress — elevates cortisol, directly disrupts skin barrier function')
  }
  if (/dairy|milk|cheese|yogurt|whey/i.test(triggers + lifestyle)) {
    factors.push('dairy consumption — linked to increased sebum production and hormonal disruption')
  }
  if (/sugar|sweets|soda|processed food/i.test(lifestyle)) {
    factors.push('high-glycaemic diet — triggers insulin spikes that worsen inflammation')
  }
  if (/sleep|tired|fatigue/i.test(lifestyle) && !/\b[789]\b|\b10\b/.test(lifestyle)) {
    factors.push('sleep deprivation — impairs overnight skin repair and immune response')
  }
  if (/steroid|bleach|lighten|toning/i.test(meds)) {
    factors.push('history of skin-lightening or steroid product use — can compromise the barrier and cause rebound damage')
  }
  if (/no spf|no sunscreen|don.?t use spf|don't wear/i.test(answers.stage_7 || '')) {
    factors.push('insufficient daily SPF — UV exposure drives pigmentation, premature ageing, and most chronic skin concerns')
  }

  text += `<b>2. Likely Contributing Factors</b>\n`
  if (factors.length > 0) {
    text += factors.map(f => `• ${f}`).join('\n') + '\n\n'
  } else {
    text +=
      `Based on your responses, contributing factors will be better assessed once the full history is reviewed by a specialist.\n\n`
  }

  // Red flags
  if (redFlags.length > 0) {
    const FLAG_TEXT = {
      bleeding:                  '• Active bleeding or blood reported — requires urgent medical evaluation',
      spreading_rapidly:         '• Rapidly spreading skin changes — may indicate an acute reaction or systemic issue',
      severe_pain:               '• Severe pain reported — may indicate deeper tissue involvement or infection',
      infection_signs:           '• Signs consistent with infection (pus, swelling, fever) — medical attention required',
      pregnancy_or_breastfeeding: '• Pregnancy or breastfeeding noted — many active ingredients are contraindicated; full protocol adjustment required',
      steroid_or_bleaching_misuse: '• History of steroid or bleaching product use — skin barrier likely compromised; specialist management required',
      hormonal_systemic_issue:   '• Hormonal condition present (PCOS / thyroid / insulin resistance) — skin concern is likely hormonally driven; topical products alone will have limited effect without systemic support',
      systemic_autoimmune:       '• Autoimmune or systemic condition noted — dermatologist involvement may be required',
    }
    text += `⚠️ <b>3. Clinical Flags Identified</b>\n`
    for (const flag of redFlags) {
      if (FLAG_TEXT[flag]) text += FLAG_TEXT[flag] + '\n'
    }
    text +=
      `\n<b>Recommendation:</b> Given the flags above, we strongly recommend a direct consultation with our specialist before any active protocol.\n\n`
  }

  text +=
    `<b>${redFlags.length > 0 ? '4' : '3'}. What This Means For You</b>\n` +
    `Your skin concern is manageable with the right protocol — but it requires a targeted, staged approach, not a generic routine. ` +
    (redFlags.length > 0
      ? `Given the flags above, certain aspects of your protocol need careful management to avoid worsening the condition.`
      : `With the correct products and habits, meaningful improvement is realistic within 6–12 weeks.`)

  return text
}

// ── Protocol generator ────────────────────────────────────────────────────────

function buildProtocol(lead, answers, redFlags) {
  const concern     = (lead.primaryConcern || lead.skinConcern || 'your skin concern').replace(/_/g, ' ')
  const routine     = answers.stage_7 || ''
  const medHistory  = answers.stage_4 || ''
  const meds        = answers.stage_5 || ''
  const hasActives  = /retinol|AHA|BHA|acid|exfoliat|vitamin c|niacinamide|benzoyl/i.test(routine)
  const hasBlCream  = /steroid|bleach|lighten|toning/i.test(meds)
  const isPregnant  = /pregnant|breastfeed/i.test(medHistory)
  const hasHormonal = redFlags.includes('hormonal_systemic_issue')

  let text =
    `💊 <b>Stage 11 — Treatment Protocol</b>\n\n` +
    `<b>Recommended Approach for ${concern}:</b>\n\n` +
    `<b>Phase 1 — Restore (Weeks 1–4)</b>\n` +
    `• Strip your routine to the essentials: gentle cleanser, barrier-repairing moisturiser, SPF\n`

  if (hasBlCream) {
    text += `• Stop all bleaching and lightening products immediately — skin needs time to recover\n`
  }
  if (hasActives) {
    text += `• Pause all actives for 2 weeks to reset your barrier before reintroducing anything\n`
  }
  text +=
    `• Prioritise hydration: ceramide or hyaluronic-based moisturiser, morning and evening\n` +
    `• SPF 30–50+ minimum, every morning — this is non-negotiable for ${concern}\n\n` +
    `<b>Phase 2 — Target (Weeks 5–10)</b>\n`

  if (isPregnant) {
    text +=
      `• Limited options during pregnancy/breastfeeding — azelaic acid and physical SPF are the safest actives\n` +
      `• Avoid: retinol, high-dose salicylic acid, hydroquinone, benzoyl peroxide at high concentration\n` +
      `• Consult your OB/GYN before introducing any active ingredient\n`
  } else if (hasBlCream) {
    text +=
      `• Introduce actives slowly once barrier is restored — start with niacinamide (barrier-stabilising)\n` +
      `• Avoid all bleaching-category actives; focus on natural brighteners (vitamin C, alpha-arbutin)\n` +
      `• Introduce one active at a time, wait 2 weeks between each new addition\n`
  } else {
    text +=
      `• Once barrier is stable, introduce a targeted active specific to ${concern}\n` +
      `• Add one new product at a time (minimum 2-week wait before the next)\n` +
      `• Patch test every new product on your inner arm before full-face application\n`
  }

  text +=
    `\n<b>Lifestyle Adjustments</b>\n` +
    `• Aim for at least 2 litres of water daily\n` +
    `• Reduce dairy and high-sugar foods — these directly worsen most skin concerns\n` +
    `• Protect your sleep — 7–9 hours is when skin repair happens\n` +
    `• Manage stress: consistent exercise, breathwork, or journaling all show measurable impact on skin\n`

  if (hasHormonal) {
    text +=
      `\n⚠️ <b>Important:</b> With a hormonal condition present, topical products alone will have limited effect. ` +
      `Address skin AND hormonal health in parallel for lasting results. Speak with your doctor about systemic support.\n`
  }

  text +=
    `\n─────────────────────\n` +
    `This is your framework. For the specific products matched to your skin type, budget, and concern — reply with your next step:\n\n` +
    `👉 <b>PRODUCT</b> — curated product quote (reviewed by our team before sending)\n` +
    `👉 <b>HUMAN CONSULT</b> — speak directly with a MICAHSKIN specialist\n` +
    `👉 <b>ACADEMY</b> — deep skincare education + brand-building programme`

  return text
}

// ── Consultation lookup ───────────────────────────────────────────────────────

async function getActiveConsultation(leadId) {
  return prisma.deepConsultation.findFirst({
    where:   { leadId, status: 'in_progress' },
    orderBy: { createdAt: 'desc' },
  })
}

// ── Start consultation ────────────────────────────────────────────────────────

async function startDeepConsult(lead, chatId) {
  const existing = await getActiveConsultation(lead.id)

  if (existing) {
    // Re-send the current stage question so the lead can continue
    const stageName = STAGE_NAMES[existing.currentStage] || `Stage ${existing.currentStage}`
    const question  = stageQuestion(existing.currentStage, lead)
    if (question) {
      await sendTelegramToUser(
        chatId,
        `You're already in a consultation at <b>${stageName}</b>. Continuing from where we left off:\n\n${question}`,
        LEAD_BOT_TOKEN
      ).catch(err => console.error('[DeepConsult] re-send stage failed:', err.message))
    }
    return
  }

  // Create new consultation record
  const consultation = await prisma.deepConsultation.create({
    data: {
      leadId:       lead.id,
      currentStage: 1,
      status:       'in_progress',
      answers:      {},
    },
  })

  // Set lead conversation mode
  await prisma.lead.update({
    where: { id: lead.id },
    data:  { conversationMode: 'deep_consult_active', lastUserIntent: 'deep_consult_started' },
  })

  // Opening message
  await sendTelegramToUser(
    chatId,
    `🌿 <b>Welcome to your MICAHSKIN Skin Consultation.</b>\n\n` +
    `I'm going to ask you a series of questions before we assess your skin. Please answer each one as fully and honestly as possible — the accuracy of your assessment depends entirely on the quality of your answers.\n\n` +
    `Nothing here is too small or embarrassing to mention. There are no wrong answers.\n\n` +
    `This consultation has <b>9 stages</b>. Take your time with each one.\n\n` +
    `─────────────────────`,
    LEAD_BOT_TOKEN
  ).catch(err => console.error('[DeepConsult] opening message failed:', err.message))

  // Stage 1 question
  const q1 = stageQuestion(1, lead)
  await sendTelegramToUser(chatId, q1, LEAD_BOT_TOKEN)
    .catch(err => console.error('[DeepConsult] stage 1 send failed:', err.message))

  // Admin alert
  sendTelegramMessage(
    `🧬 <b>Deep consultation started</b>\n\n` +
    `<b>Lead:</b> ${lead.fullName}\n` +
    `<b>Concern:</b> ${(lead.primaryConcern || lead.skinConcern || '—').replace(/_/g, ' ')}\n` +
    `<b>Consult ID:</b> ...${consultation.id.slice(-8)}`
  ).catch(() => {})

  console.log(`[DeepConsult] started | leadId=${lead.id} consultId=${consultation.id}`)
}

// ── Handle in-progress reply ──────────────────────────────────────────────────

async function handleDeepConsultReply(lead, text, chatId) {
  const consultation = await getActiveConsultation(lead.id)

  if (!consultation) {
    // State lost — return to normal mode
    await prisma.lead.update({
      where: { id: lead.id },
      data:  { conversationMode: 'diagnosis_sent' },
    }).catch(() => {})
    await sendTelegramToUser(
      chatId,
      `Your consultation session has ended. Reply <b>CONSULT</b> to start a new one, or <b>PRODUCT</b> for your product recommendations.`,
      LEAD_BOT_TOKEN
    ).catch(() => {})
    return
  }

  const stage   = consultation.currentStage
  const answers = (consultation.answers && typeof consultation.answers === 'object')
    ? { ...consultation.answers }
    : {}

  // Save current stage answer
  const stageKey      = `stage_${stage}`
  const updatedAnswers = { ...answers, [stageKey]: text }

  // Red flag scan over all answers collected so far
  const allText  = Object.values(updatedAnswers).join(' ')
  const redFlags = detectRedFlags(allText)
  const needsHR  = redFlags.length > 0

  // Determine the last collection stage (Stage 9 only if photos uploaded)
  const hasPhotos        = lead.imageUploadStatus === 'uploaded'
  const maxCollectStage  = hasPhotos ? 9 : 8

  if (stage === maxCollectStage) {
    // All collection stages done — persist answers and generate output
    await prisma.deepConsultation.update({
      where: { id: consultation.id },
      data: {
        currentStage:    10,
        answers:         updatedAnswers,
        needsHumanReview: needsHR,
        redFlags,
      },
    })

    // Alert admin about red flags before sending
    if (needsHR) {
      sendTelegramMessage(
        `⚠️ <b>Red flags detected in deep consultation</b>\n\n` +
        `<b>Lead:</b> ${lead.fullName}\n` +
        `<b>Flags:</b> ${redFlags.join(', ')}\n` +
        `<b>Consult ID:</b> ...${consultation.id.slice(-8)}\n\n` +
        `Please review in CRM and consider sending a human consult offer.`
      ).catch(() => {})
    }

    // Stage 10 — Assessment
    const assessmentText = buildAssessment(lead, updatedAnswers, redFlags)
    await sendTelegramToUser(chatId, assessmentText, LEAD_BOT_TOKEN)
      .catch(err => console.error('[DeepConsult] assessment send failed:', err.message))

    // Stage 11 — Protocol
    const protocolText = buildProtocol(lead, updatedAnswers, redFlags)
    await sendTelegramToUser(chatId, protocolText, LEAD_BOT_TOKEN)
      .catch(err => console.error('[DeepConsult] protocol send failed:', err.message))

    // Mark completed
    await prisma.deepConsultation.update({
      where: { id: consultation.id },
      data: {
        currentStage:     12,
        assessment:       assessmentText,
        status:           'completed',
        completedAt:      new Date(),
        needsHumanReview: needsHR,
        redFlags,
      },
    })

    // Return lead to normal post-diagnosis mode so PRODUCT / HUMAN CONSULT / ACADEMY work
    await prisma.lead.update({
      where: { id: lead.id },
      data:  { conversationMode: 'diagnosis_sent', lastUserIntent: 'deep_consult_completed' },
    })

    // Admin completion alert
    sendTelegramMessage(
      `✅ <b>Deep consultation completed</b>\n\n` +
      `<b>Lead:</b> ${lead.fullName}\n` +
      `<b>Flags:</b> ${redFlags.length > 0 ? redFlags.join(', ') : 'none'}\n` +
      `<b>Human review needed:</b> ${needsHR ? 'YES ⚠️' : 'No'}\n` +
      `<b>Consult ID:</b> ...${consultation.id.slice(-8)}`
    ).catch(() => {})

    console.log(`[DeepConsult] completed | leadId=${lead.id} consultId=${consultation.id} redFlags=${redFlags.length}`)
    return
  }

  // Still collecting — advance to next stage
  let nextStage = stage + 1
  // Skip Stage 9 if no photos
  if (stage === 8 && !hasPhotos) nextStage = 10

  await prisma.deepConsultation.update({
    where: { id: consultation.id },
    data: {
      currentStage:     nextStage,
      answers:          updatedAnswers,
      needsHumanReview: needsHR,
      redFlags,
    },
  })

  // Progress header + next question
  const totalStages = hasPhotos ? 9 : 8
  const nextQ       = stageQuestion(nextStage, lead)
  if (nextQ) {
    const progress = `✅ Stage ${stage}/${totalStages} saved.\n\n`
    await sendTelegramToUser(chatId, progress + nextQ, LEAD_BOT_TOKEN)
      .catch(err => console.error('[DeepConsult] next stage send failed:', err.message))
  }

  console.log(`[DeepConsult] stage ${stage}→${nextStage} | leadId=${lead.id} consultId=${consultation.id}`)
}

module.exports = {
  startDeepConsult,
  handleDeepConsultReply,
  getActiveConsultation,
  STAGE_NAMES,
}
