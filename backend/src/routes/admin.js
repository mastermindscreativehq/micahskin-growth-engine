'use strict'

const { Router }       = require('express')
const requireAuth      = require('../middleware/requireAuth')
const { getCommandCenter } = require('../services/commandCenterService')

const router = Router()
router.use(requireAuth)

// GET /api/admin/command-center
// Aggregates all operator-facing priorities into a single payload.
// Read-only — no mutations.
router.get('/command-center', async (req, res) => {
  try {
    const data = await getCommandCenter()
    res.json({ success: true, data })
  } catch (err) {
    console.error('[Admin] GET /command-center:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router
