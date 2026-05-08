'use strict'

/**
 * tiktokScraperService.js
 * Wraps Apify API calls for TikTok hashtag scraping.
 *
 * ENV:
 *   APIFY_API_TOKEN         — required
 *   APIFY_TIKTOK_ACTOR_ID   — defaults to clockworks/tiktok-hashtag-scraper
 */

const { getHashtagsForRun } = require('../config/micahskinTikTokHashtags')

const APIFY_BASE = 'https://api.apify.com/v2'

// ── API calls ─────────────────────────────────────────────────────────────────

// Phase 37 — strict Apify credit caps. Manual mode + Africa-first means we
// keep batches small. Default budget = 3 videos × 10-tag batch = 30 items.
const MAX_ITEMS_HARD_CEILING = 60
const MAX_ITEMS_DEFAULT      = 30
const PER_TAG_HARD_CEILING   = 3   // ≤ 3 videos per query / hashtag
function _resolveMaxItems(override) {
  const raw = Number(override ?? process.env.APIFY_MAX_ITEMS_PER_RUN ?? MAX_ITEMS_DEFAULT)
  if (!Number.isFinite(raw) || raw <= 0) return MAX_ITEMS_DEFAULT
  return Math.min(MAX_ITEMS_HARD_CEILING, Math.max(10, Math.round(raw)))
}

/**
 * triggerTiktokHashtagScrape
 *
 * @param {string[]|string} [hashtagsOrMode='priority']
 *   - String mode ('priority' | 'all' | 'full'): selects + rotates a batch from config
 *   - String array: uses those hashtags directly (manual / testing / pain-point batches)
 *   Batching is enforced: at most 12 hashtags are ever sent to Apify in one run.
 * @param {object} [opts]
 * @param {number} [opts.maxItems]   Per-run item cap (defaults to APIFY_MAX_ITEMS_PER_RUN env, 100)
 * @param {string} [opts.modeLabel]  Optional label for the diagnostic log (e.g. 'pain_point_first')
 */
async function triggerTiktokHashtagScrape(hashtagsOrMode = 'priority', opts = {}) {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw _err('APIFY_API_TOKEN not configured', 500)

  let selectedHashtags, runMode

  if (Array.isArray(hashtagsOrMode)) {
    // Caller passed explicit list — clamp to 12 to stay within safe batch window
    selectedHashtags = hashtagsOrMode.slice(0, 12).map(h => h.replace(/^#/, ''))
    runMode = opts.modeLabel || 'custom'
  } else {
    runMode = hashtagsOrMode || 'priority'
    selectedHashtags = getHashtagsForRun(runMode)
  }

  const actorId   = process.env.APIFY_TIKTOK_ACTOR_ID || 'clockworks/tiktok-hashtag-scraper'
  const maxItems  = _resolveMaxItems(opts.maxItems)
  // Phase 37 — strict per-tag cap (≤ 3 videos per query). The actor receives
  // a small `resultsPerPage` to avoid burning credits on a single hashtag.
  const perTagCap = Math.max(1, Math.min(PER_TAG_HARD_CEILING, Number(opts.perTagItems) || PER_TAG_HARD_CEILING))
  const perPage   = perTagCap

  // ── Pre-run diagnostic log ──────────────────────────────────────────────────
  console.log('[TikTok Scraper] ─────────────────────────────────────────')
  console.log(`[TikTok Scraper] Actor ID     : ${actorId}`)
  console.log(`[TikTok Scraper] Run mode     : ${runMode}`)
  console.log(`[TikTok Scraper] Hashtag count: ${selectedHashtags.length}`)
  console.log(`[TikTok Scraper] Hashtags     : ${selectedHashtags.join(', ')}`)
  console.log(`[TikTok Scraper] maxItems     : ${maxItems}  resultsPerPage: ${perPage}`)
  console.log('[TikTok Scraper] ─────────────────────────────────────────')

  const url = `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(token)}`

  const input = {
    hashtags:                      selectedHashtags,
    resultsPerPage:                perPage,
    maxResults:                    maxItems,
    shouldDownloadVideos:          false,
    shouldDownloadCovers:          false,
    shouldDownloadSubtitles:       false,
    shouldDownloadSlideshowImages: false,
  }

  let result
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(input),
    })
    if (!res.ok) {
      const body = await res.text()
      throw _err(`Apify returned ${res.status}: ${body}`, 502)
    }
    result = await res.json()
  } catch (fetchErr) {
    if (fetchErr.status) throw fetchErr
    throw _err(`Failed to reach Apify: ${fetchErr.message}`, 502)
  }

  const run = result.data
  console.log(`[TikTok Scraper] Run started — ID: ${run.id}, status: ${run.status}`)
  return {
    runId:    run.id,
    status:   run.status,
    hashtags: selectedHashtags,
    runMode,
    maxItems,
  }
}

