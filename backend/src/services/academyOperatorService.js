'use strict'

/**
 * academyOperatorService.js — Phase 25: Academy Operator Control Layer
 *
 * Safe manual overrides for enrolled academy members.
 * All actions are protected by admin auth (enforced in the route layer).
 *
 * Exported actions:
 *   resendCurrentLesson(id)   — resend lesson text; never increments completion counter
 *   unlockNextLesson(id)      — bypass timer, deliver next lesson now
 *   pauseProgression(id)      — set academyPaused=true; pollers skip this member
 *   resumeProgression(id)     — clear pause; normal automation resumes
 *   markLessonComplete(id)    — operator marks current lesson done; sets next unlock timer
 *   graduateMember(id)        — force graduation regardless of lesson progress
 *   revokeAccess(id)          — block bot routing + clear Lead.academyAccess
 */

const prisma = require('../lib/prisma')
const { sendTelegramToUser } = require('./telegramService')
const { syncAcademyEvent } = require('./academySyncService')
const { LESSONS, TOTAL_LESSONS } = require('./academyLessons')

function _firstName(reg) {
  return reg.fullName.split(' ')[0]
}

async function _logMessageLog(registrationId, action, note) {
  try {
    await prisma.messageLog.create({
      data: {
        channel: 'admin_operator',
        status: 'sent',
        recordId: registrationId,
        type: `academy_${action}`,
        auto: false,
        triggerReason: note,
        recipient: registrationId,
      },
    })
  } catch {
    // Non-critical
  }
}

async function _syncCRM(registration, event_type, lesson_id) {
  if (!registration.telegramChatId) return
  try {
    await syncAcademyEvent({
      telegram_id: registration.telegramChatId,
      event_type,
      lesson_id,
      phone: registration.phone || undefined,
    })
  } catch (err) {
    if (err.status !== 404) {
      console.error(`[AcademyOperator] CRM sync error (${event_type}):`, err.message)
    }
  }
}

function _err(msg, status = 400) {
  return Object.assign(new Error(msg), { status })
}

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * Resend the current lesson without advancing state or incrementing counters.
 * Safe to call multiple times.
 */
async function resendCurrentLesson(registrationId) {
  const reg = await prisma.academyRegistration.findUnique({ where: { id: registrationId } })
  if (!reg) throw _err('Registration not found', 404)
  if (!reg.telegramChatId) throw _err('No Telegram chat connected')
  if (!reg.currentLesson || reg.currentLesson === 0) throw _err('No active lesson to resend')

  const lesson = LESSONS.find(l => l.number === reg.currentLesson)
  if (!lesson) throw _err('Lesson data not found')

  const firstName = _firstName(reg)

  await prisma.academyRegistration.update({
    where: { id: registrationId },
    data: {
      academyLessonStatus: 'lesson_active',
      lastLessonSentAt: new Date(),
    },
  })

  await sendTelegramToUser(reg.telegramChatId, lesson.message(firstName))

  const note = `Lesson ${reg.currentLesson} resent by operator`
  await _logMessageLog(registrationId, 'resend_lesson', note)
  console.log(`[AcademyOperator] ${note} → ${registrationId}`)

  return prisma.academyRegistration.findUnique({ where: { id: registrationId } })
}

/**
 * Bypass the unlock timer and deliver the next lesson immediately.
 * If currently lesson_active, completes the current lesson first (without CTA sends).
 * If currently lesson_unlocked, sends the next lesson right away.
 */
