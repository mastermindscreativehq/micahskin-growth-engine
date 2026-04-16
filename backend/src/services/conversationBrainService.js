'use strict'

/**
 * conversationBrainService.js — Phase 22: Conversation Brain + Reply Governor
 *
 * Central orchestration layer for all post-diagnosis Telegram conversations.
 *
 * What it does:
 *   1. Classifies inbound messages with an extended 12-bucket intent taxonomy
 *   2. Derives / maintains the effective conversation mode for each lead
 *   3. Applies the Reply Governor to decide whether automated sends are allowed
 *   4. Generates context-aware replies from stored diagnosis and journey data —
 *      without keyword loops, re-opened intake questions, or generic check-ins
 *   5. Persists conversation state fields after every interaction
 *
 * Intent taxonomy (12 buckets):
 *   greeting | routine_feedback | irritation_or_side_effect | product_question |
 *   product_buying_intent | academy_interest | academy_objection |
 *   consult_interest | payment_question | thanks_acknowledgement |
 *   stop_or_not_interested | unclear
 *
 * Conversation modes:
 *   intake | diagnosis_sent | checkin_active | product_reco_active |
 *   academy_pitch_active | consult_active | payment_pending |
 *   human_manual_mode | closed
 *
 * Reply Governor suppression rules (shouldSendAutomation):
 *   • botMutedUntil not elapsed       → block ALL automation
 *   • followupSuppressed = true       → block all automation
 *   • mode = closed                   → block everything
 *   • mode = human_manual_mode        → block automation (admin has the wheel)
 *   • mode = product_reco_active      → block check_in + product_reco auto-sends
 *   • mode = academy_pitch_active     → block check_in auto-sends
 *   • mode = consult_active           → block check_in + product_reco + academy auto-sends
 *   diagnosis sends are NEVER suppressed — they are the entry point
 *
 * Response priorities — academy:
 *   If academyPitchCount >= 1, never re-ask "reply ACADEMY". Answer the user's
 *   actual question directly and include the link once.
 *
 * Response priorities — product:
 *   Answer from stored: primaryConcern, recommendedProductsText, telegramSkinType,
 *   telegramBudget, routineType. Suppress check-in follow-ups for 6 hours
 *   after a product question is answered (product conversation is active).
 */

const prisma = require('../lib/prisma')

const ACADEMY_LINK  = process.env.ACADEMY_LINK  || 'https://micahskin-growth-engine.vercel.app/academy'
const WHATSAPP_LINK = process.env.WHATSAPP_LINK || 'https://wa.me/+2348140468759'

// Bot mute after a manual admin send (4 hours)
const MANUAL_MUTE_MS = 4 * 60 * 60 * 1000

// After bot answers a product question, suppress generic check-ins for 6 hours
const PRODUCT_ACTIVE_SUPPRESS_MS = 6 * 60 * 60 * 1000

// After bot delivers an academy pitch, suppress unrelated check-ins for 3 hours
const ACADEMY_ACTIVE_SUPPRESS_MS = 3 * 60 * 60 * 1000

// ── Intent classification ─────────────────────────────────────────────────────

/**
 * Extended 12-bucket inbound intent classifier.
 *
 * Tests priority order: destructive → transactional → specific informational → social.
 * Each bucket has tight regex so common short phrases are caught early.
 *
 * @param {string} text  Raw message from Telegram
 * @returns {string}     One of the 12 bucket labels
 */
