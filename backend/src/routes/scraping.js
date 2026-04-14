/**
 * routes/scraping.js
 * All routes require admin authentication (requireAuth middleware).
 *
 * POST /api/scraping/apify/import-instagram            — trigger Apify dataset import (Phase 15)
 * GET  /api/scraping/raw-items                         — browse ingested raw items
 * POST /api/scraping/apify/prepare-instagram-comments  — extract post URLs → comment_scrape_targets
 * POST /api/scraping/apify/run-instagram-comments      — trigger Apify comment scrape run
 * GET  /api/scraping/comment-targets/stats             — aggregate counts by status
 */

const express = require('express')
const requireAuth = require('../middleware/requireAuth')
const {
  importInstagram,
  listRawItems,
  prepareInstagramComments,
  runInstagramComments,
  commentTargetStats,
  importInstagramComments,
} = require('../controllers/scrapingController')

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

// Extract valid post/reel URLs from a discovery dataset → save as comment_scrape_targets
// Body: { datasetId: string }
router.post('/apify/prepare-instagram-comments', prepareInstagramComments)

// Pick pending targets, trigger Apify comment scrape run, mark rows as 'running'
// Body: { limit?: number }
router.post('/apify/run-instagram-comments', runInstagramComments)

// Aggregate counts by status: { pending, running, done, failed, total }
router.get('/comment-targets/stats', commentTargetStats)

// Import harvested comments from an Apify comment dataset → instagram_comment_leads
// Body: { datasetId: string }
router.post('/apify/import-instagram-comments', importInstagramComments)

module.exports = router
