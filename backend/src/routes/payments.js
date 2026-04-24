'use strict'

const { Router }    = require('express')
const requireAuth   = require('../middleware/requireAuth')
const { getPaymentTransactions } = require('../services/fulfillmentService')

const router = Router()
router.use(requireAuth)

// GET /api/payments/transactions?leadId=&page=&limit=
router.get('/transactions', async (req, res) => {
  try {
    const { leadId, page, limit } = req.query
    const result = await getPaymentTransactions({ leadId, page, limit })
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('[Payments] GET /transactions:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router
