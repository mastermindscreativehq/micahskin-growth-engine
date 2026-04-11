const prisma = require('../lib/prisma')
const { sendAndLogTelegramMessage, formatLeadTelegramMessage } = require('./telegramService')
const { sendMessage } = require('./messageSenderService')
const { normalizePhoneNumber } = require('../utils/phoneUtils')

// Statuses that block automated and CRM-triggered sends
const STOP_STATUSES = ['engaged', 'interested', 'closed']

const VALID_PLATFORMS = ['TikTok', 'Instagram', 'Other']
const VALID_PRIORITIES = ['high', 'medium', 'low']
const VALID_CONCERNS = [
  'acne',
  'dark_spots',
  'stretch_marks',
  'dry_skin',
  'hyperpigmentation',
  'body_care',
  'other',
]
const VALID_SOURCE_TYPES = ['bio_form', 'dm', 'comment', 'story_reply', 'manual']

// New state machine statuses. 'qualified' and 'converted' kept for backward compatibility with existing data.
const VALID_STATUSES = ['new', 'contacted', 'engaged', 'interested', 'closed', 'qualified', 'converted']

/**
 * Determines lead priority from source signals.
 * high  — DM from any platform (highest intent, direct contact)
 * medium — Instagram bio form or any bio_form source
 * low   — everything else
 */
function computePriority({ sourceType, sourcePlatform }) {
  if (sourceType === 'dm') return 'high'
  if (sourceType === 'bio_form' || sourcePlatform === 'Instagram') return 'medium'
  return 'low'
}

/**
 * Determines initial status from source signals.
 * dm → contacted (the lead was already reached via DM)
 * everything else → new
 */
function computeInitialStatus({ sourceType }) {
  if (sourceType === 'dm') return 'contacted'
  return 'new'
}

/**
 * Generates a personalised suggested reply based on lead signals.
 * Intent tag takes highest precedence, then sourceType, then sourcePlatform.
 */
function generateSuggestedReply({ intentTag, sourcePlatform, sourceType, skinConcern, fullName }) {
  const firstName = (fullName || '').split(' ')[0] || 'there'
  const concern = (skinConcern || 'skin concern').replace(/_/g, ' ')
  const tag = (intentTag || '').toLowerCase()

  // Intent-tag overrides
  if (tag.includes('price') || tag.includes('cost') || tag.includes('how much')) {
    return `Hi ${firstName}! Thanks for reaching out about pricing. We'd love to help with your ${concern}. Can I send over our current packages and we go from there?`
  }
  if (tag.includes('urgent') || tag.includes('asap') || tag.includes('quick')) {
    return `Hi ${firstName}! I saw your message — let's get you sorted ASAP. Tell me a bit more about your ${concern} and I'll recommend the fastest solution we have.`
  }
  if (tag.includes('testimonial') || tag.includes('result') || tag.includes('before')) {
    return `Hi ${firstName}! Happy to share some before-and-after results for ${concern}. Give me a moment and I'll send them over!`
  }

  // Source-type overrides
  if (sourceType === 'dm') {
    return `Hi ${firstName}! Thanks for your DM. I saw you're dealing with ${concern} — we've helped so many clients with exactly that. Would you like some personalised product recommendations?`
  }
  if (sourceType === 'comment') {
    return `Hi ${firstName}! I noticed your comment and wanted to reach out directly. We have really effective solutions for ${concern}. Want me to walk you through what would work best for you?`
  }
  if (sourceType === 'story_reply') {
    return `Hi ${firstName}! Thanks for replying to our story. Your ${concern} concern is something we specialise in — I'd love to share what's worked for our clients!`
  }

  // Platform-based
  if (sourceType === 'bio_form' && sourcePlatform === 'TikTok') {
    return `Hi ${firstName}! Thanks for filling out our form from TikTok. We'd love to help with your ${concern}. When's a good time to chat?`
  }
  if (sourceType === 'bio_form' && sourcePlatform === 'Instagram') {
    return `Hi ${firstName}! Thanks for reaching out via Instagram. We specialise in ${concern} and have helped loads of clients see real results. Would you like our recommendations?`
  }

  // Default fallback
  return `Hi ${firstName}! Thank you for getting in touch. We specialise in ${concern} and would love to help you see real results. How can we best support you?`
}

/**
 * Computes the three follow-up timestamps relative to a base time.
 */
function computeFollowUpTimes(base = new Date()) {
  const t = new Date(base).getTime()
  return {
    followUp1: new Date(t + 1 * 60 * 60 * 1000),   // +1 hour
    followUp2: new Date(t + 6 * 60 * 60 * 1000),   // +6 hours
    followUp3: new Date(t + 24 * 60 * 60 * 1000),  // +24 hours
  }
}

/**
 * Validates and creates a new skincare lead.
 */
