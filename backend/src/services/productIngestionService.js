'use strict'

const prisma = require('../lib/prisma')
const {
  normalizeName,
  normalizeBrand,
  normalizeCategory,
  normalizeConcernTags,
  normalizeSkinTypeTags,
  normalizePriceBand,
  isProbableDuplicate,
} = require('./productNormalizationService')
const { normalizeConcernList } = require('../config/skinTaxonomy')

async function upsertProduct(raw) {
  const normalizedName  = normalizeName(raw.productName)
  const normalizedBrand = normalizeBrand(raw.brand)
  const category        = normalizeCategory(raw.category || raw.productName)
  const concernsSupported  = normalizeConcernTags(raw.concernsSupported || [])
  const skinTypesSupported = normalizeSkinTypeTags(raw.skinTypesSupported || [])
  const price    = raw.price != null ? Number(raw.price) : null
  const priceBand = normalizePriceBand(price, raw.currency || 'NGN')
  const sourceStore = raw.sourceStore || 'manual'

  const data = {
    productName:         raw.productName,
    normalizedName,
    brand:               raw.brand,
    normalizedBrand,
    category,
    subcategory:         raw.subcategory || null,
    concernsSupported,
    skinTypesSupported,
    sensitivityFriendly: raw.sensitivityFriendly || false,
    routineStep:         raw.routineStep || category,
    description:         raw.description || null,
    keyIngredients:      Array.isArray(raw.keyIngredients) ? raw.keyIngredients : [],
    contraindications:   Array.isArray(raw.contraindications) ? raw.contraindications : [],
    price,
    currency:            raw.currency || 'NGN',
    priceBand,
    purchaseUrl:         raw.purchaseUrl || null,
    imageUrl:            raw.imageUrl || null,
    sourceStore,
    sourceType:          raw.sourceType || 'manual',
    country:             raw.country || 'NG',
    market:              raw.market || 'nigeria',
    availabilityStatus:  raw.availabilityStatus || 'available',
    stockStatus:         raw.stockStatus || 'in_stock',
    confidenceScore:     raw.confidenceScore != null ? Number(raw.confidenceScore) : 1.0,
    lastCheckedAt:       new Date(),
    isActive:            true,
  }

  const existing = await prisma.skincareProduct.findFirst({
    where: { normalizedName, normalizedBrand, sourceStore },
  })

  if (existing) {
    const product = await prisma.skincareProduct.update({ where: { id: existing.id }, data })
    return { status: 'updated', product }
  }

  const product = await prisma.skincareProduct.create({ data })
  return { status: 'inserted', product }
}

/**
 * Run an ingestion from an adapter.
 * Adapter must expose: { name, sourceStore, fetch() }
 */
async function runIngestion(adapter) {
  const log = await prisma.productIngestionLog.create({
    data: {
      source:      adapter.name,
      sourceStore: adapter.sourceStore || 'unknown',
      status:      'running',
    },
  })

  let productsFound = 0
  let inserted  = 0
  let updated   = 0
  let skipped   = 0
  let duplicates = 0
  let failed    = 0

  try {
    const products = await adapter.fetch()
    productsFound = products.length

    for (const raw of products) {
      try {
        if (!raw.productName || !raw.brand) { skipped++; continue }
        const result = await upsertProduct(raw)
        if (result.status === 'inserted') inserted++
        else if (result.status === 'updated') updated++
        else duplicates++
      } catch (err) {
        failed++
        console.error(`[Ingestion] product failed | name=${raw.productName}:`, err.message)
      }
    }

    await prisma.productIngestionLog.update({
      where: { id: log.id },
      data: {
        productsFound, inserted, updated, skipped, duplicates, failed,
        status:      'complete',
        completedAt: new Date(),
      },
    })

    console.log(
      `[Ingestion] ${adapter.name} complete | found=${productsFound} ` +
      `inserted=${inserted} updated=${updated} skipped=${skipped} ` +
      `duplicates=${duplicates} failed=${failed}`
    )

    return { logId: log.id, productsFound, inserted, updated, skipped, duplicates, failed }
  } catch (err) {
    await prisma.productIngestionLog.update({
      where: { id: log.id },
      data: { status: 'failed', error: err.message, completedAt: new Date() },
    })
    throw err
  }
}

// ── External/n8n draft ingestion ──────────────────────────────────────────────
// Deliberately separate from upsertProduct()/runIngestion() above — those
// remain unchanged and keep powering the existing manual-ingest admin flow
// (POST /api/products/ingest/manual), which still creates ACTIVE products
// immediately, exactly as before.
//
// This path is stricter and always creates a DRAFT (isActive:false,
// reviewStatus:'pending_review') that an admin must explicitly approve
// before it can appear in productMatchService.js/bundleService.js results
// (both already filter on isActive:true — no change needed there).
//
// On a likely duplicate, this NEVER creates or modifies anything — it just
// reports the existing product back to the caller, per the "do not create
// another active product on duplicate" requirement.