function classifyInboundIntent(text) {
  const t = (text || '').toLowerCase().trim()

  // 1. Stop / opt-out — always highest priority
  if (
    /\b(stop|unsubscribe|remove me|leave me alone|don.?t (message|contact|text|bother) me|block|opt.?out|no more messages?|please stop|stop messaging)\b/.test(t) ||
    /\bnot interested\b/.test(t) && t.length < 50
  ) {
    return 'stop_or_not_interested'
  }

  // 2. Payment question
  if (/\b(pay(ment)?|price|cost|how much|fee(s)?|charge|naira|₦|transfer|bank( details)?|invoice|afford(able)?)\b/.test(t)) {
    return 'payment_question'
  }

  // 3. Consult interest — before product so "book a call" doesn't hit product bucket
  if (
    /\b(consult(ation)?|book (a )?(call|appointment|session)|speak (to|with) (you|someone)|talk (to|with)|one.on.one|1.on.1|speak to (a )?human|need (someone|a person)|get (your )?help directly|personal (guide|guidance|support)|direct (help|support|consult))\b/.test(t)
  ) {
    return 'consult_interest'
  }

  // 4. Product buying intent — "want to buy / get the products" style
  if (
    /\b(buy|purchase|order|i.?d like (to )?(get|buy)|want to (get|buy)|how (to get|can i (get|buy|find))|where (to get|can i (get|buy|find))|get (it|them|these|those|the products?)|link (to buy|to order|to get)|where to (buy|order|get))\b/.test(t)
  ) {
    return 'product_buying_intent'
  }

  // 5. Academy interest
  if (
    /\b(academy|masterclass|class(es)?|course|training|brand.?build|skincare brand|skincare business|learn (skincare|how to|about)|enroll|enrolment|register|tell me more (about)?|what is (the )?(academy|course|masterclass)|how does it work|curriculum|modules?|what.?s (in|included|covered)|sign up)\b/.test(t)
  ) {
    return 'academy_interest'
  }

  // 6. Academy objection — "too expensive, let me think" etc.
  if (
    /\b(too expensive|can.?t afford|maybe later|not now|later|give me (time|a bit)|let me (think|check|ask|consider)|need to (think|consider)|my budget (is )?(tight|low)|not sure (if|about|yet)|will (think|decide) later|thinking about it)\b/.test(t) &&
    /(academy|course|masterclass|price|cost|afford|expensive|register|enroll)/.test(t)
  ) {
    return 'academy_objection'
  }

  // 7. Product question — asking for advice / what to use
  if (
    /\b(what (product|serum|cream|toner|spf|sunscreen|cleanser|moisturi[sz]er|ingredient|treatment|oil)|which (product|one|brand|should (i|we))|recommend(ation)?|suggest(ion)?|what (do|should) i (use|try|apply|do|get|buy)|what.?s (good|best|right) for|help (me )?(with |choose )?(a )?(product|routine|skin)|what can i use|is [a-z ]+ good for)\b/.test(t)
  ) {
    return 'product_question'
  }

  // 8. Thanks / acknowledgement — short gratitude phrases
  if (
    t.length < 60 &&
    /^(thank(s| you( so much)?)?|ok(ay)?|noted|got it|alright|understood|sure|will (do|try)|i will|i.?ll (try|do)|appreciate (it|that|this)|perfect|great|cool|nice|makes sense|got that|that.?s helpful|helpful|good to know|i see)\s*[.!]?\s*$/.test(t)
  ) {
    return 'thanks_acknowledgement'
  }

  // 9. Greeting — very short opener
  if (
    t.length < 40 &&
    /^(hi|hello|hey|good (morning|afternoon|evening|day|night)|howdy|what.?s up|how are (you|u)|hope (you.?re|ur) (well|good|okay)|(hi|hello|hey)[,. ]+[a-z]+)\s*[.!,]?\s*$/.test(t)
  ) {
    return 'greeting'
  }

  // 10. Irritation / side effects
  if (
    /reacting|reaction|burn(ing)?|sting(ing)?|itch(ing)?|rash|redness|reddish|flare.?up|broke.?out|breakout.*(worse|new)|tingl(ing)?|sore.?skin|(skin is|it.?s|feels?).*(bad|awful|terrible|worse)|sensitiv(e|ity) reaction|purging/.test(t)
  ) {
    return 'irritation_or_side_effect'
  }

  // 11. Routine feedback — delegate detection to legacy classifier for these nuanced patterns
  //     Import inline to avoid circular dep (telegramFollowUpService imports nothing from brain)
  const { classifyFollowUpIntent } = require('./telegramFollowUpService')
  const legacyIntent = classifyFollowUpIntent(t)
  if (
    legacyIntent === 'progress_positive' ||
    legacyIntent === 'no_change_yet' ||
    legacyIntent === 'has_not_started' ||
    legacyIntent === 'confused_about_routine' ||
    legacyIntent === 'general_update'
  ) {
    return 'routine_feedback'
  }
  if (legacyIntent === 'needs_product_help') return 'product_question'
  if (legacyIntent === 'wants_human_support') return 'consult_interest'
  if (legacyIntent === 'irritation') return 'irritation_or_side_effect'

  return 'unclear'
}