async function createLead(data) {
  const errors = []

  const {
    fullName, email, phone, sourcePlatform, skinConcern, message,
    sourceType, handle, campaign, intentTag,
    utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
  } = data

  if (!fullName || typeof fullName !== 'string' || fullName.trim() === '') {
    errors.push('fullName is required')
  }

  if (!sourcePlatform || !VALID_PLATFORMS.includes(sourcePlatform)) {
    errors.push(`sourcePlatform must be one of: ${VALID_PLATFORMS.join(', ')}`)
  }

  if (!skinConcern || !VALID_CONCERNS.includes(skinConcern)) {
    errors.push(`skinConcern must be one of: ${VALID_CONCERNS.join(', ')}`)
  }

  if (!message || typeof message !== 'string' || message.trim() === '') {
    errors.push('message is required')
  }

  // Normalise phone to E.164 — only validate if a value was provided (field is optional)
  let normalizedPhone = null
  if (phone) {
    try {
      normalizedPhone = normalizePhoneNumber(phone)
    } catch (phoneErr) {
      errors.push(phoneErr.message)
    }
  }

  if (errors.length > 0) {
    const err = new Error('Validation failed')
    err.status = 400
    err.errors = errors
    throw err
  }

  // Coerce sourceType to null if not a recognised value (tracking metadata — never block submission)
  const resolvedSourceType = sourceType && VALID_SOURCE_TYPES.includes(sourceType) ? sourceType : null

  const priority = computePriority({ sourceType: resolvedSourceType, sourcePlatform })
  const initialStatus = computeInitialStatus({ sourceType: resolvedSourceType })
  const suggestedReply = generateSuggestedReply({
    intentTag,
    sourcePlatform,
    sourceType: resolvedSourceType,
    skinConcern,
    fullName,
  })
  const { followUp1, followUp2, followUp3 } = computeFollowUpTimes()

  const lead = await prisma.lead.create({
    data: {
      fullName: fullName.trim(),
      email: email?.trim() || null,
      phone: normalizedPhone,
      sourcePlatform,
      sourceType: resolvedSourceType,
      handle: handle?.trim() || null,
      campaign: campaign?.trim() || null,
      intentTag: intentTag?.trim() || null,
      skinConcern,
      message: message.trim(),
      priority,
      status: initialStatus,
      suggestedReply,
      followUp1,
      followUp2,
      followUp3,
      utmSource: utmSource?.trim() || null,
      utmMedium: utmMedium?.trim() || null,
      utmCampaign: utmCampaign?.trim() || null,
      utmContent: utmContent?.trim() || null,
      utmTerm: utmTerm?.trim() || null,
    },
  })

  // Always send the admin alert with full lead details + suggested reply
  sendAndLogTelegramMessage(formatLeadTelegramMessage(lead), {
    type: 'lead',
    recordId: lead.id,
  }).catch(() => {})

  // Phase 6 — auto-send initial action message for DM leads immediately on creation.
  // Sets initialReplySentAt so the auto-trigger service won't re-fire for this lead.
  if (resolvedSourceType === 'dm' && lead.suggestedReply) {
    const sentAt = new Date()
    sendMessage({ lead, message: lead.suggestedReply, messageType: 'initial', triggerReason: 'initial_auto' })
      .then((result) =>
        prisma.lead.update({
          where: { id: lead.id },
          data: {
            initialMessageSent: true,
            initialReplySentAt: sentAt,
            lastMessageSentAt: sentAt,
            lastMessageChannel: result.channel,
            lastDeliveryChannel: result.channel,
            lastDeliveredAt: sentAt,
            lastDeliveryStatus: result.status,
          },
        }).catch(() => {})
      )
      .catch(() => {})
  }

  return lead
}

/**
 * Returns leads with optional search, status filter, source filter, and pagination.
 * Always returns newest first.
 */
async function getAllLeads({ search, status, source, sourceType, priority, intentTag, needsFollowUp, page = 1, limit = 20 } = {}) {
  const where = {}
  const andConditions = []

  // needsFollowUp: active leads with at least one follow-up slot that is due/overdue
  if (needsFollowUp) {
    const now = new Date()
    where.status = { in: ['new', 'contacted'] }
    andConditions.push({
      OR: [
        { followUp1: { lte: now }, followUp1Sent: false, followUp1SentAt: null },
        { followUp2: { lte: now }, followUp2Sent: false, followUp2SentAt: null },
        { followUp3: { lte: now }, followUp3Sent: false, followUp3SentAt: null },
      ],
    })
  } else if (status) {
    where.status = status
  }

  if (source) where.sourcePlatform = source
  if (sourceType) where.sourceType = sourceType
  if (priority && VALID_PRIORITIES.includes(priority)) where.priority = priority
  if (intentTag) where.intentTag = { contains: intentTag, mode: 'insensitive' }
  if (search) {
    andConditions.push({
      OR: [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ],
    })
  }

  if (andConditions.length > 0) {
    where.AND = andConditions
  }

  const skip = (page - 1) * limit

  const [total, data] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ])

  return { data, total, page, limit, pages: Math.ceil(total / limit) }
}

/**
 * Generates a personalised follow-up message body for a lead.
 * Exported so schedulerService can use the same copy.
 */
