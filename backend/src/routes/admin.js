'use strict'

const { Router }           = require('express')
const requireAuth          = require('../middleware/requireAuth')
const { getCommandCenter } = require('../services/commandCenterService')
const {
  countFollowUpsDue,
  pauseFollowUps,
  resumeFollowUps,
  isFollowUpsPaused,
} = require('../services/autoFollowUpService')
const {
  runAcquisitionCycle,
  getAcquisitionStats,
} = require('../services/leadAcquisitionService')

const router = Router()
router.use(requireAuth)

// GET /api/admin/command-center
// Always returns 200 — sections failing are isolated by safeSection() and carry an error field.
router.get('/command-center', async (req, res) => {
  try {
    const data = await getCommandCenter()
    res.json({ success: true, data })
  } catch (err) {
    // Should not reach here because getCommandCenter uses safeSection throughout,
    // but guard anyway so the frontend always gets a usable payload.
    console.error('[Admin] GET /command-center unexpected crash:', err.message)
    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        _criticalError: err.message,
        revenue:     { productRevenue: 0, academyRevenue: 0, consultRevenue: 0, unpaidQuoteTotal: 0, paidPendingFulfillmentTotal: 0 },
        leadQueue:   { hotProductLeads: { count: 0, leads: [] }, deepConsultActive: 0, humanReviewNeeded: 0, abandonedPayment: { count: 0, leads: [] }, academyLocked: { count: 0, leads: [] }, stuckFlows: { count: 0, leads: [] } },
        fulfillment: { awaitingAddress: 0, pendingFulfillment: 0, packed: 0, delivered: 0, cancelled: 0 },
        consults:    { activeDeepConsults: { count: 0, items: [] }, completedNeedingReview: { count: 0, items: [] }, redFlagLeads: { count: 0, items: [] }, completedNoProductAction: 0 },
        alerts:      { failedTelegramSends: 0, quotePendingTooLong: { count: 0, quotes: [] }, diagnosisPendingTooLong: { count: 0, leads: [] }, noProductMatches: { count: 0, leads: [] }, stuckCurrentFlow: { count: 0, leads: [] } },
        followUps:   { total: 0, paused: false, quoteDue: 0, pendingDue: 0, consultDue: 0, diagnosisDue: 0, abandonedDue: 0 },
        leadSources: { scrapedToday: 0, highIntentToday: 0, pendingOutreach: 0, processedTotal: 0, totalScraped: 0, engineStatus: 'idle' },
      },
    })
  }
})

// GET /api/admin/follow-ups/status
router.get('/follow-ups/status', async (req, res) => {
  try {
    const counts = await countFollowUpsDue()
    res.json({ success: true, data: counts })
  } catch (err) {
    console.error('[Admin] GET /follow-ups/status:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /api/admin/follow-ups/pause
router.post('/follow-ups/pause', (req, res) => {
  pauseFollowUps()
  res.json({ success: true, paused: true })
})

// POST /api/admin/follow-ups/resume
router.post('/follow-ups/resume', (req, res) => {
  resumeFollowUps()
  res.json({ success: true, paused: false })
})

// POST /api/admin/acquisition/trigger — manual one-off scrape cycle
router.post('/acquisition/trigger', async (req, res) => {
  try {
    // Fire-and-forget — cycle is async, client gets immediate ack
    runAcquisitionCycle().catch(err =>
      console.error('[Admin] Acquisition trigger error:', err.message)
    )
    res.json({ success: true, message: 'Acquisition cycle triggered' })
  } catch (err) {
    console.error('[Admin] POST /acquisition/trigger:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
})

// GET /api/admin/acquisition/stats
router.get('/acquisition/stats', async (req, res) => {
  try {
    const stats = await getAcquisitionStats()
    res.json({ success: true, data: stats })
  } catch (err) {
    console.error('[Admin] GET /acquisition/stats:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router
