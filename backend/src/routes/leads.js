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
  scanPosts,
} = require('../controllers/leadsController')
const requireAuth = require('../middleware/requireAuth')
const prisma = require('../lib/prisma')

const router = Router()

// Public: form submission from the landing page
router.post('/', createLead)

// Protected: admin CRM access only
router.get('/', requireAuth, listLeads)

// Scan — must be declared before /:id routes so "scan" isn't treated as an id param
router.post('/scan', requireAuth, scanPosts)

router.patch('/:id/status', requireAuth, updateLeadStatus)

// Phase 6 — Phase 3: reply detected → set status to engaged, stops follow-ups
router.post('/:id/reply', requireAuth, markLeadAsEngaged)

// Auto Reply Execution Layer — CRM-triggered sends
router.post('/:id/send-initial-reply', requireAuth, executeSendInitialReply)
router.post('/:id/send-followup-1',    requireAuth, executeSendFollowUp1)
router.post('/:id/send-followup-2',    requireAuth, executeSendFollowUp2)
router.post('/:id/send-followup-3',    requireAuth, executeSendFollowUp3)

// ── Phase 29: Flow control (admin only) ──────────────────────────────────────

const ALLOWED_FLOWS = [
  'intake', 'awaiting_images', 'diagnosis_pending', 'diagnosis_sent',
  'product_quote_pending_review', 'product_quote_sent', 'product_paid',
  'fulfillment_pending', 'deep_consult_active', 'human_consult_pending',
  'academy_locked', 'closed',
]

router.patch('/:id/flow', requireAuth, async (req, res) => {
  const { flow, reason } = req.body

  if (!flow || !ALLOWED_FLOWS.includes(flow)) {
    return res.status(400).json({
      success: false,
      message: `flow must be one of: ${ALLOWED_FLOWS.join(', ')}`,
    })
  }

  try {
    const lead = await prisma.lead.findUnique({
      where:  { id: req.params.id },
      select: { currentFlow: true, id: true },
    })
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' })

    const fromFlow = lead.currentFlow

    const data = {
      currentFlow:         flow,
      lastFlowGuardReason: reason ? `admin: ${reason}` : 'forced by admin',
    }

    if (flow === 'academy_locked') {
      data.leadStage          = 'academy_locked'
      data.followupSuppressed = true
    } else if (flow === 'closed') {
      data.status             = 'closed'
      data.followupSuppressed = true
    } else if (flow === 'diagnosis_sent' || flow === 'intake') {
      // Reopening — clear suppression flags
      data.followupSuppressed = false
      if (lead.currentFlow === 'academy_locked') data.leadStage = 'new'
    }

    await prisma.lead.update({ where: { id: req.params.id }, data })

    prisma.flowEventLog.create({
      data: {
        leadId:    req.params.id,
        eventType: 'flow_forced_by_admin',
        fromFlow:  fromFlow || null,
        toFlow:    flow,
        reason:    reason || 'admin forced via CRM',
      },
    }).catch(() => {})

    const updated = await prisma.lead.findUnique({ where: { id: req.params.id } })
    return res.json({ success: true, lead: updated })
  } catch (err) {
    console.error('[FlowControl] update failed:', err.message)
    return res.status(500).json({ success: false, message: 'Failed to update lead flow' })
  }
})

// ── Deep Consultation sub-resource ───────────────────────────────────────────

// GET /api/leads/:id/deep-consult — fetch the latest deep consultation for a lead
router.get('/:id/deep-consult', requireAuth, async (req, res) => {
  try {
    const consult = await prisma.deepConsultation.findFirst({
      where:   { leadId: req.params.id },
      orderBy: { createdAt: 'desc' },
    })
    return res.json({ success: true, consultation: consult || null })
  } catch (err) {
    console.error('[DeepConsult] fetch failed:', err.message)
    return res.status(500).json({ success: false, message: 'Failed to fetch consultation' })
  }
})

