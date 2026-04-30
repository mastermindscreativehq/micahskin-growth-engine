'use strict'

/**
 * leadAcquisitionService.js
 * Phase 32 — Lead Acquisition Engine
 *
 * Every 30 minutes:
 *   1. Trigger Apify TikTok hashtag scraper
 *   2. Poll until complete (on next tick)
 *   3. Filter for pain / intent signals
 *   4. Score 0–100 and classify concern type
 *   5. Store in scraped_leads table
 *   6. Inject scoring >= 50 into the leads table
 *   7. Queue scoring >= 70 for manual outreach (appears in Command Center hot queue)
 */

const prisma = require('../lib/prisma')
const {
  triggerTiktokHashtagScrape,
  getTiktokRunStatus,
  fetchTiktokItems,
  normaliseTiktokItem,
} = require('./tiktokScraperService')

// ── In-memory run state ───────────────────────────────────────────────────────

let _pendingRunId       = null
let _pendingRunStartAt  = null
const RUN_TIMEOUT_MS    = 25 * 60 * 1000   // 25 min — abandon stale runs

// ── Pain / intent patterns ────────────────────────────────────────────────────

const PAIN_PATTERNS = [
  /what\s+can\s+i\s+(use|do|try)/i,
  /please\s+help/i,
  /pls\s+help/i,
  /help\s+me/i,
  /i\s+need\s+help/i,
  /can\s+(anyone|someone|you)\s+(help|recommend|suggest)/i,
  /this\s+is\s+(exactly\s+)?my\s+(problem|issue|situation|struggle)/i,
  /i'?ve\s+tried\s+everything/i,
  /tried\s+everything/i,
  /nothing\s+works/i,
  /any\s+solution\??/i,
  /this\s+is\s+me\b/i,
  /same\s+(problem|issue|struggle|thing)/i,
  /how\s+do\s+i\s+(get\s+rid|fix|treat|clear)/i,
  /how\s+to\s+(get\s+rid\s+of|fix|treat|remove|clear)/i,
  /what\s+product/i,
  /any\s+(good\s+)?(product|remedy|cure|treatment|cream|serum|routine)/i,
  /recommend\s+(something|a|any)/i,
  /been\s+dealing\s+with/i,
  /struggling\s+with/i,
  /so\s+(embarrassing|insecure|frustrated|annoying)/i,
  /makes?\s+me\s+(feel|look)\s+so/i,
  /hate\s+my\s+(skin|face|knuckle|spots?)/i,
  /need\s+(help|something|a\s+solution|a\s+product)/i,
  /best\s+product\s+for/i,
  /what\s+should\s+i\s+(use|do|try)/i,
  /please\s+what/i,
  /how\s+do\s+you\s+(treat|get\s+rid\s+of)/i,
  /so\s+tired\s+of/i,
  /so\s+done\s+with\s+(this|it)/i,
  /been\s+struggling/i,
  /does\s+(this|anyone|anything)\s+work/i,
  /what\s+worked\s+for/i,
]

const REJECT_PATTERNS = [
  /^[\p{Emoji}\s]{1,10}$/u,         // emoji-only or near-empty
  /follow\s+(me|back|us)/i,
  /check\s+(my|out\s+my)\s+profile/i,
  /shop\s+now/i,
  /click\s+(the\s+)?link/i,
  /\bhttps?:\/\//,
  /dm\s+me\s+for/i,
  /buy\s+now/i,
  /promo\s+code/i,
  /\d+%\s+off/i,
  /free\s+shipping/i,
  /visit\s+my/i,
  /link\s+in\s+(bio|description)/i,
  /^.{0,7}$/,                        // too short
]

const HIGH_URGENCY_PATTERNS = [
  /been\s+dealing\s+with\s+(this|it)\s+(for\s+)?(year|month)/i,
  /tried\s+everything/i,
  /nothing\s+works/i,
  /so\s+(done|tired)\s+with/i,
  /desperate/i,
  /please\s+help/i,
  /i\s+need\s+help/i,
  /help\s+me\s+please/i,
  /been\s+struggling\s+(for|since)/i,
]

