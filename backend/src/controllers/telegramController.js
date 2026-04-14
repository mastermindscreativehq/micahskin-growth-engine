const prisma = require('../lib/prisma')
const { sendTelegramToUser, sendTelegramMessage } = require('../services/telegramService')
const { analyzeLead } = require('../services/diagnosisService')

// ── Flow definitions ──────────────────────────────────────────────────────────
//
// Each flow has:
//   orderedStages  — the stages in order, ending with 'intake_complete'
//   questions      — the question to ask when the bot enters that stage
//   saveField      — which DB column stores the user's answer for that stage
//   completeMessage — sent once when intake_complete is reached

const FLOW_CONFIG = {
  routine: {
    orderedStages: [
      'routine_goal_pending',
      'area_pending',
      'skin_type_pending',
      'products_used_pending',
      'sensitivity_pending',
      'budget_pending',
      'routine_level_pending',
      'intake_complete',
    ],
    questions: {
      routine_goal_pending:  'What result do you want most right now \u2014 brighter skin, glow, smoother skin, even tone, hydration, or something else?',
      area_pending:          'Is this mainly for your face, body, or both?',
      skin_type_pending:     'How would you describe your skin type: oily, dry, combination, sensitive, or not sure?',
      products_used_pending: 'What products are you currently using, if any?',
      sensitivity_pending:   'Does your skin react easily or feel sensitive to products?',
      budget_pending:        'Are you looking for a budget, mid-range, or premium routine?',
      routine_level_pending: 'Do you want a simple routine, a balanced routine, or a more complete routine?',
    },
    saveField: {
      routine_goal_pending:  'telegramRoutineGoal',
      area_pending:          'telegramArea',
      skin_type_pending:     'telegramSkinType',
      products_used_pending: 'telegramProductsUsed',
      sensitivity_pending:   'telegramSensitivity',
      budget_pending:        'telegramBudget',
      routine_level_pending: 'telegramRoutineLevel',
    },
    completeMessage: 'Perfect \u2014 I\u2019ve saved that. Our team will prepare a routine recommendation for you here shortly \ud83c\udf3f',
  },

  concern: {
    orderedStages: [
      'concern_pending',
      'duration_pending',
      'area_pending',
      'skin_type_pending',
      'products_tried_pending',
      'severity_pending',
      'goal_pending',
      'intake_complete',
    ],
    questions: {
      concern_pending:        'What is the main skin issue you want help with right now?',
      duration_pending:       'How long have you been dealing with this?',
      area_pending:           'Is it mainly on your face, body, or both?',
      skin_type_pending:      'How would you describe your skin type: oily, dry, combination, sensitive, or not sure?',
      products_tried_pending: 'What products or remedies have you already tried for this?',
      severity_pending:       'Would you say it is mild, moderate, or severe?',
      goal_pending:           'What result do you want most right now?',
    },
    saveField: {
      concern_pending:        'telegramConcern',
      duration_pending:       'telegramDuration',
      area_pending:           'telegramArea',
      skin_type_pending:      'telegramSkinType',
      products_tried_pending: 'telegramProductsTried',
      severity_pending:       'telegramSeverity',
      goal_pending:           'telegramGoal',
    },
    completeMessage: 'Perfect \u2014 I\u2019ve saved that. Our team will continue with you here shortly \ud83c\udf3f',
  },
}

// ── Helper: question for a given stage + flow ─────────────────────────────────

/**
 * Returns the question string the bot should ask when it enters `stage` on `flowType`.
 * Returns null if there is no question (e.g. intake_complete or unknown stage).
 */
function getNextQuestion(stage, flowType) {
  return FLOW_CONFIG[flowType]?.questions[stage] ?? null
}

// ── Helper: advance to the next stage in the same flow ───────────────────────

/**
 * Returns the stage that follows `currentStage` in the given flow.
 * Always moves forward — never backward. Falls back to 'intake_complete'.
 */
function getNextStage(currentStage, flowType) {
  const stages = FLOW_CONFIG[flowType]?.orderedStages
  if (!stages) return 'intake_complete'
  const idx = stages.indexOf(currentStage)
  if (idx === -1 || idx >= stages.length - 1) return 'intake_complete'
  return stages[idx + 1]
}

