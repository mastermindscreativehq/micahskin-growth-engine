const { Router } = require('express')
const { receiveReply, listReplies } = require('../controllers/repliesController')
const requireAuth = require('../middleware/requireAuth')

const router = Router()

// Public: webhook or manual CRM entry — receives a reply from a lead
// (When a Telegram/IG webhook is wired up, swap requireAuth for token-based auth here)
router.post('/', receiveReply)

// Protected: admin CRM — view all replies for a lead
router.get('/', requireAuth, listReplies)

module.exports = router
