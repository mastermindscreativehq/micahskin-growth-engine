'use strict'

/**
 * telegramFollowUpService.js
 *
 * Handles Telegram replies from leads who have already received their diagnosis.
 * Routes BEFORE the intake state machine so diagnosed leads are never funnelled
 * back into the onboarding question flow.
 *
 * Stages recognised as post-diagnosis:
 *   diagnosis_sent | awaiting_checkin_reply | checkin_sent |
 *   product_reco_sent | awaiting_product_reply |
 *   checkin_replied | product_reply_received | post_diagnosis_engaged
 *
 * Intent buckets classified from reply text:
 *   progress_positive | no_change_yet | irritation |
 *   confused_about_routine | has_not_started |
 *   needs_product_help | wants_human_support | general_update
 */

const prisma = require('../lib/prisma')

const WHATSAPP_LINK = process.env.WHATSAPP_LINK || 'https://wa.me/+2348140468759'

// Every stage that confirms a lead is past the intake phase
const POST_DIAGNOSIS_STAGES = new Set([
  'diagnosis_sent',
  'awaiting_checkin_reply',
  'checkin_sent',
  'product_reco_sent',
  'awaiting_product_reply',
  'checkin_replied',
  'product_reply_received',
  'post_diagnosis_engaged',
])

// ── Routing gate ──────────────────────────────────────────────────────────────

/**
 * Returns true when the lead should be handled by the post-diagnosis follow-up
 * handler rather than the intake state machine.
 *
 * Uses diagnosisSent as the authoritative flag (set by the action engine before
 * any post-intake message is delivered), with telegramStage as a secondary guard
 * for edge cases where the flag may not yet be reflected.
 *
 * @param {object|null} lead
 * @returns {boolean}
 */
function isPostDiagnosisLead(lead) {
  if (!lead) return false
  return lead.diagnosisSent === true || POST_DIAGNOSIS_STAGES.has(lead.telegramStage)
}

// ── Intent classification ─────────────────────────────────────────────────────

/**
 * Classifies a post-diagnosis reply into an intent bucket.
 * Irritation is tested first so "no irritation" reaches progress_positive.
 *
 * @param {string} text
 * @returns {string}
 */
