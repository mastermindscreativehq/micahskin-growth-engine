'use strict'

const bundleService = require('../services/bundleService')

function sendError(res, err) {
  const status = err.status || 500
  if (status >= 500) console.error('[BundlesController]', err)
  return res.status(status).json({
    success: false,
    message: err.message || 'Something went wrong',
    ...(err.errors ? { errors: err.errors } : {}),
  })
}

// ── Admin ──────────────────────────────────────────────────────────────────────

async function list(req, res) {
  try {
    const { status, search, page, limit } = req.query
    const result = await bundleService.listBundles({ status, search, page, limit })
    res.json({ success: true, ...result })
  } catch (err) { sendError(res, err) }
}

async function getById(req, res) {
  try {
    const bundle = await bundleService.getBundleById(req.params.id)
    res.json({ success: true, data: bundle })
  } catch (err) { sendError(res, err) }
}

async function create(req, res) {
  try {
    const bundle = await bundleService.createBundle(req.body)
    res.status(201).json({ success: true, data: bundle })
  } catch (err) { sendError(res, err) }
}

async function update(req, res) {
  try {
    const bundle = await bundleService.updateBundle(req.params.id, req.body)
    res.json({ success: true, data: bundle })
  } catch (err) { sendError(res, err) }
}

async function addItem(req, res) {
  try {
    const { productId } = req.body
    if (!productId) return res.status(400).json({ success: false, message: 'productId is required' })
    const bundle = await bundleService.addItem(req.params.id, productId)
    res.status(201).json({ success: true, data: bundle })
  } catch (err) { sendError(res, err) }
}

async function removeItem(req, res) {
  try {
    const bundle = await bundleService.removeItem(req.params.id, req.params.itemId)
    res.json({ success: true, data: bundle })
  } catch (err) { sendError(res, err) }
}

async function reorderItems(req, res) {
  try {
    const bundle = await bundleService.reorderItems(req.params.id, req.body.itemIds)
    res.json({ success: true, data: bundle })
  } catch (err) { sendError(res, err) }
}

async function setStatus(req, res) {
  try {
    const bundle = await bundleService.setStatus(req.params.id, req.body.status)
    res.json({ success: true, data: bundle })
  } catch (err) { sendError(res, err) }
}

// ── Public ─────────────────────────────────────────────────────────────────────

async function getPublicBySlug(req, res) {
  try {
    const bundle = await bundleService.getPublicBundleBySlug(req.params.slug)
    if (!bundle) return res.status(404).json({ success: false, message: 'Bundle not found' })
    res.json({ success: true, data: bundle })
  } catch (err) { sendError(res, err) }
}

module.exports = {
  list,
  getById,
  create,
  update,
  addItem,
  removeItem,
  reorderItems,
  setStatus,
  getPublicBySlug,
}
