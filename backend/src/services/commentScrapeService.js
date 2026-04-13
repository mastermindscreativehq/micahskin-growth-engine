/**
 * commentScrapeService.js
 * Extracts valid Instagram post/reel URLs from Apify discovery datasets,
 * persists them as comment_scrape_targets, and triggers Apify comment harvests.
 *
 * Pipeline stages:
 *   1. prepareCommentTargets(datasetId) — fetch dataset → extract URLs → deduplicate → save
 *   2. runCommentHarvest(limit)         — pick pending targets → trigger Apify run → mark running
 *   3. getCommentTargetStats()          — aggregate counts by status
 */

const { fetchAndNormaliseDataset, triggerCommentScrapeRun } = require('./apifyService')
const prisma = require('../lib/prisma')

// ── Rejection counters (reset at the start of each prepareCommentTargets run) ─

let rejectedHashtagOrProfile = 0
let rejectedInvalidFormat = 0

// ── URL extractor ─────────────────────────────────────────────────────────────

/**
 * Given a raw Apify item (i.e. normalizedItem.rawJson), extract and canonicalize
 * the Instagram post/reel URL.  Handles field-name variants across Apify actors:
 *   url, postUrl, permalink, shortCodeUrl, shortcodeUrl, shortCode
 *
 * Rejects hashtag explore pages (/explore/tags/) and bare profile pages.
 * Increments module-level rejection counters for diagnostic logging.
 *
 * @param {object} item  Raw Apify item
 * @returns {string|null}  Canonical https://www.instagram.com/{p|reel}/{code}/ or null
 */
function normalizeInstagramTarget(item) {
  const raw =
    item.url ||
    item.postUrl ||
    item.permalink ||
    item.shortCodeUrl ||
    item.shortcodeUrl ||
    null

  let url = raw

  // ShortCode fallback — only when no URL field was found at all
  if (!url && item.shortCode) {
    url = `https://www.instagram.com/p/${item.shortCode}/`
  }

  if (!url || typeof url !== 'string') {
    rejectedInvalidFormat++
    return null
  }

  const clean = url.trim()

  // Reject hashtag explore pages and bare profile pages (username only)
  if (
    clean.includes('/explore/tags/') ||
    /^https?:\/\/(www\.)?instagram\.com\/[^/?#]+\/?$/.test(clean)
  ) {
    rejectedHashtagOrProfile++
    return null
  }

  const match = clean.match(
    /^https?:\/\/(www\.)?instagram\.com\/(p|reel)\/([A-Za-z0-9_-]+)\/?/
  )

  if (!match) {
    rejectedInvalidFormat++
    return null
  }

  const type = match[2]
  const code = match[3]

  return `https://www.instagram.com/${type}/${code}/`
}

// ── Stage 1: prepare ──────────────────────────────────────────────────────────

/**
 * Fetch an Apify discovery dataset, extract all valid Instagram post/reel URLs,
 * deduplicate against existing DB rows, and save new pending targets.
 *
 * @param {string} datasetId  Apify dataset ID from the post-discovery run
 * @returns {Promise<PrepareSummary>}
 */
async function prepareCommentTargets(datasetId) {
  // ── Fetch from Apify ──────────────────────────────────────────────────────
  const { rawCount, items, droppedInvalidShape } = await fetchAndNormaliseDataset(datasetId, 'instagram')

  // Reset counters for this run
  rejectedHashtagOrProfile = 0
  rejectedInvalidFormat = 0

  // ── Debug: inspect what came back ─────────────────────────────────────────
  console.log('[prepareCommentTargets] raw items:', items.length)

  console.log(
    '[prepareCommentTargets] sample source urls:',
    items
      .map(i => {
        const r = i.rawJson
        return r.url || r.postUrl || r.permalink || r.shortCodeUrl || r.shortcodeUrl || i.sourceUrl || null
      })
      .filter(Boolean)
      .slice(0, 10)
  )

  // ── Extract valid URLs using normalizeInstagramTarget on the raw item ─────
  const extractedUrls = items
    .map(i => normalizeInstagramTarget(i.rawJson))
    .filter(Boolean)

  console.log('[prepareCommentTargets] extracted valid urls:', extractedUrls.slice(0, 10))
  console.log('[prepareCommentTargets] valid count:', extractedUrls.length)
  console.log('[prepareCommentTargets] rejected hashtag/profile:', rejectedHashtagOrProfile)
  console.log('[prepareCommentTargets] rejected invalid format:', rejectedInvalidFormat)

  // ── Within-batch deduplication ────────────────────────────────────────────
  let batchDuplicates = 0
  const candidates = []
  const seenShortcodes = new Set()

  // Build a shortcode→sourceUrl map from normalized items for audit trail
  const sourceUrlByShortcode = new Map()
  for (const item of items) {
    const sc = item.externalId  // already a string, set by normaliseInstagramItem
    if (sc) sourceUrlByShortcode.set(sc, item.sourceUrl)
  }

  for (const canonicalUrl of extractedUrls) {
    const m = canonicalUrl.match(/instagram\.com\/(p|reel)\/([A-Za-z0-9_-]+)\//)
    const postType = m[1] === 'p' ? 'post' : 'reel'
    const shortcode = m[2]

    if (seenShortcodes.has(shortcode)) {
      batchDuplicates++
      continue
    }
    seenShortcodes.add(shortcode)

    candidates.push({
      shortcode,
      postUrl: canonicalUrl,
      postType,
      sourceUrl: sourceUrlByShortcode.get(shortcode) || canonicalUrl,
    })
  }

  // ── DB deduplication ──────────────────────────────────────────────────────
  let dbDuplicates = 0
  let newTargets = candidates

  if (candidates.length > 0) {
    const existing = await prisma.commentScrapeTarget.findMany({
      where: { shortcode: { in: candidates.map(c => c.shortcode) } },
      select: { shortcode: true },
    })
    const existingSet = new Set(existing.map(e => e.shortcode))
    dbDuplicates = existing.length
    newTargets = candidates.filter(c => !existingSet.has(c.shortcode))
  }

  // ── Persist new targets ───────────────────────────────────────────────────
  if (newTargets.length > 0) {
    await prisma.commentScrapeTarget.createMany({
      data: newTargets.map(t => ({
        platform: 'instagram',
        sourceDatasetId: datasetId,
        sourceUrl: t.sourceUrl,
        postUrl: t.postUrl,
        shortcode: t.shortcode,
        postType: t.postType,
        status: 'pending',
      })),
    })
    console.log(`[CommentScrape] Saved ${newTargets.length} new pending target(s) from dataset ${datasetId}`)
  } else {
    console.log(`[CommentScrape] No new targets from dataset ${datasetId} — all ${candidates.length} already exist`)
  }

  const invalidSkipped = droppedInvalidShape + rejectedInvalidFormat
  const duplicatesSkipped = batchDuplicates + dbDuplicates

  return {
    rawItemsSeen: rawCount,
    droppedInvalidShape,
    validCandidates: candidates.length,
    newTargetsSaved: newTargets.length,
    duplicatesSkipped,
    invalidSkipped,
  }
}

// ── Stage 2: run ──────────────────────────────────────────────────────────────

/**
 * Pick up to `limit` pending comment scrape targets, trigger an Apify run,
 * and mark those rows as 'running'.
 *
 * @param {number} limit  Max targets to queue (1–200, default 50)
 * @returns {Promise<HarvestResult>}
 */
async function runCommentHarvest(limit = 50) {
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50))

  const pending = await prisma.commentScrapeTarget.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: safeLimit,
  })

  if (pending.length === 0) {
    return {
      pendingFound: 0,
      targetsQueued: 0,
      apifyRunId: null,
      apifyRunUrl: null,
      apifyRunStatus: null,
      message: 'No pending targets — run prepare-instagram-comments first.',
    }
  }

  const postUrls = pending.map(t => t.postUrl)

  // Trigger Apify comment scrape run
  const { runId, runUrl, status: runStatus } = await triggerCommentScrapeRun(postUrls)

  // Mark queued targets as 'running'
  await prisma.commentScrapeTarget.updateMany({
    where: { id: { in: pending.map(t => t.id) } },
    data: { status: 'running', apifyRunId: runId },
  })

  console.log(`[CommentScrape] Run ${runId} queued ${pending.length} target(s)`)

  return {
    pendingFound: pending.length,
    targetsQueued: pending.length,
    apifyRunId: runId,
    apifyRunUrl: runUrl,
    apifyRunStatus: runStatus,
  }
}