// ── Conversation mode helpers ─────────────────────────────────────────────────

/**
 * Returns true when the bot is currently muted (botMutedUntil has not elapsed).
 */
function isBotMuted(lead) {
  if (!lead.botMutedUntil) return false
  return new Date() < new Date(lead.botMutedUntil)
}

/**
 * Derives the effective conversation mode for a lead.
 *
 * Priority order (highest → lowest):
 *   closed → human_manual_mode (muted) → payment_pending →
 *   consult_active → academy_pitch_active → product_reco_active →
 *   checkin_active → diagnosis_sent → intake
 *
 * The stored conversationMode field is the authoritative value when set.
 * This function is used as a fallback for leads that pre-date Phase 22.
 */
function getConversationMode(lead) {
  if (lead.status === 'closed') return 'closed'
  if (isBotMuted(lead)) return 'human_manual_mode'
  if (lead.conversionType === 'academy_paid') return 'payment_pending'

  // Authoritative stored mode
  if (lead.conversationMode) return lead.conversationMode

  // Derive from journey flags for pre-Phase-22 leads
  if (!lead.diagnosisSent) return 'intake'
  if (lead.consultOfferSent) return 'consult_active'
  if (lead.academyOfferSent && lead.conversionStage === 'offer_sent') return 'academy_pitch_active'
  if (lead.productRecoSent || lead.productOfferSent) return 'product_reco_active'
  if (lead.checkInSent) return 'checkin_active'
  return 'diagnosis_sent'
}

// ── Reply Governor ────────────────────────────────────────────────────────────

/**
 * Governor gate: called by the action engine before every automated send.
 *
 * Returns { allowed: boolean, reason: string|null }
 *
 * Suppression rules:
 *   1. diagnosis sends are NEVER suppressed
 *   2. Closed lead → block all
 *   3. botMutedUntil not elapsed → block all automation
 *   4. followupSuppressed = true → block all automation
 *   5. mode = closed / human_manual_mode → block automation
 *   6. mode = product_reco_active → block check_in + product_reco sends
 *   7. mode = academy_pitch_active → block check_in sends
 *   8. mode = consult_active → block check_in + product_reco + academy sends
 *
 * @param {object} lead        Full Lead record from DB
 * @param {string} actionType  Action the engine wants to send
 * @returns {{ allowed: boolean, reason: string|null }}
 */
function shouldSendAutomation(lead, actionType) {
  // Diagnosis is always the entry point — never suppressed
  if (actionType === 'diagnosis') {
    return { allowed: true, reason: null }
  }

  if (lead.status === 'closed') {
    return { allowed: false, reason: 'lead_closed' }
  }

  // Bot muted by admin or active conversation cooldown
  if (isBotMuted(lead)) {
    const until = lead.botMutedUntil
      ? new Date(lead.botMutedUntil).toISOString()
      : 'unknown'
    return { allowed: false, reason: `bot_muted_until:${until}` }
  }

  // Hard suppress flag set by admin
  if (lead.followupSuppressed) {
    return { allowed: false, reason: 'followup_suppressed_by_admin' }
  }

  const mode = getConversationMode(lead)

  if (mode === 'closed') {
    return { allowed: false, reason: 'conversation_mode:closed' }
  }
  if (mode === 'human_manual_mode') {
    return { allowed: false, reason: 'conversation_mode:human_manual_mode' }
  }
  if (mode === 'payment_pending') {
    // Still allow consult offers but block generic follow-up noise
    if (['check_in', 'product_reco'].includes(actionType)) {
      return { allowed: false, reason: 'conversation_mode:payment_pending' }
    }
  }

  // Active product conversation: suppress check-in and product_reco (already covered)
  if (mode === 'product_reco_active') {
    if (actionType === 'check_in' || actionType === 'product_reco') {
      return { allowed: false, reason: 'suppressed:product_reco_active_mode' }
    }
  }

  // Active academy pitch: suppress generic check-ins that would interrupt
  if (mode === 'academy_pitch_active') {
    if (actionType === 'check_in') {
      return { allowed: false, reason: 'suppressed:academy_pitch_active_mode' }
    }
  }

  // Active consult conversation: block generic noise
  if (mode === 'consult_active') {
    if (['check_in', 'product_reco', 'academy_offer'].includes(actionType)) {
      return { allowed: false, reason: 'suppressed:consult_active_mode' }
    }
  }

  return { allowed: true, reason: null }
}

