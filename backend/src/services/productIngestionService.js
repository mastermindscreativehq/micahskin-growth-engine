'use strict'

const prisma = require('../lib/prisma')
const {
  normalizeName,
  normalizeBrand,
  normalizeCategory,
  normalizeConcernTags,
  normalizeSkinTypeTags,
  normalizePriceBand,
} = require('./productNormalizationService')

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
    await prisma.skincareProduct.update({ where: { id: existing.id }, data })
    return 'updated'
  }

  await prisma.skincareProduct.create({ data })
  return 'inserted'
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
        if (result === 'inserted') inserted++
        else if (result === 'updated') updated++
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

module.exports = { upsertProduct, runIngestion }
