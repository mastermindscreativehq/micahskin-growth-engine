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