// ── Classification helpers ────────────────────────────────────────────────────

/**
 * Detects routine / glow / brightening intent from the user's first message.
 * Must be checked BEFORE classifyConcern — if this returns true the lead goes
 * to PATH A (routine), otherwise to PATH B (concern).
 */
function detectRoutineIntent(text) {
  const t = text.toLowerCase()
  if (/(?:skincare|skin care|body care|body|full|daily)\s+routine/.test(t)) return true
  if (/\bi (?:need|want) (?:a |my |to )?routine/.test(t)) return true
  if (/need (?:a |my )?routine\b/.test(t)) return true
  if (/\bglow[\s-]?up\b/.test(t)) return true
  if (/want (?:to )?glow(?:ing)?\b/.test(t)) return true
  if (/brighter skin|bright skin|skin brightening/.test(t)) return true
  if (/want (?:glowing|brighter|smoother)\b/.test(t)) return true
  if (/\beven (?:out|my)? (?:skin )?tone\b/.test(t)) return true
  if (/\bskin maintenance\b/.test(t)) return true
  return false
}

/**
 * Maps a concern-path first message to a skin-concern bucket.
 * Only used when detectRoutineIntent() returned false.
 */
function classifyConcern(text) {
  const t = text.toLowerCase()
  if (/acne|pimple|breakout|blemish|spot/.test(t)) return 'acne'
  if (/hyperpigment|pigment|dark spot|discolou?r|uneven tone|dark mark/.test(t)) return 'hyperpigmentation'
  if (/stretch mark|stretchmark/.test(t)) return 'stretch_marks'
  if (/dry|dehydrat|flak|tight skin/.test(t)) return 'dry_skin'
  if (/sensitiv|react|irritat|redness|rash/.test(t)) return 'sensitive_skin'
  if (/body|back|chest|arm|leg|stomach|torso/.test(t)) return 'body_care'
  return 'general'
}

/**
 * Detects price / urgency signals in any message at any stage.
 * These are stored separately and NEVER reset the stage or flow type.
 */
function detectPriceIntent(text) {
  const t = text.toLowerCase()
  if (/i want to buy|want to buy|ready to buy|how (?:do i|to) order/.test(t)) return 'price'
  if (/\bprice\b|\bprices\b|\bcost\b|\bcosts\b|how much|pricing/.test(t)) return 'price'
  if (/\burgent\b|\basap\b|right now|need it now/.test(t)) return 'urgent'
  return null
}

/**
 * For pre-upgrade leads that have a telegramStage but no telegramFlowType,
 * infer the flow from the stage name so backward compatibility is preserved.
 */
function inferFlowTypeFromStage(stage) {
  if (/routine_goal|products_used|sensitivity_pending|budget_pending|routine_level/.test(stage)) return 'routine'
  return 'concern'
}

// ── Engagement scoring ────────────────────────────────────────────────────────

function computeEngagementScore(lead, now, text = '') {
  if (lead.telegramLastMessage) return 'high'
  const fastReply =
    lead.telegramConnectedAt &&
    now - new Date(lead.telegramConnectedAt).getTime() < 15 * 60 * 1000
  if (fastReply || text.length >= 60) return 'high'
  return 'medium'
}

// ── Webhook handler ───────────────────────────────────────────────────────────

/**
 * POST /api/telegram/webhook
 *
 * Receives raw Telegram Bot API updates. Routes to the correct handler based
 * on whether the chatId belongs to a Lead, an AcademyRegistration, or is unknown.
 *
 * Always responds 200 immediately — Telegram retries if it gets anything else.
 */
