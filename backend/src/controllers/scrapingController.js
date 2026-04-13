/**
 * scrapingController.js
 * Thin HTTP handlers for the scraping/import routes.
 * All business logic lives in leadIngestionService.
 */

const { importApifyDataset } = require('../services/leadIngestionService')

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

module.exports = { importInstagram, listRawItems }
