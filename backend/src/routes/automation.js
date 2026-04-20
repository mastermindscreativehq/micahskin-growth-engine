const { Router } = require('express')
const prisma = require('../lib/prisma')
const requireAutomationSecret = require('../middleware/requireAutomationSecret')
const { updateLeadStatus } = require('../services/leadsService')

const router = Router()

const nodeEnv = process.env.NODE_ENV || 'development'

// Statuses the gateway is permitted to set
const ALLOWED_STATUSES = ['new', 'contacted', 'engaged', 'interested', 'closed']

// Valid delivery channels for reply-trigger
const ALLOWED_CHANNELS = ['whatsapp', 'telegram', 'email']

// ─────────────────────────────────────────────────────────────
// Logging helpers
// ─────────────────────────────────────────────────────────────

// Strips keys that look sensitive before logging body
function sanitizeBody(body) {
  const BLOCKED = ['secret', 'password', 'token', 'key', 'auth', 'credential']
  const out = {}
  for (const [k, v] of Object.entries(body || {})) {
    if (BLOCKED.some(word => k.toLowerCase().includes(word))) {
      out[k] = '[REDACTED]'
    } else {
      out[k] = v
    }
  }
  return out
}

function logRequest(route, req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  console.log(
    `[AutomationGateway] route=${route} | ts=${new Date().toISOString()} | ip=${ip} | body=${JSON.stringify(sanitizeBody(req.body))}`
  )
}

// ─────────────────────────────────────────────────────────────
// GET /api/automation/health — no auth, liveness check
// ─────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  res.json({
    success: true,
    service: 'automation-gateway',
    environment: nodeEnv,
  })
})

// ─────────────────────────────────────────────────────────────
// POST /api/automation/academy-sync
// Receives lead sync data from n8n, looks up lead by email,
// and updates status if a matching record is found.
// Notes field is accepted and logged but not persisted (no DB column).
// Auth: x-automation-secret header
// ─────────────────────────────────────────────────────────────

router.post('/academy-sync', requireAutomationSecret, async (req, res) => {
  logRequest('academy-sync', req)

  const { email, fullName, status, source, notes } = req.body || {}
  const errors = []

  if (!email || typeof email !== 'string' || !email.trim().includes('@')) {
    errors.push('email is required and must be a valid email address')
  }
  if (!fullName || typeof fullName !== 'string' || fullName.trim() === '') {
    errors.push('fullName is required')
  }
  if (!status || typeof status !== 'string' || status.trim() === '') {
    errors.push('status is required')
  } else if (!ALLOWED_STATUSES.includes(status.trim())) {
    errors.push(`status must be one of: ${ALLOWED_STATUSES.join(', ')}`)
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Invalid payload', errors })
  }

  const normalizedEmail = email.trim().toLowerCase()

  let lead
  try {
    lead = await prisma.lead.findFirst({ where: { email: normalizedEmail } })
  } catch (dbErr) {
    console.error('[AutomationGateway] academy-sync db lookup error:', dbErr.message)
    return res.status(500).json({ success: false, message: 'Database error during lead lookup' })
  }

  if (!lead) {
    return res.status(404).json({
      success: false,
      message: 'No lead found with this email',
      email: normalizedEmail,
    })
  }

  let updated
  try {
    updated = await prisma.lead.update({
      where: { id: lead.id },
      data: { status: status.trim() },
    })
  } catch (dbErr) {
    console.error('[AutomationGateway] academy-sync db update error:', dbErr.message)
    return res.status(500).json({ success: false, message: 'Database error during lead update' })
  }

  console.log(`[AutomationGateway] academy-sync updated | leadId=${lead.id} | status=${updated.status} | source=${source || 'n8n'}`)

  return res.json({
    success: true,
    leadId: lead.id,
    email: normalizedEmail,
    status: updated.status,
    source: source || null,
    // notes has no Lead DB column — received and logged, not persisted
    notesReceived: notes ? true : false,
  })
})

// ─────────────────────────────────────────────────────────────
// POST /api/automation/lead-status-update
// Updates the status of a lead by ID.
// Reuses existing updateLeadStatus from leadsService which validates
// status values and checks lead existence.
// Auth: x-automation-secret header
// ─────────────────────────────────────────────────────────────

router.post('/lead-status-update', requireAutomationSecret, async (req, res) => {
  logRequest('lead-status-update', req)

  const { leadId, status, notes, source } = req.body || {}
  const errors = []

  if (!leadId || typeof leadId !== 'string' || leadId.trim() === '') {
    errors.push('leadId is required')
  }
  if (!status || typeof status !== 'string' || status.trim() === '') {
    errors.push('status is required')
  } else if (!ALLOWED_STATUSES.includes(status.trim())) {
    errors.push(`status must be one of: ${ALLOWED_STATUSES.join(', ')}`)
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Invalid payload', errors })
  }

  let updated
  try {
    // updateLeadStatus also validates status and throws 404 if lead not found
    updated = await updateLeadStatus(leadId.trim(), status.trim())
  } catch (err) {
    const statusCode = err.status || 500
    return res.status(statusCode).json({
      success: false,
      message: err.message || 'Failed to update lead status',
      errors: err.errors || [],
    })
  }

  console.log(`[AutomationGateway] lead-status-update | leadId=${updated.id} | status=${updated.status} | source=${source || 'n8n'}`)

  return res.json({
    success: true,
    leadId: updated.id,
    status: updated.status,
    source: source || null,
    // notes has no Lead DB column — received and logged, not persisted
    notesReceived: notes ? true : false,
  })
})

// ─────────────────────────────────────────────────────────────
// POST /api/automation/reply-trigger
// Accepts a trigger request from n8n to send a message to a lead.
// Returns "accepted" without executing delivery — downstream
// message sending requires verified channel state and is not safe
// to invoke externally without additional lead/session validation.
// Wire to messageSenderService when lead channel state is confirmed.
// Auth: x-automation-secret header
// ─────────────────────────────────────────────────────────────

router.post('/reply-trigger', requireAutomationSecret, async (req, res) => {
  logRequest('reply-trigger', req)

  const { leadId, channel, template, payload } = req.body || {}
  const errors = []

  if (!leadId || typeof leadId !== 'string' || leadId.trim() === '') {
    errors.push('leadId is required')
  }
  if (!channel || !ALLOWED_CHANNELS.includes(channel)) {
    errors.push(`channel must be one of: ${ALLOWED_CHANNELS.join(', ')}`)
  }
  if (!template || typeof template !== 'string' || template.trim() === '') {
    errors.push('template is required')
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Invalid payload', errors })
  }

  // Verify lead exists before accepting
  let lead
  try {
    lead = await prisma.lead.findUnique({ where: { id: leadId.trim() } })
  } catch (dbErr) {
    console.error('[AutomationGateway] reply-trigger db lookup error:', dbErr.message)
    return res.status(500).json({ success: false, message: 'Database error during lead lookup' })
  }

  if (!lead) {
    return res.status(404).json({
      success: false,
      message: 'Lead not found',
      leadId: leadId.trim(),
    })
  }

  console.log(`[AutomationGateway] reply-trigger accepted | leadId=${lead.id} | channel=${channel} | template=${template}`)

  // Delivery execution is not wired — return accepted for n8n acknowledgement.
  // To execute: call messageSenderService.sendMessage() with verified channel state.
  return res.status(202).json({
    success: true,
    accepted: true,
    leadId: lead.id,
    channel,
    template,
    message: 'Trigger accepted. Delivery execution is pending downstream wiring.',
  })
})

module.exports = router
