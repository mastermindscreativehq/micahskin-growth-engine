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

module.exports = router