// ── Response builders ─────────────────────────────────────────────────────────

function _firstName(lead) {
  return (lead.fullName || '').split(' ')[0] || 'there'
}

function _concern(lead) {
  return (lead.primaryConcern || lead.skinConcern || 'your skin concern').replace(/_/g, ' ')
}

/**
 * Contextual academy response — no keyword loops.
 *
 * Academy is framed as 4 pillars:
 *   1. Skincare education
 *   2. Brand-building training
 *   3. AI for skincare / business growth
 *   4. Implementation framework — post-masterclass scale system
 *
 * If lead has already seen ≥2 pitches, skip the full pitch and just send the link.
 * If the intent is an objection, address the specific concern before the CTA.
 */
function buildAcademyContextualReply(lead, intent) {
  const firstName     = _firstName(lead)
  const concern       = _concern(lead)
  const trackableLink = `${ACADEMY_LINK}?leadId=${lead.id}`
  const pitchCount    = lead.academyPitchCount || 0

  // They've seen the full pitch before — just send the link directly
  if (pitchCount >= 2) {
    return (
      `Here's the Academy link, ${firstName}:\n\n` +
      `👉 ${trackableLink}\n\n` +
      `Complete your registration there. Reply if you have any questions before you decide.`
    )
  }

  // Objection handling — price, budget, timing
  if (intent === 'academy_objection') {
    return (
      `I hear you — price is a real consideration.\n\n` +
      `Here's what the Academy actually delivers:\n` +
      `• Full skincare education — not just tips. You'll understand skin science, ingredients, and what works for ${concern}\n` +
      `• Brand-building training — how to launch or scale a skincare business the right way\n` +
      `• AI for skincare + business — how serious founders are already using AI to grow faster\n` +
      `• Post-masterclass implementation system — so you don't just watch videos; you actually execute\n\n` +
      `Most people spend 5–10× this amount guessing. This shortcut is the alternative.\n\n` +
      `If budget is the real barrier, let me know — we can talk through what makes sense.\n` +
      `Or register here when you're ready:\n` +
      `👉 ${trackableLink}`
    )
  }

  // Standard academy interest — full contextual pitch
  return (
    `Good question, ${firstName}. Let me explain what the Academy actually is — because it's not a generic skincare course.\n\n` +
    `It's built around 4 pillars:\n\n` +
    `1️⃣ <b>Skincare Education</b>\n` +
    `Understand your skin properly — ingredients, formulations, what drives ${concern} and how to fix it. Not surface-level tips.\n\n` +
    `2️⃣ <b>Brand Building</b>\n` +
    `Step-by-step training to launch or scale a real skincare brand. Sourcing, positioning, pricing, customer acquisition.\n\n` +
    `3️⃣ <b>AI for Skincare + Business Growth</b>\n` +
    `How to use AI tools to build faster, work smarter, and grow a skincare or beauty business in 2024.\n\n` +
    `4️⃣ <b>Implementation Framework</b>\n` +
    `The part most courses skip. A post-masterclass system that helps you actually execute — not just take notes.\n\n` +
    `Whether you're fixing your own skin or building something real in skincare, this covers both.\n\n` +
    `Register here:\n` +
    `👉 ${trackableLink}\n\n` +
    `Reply with any specific questions — I'll give you a straight answer.`
  )
}