async function unlockNextLesson(registrationId) {
  const reg = await prisma.academyRegistration.findUnique({ where: { id: registrationId } })
  if (!reg) throw _err('Registration not found', 404)
  if (!reg.telegramChatId) throw _err('No Telegram chat connected')
  if (reg.academyLessonStatus === 'graduated') throw _err('Member has already graduated')

  const currentLesson = reg.currentLesson || 0
  const nextLessonNumber = currentLesson + 1

  if (nextLessonNumber > TOTAL_LESSONS) {
    throw _err('No next lesson available — use "Graduate" action instead')
  }

  const now = new Date()

  // If mid-lesson, close it out first without CTA or timer notification
  if (reg.academyLessonStatus === 'lesson_active' && currentLesson > 0) {
    await prisma.academyRegistration.update({
      where: { id: registrationId },
      data: {
        lessonsCompleted: { increment: 1 },
        lastLessonCompletedAt: now,
        academyLessonStatus: 'lesson_unlocked',
        nextLessonUnlockAt: null,
      },
    })
    _syncCRM(reg, 'lesson_completed', String(currentLesson)).catch(() => {})
  }

  const lesson = LESSONS.find(l => l.number === nextLessonNumber)
  if (!lesson) throw _err('Next lesson data not found')

  const firstName = _firstName(reg)

  await prisma.academyRegistration.update({
    where: { id: registrationId },
    data: {
      academyLessonStatus: 'lesson_active',
      currentLesson: nextLessonNumber,
      lastLessonSentAt: now,
      nextLessonUnlockAt: null,
    },
  })

  await sendTelegramToUser(reg.telegramChatId, lesson.message(firstName))

  _syncCRM(reg, 'lesson_started', String(nextLessonNumber)).catch(() => {})

  const note = `Lesson ${nextLessonNumber} unlocked early by operator`
  await _logMessageLog(registrationId, 'unlock_next_lesson', note)
  console.log(`[AcademyOperator] ${note} → ${registrationId}`)

  return prisma.academyRegistration.findUnique({ where: { id: registrationId } })
}

/**
 * Pause automatic progression. Background pollers will skip this member
 * until resumeProgression is called.
 */
async function pauseProgression(registrationId) {
  const reg = await prisma.academyRegistration.findUnique({ where: { id: registrationId } })
  if (!reg) throw _err('Registration not found', 404)
  if (reg.academyPaused) throw _err('Progression is already paused')

  const updated = await prisma.academyRegistration.update({
    where: { id: registrationId },
    data: { academyPaused: true },
  })

  await _logMessageLog(registrationId, 'pause', 'Academy progression paused by operator')
  console.log(`[AcademyOperator] progression paused → ${registrationId}`)

  return updated
}

/**
 * Resume automatic progression after a pause.
 */
async function resumeProgression(registrationId) {
  const reg = await prisma.academyRegistration.findUnique({ where: { id: registrationId } })
  if (!reg) throw _err('Registration not found', 404)
  if (!reg.academyPaused) throw _err('Progression is not paused')

  const updated = await prisma.academyRegistration.update({
    where: { id: registrationId },
    data: { academyPaused: false },
  })

  await _logMessageLog(registrationId, 'resume', 'Academy progression resumed by operator')
  console.log(`[AcademyOperator] progression resumed → ${registrationId}`)

  return updated
}

/**
 * Mark the current active lesson complete as an operator override.
 * Sends an acknowledgement to the member and sets up the next unlock timer.
 * Does not send CTAs — those fire on the normal reply path.
 */
async function markLessonComplete(registrationId) {
  const reg = await prisma.academyRegistration.findUnique({ where: { id: registrationId } })
  if (!reg) throw _err('Registration not found', 404)
  if (!reg.telegramChatId) throw _err('No Telegram chat connected')

  const currentLesson = reg.currentLesson || 0
  if (currentLesson === 0) throw _err('No active lesson')
  if (reg.academyLessonStatus !== 'lesson_active') {
    throw _err(`Lesson is not active (status: ${reg.academyLessonStatus || 'none'})`)
  }

  const now = new Date()
  const isLastLesson = currentLesson >= TOTAL_LESSONS
  const nextLessonNumber = currentLesson + 1
  const nextLesson = !isLastLesson ? LESSONS.find(l => l.number === nextLessonNumber) : null
  const nextUnlockAt = isLastLesson || !nextLesson
    ? null
    : new Date(now.getTime() + nextLesson.unlockDelayHours * 60 * 60 * 1000)

  await prisma.academyRegistration.update({
    where: { id: registrationId },
    data: {
      academyLessonStatus: 'lesson_unlocked',
      lessonsCompleted: { increment: 1 },
      lastLessonCompletedAt: now,
      nextLessonUnlockAt: nextUnlockAt,
    },
  })

  const firstName = _firstName(reg)
  const nextMsg = nextUnlockAt && nextLesson
    ? `\n\nLesson ${nextLessonNumber} will arrive in ${nextLesson.unlockDelayHours} hour${nextLesson.unlockDelayHours === 1 ? '' : 's'}.`
    : ''

  await sendTelegramToUser(reg.telegramChatId,
    `✅ <b>Lesson ${currentLesson} complete!</b>\n\n` +
    `Great work, ${firstName}. 🌿${nextMsg}`
  )

  _syncCRM(reg, 'lesson_completed', String(currentLesson)).catch(() => {})

  const note = `Lesson ${currentLesson} manually completed by operator`
  await _logMessageLog(registrationId, 'mark_lesson_complete', note)
  console.log(`[AcademyOperator] ${note} → ${registrationId}`)

  // Trigger graduation if this was the last lesson
  if (isLastLesson) {
    return _applyGraduation(registrationId, reg)
  }

  return prisma.academyRegistration.findUnique({ where: { id: registrationId } })
}

