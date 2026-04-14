/**
 * routes/scraping.js
 * All routes require admin authentication (requireAuth middleware).
 *
 * POST /api/scraping/apify/import-instagram                — trigger Apify dataset import (Phase 15)
 * GET  /api/scraping/raw-items                             — browse ingested raw items
 * POST /api/scraping/apify/prepare-instagram-comments      — extract post URLs → comment_scrape_targets
 * POST /api/scraping/apify/run-instagram-comments          — trigger Apify comment scrape run
 * GET  /api/scraping/comment-targets/stats                 — aggregate counts by status
 * POST /api/scraping/apify/run-instagram-orchestration     — Stage 1 + Stage 2 + Stage 3 in sequence
 * GET  /api/scraping/apify/orchestration-status/:runId     — poll run; auto-triggers Stage 4 on SUCCEEDED
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
  runInstagramOrchestrationHandler,
  checkOrchestrationStatusHandler,
} = require('../controllers/scrapingController')
const { generateContentFromComments } = require('../services/contentEngine')

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

// Run Stage 1 (lead ingestion) + Stage 2 (prepare targets) + Stage 3 (harvest) in sequence
// Body: { discoveryDatasetId: string, platform?: string, harvestLimit?: number }
router.post('/apify/run-instagram-orchestration', runInstagramOrchestrationHandler)

// Poll Apify run status; auto-triggers Stage 4 comment ingestion on SUCCEEDED
// Param: :runId — OrchestrationRun.id (UUID returned by run-instagram-orchestration)
router.get('/apify/orchestration-status/:runId', checkOrchestrationStatusHandler)

// POST /api/scraping/content-ideas
// Body: { comments: string[] }
// Returns: content idea sets grouped by detected skin concern, ordered by comment volume.
router.post('/content-ideas', (req, res) => {
  const { comments } = req.body
  if (!Array.isArray(comments)) {
    return res.status(400).json({ error: 'comments must be a string array' })
  }
  const ideas = generateContentFromComments(comments)
  res.json({ ideas, total: ideas.length })
})

module.exports = router
