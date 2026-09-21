'use strict'

const { Router } = require('express')
const controller = require('../controllers/assessmentController')

const router = Router()

// All routes here are public — no admin session required. Identity is scoped
// by sessionId (handed only to the client that created it) for in-progress
// intake/payment steps, and by the unguessable accessToken for result reads.

router.get('/config', controller.getConfig)
router.post('/start', controller.start)
router.get('/session/:sessionId', controller.getSession)
router.patch('/:sessionId/intake', controller.saveIntake)
router.post('/:sessionId/complete-intake', controller.completeIntake)
router.post('/:sessionId/pay', controller.pay)
router.post('/:sessionId/retry-payment', controller.pay)
router.post('/:sessionId/payment-failed', controller.paymentFailed)
router.get('/result/:accessToken', controller.getResult)

module.exports = router
