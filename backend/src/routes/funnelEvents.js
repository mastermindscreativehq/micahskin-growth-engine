'use strict'

const { Router } = require('express')
const { logFunnelEvent, ALLOWED_EVENT_TYPES } = require('../services/funnelEventService')

const router = Router()

// Public — fired from the public frontend (assessment + bundle pages).
// Best-effort by convention on the frontend side; validated here so junk
// event names never land in the log.
router.post('/track', async (req, res) => {
  const { eventType, leadId, sessionId, bundleId, value, metadata } = req.body || {}

  if (!eventType || !ALLOWED_EVENT_TYPES.has(eventType)) {
    return res.status(400).json({
      success: false,
      message: `eventType must be one of: ${[...ALLOWED_EVENT_TYPES].join(', ')}`,
    })
  }

  await logFunnelEvent({ eventType, leadId, sessionId, bundleId, value, metadata })
  return res.json({ success: true })
})

module.exports = router
