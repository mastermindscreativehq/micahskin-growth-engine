const prisma = require('../lib/prisma')
const { diagnoseLead } = require('./diagnosisEngineService')

// ── Session helpers ───────────────────────────────────────────────────────────

async function getOrCreateSession(userId) {
  return prisma.telegramSession.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      stage: 'ASK_GOAL',
      data: {},
      completed: false,
    },
  })
}

async function updateSession(session, updates) {
  const mergedData =
    session.data && typeof session.data === 'object' && !Array.isArray(session.data)
      ? { ...session.data, ...(updates.data || {}) }
      : { ...(updates.data || {}) }

  return prisma.telegramSession.update({
    where: { userId: session.userId },
    data: {
      stage: updates.stage || session.stage,
      data: mergedData,
      completed: updates.completed ?? session.completed,
    },
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveSkinConcern(goalText) {
  const t = (goalText || '').toLowerCase()
  if (/acne|pimple|breakout|blemish/.test(t)) return 'acne'
  if (/dark spot|pigment|hyperpigment|discolou?r/.test(t)) return 'hyperpigmentation'
  if (/stretch/.test(t)) return 'stretch_marks'
  if (/dry|hydrat|flak/.test(t)) return 'dry_skin'
  if (/sensitiv|react|irritat/.test(t)) return 'sensitive_skin'
  if (/body|back|chest|arm/.test(t)) return 'body_care'
  return 'general'
}

// ── State machine ─────────────────────────────────────────────────────────────

/**
 * Core intake state machine keyed by Telegram userId (chat_id).
 *
 * Stages in order:
 *   ASK_GOAL → ASK_SKIN_TYPE → ASK_PRODUCTS → ASK_SENSITIVITY
 *   → ASK_BUDGET → ASK_ROUTINE_LEVEL → DONE
 *
 * Rules:
 *   - ONE user message → ONE bot reply
 *   - Stage always advances forward — never backward
 *   - Silent (null) once completed
 *   - /start resets session to ASK_GOAL
 *   - Existing linked Lead is updated on completion; new Lead created if none
 */
async function handleTelegramMessage(userId, text) {
  const session = await getOrCreateSession(userId)

  // 🔇 SILENT MODE — completed intake, bot does not respond
  if (session.completed) {
    return null
  }

  // Restart flow on /start
  if (text.toLowerCase() === '/start') {
    await prisma.telegramSession.update({
      where: { userId },
      data: { stage: 'ASK_GOAL', data: {}, completed: false },
    })
    return 'What skin concern would you like help with?'
  }

  switch (session.stage) {
    case 'ASK_GOAL':
      await updateSession(session, {
        stage: 'ASK_SKIN_TYPE',
        data: { goal: text },
      })
      return 'How would you describe your skin type? (oily, dry, combination, sensitive)'

    case 'ASK_SKIN_TYPE':
      await updateSession(session, {
        stage: 'ASK_PRODUCTS',
        data: { skinType: text },
      })
      return 'What products are you currently using?'

    case 'ASK_PRODUCTS':
      await updateSession(session, {
        stage: 'ASK_SENSITIVITY',
        data: { products: text },
      })
      return 'Does your skin react easily to products? (yes/no)'

    case 'ASK_SENSITIVITY':
      await updateSession(session, {
        stage: 'ASK_BUDGET',
        data: { sensitivity: text },
      })
      return 'Are you looking for a budget, mid-range, or premium routine?'

    case 'ASK_BUDGET':
      await updateSession(session, {
        stage: 'ASK_ROUTINE_LEVEL',
        data: { budget: text },
      })
      return 'Do you want a simple, balanced, or complete routine?'

    case 'ASK_ROUTINE_LEVEL': {
      // Capture last answer before marking complete
      const collectedData = {
        ...(session.data && typeof session.data === 'object' ? session.data : {}),
        routine: text,
      }

      await updateSession(session, {
        stage: 'DONE',
        completed: true,
        data: { routine: text },
      })

      const skinConcern = deriveSkinConcern(collectedData.goal)

      // Update existing linked Lead, or create a new CRM entry
      const existingLead = await prisma.lead.findFirst({
        where: { telegramChatId: userId },
      })

      const now = new Date()
      const diagnosisSendAfter   = new Date(now.getTime() + 1  * 60 * 60 * 1000)   // +1h
      const checkInSendAfter     = new Date(now.getTime() + 24 * 60 * 60 * 1000)   // +24h
      const productRecoSendAfter = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) // +3 days

      let leadId

      if (existingLead) {
        await prisma.lead.update({
          where: { id: existingLead.id },
          data: {
            telegramStage: 'intake_complete',
            telegramLastMessage: text,
            telegramLastMessageAt: now,
            skinConcern: skinConcern !== 'general' ? skinConcern : existingLead.skinConcern,
            status: ['new', 'contacted', 'engaged'].includes(existingLead.status)
              ? 'interested'
              : existingLead.status,
            telegramRoutineGoal: collectedData.goal || null,
            telegramSkinType: collectedData.skinType || null,
            telegramProductsUsed: collectedData.products || null,
            telegramSensitivity: collectedData.sensitivity || null,
            telegramBudget: collectedData.budget || null,
            telegramRoutineLevel: collectedData.routine || null,
            // Set follow-up timing only if not already scheduled
            ...(existingLead.diagnosisSendAfter ? {} : {
              diagnosisSendAfter,
              checkInSendAfter,
              productRecoSendAfter,
            }),
          },
        })
        leadId = existingLead.id
      } else {
        const newLead = await prisma.lead.create({
          data: {
            fullName: userId,
            sourcePlatform: 'Telegram',
            skinConcern,
            message: `Telegram intake: ${collectedData.goal || 'not specified'}`,
            telegramChatId: userId,
            telegramStarted: true,
            telegramConnectedAt: now,
            telegramStage: 'intake_complete',
            status: 'interested',
            telegramRoutineGoal: collectedData.goal || null,
            telegramSkinType: collectedData.skinType || null,
            telegramProductsUsed: collectedData.products || null,
            telegramSensitivity: collectedData.sensitivity || null,
            telegramBudget: collectedData.budget || null,
            telegramRoutineLevel: collectedData.routine || null,
            diagnosisSendAfter,
            checkInSendAfter,
            productRecoSendAfter,
          },
        })
        leadId = newLead.id
      }

      console.log(`[TelegramSession] userId=${userId} — intake complete | concern=${skinConcern} | lead=${leadId}`)

      // Run diagnosis asynchronously — do not block the bot response
      setImmediate(() => {
        diagnoseLead(leadId).catch((err) =>
          console.error(`[TelegramSession] Diagnosis failed for lead ${leadId}:`, err.message)
        )
      })

      return "Perfect \u2014 we\u2019ve received your details. We\u2019ll prepare a routine for you shortly \ud83c\udf3f"
    }

    default:
      console.warn(`[TelegramSession] userId=${userId} — unknown stage: ${session.stage}`)
      return null
  }
}

module.exports = { getOrCreateSession, updateSession, handleTelegramMessage }
