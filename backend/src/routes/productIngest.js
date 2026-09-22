'use strict'

/**
 * productIngest.js
 *
 * n8n-facing product ingestion — a SOURCE (whatever n8n scrapes/discovers) →
 * n8n normalizes/decides what to send → this endpoint → draft product →
 * admin review → approve → active catalog.
 *
 * Reuses the EXISTING automation-gateway auth pattern (requireAutomationSecret,
 * x-automation-secret header, AUTOMATION_SECRET env var) rather than inventing
 * a second auth mechanism. Reuses the existing product model, normalization,
 * and duplicate-detection helpers — no second product-ingestion model.
 */

const { Router } = require('express')
const requireAutomationSecret = require('../middleware/requireAutomationSecret')
const { ingestDraftProduct } = require('../services/productIngestionService')

const router = Router()

// POST /api/products/ingest/external
// Body: { brand, productName, category?, subcategory?, description?,
//         keyIngredients?, concernsSupported?, skinTypesSupported?,
//         sensitivityFriendly?, routineStep?, contraindications?, price?,
//         currency?, purchaseUrl?, sourceStore?, sourceType?, country?,
//         market?, availabilityStatus?, stockStatus?, sourceImageUrl? }
// Always creates a DRAFT (isActive:false, reviewStatus:'pending_review') or
// reports back an existing duplicate — never immediately active.
router.post('/external', requireAutomationSecret, async (req, res) => {
  try {
    const result = await ingestDraftProduct(req.body)
    const statusCode = result.status === 'duplicate' ? 200 : 201
    return res.status(statusCode).json({ success: true, ...result })
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error('[ProductIngestExternal]', err)
    return res.status(status).json({
      success: false,
      message: err.message || 'Ingestion failed',
      ...(err.errors ? { errors: err.errors } : {}),
    })
  }
})

module.exports = router
