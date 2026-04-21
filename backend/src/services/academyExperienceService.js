'use strict'

/**
 * academyExperienceService.js — Phase 24: Academy Experience Layer
 *
 * Delivers a structured lesson programme to enrolled academy members
 * through the single shared Telegram bot.
 *
 * State machine:
 *   null → lesson_active (Lesson 1 sent)
 *   lesson_active → lesson_unlocked (user replies → lesson complete)
 *   lesson_unlocked → lesson_active (next lesson sent by poller)
 *   lesson_active → stuck (48h without reply → nudge sent)
 *   stuck → lesson_active (user replies to nudge)
 *   lesson_unlocked (after final lesson) → graduated
 *
 * Public API:
 *   handleAcademyMemberReply(registration, chatId, text) — main Telegram entry point
 *   checkLessonUnlocks()   — background poller: send next lesson when unlock time reached
 *   checkStuckMembers()    — background poller: nudge inactive members
 *   startAcademyExperience — boot pollers
 */

const prisma = require('../lib/prisma')
const { sendAcademyToUser: sendTelegramToUser } = require('./telegramService')
const { syncAcademyEvent } = require('./academySyncService')
const { LESSONS, TOTAL_LESSONS } = require('./academyLessons')

const STUCK_THRESHOLD_HOURS = 48

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Main Telegram message router for enrolled academy members.
 * Called from telegramController.handleAcademyReply for enrolled non-premium members.
 *
 * @param {object} registration   Full AcademyRegistration record
 * @param {string} chatId         Telegram chat_id string
 * @param {string} text           Incoming message text
 */
async function handleAcademyMemberReply(registration, chatId, text) {
  const reg = registration
  const firstName = reg.fullName.split(' ')[0]

  // Track last inbound message time for operator debug panel
  prisma.academyRegistration.update({
    where: { id: reg.id },
    data: { lastInboundAt: new Date() },
  }).catch(() => {})

  // ── Paused: suppress all automatic progression ──────────────────────────────
  if (reg.academyPaused) {
    await sendTelegramToUser(chatId,
      `Your academy journey is temporarily on hold. The team will be in touch shortly. 🌿`
    )
    return
  }

  // ── Not yet started: send Lesson 1 ─────────────────────────────────────────
  if (!reg.academyLessonStatus || reg.currentLesson === 0) {
    await _sendLesson(reg, chatId, 1)
    return
  }

  // ── Graduated: send closure message ────────────────────────────────────────
  if (reg.academyLessonStatus === 'graduated') {
    await sendTelegramToUser(chatId,
      `🎓 You've completed the MICAHSKIN Academy, ${firstName}!\n\n` +
      `You've been through all 5 lessons — your journey doesn't stop here.\n` +
      `Reach out to the team anytime for support as you build. 🌿`
    )
    return
  }

  // ── Stuck: user replying → unblock and continue ────────────────────────────
  if (reg.academyLessonStatus === 'stuck') {
    await prisma.academyRegistration.update({
      where: { id: reg.id },
      data: { academyLessonStatus: 'lesson_active' },
    })
    // Continue into the 'lesson_active' block below with fresh reg
    reg.academyLessonStatus = 'lesson_active'
  }

  // ── Active lesson: this reply = lesson completion ───────────────────────────
  if (reg.academyLessonStatus === 'lesson_active') {
    const lessonMeta = LESSONS.find(l => l.number === reg.currentLesson)
    if (!lessonMeta) return

    await _markLessonComplete(reg, chatId, reg.currentLesson)
    return
  }

  // ── Between lessons (waiting for unlock) ────────────────────────────────────
  if (reg.academyLessonStatus === 'lesson_unlocked') {
    const nextLesson = reg.currentLesson + 1
    if (nextLesson > TOTAL_LESSONS) {
      // Shouldn't normally reach here, but guard it
      await _handleGraduation(reg, chatId)
      return
    }

    const unlockAt = reg.nextLessonUnlockAt
    const now      = new Date()
    if (unlockAt && unlockAt > now) {
      const hoursLeft = Math.ceil((unlockAt - now) / (1000 * 60 * 60))
      await sendTelegramToUser(chatId,
        `⏳ Lesson ${nextLesson} unlocks in about ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}.\n\n` +
        `Sit tight — it'll arrive here automatically. In the meantime, work on your action step from the last lesson. 💪`
      )
    } else {
      // Unlock time has passed but poller hasn't fired yet → send now
      await _sendLesson(reg, chatId, nextLesson)
    }
  }
}

// ── Lesson delivery ───────────────────────────────────────────────────────────

