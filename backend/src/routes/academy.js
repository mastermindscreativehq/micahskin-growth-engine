const { Router } = require('express')
const {
  createRegistration,
  listRegistrations,
  updateRegistrationStatus,
  getAcademyAccess,
  updateImplementationDelivery,
  updateImplementationTasks,
  syncAcademyEvent,
} = require('../controllers/academyController')
const { selectPackage } = require('../controllers/paystackController')
const requireAuth = require('../middleware/requireAuth')

const router = Router()

// Middleware: validates x-sync-secret header for n8n webhook calls
function requireSyncSecret(req, res, next) {
  const secret = process.env.ACADEMY_SYNC_SECRET
  if (!secret) {
    console.warn('[AcademySync] ACADEMY_SYNC_SECRET not set — skipping auth (dev only)')
    return next()
  }
  const provided = req.headers['x-sync-secret']
  if (!provided || provided !== secret) {
    return res.status(401).json({ success: false, message: 'Unauthorized' })
  }
  next()
}

// Public: form submission from the landing page
router.post('/register', createRegistration)

// Public: package selection after registration — saves package choice and returns Paystack link
router.post('/select-package', selectPackage)

// Public: verify payment status and return Telegram link only if paid
router.get('/access/:id', getAcademyAccess)

// Protected: admin CRM access only
router.get('/registrations', requireAuth, listRegistrations)
router.patch('/registrations/:id/status', requireAuth, updateRegistrationStatus)

// Protected: premium delivery pipeline admin controls
router.patch('/registrations/:id/delivery', requireAuth, updateImplementationDelivery)
router.patch('/registrations/:id/tasks', requireAuth, updateImplementationTasks)

// n8n sync: receives academy lifecycle events and updates Lead CRM fields
// Auth: x-sync-secret header must match ACADEMY_SYNC_SECRET env var
router.post('/sync', requireSyncSecret, syncAcademyEvent)

module.exports = router
