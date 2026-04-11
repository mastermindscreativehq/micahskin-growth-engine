const repliesService = require('../services/repliesService')

/**
 * POST /api/replies
 * Ingests an incoming reply from a lead.
 * Body: { leadId, message, channel }
 */
async function receiveReply(req, res) {
  try {
    const { leadId, message, channel } = req.body
    const result = await repliesService.ingestReply({ leadId, message, channel })
    return res.status(201).json({ success: true, data: result })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      message: err.message,
      errors: err.errors || [],
    })
  }
}

/**
 * GET /api/replies?leadId=xxx
 * Returns all replies for a given lead. Protected — admin only.
 */
async function listReplies(req, res) {
  try {
    const { leadId } = req.query
    if (!leadId) {
      return res.status(400).json({ success: false, message: 'leadId query param is required' })
    }
    const replies = await repliesService.getRepliesForLead(leadId)
    return res.json({ success: true, data: replies })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch replies' })
  }
}

module.exports = { receiveReply, listReplies }
