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
const {
  listOutreachQueue,
  updateOutreachStatus,
  getOutreachCounts,
} = require('../services/outreachQueueService')

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
        leadSources: {
          scrapedToday: 0, highIntentToday: 0, pendingOutreach: 0, processedTotal: 0, totalScraped: 0,
          nigerianTotal: 0, highHeatTotal: 0,
          academyLeadCount: 0, consultLeadCount: 0,
          segmentBreakdown: [], cityBreakdown: [],
          rejectionBreakdown: [], painBreakdownByConcern: [],
          engineStatus: 'idle',
          acquisitionStatus: {
            state: 'idle', running: false, pendingRunId: null,
            runStartedAt: null, lastRunAt: null, lastRunFinishedAt: null,
            lastStatus: null, stale: false,
            // Phase 35 — credit protection + pain-point fields
            mode: 'pain_point_first', intervalHours: 6, maxItemsPerRun: 100,
            creditsProtection: 'active', nextRunAt: null, itemsThisCycle: 0,
            lastBatch: null, recentBatchesBlocked: 0,
          },
        },
        // Phase 34 (MCE) — fallback shape so frontend never breaks
        mce: {
          funnel:     { summary: [], totalRevenue: 0 },
          whatsapp:   { totalClicks: 0, uniqueLeadsClicked: 0, clicksLast24h: 0, ctaGenerated: 0, clickRatePct: 0, byFunnel: { product: 0, consult: 0, academy: 0, reseller: 0 } },
          objections: { days: 30, summary: [], totalObjections: 0 },
          cities:     [],
          followUps:  { oneHourDue: 0, sixHourObjectionDue: 0, twentyFourDue: 0, threeDayDue: 0, total: 0, paused: false },
        },
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
// Body / query: { country: 'NG' | 'GH' | 'KE' | 'ZA' }  (default NG)
router.post('/acquisition/trigger', async (req, res) => {
  try {
    const country = req.body?.country || req.query?.country || 'NG'
    // Fire-and-forget — cycle is async, client gets immediate ack
    runAcquisitionCycle({ country }).catch(err =>
      console.error('[Admin] Acquisition trigger error:', err.message)
    )
    res.json({ success: true, message: `Acquisition cycle triggered (country=${country})`, country })
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

// ── Phase 36 — Human-Assisted Outreach Queue ──────────────────────────────
// GET /api/admin/outreach-queue?status=pending&temperature=all&commentsOnly=true&limit=100
router.get('/outreach-queue', async (req, res) => {
  try {
    const { status, temperature, commentsOnly, limit, minScore } = req.query
    const items = await listOutreachQueue({
      status,
      temperature,
      commentsOnly: commentsOnly === undefined ? true : commentsOnly !== 'false',
      limit:        limit ? Number(limit) : undefined,
      minScore:     minScore !== undefined ? Number(minScore) : undefined,
    })
    const counts = await getOutreachCounts()
    res.json({ success: true, data: { items, counts } })
  } catch (err) {
    console.error('[Admin] GET /outreach-queue:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
})

// PATCH /api/admin/outreach-queue/:id  body: { status, operator? }
router.patch('/outreach-queue/:id', async (req, res) => {
  try {
    const updated = await updateOutreachStatus(req.params.id, {
      status:   req.body?.status,
      operator: req.body?.operator || req.session?.user?.email || null,
    })
    res.json({ success: true, data: updated })
  } catch (err) {
    const code = err.status || 500
    console.error('[Admin] PATCH /outreach-queue:', err.message)
    res.status(code).json({ success: false, message: err.message })
  }
})

module.exports = router
