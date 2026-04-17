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
const { sendTelegramToUser } = require('./telegramService')
const { syncAcademyEvent } = require('./academySyncService')

// ── Lesson catalogue ──────────────────────────────────────────────────────────

const LESSONS = [
  {
    number: 1,
    title: 'Brand Vision & Your Why',
    unlockDelayHours: 0,
    ctaAfter: null,
    message: (firstName) =>
      `🌿 <b>Lesson 1 of 5 — Brand Vision & Your Why</b>\n\n` +
      `Welcome to your first lesson, ${firstName}.\n\n` +
      `Every great skincare brand starts with a clear <b>why</b>.\n\n` +
      `Before formulas, products, or packaging — you need clarity on three things:\n` +
      `→ <b>Who</b> are you building this for?\n` +
      `→ <b>What</b> specific skin problem are you solving?\n` +
      `→ <b>Why</b> are you the right person to solve it?\n\n` +
      `The most successful skincare brands are built around specific niches and personal stories. Not "for everyone". For <i>someone</i>.\n\n` +
      `🎯 <b>Your action step:</b>\n` +
      `Complete this sentence:\n` +
      `<i>"I'm building [Brand Name] for [Target Person] who struggles with [Skin Problem] because [My Why]."</i>\n\n` +
      `Write it down — we'll build your entire brand around this in the lessons ahead.\n\n` +
      `Reply with your answer or just <b>Done</b> when you're ready to continue. 👇`,
  },
  {
    number: 2,
    title: 'Understanding Skin & Your Hero Product',
    unlockDelayHours: 24,
    ctaAfter: 'product_offer',
    message: (firstName) =>
      `🔬 <b>Lesson 2 of 5 — Understanding Skin & Your Hero Product</b>\n\n` +
      `Good work on Lesson 1, ${firstName}.\n\n` +
      `Now let's talk skin science — not the complex textbook version, but what you <i>actually</i> need to know to create effective products.\n\n` +
      `<b>The 4 core skin concerns you should build around:</b>\n` +
      `1. Acne & breakouts (excess oil, bacteria, clogged pores)\n` +
      `2. Hyperpigmentation & dark spots (melanin overproduction)\n` +
      `3. Dryness & dehydration (barrier damage, lack of moisture)\n` +
      `4. Uneven texture & dullness (dead skin buildup, slow cell turnover)\n\n` +
      `<b>Why does this matter?</b>\n` +
      `Your hero product must target ONE of these clearly. Not all four. One.\n\n` +
      `This focus is what makes brands like The Ordinary, Naturium, and MICAHSKIN cut through the noise.\n\n` +
      `🎯 <b>Your action step:</b>\n` +
      `Pick one skin concern from the list above.\n` +
      `Then answer: "My hero product will help [Target Person] with [Problem] by [What it does]."\n\n` +
      `Reply with your answer when you're done. Lesson 3 will cover how to actually build that product. 👇`,
  },
  {
    number: 3,
    title: 'Product Development: Formulation & Sourcing',
    unlockDelayHours: 24,
    ctaAfter: null,
    message: (firstName) =>
      `⚗️ <b>Lesson 3 of 5 — Product Development: Formulation & Sourcing</b>\n\n` +
      `You have your niche and your hero product idea. Now, how do you actually build it?\n\n` +
      `<b>The 3 routes to formulation:</b>\n\n` +
      `<b>1. White-label (fastest, low cost)</b>\n` +
      `Work with a manufacturer who has existing formulas. You choose the base, add your branding. Great for starting fast.\n\n` +
      `<b>2. Custom formulation (most differentiated)</b>\n` +
      `Work with a cosmetic chemist or formulation lab to create a proprietary product. Higher cost, higher brand value.\n\n` +
      `<b>3. DIY formulation (most risky, not recommended)</b>\n` +
      `Only if you have chemistry training. Unformulated products can harm skin and create serious liability.\n\n` +
      `<b>Key sourcing principles:</b>\n` +
      `→ Always request Safety Data Sheets (SDS) and Certificates of Analysis (COA) from suppliers\n` +
      `→ Start with small batches (50–100 units) to test market response before scaling\n` +
      `→ NAFDAC registration is required in Nigeria before you can legally sell skincare\n\n` +
      `🎯 <b>Your action step:</b>\n` +
      `Research one formulation lab or white-label manufacturer in your region.\n` +
      `Write down their name, what they offer, and a contact point.\n\n` +
      `Reply when you've done it — Lesson 4 covers brand identity. 👇`,
  },
  {
    number: 4,
    title: 'Brand Identity & Packaging',
    unlockDelayHours: 24,
    ctaAfter: 'consult_offer',
    message: (firstName) =>
      `✨ <b>Lesson 4 of 5 — Brand Identity & Packaging</b>\n\n` +
      `${firstName}, this is where your brand comes to life.\n\n` +
      `Your brand identity is everything your customer sees, feels, and remembers before they even try the product.\n\n` +
      `<b>Your brand identity checklist:</b>\n` +
      `□ Brand name — memorable, easy to pronounce, available on IG/TikTok\n` +
      `□ Colour palette — 2–3 colours that reflect your brand personality\n` +
      `□ Typography — 1 headline font, 1 body font\n` +
      `□ Tone of voice — clinical? warm? empowering? playful?\n` +
      `□ Logo — simple, scalable, works on packaging AND phone screen\n\n` +
      `<b>Packaging principles:</b>\n` +
      `→ Packaging must match your price point (cheap packaging = low perceived value)\n` +
      `→ Airless pumps for serums, glass for premium, tubes for treatments\n` +
      `→ Your packaging IS your first impression on the shelf and in unboxing videos\n\n` +
      `<b>Common mistake to avoid:</b>\n` +
      `Don't spend months on branding before you've validated your product. Build a clean MVP brand that can evolve.\n\n` +
      `🎯 <b>Your action step:</b>\n` +
      `Write your brand name, your 3 brand colours (hex codes or descriptions), and your brand voice in 3 words.\n\n` +
      `Reply when done — your final lesson is next. 👇`,
  },
  {
    number: 5,
    title: 'Sales, Launches & Growing Your Brand',
    unlockDelayHours: 24,
    ctaAfter: 'graduate_offer',
    message: (firstName) =>
      `🚀 <b>Lesson 5 of 5 — Sales, Launches & Growing Your Brand</b>\n\n` +
      `${firstName}, this is the final lesson — and it's the most important.\n\n` +
      `A great product with no sales strategy goes nowhere. Let's fix that.\n\n` +
      `<b>The 3-phase launch framework:</b>\n\n` +
      `<b>Phase 1: Pre-launch (2–4 weeks before)</b>\n` +
      `→ Build social proof by sharing your product journey on IG/TikTok\n` +
      `→ Create a waitlist (Google Form or WhatsApp broadcast)\n` +
      `→ Reach out to 10 micro-influencers in your niche for gifted collaborations\n\n` +
      `<b>Phase 2: Launch week</b>\n` +
      `→ Email + WhatsApp blast to your waitlist\n` +
      `→ Daily content for 7 days: before/after, ingredients, testimonials\n` +
      `→ Launch offer: bundle, discount, or limited-run packaging\n\n` +
      `<b>Phase 3: Post-launch (ongoing)</b>\n` +
      `→ Collect reviews and testimonials immediately (send a template to first buyers)\n` +
      `→ Identify your best customers and build a loyalty system\n` +
      `→ Use real feedback to improve formulation or packaging on your next batch\n\n` +
      `<b>DM script that works:</b>\n` +
      `<i>"Hi [Name], I launched a skincare solution specifically for [Problem]. I'd love for you to be one of the first to try it — I'm offering [Offer] this week only. Would you like the details?"</i>\n\n` +
      `🎯 <b>Your action step:</b>\n` +
      `Map out your launch date and the 3 things you'll do in your pre-launch phase.\n\n` +
      `Reply when you're done — I have something special for you. 🌿`,
  },
]

const TOTAL_LESSONS = LESSONS.length
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
