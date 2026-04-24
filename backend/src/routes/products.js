'use strict'

const router      = require('express').Router()
const requireAuth = require('../middleware/requireAuth')
const {
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
} = require('../controllers/productsController')

router.use(requireAuth)

// ── Ingestion — specific paths before /:id ────────────────────────────────────
router.post('/ingest/manual',  ingestManual)
router.get('/ingestion/logs',  listIngestionLogs)

// ── Matching ──────────────────────────────────────────────────────────────────
router.get('/match/:leadId', matchForLead)

// ── Lead-scoped quote routes ──────────────────────────────────────────────────
router.get('/leads/:leadId/quote',       getLeadQuote)
router.post('/leads/:leadId/send-quote', sendQuote)

// ── Quote routes ──────────────────────────────────────────────────────────────
router.post('/quotes',                         generateQuote)
router.get('/quotes/lead/:leadId',             getQuotes)
router.patch('/quotes/:quoteId/items/:itemId', patchQuoteItem)
router.post('/quotes/:quoteId/review',         reviewQuote)

// ── Catalog — parameterized last ─────────────────────────────────────────────
router.get('/',       listProducts)
router.post('/',      createProduct)
router.get('/:id',    getProduct)
router.patch('/:id',  updateProduct)
router.delete('/:id', deactivateProduct)

module.exports = router