// POST /api/leads/:id/deep-consult/mark-human-review — admin flags consult for human review
router.post('/:id/deep-consult/mark-human-review', requireAuth, async (req, res) => {
  const { reason } = req.body
  try {
    const consult = await prisma.deepConsultation.findFirst({
      where:   { leadId: req.params.id },
      orderBy: { createdAt: 'desc' },
    })
    if (!consult) {
      return res.status(404).json({ success: false, message: 'No consultation found for this lead' })
    }
    const updated = await prisma.deepConsultation.update({
      where: { id: consult.id },
      data:  {
        needsHumanReview:  true,
        humanReviewReason: reason || 'Flagged by admin',
      },
    })
    return res.json({ success: true, consultation: updated })
  } catch (err) {
    console.error('[DeepConsult] mark-human-review failed:', err.message)
    return res.status(500).json({ success: false, message: 'Failed to update consultation' })
  }
})

// POST /api/leads/:id/deep-consult/send-human-offer — send human consult offer via Telegram
router.post('/:id/deep-consult/send-human-offer', requireAuth, async (req, res) => {
  const { sendTelegramToUser } = require('../services/telegramService')
  const { buildConsultInterestReply } = require('../services/conversationBrainService')
  const LEAD_BOT_TOKEN = process.env.TELEGRAM_LEAD_BOT_TOKEN
  try {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' })
    if (!lead.telegramChatId) {
      return res.status(400).json({ success: false, message: 'Lead has no Telegram chat ID' })
    }
    const message = buildConsultInterestReply(lead)
    const result  = await sendTelegramToUser(lead.telegramChatId, message, LEAD_BOT_TOKEN)
    if (!result.success) {
      return res.status(500).json({ success: false, message: 'Telegram send failed', error: result.error })
    }
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        conversationMode:   'consult_active',
        lastBotIntent:      'human_consult_offer',
        lastMeaningfulBotAt: new Date(),
        consultOfferCount:  { increment: 1 },
      },
    })
    return res.json({ success: true })
  } catch (err) {
    console.error('[DeepConsult] send-human-offer failed:', err.message)
    return res.status(500).json({ success: false, message: 'Failed to send human consult offer' })
  }
})

// ── Skin image sub-resource ───────────────────────────────────────────────────

// GET /api/leads/:id/skin-images — list all images for a lead
router.get('/:id/skin-images', requireAuth, async (req, res) => {
  try {
    const images = await prisma.leadSkinImage.findMany({
      where:   { leadId: req.params.id },
      orderBy: { uploadedAt: 'asc' },
    })
    return res.json({ success: true, images })
  } catch (err) {
    console.error('[SkinImages] list failed:', err.message)
    return res.status(500).json({ success: false, message: 'Failed to fetch images' })
  }
})

// PATCH /api/leads/:id/skin-images/:imageId — admin updates status / notes
router.patch('/:id/skin-images/:imageId', requireAuth, async (req, res) => {
  const { status, notes } = req.body
  const allowed = ['uploaded', 'reviewed', 'rejected']

  if (status && !allowed.includes(status)) {
    return res.status(400).json({ success: false, message: `status must be one of: ${allowed.join(', ')}` })
  }

  try {
    const image = await prisma.leadSkinImage.update({
      where: { id: req.params.imageId },
      data:  {
        ...(status !== undefined ? { status } : {}),
        ...(notes  !== undefined ? { notes }  : {}),
      },
    })

    // If admin marked reviewed, check whether all images for this lead are reviewed
    if (status === 'reviewed') {
      const pending = await prisma.leadSkinImage.count({
        where: { leadId: req.params.id, status: { not: 'reviewed' } },
      })
      if (pending === 0) {
        await prisma.lead.update({
          where: { id: req.params.id },
          data:  { imageReviewStatus: 'reviewed' },
        })
      }
    }

    return res.json({ success: true, image })
  } catch (err) {
    console.error('[SkinImages] update failed:', err.message)
    return res.status(500).json({ success: false, message: 'Failed to update image' })
  }
})

module.exports = router