function ingestDraftError(status, message, errors) {
  const err = new Error(message)
  err.status = status
  if (errors) err.errors = errors
  return err
}

async function ingestDraftProduct(raw) {
  const errors = []
  if (!raw || typeof raw !== 'object') errors.push('payload must be an object')
  if (!raw?.productName || typeof raw.productName !== 'string' || !raw.productName.trim()) {
    errors.push('productName is required')
  }
  if (!raw?.brand || typeof raw.brand !== 'string' || !raw.brand.trim()) {
    errors.push('brand is required')
  }
  if (errors.length > 0) throw ingestDraftError(400, 'Invalid product payload', errors)

  const normalizedName = normalizeName(raw.productName)
  const normalizedBrand = normalizeBrand(raw.brand)
  const sourceStore = raw.sourceStore || 'n8n'

  // 1. Exact duplicate — same normalized name+brand+sourceStore (DB unique constraint)
  const exact = await prisma.skincareProduct.findFirst({
    where: { normalizedName, normalizedBrand, sourceStore },
  })
  if (exact) {
    console.log(`[DraftIngestion] duplicate (exact) | name=${raw.productName} brand=${raw.brand} existingId=${exact.id}`)
    return { status: 'duplicate', product: exact }
  }

  // 2. Probable duplicate — same brand, similar name, regardless of sourceStore
  //    (catches "the same product from a different store listing")
  const sameBrandProducts = await prisma.skincareProduct.findMany({
    where: { normalizedBrand },
    select: { id: true, normalizedName: true, productName: true, brand: true },
  })
  const probable = sameBrandProducts.find((p) =>
    isProbableDuplicate(normalizedName, normalizedBrand, p.normalizedName, normalizedBrand)
  )
  if (probable) {
    const full = await prisma.skincareProduct.findUnique({ where: { id: probable.id } })
    console.log(`[DraftIngestion] duplicate (probable) | name=${raw.productName} brand=${raw.brand} existingId=${probable.id}`)
    return { status: 'duplicate', product: full }
  }

  const category = normalizeCategory(raw.category || raw.productName)
  // Strict canonical-only normalization for external data — unrecognized
  // tags are dropped rather than invented/passed through, per "never
  // fabricate product information."
  const concernsSupported = normalizeConcernList(Array.isArray(raw.concernsSupported) ? raw.concernsSupported : [])
  const skinTypesSupported = normalizeSkinTypeTags(Array.isArray(raw.skinTypesSupported) ? raw.skinTypesSupported : [])
  const price = raw.price != null ? Number(raw.price) : null
  const priceBand = normalizePriceBand(price, raw.currency || 'NGN')

  // Per the source-image licensing note: never download/re-host a third-party
  // image automatically. sourceImageUrl is stored as a direct reference only —
  // an admin can replace it with a properly-uploaded image during review.
  const imageUrl = raw.sourceImageUrl || null

  const product = await prisma.skincareProduct.create({
    data: {
      productName: raw.productName.trim(),
      normalizedName,
      brand: raw.brand.trim(),
      normalizedBrand,
      category,
      subcategory: raw.subcategory || null,
      concernsSupported,
      skinTypesSupported,
      sensitivityFriendly: raw.sensitivityFriendly === true,
      routineStep: raw.routineStep || category,
      description: raw.description || null,
      keyIngredients: Array.isArray(raw.keyIngredients) ? raw.keyIngredients : [],
      contraindications: Array.isArray(raw.contraindications) ? raw.contraindications : [],
      price,
      currency: raw.currency || 'NGN',
      priceBand,
      purchaseUrl: raw.purchaseUrl || null,
      imageUrl,
      sourceStore,
      sourceType: raw.sourceType || 'n8n',
      country: raw.country || 'NG',
      market: raw.market || 'nigeria',
      availabilityStatus: raw.availabilityStatus || 'available',
      stockStatus: raw.stockStatus || 'in_stock',
      confidenceScore: raw.confidenceScore != null ? Number(raw.confidenceScore) : null,
      lastCheckedAt: new Date(),
      isActive: false,
      reviewStatus: 'pending_review',
    },
  })

  console.log(`[DraftIngestion] created draft | id=${product.id} name=${product.productName} brand=${product.brand}`)

  return { status: 'draft_created', product }
}

module.exports = { upsertProduct, runIngestion, ingestDraftProduct }