async function _sendLesson(registration, chatId, lessonNumber) {
  const lesson    = LESSONS.find(l => l.number === lessonNumber)
  if (!lesson) return

  const firstName = registration.fullName.split(' ')[0]
  const now       = new Date()

  await prisma.academyRegistration.update({
    where: { id: registration.id },
    data: {
      academyLessonStatus: 'lesson_active',
      currentLesson:       lessonNumber,
      lastLessonSentAt:    now,
      nextLessonUnlockAt:  null,
    },
  })

  await sendTelegramToUser(chatId, lesson.message(firstName))

  console.log(`[AcademyExperience] lesson ${lessonNumber} sent → ${registration.id}`)

  // Sync event to Lead CRM
  _syncToCRM(registration, 'lesson_started', String(lessonNumber)).catch(() => {})
}

// ── Lesson completion ─────────────────────────────────────────────────────────

async function _markLessonComplete(registration, chatId, lessonNumber) {
  const lesson     = LESSONS.find(l => l.number === lessonNumber)
  if (!lesson) return

  const firstName  = registration.fullName.split(' ')[0]
  const now        = new Date()
  const isLastLesson = lessonNumber >= TOTAL_LESSONS

  const nextLessonNumber = lessonNumber + 1
  const nextUnlockAt     = isLastLesson
    ? null
    : new Date(now.getTime() + LESSONS.find(l => l.number === nextLessonNumber).unlockDelayHours * 60 * 60 * 1000)

  await prisma.academyRegistration.update({
    where: { id: registration.id },
    data: {
      academyLessonStatus:   isLastLesson ? 'lesson_unlocked' : 'lesson_unlocked',
      lessonsCompleted:      { increment: 1 },
      lastLessonCompletedAt: now,
      nextLessonUnlockAt:    nextUnlockAt,
    },
  })

  // Sync event to Lead CRM
  _syncToCRM(registration, 'lesson_completed', String(lessonNumber)).catch(() => {})

  // Acknowledge completion
  await sendTelegramToUser(chatId,
    `✅ <b>Lesson ${lessonNumber} complete!</b>\n\n` +
    `Great work, ${firstName}. 🌿`
  )

  // Send CTA if this lesson has one
  if (lesson.ctaAfter) {
    await _sendLessonCta(registration, chatId, lesson.ctaAfter)
  }

  if (isLastLesson) {
    await _handleGraduation(registration, chatId)
    return
  }

  // Tell the user when the next lesson arrives
  const nextLesson = LESSONS.find(l => l.number === nextLessonNumber)
  if (nextUnlockAt && nextLesson.unlockDelayHours > 0) {
    await sendTelegramToUser(chatId,
      `📅 <b>Lesson ${nextLessonNumber}: ${nextLesson.title}</b> will arrive in your chat in ${nextLesson.unlockDelayHours} hour${nextLesson.unlockDelayHours === 1 ? '' : 's'}.\n\n` +
      `In the meantime, complete your action step from this lesson. See you soon! 💪`
    )
  } else {
    // Immediate unlock
    const freshReg = await prisma.academyRegistration.findUnique({ where: { id: registration.id } })
    await _sendLesson(freshReg, chatId, nextLessonNumber)
  }
}

// ── CTA injection ─────────────────────────────────────────────────────────────

async function _sendLessonCta(registration, chatId, ctaType) {
  const firstName = registration.fullName.split(' ')[0]

  if (ctaType === 'product_offer') {
    await sendTelegramToUser(chatId,
      `🛍️ <b>Quick recommendation, ${firstName}</b>\n\n` +
      `As you build your product line, you should experience great skincare yourself — it shapes your formulation intuition.\n\n` +
      `The MICAHSKIN skincare range was built on the same principles you're learning.\n\n` +
      `If you'd like to explore the products: https://micahskin.com/shop\n\n` +
      `No pressure — just useful context for a future brand builder. 🌿`
    )
    await prisma.academyRegistration.update({
      where: { id: registration.id },
      data: { lessonCtaStatus: 'product_offered' },
    })
  }

  if (ctaType === 'consult_offer') {
    await sendTelegramToUser(chatId,
      `📞 <b>Optional: Brand Strategy Session</b>\n\n` +
      `${firstName}, you're at the stage where a 30-minute session with our team can save you months of guesswork.\n\n` +
      `We can review your brand concept, packaging direction, and go-to-market approach — and give you specific feedback.\n\n` +
      `Reply <b>STRATEGY</b> if you'd like to book a slot.`
    )
    await prisma.academyRegistration.update({
      where: { id: registration.id },
      data: { lessonCtaStatus: 'consult_offered' },
    })
    _syncToCRM(registration, 'cta_clicked', 'consult').catch(() => {})
  }

  if (ctaType === 'graduate_offer') {
    await sendTelegramToUser(chatId,
      `🌟 <b>You've earned this, ${firstName}</b>\n\n` +
      `Completing all 5 lessons puts you ahead of 90% of aspiring brand founders.\n\n` +
      `If you're serious about launching — our <b>Premium Implementation Track</b> gives you hands-on support:\n` +
      `→ System setup\n` +
      `→ Formulation partner introduction\n` +
      `→ Launch strategy call\n` +
      `→ Accountability for 30 days\n\n` +
      `Reply <b>PREMIUM</b> if you want details.`
    )
    await prisma.academyRegistration.update({
      where: { id: registration.id },
      data: { lessonCtaStatus: 'graduate_offered' },
    })
    _syncToCRM(registration, 'cta_clicked', 'graduation').catch(() => {})
  }
}