async function getTiktokRunStatus(runId) {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw _err('APIFY_API_TOKEN not configured', 500)

  const url = `${APIFY_BASE}/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`

  let result
  try {
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text()
      throw _err(`Apify run status failed: ${res.status}: ${body}`, 502)
    }
    result = await res.json()
  } catch (fetchErr) {
    if (fetchErr.status) throw fetchErr
    throw _err(`Failed to reach Apify: ${fetchErr.message}`, 502)
  }

  const run = result.data
  const status          = run.status
  const defaultDatasetId = run.defaultDatasetId || null

  console.log(
    `[TikTok Scraper] Poll — runId=${runId}` +
    ` status=${status}` +
    ` defaultDatasetId=${defaultDatasetId || 'none'}`,
  )

  return { status, defaultDatasetId }
}

async function fetchTiktokItems(datasetId) {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw _err('APIFY_API_TOKEN not configured', 500)

  // No clean=true: Apify's skipEmpty=true (bundled inside clean) can silently
  // drop items the actor marks as partially empty. Fetch raw and let our own
  // normaliser decide what to keep.
  const url =
    `${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items` +
    `?format=json&limit=200&token=${encodeURIComponent(token)}`

  console.log(`[TikTok Scraper] Fetching dataset — datasetId=${datasetId}`)

  let raw
  try {
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text()
      throw _err(`Apify dataset fetch failed: ${res.status}: ${body}`, 502)
    }
    raw = await res.json()
  } catch (fetchErr) {
    if (fetchErr.status) throw fetchErr
    throw _err(`Failed to reach Apify: ${fetchErr.message}`, 502)
  }

  // Defensive: handle multiple Apify V2 response shapes
  let items = raw
  if (!Array.isArray(raw)) {
    if (Array.isArray(raw?.data?.items)) {
      items = raw.data.items
      console.log(`[TikTok Scraper] Response shape: data.items — extracted ${items.length} items`)
    } else if (Array.isArray(raw?.data)) {
      items = raw.data
      console.log(`[TikTok Scraper] Response shape: data[] — extracted ${items.length} items`)
    } else {
      const preview = JSON.stringify(raw).slice(0, 300)
      throw _err(
        `Dataset response was not an array. Shape: ${typeof raw}. Preview: ${preview}`,
        502,
      )
    }
  }

  if (items.length === 0) {
    console.warn(
      `[TikTok Scraper] ACTOR_SUCCEEDED_EMPTY_DATASET — datasetId=${datasetId}. ` +
      'Apify run succeeded but stored 0 items. Check actor input / hashtag validity.',
    )
  } else {
    console.log(`[TikTok Scraper] Dataset ${datasetId} — ${items.length} items fetched`)
    const firstKeys = Object.keys(items[0] || {}).slice(0, 20).join(', ')
    console.log(`[TikTok Scraper] First item keys: ${firstKeys}`)
  }

  return items
}

// ── Normaliser ────────────────────────────────────────────────────────────────

// Coerce a value that may be a string, number, object, or null into a safe
// string suitable for a Prisma `String?` column. Apify actor schemas drift
// across versions — fields like `hashtag`, `authorMeta`, `videoMeta`,
// `musicMeta` sometimes arrive as objects (`{ name, views }`) rather than
// scalars, which causes `Invalid value provided. Expected String or Null,
// provided Object.` at the Prisma layer.
function _toSafeString(val) {
  if (val == null) return null
  if (typeof val === 'string') return val.trim() || null
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) return _toSafeString(val[0])
  if (typeof val === 'object') {
    return (
      val.name ||
      val.title ||
      val.uniqueId ||
      val.value ||
      val.id ||
      null
    )
  }
  return null
}

