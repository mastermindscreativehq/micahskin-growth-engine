'use strict'

/**
 * tiktokScraperService.js
 * Wraps Apify API calls for TikTok hashtag scraping.
 *
 * ENV:
 *   APIFY_API_TOKEN         — required
 *   APIFY_TIKTOK_ACTOR_ID   — defaults to clockworks/tiktok-hashtag-scraper
 */

const APIFY_BASE = 'https://api.apify.com/v2'

const TARGET_HASHTAGS = [
  'acne',
  'darkspots',
  'hyperpigmentation',
  'stretchmarks',
  'oilyskin',
  'skincareNigeria',
  'knuckledarkening',
  'facebreakout',
]

// ── API calls ─────────────────────────────────────────────────────────────────

async function triggerTiktokHashtagScrape(hashtags = TARGET_HASHTAGS) {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw _err('APIFY_API_TOKEN not configured', 500)

  const actorId = process.env.APIFY_TIKTOK_ACTOR_ID || 'clockworks/tiktok-hashtag-scraper'
  const url = `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(token)}`

  const input = {
    hashtags:                     hashtags.map(h => h.replace(/^#/, '')),
    resultsPerPage:               20,
    maxResults:                   60,
    shouldDownloadVideos:         false,
    shouldDownloadCovers:         false,
    shouldDownloadSubtitles:      false,
    shouldDownloadSlideshowImages: false,
  }

  console.log(`[TikTok Scraper] Triggering scrape for ${hashtags.length} hashtags via ${actorId}`)

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
  console.log(`[TikTok Scraper] Run ${runId} — status=${run.status} dataset=${run.defaultDatasetId || 'none'}`)
  return { status: run.status, defaultDatasetId: run.defaultDatasetId || null }
}

async function fetchTiktokItems(datasetId) {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw _err('APIFY_API_TOKEN not configured', 500)

  const url = `${APIFY_BASE}/datasets/${datasetId}/items?clean=true&format=json&token=${encodeURIComponent(token)}`

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

  if (!Array.isArray(raw)) throw _err('Dataset response was not an array', 502)
  console.log(`[TikTok Scraper] Fetched ${raw.length} raw items from dataset ${datasetId}`)
  return raw
}

// ── Normaliser ────────────────────────────────────────────────────────────────

function normaliseTiktokItem(item) {
  const externalId = String(item.id || item.videoId || '')
  if (!externalId) return null

  const username =
    item.authorMeta?.name ||
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

  const hashtag =
    item.inputHashtag ||
    item.searchHashtag ||
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
  TARGET_HASHTAGS,
}
