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

/**
 * triggerTiktokHashtagScrape
 *
 * @param {string[]|string} [hashtagsOrMode='priority']
 *   - String mode ('priority' | 'all' | 'full'): selects + rotates a batch from config
 *   - String array: uses those hashtags directly (manual / testing)
 *   Batching is enforced: at most 12 hashtags are ever sent to Apify in one run.
 */
async function triggerTiktokHashtagScrape(hashtagsOrMode = 'priority') {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw _err('APIFY_API_TOKEN not configured', 500)

  let selectedHashtags, runMode

  if (Array.isArray(hashtagsOrMode)) {
    // Caller passed explicit list — clamp to 12 to stay within safe batch window
    selectedHashtags = hashtagsOrMode.slice(0, 12).map(h => h.replace(/^#/, ''))
    runMode = 'custom'
  } else {
    runMode = hashtagsOrMode || 'priority'
    selectedHashtags = getHashtagsForRun(runMode)
  }

  const actorId = process.env.APIFY_TIKTOK_ACTOR_ID || 'clockworks/tiktok-hashtag-scraper'

  // ── Pre-run diagnostic log ──────────────────────────────────────────────────
  console.log('[TikTok Scraper] ─────────────────────────────────────────')
  console.log(`[TikTok Scraper] Actor ID    : ${actorId}`)
  console.log(`[TikTok Scraper] Run mode    : ${runMode}`)
  console.log(`[TikTok Scraper] Hashtag count: ${selectedHashtags.length}`)
  console.log(`[TikTok Scraper] Hashtags     : ${selectedHashtags.join(', ')}`)
  console.log('[TikTok Scraper] ─────────────────────────────────────────')

  const url = `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(token)}`

  const input = {
    hashtags:                      selectedHashtags,
    resultsPerPage:                20,
    maxResults:                    60,
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
  return { runId: run.id, status: run.status }
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

  // Defensive: handle both raw array and wrapped { data: { items } } shape
  let items = raw
  if (!Array.isArray(raw)) {
    if (Array.isArray(raw?.data?.items)) {
      items = raw.data.items
      console.log(`[TikTok Scraper] Response wrapped — extracted ${items.length} items from data.items`)
    } else {
      throw _err(`Dataset response was not an array (got ${typeof raw})`, 502)
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

function normaliseTiktokItem(item) {
  // clockworks/tiktok-hashtag-scraper uses 'id' (string) as the primary video ID
  const externalId = String(item.id || item.videoId || item.awemeId || item.tiktokId || '')
  if (!externalId) return null

  const username =
    item.authorMeta?.name ||
    item.authorMeta?.uniqueId ||
    item.author?.uniqueId ||
    item.author?.nickname ||
    item.authorUniqueId ||
    null

  const text =
    item.text ||
    item.desc ||
    item.description ||
    item.caption ||
    ''

  const videoUrl =
    item.webVideoUrl ||
    item.videoUrl ||
    (username && externalId ? `https://www.tiktok.com/@${username}/video/${externalId}` : null)

  const postedAt = item.createTime
    ? new Date(Number(item.createTime) * 1000)
    : item.createTimeISO
      ? new Date(item.createTimeISO)
      : null

  // clockworks actor records the triggering hashtag in item.input.hashtag
  const hashtag =
    item.inputHashtag ||
    item.searchHashtag ||
    item.input?.hashtag ||
    (Array.isArray(item.hashtags) && item.hashtags[0]?.name) ||
    null

  return { externalId, username, text, videoUrl, postedAt, hashtag }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _err(msg, status) {
  const e = new Error(msg)
  e.status = status
  return e
}

module.exports = {
  triggerTiktokHashtagScrape,
  getTiktokRunStatus,
  fetchTiktokItems,
  normaliseTiktokItem,
}
