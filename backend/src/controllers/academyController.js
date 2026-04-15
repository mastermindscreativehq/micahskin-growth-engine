const academyService = require('../services/academyService')
const prisma = require('../lib/prisma')
const { buildAcademyTelegramStartLink } = require('../services/telegramService')

async function createRegistration(req, res) {
  try {
    const registration = await academyService.createRegistration(req.body)
    return res.status(201).json({ success: true, data: registration })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      message: err.message,
      errors: err.errors || [],
    })
  }
}

async function listRegistrations(req, res) {
  try {
    const { search, status, source, sourceType, page, limit } = req.query
    const result = await academyService.getAllRegistrations({
      search: search || undefined,
      status: status || undefined,
      source: source || undefined,
      sourceType: sourceType || undefined,
      page: page ? Math.max(1, parseInt(page, 10)) : 1,
      limit: limit ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 20,
    })
    return res.json({ success: true, ...result })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch registrations' })
  }
}

async function updateRegistrationStatus(req, res) {
  try {
    const { id } = req.params
    const { status } = req.body
    if (!status) {
      return res.status(400).json({ success: false, message: 'status is required' })
    }
    const registration = await academyService.updateRegistrationStatus(id, status)
    return res.json({ success: true, data: registration })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({ success: false, message: err.message })
  }
}

/**
 * GET /api/academy/access/:id
 * Public — returns the Telegram deep link ONLY when paymentStatus === 'paid'.
 * Used by the /academy/success page to gate Telegram access behind confirmed payment.
 */
async function getAcademyAccess(req, res) {
  try {
    const { id } = req.params
    const registration = await prisma.academyRegistration.findUnique({ where: { id } })
    if (!registration) {
      return res.status(404).json({ success: false, message: 'Registration not found' })
    }
    if (registration.paymentStatus !== 'paid') {
      return res.json({ success: true, paid: false })
    }
    const telegramBotLink = buildAcademyTelegramStartLink(registration.id)
    return res.json({
      success: true,
      paid: true,
      telegramBotLink,
      fullName: registration.fullName,
      package: registration.academyPackage,
    })
  } catch (err) {
    console.error('[academy-access]', err)
    return res.status(500).json({ success: false, message: 'Failed to verify access' })
  }
}

module.exports = { createRegistration, listRegistrations, updateRegistrationStatus, getAcademyAccess }
