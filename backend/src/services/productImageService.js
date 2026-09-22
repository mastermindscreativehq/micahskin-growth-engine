'use strict'

/**
 * productImageService.js
 *
 * Manual product-image upload to Supabase Storage, using the SAME raw-HTTPS
 * pattern already used elsewhere in this codebase for external APIs
 * (paystackController.js) — no new npm dependency (no multer, no
 * @supabase/supabase-js). Writes only to the EXISTING SkincareProduct.imageUrl
 * field; no new image field/model is created.
 *
 * Requires SUPABASE_URL + SUPABASE_SECRET_KEY env vars (not currently
 * configured in this project — see .env.example). Until they're set, upload
 * attempts fail gracefully with a clear "not configured" error, exactly like
 * productQuoteService.js does today when PAYSTACK_SECRET_KEY is missing. The
 * existing plain-text Image URL field keeps working regardless — this is an
 * additive alternative, not a replacement.
 */

const https = require('https')
const prisma = require('../lib/prisma')

const SUPABASE_URL = process.env.SUPABASE_URL
// SUPABASE_SECRET_KEY is the current Supabase API key name. SUPABASE_SERVICE_ROLE_KEY
// is kept as a fallback only — nothing else in this codebase sets/reads it, but
// retaining it costs nothing and avoids a breaking rename if it's ever used elsewhere.
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = process.env.SUPABASE_PRODUCT_IMAGE_BUCKET || 'product-images'

const MAX_BYTES = 5 * 1024 * 1024 // 5MB
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_SECRET_KEY)
}

function supabaseRequest(method, path, body, contentType) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path)
    const data = body ? (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))) : null
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        // Supabase's REST/Storage gateway requires this on every request to
        // identify the project/key context — missing it was the root cause
        // of the "Invalid Compact JWS" failure.
        apikey: SUPABASE_SECRET_KEY,
        'Content-Type': contentType || 'application/json',
        ...(data ? { 'Content-Length': data.length } : {}),
      },
    }
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        resolve({ status: res.statusCode, body: raw })
      })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

/**
 * Idempotent — tolerant of "bucket already exists". Called lazily before
 * the first upload rather than requiring a separate manual provisioning step.
 */
async function ensureBucketExists() {
  const res = await supabaseRequest('POST', '/storage/v1/bucket', {
    id: BUCKET,
    name: BUCKET,
    public: true,
  })
  if (res.status >= 200 && res.status < 300) return true
  // Supabase returns 400/409-shaped errors for "already exists" — tolerate them.
  if (/already exists/i.test(res.body)) return true
  console.error(`[ProductImage] bucket ensure failed | status=${res.status} body=${res.body}`)
  return false
}

function safeFilename(filename) {
  const base = String(filename || 'image').split(/[/\\]/).pop()
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'image'
}

/**
 * Uploads a base64-encoded image for an existing SkincareProduct and updates
 * its imageUrl. Replaces any previous image reference for that product —
 * does not accumulate old files (the old object is simply superseded by a
 * new path/URL; storage cleanup of the orphaned object is not implemented in
 * this pass since Supabase credentials aren't configured to test against).
 *
 * @param {string} productId
 * @param {{ filename: string, contentType: string, dataBase64: string }} file
 */
async function uploadProductImage(productId, file) {
  if (!isConfigured()) {
    throw httpError(503, 'Product image storage is not configured (SUPABASE_URL / SUPABASE_SECRET_KEY missing)')
  }

  const { filename, contentType, dataBase64 } = file || {}

  if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw httpError(400, `contentType must be one of: ${[...ALLOWED_CONTENT_TYPES].join(', ')}`)
  }
  if (!dataBase64 || typeof dataBase64 !== 'string') {
    throw httpError(400, 'dataBase64 is required')
  }

  const product = await prisma.skincareProduct.findUnique({ where: { id: productId } })
  if (!product) throw httpError(404, 'Product not found')

  let buffer
  try {
    buffer = Buffer.from(dataBase64, 'base64')
  } catch {
    throw httpError(400, 'dataBase64 is not valid base64 data')
  }
  if (buffer.length === 0) throw httpError(400, 'Uploaded image is empty')
  if (buffer.length > MAX_BYTES) throw httpError(400, `Image exceeds the ${MAX_BYTES / (1024 * 1024)}MB limit`)

  await ensureBucketExists()

  const path = `products/${productId}/${Date.now()}-${safeFilename(filename)}`

  const uploadRes = await supabaseRequest(
    'POST',
    `/storage/v1/object/${BUCKET}/${path}`,
    buffer,
    contentType
  )

  if (uploadRes.status < 200 || uploadRes.status >= 300) {
    console.error(`[ProductImage] upload failed | productId=${productId} status=${uploadRes.status} body=${uploadRes.body}`)
    throw httpError(502, 'Image upload to storage failed')
  }

  const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`

  const updated = await prisma.skincareProduct.update({
    where: { id: productId },
    data: { imageUrl },
  })

  console.log(`[ProductImage] uploaded | productId=${productId} url=${imageUrl}`)

  return updated
}

module.exports = { uploadProductImage, isConfigured, MAX_BYTES, ALLOWED_CONTENT_TYPES }
