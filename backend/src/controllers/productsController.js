'use strict'

const prisma = require('../lib/prisma')
const { upsertProduct, runIngestion } = require('../services/productIngestionService')
const { createManualAdapter } = require('../services/adapters/manualProductAdapter')
const { matchProductsForLeadId } = require('../services/productMatchService')
const {
  generateQuoteForLead,
  updateQuoteItem,
  approveQuote,
  markQuoteSent,
  getQuotesForLead,
  getLatestActiveQuote,
  sendDiagnosisAndQuote,
} = require('../services/productQuoteService')

// ── Catalog ────────────────────────────────────────────────────────────────────

async function listProducts(req, res) {
  try {
    const { category, concern, priceBand, market, search, page = 1, limit = 50 } = req.query

    const where = { isActive: true }
    if (category) where.category = category
    if (priceBand) where.priceBand = priceBand
    if (market)   where.market = market
    if (concern)  where.concernsSupported = { has: concern }
    if (search)   where.productName = { contains: search, mode: 'insensitive' }

    const [total, products] = await Promise.all([
      prisma.skincareProduct.count({ where }),
      prisma.skincareProduct.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (Number(page) - 1) * Number(limit),
        take:    Number(limit),
      }),
    ])

    res.json({ success: true, data: products, total, page: Number(page), limit: Number(limit) })
  } catch (err) {
    console.error('[Products] listProducts:', err.message)
    res.status(500).json({ success: false, message: 'Failed to fetch products' })
  }
}

async function getProduct(req, res) {
  try {
    const product = await prisma.skincareProduct.findUnique({ where: { id: req.params.id } })
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' })
    res.json({ success: true, data: product })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch product' })
  }
}

async function createProduct(req, res) {
  try {
    const result = await upsertProduct(req.body)
    res.status(201).json({ success: true, data: { result } })
  } catch (err) {
    console.error('[Products] createProduct:', err.message)
    res.status(400).json({ success: false, message: err.message })
  }
}

async function updateProduct(req, res) {
  try {
    const product = await prisma.skincareProduct.update({
      where: { id: req.params.id },
      data:  req.body,
    })
    res.json({ success: true, data: product })
  } catch (err) {
    res.status(400).json({ success: false, message: err.message })
  }
}

async function deactivateProduct(req, res) {
  try {
    await prisma.skincareProduct.update({
      where: { id: req.params.id },
      data:  { isActive: false },
    })
    res.json({ success: true, message: 'Product deactivated' })
  } catch (err) {
    res.status(400).json({ success: false, message: err.message })
  }
}

// ── Ingestion ─────────────────────────────────────────────────────────────────

async function ingestManual(req, res) {
  try {
    const { products } = req.body
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ success: false, message: 'products array is required' })
    }
    const adapter = createManualAdapter(products)
    const result  = await runIngestion(adapter)
    res.json({ success: true, data: result })
  } catch (err) {
    console.error('[Products] ingestManual:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
}

async function listIngestionLogs(req, res) {
  try {
    const logs = await prisma.productIngestionLog.findMany({
      orderBy: { startedAt: 'desc' },
      take:    50,
    })
    res.json({ success: true, data: logs })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch ingestion logs' })
  }
}

// ── Matching ──────────────────────────────────────────────────────────────────

async function matchForLead(req, res) {
  try {
    const result = await matchProductsForLeadId(req.params.leadId)
    if (!result) return res.status(404).json({ success: false, message: 'Lead not found' })
    res.json({ success: true, data: result })
  } catch (err) {
    console.error('[Products] matchForLead:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
}

// ── Quotes ────────────────────────────────────────────────────────────────────

async function generateQuote(req, res) {
  try {
    const { leadId } = req.body
    if (!leadId) return res.status(400).json({ success: false, message: 'leadId is required' })
    const quote = await generateQuoteForLead(leadId)
    res.status(201).json({ success: true, data: quote })
  } catch (err) {
    console.error('[Products] generateQuote:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
}

async function getQuotes(req, res) {
  try {
    const quotes = await getQuotesForLead(req.params.leadId)
    res.json({ success: true, data: quotes })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch quotes' })
  }
}

// GET /api/products/leads/:leadId/quote — latest active quote shorthand
async function getLeadQuote(req, res) {
  try {
    const quote = await getLatestActiveQuote(req.params.leadId)
    if (!quote) return res.json({ success: true, data: null })
    res.json({ success: true, data: quote })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch quote' })
  }
}

async function patchQuoteItem(req, res) {
  try {
    const { quoteId, itemId } = req.params
    const item = await updateQuoteItem(quoteId, itemId, req.body)
    // Return fresh quote with updated total
    const quote = await prisma.productQuote.findUnique({
      where:   { id: quoteId },
      include: { items: true },
    })
    res.json({ success: true, data: { item, quote } })
  } catch (err) {
    res.status(400).json({ success: false, message: err.message })
  }
}

async function reviewQuote(req, res) {
  try {
    const { action } = req.body
    let quote
    if (action === 'send') {
      quote = await markQuoteSent(req.params.quoteId)
    } else {
      quote = await approveQuote(req.params.quoteId, 'admin')
    }
    res.json({ success: true, data: quote })
  } catch (err) {
    res.status(400).json({ success: false, message: err.message })
  }
}

// POST /api/products/leads/:leadId/send-quote
async function sendQuote(req, res) {
  try {
    const { leadId } = req.params
    const { quoteId } = req.body   // optional — defaults to latest active quote

    const result = await sendDiagnosisAndQuote(leadId, quoteId || null)

    res.json({ success: true, data: result })
  } catch (err) {
    console.error('[Products] sendQuote:', err.message)
    const status = err.message.includes('already sent') || err.message.includes('No active quote') ? 400 : 500
    res.status(status).json({ success: false, message: err.message })
  }
}

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deactivateProduct,
  ingestManual,
  listIngestionLogs,
  matchForLead,
  generateQuote,
  getQuotes,
  getLeadQuote,
  patchQuoteItem,
  reviewQuote,
  sendQuote,
}