// ── Stage 3: stats ────────────────────────────────────────────────────────────

/**
 * Return aggregate counts by status for comment_scrape_targets.
 * @returns {Promise<TargetStats>}
 */
async function getCommentTargetStats() {
  const [pending, running, done, failed, total] = await Promise.all([
    prisma.commentScrapeTarget.count({ where: { status: 'pending' } }),
    prisma.commentScrapeTarget.count({ where: { status: 'running' } }),
    prisma.commentScrapeTarget.count({ where: { status: 'done' } }),
    prisma.commentScrapeTarget.count({ where: { status: 'failed' } }),
    prisma.commentScrapeTarget.count(),
  ])
  return { pending, running, done, failed, total }
}

// ── Types (JSDoc) ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} PrepareSummary
 * @property {number} rawItemsSeen        Total items in the Apify dataset
 * @property {number} droppedInvalidShape Items with no external ID (from Apify fetch)
 * @property {number} validCandidates     Items with a valid post/reel URL (before DB dedup)
 * @property {number} newTargetsSaved     Targets actually written to DB
 * @property {number} duplicatesSkipped   Batch + DB duplicates combined
 * @property {number} invalidSkipped      Items with missing/non-post URL (includes droppedInvalidShape)
 */

/**
 * @typedef {object} HarvestResult
 * @property {number}      pendingFound    Pending rows found in DB
 * @property {number}      targetsQueued   URLs sent to Apify
 * @property {string|null} apifyRunId      Apify run ID
 * @property {string|null} apifyRunUrl     Direct link to Apify console run
 * @property {string|null} apifyRunStatus  Initial status reported by Apify
 * @property {string} [message]            Only set when no pending targets
 */

/**
 * @typedef {object} TargetStats
 * @property {number} pending
 * @property {number} running
 * @property {number} done
 * @property {number} failed
 * @property {number} total
 */

module.exports = { prepareCommentTargets, runCommentHarvest, getCommentTargetStats }
