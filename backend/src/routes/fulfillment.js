'use strict'

const { Router }   = require('express')
const requireAuth  = require('../middleware/requireAuth')
const { getFulfillmentOrders, updateFulfillmentStatus } = require('../services/fulfillmentService')

const router = Router()
router.use(requireAuth)

// GET /api/fulfillment/orders?leadId=&status=&page=&limit=
router.get('/orders', async (req, res) => {
  try {
    const { leadId, status, page, limit } = req.query
    const result = await getFulfillmentOrders({ leadId, status, page, limit })
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('[Fulfillment] GET /orders:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
})

// PATCH /api/fulfillment/orders/:orderId/status  { status }
router.patch('/orders/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params
    const { status }  = req.body
    if (!status) {
      return res.status(400).json({ success: false, message: 'status is required' })
    }
    const order = await updateFulfillmentStatus(orderId, status)
    res.json({ success: true, data: order })
  } catch (err) {
    console.error('[Fulfillment] PATCH /orders/:orderId/status:', err.message)
    const code = err.message.startsWith('Invalid status') ? 400 : 500
    res.status(code).json({ success: false, message: err.message })
  }
})

module.exports = router
