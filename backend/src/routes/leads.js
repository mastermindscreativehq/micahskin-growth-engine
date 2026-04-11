const { Router } = require('express')
const {
  createLead,
  listLeads,
  updateLeadStatus,
  markLeadAsEngaged,
  executeSendInitialReply,
  executeSendFollowUp1,
  executeSendFollowUp2,
  executeSendFollowUp3,
} = require('../controllers/leadsController')
const requireAuth = require('../middleware/requireAuth')

const router = Router()

// Public: form submission from the landing page
router.post('/', createLead)

// Protected: admin CRM access only
router.get('/', requireAuth, listLeads)
router.patch('/:id/status', requireAuth, updateLeadStatus)

// Phase 6 — Phase 3: reply detected → set status to engaged, stops follow-ups
// Can later be called by a Telegram/IG webhook (swap requireAuth for token-based auth)
router.post('/:id/reply', requireAuth, markLeadAsEngaged)

// Auto Reply Execution Layer — CRM-triggered sends
router.post('/:id/send-initial-reply', requireAuth, executeSendInitialReply)
router.post('/:id/send-followup-1',    requireAuth, executeSendFollowUp1)
router.post('/:id/send-followup-2',    requireAuth, executeSendFollowUp2)
router.post('/:id/send-followup-3',    requireAuth, executeSendFollowUp3)

module.exports = router