function normaliseTiktokItem(item) {
  // clockworks/tiktok-hashtag-scraper uses 'id' (string) as the primary video ID
  const externalId = String(item.id || item.videoId || item.awemeId || item.tiktokId || '')
  if (!externalId) return null

  const username = _toSafeString(
    item.authorMeta?.name ||
    item.authorMeta?.uniqueId ||
    item.author?.uniqueId ||
    item.author?.nickname ||
    item.authorUniqueId ||
    item.authorMeta ||
    item.author ||
    null,
  )

  const text =
    (typeof item.text === 'string' && item.text) ||
    (typeof item.desc === 'string' && item.desc) ||
    (typeof item.description === 'string' && item.description) ||
    (typeof item.caption === 'string' && item.caption) ||
    ''

  const videoUrl = _toSafeString(
    item.webVideoUrl ||
    item.videoUrl ||
    item.videoMeta?.downloadAddr ||
    item.videoMeta?.playAddr ||
    item.videoMeta ||
    (username && externalId ? `https://www.tiktok.com/@${username}/video/${externalId}` : null),
  )

  const postedAt = item.createTime
    ? new Date(Number(item.createTime) * 1000)
    : item.createTimeISO
      ? new Date(item.createTimeISO)
      : null

  // clockworks actor records the triggering hashtag in several shapes:
  //   item.inputHashtag  (string)
  //   item.input.hashtag (string)
  //   item.hashtag       (object: { name, views })
  //   item.hashtags[0]   (object: { name })
  const rawHashtag =
    item.inputHashtag ||
    item.searchHashtag ||
    item.input?.hashtag ||
    (Array.isArray(item.hashtags) ? item.hashtags[0] : null) ||
    item.hashtag ||
    null
  const hashtag = _toSafeString(rawHashtag)

  // Defensive logs — surface any object-shaped scalars so future drift is
  // caught before Prisma blows up on string columns.
  console.log('[Normalizer] hashtag normalized:', hashtag)

  const normalized = { externalId, username, text, videoUrl, postedAt, hashtag }

  // Final safety pass — guarantee no string-typed field is an object
  for (const key of ['username', 'videoUrl', 'hashtag']) {
    if (normalized[key] !== null && typeof normalized[key] !== 'string') {
      console.warn(
        `[Normalizer] Coercing non-string ${key} (${typeof normalized[key]}) → null`,
      )
      normalized[key] = _toSafeString(normalized[key])
    }
  }

  return normalized
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _err(msg, status) {
  const e = new Error(msg)
  e.status = status
  return e
}

// ── Phase 36 — Comments scraper (chained 2nd-stage actor) ───────────────────
//
// Default actor: clockworks/tiktok-comments-scraper. Takes a list of TikTok
// post URLs and returns top-level comments. Override via APIFY_TIKTOK_COMMENTS_ACTOR_ID.

// Phase 37 — strict caps. Operator's rule: ≤ 3 videos × ≤ 10 comments per
// video = 30 comments per cycle max.
const COMMENTS_ACTOR_DEFAULT     = 'clockworks/tiktok-comments-scraper'
const COMMENTS_PER_VIDEO_DEFAULT = 10
const COMMENTS_HARD_CEILING      = 10

function _resolveCommentsPerVideo(override) {
  const raw = Number(override ?? process.env.APIFY_COMMENTS_PER_VIDEO ?? COMMENTS_PER_VIDEO_DEFAULT)
  if (!Number.isFinite(raw) || raw <= 0) return COMMENTS_PER_VIDEO_DEFAULT
  return Math.min(COMMENTS_HARD_CEILING, Math.max(3, Math.round(raw)))
}

/**
 * triggerTiktokCommentsScrape
 * Runs the comments actor against a list of TikTok post URLs.
 *
 * @param {string[]} postUrls   Up to 25 TikTok post URLs.
 * @param {object}   [opts]
 * @param {number}   [opts.commentsPerPost]  Per-post comment cap (default 30, ceiling 60).
 * @returns {{ runId, status, postUrls, commentsPerPost, actorId }}
 */
async function triggerTiktokCommentsScrape(postUrls, opts = {}) {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw _err('APIFY_API_TOKEN not configured', 500)

  if (!Array.isArray(postUrls) || postUrls.length === 0) {
    throw _err('triggerTiktokCommentsScrape requires a non-empty postUrls array', 400)
  }

  // Phase 37 — operator-enforced cap: at most 3 videos per cycle.
  const VIDEO_HARD_CAP = 3
  const cleanedUrls = postUrls
    .map(u => (typeof u === 'string' ? u.trim() : ''))
    .filter(u => u && /^https?:\/\/(www\.)?tiktok\.com\//i.test(u))
    .slice(0, VIDEO_HARD_CAP)

  if (cleanedUrls.length === 0) {
    throw _err('No valid TikTok post URLs after cleaning', 400)
  }

  const actorId         = process.env.APIFY_TIKTOK_COMMENTS_ACTOR_ID || COMMENTS_ACTOR_DEFAULT
  const commentsPerPost = _resolveCommentsPerVideo(opts.commentsPerPost)

  console.log('[TikTok Comments] ─────────────────────────────────────────')
  console.log(`[TikTok Comments] Actor ID         : ${actorId}`)
  console.log(`[TikTok Comments] Post URL count   : ${cleanedUrls.length}`)
  console.log(`[TikTok Comments] Comments per post: ${commentsPerPost}`)
  console.log('[TikTok Comments] ─────────────────────────────────────────')

  const url = `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(token)}`

  // The clockworks comments actor accepts both `postURLs` and `postUrls`
  // depending on version — we pass both to be safe.
  const input = {
    postURLs:        cleanedUrls,
    postUrls:        cleanedUrls,
    commentsPerPost,
    maxComments:     commentsPerPost * cleanedUrls.length,
  }

  let result
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(input),
    })
    if (!res.ok) {
      const body = await res.text()
      throw _err(`Apify (comments actor) returned ${res.status}: ${body}`, 502)
    }
    result = await res.json()
  } catch (fetchErr) {
    if (fetchErr.status) throw fetchErr
    throw _err(`Failed to reach Apify comments actor: ${fetchErr.message}`, 502)
  }

  const run = result.data
  console.log(`[TikTok Comments] Run started — ID: ${run.id}, status: ${run.status}`)
  return {
    runId:           run.id,
    status:          run.status,
    postUrls:        cleanedUrls,
    commentsPerPost,
    actorId,
  }
}