/**
 * Graduate a member immediately, regardless of current lesson progress.
 */
async function graduateMember(registrationId) {
  const reg = await prisma.academyRegistration.findUnique({ where: { id: registrationId } })
  if (!reg) throw _err('Registration not found', 404)
  if (reg.academyLessonStatus === 'graduated') throw _err('Member is already graduated')

  return _applyGraduation(registrationId, reg)
}

async function _applyGraduation(registrationId, reg) {
  const now = new Date()

  const updated = await prisma.academyRegistration.update({
    where: { id: registrationId },
    data: {
      academyLessonStatus: 'graduated',
      academyStatus: 'graduated',
      academyCompletionAt: reg.academyCompletionAt || now,
    },
  })

  if (reg.telegramChatId) {
    const firstName = _firstName(reg)
    await sendTelegramToUser(reg.telegramChatId,
      `🎓 <b>Congratulations, ${firstName} — you've graduated from MICAHSKIN Academy!</b>\n\n` +
      `Your academy team has marked your programme complete.\n\n` +
      `<b>What you've covered:</b>\n` +
      `✅ Brand vision & your why\n` +
      `✅ Skin science & hero product selection\n` +
      `✅ Formulation & sourcing\n` +
      `✅ Brand identity & packaging\n` +
      `✅ Sales, launches & growth\n\n` +
      `Your journey doesn't end here — it starts here. 🌿\n\n` +
      `The MICAHSKIN team is here when you're ready to take the next step.`
    ).catch(() => {})

    _syncCRM(reg, 'lesson_completed', 'graduation').catch(() => {})
  }

  await _logMessageLog(registrationId, 'graduate', `Member graduated by operator`)
  console.log(`[AcademyOperator] graduation → ${registrationId} (${reg.fullName})`)

  return updated
}

/**
 * Revoke academy access. Immediately blocks bot routing and clears the Lead
 * academyAccess flag on any linked Lead record.
 */
async function revokeAccess(registrationId) {
  const reg = await prisma.academyRegistration.findUnique({ where: { id: registrationId } })
  if (!reg) throw _err('Registration not found', 404)
  if (reg.academyStatus === 'revoked') throw _err('Access is already revoked')

  const updated = await prisma.academyRegistration.update({
    where: { id: registrationId },
    data: {
      academyStatus: 'revoked',
      academyLessonStatus: 'revoked',
    },
  })

  // Clear academyAccess on any linked Lead (matched by telegramChatId or phone)
  if (reg.telegramChatId || reg.phone) {
    const where = reg.telegramChatId
      ? { telegramChatId: reg.telegramChatId }
      : { phone: reg.phone }
    await prisma.lead.updateMany({ where, data: { academyAccess: false } }).catch((e) => {
      console.error('[AcademyOperator] lead unlink error:', e.message)
    })
  }

  await _logMessageLog(registrationId, 'revoke', 'Academy access revoked by operator')
  console.log(`[AcademyOperator] access revoked → ${registrationId} (${reg.fullName})`)

  return updated
}

module.exports = {
  resendCurrentLesson,
  unlockNextLesson,
  pauseProgression,
  resumeProgression,
  markLessonComplete,
  graduateMember,
  revokeAccess,
}