async function handleWebhook(req, res) {
  res.sendStatus(200)

  try {
    const update = req.body
    const message = update?.message

    if (!message || !message.text) return

    const chatId = String(message.chat.id)
    const username = message.from?.username || null
    const firstName = message.from?.first_name || null
    const text = message.text.trim()

    // ── /start command ────────────────────────────────────────────────────────
    if (text.startsWith('/start')) {
      const payload = text.slice('/start'.length).trim()

      if (payload.startsWith('lead_')) {
        await linkLead({ leadId: payload.slice('lead_'.length), chatId, username })
      } else if (payload.startsWith('academy_')) {
        await linkAcademy({ registrationId: payload.slice('academy_'.length), chatId, username })
      } else {
        const greeting = firstName ? `Hi ${firstName}!` : 'Hi!'
        await sendTelegramToUser(
          chatId,
          `${greeting} Welcome to <b>MICAHSKIN</b> \ud83c\udf3f\n\nTo connect your account, please use the link from your registration form and tap <b>Start</b>.`
        )
      }
      return
    }

    // ── Route to correct handler based on chatId lookup ───────────────────────
    const lead = await prisma.lead.findFirst({ where: { telegramChatId: chatId } })
    if (lead) {
      await handleLeadReply({ lead, chatId, text })
      return
    }

    const academy = await prisma.academyRegistration.findFirst({ where: { telegramChatId: chatId } })
    if (academy) {
      await handleAcademyReply({ academy, chatId, text })
      return
    }

    // Unknown chatId — prompt them to use the deep link
    const greeting = firstName ? `Hi ${firstName}!` : 'Hi!'
    await sendTelegramToUser(
      chatId,
      `${greeting} We don\u2019t have a connected account for this chat yet.\n\nPlease use the link from your registration form to connect your account \ud83c\udf3f`
    )

  } catch (err) {
    console.error('[Telegram Webhook] Error processing update:', err.message)
  }
}

// ── Lead reply handler ────────────────────────────────────────────────────────

/**
 * Dual-path state machine for lead replies.
 *
 * PATH A — ROUTINE  (telegramFlowType = 'routine')
 *   connected → routine_goal_pending → area_pending → skin_type_pending
 *   → products_used_pending → sensitivity_pending → budget_pending
 *   → routine_level_pending → intake_complete
 *
 * PATH B — CONCERN  (telegramFlowType = 'concern')
 *   connected → concern_pending → duration_pending → area_pending
 *   → skin_type_pending → products_tried_pending → severity_pending
 *   → goal_pending → intake_complete
 *
 * Hard rules enforced:
 *   - ONE user message → ONE bot reply
 *   - Flow type classified ONCE at connected stage, stored in DB, never re-detected
 *   - Stage always advances forward — never backward
 *   - "Nothing" is a valid answer (no empty-answer guard needed; any non-blank text advances)
 *   - Purchase/price signals stored as intent flag but NEVER affect stage or flow type
 */