function classifyFollowUpIntent(text) {
  const t = (text || '').toLowerCase()

  // 1. Irritation — test before positive so "burning" isn't misread
  if (
    /reacting|reaction|burn(ing)?|sting(ing)?|itch(ing)?|rash|redness|reddish|flare.?up|broke ?out|breakout.*(worse|new)|tingl(ing)?|sore.?skin|(skin is|it'?s|feels?).*(bad|awful|terrible)|sensitiv(e|ity) reaction/.test(t)
  ) {
    return 'irritation'
  }

  // 2. Positive progress
  if (
    /no irrit|not irrit|no react|not react|no burn|no redness|no rash/.test(t) ||
    /it'?s (fine|okay|ok|good|great|better|working|helping)|going (well|great|good)|working (well|fine)|all good|no issue|no problem/.test(t) ||
    /feel(ing)? (better|good|great|amazing)|love it|happy with|impressed|progressing|improving|improved|less (acne|spots?|dark|oily|dry)|clearer|brighter|smooth(er)?|glow/.test(t) ||
    /^(good|great|fine|ok|okay|nice|positive|yes,? (it'?s )?working|no issues?|no reaction|no problems?)\.?$/.test(t.trim())
  ) {
    return 'progress_positive'
  }

  // 3. Has not started
  if (
    /haven'?t start|not start|not yet start|haven'?t (use|used|tried|applied|begun)|not used|not applied|not tried|haven'?t begun|yet to start|still haven'?t (start|use|tried|applied)|didn'?t start|didn'?t use/.test(t)
  ) {
    return 'has_not_started'
  }

  // 4. Confused about routine
  if (
    /confus(ed)?|don'?t understand|not sure (what|how|which|about)|what is (step|the step|product)|how do (i|you) (use|apply|do)|which (product|step|one) (first|should|do i|comes)|explain|step \d|unclear|lost|don'?t know (how|what|which|where to start)|what (do i|should i) (do|use|apply|start)|what (comes|goes) (first|next|after)/.test(t)
  ) {
    return 'confused_about_routine'
  }

  // 5. No visible change
  if (
    /no change|no (result|improvement|differ|effect|progress)|same as before|nothing (yet|happened|changed|different)|not (working|seeing|noticing)|hasn'?t (worked|changed|done anything)|still (the same|same)|not (seeing|noticing) (any|a) (change|differ|result|improvement)|looks? (the )?same/.test(t)
  ) {
    return 'no_change_yet'
  }

  // 6. Product availability / where to buy
  if (
    /where (to buy|can i (get|find|buy)|do i (get|buy))|can'?t find|not available|how much (is|are|does)|can i afford|buy (from|where)|where'?s (the )?link|order (online|it|them|the)?|how to get (the )?|where.*(get|buy|find).*(product|them)|purchase|available (at|in|online|where)|do you sell|where to (get|order)/.test(t)
  ) {
    return 'needs_product_help'
  }

  // 7. Wants a human
  if (
    /call (me|you|us)|whatsapp|speak(ing)? (to|with) (you|someone|a person)|talk (to|with) (you|someone|a person|the team)|contact (you|the team|us)|need (a )?human|need (a )?person|someone (to talk|to speak|to help)|your team|help me (directly|personally|one.on.one)|consult(ation)?|book (a )?(call|appointment|session)|speak to (a )?human/.test(t)
  ) {
    return 'wants_human_support'
  }

  return 'general_update'
}

// ── Contextual helpers ────────────────────────────────────────────────────────

function _firstName(lead) {
  return lead.fullName.split(' ')[0]
}

function _concernLabel(lead) {
  const raw = lead.primaryConcern || lead.skinConcern || 'your skin concern'
  return raw.replace(/_/g, ' ')
}

// ── Per-intent response builders ──────────────────────────────────────────────

function _buildProgressPositive(lead) {
  const firstName = _firstName(lead)
  const concern   = _concernLabel(lead)

  const timeframes = {
    acne:             '4–6 weeks for visible clearing',
    hyperpigmentation:'6–8 weeks for noticeable brightening',
    dry_skin:         '1–2 weeks for hydration improvement',
    stretch_marks:    '8–12 weeks for texture changes',
    sensitive_skin:   '2–4 weeks for barrier restoration',
    body_care:        '4–6 weeks for even-tone improvement',
  }
  const timeframe = timeframes[lead.primaryConcern] || '4–6 weeks for visible improvement'

  const productPrompt = lead.recommendedProductsText
    ? `\n\nHave you been able to get all the recommended products yet? If you're missing any, let me know which — I'll help you prioritise what to grab first.`
    : `\n\nAre you working with the full routine we recommended, or still building it out?`

  return (
    `That's great to hear, ${firstName}! 🌿\n\n` +
    `No irritation means your skin is tolerating the routine well — exactly the sign you want in the early stage.\n\n` +
    `For ${concern}, consistency is the #1 factor. Aim for ${timeframe} before judging results — don't stop now.` +
    productPrompt
  )
}

function _buildIrritation(lead) {
  const sensitivityNote = (lead.telegramSensitivity || '').toLowerCase().includes('yes')
    ? `Since you mentioned your skin is reactive, re-introduce products more slowly — one new product every 5–7 days once things settle.`
    : `Once it calms down, we'll re-introduce products one at a time to identify the trigger.`

  return (
    `Let's slow down — your skin is giving you a signal. 🛑\n\n` +
    `Which step or product seems to be the trigger? (e.g. the treatment serum, the cleanser, the moisturiser?)\n\n` +
    `In the meantime:\n` +
    `• Pause all active treatments (serums, exfoliants, actives) for 2–3 days\n` +
    `• Use only a gentle cleanser + a plain moisturiser\n` +
    `• Avoid layering products until things calm\n` +
    `• Keep the area clean and don't scrub\n\n` +
    `${sensitivityNote}\n\n` +
    `Reply with what seems to be reacting and I'll walk you through the next steps.`
  )
}

function _buildHasNotStarted(lead) {
  const firstName = _firstName(lead)

  return (
    `No worries, ${firstName} — life gets in the way sometimes.\n\n` +
    `What's been holding you back? Just reply with the letter:\n\n` +
    `a) I haven't gotten the products yet\n` +
    `b) I'm not sure how or where to start\n` +
    `c) Budget has been tight\n` +
    `d) I've been too busy\n\n` +
    `Once I know what's in the way, I can help you take the first step without overwhelm.`
  )
}

function _buildRoutineConfusion(lead) {
  const routineLevel = lead.telegramRoutineLevel || 'balanced'

  const morning = [
    '1. Gentle cleanser',
    '2. Treatment serum (or spot treatment)',
    '3. Moisturiser',
    '4. SPF (non-negotiable in the morning)',
  ].join('\n')

  const night = [
    '1. Gentle cleanser',
    '2. Treatment (stronger actives go here, not morning)',
    '3. Moisturiser',
  ].join('\n')

  const productNote = lead.recommendedProductsText
    ? `\n\nFor your specific ${routineLevel} routine:\n${lead.recommendedProductsText}`
    : ''

  return (
    `Happy to clarify — here's the standard order for a ${routineLevel} routine:\n\n` +
    `🌅 <b>Morning:</b>\n${morning}\n\n` +
    `🌙 <b>Night:</b>\n${night}` +
    `${productNote}\n\n` +
    `Which specific step are you unsure about? Tell me and I'll explain exactly what to do.`
  )
}

function _buildNoChange(lead) {
  const firstName = _firstName(lead)
  const concern   = _concernLabel(lead)

  const earlySignals = {
    acne:             'fewer new breakouts and less inflammation (not instant clearing)',
    hyperpigmentation:'a subtle brightness and more even tone',
    dry_skin:         'less tightness and smoother texture',
    stretch_marks:    'softer, less raised texture around the marks',
    sensitive_skin:   'fewer reactions and reduced redness',
    body_care:        'smoother feel and lighter patches',
  }
  const earlySign = earlySignals[lead.primaryConcern] || 'a subtle shift in texture or tone'

  return (
    `That's completely normal, ${firstName} — visible skin changes take time.\n\n` +
    `For ${concern}, the first thing most people notice is ${earlySign}. This usually starts around week 2–3 of consistent use.\n\n` +
    `A couple of quick questions to help me give you better guidance:\n` +
    `1. How long have you been using the routine?\n` +
    `2. Are you using it consistently — both morning and night?\n\n` +
    `Consistency beats expensive products every time. Reply and I'll review where you are.`
  )
}

function _buildProductHelp(lead) {
  const firstName = _firstName(lead)
  const budget    = (lead.telegramBudget || '').toLowerCase()

  const channelsByBudget = {
    budget:      `Most budget-friendly options are on Jumia or Konga. We also carry selected products — WhatsApp us to check availability: ${WHATSAPP_LINK}`,
    'mid-range': `Look on Jumia, Sephora, or specialty skincare stores. We stock selected mid-range options too — DM us: ${WHATSAPP_LINK}`,
    premium:     `For premium products, check Sephora, official brand sites, or DM us on WhatsApp for authentic stock: ${WHATSAPP_LINK}`,
  }

  const channelGuide = channelsByBudget[budget] ||
    `Most options are on Jumia, or DM us on WhatsApp for availability: ${WHATSAPP_LINK}`

  const productNote = lead.recommendedProductsText
    ? `Based on your routine, here's what to look for:\n${lead.recommendedProductsText}\n\n`
    : ''

  return (
    `Let me help you track these down, ${firstName}.\n\n` +
    `${productNote}` +
    `${channelGuide}\n\n` +
    `If you can't find a specific product, let me know which one — there's usually a good local alternative.`
  )
}

function _buildWantsHuman(lead) {
  const firstName = _firstName(lead)
  const concern   = _concernLabel(lead)

  return (
    `Of course, ${firstName} — our team is happy to speak with you directly.\n\n` +
    `👉 Message us on WhatsApp: ${WHATSAPP_LINK}\n\n` +
    `Mention your main concern (${concern}) when you reach out so they can help you straight away.`
  )
}

function _buildDefault(lead) {
  const firstName = _firstName(lead)

  return (
    `Thanks for the update, ${firstName}! 🌿\n\n` +
    `How's the routine going overall? Any irritation, improvements you've noticed, or questions about a specific step?`
  )
}

// ── Stage advancement ─────────────────────────────────────────────────────────

/**
 * Determines the next telegramStage after a post-diagnosis reply is received.
 */
function _nextStage(currentStage) {
  if (currentStage === 'awaiting_checkin_reply' || currentStage === 'checkin_sent') {
    return 'checkin_replied'
  }
  if (currentStage === 'awaiting_product_reply' || currentStage === 'product_reco_sent') {
    return 'product_reply_received'
  }
  if (currentStage === 'diagnosis_sent') {
    return 'post_diagnosis_engaged'
  }
  // Already in a reply stage — keep as-is so we don't regress
  return currentStage
}

// ── Main exported handler ─────────────────────────────────────────────────────

/**
 * Entry point for post-diagnosis Telegram replies.
 *
 * Classifies intent from the user's message, responds using saved lead context
 * (primaryConcern, telegramSkinType, telegramSensitivity, recommendedProductsText,
 * routineType, telegramBudget, telegramRoutineLevel), persists the detected intent,
 * and advances the telegramStage.
 *
 * @param {object} lead  — Full Lead record from Prisma
 * @param {string} text  — Raw incoming message text
 * @returns {Promise<string>} — Bot reply (always a non-empty string)
 */
async function handlePostDiagnosisReply(lead, text) {
  const intent = classifyFollowUpIntent(text)
  const now    = new Date()
  const stage  = _nextStage(lead.telegramStage)

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      followUpIntent:        intent,
      followUpIntentAt:      now,
      telegramLastMessage:   text,
      telegramLastMessageAt: now,
      telegramStage:         stage,
    },
  })

  console.log(
    `[TelegramFollowUp] lead=${lead.id} chatId=${lead.telegramChatId} ` +
    `intent=${intent} stage=${lead.telegramStage} → ${stage}`
  )

  switch (intent) {
    case 'progress_positive':    return _buildProgressPositive(lead)
    case 'irritation':           return _buildIrritation(lead)
    case 'has_not_started':      return _buildHasNotStarted(lead)
    case 'confused_about_routine': return _buildRoutineConfusion(lead)
    case 'no_change_yet':        return _buildNoChange(lead)
    case 'needs_product_help':   return _buildProductHelp(lead)
    case 'wants_human_support':  return _buildWantsHuman(lead)
    default:                     return _buildDefault(lead)
  }
}

module.exports = { isPostDiagnosisLead, handlePostDiagnosisReply, classifyFollowUpIntent }