/**
 * Context-aware product response using stored diagnosis data.
 *
 * Pulls from: primaryConcern, recommendedProductsText, telegramSkinType,
 * telegramBudget, routineType.
 */
function buildProductContextualReply(lead, intent) {
  const firstName = _firstName(lead)
  const concern   = _concern(lead)
  const skinType  = lead.telegramSkinType
    ? ` and ${lead.telegramSkinType} skin`
    : ''
  const budget    = lead.telegramBudget || null
  const products  = lead.recommendedProductsText || null

  let intro = ''
  if (intent === 'product_buying_intent') {
    intro = `Here are the exact products for your ${concern}${skinType}, ${firstName}:\n\n`
  } else {
    intro = `Based on your ${concern}${skinType}, here's what to use:\n\n`
  }

  const productSection = products
    ? `<b>Your personalised product set:</b>\n${products}\n\n`
    : (
      `I don't have your full product list stored here, but based on your concern I'd focus on:\n` +
      `• A gentle, non-stripping cleanser\n` +
      `• A targeted treatment serum for ${concern}\n` +
      `• A hydrating moisturiser suited to ${lead.telegramSkinType || 'your'} skin\n` +
      `• SPF (non-negotiable in the morning)\n\n` +
      `Reply with a specific product or step you need help with and I'll give you a precise answer.\n\n`
    )

  const budgetNote = budget
    ? `These are matched to your ${budget} budget.\n\n`
    : ''

  const cta =
    `To get these or check availability, message us directly:\n` +
    `👉 ${WHATSAPP_LINK}\n\n` +
    `Or reply here with any specific product question.`

  return `${intro}${productSection}${budgetNote}${cta}`
}

/**
 * Brief acknowledgement for thanks/short confirmations.
 * Rotates across 3 variants so it doesn't feel repetitive.
 * Does NOT send a long routine follow-up — that would feel intrusive after a thanks.
 */
function buildAcknowledgementReply(lead) {
  const firstName = _firstName(lead)
  const variants  = [
    `You're welcome, ${firstName}! Stay consistent and let me know if anything comes up.`,
    `Of course! Consistency is everything with skincare — you're on the right track. Reply anytime.`,
    `Happy to help. If anything changes or you want to adjust the routine, I'm here.`,
  ]
  const idx = (lead.conversionAttempts || 0) % variants.length
  return variants[idx]
}

/**
 * Friendly, brief greeting response.
 * Routes them toward sharing their current state without an overwhelming question.
 */
function buildGreetingReply(lead) {
  const firstName     = _firstName(lead)
  const diagnosisSent = lead.diagnosisSent

  if (diagnosisSent) {
    return (
      `Hi ${firstName}! 👋\n\n` +
      `How's the routine going? Any questions or updates?`
    )
  }
  return `Hi ${firstName}! 👋 Good to hear from you. What can I help you with?`
}

/**
 * Graceful stop response. Sets the lead to closed mode.
 */
function buildStopReply(lead) {
  const firstName = _firstName(lead)
  return (
    `Understood, ${firstName}. We'll stop reaching out.\n\n` +
    `If you ever want to revisit your skincare routine or have questions, feel free to message us anytime.\n\n` +
    `Take care! 🙏`
  )
}

/**
 * Payment information response.
 */
function buildPaymentReply(lead) {
  const firstName     = _firstName(lead)
  const trackableLink = `${ACADEMY_LINK}?leadId=${lead.id}`

  return (
    `Hi ${firstName},\n\n` +
    `Academy registration is processed on the sign-up page:\n\n` +
    `• <b>Premium Package</b> — ₦60,000 (includes full implementation system)\n` +
    `• <b>Basic Package</b> — ₦50,000 (full masterclass access)\n\n` +
    `Complete your registration here:\n` +
    `👉 ${trackableLink}\n\n` +
    `Reply with any payment questions and I'll sort them out.`
  )
}

