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
router.get('/command-center', async (req, res) => {
  try {
    const data = await getCommandCenter()
    res.json({ success: true, data })
  } catch (err) {
    console.error('[Admin] GET /command-center:', err.message)
    res.status(500).json({ success: false, message: err.message })
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
