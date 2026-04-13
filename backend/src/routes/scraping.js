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

// ── GET /api/scraping/debug-auth ──────────────────────────────────────────────
// Public — reports session/auth state without requiring auth.
// Lets you verify the route is reachable and your session cookie is present
// directly from the browser, without any terminal work.
router.get('/debug-auth', (req, res) => {
  res.json({
    routeLive: true,
    authenticated: !!(req.session && req.session.authenticated),
    adminSessionPresent: !!req.session,
  })
})

// All remaining scraping routes are admin-only
router.use(requireAuth)

// Trigger an Apify dataset import
// Body: { datasetId: string, platform?: 'instagram' }
router.post('/apify/import-instagram', importInstagram)

// Browse raw ingested items (with optional filtering)
// Query: ?page=1&limit=50&platform=instagram&temperature=hot&decision=ingest
router.get('/raw-items', listRawItems)

module.exports = router
