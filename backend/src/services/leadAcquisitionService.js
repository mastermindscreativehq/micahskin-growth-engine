'use strict'

/**
 * leadAcquisitionService.js
 * Phase 32 — Lead Acquisition Engine
 * Phase 35 — Pain-point-first Nigerian discovery (was hashtag-first)
 *
 * Every 6 hours:
 *   1. Pick the next un-scraped pain-point batch (24h reuse block)
 *   2. Trigger Apify TikTok scraper with that batch (≤150 items per run)
 *   3. Poll until complete (on next tick)
 *   4. Filter for pain / intent signals
 *   5. Score 0–100 and classify concern type
 *   6. Store in scraped_leads table
 *   7. Inject scoring >= 50 into the leads table
 *   8. Queue scoring >= 70 for manual outreach (appears in Command Center hot queue)
 */

const prisma = require('../lib/prisma')
const {
  triggerTiktokHashtagScrape,
  getTiktokRunStatus,
  fetchTiktokItems,
  normaliseTiktokItem,
  // Phase 36 — chained comments scraper
  triggerTiktokCommentsScrape,
  normaliseTiktokCommentItem,
} = require('./tiktokScraperService')
const {
  getNextPainBatch,
  getRecentBatchSnapshot,
} = require('../config/painPointQueries')

// ── Phase 33 — MAIE intelligence services ─────────────────────────────────────
const nigeriaSignal       = require('./nigeriaSignalService')
const leadPsychology      = require('./leadPsychologyService')
const leadHeatEngine      = require('./leadHeatEngine')
const leadSegmentation    = require('./leadSegmentationService')
const outreachIntelligence = require('./outreachIntelligenceService')

// ── Phase 34 — MCE (read MAIE outputs, never modify them) ─────────────────────
const mceRouter         = require('./mce/conversationRouter')
const mceWhatsAppBridge = require('./mce/whatsappBridgeService')

// ── Phase 35 — Pain Signal Classifier + buyer readiness + quality gate ───────
const painSignalClassifier = require('./painSignalClassifierService')
const buyerReadiness       = require('./buyerReadinessService')
const leadQualityGate      = require('./leadQualityGateService')

// ── Phase 36 — Outreach queue counts ─────────────────────────────────────────
const { getOutreachCounts } = require('./outreachQueueService')

// Toggleable behaviour — when MAIE_REJECT_NON_NIGERIAN=true, leads with
// nigeriaConfidence < 18 are auto-rejected even if heat is high. Default is
// false so we don't suddenly reject existing global English-language traffic.
const REJECT_NON_NIGERIAN =
  String(process.env.MAIE_REJECT_NON_NIGERIAN || '').toLowerCase() === 'true'

// ── Phase 35 — Credit-protection config ───────────────────────────────────────
//
// Resolved once on module load so every cycle uses the same numbers and the
// dashboard can advertise them. Defaults are deliberately conservative — the
// goal is to stop burning Apify credits, not to maximise throughput.

const INTERVAL_HOURS_DEFAULT = 6
const MAX_ITEMS_DEFAULT      = 100
const MAX_ITEMS_HARD_CEILING = 150

function _resolveIntervalHours() {
  const raw = Number(process.env.LEAD_ACQUISITION_INTERVAL_HOURS)
  if (!Number.isFinite(raw) || raw <= 0) return INTERVAL_HOURS_DEFAULT
  // Clamp 1h..24h — anything outside that range is misconfiguration.
  return Math.min(24, Math.max(1, Math.round(raw)))
}

function _resolveMaxItems() {
  const raw = Number(process.env.APIFY_MAX_ITEMS_PER_RUN)
  if (!Number.isFinite(raw) || raw <= 0) return MAX_ITEMS_DEFAULT
  return Math.min(MAX_ITEMS_HARD_CEILING, Math.max(30, Math.round(raw)))
}

function _resolveAcquisitionMode() {
  const raw = String(process.env.ACQUISITION_MODE || 'pain_point_first').toLowerCase().trim()
  return raw === 'hashtag_backup' ? 'hashtag_backup' : 'pain_point_first'
}

const INTERVAL_HOURS    = _resolveIntervalHours()
const INTERVAL_MS       = INTERVAL_HOURS * 60 * 60 * 1000
const MAX_ITEMS_PER_RUN = _resolveMaxItems()
const ACQUISITION_MODE  = _resolveAcquisitionMode()
const CREDITS_PROTECTION_ACTIVE =
  INTERVAL_HOURS >= INTERVAL_HOURS_DEFAULT && MAX_ITEMS_PER_RUN <= MAX_ITEMS_HARD_CEILING

console.log(
  `[LeadAcquisition] Config — mode=${ACQUISITION_MODE}` +
  ` intervalHours=${INTERVAL_HOURS}` +
  ` maxItemsPerRun=${MAX_ITEMS_PER_RUN}` +
  ` creditsProtection=${CREDITS_PROTECTION_ACTIVE ? 'active' : 'relaxed'}`,
)

// ── In-memory run state ───────────────────────────────────────────────────────
//
// Explicit state machine — replaces the old "_pendingRunId ? running : idle"
// inference, which left the dashboard stuck on "Scrape in progress…" any time
// an Apify run hung past the 30-min poll window.

const STATE = {
  state:             'idle',   // 'idle' | 'running' | 'completed' | 'failed'
  running:           false,    // strict: true only while a real run is in flight
  pendingRunId:      null,
  runStartedAt:      null,     // Date | null
  lastRunAt:         null,     // Date | null — when the most recent run started
  lastRunFinishedAt: null,     // Date | null — when it ended (any terminal status)
  lastStatus:        null,     // last terminal Apify status string
  lastStale:         false,    // true if the last reset was a failsafe-timeout reset
  // ── Phase 35 — batch + cycle visibility ────────────────────────────────────
  lastBatch:         null,     // { mode, batch:[], phrases:[], key, ranAt }
  itemsThisCycle:    0,        // raw items fetched in the current/most-recent run
  nextRunAt:         null,     // Date — when scheduler will fire next
  // ── Phase 36 — comment-first chained run state ─────────────────────────────
  stage:             'video',  // 'video' | 'comments' — which actor we're polling
  commentsRunId:     null,     // Apify runId for the chained comments actor
  pendingPostUrls:   [],       // post URLs collected from the video stage
}

