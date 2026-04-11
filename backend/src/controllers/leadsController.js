const leadsService = require('../services/leadsService')



async function createLead(req, res) {
  try {
    const lead = await leadsService.createLead(req.body)
    return res.status(201).json({ success: true, data: lead })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      message: err.message,
      errors: err.errors || [],
    })
  }
}

async function listLeads(req, res) {
  try {
    const { search, status, source, sourceType, priority, intentTag, needsFollowUp, page, limit } = req.query
    const result = await leadsService.getAllLeads({
      search: search || undefined,
      status: status || undefined,
      source: source || undefined,
      sourceType: sourceType || undefined,
      priority: priority || undefined,
      intentTag: intentTag || undefined,
      needsFollowUp: needsFollowUp === 'true',
      page: page ? Math.max(1, parseInt(page, 10)) : 1,
      limit: limit ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 20,
    })
    return res.json({ success: true, ...result })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch leads' })
  }
}

async function updateLeadStatus(req, res) {
  try {
    const { id } = req.params
    const { status } = req.body
    if (!status) {
      return res.status(400).json({ success: false, message: 'status is required' })
    }
    const lead = await leadsService.updateLeadStatus(id, status)
    return res.json({ success: true, data: lead })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({ success: false, message: err.message })
  }
}

/**
 * Phase 6 — Phase 3: marks a lead as engaged when a reply is detected.
 * Stops further automated follow-ups for this lead.
 * Call manually from the CRM or hook to a Telegram/IG webhook later.
 */
async function markLeadAsEngaged(req, res) {
  try {
    const { id } = req.params
    const lead = await leadsService.updateLeadStatus(id, 'engaged')
    return res.json({ success: true, data: lead })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({ success: false, message: err.message })
  }
}

/**
 * POST /api/leads/:id/send-initial-reply
 * Executes the initial reply send for a lead via Telegram relay.
 */
async function executeSendInitialReply(req, res) {
  try {
    const lead = await leadsService.sendInitialReply(req.params.id)
    return res.json({ success: true, data: lead })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({ success: false, message: err.message })
  }
}

/**
 * POST /api/leads/:id/send-followup-1
 */
async function executeSendFollowUp1(req, res) {
  try {
    const lead = await leadsService.sendFollowUp(req.params.id, 1)
    return res.json({ success: true, data: lead })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({ success: false, message: err.message })
  }
}

/**
 * POST /api/leads/:id/send-followup-2
 */
async function executeSendFollowUp2(req, res) {
  try {
    const lead = await leadsService.sendFollowUp(req.params.id, 2)
    return res.json({ success: true, data: lead })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({ success: false, message: err.message })
  }
}

/**
 * POST /api/leads/:id/send-followup-3
 */
async function executeSendFollowUp3(req, res) {
  try {
    const lead = await leadsService.sendFollowUp(req.params.id, 3)
    return res.json({ success: true, data: lead })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({ success: false, message: err.message })
  }
}

module.exports = {
  createLead,
  listLeads,
  updateLeadStatus,
  markLeadAsEngaged,
  executeSendInitialReply,
  executeSendFollowUp1,
  executeSendFollowUp2,
  executeSendFollowUp3,
}