const CONCERN_MAP = [
  ['acne',              /\b(acne|pimple|breakout|blackhead|whitehead|blemish|zit|cystic)\b/i],
  ['hyperpigmentation', /\b(dark\s+spot|hyperpigmentation|discoloration|uneven\s+(skin|tone)|melanin|dark\s+patch|post[-\s]?acne)\b/i],
  ['stretch_marks',     /\b(stretch\s+mark|stretchmark|pregnancy\s+mark|striae)\b/i],
  ['oily_skin',         /\b(oily\s+skin|oiliness|greasy\s+(skin|face)|shiny\s+face|excess\s+oil|sebum|oily\s+face)\b/i],
  ['knuckle_darkening', /\b(dark(en(ed|ing)?)?\s+knuckle|knuckle\s+dark|black\s+knuckle)\b/i],
  ['general',           /\b(skin|complexion|skin\s+tone|glow|clear\s+skin|skincare)\b/i],
]

// ── Scoring ───────────────────────────────────────────────────────────────────

function filterComment(text) {
  if (!text || typeof text !== 'string') return false
  const t = text.trim()
  if (REJECT_PATTERNS.some(p => p.test(t))) return false
  return PAIN_PATTERNS.some(p => p.test(t))
}

function scoreComment(text) {
  if (!text) return 0
  let score = 0

  const painCount = PAIN_PATTERNS.filter(p => p.test(text)).length
  if (painCount > 0) {
    score += 30
    score += Math.min((painCount - 1) * 8, 24)   // up to +24 for multi-signal
  }

  const [concern] = detectConcern(text)
  if (concern && concern !== 'general') score += 15
  else if (concern === 'general')       score += 5

  if (HIGH_URGENCY_PATTERNS.some(p => p.test(text))) score += 15

  if (text.length > 80)  score += 8
  if (text.length > 160) score += 4

  return Math.min(score, 100)
}

function detectConcern(text) {
  for (const [type, pattern] of CONCERN_MAP) {
    if (pattern.test(text)) return [type]
  }
  return [null]
}