/**
 * Consult interest response — drives to WhatsApp with specific framing.
 */
function buildConsultInterestReply(lead) {
  const firstName = _firstName(lead)
  const concern   = _concern(lead)

  return (
    `Hi ${firstName} 👋\n\n` +
    `A direct consultation is exactly the right move for ${concern}.\n\n` +
    `Here's what we'll cover:\n` +
    `• The root cause of your specific concern\n` +
    `• What to avoid (products or habits actively making it worse)\n` +
    `• A realistic routine and timeline that fits your life\n` +
    `• The fastest safe next action\n\n` +
    `Message us here to book:\n` +
    `👉 ${WHATSAPP_LINK}`
  )
}

// ── State management ──────────────────────────────────────────────────────────

/**
 * Mute all bot automation for a lead until (now + durationMs).
 * Default: 4 hours (post manual send).
 *
 * @param {string} leadId
 * @param {number} [durationMs]
 */
async function muteBot(leadId, durationMs = MANUAL_MUTE_MS) {
  const until = new Date(Date.now() + durationMs)
  await prisma.lead.update({
    where: { id: leadId },
    data:  { botMutedUntil: until },
  }).catch(err =>
    console.error(`[ConversationBrain] muteBot failed for lead=${leadId}:`, err.message)
  )
  console.log(`[ConversationBrain] bot muted → lead=${leadId} until=${until.toISOString()}`)
}

/**
 * Persist conversation state updates to a lead record.
 *
 * @param {string} leadId
 * @param {object} updates  Prisma data payload (supports { increment: n } for counters)
 */