// ── Graduation ────────────────────────────────────────────────────────────────

async function _handleGraduation(registration, chatId) {
  const firstName = registration.fullName.split(' ')[0]
  const now       = new Date()

  await prisma.academyRegistration.update({
    where: { id: registration.id },
    data: {
      academyLessonStatus: 'graduated',
      academyStatus:        'graduated',
      academyCompletionAt:  now,
    },
  })

  await sendTelegramToUser(chatId,
    `🎓 <b>Congratulations, ${firstName} — you've graduated from MICAHSKIN Academy!</b>\n\n` +
    `You've completed all 5 lessons. That takes commitment — and commitment is what separates brand builders from people who just talk about it.\n\n` +
    `<b>What you've covered:</b>\n` +
    `✅ Brand vision & your why\n` +
    `✅ Skin science & hero product selection\n` +
    `✅ Formulation & sourcing\n` +
    `✅ Brand identity & packaging\n` +
    `✅ Sales, launches & growth\n\n` +
    `Your journey doesn't end here — it starts here. 🌿\n\n` +
    `The MICAHSKIN team is here when you're ready to take the next step.`
  )

  // Sync graduation to CRM Lead
  _syncToCRM(registration, 'lesson_completed', 'graduation').catch(() => {})

  console.log(`[AcademyExperience] graduation → ${registration.id} (${registration.fullName})`)
}

// ── Background pollers ────────────────────────────────────────────────────────

/**
 * Checks for members whose next lesson has unlocked and delivers it.
 * Runs every 5 minutes.
 */
async function checkLessonUnlocks() {
  const now = new Date()
  try {
    const ready = await prisma.academyRegistration.findMany({
      where: {
        academyLessonStatus: 'lesson_unlocked',
        nextLessonUnlockAt:  { lte: now },
        telegramChatId:      { not: null },
        academyPaused:       { not: true },
      },
    })

    for (const reg of ready) {
      const nextLesson = reg.currentLesson + 1
      if (nextLesson > TOTAL_LESSONS) {
        await _handleGraduation(reg, reg.telegramChatId)
        continue
      }
      await _sendLesson(reg, reg.telegramChatId, nextLesson)
    }

    if (ready.length > 0) {
      console.log(`[AcademyExperience] lesson unlocks delivered: ${ready.length}`)
    }
  } catch (err) {
    console.error('[AcademyExperience] checkLessonUnlocks error:', err.message)
  }
}

/**
 * Finds members who are in an active lesson but haven't replied in 48+ hours.
 * Sends a nudge and marks them as stuck.
 * Runs every hour.
 */
async function checkStuckMembers() {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_HOURS * 60 * 60 * 1000)
  try {
    const stuck = await prisma.academyRegistration.findMany({
      where: {
        academyLessonStatus: 'lesson_active',
        lastLessonSentAt:    { lte: cutoff },
        telegramChatId:      { not: null },
        academyPaused:       { not: true },
      },
    })

    for (const reg of stuck) {
      const firstName = reg.fullName.split(' ')[0]
      await prisma.academyRegistration.update({
        where: { id: reg.id },
        data: { academyLessonStatus: 'stuck' },
      })

      await sendTelegramToUser(reg.telegramChatId,
        `👋 Hey ${firstName} — just checking in.\n\n` +
        `Your Lesson ${reg.currentLesson} is still waiting for you. It only takes a few minutes.\n\n` +
        `Reply anything to continue where you left off. 🌿`
      ).catch(() => {})

      _syncToCRM(reg, 'inactive').catch(() => {})

      console.log(`[AcademyExperience] stuck nudge sent → ${reg.id}`)
    }
  } catch (err) {
    console.error('[AcademyExperience] checkStuckMembers error:', err.message)
  }
}

// ── CRM sync helper ───────────────────────────────────────────────────────────

async function _syncToCRM(registration, event_type, lesson_id) {
  if (!registration.telegramChatId) return
  try {
    await syncAcademyEvent({
      telegram_id: registration.telegramChatId,
      event_type,
      lesson_id,
      phone: registration.phone || undefined,
    })
  } catch (err) {
    // Non-critical — Lead might not exist in the CRM
    if (err.status !== 404) {
      console.error(`[AcademyExperience] CRM sync error (${event_type}):`, err.message)
    }
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

function startAcademyExperience() {
  console.log('✅ Academy Experience Service started (lesson unlocks every 5m, stuck check every 60m)')
  checkLessonUnlocks()
  checkStuckMembers()
  setInterval(checkLessonUnlocks, 5 * 60 * 1000)
  setInterval(checkStuckMembers,  60 * 60 * 1000)
}

module.exports = {
  handleAcademyMemberReply,
  checkLessonUnlocks,
  checkStuckMembers,
  startAcademyExperience,
}