function generateFollowUpMessage(lead, followUpNumber) {
  const firstName = (lead.fullName || '').split(' ')[0] || 'there'
  const concern = (lead.skinConcern || 'skin concern').replace(/_/g, ' ')

  if (followUpNumber === 1) {
    return (
      `Hi ${firstName}! Just checking in on my earlier message — did you have any questions about your ${concern}? ` +
      `I'd love to help you find the right solution 🌿`
    )
  }
  if (followUpNumber === 2) {
    return (
      `Hey ${firstName}! Quick follow-up — we've helped so many clients with ${concern} and I'd hate for you to miss out. ` +
      `Can I share a quick result that might help? 💫`
    )
  }
  return (
    `Hi ${firstName}, this is my last follow-up. If you ever want to explore solutions for ${concern}, ` +
    `we're always here for you. Feel free to reach out anytime! 🙏`
  )
}

/**
 * Executes the initial reply send for a lead via Telegram relay.
 * Validates: not already sent, status not blocked.
 * On success: sets initialReplySentAt, lastMessageSentAt/Channel, advances status to contacted if new.
 */
async function sendInitialReply(id) {
  const lead = await prisma.lead.findUnique({ where: { id } })
  if (!lead) {
    const err = new Error('Lead not found')
    err.status = 404
    throw err
  }
  if (lead.initialReplySentAt) {
    const err = new Error('Initial reply already sent')
    err.status = 409
    throw err
  }
  if (STOP_STATUSES.includes(lead.status)) {
    const err = new Error(`Cannot send — lead status is ${lead.status}`)
    err.status = 422
    throw err
  }

  const message = lead.suggestedReply || generateSuggestedReply({
    intentTag: lead.intentTag,
    sourcePlatform: lead.sourcePlatform,
    sourceType: lead.sourceType,
    skinConcern: lead.skinConcern,
    fullName: lead.fullName,
  })

  const result = await sendMessage({ lead, message, messageType: 'initial', triggerReason: 'manual' })

  const now = new Date()
  return prisma.lead.update({
    where: { id },
    data: {
      initialReplySentAt: now,
      initialMessageSent: true,
      lastMessageSentAt: now,
      lastMessageChannel: result.channel,
      lastDeliveryChannel: result.channel,
      lastDeliveredAt: now,
      lastDeliveryStatus: result.status,
      ...(lead.status === 'new' ? { status: 'contacted' } : {}),
    },
  })
}

/**
 * Executes a scheduled follow-up send for a lead via Telegram relay.
 * Validates: scheduled, due, not already sent via CRM, status not blocked.
 * On success: sets followUpXSentAt, followUpXSent (bool), lastMessageSentAt/Channel.
 */
async function sendFollowUp(id, followUpNumber) {
  const fieldConfig = {
    1: { timeField: 'followUp1', sentAtField: 'followUp1SentAt', boolField: 'followUp1Sent', messageType: 'follow_up_1' },
    2: { timeField: 'followUp2', sentAtField: 'followUp2SentAt', boolField: 'followUp2Sent', messageType: 'follow_up_2' },
    3: { timeField: 'followUp3', sentAtField: 'followUp3SentAt', boolField: 'followUp3Sent', messageType: 'follow_up_3' },
  }
  const config = fieldConfig[followUpNumber]
  if (!config) {
    const err = new Error('Invalid follow-up number — must be 1, 2, or 3')
    err.status = 400
    throw err
  }

  const lead = await prisma.lead.findUnique({ where: { id } })
  if (!lead) {
    const err = new Error('Lead not found')
    err.status = 404
    throw err
  }

  const scheduledTime = lead[config.timeField]
  if (!scheduledTime) {
    const err = new Error(`Follow-up ${followUpNumber} is not scheduled for this lead`)
    err.status = 422
    throw err
  }
  if (lead[config.sentAtField]) {
    const err = new Error(`Follow-up ${followUpNumber} has already been sent`)
    err.status = 409
    throw err
  }
  if (STOP_STATUSES.includes(lead.status)) {
    const err = new Error(`Cannot send — lead status is ${lead.status}`)
    err.status = 422
    throw err
  }
  if (new Date(scheduledTime).getTime() > Date.now()) {
    const err = new Error(`Follow-up ${followUpNumber} is not due yet`)
    err.status = 422
    throw err
  }

  const message = generateFollowUpMessage(lead, followUpNumber)
  const result = await sendMessage({ lead, message, messageType: config.messageType, triggerReason: 'manual' })

  const now = new Date()
  return prisma.lead.update({
    where: { id },
    data: {
      [config.sentAtField]: now,
      [config.boolField]: true,
      lastMessageSentAt: now,
      lastMessageChannel: result.channel,
      lastDeliveryChannel: result.channel,
      lastDeliveredAt: now,
      lastDeliveryStatus: result.status,
    },
  })
}

/**
 * Updates the status of a lead by ID.
 */
async function updateLeadStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    const err = new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`)
    err.status = 400
    throw err
  }

  const existing = await prisma.lead.findUnique({ where: { id } })
  if (!existing) {
    const err = new Error('Lead not found')
    err.status = 404
    throw err
  }

  return prisma.lead.update({ where: { id }, data: { status } })
}

module.exports = { createLead, getAllLeads, updateLeadStatus, sendInitialReply, sendFollowUp, generateFollowUpMessage }