/**
 * normaliseTiktokCommentItem
 * Maps a comments-actor item to the shape downstream pipeline expects.
 * Returns null when the row is unusable.
 */
function normaliseTiktokCommentItem(item) {
  // Comment ID as the unique key — videos may surface the same commenter twice
  // across posts, but a single comment is unique.
  const externalId = String(
    item.cid || item.commentId || item.id || item.uniqueId || ''
  )
  if (!externalId) return null

  const text =
    (typeof item.text === 'string' && item.text) ||
    (typeof item.comment === 'string' && item.comment) ||
    (typeof item.commentText === 'string' && item.commentText) ||
    ''

  if (!text.trim()) return null

  // Commenter username — separate from the video's creator
  const username = _toSafeString(
    item.uniqueId ||
    item.user?.uniqueId ||
    item.user?.nickname ||
    item.author?.uniqueId ||
    item.author?.nickname ||
    item.username ||
    item.userName ||
    null,
  )

  // The video URL the comment was posted under
  const sourceVideoUrl = _toSafeString(
    item.videoWebUrl ||
    item.postUrl ||
    item.videoUrl ||
    item.webVideoUrl ||
    item.video?.webVideoUrl ||
    null,
  )

  const postedAt =
    item.createTime ? new Date(Number(item.createTime) * 1000)
    : item.createTimeISO ? new Date(item.createTimeISO)
    : item.createdAt ? new Date(item.createdAt)
    : null

  return {
    externalId,
    username,
    text,
    sourceVideoUrl,
    videoUrl: sourceVideoUrl,
    postedAt,
    hashtag: null,
    isComment: true,
  }
}

module.exports = {
  triggerTiktokHashtagScrape,
  getTiktokRunStatus,
  fetchTiktokItems,
  normaliseTiktokItem,
  // Phase 36 — comment-first scraping
  triggerTiktokCommentsScrape,
  normaliseTiktokCommentItem,
}