// Failsafe — anything still flagged "running" beyond this is treated as stale
// and force-reset to idle, regardless of whether Apify ever reports back.
const STALE_TIMEOUT_MS = 15 * 60 * 1000   // 15 min

function _refreshNextRunAt() {
  if (STATE.lastRunAt) {
    STATE.nextRunAt = new Date(STATE.lastRunAt.getTime() + INTERVAL_MS)
  } else {
    STATE.nextRunAt = new Date(Date.now() + INTERVAL_MS)
  }
}

function _resetIdle({ stale = false } = {}) {
  STATE.state             = 'idle'
  STATE.running           = false
  STATE.pendingRunId      = null
  STATE.runStartedAt      = null
  STATE.lastRunFinishedAt = new Date()
  STATE.lastStale         = stale
  STATE.stage             = 'video'
  STATE.commentsRunId     = null
  STATE.pendingPostUrls   = []
  _refreshNextRunAt()
}

function _markCompleted() {
  STATE.state             = 'completed'
  STATE.running           = false
  STATE.pendingRunId      = null
  STATE.runStartedAt      = null
  STATE.lastRunFinishedAt = new Date()
  STATE.lastStatus        = 'SUCCEEDED'
  STATE.lastStale         = false
  STATE.stage             = 'video'
  STATE.commentsRunId     = null
  STATE.pendingPostUrls   = []
  _refreshNextRunAt()
}

function _markFailed(status) {
  STATE.state             = 'failed'
  STATE.running           = false
  STATE.pendingRunId      = null
  STATE.runStartedAt      = null
  STATE.lastRunFinishedAt = new Date()
  STATE.lastStatus        = status || 'FAILED'
  STATE.lastStale         = false
  STATE.stage             = 'video'
  STATE.commentsRunId     = null
  STATE.pendingPostUrls   = []
  _refreshNextRunAt()
}

