const { Router } = require('express')
const { createRegistration, listRegistrations, updateRegistrationStatus } = require('../controllers/academyController')
const { selectPackage } = require('../controllers/paystackController')
const requireAuth = require('../middleware/requireAuth')

const router = Router()

// Public: form submission from the landing page
router.post('/register', createRegistration)

// Public: package selection after registration — saves package choice and returns Paystack link
router.post('/select-package', selectPackage)

// Protected: admin CRM access only
router.get('/registrations', requireAuth, listRegistrations)
router.patch('/registrations/:id/status', requireAuth, updateRegistrationStatus)

module.exports = router
