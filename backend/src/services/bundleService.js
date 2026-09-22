'use strict'

/**
 * bundleService.js
 *
 * A Bundle is a curated collection of EXISTING SkincareProduct rows — never a
 * second product catalog. BundleItem stores only a productId FK + display
 * position; product identity/name/image/price/availability all continue to
 * come from SkincareProduct, read fresh on every fetch.
 *
 * Bundle.price is fixed and admin-set — never derived from item prices.
 */

const prisma = require('../lib/prisma')

const VALID_STATUSES = ['draft', 'published', 'archived']

function httpError(status, message, errors) {
  const err = new Error(message)
  err.status = status
  if (errors) err.errors = errors
  return err
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const bundleWithItems = {
  include: {
    items: {
      orderBy: { position: 'asc' },
      include: { product: true },
    },
  },
}

/**
 * Sum of the CURRENT SkincareProduct.price for every item in the bundle.
 * Always computed fresh at read time — never stored, so it can never go
 * stale when a product's price changes later. Products with no price
 * contribute 0 rather than breaking the total.
 */
function computeIndividualValue(items) {
  return (items || []).reduce((sum, item) => sum + (item.product?.price || 0), 0)
}

/**
 * Attaches the live-computed individualValue to a bundle response.
 * Never mutates the DB — display-only.
 */
function attachIndividualValue(bundle) {
  if (!bundle) return bundle
  return { ...bundle, individualValue: computeIndividualValue(bundle.items) }
}

// ── Admin CRUD ───────────────────────────────────────────────────────────────

async function listBundles({ status, search, page = 1, limit = 20 } = {}) {
  const where = {}
  if (status && VALID_STATUSES.includes(status)) where.status = status
  if (search) where.title = { contains: search, mode: 'insensitive' }

  const skip = (Number(page) - 1) * Number(limit)

  const [total, data] = await Promise.all([
    prisma.bundle.count({ where }),
    prisma.bundle.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: Number(limit),
      ...bundleWithItems,
    }),
  ])

  return { data: data.map(attachIndividualValue), total, page: Number(page), limit: Number(limit) }
}

async function getBundleById(id) {
  const bundle = await prisma.bundle.findUnique({ where: { id }, ...bundleWithItems })
  if (!bundle) throw httpError(404, 'Bundle not found')
  return attachIndividualValue(bundle)
}

async function createBundle(payload) {
  const { title, slug, description, concern, skinTypes, price, compareAtPrice, heroImageUrl, ctaText, contactCtaText, seoTitle, seoDescription } = payload

  const errors = []
  if (!title || !title.trim()) errors.push('title is required')
  const resolvedSlug = slugify(slug || title)
  if (!resolvedSlug) errors.push('slug could not be derived — provide a title or slug')
  if (price == null || Number.isNaN(Number(price)) || Number(price) <= 0) errors.push('price must be a positive number')
  if (errors.length > 0) throw httpError(400, 'Validation failed', errors)

  const existing = await prisma.bundle.findUnique({ where: { slug: resolvedSlug } })
  if (existing) throw httpError(409, `Slug "${resolvedSlug}" is already in use`)

  const bundle = await prisma.bundle.create({
    data: {
      title: title.trim(),
      slug: resolvedSlug,
      description: description || null,
      concern: concern || null,
      skinTypes: Array.isArray(skinTypes) ? skinTypes : [],
      price: Number(price),
      compareAtPrice: compareAtPrice != null && compareAtPrice !== '' ? Number(compareAtPrice) : null,
      heroImageUrl: heroImageUrl || null,
      ctaText: ctaText || null,
      contactCtaText: contactCtaText || null,
      seoTitle: seoTitle || null,
      seoDescription: seoDescription || null,
      status: 'draft',
    },
    ...bundleWithItems,
  })
  return attachIndividualValue(bundle)
}

async function updateBundle(id, payload) {
  const bundle = await prisma.bundle.findUnique({ where: { id } })
  if (!bundle) throw httpError(404, 'Bundle not found')

  const data = {}
  if (payload.title !== undefined) {
    if (!payload.title.trim()) throw httpError(400, 'title cannot be empty')
    data.title = payload.title.trim()
  }
  if (payload.slug !== undefined) {
    const resolvedSlug = slugify(payload.slug)
    if (!resolvedSlug) throw httpError(400, 'slug cannot be empty')
    if (resolvedSlug !== bundle.slug) {
      const clash = await prisma.bundle.findUnique({ where: { slug: resolvedSlug } })
      if (clash) throw httpError(409, `Slug "${resolvedSlug}" is already in use`)
    }
    data.slug = resolvedSlug
  }
  if (payload.description !== undefined) data.description = payload.description || null
  if (payload.concern !== undefined) data.concern = payload.concern || null
  if (payload.skinTypes !== undefined) data.skinTypes = Array.isArray(payload.skinTypes) ? payload.skinTypes : []
  if (payload.price !== undefined) {
    if (payload.price == null || Number.isNaN(Number(payload.price)) || Number(payload.price) <= 0) {
      throw httpError(400, 'price must be a positive number')
    }
    data.price = Number(payload.price)
  }
  if (payload.compareAtPrice !== undefined) {
    data.compareAtPrice = payload.compareAtPrice != null && payload.compareAtPrice !== '' ? Number(payload.compareAtPrice) : null
  }
  if (payload.heroImageUrl !== undefined) data.heroImageUrl = payload.heroImageUrl || null
  if (payload.ctaText !== undefined) data.ctaText = payload.ctaText || null
  if (payload.contactCtaText !== undefined) data.contactCtaText = payload.contactCtaText || null
  if (payload.seoTitle !== undefined) data.seoTitle = payload.seoTitle || null
  if (payload.seoDescription !== undefined) data.seoDescription = payload.seoDescription || null

  const updated = await prisma.bundle.update({ where: { id }, data, ...bundleWithItems })
  return attachIndividualValue(updated)
}

