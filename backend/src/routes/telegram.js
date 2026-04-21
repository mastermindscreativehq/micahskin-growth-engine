const { Router } = require('express')
const { handleLeadWebhook, handleAcademyWebhook } = require('../controllers/telegramController')

const router = Router()

// Public — Telegram Bot API POSTs updates here.
// Each bot must be registered to its own path via setWebhook.
router.post('/webhook/lead',    handleLeadWebhook)
router.post('/webhook/academy', handleAcademyWebhook)

module.exports = router
