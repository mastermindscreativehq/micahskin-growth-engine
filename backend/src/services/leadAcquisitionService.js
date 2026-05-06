'use strict'

/**
 * leadAcquisitionService.js
 * Phase 32 — Lead Acquisition Engine
 *
 * Every 3 hours:
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

// ── Phase 33 — MAIE intelligence services ─────────────────────────────────────
const nigeriaSignal       = require('./nigeriaSignalService')
const leadPsychology      = require('./leadPsychologyService')
const leadHeatEngine      = require('./leadHeatEngine')
const leadSegmentation    = require('./leadSegmentationService')
const outreachIntelligence = require('./outreachIntelligenceService')

// ── Phase 34 — MCE (read MAIE outputs, never modify them) ─────────────────────
const mceRouter         = require('./mce/conversationRouter')
const mceWhatsAppBridge = require('./mce/whatsappBridgeService')

// Toggleable behaviour — when MAIE_REJECT_NON_NIGERIAN=true, leads with
// nigeriaConfidence < 18 are auto-rejected even if heat is high. Default is
// false so we don't suddenly reject existing global English-language traffic.
const REJECT_NON_NIGERIAN =
  String(process.env.MAIE_REJECT_NON_NIGERIAN || '').toLowerCase() === 'true'

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
}

// Failsafe — anything still flagged "running" beyond this is treated as stale
// and force-reset to idle, regardless of whether Apify ever reports back.
const STALE_TIMEOUT_MS = 15 * 60 * 1000   // 15 min

function _resetIdle({ stale = false } = {}) {
  STATE.state             = 'idle'
  STATE.running           = false
  STATE.pendingRunId      = null
  STATE.runStartedAt      = null
  STATE.lastRunFinishedAt = new Date()
  STATE.lastStale         = stale
}

function _markCompleted() {
  STATE.state             = 'completed'
  STATE.running           = false
  STATE.pendingRunId      = null
  STATE.runStartedAt      = null
  STATE.lastRunFinishedAt = new Date()
  STATE.lastStatus        = 'SUCCEEDED'
  STATE.lastStale         = false
}

function _markFailed(status) {
  STATE.state             = 'failed'
  STATE.running           = false
  STATE.pendingRunId      = null
  STATE.runStartedAt      = null
  STATE.lastRunFinishedAt = new Date()
  STATE.lastStatus        = status || 'FAILED'
  STATE.lastStale         = false
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

  const lead = await prisma.lead.create({
    data: {
      fullName:           `@${username} (TikTok)`,
      sourcePlatform:     'tiktok',
      sourceType:         'scraped',
      skinConcern:        skinLabel,
      message:            scrapedLead.comment,
      handle:             username,
      status:             'new',
      priority:           heat >= leadHeatEngine.HOT_THRESHOLD ? 'high' : 'low',
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

async function processRawItems(rawItems) {
  const stats = {
    total:      rawItems.length,
    normalised: 0,
    stored:     0,   // saved to scraped_leads
    nigerian:   0,   // nigeriaConfidence >= 30
    accepted:   0,   // passed all gates → injected into leads
    injected:   0,
    queued:     0,   // heat >= 70 → outreachQueued
    rejected:   0,
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
  }

  for (const raw of rawItems) {
    const norm = normaliseTiktokItem(raw)
    if (!norm || !norm.text?.trim()) {
      stats.reasons.norm_failed++
      stats.rejected++
      continue
    }
    stats.normalised++

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
  console.log('[LeadAcquisition] ──────────────────────────────────────')

  return stats
}

// ── Scheduler cycle ───────────────────────────────────────────────────────────

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
          `[LeadAcquisition] Run SUCCEEDED — runId=${STATE.pendingRunId}` +
          ` defaultDatasetId=${defaultDatasetId}`,
        )
        const rawItems = await fetchTiktokItems(defaultDatasetId)
        console.log(`[LeadAcquisition] Raw item count from dataset: ${rawItems.length}`)
        const result   = await processRawItems(rawItems)
        console.log('[LeadAcquisition] Cycle complete:', result)
        _markCompleted()

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

    // No pending run — trigger a new cycle
    console.log('[LeadAcquisition] Triggering TikTok hashtag scrape...')
    const { runId } = await triggerTiktokHashtagScrape()
    const now = new Date()
    STATE.state        = 'running'
    STATE.running      = true
    STATE.pendingRunId = runId
    STATE.runStartedAt = now
    STATE.lastRunAt    = now
    STATE.lastStale    = false

  } catch (err) {
    console.error('[LeadAcquisition] Cycle error:', err.message)
    _markFailed('CYCLE_ERROR')
  }
}

function startLeadAcquisitionEngine() {
  const INTERVAL_MS = 3 * 60 * 60 * 1000   // 3 hours

  // First cycle after 3 minutes (let server boot + other services start)
  setTimeout(runAcquisitionCycle, 3 * 60 * 1000)

  setInterval(runAcquisitionCycle, INTERVAL_MS)
  console.log('[LeadAcquisition] Engine started — 3-hour cycle, first run in 3 min')
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
  }

  return {
    scrapedToday,
    highIntentToday,
    pendingOutreach,
    processedTotal,
    totalScraped,
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
