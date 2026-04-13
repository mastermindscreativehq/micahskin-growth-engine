/**
 * routes/scraping.js
 * All routes require admin authentication (requireAuth middleware).
 *
 * POST /api/scraping/apify/import-instagram   — trigger Apify dataset import
 * GET  /api/scraping/raw-items                — browse ingested raw items
 */

const express = require('express')
const requireAuth = require('../middleware/requireAuth')
const { importInstagram, listRawItems } = require('../controllers/scrapingController')

const router = express.Router()

// All scraping routes are admin-only
router.use(requireAuth)

// Trigger an Apify dataset import
// Body: { datasetId: string, platform?: 'instagram' }
router.post('/apify/import-instagram', importInstagram)

// Browse raw ingested items (with optional filtering)
// Query: ?page=1&limit=50&platform=instagram&temperature=hot&decision=ingest
router.get('/raw-items', listRawItems)

module.exports = router
