const prisma = require('../lib/prisma')
const { sendAndLogTelegramMessage, formatAcademyTelegramMessage } = require('./telegramService')
const { normalizePhoneNumber } = require('../utils/phoneUtils')

const VALID_PLATFORMS = ['TikTok', 'Instagram', 'Other']
const VALID_LEVELS = ['beginner', 'intermediate', 'advanced']
const VALID_SOURCE_TYPES = ['bio_form', 'dm', 'comment', 'story_reply', 'manual']
const VALID_STATUSES = ['new', 'contacted', 'paid', 'onboarded', 'closed']

/**
 * Validates and creates a new academy registration.
 */
async function createRegistration(data) {
  const errors = []

  const {
    fullName, email, phone, businessType, experienceLevel, goals, sourcePlatform,
    sourceType, handle, campaign,
    utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
  } = data

  if (!fullName || typeof fullName !== 'string' || fullName.trim() === '') {
    errors.push('fullName is required')
  }

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    errors.push('A valid email is required')
  }

  if (!sourcePlatform || !VALID_PLATFORMS.includes(sourcePlatform)) {
    errors.push(`sourcePlatform must be one of: ${VALID_PLATFORMS.join(', ')}`)
  }

  if (!experienceLevel || !VALID_LEVELS.includes(experienceLevel)) {
    errors.push(`experienceLevel must be one of: ${VALID_LEVELS.join(', ')}`)
  }

  if (!goals || typeof goals !== 'string' || goals.trim() === '') {
    errors.push('goals is required')
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

  const resolvedSourceType = sourceType && VALID_SOURCE_TYPES.includes(sourceType) ? sourceType : null

  const registration = await prisma.academyRegistration.create({
    data: {
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: normalizedPhone,
      businessType: businessType?.trim() || null,
      experienceLevel,
      goals: goals.trim(),
      sourcePlatform,
      sourceType: resolvedSourceType,
      handle: handle?.trim() || null,
      campaign: campaign?.trim() || null,
      utmSource: utmSource?.trim() || null,
      utmMedium: utmMedium?.trim() || null,
      utmCampaign: utmCampaign?.trim() || null,
      utmContent: utmContent?.trim() || null,
      utmTerm: utmTerm?.trim() || null,
    },
  })

  sendAndLogTelegramMessage(formatAcademyTelegramMessage(registration), {
    type: 'academy',
    recordId: registration.id,
  }).catch(() => {})

  return registration
}

/**
 * Returns registrations with optional search, status filter, and pagination.
 * Always returns newest first.
 */
async function getAllRegistrations({ search, status, source, sourceType, page = 1, limit = 20 } = {}) {
  const where = {}

  if (status) where.status = status
  if (source) where.sourcePlatform = source
  if (sourceType) where.sourceType = sourceType
  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
    ]
  }

  const skip = (page - 1) * limit

  const [total, data] = await Promise.all([
    prisma.academyRegistration.count({ where }),
    prisma.academyRegistration.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ])

  return { data, total, page, limit, pages: Math.ceil(total / limit) }
}

/**
 * Updates the status of a registration by ID.
 */
async function updateRegistrationStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    const err = new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`)
    err.status = 400
    throw err
  }

  const existing = await prisma.academyRegistration.findUnique({ where: { id } })
  if (!existing) {
    const err = new Error('Registration not found')
    err.status = 404
    throw err
  }

  return prisma.academyRegistration.update({ where: { id }, data: { status } })
}

module.exports = { createRegistration, getAllRegistrations, updateRegistrationStatus }
