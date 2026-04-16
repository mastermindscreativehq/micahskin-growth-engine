'use strict'

const express    = require('express')
const { trackEvent } = require('../services/conversionService')
const {
  sendManualConversionAction,
  buildCustomConversionContext,
} = require('../services/conversionEngineService')
const requireAuth = require('../middleware/requireAuth')

const router  = express.Router()
const VALID_TYPES = new Set(['academy_click', 'consult_click', 'academy_signup', 'academy_paid'])
const VALID_ACTION_TYPES = new Set(['product_offer', 'consult_offer', 'academy_offer', 'resend_payment', 'custom_message'])

// ── Public: conversion event tracking ────────────────────────────────────────

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

// ── Protected: manual CRM override actions ────────────────────────────────────

/**
 * POST /api/conversion/manual-action
 *
 * Send a conversion offer immediately from the CRM, bypassing scheduling.
 *
 * Body: {
 *   leadId:     string,
 *   actionType: 'product_offer' | 'consult_offer' | 'academy_offer' | 'resend_payment',
 *   adminName?: string,
 *   note?:      string,
 * }
 */
router.post('/manual-action', requireAuth, async (req, res) => {
  try {
    const { leadId, actionType, adminName, note } = req.body

    if (!leadId || !actionType) {
      return res.status(400).json({ success: false, message: 'leadId and actionType are required' })
    }
    if (!VALID_ACTION_TYPES.has(actionType)) {
      return res.status(400).json({ success: false, message: `Invalid actionType "${actionType}"` })
    }
    if (actionType === 'custom_message') {
      return res.status(400).json({
        success: false,
        message: 'Use POST /api/conversion/custom-message for custom messages',
      })
    }

    const result = await sendManualConversionAction({
      leadId,
      actionType,
      adminName: adminName || 'admin',
      note:      note || '',
    })

    if (!result.success) {
      return res.status(result.blocked === 'lead_not_found' ? 404 : 422).json({
        success: false,
        message: result.message || result.blocked,
        blocked: result.blocked,
      })
    }

    return res.json({
      success:     true,
      sentPreview: result.sentPreview,
    })
  } catch (err) {
    console.error('[conversionRoutes] POST /manual-action error:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
})

/**
 * POST /api/conversion/resend-payment-link
 *
 * Resend the academy payment / registration link to a lead.
 *
 * Body: { leadId: string, adminName?: string, note?: string }
 */
router.post('/resend-payment-link', requireAuth, async (req, res) => {
  try {
    const { leadId, adminName, note } = req.body

    if (!leadId) {
      return res.status(400).json({ success: false, message: 'leadId is required' })
    }

    const result = await sendManualConversionAction({
      leadId,
      actionType: 'resend_payment',
      adminName:  adminName || 'admin',
      note:       note || '',
    })

    if (!result.success) {
      return res.status(result.blocked === 'lead_not_found' ? 404 : 422).json({
        success: false,
        message: result.message || result.blocked,
        blocked: result.blocked,
      })
    }

    return res.json({ success: true, sentPreview: result.sentPreview })
  } catch (err) {
    console.error('[conversionRoutes] POST /resend-payment-link error:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
})

/**
 * POST /api/conversion/custom-message
 *
 * Send a custom operator-written conversion message to a lead immediately.
 *
 * Body: { leadId: string, message: string, adminName?: string, note?: string }
 */
router.post('/custom-message', requireAuth, async (req, res) => {
  try {
    const { leadId, message, adminName, note } = req.body

    if (!leadId || !message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'leadId and message are required' })
    }

    const result = await sendManualConversionAction({
      leadId,
      actionType:    'custom_message',
      adminName:     adminName || 'admin',
      note:          note || '',
      customMessage: message,
    })

    if (!result.success) {
      return res.status(result.blocked === 'lead_not_found' ? 404 : 422).json({
        success: false,
        message: result.message || result.blocked,
        blocked: result.blocked,
      })
    }

    return res.json({ success: true, sentPreview: result.sentPreview })
  } catch (err) {
    console.error('[conversionRoutes] POST /custom-message error:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
})

/**
 * GET /api/conversion/context/:leadId
 *
 * Returns a pre-filled custom message draft seeded with lead context.
 * Used by the CRM "Send Custom Message" modal to pre-populate the textarea.
 */
router.get('/context/:leadId', requireAuth, async (req, res) => {
  try {
    const prisma = require('../lib/prisma')
    const lead = await prisma.lead.findUnique({ where: { id: req.params.leadId } })
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' })
    }

    const draft = buildCustomConversionContext(lead)
    return res.json({ success: true, draft })
  } catch (err) {
    console.error('[conversionRoutes] GET /context error:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router
