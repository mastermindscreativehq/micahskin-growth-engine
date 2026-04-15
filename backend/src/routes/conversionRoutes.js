'use strict'

const express = require('express')
const { trackEvent } = require('../services/conversionService')

const router  = express.Router()
const VALID_TYPES = new Set(['academy_click', 'consult_click', 'academy_signup', 'academy_paid'])

/**
 * POST /api/conversion/track
 *
 * Body: { leadId: string, type: string, value?: number }
 * Public — no auth required (leadId acts as the identifier).
 */
router.post('/track', async (req, res) => {
  try {
    const { leadId, type, value } = req.body

    if (!leadId || !type) {
      return res.status(400).json({ success: false, message: 'leadId and type are required' })
    }
    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ success: false, message: `Invalid type "${type}"` })
    }

    await trackEvent({ leadId, type, value: value != null ? Number(value) : undefined })
    return res.json({ success: true })
  } catch (err) {
    console.error('[conversionRoutes] POST /track error:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router
