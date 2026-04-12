const { Router } = require('express')
const { handleWebhook } = require('../controllers/telegramController')

const router = Router()

// Public — Telegram Bot API POSTs updates here.
// Verify the request is from Telegram by checking a secret token in the URL
// via setWebhook?secret_token=... if you want extra security in future.
router.post('/webhook', handleWebhook)

module.exports = router