async function handleLeadReply({ lead, chatId, text }) {
  const now = Date.now()

  // Always read stage and flow type from DB — never infer from message content after classification
  const effectiveStage = lead.telegramStage ?? (lead.telegramLastMessage ? 'intake_complete' : 'connected')
  let flowType = lead.telegramFlowType ?? null

  const updateData = {
    telegramLastMessage: text,
    telegramLastMessageAt: new Date(now),
    engagementScore: computeEngagementScore(lead, now, text),
  }

  let autoResponse = null

  // ── Stage: connected — classify intent ONCE ───────────────────────────────
  if (effectiveStage === 'connected') {
    if (detectRoutineIntent(text)) {
      flowType = 'routine'
      updateData.telegramFlowType = 'routine'
      updateData.intent = 'routine'
      updateData.telegramStage = 'routine_goal_pending'
    } else {
      flowType = 'concern'
      updateData.telegramFlowType = 'concern'
      updateData.intent = classifyConcern(text)
      updateData.telegramStage = 'concern_pending'
    }
    if (['new', 'contacted'].includes(lead.status)) updateData.status = 'engaged'
    autoResponse = getNextQuestion(updateData.telegramStage, flowType)

  // ── Stage: intake_complete — SILENT MODE. Bot does not respond. ───────────
  } else if (effectiveStage === 'intake_complete') {
    // Intake is done. Persist any tracking fields but send nothing.
    await prisma.lead.update({ where: { id: lead.id }, data: updateData })
    console.log(`[Telegram Webhook] Lead ${lead.id} — stage=intake_complete | bot silent (no reply sent)`)
    return

  // ── Active intake stage — advance within current flow ─────────────────────
  } else {
    // Repair missing flowType for pre-upgrade leads that already have a stage set
    if (!flowType) {
      flowType = inferFlowTypeFromStage(effectiveStage)
      updateData.telegramFlowType = flowType
    }

    const flow = FLOW_CONFIG[flowType]

    if (!flow) {
      // Unknown flow — safe acknowledgement, no question repeated
      autoResponse = 'Thanks \u2014 our team will continue with you here shortly.'
    } else {
      // Save the answer for the current stage
      const saveField = flow.saveField[effectiveStage]
      if (saveField) updateData[saveField] = text

      // Advance deterministically to the next stage — NEVER regress
      const nextStage = getNextStage(effectiveStage, flowType)
      updateData.telegramStage = nextStage

      if (nextStage === 'intake_complete') {
        if (['new', 'contacted', 'engaged'].includes(lead.status)) updateData.status = 'interested'
        autoResponse = flow.completeMessage

        // ── Generate diagnosis and schedule follow-up messages ───────────────
        try {
          // Merge DB record with answers captured in this request so analyzeLead
          // has access to the very last answer (just stored in updateData).
          const merged = { ...lead, ...updateData }
          const diag = analyzeLead(merged)
          const now = new Date()

          updateData.diagnosis            = { text: diag.diagnosis, notes: diag.notes }
          updateData.routine              = diag.routine
          updateData.products             = { recommendations: diag.productRecommendations }
          updateData.diagnosisGeneratedAt = now
          // T+1h → full diagnosis + routine
          updateData.diagnosisSendAfter   = new Date(now.getTime() + 60 * 60 * 1000)
          // T+24h → check-in
          updateData.checkInSendAfter     = new Date(now.getTime() + 24 * 60 * 60 * 1000)
          // T+3 days → product recommendation
          updateData.productRecoSendAfter = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

          console.log(`[Telegram Webhook] Diagnosis generated for lead ${lead.id} | concern=${diag.diagnosis.slice(0, 60)}…`)
        } catch (diagErr) {
          console.error('[Telegram Webhook] diagnosisService error:', diagErr.message)
          // Non-fatal — intake still completes even if diagnosis generation fails
        }
      } else {
        autoResponse = getNextQuestion(nextStage, flowType)
      }
    }
  }

  // Price / urgency signals stored as intent — NEVER reset stage or flowType
  const priceSignal = detectPriceIntent(text)
  if (priceSignal && !updateData.intent) {
    updateData.intent = priceSignal
  }

  await prisma.lead.update({ where: { id: lead.id }, data: updateData })
  await sendTelegramToUser(chatId, autoResponse)

  // Admin alert for high engagement
  if (updateData.engagementScore === 'high') {
    await sendTelegramMessage(
      `\ud83d\udd25 <b>Hot lead reply</b>\n\n` +
      `<b>Name:</b> ${lead.fullName}\n` +
      `<b>Telegram:</b> ${lead.telegramUsername ? `@${lead.telegramUsername}` : chatId}\n` +
      `<b>Stage:</b> ${updateData.telegramStage ?? effectiveStage}\n` +
      `<b>Flow:</b> ${flowType ?? 'unknown'}\n` +
      `<b>Intent:</b> ${updateData.intent ?? lead.intent ?? 'unknown'}\n` +
      `<b>Message:</b> ${text.slice(0, 200)}`
    ).catch(() => {})
  }

  console.log(
    `[Telegram Webhook] Lead ${lead.id} — stage ${effectiveStage} \u2192 ${updateData.telegramStage ?? effectiveStage}` +
    ` | flow=${flowType} | score=${updateData.engagementScore} | intent=${updateData.intent ?? lead.intent}`
  )
}

// ── Academy reply handler ─────────────────────────────────────────────────────

/**
 * State machine for academy registrant replies — separate from lead intake.
 *
 *   connected  → first reply → asked_goal
 *   asked_goal → next reply  → goal_received
 *   anything else → no auto-response
 */
