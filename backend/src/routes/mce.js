'use strict'

/**
 * routes/mce.js — Phase 34 (MCE)
 *
 * The WhatsApp redirect is PUBLIC — it must work without an admin session
 * because leads click it from social bios, dashboards, and emails.
 * Everything else is admin-protected.
 */

const { Router } = require('express')
const requireAuth = require('../middleware/requireAuth')
const ctrl = require('../controllers/mceController')

const router = Router()

// ── PUBLIC: lead-facing redirect ─────────────────────────────────────────────
router.get('/whatsapp/redirect/:leadId', ctrl.redirectWhatsAppClick)

// ── PROTECTED: admin endpoints ───────────────────────────────────────────────
router.use(requireAuth)

router.get('/timeline/:leadId',          ctrl.getTimeline)
router.get('/whatsapp/stats',            ctrl.getWhatsAppStats)
router.post('/whatsapp/cta/:leadId',     ctrl.regenerateCta)
router.post('/router/reassign/:leadId',  ctrl.reassignRoute)

router.get('/funnel/stats',              ctrl.getFunnelStats)
router.get('/objections/top',            ctrl.getTopObjections)
router.get('/cities/breakdown',          ctrl.getCityBreakdown)

router.get('/follow-ups/status',         ctrl.getFollowUpStatus)
router.post('/follow-ups/pause',         ctrl.pauseFollowUps)
router.post('/follow-ups/resume',        ctrl.resumeFollowUps)

module.exports = router
