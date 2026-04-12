const { Router } = require('express')
const { paystackWebhook } = require('../controllers/paystackController')

const router = Router()

// Public — Paystack calls this after a successful charge
router.post('/webhook', paystackWebhook)

module.exports = router
