'use strict'

/**
 * mceController.js — Phase 34 (MCE)
 *
 * Thin HTTP layer over the MCE services. Two route classes:
 *
 *   PUBLIC (no auth)
 *     GET /api/mce/whatsapp/redirect/:leadId  — track click + 302 to wa.me URL
 *
 *   PROTECTED (admin session required — applied at the router layer)
 *     GET  /api/mce/timeline/:leadId          — per-lead event timeline
 *     GET  /api/mce/whatsapp/stats            — click stats summary
 *     GET  /api/mce/funnel/stats              — funnel attribution summary
 *     GET  /api/mce/objections/top            — top objections last 30d
 *     GET  /api/mce/cities/breakdown          — city × funnel breakdown
 *     POST /api/mce/whatsapp/cta/:leadId      — regenerate the lead's CTA
 *     POST /api/mce/router/reassign/:leadId   — re-run the router on a lead
 *     POST /api/mce/follow-ups/pause          — pause MCE follow-up engine
 *     POST /api/mce/follow-ups/resume         — resume MCE follow-up engine
 *     GET  /api/mce/follow-ups/status         — due-counts + paused state
 */

const prisma = require('../lib/prisma')
const whatsappBridge   = require('../services/mce/whatsappBridgeService')
const leadTimeline     = require('../services/mce/leadTimelineService')
const funnelAttribution = require('../services/mce/funnelAttributionService')
const conversationRouter = require('../services/mce/conversationRouter')
const mceFollowUp      = require('../services/mce/mceFollowUpService')

// ── PUBLIC: WhatsApp click redirect ──────────────────────────────────────────

async function redirectWhatsAppClick(req, res) {
  const { leadId } = req.params
  if (!leadId) {
    return res.status(400).send('Missing leadId')
  }

  try {
    const url = await whatsappBridge.trackClick(leadId)
    if (!url) {
      return res.status(404).send('Lead not found or CTA unavailable')
    }
    return res.redirect(302, url)
  } catch (err) {
    console.error('[MCE/Controller] redirectWhatsAppClick error:', err.message)
    return res.status(500).send('Server error')
  }
}

// ── PROTECTED: per-lead timeline ─────────────────────────────────────────────

async function getTimeline(req, res) {
  const { leadId } = req.params
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500)
  try {
    const events = await leadTimeline.listForLead(leadId, { limit })
    res.json({ success: true, data: events })
  } catch (err) {
    console.error('[MCE/Controller] getTimeline error:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
}

// ── PROTECTED: WhatsApp stats ────────────────────────────────────────────────

async function getWhatsAppStats(_req, res) {
  try {
    const data = await whatsappBridge.getClickStats()
    res.json({ success: true, data })
  } catch (err) {
    console.error('[MCE/Controller] getWhatsAppStats error:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
}

// ── PROTECTED: regenerate CTA for a lead ────────────────────────────────────

async function regenerateCta(req, res) {
  const { leadId } = req.params
  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } })
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' })
    const generated = await whatsappBridge.generateAndStoreCta(lead)
    res.json({ success: true, data: generated })
  } catch (err) {
    console.error('[MCE/Controller] regenerateCta error:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
}

// ── PROTECTED: re-run conversation router on a lead ─────────────────────────

async function reassignRoute(req, res) {
  const { leadId } = req.params
  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } })
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' })
    const route = await conversationRouter.assign(lead, {
      inboundText: req.body?.inboundText || '',
    })
    res.json({ success: true, data: route })
  } catch (err) {
    console.error('[MCE/Controller] reassignRoute error:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
}

// ── PROTECTED: funnel + objection + city stats ───────────────────────────────

async function getFunnelStats(_req, res) {
  try {
    const data = await funnelAttribution.getFunnelStats()
    res.json({ success: true, data })
  } catch (err) {
    console.error('[MCE/Controller] getFunnelStats error:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
}

async function getTopObjections(req, res) {
  const days  = Math.min(parseInt(req.query.days,  10) || 30, 365)
  const limit = Math.min(parseInt(req.query.limit, 10) || 10,  50)
  try {
    const data = await funnelAttribution.getTopObjections({ days, limit })
    res.json({ success: true, data })
  } catch (err) {
    console.error('[MCE/Controller] getTopObjections error:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
}

async function getCityBreakdown(req, res) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50)
  try {
    const data = await funnelAttribution.getCityFunnelBreakdown({ limit })
    res.json({ success: true, data })
  } catch (err) {
    console.error('[MCE/Controller] getCityBreakdown error:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
}

// ── PROTECTED: MCE follow-up controls ────────────────────────────────────────

async function getFollowUpStatus(_req, res) {
  try {
    const data = await mceFollowUp.countMceDue()
    res.json({ success: true, data })
  } catch (err) {
    console.error('[MCE/Controller] getFollowUpStatus error:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
}

function pauseFollowUps(_req, res) {
  mceFollowUp.pauseMceFollowUps()
  res.json({ success: true, paused: true })
}

function resumeFollowUps(_req, res) {
  mceFollowUp.resumeMceFollowUps()
  res.json({ success: true, paused: false })
}

module.exports = {
  redirectWhatsAppClick,
  getTimeline,
  getWhatsAppStats,
  regenerateCta,
  reassignRoute,
  getFunnelStats,
  getTopObjections,
  getCityBreakdown,
  getFollowUpStatus,
  pauseFollowUps,
  resumeFollowUps,
}