async function handleAcademyReply({ academy, chatId, text }) {
  const stage = academy.telegramStage ?? 'connected'

  let newStage = academy.telegramStage
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
    await sendTelegramToUser(chatId, autoResponse)
  }

  console.log(`[Telegram Webhook] Academy reply from reg ${academy.id} — stage=${newStage}`)
}

// ── Link helpers ──────────────────────────────────────────────────────────────

/**
 * Links a Telegram user to a Lead record.
 * Sets telegramStage = "connected" and sends a neutral opening question
 * so the user's first reply can be classified as routine or concern intent.
 */
async function linkLead({ leadId, chatId, username }) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })

  if (!lead) {
    await sendTelegramToUser(chatId, "Sorry, we couldn\u2019t find your registration. Please contact us directly.")
    return
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      telegramChatId: chatId,
      telegramUsername: username,
      telegramStarted: true,
      telegramConnectedAt: new Date(),
      telegramStage: 'connected',
    },
  })

  const firstName = lead.fullName.split(' ')[0]

  await sendTelegramToUser(
    chatId,
    `Hi ${firstName}! \ud83c\udf3f You\u2019re now connected to <b>MICAHSKIN</b>.\n\n` +
    `We\u2019re gathering a few details so our team can guide you properly.\n\n` +
    `<b>What brings you here today \u2014 are you looking for a skincare routine, or is there a specific skin concern you\u2019d like help with?</b>`
  )

  await sendTelegramMessage(
    `\u2705 <b>Lead connected Telegram</b>\n\n` +
    `<b>Name:</b> ${lead.fullName}\n` +
    `<b>Telegram:</b> ${username ? `@${username}` : chatId}\n` +
    `<b>Chat ID:</b> ${chatId}\n` +
    `<b>Lead ID:</b> ${leadId}\n` +
    `<b>Platform:</b> ${lead.sourcePlatform}` + (lead.sourceType ? ` \u00b7 ${lead.sourceType}` : '') + `\n` +
    (lead.skinConcern ? `<b>Concern:</b> ${lead.skinConcern.replace(/_/g, ' ')}` : '')
  )

  console.log(`[Telegram Webhook] Lead ${leadId} linked to chatId=${chatId}`)
}

/**
 * Links a Telegram user to an AcademyRegistration record and sends a confirmation message.
 */
async function linkAcademy({ registrationId, chatId, username }) {
  const registration = await prisma.academyRegistration.findUnique({ where: { id: registrationId } })

  if (!registration) {
    await sendTelegramToUser(chatId, "Sorry, we couldn\u2019t find your academy registration. Please contact us directly.")
    return
  }

  await prisma.academyRegistration.update({
    where: { id: registrationId },
    data: {
      telegramChatId: chatId,
      telegramUsername: username,
      telegramStarted: true,
      telegramStage: 'connected',
    },
  })

  const firstName = registration.fullName.split(' ')[0]

  await sendTelegramToUser(
    chatId,
    `Hi ${firstName}! \ud83c\udf93 You\u2019re now connected to <b>MICAHSKIN Academy</b> on Telegram.\n\n` +
    `Welcome \u2014 your academy access is confirmed. Here\u2019s what\u2019s coming your way:\n\n` +
    `\u2705 Masterclass modules and training content\n` +
    `\u2705 Step-by-step guidance to build your skincare brand\n` +
    `\u2705 Direct support from the MICAHSKIN team\n\n` +
    `We\u2019re excited to have you \u2014 stay tuned for your first module! Feel free to reply with any questions \ud83c\udf93`
  )

  await sendTelegramMessage(
    `\u2705 <b>Academy registrant connected Telegram</b>\n\n` +
    `<b>Name:</b> ${registration.fullName}\n` +
    `<b>Email:</b> ${registration.email}\n` +
    `<b>Telegram:</b> ${username ? `@${username}` : chatId}\n` +
    `<b>Chat ID:</b> ${chatId}\n` +
    `<b>Registration ID:</b> ${registrationId}\n` +
    `<b>Platform:</b> ${registration.sourcePlatform}` + (registration.sourceType ? ` \u00b7 ${registration.sourceType}` : '')
  )

  console.log(`[Telegram Webhook] Academy registration ${registrationId} linked to chatId=${chatId}`)
}

module.exports = { handleWebhook }
