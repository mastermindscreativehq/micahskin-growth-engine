/**
 * scrapingController.js
 * Thin HTTP handlers for the scraping/import routes.
 * All business logic lives in leadIngestionService and commentScrapeService.
 */

const { importApifyDataset } = require('../services/leadIngestionService')
const { prepareCommentTargets, runCommentHarvest, getCommentTargetStats } = require('../services/commentScrapeService')
const { importInstagramCommentDataset } = require('../services/commentIngestionService')

// ── POST /api/scraping/apify/import-instagram ─────────────────────────────────
// Body: { datasetId: string, platform?: string }
// Auth: requireAuth (admin only)
async function importInstagram(req, res) {
  const { datasetId, platform = 'instagram' } = req.body

  if (!datasetId || typeof datasetId !== 'string' || datasetId.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'datasetId is required and must be a non-empty string.',
    })
  }

  const supportedPlatforms = ['instagram']
  if (!supportedPlatforms.includes(platform)) {
    return res.status(400).json({
      success: false,
      message: `Unsupported platform "${platform}". Supported: ${supportedPlatforms.join(', ')}.`,
    })
  }

  try {
    const summary = await importApifyDataset(datasetId.trim(), platform)
    return res.status(200).json({ success: true, data: summary })
  } catch (err) {
    const status = err.status || 500
    console.error('[ScrapingController] Import failed:', err.message)
    return res.status(status).json({
      success: false,
      message: err.message,
    })
  }
}

// ── GET /api/scraping/raw-items ───────────────────────────────────────────────
// Lists recently ingested raw social items (paginated).
// Query: ?page=1&limit=50&platform=instagram&temperature=hot
async function listRawItems(req, res) {
  const page = Math.max(1, parseInt(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50))
  const skip = (page - 1) * limit

  const where = {}
  if (req.query.platform) where.platform = req.query.platform

  // Filter by temperature via the related decision
  const decisionFilter = {}
  if (req.query.temperature) decisionFilter.temperature = req.query.temperature
  if (req.query.decision) decisionFilter.decision = req.query.decision

  try {
    const prisma = require('../lib/prisma')

    const [items, total] = await Promise.all([
      prisma.rawSocialItem.findMany({
        where: {
          ...where,
          ...(Object.keys(decisionFilter).length > 0
            ? { decision: { is: decisionFilter } }
            : {}),
        },
        include: { decision: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.rawSocialItem.count({
        where: {
          ...where,
          ...(Object.keys(decisionFilter).length > 0
            ? { decision: { is: decisionFilter } }
            : {}),
        },
      }),
    ])

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    })
  } catch (err) {
    console.error('[ScrapingController] listRawItems failed:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
}

// ── POST /api/scraping/apify/prepare-instagram-comments ───────────────────────
// Body: { datasetId: string }
// Auth: requireAuth (admin only)
// Reads discovery items from an Apify dataset, extracts valid post/reel URLs,
// deduplicates against DB, and saves new comment_scrape_targets rows.
async function prepareInstagramComments(req, res) {
  const { datasetId } = req.body

  if (!datasetId || typeof datasetId !== 'string' || !datasetId.trim()) {
    return res.status(400).json({ success: false, message: 'datasetId is required.' })
  }

  try {
    const summary = await prepareCommentTargets(datasetId.trim())
    return res.status(200).json({ success: true, data: summary })
  } catch (err) {
    console.error('[ScrapingController] prepareInstagramComments failed:', err.message)
    return res.status(err.status || 500).json({ success: false, message: err.message })
  }
}

// ── POST /api/scraping/apify/run-instagram-comments ───────────────────────────
// Body: { limit?: number }   (default 50, max 200)
// Auth: requireAuth (admin only)
// Picks pending comment_scrape_targets, triggers Apify run, marks rows 'running'.
async function runInstagramComments(req, res) {
  const limit = req.body.limit ?? 50

  try {
    const result = await runCommentHarvest(limit)
    return res.status(200).json({ success: true, data: result })
  } catch (err) {
    console.error('[ScrapingController] runInstagramComments failed:', err.message)
    return res.status(err.status || 500).json({ success: false, message: err.message })
  }
}

// ── GET /api/scraping/comment-targets/stats ───────────────────────────────────
// Auth: requireAuth (admin only)
// Returns aggregate counts: { pending, running, done, failed, total }
async function commentTargetStats(req, res) {
  try {
    const stats = await getCommentTargetStats()
    return res.status(200).json({ success: true, data: stats })
  } catch (err) {
    console.error('[ScrapingController] commentTargetStats failed:', err.message)
    return res.status(500).json({ success: false, message: err.message })
  }
}

// ── POST /api/scraping/apify/import-instagram-comments ────────────────────────
// Body: { datasetId: string }
// Auth: requireAuth (admin only)
async function importInstagramComments(req, res) {
  const { datasetId } = req.body

  if (!datasetId || typeof datasetId !== 'string' || !datasetId.trim()) {
    return res.status(400).json({ success: false, message: 'datasetId is required.' })
  }

  try {
    const result = await importInstagramCommentDataset(datasetId.trim())
    return res.status(200).json({ success: true, data: result })
  } catch (err) {
    console.error('[ScrapingController] importInstagramComments failed:', err.message)
    return res.status(err.status || 500).json({ success: false, message: err.message })
  }
}

module.exports = { importInstagram, listRawItems, prepareInstagramComments, runInstagramComments, commentTargetStats, importInstagramComments }