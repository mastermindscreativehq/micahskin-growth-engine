'use strict'

const prisma = require('../lib/prisma')
const { diagnoseLead } = require('./diagnosisEngineService')

const DIAGNOSIS_DELAY_MINUTES = parseInt(process.env.DIAGNOSIS_DELAY_MINUTES || '10', 10)

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

  console.log(`[Intake] userId=${userId} stage=${session.stage} completed=${session.completed} text="${text.slice(0, 60)}"`)

  if (session.completed) {
    console.log(`[Intake] session completed — silent | userId=${userId}`)
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
      console.log(`[Intake] ASK_GOAL answered | userId=${userId} goal="${text.slice(0, 40)}"`)
      return 'How would you describe your skin type? (oily, dry, combination, sensitive)'

    case 'ASK_SKIN_TYPE':
      await updateSession(session, {
        stage: 'ASK_PRODUCTS',
        data: { skinType: text },
      })
      console.log(`[Intake] ASK_SKIN_TYPE answered | userId=${userId} skinType="${text.slice(0, 30)}"`)
      return 'What products are you currently using?'

    case 'ASK_PRODUCTS':
      await updateSession(session, {
        stage: 'ASK_SENSITIVITY',
        data: { products: text },
      })
      console.log(`[Intake] ASK_PRODUCTS answered | userId=${userId}`)
      return 'Does your skin react easily to products? (yes/no)'

    case 'ASK_SENSITIVITY':
      await updateSession(session, {
        stage: 'ASK_BUDGET',
        data: { sensitivity: text },
      })
      console.log(`[Intake] ASK_SENSITIVITY answered | userId=${userId}`)
      return 'Are you looking for a budget, mid-range, or premium routine?'

    case 'ASK_BUDGET':
      await updateSession(session, {
        stage: 'ASK_ROUTINE_LEVEL',
        data: { budget: text },
      })
      console.log(`[Intake] ASK_BUDGET answered | userId=${userId}`)
      return 'Do you want a simple, balanced, or complete routine?'

    case 'ASK_ROUTINE_LEVEL': {
      // Capture last answer before advancing to image upload stage
      const collectedData = {
        ...(session.data && typeof session.data === 'object' ? session.data : {}),
        routine: text,
      }

      // Advance to ASK_IMAGE — do NOT mark completed yet
      await updateSession(session, {
        stage: 'ASK_IMAGE',
        completed: false,
        data: { routine: text },
      })

      const skinConcern = deriveSkinConcern(collectedData.goal)

      const existingLead = await prisma.lead.findFirst({
        where: { telegramChatId: userId },
        orderBy: { createdAt: 'desc' },
      })

      const now = new Date()
      const diagnosisSendAfter   = new Date(now.getTime() + DIAGNOSIS_DELAY_MINUTES * 60 * 1000)
      const checkInSendAfter     = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      const productRecoSendAfter = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

      let leadId

      if (existingLead) {
        await prisma.lead.update({
          where: { id: existingLead.id },
          data: {
            telegramStage:        'awaiting_images',
            telegramFlowType:     'routine',
            telegramLastMessage:  text,
            telegramLastMessageAt: now,
            skinConcern: skinConcern !== 'general' ? skinConcern : existingLead.skinConcern,
            status: ['new', 'contacted', 'engaged'].includes(existingLead.status)
              ? 'interested'
              : existingLead.status,
            telegramRoutineGoal:  collectedData.goal        || null,
            telegramSkinType:     collectedData.skinType    || null,
            telegramProductsUsed: collectedData.products    || null,
            telegramSensitivity:  collectedData.sensitivity || null,
            telegramBudget:       collectedData.budget      || null,
            telegramRoutineLevel: collectedData.routine     || null,
            diagnosisStatus:      'pending',
            imageUploadStatus:    'pending',
            imageUploadCount:     0,
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
            fullName:            userId,
            sourcePlatform:      'Telegram',
            skinConcern,
            message:             `Telegram intake: ${collectedData.goal || 'not specified'}`,
            telegramChatId:      userId,
            telegramStarted:     true,
            telegramConnectedAt: now,
            telegramStage:       'awaiting_images',
            telegramFlowType:    'routine',
            status:              'interested',
            telegramRoutineGoal:  collectedData.goal        || null,
            telegramSkinType:     collectedData.skinType    || null,
            telegramProductsUsed: collectedData.products    || null,
            telegramSensitivity:  collectedData.sensitivity || null,
            telegramBudget:       collectedData.budget      || null,
            telegramRoutineLevel: collectedData.routine     || null,
            diagnosisStatus:      'pending',
            imageUploadStatus:    'pending',
            imageUploadCount:     0,
            diagnosisSendAfter,
            checkInSendAfter,
            productRecoSendAfter,
          },
        })
        leadId = newLead.id
      }

      console.log(
        `[Intake] questions complete, awaiting images | ` +
        `userId=${userId} leadId=${leadId} ` +
        `concern=${skinConcern} skinType=${collectedData.skinType || 'none'} ` +
        `budget=${collectedData.budget || 'none'} ` +
        `diagnosisDueAt=${diagnosisSendAfter.toISOString()} (${DIAGNOSIS_DELAY_MINUTES}min delay)`
      )

      return (
        'Optional: You can upload up to 5 clear skin photos so our skincare team can better understand your concern.\n\n' +
        'Send the photos now, or type <b>SKIP</b> to continue without photos.'
      )
    }

    case 'ASK_IMAGE': {
      // Only text messages reach here — photo uploads are handled in the controller.
      // Accept SKIP to complete the image stage without photos.
      if (text.trim().toUpperCase() === 'SKIP') {
        await updateSession(session, { stage: 'DONE', completed: true, data: {} })

        // Find the lead to determine current image state
        const lead = await prisma.lead.findFirst({
          where: { telegramChatId: userId },
          orderBy: { createdAt: 'desc' },
        })

        if (lead) {
          const hasPhotos = (lead.imageUploadStatus === 'uploaded') && (lead.imageUploadCount || 0) > 0

          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              telegramStage:     'intake_complete',
              telegramLastMessage:   text,
              telegramLastMessageAt: new Date(),
              // If photos were already uploaded before SKIP, keep 'uploaded'; otherwise mark skipped
              imageUploadStatus:  hasPhotos ? 'uploaded' : 'skipped',
              imageReviewStatus:  hasPhotos ? 'pending'  : 'not_required',
            },
          })

          console.log(`[ImageUpload] skipped | leadId=${lead.id} photosBeforeSkip=${lead.imageUploadCount || 0}`)
          console.log(`[Diagnosis] waiting_for_image_review | leadId=${lead.id}`)

          // Build diagnosis data now — Action Engine sends it after the delay
          setImmediate(() => {
            diagnoseLead(lead.id).catch(err =>
              console.error(`[Intake] diagnosis build failed for lead ${lead.id}:`, err.message)
            )
          })
        }

        return 'Thank you. Our skincare team will review your details and prepare your skin assessment shortly 🌿'
      }

      // Any non-SKIP text during image stage — remind them what to do
      return 'Please send your skin photos, or type <b>SKIP</b> to continue without photos.'
    }

    default:
      console.warn(`[TelegramSession] userId=${userId} — unknown stage: ${session.stage}`)
      return null
  }
}

module.exports = { getOrCreateSession, updateSession, handleTelegramMessage }