// ── Item management ───────────────────────────────────────────────────────────

async function addItem(bundleId, productId) {
  const [bundle, product] = await Promise.all([
    prisma.bundle.findUnique({ where: { id: bundleId } }),
    prisma.skincareProduct.findUnique({ where: { id: productId } }),
  ])
  if (!bundle) throw httpError(404, 'Bundle not found')
  if (!product || !product.isActive) throw httpError(400, 'Product not found or inactive')

  const existing = await prisma.bundleItem.findUnique({ where: { bundleId_productId: { bundleId, productId } } })
  if (existing) throw httpError(409, 'This product is already in the bundle')

  const last = await prisma.bundleItem.findFirst({ where: { bundleId }, orderBy: { position: 'desc' } })
  const position = last ? last.position + 1 : 0

  await prisma.bundleItem.create({ data: { bundleId, productId, position } })
  return getBundleById(bundleId)
}

async function removeItem(bundleId, itemId) {
  const item = await prisma.bundleItem.findUnique({ where: { id: itemId } })
  if (!item || item.bundleId !== bundleId) throw httpError(404, 'Bundle item not found')

  await prisma.bundleItem.delete({ where: { id: itemId } })
  return getBundleById(bundleId)
}

async function reorderItems(bundleId, itemIds) {
  if (!Array.isArray(itemIds) || itemIds.length === 0) throw httpError(400, 'itemIds array is required')

  const items = await prisma.bundleItem.findMany({ where: { bundleId } })
  const validIds = new Set(items.map(i => i.id))
  if (itemIds.length !== items.length || !itemIds.every(id => validIds.has(id))) {
    throw httpError(400, 'itemIds must match exactly the items currently in this bundle')
  }

  await prisma.$transaction(
    itemIds.map((id, position) => prisma.bundleItem.update({ where: { id }, data: { position } }))
  )

  return getBundleById(bundleId)
}

// ── Publish lifecycle ─────────────────────────────────────────────────────────

/**
 * Validates a bundle against the publish rules. Returns an array of human
 * -readable errors (empty = valid). Never mutates anything.
 */
async function validateForPublish(bundle) {
  const errors = []

  if (!bundle.title || !bundle.title.trim()) errors.push('Bundle must have a title')
  if (!bundle.slug || !bundle.slug.trim()) errors.push('Bundle must have a slug')
  if (!bundle.price || bundle.price <= 0) errors.push('Bundle must have a fixed price greater than zero')

  const items = bundle.items || []
  if (items.length === 0) errors.push('Bundle must contain at least one product')

  const productIds = items.map(i => i.productId)
  const uniqueIds = new Set(productIds)
  if (uniqueIds.size !== productIds.length) errors.push('Bundle contains duplicate products')

  for (const item of items) {
    if (!item.product) {
      errors.push('Bundle references a product that no longer exists')
    } else if (!item.product.isActive) {
      errors.push(`Product "${item.product.productName}" is no longer active and cannot be published`)
    }
  }

  return errors
}

async function setStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw httpError(400, `status must be one of: ${VALID_STATUSES.join(', ')}`)
  }

  const bundle = await getBundleById(id)

  if (status === 'published') {
    const errors = await validateForPublish(bundle)
    if (errors.length > 0) throw httpError(422, 'Bundle cannot be published', errors)

    const published = await prisma.bundle.update({
      where: { id },
      data: { status: 'published', publishedAt: bundle.publishedAt || new Date() },
      ...bundleWithItems,
    })
    return attachIndividualValue(published)
  }

  // draft / archived — no validation required to step back
  const updated = await prisma.bundle.update({ where: { id }, data: { status }, ...bundleWithItems })
  return attachIndividualValue(updated)
}

// ── Public read ────────────────────────────────────────────────────────────────

/**
 * Public, unauthenticated read. Only ever returns a bundle whose status is
 * exactly 'published' — draft/archived bundles are never reachable here,
 * regardless of what a caller sends. Filters out any item whose product has
 * since been deactivated, so the public page never shows a dead product.
 */
async function getPublicBundleBySlug(slug) {
  const bundle = await prisma.bundle.findUnique({ where: { slug }, ...bundleWithItems })
  if (!bundle || bundle.status !== 'published') return null

  const activeItems = bundle.items.filter(item => item.product && item.product.isActive)
  return attachIndividualValue({ ...bundle, items: activeItems })
}

module.exports = {
  VALID_STATUSES,
  slugify,
  listBundles,
  getBundleById,
  createBundle,
  updateBundle,
  addItem,
  removeItem,
  reorderItems,
  validateForPublish,
  setStatus,
  getPublicBundleBySlug,
}