function _checkStale() {
  if (!STATE.running || !STATE.runStartedAt) return false
  const age = Date.now() - STATE.runStartedAt.getTime()
  if (age > STALE_TIMEOUT_MS) {
    console.warn(
      `[LeadAcquisition] Failsafe — run flagged running for ${Math.round(age / 60000)} min` +
      ` without updates; force-reset to idle (stale=true) runId=${STATE.pendingRunId}`,
    )
    _resetIdle({ stale: true })
    return true
  }
  return false
}

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
  /^[\p{Emoji}\s\p{P}]{1,15}$/u,    // emoji-/punctuation-only
  /^(\s*#\w+\s*)+$/,                 // hashtag-only comment
  /^@\w+(\s+@\w+)*\s*$/,             // pure @-mentions
  /follow\s+(me|back|us|for\s+follow)/i,
  /follow\s*4\s*follow/i,
  /check\s+(my|out\s+my)\s+(profile|page|bio)/i,
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
  // Generic praise / engagement-bait that has no buyer or pain signal
  /^(love\s+(it|this|u|you)!*|nice|wow|cute|beautiful|amazing|gorgeous|stunning|so\s+pretty|❤️*|👏+|🔥+|💯+|preach|facts|true|exactly|same(\s+here)?|me\s+too)\s*\.*\!*$/i,
  /^(first|second|early|here\s+early|notification\s+squad)\s*\!*$/i,
  /^(👇|☝️|✨)+$/u,
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

/**
 * Inject a scraped item into the main `leads` table.
 * Accepts the persisted ScrapedLead row plus the MAIE outreach copy generated
 * during scoring. MAIE-derived fields slot into existing Lead columns
 * (suggestedReply / primaryConcern / urgencyLevel / academyIntentScore etc.) so
 * downstream flows (diagnosis engine, conversion engine, conversation brain)
 * keep working unchanged.
 */
async function injectToLead(scrapedLead, outreach = null) {
  const username   = scrapedLead.username || 'unknown'
  const concern    = scrapedLead.concernType || 'general'
  const skinLabel  = concern.replace(/_/g, ' ')

  const heat = Number(scrapedLead.leadHeatScore ?? scrapedLead.intentScore ?? 0)
  const productScore = Math.round(heat)
  const consultScore = Math.round(heat * 0.6)
  const academyScore = leadSegmentation.isAcademySegment(scrapedLead.leadSegment)
    ? Math.round(Math.max(60, heat))
    : Math.round(heat * 0.4)

  // Phase 36 — priority is hot|warm|low based on relaxed thresholds
  const priority =
    leadHeatEngine.isHot(heat)  ? 'high'
    : leadHeatEngine.isWarm(heat) ? 'medium'
    : 'low'

  const lead = await prisma.lead.create({
    data: {
      fullName:           `@${username} (TikTok)`,
      sourcePlatform:     'tiktok',
      sourceType:         'scraped',
      skinConcern:        skinLabel,
      message:            scrapedLead.comment,
      handle:             username,
      status:             'new',
      priority,
      productIntentScore: productScore,
      consultIntentScore: consultScore,
      academyIntentScore: academyScore,
      primaryConcern:     concern,
      urgencyLevel:       scrapedLead.urgencyLevel,
      leadStage:          'new',
      lastInteractionAt:  new Date(),
      suggestedReply:     outreach?.suggestedReply || null,
      followupAngle:      outreach?.outreachAngle  || null,
      monetizationReason: scrapedLead.leadSegment
        ? `MAIE segment=${scrapedLead.leadSegment} heat=${productScore}`
        : null,
    },
  })

  return lead.id
}

// ── Batch processor ───────────────────────────────────────────────────────────

/**
 * processRawItems
 *
 * @param {object[]} rawItems
 * @param {object} [opts]
 * @param {(item:any)=>any} [opts.normaliser]   Defaults to normaliseTiktokItem (video shape).
 *                                             Pass normaliseTiktokCommentItem for comment items.
 * @param {boolean} [opts.defaultIsComment]    Stamped onto every persisted row.
 *                                             Default: false (treat as creator caption).
 */
async function processRawItems(rawItems, opts = {}) {
  const normaliser       = opts.normaliser || normaliseTiktokItem
  const defaultIsComment = Boolean(opts.defaultIsComment)
  const stats = {
    total:      rawItems.length,
    normalised: 0,
    stored:     0,   // saved to scraped_leads
    nigerian:   0,   // nigeriaConfidence >= 30
    accepted:   0,   // passed all gates → injected into leads
    injected:   0,
    queued:     0,   // heat >= 70 → outreachQueued
    rejected:   0,
    captionsRejected: 0,  // Phase 36 — captions skipped for lacking buyer intent
    reasons: {
      norm_failed:    0,  // normaliseTiktokItem returned null / empty text
      duplicate:      0,
      spam:           0,  // legacy spam filter
      fake_profile:   0,  // MAIE authenticity floor
      low_intent:     0,  // MAIE pain+buyer floor
      non_nigerian:   0,
      low_heat:       0,  // heat < 50 — stored, not injected
    },
    // Aggregations for the cycle summary log
    topSegments: {},
    topCities:   {},
    topPainTags: {},
    topAngles:   {},
    // ── Phase 35 — pain signal + buyer readiness aggregations ─────────────
    painSignalLeads:  0,   // painSignalScore >= 25
    buyerReadyLeads:  0,   // buyerReadinessScore >= 45
    hotBuyerLeads:    0,   // leadQuality === 'hot'
    rejectedLowQuality: 0, // leadQuality === 'reject' from quality gate
    topPainPhrases:   {},
    topBuyerPhrases: {},
    actionBreakdown:  {},
  }

  for (const raw of rawItems) {
    const norm = normaliser(raw)
    if (!norm || !norm.text?.trim()) {
      stats.reasons.norm_failed++
      stats.rejected++
      continue
    }
    stats.normalised++

    // Phase 36 — fast spam pre-filter. Drops hashtag-only, follower-farming,
    // emoji-only, link-spam, and generic-praise rows before any scoring.
    if (REJECT_PATTERNS.some(p => p.test(norm.text))) {
      stats.reasons.spam++
      stats.rejected++
      console.log(`[LeadAcquisition] SPAM filtered @${norm.username || 'unknown'} text="${norm.text.slice(0, 60)}"`)
      continue
    }

    // Phase 36 — distinguish commenters from creators. Caption-only items
    // (isComment=false) only proceed when they carry obvious buyer intent —
    // we don't want to keep ingesting creator promotional captions.
    const isComment =
      typeof norm.isComment === 'boolean' ? norm.isComment : defaultIsComment

    // ── Duplicate check (must run before any expensive work) ───────────────
    let isDup = false
    if (norm.externalId) {
      const exists = await prisma.scrapedLead.findUnique({
        where: { externalId: norm.externalId },
        select: { id: true },
      })
      if (exists) isDup = true
    }
    if (isDup) {
      stats.reasons.duplicate++
      stats.rejected++
      continue
    }

    // ── Phase 33 — MAIE intelligence pipeline ───────────────────────────────
    const corpus = norm.text

    const ngResult = nigeriaSignal.detect(corpus, {
      username: norm.username,
      hashtag:  norm.hashtag,
    })
    console.log(
      `[NigeriaDetector] @${norm.username || 'unknown'}` +
      ` confidence=${ngResult.nigeriaConfidence}` +
      ` city=${ngResult.detectedCity || '—'}` +
      ` lang=${ngResult.detectedLanguage || '—'}` +
      ` signals=${ngResult.locationSignals.length}`,
    )
    if (ngResult.nigeriaConfidence >= 30) stats.nigerian++

    const psychResult = leadPsychology.analyze(corpus)
    console.log(
      `[Psychology] @${norm.username || 'unknown'}` +
      ` pain=${psychResult.painScore}` +
      ` urgency=${psychResult.urgencyScore}` +
      ` buyer=${psychResult.buyerIntentScore}` +
      ` emotion=${psychResult.emotionalIntensity}` +
      ` auth=${psychResult.authenticityScore}`,
    )

    const segmentResult = leadSegmentation.classify(corpus, {
      username: norm.username,
      hashtag:  norm.hashtag,
    })
    console.log(
      `[Segmentation] @${norm.username || 'unknown'}` +
      ` segment=${segmentResult.segment}` +
      ` confidence=${segmentResult.segmentConfidence}` +
      ` secondary=[${segmentResult.secondarySegments.join(',')}]`,
    )

    // ── Phase 35 — Pain Signal Classifier ────────────────────────────────
    // Runs after MAIE psychology/segmentation, before the heat decision and
    // persistence. Pure functions, no I/O — adds ~1ms per item.
    const painClassification = painSignalClassifier.classify(corpus)
    const buyerResult = buyerReadiness.evaluate(corpus, {
      painClassification,
      segmentation: segmentResult,
    })
    const qualityGate = leadQualityGate.evaluate({
      painClassification,
      buyerReadiness: buyerResult,
      nigeriaSignal:  ngResult,
      segmentation:   segmentResult,
    })
    console.log(
      `[PainSignal] @${norm.username || 'unknown'}` +
      ` score=${painClassification.painSignalScore}` +
      ` buyer=${buyerResult.buyerReadinessScore}` +
      ` quality=${qualityGate.leadQuality}` +
      ` action=${qualityGate.recommendedAction}`,
    )

    const heatResult = leadHeatEngine.evaluate({
      nigeria:      ngResult,
      psychology:   psychResult,
      segmentation: segmentResult,
      engagement:   { likes: raw?.diggCount || raw?.likes, comments: raw?.commentCount },
      duplicate:    false,
      rejectNonNigerian: REJECT_NON_NIGERIAN,
    })
    console.log(
      `[LeadHeat] @${norm.username || 'unknown'}` +
      ` heat=${heatResult.leadHeatScore}` +
      ` reject=${heatResult.rejectionReason || 'none'}` +
      ` ${heatResult.rejectionDetail || ''}`,
    )

    // Outreach copy — generated for everyone we'll persist (lets the dashboard
    // surface a suggestedReply even on stored-only items).
    const outreach = outreachIntelligence.generate({
      text:         corpus,
      nigeria:      ngResult,
      psychology:   psychResult,
      segmentation: segmentResult,
      username:     norm.username,
      externalId:   norm.externalId,
      painCategory: leadSegmentation.mapToConcernType(segmentResult.segment),
    })
    console.log(
      `[OutreachAI] @${norm.username || 'unknown'}` +
      ` angle=${outreach.outreachAngle}` +
      ` summary="${outreach.aiSummary}"`,
    )

    // ── Legacy compatibility — keep intentScore + concernType populated ─────
    const legacyConcern  = leadSegmentation.mapToConcernType(segmentResult.segment)
    const legacyIntent   = scoreComment(corpus)
    const urgencyLabel   = (() => {
      if ((psychResult.urgencyScore ?? 0) >= 30 || heatResult.leadHeatScore >= 70) return 'high'
      if (heatResult.leadHeatScore >= 40) return 'medium'
      return 'low'
    })()

    const safeStr = (v) =>
      v == null ? null
        : typeof v === 'string' ? (v.trim() || null)
        : typeof v === 'object' ? (v.name || v.title || v.uniqueId || v.id || null)
        : String(v)

    // ── Phase 36 — caption guard ────────────────────────────────────────────
    // Creator captions almost never carry buyer pain; reject unless a hard
    // buyer/pain signal (≥ 35 either way OR explicit price/location/recommend
    // ask) fires. Comments bypass this gate.
    if (!isComment) {
      const hardBuyer =
        (psychResult.buyerIntentScore ?? 0) >= 35 ||
        (psychResult.painScore ?? 0)        >= 40 ||
        Boolean(buyerResult.hasPriceQuestion) ||
        Boolean(buyerResult.hasLocationQuestion) ||
        Boolean(buyerResult.hasRecommendAsk)
      if (!hardBuyer) {
        stats.captionsRejected++
        stats.rejected++
        console.log(
          `[LeadAcquisition] CAPTION skipped @${norm.username || 'unknown'}` +
          ` pain=${psychResult.painScore} buy=${psychResult.buyerIntentScore}`,
        )
        continue
      }
    }

    // ── Persist scraped item with the full MAIE payload ─────────────────────
    let saved
    try {
      saved = await prisma.scrapedLead.create({
        data: {
          platform:     'tiktok',
          username:     safeStr(norm.username),
          comment:      norm.text,
          videoUrl:     safeStr(norm.videoUrl),
          hashtag:      safeStr(norm.hashtag),
          externalId:   norm.externalId || null,
          postedAt:     norm.postedAt,
          // Phase 36 — comment vs caption + multi-CTA pack
          isComment:    isComment,
          sourceVideoUrl: safeStr(norm.sourceVideoUrl || norm.videoUrl),
          whatsappCta:  outreach.whatsappCta || null,
          consultCta:   outreach.consultCta  || null,
          academyCta:   outreach.academyCta  || null,
          ctaType:      outreach.ctaType     || null,
          // legacy back-compat fields
          concernType:  legacyConcern,
          intentScore:  legacyIntent,
          urgencyLevel: urgencyLabel,
          processed:    false,

          // MAIE fields
          nigeriaConfidence:  ngResult.nigeriaConfidence,
          countryConfidence:  ngResult.countryConfidence,
          detectedCity:       ngResult.detectedCity,
          detectedCountry:    ngResult.detectedCountry,
          detectedLanguage:   ngResult.detectedLanguage,
          locationSignals:    ngResult.locationSignals,

          painScore:          psychResult.painScore,
          urgencyScore:       psychResult.urgencyScore,
          buyerIntentScore:   psychResult.buyerIntentScore,
          authenticityScore:  psychResult.authenticityScore,
          emotionalIntensity: psychResult.emotionalIntensity,
          painSignals:        psychResult.painSignals,
          buyerSignals:       psychResult.buyerSignals,

          leadHeatScore:      heatResult.leadHeatScore,
          leadSegment:        segmentResult.segment,
          rejectionReason:    heatResult.rejectionReason,

          aiSummary:          outreach.aiSummary,
          outreachAngle:      outreach.outreachAngle,

          // ── Phase 35 — Pain Signal Classifier persistence ────────────────
          painSignalScore:       Math.round(painClassification.painSignalScore),
          buyerReadinessScore:   Math.round(buyerResult.buyerReadinessScore),
          emotionalPainLevel:    Math.round(painClassification.emotionalPainLevel),
          problemAwarenessLevel: painClassification.problemAwarenessLevel,
          buyingStage:           buyerResult.buyingStage,
          matchedPainSignals:    painClassification.matchedPainSignals,
          matchedBuyerSignals:   buyerResult.matchedBuyerSignals,
          leadQuality:           qualityGate.leadQuality,
          leadQualityReason:     qualityGate.leadQualityReason,
          recommendedAction:     qualityGate.recommendedAction,
        },
      })
      stats.stored++

      // Aggregations for cycle summary
      stats.topSegments[segmentResult.segment] =
        (stats.topSegments[segmentResult.segment] || 0) + 1
      if (ngResult.detectedCity) {
        stats.topCities[ngResult.detectedCity] =
          (stats.topCities[ngResult.detectedCity] || 0) + 1
      }
      for (const tag of psychResult.painSignals) {
        stats.topPainTags[tag] = (stats.topPainTags[tag] || 0) + 1
      }
      stats.topAngles[outreach.outreachAngle] =
        (stats.topAngles[outreach.outreachAngle] || 0) + 1

      // ── Phase 35 — Pain Signal aggregations ────────────────────────────
      if (painClassification.painSignalScore >= 25) stats.painSignalLeads++
      if (buyerResult.buyerReadinessScore   >= 45) stats.buyerReadyLeads++
      if (qualityGate.leadQuality === 'hot')        stats.hotBuyerLeads++
      if (qualityGate.leadQuality === 'reject')     stats.rejectedLowQuality++

      for (const phrase of painClassification.painPhrases) {
        stats.topPainPhrases[phrase] = (stats.topPainPhrases[phrase] || 0) + 1
      }
      for (const phrase of buyerResult.buyerPhrases) {
        stats.topBuyerPhrases[phrase] = (stats.topBuyerPhrases[phrase] || 0) + 1
      }
      stats.actionBreakdown[qualityGate.recommendedAction] =
        (stats.actionBreakdown[qualityGate.recommendedAction] || 0) + 1

      // ── Phase 35 — Lead-quality gate audit log ─────────────────────────
      const gateOutcome = qualityGate.leadQuality === 'reject' ? 'rejected' : 'accepted'
      console.log(
        `[LeadQualityGate] ${gateOutcome}` +
        ` @${norm.username || 'unknown'}` +
        ` reason=${qualityGate.leadQualityReason}` +
        ` final=${qualityGate.finalScore}`,
      )
    } catch (dbErr) {
      if (dbErr.code === 'P2002') {
        stats.reasons.duplicate++
        stats.rejected++
        continue
      }
      throw dbErr
    }

    // ── Decide: inject vs. store-only vs. rejected ──────────────────────────
    if (heatResult.rejectionReason) {
      const r = heatResult.rejectionReason
      // Map the heat-engine reasons into our stats bucket; unknown reasons bucket as low_heat.
      if      (r === 'fake_profile') stats.reasons.fake_profile++
      else if (r === 'low_intent')   stats.reasons.low_intent++
      else if (r === 'non_nigerian') stats.reasons.non_nigerian++
      else if (r === 'low_heat')     stats.reasons.low_heat++
      else                            stats.reasons.low_heat++

      // low_heat is a "stored, not injected" outcome — not a hard reject for
      // counter purposes (matches the legacy `stored_only` semantics).
      if (r !== 'low_heat') stats.rejected++
      continue
    }

    // ── Inject into leads table ─────────────────────────────────────────────
    stats.accepted++
    try {
      const leadId = await injectToLead({ ...saved }, outreach)
      const isHot  = leadHeatEngine.isHot(heatResult.leadHeatScore)
      await prisma.scrapedLead.update({
        where: { id: saved.id },
        data:  { processed: true, injectedLeadId: leadId, outreachQueued: isHot },
      })

      // ── Phase 34 — MCE: assign route + generate WhatsApp CTA ─────────────
      // Reads MAIE outputs from `saved`. Never writes back to MAIE fields.
      // Failure here is logged, never throws upstream — MAIE pipeline is
      // unaffected if MCE breaks.
      try {
        const newLead = await prisma.lead.findUnique({ where: { id: leadId } })
        if (newLead) {
          await mceRouter.assign(newLead, {
            maie: {
              painScore:          saved.painScore,
              emotionalIntensity: saved.emotionalIntensity,
              urgencyScore:       saved.urgencyScore,
              leadSegment:        saved.leadSegment,
              detectedCity:       saved.detectedCity,
            },
          })
          // Refresh after router writes funnelType/budgetSignal/etc.
          const refreshed = await prisma.lead.findUnique({ where: { id: leadId } })
          if (refreshed) {
            await mceWhatsAppBridge.generateAndStoreCta(refreshed)
          }
        }
      } catch (mceErr) {
        console.error(`[MCE] post-injection hook failed leadId=${leadId}:`, mceErr.message)
      }

      stats.injected++
      if (isHot) {
        stats.queued++
        console.log(
          `[LeadAcquisition] HOT injected — @${norm.username || 'unknown'}` +
          ` heat=${heatResult.leadHeatScore}` +
          ` segment=${segmentResult.segment}` +
          ` ng=${ngResult.nigeriaConfidence}` +
          ` city=${ngResult.detectedCity || '—'}`,
        )
      }
    } catch (err) {
      console.error(`[LeadAcquisition] Inject failed for @${norm.username}:`, err.message)
    }
  }

  // ── End-of-cycle summary ─────────────────────────────────────────────────
  const topN = (obj, n = 5) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ') || '—'

  console.log('[LeadAcquisition] ─────────── Cycle Summary ───────────')
  console.log(
    `[LeadAcquisition] total=${stats.total} normalised=${stats.normalised}` +
    ` stored=${stats.stored} nigerian=${stats.nigerian}` +
    ` accepted=${stats.accepted} injected=${stats.injected} queued=${stats.queued}` +
    ` rejected=${stats.rejected}`,
  )
  console.log('[LeadAcquisition] Rejections:    ', stats.reasons)
  console.log('[LeadAcquisition] Top segments:  ', topN(stats.topSegments))
  console.log('[LeadAcquisition] Top NG cities: ', topN(stats.topCities))
  console.log('[LeadAcquisition] Top pain tags: ', topN(stats.topPainTags, 8))
  console.log('[LeadAcquisition] Top angles:    ', topN(stats.topAngles))
  // ── Phase 35 — Pain Signal Classifier summary ────────────────────────────
  console.log(
    `[LeadAcquisition] Pain/Buyer:    painLeads=${stats.painSignalLeads}` +
    ` buyerReady=${stats.buyerReadyLeads} hotBuyers=${stats.hotBuyerLeads}` +
    ` rejectedLowQuality=${stats.rejectedLowQuality}`,
  )
  console.log('[LeadAcquisition] Top pain phrases:  ', topN(stats.topPainPhrases, 8))
  console.log('[LeadAcquisition] Top buyer phrases: ', topN(stats.topBuyerPhrases, 8))
  console.log('[LeadAcquisition] Recommended action:', topN(stats.actionBreakdown))
  console.log('[LeadAcquisition] ──────────────────────────────────────')

  return stats
}

// ── Scheduler cycle ───────────────────────────────────────────────────────────

// Phase 36 — toggle for the chained comments actor. Default ON.
// Aggressive caps per operator rule: max 5 videos × 15 comments = 75/cycle.
const COMMENT_FIRST_ENABLED = String(process.env.TIKTOK_COMMENT_FIRST ?? 'true').toLowerCase() !== 'false'
const MAX_VIDEOS_FOR_COMMENTS = Math.max(1, Math.min(8, Number(process.env.TIKTOK_VIDEOS_FOR_COMMENTS) || 5))

async function runAcquisitionCycle() {
  if (!process.env.APIFY_API_TOKEN) {
    console.log('[LeadAcquisition] APIFY_API_TOKEN not set — skipping')
    return
  }

  try {
    // Failsafe runs first so a stuck run never blocks a fresh trigger
    if (_checkStale()) return

    if (STATE.running && STATE.pendingRunId) {
      const { status, defaultDatasetId } = await getTiktokRunStatus(STATE.pendingRunId)

      if (status === 'SUCCEEDED' && defaultDatasetId) {
        console.log(
          `[LeadAcquisition] ${STATE.stage} stage SUCCEEDED — runId=${STATE.pendingRunId}` +
          ` defaultDatasetId=${defaultDatasetId}`,
        )
        const rawItems = await fetchTiktokItems(defaultDatasetId)
        STATE.itemsThisCycle = rawItems.length
        console.log(
          `[LeadAcquisition] Raw item count from dataset: ${rawItems.length}` +
          ` (stage=${STATE.stage} cap=${MAX_ITEMS_PER_RUN})`,
        )

        if (STATE.stage === 'video') {
          // Phase 36 — chain to comments actor: collect post URLs from videos.
          // Captions are still processed (rare buyer-intent captions surface),
          // but the bulk of accepted leads now come from the comments stage.
          const captionStats = await processRawItems(rawItems, {
            normaliser:       normaliseTiktokItem,
            defaultIsComment: false,
          })
          console.log(
            `[LeadAcquisition] Caption pass — stored=${captionStats.stored}` +
            ` accepted=${captionStats.accepted} captionsRejected=${captionStats.captionsRejected}`,
          )

          const postUrls = []
          for (const raw of rawItems) {
            const n = normaliseTiktokItem(raw)
            if (n?.videoUrl) postUrls.push(n.videoUrl)
          }
          const uniqueUrls = [...new Set(postUrls)].slice(0, MAX_VIDEOS_FOR_COMMENTS)

          if (COMMENT_FIRST_ENABLED && uniqueUrls.length > 0) {
            try {
              const cmt = await triggerTiktokCommentsScrape(uniqueUrls, {
                commentsPerPost: Number(process.env.APIFY_COMMENTS_PER_VIDEO) || 15,
              })
              STATE.stage           = 'comments'
              STATE.pendingRunId    = cmt.runId
              STATE.commentsRunId   = cmt.runId
              STATE.runStartedAt    = new Date()
              STATE.pendingPostUrls = uniqueUrls
              console.log(
                `[LeadAcquisition] Comments stage queued — runId=${cmt.runId}` +
                ` videoCount=${uniqueUrls.length} commentsPerPost=${cmt.commentsPerPost}`,
              )
              return
            } catch (err) {
              console.error('[LeadAcquisition] Comments trigger failed:', err.message)
              // fall through and complete on caption pass alone
            }
          } else {
            console.log(
              `[LeadAcquisition] Comments stage skipped — enabled=${COMMENT_FIRST_ENABLED}` +
              ` urls=${uniqueUrls.length}`,
            )
          }
          _markCompleted()
          return
        }

        if (STATE.stage === 'comments') {
          const commentStats = await processRawItems(rawItems, {
            normaliser:       normaliseTiktokCommentItem,
            defaultIsComment: true,
          })
          console.log(
            `[LeadAcquisition] Comments pass — stored=${commentStats.stored}` +
            ` accepted=${commentStats.accepted} injected=${commentStats.injected}` +
            ` queued=${commentStats.queued} rejected=${commentStats.rejected}`,
          )
          _markCompleted()
          return
        }

      } else if (status === 'SUCCEEDED' && !defaultDatasetId) {
        console.warn(`[LeadAcquisition] Run SUCCEEDED but defaultDatasetId is missing — runId=${STATE.pendingRunId}`)
        _markFailed('SUCCEEDED_NO_DATASET')

      } else if (['FAILED', 'TIMED-OUT', 'ABORTED'].includes(status)) {
        console.warn(`[LeadAcquisition] Run ended with status=${status} runId=${STATE.pendingRunId}`)
        _markFailed(status)
      }
      // RUNNING / READY — wait for next tick (stale check above guards the upper bound)
      return
    }

    // ── No pending run — trigger a new cycle ──────────────────────────────────
    //
    // Phase 35 — pain-point-first by default. Hashtag pool stays available as a
    // backup channel by setting ACQUISITION_MODE=hashtag_backup.

    let triggerArg, modeLabel, painPicked
    if (ACQUISITION_MODE === 'hashtag_backup') {
      triggerArg = 'priority'           // delegate batch selection to hashtag config
      modeLabel  = 'hashtag_backup'
      console.log('[LeadAcquisition] Mode=hashtag_backup — using rotating hashtag pool')
    } else {
      painPicked = getNextPainBatch()
      triggerArg = painPicked.batch
      modeLabel  = 'pain_point_first'
      console.log(
        `[LeadAcquisition] Mode=pain_point_first — batch (${painPicked.batch.length}):` +
        ` [${painPicked.phrases.join(' | ')}]` +
        (painPicked.forced ? ' (forced — all batches recently used)' : ''),
      )
    }

    const { runId, hashtags, maxItems, runMode } = await triggerTiktokHashtagScrape(
      triggerArg,
      { maxItems: MAX_ITEMS_PER_RUN, modeLabel },
    )

    const now = new Date()
    STATE.state          = 'running'
    STATE.running        = true
    STATE.stage          = 'video'
    STATE.commentsRunId  = null
    STATE.pendingPostUrls = []
    STATE.pendingRunId   = runId
    STATE.runStartedAt   = now
    STATE.lastRunAt      = now
    STATE.lastStale      = false
    STATE.itemsThisCycle = 0
    STATE.lastBatch      = {
      mode:     modeLabel,
      runMode,                                     // resolved by scraper (e.g. 'priority' fallback)
      hashtags: hashtags || [],
      phrases:  painPicked ? painPicked.phrases : (hashtags || []),
      key:      painPicked ? painPicked.key : null,
      maxItems,
      ranAt:    now.toISOString(),
    }
    STATE.nextRunAt = new Date(now.getTime() + INTERVAL_MS)
    console.log(
      `[LeadAcquisition] Run queued — runId=${runId}` +
      ` mode=${modeLabel} maxItems=${maxItems}` +
      ` nextRunAt=${STATE.nextRunAt.toISOString()}`,
    )

  } catch (err) {
    console.error('[LeadAcquisition] Cycle error:', err.message)
    _markFailed('CYCLE_ERROR')
  }
}

function startLeadAcquisitionEngine() {
  // First cycle after 3 minutes (let server boot + other services start)
  const firstRunAt = new Date(Date.now() + 3 * 60 * 1000)
  STATE.nextRunAt = firstRunAt

  setTimeout(runAcquisitionCycle, 3 * 60 * 1000)
  setInterval(runAcquisitionCycle, INTERVAL_MS)

  console.log(
    `[LeadAcquisition] Engine started — ${INTERVAL_HOURS}-hour cycle,` +
    ` first run in 3 min (mode=${ACQUISITION_MODE}, maxItems=${MAX_ITEMS_PER_RUN})`,
  )
}

// ── Stats (used by Command Center) ───────────────────────────────────────────

async function getAcquisitionStats() {
  // Run the failsafe on read too — if the page is loaded after a stuck run
  // exceeded the 15-min window, we collapse it to idle before reporting state.
  _checkStale()

  const now   = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // Headline counters
  const [scrapedToday, highIntentToday, pendingOutreach, processedTotal, totalScraped, nigerianTotal, highHeatTotal] =
    await Promise.all([
      prisma.scrapedLead.count({ where: { createdAt: { gte: today } } }),
      // Use leadHeatScore when present, fall back to legacy intentScore for back-compat
      prisma.scrapedLead.count({
        where: {
          createdAt: { gte: today },
          OR: [
            { leadHeatScore: { gte: 70 } },
            { AND: [{ leadHeatScore: null }, { intentScore: { gte: 70 } }] },
          ],
        },
      }),
      prisma.scrapedLead.count({ where: { outreachQueued: true, processed: false } }),
      prisma.scrapedLead.count({ where: { processed: true } }),
      prisma.scrapedLead.count(),
      prisma.scrapedLead.count({ where: { nigeriaConfidence: { gte: 30 } } }),
      prisma.scrapedLead.count({ where: { leadHeatScore: { gte: 70 } } }),
    ])

  // ── Phase 35 — Pain Signal Classifier counters + breakdowns ──────────────
  // Defensive: each query may fail if the migration hasn't run. We swallow
  // errors and return zeros so the dashboard still renders.
  let painSignalLeads     = 0
  let buyerReadyLeads     = 0
  let hotBuyerLeads       = 0
  let rejectedLowQuality  = 0
  let topPainPhrases      = []
  let topBuyerPhrases     = []
  let actionBreakdown     = []
  let qualityBreakdown    = []
  let stageBreakdown      = []
  try {
    [painSignalLeads, buyerReadyLeads, hotBuyerLeads, rejectedLowQuality] = await Promise.all([
      prisma.scrapedLead.count({ where: { painSignalScore:     { gte: 25 } } }),
      prisma.scrapedLead.count({ where: { buyerReadinessScore: { gte: 45 } } }),
      prisma.scrapedLead.count({ where: { leadQuality: 'hot' } }),
      prisma.scrapedLead.count({ where: { leadQuality: 'reject' } }),
    ])

    const [actionGroups, qualityGroups, stageGroups] = await Promise.all([
      prisma.scrapedLead.groupBy({
        by: ['recommendedAction'],
        where: { recommendedAction: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { recommendedAction: 'desc' } },
        take: 10,
      }),
      prisma.scrapedLead.groupBy({
        by: ['leadQuality'],
        where: { leadQuality: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { leadQuality: 'desc' } },
        take: 10,
      }),
      prisma.scrapedLead.groupBy({
        by: ['buyingStage'],
        where: { buyingStage: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { buyingStage: 'desc' } },
        take: 10,
      }),
    ])

    actionBreakdown = actionGroups.map(g => ({
      action: g.recommendedAction, count: g._count._all,
    }))
    qualityBreakdown = qualityGroups.map(g => ({
      quality: g.leadQuality, count: g._count._all,
    }))
    stageBreakdown = stageGroups.map(g => ({
      stage: g.buyingStage, count: g._count._all,
    }))

    // Top pain / buyer phrases — aggregated from JSON columns. We pull the
    // most-recent N rows and tally in memory; cheaper than a DB-side jsonb
    // unnest and works on any Postgres version.
    const [recentPain, recentBuyer] = await Promise.all([
      prisma.scrapedLead.findMany({
        where: {
          matchedPainSignals: { not: null },
          createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
        },
        select: { matchedPainSignals: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      prisma.scrapedLead.findMany({
        where: {
          matchedBuyerSignals: { not: null },
          createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
        },
        select: { matchedBuyerSignals: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ])

    const painTally  = {}
    const buyerTally = {}
    for (const row of recentPain) {
      const list = Array.isArray(row.matchedPainSignals) ? row.matchedPainSignals : []
      for (const sig of list) {
        const key = sig?.phrase || sig?.tag
        if (!key) continue
        painTally[key] = (painTally[key] || 0) + 1
      }
    }
    for (const row of recentBuyer) {
      const list = Array.isArray(row.matchedBuyerSignals) ? row.matchedBuyerSignals : []
      for (const sig of list) {
        const key = sig?.phrase || sig?.tag
        if (!key) continue
        buyerTally[key] = (buyerTally[key] || 0) + 1
      }
    }
    topPainPhrases = Object.entries(painTally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([phrase, count]) => ({ phrase, count }))
    topBuyerPhrases = Object.entries(buyerTally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([phrase, count]) => ({ phrase, count }))
  } catch (err) {
    console.warn('[LeadAcquisition] Pain-signal breakdowns unavailable:', err.message)
  }

  // ── MAIE breakdowns — groupBy aggregations for the dashboard ─────────────
  // All wrapped in a defensive try block: if these columns don't exist yet
  // (i.e. migration hasn't been run), we still return the headline counters.
  let segmentBreakdown = []
  let cityBreakdown    = []
  let rejectionBreakdown = []
  let painBreakdownByConcern = []
  let academyLeadCount = 0
  let consultLeadCount = 0
  try {
    const [segGroups, cityGroups, rejGroups, concernGroups] = await Promise.all([
      prisma.scrapedLead.groupBy({
        by: ['leadSegment'],
        where: { leadSegment: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { leadSegment: 'desc' } },
        take: 12,
      }),
      prisma.scrapedLead.groupBy({
        by: ['detectedCity'],
        where: { detectedCity: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { detectedCity: 'desc' } },
        take: 10,
      }),
      prisma.scrapedLead.groupBy({
        by: ['rejectionReason'],
        where: { rejectionReason: { not: null }, createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
        _count: { _all: true },
        orderBy: { _count: { rejectionReason: 'desc' } },
        take: 10,
      }),
      prisma.scrapedLead.groupBy({
        by: ['concernType'],
        where: { concernType: { not: null }, leadHeatScore: { gte: 50 } },
        _count: { _all: true },
        orderBy: { _count: { concernType: 'desc' } },
        take: 10,
      }),
    ])

    segmentBreakdown = segGroups.map(g => ({
      segment: g.leadSegment,
      count:   g._count._all,
    }))
    cityBreakdown = cityGroups.map(g => ({
      city:  g.detectedCity,
      count: g._count._all,
    }))
    rejectionBreakdown = rejGroups.map(g => ({
      reason: g.rejectionReason,
      count:  g._count._all,
    }))
    painBreakdownByConcern = concernGroups.map(g => ({
      concern: g.concernType,
      count:   g._count._all,
    }))

    // Funnel tallies — count leads in academy / consult buckets
    academyLeadCount = segmentBreakdown
      .filter(s => ['academy', 'reseller', 'entrepreneur', 'skincare_business'].includes(s.segment))
      .reduce((sum, s) => sum + s.count, 0)
    consultLeadCount = segmentBreakdown
      .filter(s => s.segment === 'consultation')
      .reduce((sum, s) => sum + s.count, 0)
  } catch (err) {
    // Most likely the migration hasn't run yet. Log once and return defaults.
    console.warn('[LeadAcquisition] MAIE breakdowns unavailable:', err.message)
  }

  const acquisitionStatus = {
    state:             STATE.state,
    running:           STATE.running,
    pendingRunId:      STATE.pendingRunId,
    runStartedAt:      STATE.runStartedAt      ? STATE.runStartedAt.toISOString()      : null,
    lastRunAt:         STATE.lastRunAt         ? STATE.lastRunAt.toISOString()         : null,
    lastRunFinishedAt: STATE.lastRunFinishedAt ? STATE.lastRunFinishedAt.toISOString() : null,
    lastStatus:        STATE.lastStatus,
    stale:             STATE.lastStale,

    // ── Phase 35 — pain-point + credit-protection visibility ───────────────
    mode:                ACQUISITION_MODE,         // 'pain_point_first' | 'hashtag_backup'
    intervalHours:       INTERVAL_HOURS,           // e.g. 6
    maxItemsPerRun:      MAX_ITEMS_PER_RUN,        // e.g. 100
    creditsProtection:   CREDITS_PROTECTION_ACTIVE ? 'active' : 'relaxed',
    nextRunAt:           STATE.nextRunAt ? STATE.nextRunAt.toISOString() : null,
    itemsThisCycle:      STATE.itemsThisCycle ?? 0,
    lastBatch:           STATE.lastBatch,
    recentBatchesBlocked: getRecentBatchSnapshot().length,
  }

  // ── Phase 36 — outreach queue conversion counts ──────────────────────────
  let outreachCounts = {
    readyToReply: 0, replied: 0, converted: 0, skipped: 0,
    pendingByTemperature: { hot: 0, warm: 0, cold: 0 },
    thresholds: {
      hot:  leadHeatEngine.HOT_THRESHOLD,
      warm: leadHeatEngine.WARM_THRESHOLD,
      cold: leadHeatEngine.COLD_THRESHOLD,
    },
  }
  try {
    outreachCounts = await getOutreachCounts()
  } catch (err) {
    console.warn('[LeadAcquisition] Outreach counts unavailable:', err.message)
  }

  return {
    scrapedToday,
    highIntentToday,
    pendingOutreach,
    processedTotal,
    totalScraped,
    // Phase 36 — Conversion-focused headline
    outreachCounts,
    // ── Phase 33 — MAIE headline counters ─────────────────────────────────
    nigerianTotal,
    highHeatTotal,
    academyLeadCount,
    consultLeadCount,
    // ── Phase 33 — MAIE breakdowns ────────────────────────────────────────
    segmentBreakdown,
    cityBreakdown,
    rejectionBreakdown,
    painBreakdownByConcern,
    // ── Phase 35 — Pain Signal Classifier counters + breakdowns ──────────
    painSignalLeads,
    buyerReadyLeads,
    hotBuyerLeads,
    rejectedLowQuality,
    topPainPhrases,
    topBuyerPhrases,
    actionBreakdown,
    qualityBreakdown,
    stageBreakdown,
    acquisitionStatus,
    // Back-compat for any older consumer — derived strictly from `running`,
    // never inferred from a lingering pendingRunId.
    engineStatus: acquisitionStatus.running ? 'running' : 'idle',
  }
}

module.exports = {
  startLeadAcquisitionEngine,
  runAcquisitionCycle,
  getAcquisitionStats,
  processRawItems,
}
