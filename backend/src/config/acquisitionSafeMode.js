'use strict'

/**
 * acquisitionSafeMode.js
 * Single source of truth for all Apify acquisition limits.
 *
 * Hard ceilings are enforced here — env vars can reduce limits but never
 * exceed them. ACQUISITION_SAFE_MODE=true by default.
 */

const CEILING_QUERIES  = 3
const CEILING_POSTS    = 5
const CEILING_COMMENTS = 10

function _clamp(val, min, max) {
  const n = parseInt(val, 10)
  if (!Number.isFinite(n)) return max
  return Math.min(max, Math.max(min, n))
}

const SAFE_MODE             = String(process.env.ACQUISITION_SAFE_MODE ?? 'true').toLowerCase() !== 'false'
const MAX_APIFY_RUNS        = 1
const MAX_SEARCH_QUERIES    = _clamp(process.env.MAX_SEARCH_QUERIES    ?? CEILING_QUERIES,  1, CEILING_QUERIES)
const MAX_POSTS_PER_RUN     = _clamp(process.env.MAX_POSTS_PER_RUN     ?? CEILING_POSTS,    1, CEILING_POSTS)
const MAX_COMMENTS_PER_POST = _clamp(process.env.MAX_COMMENTS_PER_POST ?? CEILING_COMMENTS, 1, CEILING_COMMENTS)
const MAX_ACCEPTED_LEADS    = 15
const RUN_TIMEOUT_MS        = 10 * 60 * 1000   // 10 min hard failsafe
const RUN_LOG_SIZE          = 10               // in-memory ring buffer

console.log(
  `[SafeMode] ACQUISITION_SAFE_MODE=${SAFE_MODE}` +
  ` maxQueries=${MAX_SEARCH_QUERIES}` +
  ` maxPosts=${MAX_POSTS_PER_RUN}` +
  ` maxComments=${MAX_COMMENTS_PER_POST}`,
)

module.exports = {
  SAFE_MODE,
  MAX_APIFY_RUNS,
  MAX_SEARCH_QUERIES,
  MAX_POSTS_PER_RUN,
  MAX_COMMENTS_PER_POST,
  MAX_ACCEPTED_LEADS,
  RUN_TIMEOUT_MS,
  RUN_LOG_SIZE,
}
