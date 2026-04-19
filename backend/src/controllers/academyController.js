const academyService = require('../services/academyService')
const academySyncService = require('../services/academySyncService')
const academyOperatorService = require('../services/academyOperatorService')
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

/**
 * PATCH /api/academy/registrations/:id/delivery
 * Admin can update delivery pipeline fields.
 * Accepted: implementationStage, implementationStatus, systemSetupStatus,
 *           deliveryNotes, deliveryOwner, implementationCallBooked,
 *           implementationCallBookedAt, deliveryCompletedAt
 */
async function updateImplementationDelivery(req, res) {
  try {
    const { id } = req.params
    const ALLOWED = [
      'implementationStage',
      'implementationStatus',
      'systemSetupStatus',
      'deliveryNotes',
      'deliveryOwner',
      'implementationCallBooked',
      'implementationCallBookedAt',
      'deliveryCompletedAt',
    ]
    const data = {}
    for (const key of ALLOWED) {
      if (key in req.body) data[key] = req.body[key]
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields provided' })
    }
    // Auto-timestamps
    if (data.implementationStage === 'delivered' && !data.deliveryCompletedAt) {
      data.deliveryCompletedAt = new Date()
      console.log(`[PremiumDelivery] delivery completed — registration ${id}`)
    }
    if (data.implementationCallBooked === true && !data.implementationCallBookedAt) {
      data.implementationCallBookedAt = new Date()
      console.log(`[PremiumDelivery] strategy call booked — registration ${id}`)
    }
    const registration = await prisma.academyRegistration.update({
      where: { id },
      data,
    })
    return res.json({ success: true, data: registration })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
}

/**
 * PATCH /api/academy/registrations/:id/tasks
 * Admin can toggle task flags.
 * Accepted: taskIntakeReviewed, taskScopeReady, taskCallBooked,
 *           taskBuildStarted, taskDeliveryComplete
 */
async function updateImplementationTasks(req, res) {
  try {
    const { id } = req.params
    const TASK_FIELDS = [
      'taskIntakeReviewed',
      'taskScopeReady',
      'taskCallBooked',
      'taskBuildStarted',
      'taskDeliveryComplete',
    ]
    const data = {}
    for (const key of TASK_FIELDS) {
      if (key in req.body && typeof req.body[key] === 'boolean') {
        data[key] = req.body[key]
      }
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid task fields provided' })
    }
    const registration = await prisma.academyRegistration.update({ where: { id }, data })
    return res.json({ success: true, data: registration })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
}

/**
 * POST /api/academy/sync
 * Called by n8n when academy events occur (joined, lesson progress, CTA, inactive).
 * Auth: x-sync-secret header matched against ACADEMY_SYNC_SECRET env var.
 */
async function syncAcademyEvent(req, res) {
  try {
    const { telegram_id, invite_code, event_type, phone, lesson_id } = req.body
    const result = await academySyncService.syncAcademyEvent({
      telegram_id,
      invite_code,
      event_type,
      phone,
      lesson_id,
    })
    return res.json({ success: true, data: result })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({ success: false, message: err.message })
  }
}

/**
 * POST /api/academy/registrations/:id/operator/:action
 * Admin manual override actions for academy members.
 *
 * Actions: resend-lesson | unlock-next | pause | resume |
 *          complete-lesson | graduate | revoke
 */
async function academyOperatorAction(req, res) {
  const { id, action } = req.params
  const VALID_ACTIONS = {
    'resend-lesson':    academyOperatorService.resendCurrentLesson,
    'unlock-next':      academyOperatorService.unlockNextLesson,
    'pause':            academyOperatorService.pauseProgression,
    'resume':           academyOperatorService.resumeProgression,
    'complete-lesson':  academyOperatorService.markLessonComplete,
    'graduate':         academyOperatorService.graduateMember,
    'revoke':           academyOperatorService.revokeAccess,
  }

  const fn = VALID_ACTIONS[action]
  if (!fn) {
    return res.status(400).json({ success: false, message: `Unknown action: ${action}` })
  }

  try {
    const data = await fn(id)
    console.log(`[AcademyOperator] action=${action} reg=${id}`)
    return res.json({ success: true, data })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({ success: false, message: err.message })
  }
}

module.exports = {
  createRegistration,
  listRegistrations,
  updateRegistrationStatus,
  getAcademyAccess,
  updateImplementationDelivery,
  updateImplementationTasks,
  syncAcademyEvent,
  academyOperatorAction,
}
