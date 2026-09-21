'use strict'

const assessmentService = require('../services/assessmentService')
const { ASSESSMENT_FEE_NGN } = require('../config/assessmentConfig')

function sendError(res, err) {
  const status = err.status || 500
  if (status >= 500) console.error('[AssessmentController]', err)
  return res.status(status).json({
    success: false,
    message: err.message || 'Something went wrong',
    ...(err.errors ? { errors: err.errors } : {}),
  })
}

async function getConfig(_req, res) {
  return res.json({
    success: true,
    feeNgn: ASSESSMENT_FEE_NGN,
    concernOptions: assessmentService.CONCERN_OPTIONS,
    skinTypeOptions: assessmentService.SKIN_TYPE_OPTIONS,
    sensitivityOptions: assessmentService.SENSITIVITY_OPTIONS,
    severityOptions: assessmentService.SEVERITY_OPTIONS,
    routineLevelOptions: assessmentService.ROUTINE_LEVEL_OPTIONS,
    budgetOptions: assessmentService.BUDGET_OPTIONS,
  })
}

async function start(_req, res) {
  try {
    const session = await assessmentService.startSession()
    return res.json({ success: true, data: { sessionId: session.id, status: session.status } })
  } catch (err) {
    return sendError(res, err)
  }
}

async function getSession(req, res) {
  try {
    const data = await assessmentService.getSessionById(req.params.sessionId)
    return res.json({ success: true, data })
  } catch (err) {
    return sendError(res, err)
  }
}

async function saveIntake(req, res) {
  try {
    const session = await assessmentService.saveIntake(req.params.sessionId, req.body?.answers)
    return res.json({ success: true, data: { status: session.status } })
  } catch (err) {
    return sendError(res, err)
  }
}

async function completeIntake(req, res) {
  try {
    const { fullName, email, phone, answers } = req.body || {}
    const result = await assessmentService.completeIntake(req.params.sessionId, { fullName, email, phone, answers })
    return res.json({
      success: true,
      data: { status: result.session.status, feeNgn: ASSESSMENT_FEE_NGN },
    })
  } catch (err) {
    return sendError(res, err)
  }
}

async function pay(req, res) {
  try {
    const result = await assessmentService.initializePayment(req.params.sessionId)
    return res.json({ success: true, data: result })
  } catch (err) {
    return sendError(res, err)
  }
}

async function paymentFailed(req, res) {
  try {
    const session = await assessmentService.markPaymentFailed(req.params.sessionId, req.body?.reason)
    return res.json({ success: true, data: { status: session.status } })
  } catch (err) {
    return sendError(res, err)
  }
}

async function getResult(req, res) {
  try {
    const data = await assessmentService.getPublicSession(req.params.accessToken)
    if (!data) return res.status(404).json({ success: false, message: 'Assessment not found' })
    return res.json({ success: true, data })
  } catch (err) {
    return sendError(res, err)
  }
}

module.exports = {
  getConfig,
  start,
  getSession,
  saveIntake,
  completeIntake,
  pay,
  paymentFailed,
  getResult,
}
