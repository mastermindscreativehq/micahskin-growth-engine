const academyService = require('../services/academyService')

async function createRegistration(req, res) {
  try {
    const registration = await academyService.createRegistration(req.body)
    return res.status(201).json({ success: true, data: registration })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      message: err.message,
      errors: err.errors || [],
    })
  }
}

async function listRegistrations(req, res) {
  try {
    const { search, status, source, sourceType, page, limit } = req.query
    const result = await academyService.getAllRegistrations({
      search: search || undefined,
      status: status || undefined,
      source: source || undefined,
      sourceType: sourceType || undefined,
      page: page ? Math.max(1, parseInt(page, 10)) : 1,
      limit: limit ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 20,
    })
    return res.json({ success: true, ...result })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch registrations' })
  }
}

async function updateRegistrationStatus(req, res) {
  try {
    const { id } = req.params
    const { status } = req.body
    if (!status) {
      return res.status(400).json({ success: false, message: 'status is required' })
    }
    const registration = await academyService.updateRegistrationStatus(id, status)
    return res.json({ success: true, data: registration })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({ success: false, message: err.message })
  }
}

module.exports = { createRegistration, listRegistrations, updateRegistrationStatus }