async function updateConversationState(leadId, updates) {
  await prisma.lead.update({
    where: { id: leadId },
    data:  updates,
  }).catch(err =>
    console.error(`[ConversationBrain] state update failed for lead=${leadId}:`, err.message)
  )
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Central inbound reply handler for post-diagnosis leads.
 *
 * Called from telegramController.js instead of handlePostDiagnosisReply directly.
 *
 * Flow:
 *   1. Classify intent (12-bucket extended taxonomy)
 *   2. Determine effective conversation mode
 *   3. Record lastUserIntent + lastMeaningfulUserAt
 *   4. Route to the appropriate response builder
 *   5. Update conversation state (mode, lastBotIntent, offer counts, mute)
 *   6. Return reply text (telegramController sends it)
 *
 * For routine feedback and irritation intents, delegates to the existing
 * telegramFollowUpService.handlePostDiagnosisReply which has thorough
 * per-intent response builders for those cases.
 *
 * @param {object} lead  Full Lead record from Prisma
 * @param {string} text  Raw inbound message text
 * @returns {Promise<string|null>}  Reply to send, or null to stay silent
 */
async function handleInboundReply(lead, text) {
  const intent = classifyInboundIntent(text)
  const mode   = getConversationMode(lead)
  const now    = new Date()

  console.log(
    `[ConversationBrain] lead=${lead.id} mode=${mode} intent=${intent} ` +
    `academyPitchCount=${lead.academyPitchCount || 0} ` +
    `productOfferCount=${lead.productOfferCount || 0} ` +
    `botMuted=${isBotMuted(lead)}`
  )

  // Base state recorded for every inbound message
  const baseUpdate = {
    lastUserIntent:       intent,
    lastMeaningfulUserAt: now,
    telegramLastMessage:   text,
    telegramLastMessageAt: now,
  }

  // ── Intent routing ────────────────────────────────────────────────────────

  // Stop — close gracefully, hard-suppress automation
  if (intent === 'stop_or_not_interested') {
    await updateConversationState(lead.id, {
      ...baseUpdate,
      conversationMode:   'closed',
      followupSuppressed: true,
      lastBotIntent:      'close_graceful',
      lastMeaningfulBotAt: now,
    })
    return buildStopReply(lead)
  }

  // Thanks — brief acknowledgement, mute bot for 2 hours
  if (intent === 'thanks_acknowledgement') {
    await updateConversationState(lead.id, {
      ...baseUpdate,
      lastBotIntent:      'acknowledgement',
      lastMeaningfulBotAt: now,
      botMutedUntil:      new Date(now.getTime() + 2 * 60 * 60 * 1000),
    })
    return buildAcknowledgementReply(lead)
  }

  // Greeting — brief contextual response, no state change needed
  if (intent === 'greeting') {
    await updateConversationState(lead.id, {
      ...baseUpdate,
      lastBotIntent: 'greeting_response',
    })
    return buildGreetingReply(lead)
  }

  // Payment question
  if (intent === 'payment_question') {
    await updateConversationState(lead.id, {
      ...baseUpdate,
      conversationMode:   'payment_pending',
      lastBotIntent:      'payment_info',
      lastMeaningfulBotAt: now,
    })
    return buildPaymentReply(lead)
  }

  // Academy interest or objection — contextual, no "reply ACADEMY" loop
  if (intent === 'academy_interest' || intent === 'academy_objection') {
    const reply = buildAcademyContextualReply(lead, intent)
    await updateConversationState(lead.id, {
      ...baseUpdate,
      conversationMode:   'academy_pitch_active',
      activeOffer:        'academy',
      awaitingReplyFor:   'academy_decision',
      lastBotIntent:      intent === 'academy_objection' ? 'academy_objection_handle' : 'academy_pitch',
      lastMeaningfulBotAt: now,
      academyPitchCount:  { increment: 1 },
      // Suppress generic check-ins for 3 hours while academy conversation is live
      botMutedUntil:      new Date(now.getTime() + ACADEMY_ACTIVE_SUPPRESS_MS),
    })
    return reply
  }

  // Consult interest — redirect to WhatsApp, enter consult_active mode
  if (intent === 'consult_interest') {
    await updateConversationState(lead.id, {
      ...baseUpdate,
      conversationMode:   'consult_active',
      activeOffer:        'consult',
      lastBotIntent:      'consult_redirect',
      lastMeaningfulBotAt: now,
      consultOfferCount:  { increment: 1 },
    })
    return buildConsultInterestReply(lead)
  }

  // Product question or buying intent — answer from stored diagnosis context
  if (intent === 'product_question' || intent === 'product_buying_intent') {
    const reply = buildProductContextualReply(lead, intent)
    await updateConversationState(lead.id, {
      ...baseUpdate,
      conversationMode:   'product_reco_active',
      activeOffer:        'product',
      awaitingReplyFor:   'product_follow',
      lastBotIntent:      'product_answer',
      lastMeaningfulBotAt: now,
      productOfferCount:  { increment: 1 },
      // Suppress generic check-in follow-ups for 6 hours — product conversation is now active
      botMutedUntil:      new Date(now.getTime() + PRODUCT_ACTIVE_SUPPRESS_MS),
    })
    return reply
  }

  // Routine feedback, irritation, unclear — delegate to existing handler
  // which has thorough context-aware builders for these intent patterns.
  // We update brain state AFTER the delegate call to avoid field conflicts.
  const { handlePostDiagnosisReply } = require('./telegramFollowUpService')
  const reply = await handlePostDiagnosisReply(lead, text)

  const botIntentMap = {
    routine_feedback:          'routine_guidance',
    irritation_or_side_effect: 'irritation_protocol',
    unclear:                   'general_response',
  }
  await updateConversationState(lead.id, {
    lastUserIntent:      intent,
    lastBotIntent:       botIntentMap[intent] || 'general_response',
    lastMeaningfulBotAt: now,
  })

  return reply
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  classifyInboundIntent,
  getConversationMode,
  shouldSendAutomation,
  isBotMuted,
  muteBot,
  updateConversationState,
  buildAcademyContextualReply,
  buildProductContextualReply,
  handleInboundReply,

  // Exported constants for shared use
  MANUAL_MUTE_MS,
}
