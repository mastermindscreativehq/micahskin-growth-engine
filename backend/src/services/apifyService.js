/**
 * apifyService.js
 * Fetches and normalises dataset items from the Apify platform.
 *
 * ENV REQUIRED:
 *   APIFY_API_TOKEN — your Apify personal API token (Settings → Integrations)
 */

const APIFY_BASE = 'https://api.apify.com/v2'

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch all items from an Apify dataset and return them normalised for our pipeline.
 *
 * @param {string} datasetId  Apify dataset ID (e.g. "s5Ngxm3r8sNPy4hW3")
 * @param {string} platform   Source platform label (default: "instagram")
 * @returns {Promise<{rawCount: number, items: NormalisedItem[], droppedInvalidShape: number}>}
 */
async function fetchAndNormaliseDataset(datasetId, platform = 'instagram') {
  const token = process.env.APIFY_API_TOKEN
  if (!token) {
    const err = new Error('APIFY_API_TOKEN is not configured')
    err.status = 500
    throw err
  }

  console.log(`[Apify] Fetching dataset ${datasetId} (platform: ${platform})`)

  // Apify returns up to 250 000 items; for very large runs paginate with offset/limit.
  // This implementation fetches all items in a single request which is fine for most
  // scraping jobs. Add pagination if datasets grow beyond ~5 000 items.
  const url = `${APIFY_BASE}/datasets/${datasetId}/items?token=${encodeURIComponent(token)}&clean=true&format=json`

  let raw
  try {
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text()
      const err = new Error(`Apify API returned ${res.status}: ${body}`)
      err.status = 502
      throw err
    }
    raw = await res.json()
  } catch (fetchErr) {
    if (fetchErr.status) throw fetchErr
    const err = new Error(`Failed to reach Apify API: ${fetchErr.message}`)
    err.status = 502
    throw err
  }

  if (!Array.isArray(raw)) {
    const err = new Error('Apify dataset response was not an array')
    err.status = 502
    throw err
  }

  console.log(`[Apify] Received ${raw.length} raw items from dataset ${datasetId}`)

  if (platform === 'instagram') {
    const items = []
    let droppedInvalidShape = 0

    for (const rawItem of raw) {
      const normalised = normaliseInstagramItem(rawItem)
      if (normalised) {
        items.push(normalised)
      } else {
        droppedInvalidShape++
      }
    }

    if (droppedInvalidShape > 0) {
      console.warn(`[Apify] ${droppedInvalidShape} item(s) dropped — no usable external ID`)
    }

    return { rawCount: raw.length, items, droppedInvalidShape }
  }

  const err = new Error(`Unsupported platform: ${platform}`)
  err.status = 400
  throw err
}

// ── Normalisers ───────────────────────────────────────────────────────────────

/**
 * Normalise one raw Apify Instagram actor output item into our pipeline shape.
 * Handles field-name differences across the most common Apify Instagram actors:
 *   - apify/instagram-scraper
 *   - apify/instagram-hashtag-scraper
 *   - apify/instagram-post-scraper
 *
 * Returns null if the item has no usable external ID (we cannot deduplicate it).
 *
 * @param {object} item  Raw Apify item
 * @returns {NormalisedItem|null}
 */
function normaliseInstagramItem(item) {
  // Unique ID — try multiple field names used by different actors
  const externalId =
    item.id ||
    item.shortCode ||
    item.postId ||
    item.pk ||
    null

  if (!externalId) {
    console.warn('[Apify] Skipping item with no identifiable external ID:', JSON.stringify(item).slice(0, 120))
    return null
  }

  const username =
    item.ownerUsername ||
    item.username ||
    item.authorUsername ||
    item.ownerId ||    // fallback to numeric owner ID as string
    null

  const displayName =
    item.ownerFullName ||
    item.displayName ||
    item.authorFullName ||
    item.fullName ||
    null

  // Caption / text — some actors nest it differently
  const text =
    item.caption ||
    item.text ||
    item.postText ||
    item.description ||
    ''

  const sourceUrl =
    item.url ||
    item.postUrl ||
    item.permalink ||
    (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : null)

  // Hashtag context — may come from actor input or be embedded in the item
  const matchedHashtag = extractMatchedHashtag(item)

  const postedAt = parseDate(item.timestamp || item.takenAt || item.createdAt || item.date)

  return {
    platform: 'instagram',
    sourceType: 'hashtag_post',
    externalId: String(externalId),
    username,
    displayName,
    text,
    sourceUrl,
    matchedHashtag,
    postedAt,
    likesCount: Number(item.likesCount || item.likes || item.likeCount || 0),
    commentsCount: Number(item.commentsCount || item.comments || item.commentCount || 0),
    rawJson: item,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractMatchedHashtag(item) {
  // Prefer explicit field names set by the actor
  if (item.matchedHashtag) return item.matchedHashtag
  if (item.inputHashtag) return item.inputHashtag
  if (item.searchHashtag) return item.searchHashtag

  // Fall back to first hashtag in the hashtags array
  if (Array.isArray(item.hashtags) && item.hashtags.length > 0) {
    const first = item.hashtags[0]
    return typeof first === 'string' ? first.replace(/^#/, '') : null
  }

  return null
}

function parseDate(value) {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

// ── Types (JSDoc) ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} NormalisedItem
 * @property {string}  platform
 * @property {string}  sourceType
 * @property {string}  externalId
 * @property {string|null} username
 * @property {string|null} displayName
 * @property {string}  text
 * @property {string|null} sourceUrl
 * @property {string|null} matchedHashtag
 * @property {Date|null} postedAt
 * @property {number}  likesCount
 * @property {number}  commentsCount
 * @property {object}  rawJson
 */

module.exports = { fetchAndNormaliseDataset }