function detectUrgency(text, score) {
  if (score >= 70 || HIGH_URGENCY_PATTERNS.some(p => p.test(text))) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

// ── Lead injection ────────────────────────────────────────────────────────────

async function injectToLead(scrapedLead) {
  const username   = scrapedLead.username || 'unknown'
  const concern    = scrapedLead.concernType || 'general'
  const skinLabel  = concern.replace(/_/g, ' ')

  const lead = await prisma.lead.create({
    data: {
      fullName:          `@${username} (TikTok)`,
      sourcePlatform:    'tiktok',
      sourceType:        'scraped',
      skinConcern:       skinLabel,
      message:           scrapedLead.comment,
      handle:            username,
      status:            'new',
      priority:          scrapedLead.intentScore >= 70 ? 'high' : 'low',
      productIntentScore: scrapedLead.intentScore,
      consultIntentScore: Math.floor(scrapedLead.intentScore * 0.6),
      primaryConcern:    concern,
      urgencyLevel:      scrapedLead.urgencyLevel,
      leadStage:         'new',
      lastInteractionAt: new Date(),
    },
  })

  return lead.id
}

// ── Batch processor ───────────────────────────────────────────────────────────

async function processRawItems(rawItems) {
  let total = rawItems.length, accepted = 0, rejected = 0, injected = 0, queued = 0

  for (const raw of rawItems) {
    const norm = normaliseTiktokItem(raw)
    if (!norm || !norm.text?.trim()) { rejected++; continue }

    // Skip duplicates by externalId
    if (norm.externalId) {
      const exists = await prisma.scrapedLead.findUnique({
        where: { externalId: norm.externalId },
      })
      if (exists) { rejected++; continue }
    }

    const passes  = filterComment(norm.text)
    const score   = scoreComment(norm.text)
    const [concern] = detectConcern(norm.text)
    const urgency = detectUrgency(norm.text, score)

    // Always persist scraped item (processed=false if below threshold)
    let saved
    try {
      saved = await prisma.scrapedLead.create({
        data: {
          platform:    'tiktok',
          username:    norm.username,
          comment:     norm.text,
          videoUrl:    norm.videoUrl,
          hashtag:     norm.hashtag,
          externalId:  norm.externalId || null,
          postedAt:    norm.postedAt,
          concernType: concern,
          intentScore: score,
          urgencyLevel: urgency,
          processed:   false,
        },
      })
    } catch (dbErr) {
      // Unique constraint race — already inserted by a concurrent run
      if (dbErr.code === 'P2002') { rejected++; continue }
      throw dbErr
    }

    if (!passes || score < 30) { rejected++; continue }
    accepted++

    // Inject into main leads table if score >= 50
    if (score >= 50) {
      try {
        const leadId = await injectToLead({ ...saved })
        await prisma.scrapedLead.update({
          where: { id: saved.id },
          data:  { processed: true, injectedLeadId: leadId, outreachQueued: score >= 70 },
        })
        injected++
        if (score >= 70) queued++
      } catch (err) {
        console.error(`[LeadAcquisition] Inject failed for @${norm.username}:`, err.message)
      }
    }
  }

  return { total, accepted, rejected, injected, queued }
}

// ── Scheduler cycle ───────────────────────────────────────────────────────────

async function runAcquisitionCycle() {
  if (!process.env.APIFY_API_TOKEN) {
    console.log('[LeadAcquisition] APIFY_API_TOKEN not set — skipping')
    return
  }

  try {
    if (_pendingRunId) {
      const age = Date.now() - (_pendingRunStartAt?.getTime() || 0)
      if (age > RUN_TIMEOUT_MS) {
        console.warn('[LeadAcquisition] Pending run timed out — abandoning', _pendingRunId)
        _pendingRunId = null; _pendingRunStartAt = null
        return
      }

      const { status, defaultDatasetId } = await getTiktokRunStatus(_pendingRunId)

      if (status === 'SUCCEEDED' && defaultDatasetId) {
        const rawItems = await fetchTiktokItems(defaultDatasetId)
        const result   = await processRawItems(rawItems)
        console.log('[LeadAcquisition] Cycle complete:', result)
        _pendingRunId = null; _pendingRunStartAt = null

      } else if (['FAILED', 'TIMED-OUT', 'ABORTED'].includes(status)) {
        console.warn(`[LeadAcquisition] Run ended with status: ${status}`)
        _pendingRunId = null; _pendingRunStartAt = null
      }
      // RUNNING / READY — wait for next tick
      return
    }

    // No pending run — trigger a new cycle
    console.log('[LeadAcquisition] Triggering TikTok hashtag scrape...')
    const { runId } = await triggerTiktokHashtagScrape()
    _pendingRunId      = runId
    _pendingRunStartAt = new Date()

  } catch (err) {
    console.error('[LeadAcquisition] Cycle error:', err.message)
    _pendingRunId = null; _pendingRunStartAt = null
  }
}

function startLeadAcquisitionEngine() {
  const INTERVAL_MS = 30 * 60 * 1000   // 30 min

  // First cycle after 3 minutes (let server boot + other services start)
  setTimeout(runAcquisitionCycle, 3 * 60 * 1000)

  setInterval(runAcquisitionCycle, INTERVAL_MS)
  console.log('[LeadAcquisition] Engine started — 30-min cycle, first run in 3 min')
}

// ── Stats (used by Command Center) ───────────────────────────────────────────

async function getAcquisitionStats() {
  const now   = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const [scrapedToday, highIntentToday, pendingOutreach, processedTotal, totalScraped] =
    await Promise.all([
      prisma.scrapedLead.count({ where: { createdAt: { gte: today } } }),
      prisma.scrapedLead.count({ where: { createdAt: { gte: today }, intentScore: { gte: 70 } } }),
      prisma.scrapedLead.count({ where: { outreachQueued: true, processed: false } }),
      prisma.scrapedLead.count({ where: { processed: true } }),
      prisma.scrapedLead.count(),
    ])

  return {
    scrapedToday,
    highIntentToday,
    pendingOutreach,
    processedTotal,
    totalScraped,
    engineStatus: _pendingRunId ? 'running' : 'idle',
  }
}

module.exports = {
  startLeadAcquisitionEngine,
  runAcquisitionCycle,
  getAcquisitionStats,
  processRawItems,
}
