'use strict'

/**
 * leadAcquisitionService.js
 * Phase 37 — Strict Africa-first, manual-only buyer-intent acquisition.
 *
 *   - No automatic / interval / startup scraping.
 *   - Operator triggers ONE cycle at a time via POST /api/admin/acquisition/trigger.
 *   - Country selector (Nigeria default — Ghana / Kenya / South Africa supported).
 *   - Strict pain-point + buyer-intent batches built per country.
 *   - Hard geo filtering: foreign-language / non-African signals are rejected.
 *   - Inject only when buyerReadiness >= 45 OR painSignal >= 35.
 *   - Apify caps: ≤ 3 videos / query, ≤ 10 comments / video, stop after 15 accepted leads.
 */

const prisma = require('../lib/prisma')
const {
  triggerTiktokHashtagScrape,
  getTiktokRunStatus,
  fetchTiktokItems,
  normaliseTiktokItem,
  triggerTiktokCommentsScrape,
  normaliseTiktokCommentItem,
} = require('./tiktokScraperService')
const {
  getNextPainBatch,
  getRecentBatchSnapshot,
  getCountryProfile,
  listSupportedCountries,
  DEFAULT_COUNTRY,
} = require('../config/painPointQueries')

const nigeriaSignal       = require('./nigeriaSignalService')
const leadPsychology      = require('./leadPsychologyService')
const leadHeatEngine      = require('./leadHeatEngine')
const leadSegmentation    = require('./leadSegmentationService')
const outreachIntelligence = require('./outreachIntelligenceService')

const mceRouter         = require('./mce/conversationRouter')
const mceWhatsAppBridge = require('./mce/whatsappBridgeService')

const painSignalClassifier = require('./painSignalClassifierService')
const buyerReadiness       = require('./buyerReadinessService')
const leadQualityGate      = require('./leadQualityGateService')

const { getOutreachCounts } = require('./outreachQueueService')

// ── Safe Mode — all limits from centralized config ────────────────────────────

const {
  SAFE_MODE,
  MAX_SEARCH_QUERIES,
  MAX_POSTS_PER_RUN,
  MAX_COMMENTS_PER_POST,
  MAX_ACCEPTED_LEADS,
  RUN_TIMEOUT_MS,
  RUN_LOG_SIZE,
} = require('../config/acquisitionSafeMode')

const MAX_VIDEOS_PER_QUERY   = MAX_POSTS_PER_RUN
const MAX_COMMENTS_PER_VIDEO = MAX_COMMENTS_PER_POST

// Inject thresholds: lead enters Outreach Queue ONLY when one of these fires.
const INJECT_BUYER_THRESHOLD = 45  // buyerReadinessScore
const INJECT_PAIN_THRESHOLD  = 35  // painSignalScore

// African / NG-friendly country codes (treated as in-scope).
const AFRICAN_COUNTRY_CODES = new Set(['NG', 'GH', 'KE', 'ZA'])
// Hard-reject countries detected by nigeriaSignalService.
const HARD_REJECT_COUNTRIES = new Set(['US', 'UK', 'IN', 'PH', 'CA'])

console.log(
  `[LeadAcquisition] SAFE MODE=${SAFE_MODE}` +
  ` maxQueries=${MAX_SEARCH_QUERIES}` +
  ` maxPosts=${MAX_VIDEOS_PER_QUERY}` +
  ` maxComments=${MAX_COMMENTS_PER_VIDEO}` +
  ` acceptStop=${MAX_ACCEPTED_LEADS}`,
)

// ── In-memory run state ─────────────────────────────────────────────────────

const STATE = {
  state:             'idle',
  running:           false,
  pendingRunId:      null,
  runStartedAt:      null,
  runStartMs:        null,   // epoch ms — for duration tracking
  lastRunAt:         null,
  lastRunFinishedAt: null,
  lastStatus:        null,
  lastStale:         false,
  lastBatch:         null,
  itemsThisCycle:    0,
  nextRunAt:         null,
  stage:             'video',
  commentsRunId:     null,
  pendingPostUrls:   [],
  selectedCountry:   DEFAULT_COUNTRY,
  acceptedThisCycle: 0,
  acceptanceCapReached: false,
  lastVerification:  null,
  _previewCU:        null,   // CU estimate stored from last dry run
}

// ── In-memory run log (ring buffer) ─────────────────────────────────────────

const RUN_LOG = []

function _logRun(entry) {
  RUN_LOG.unshift({ ...entry, loggedAt: new Date().toISOString() })
  if (RUN_LOG.length > RUN_LOG_SIZE) RUN_LOG.pop()
}

function getRunLog() { return RUN_LOG.slice() }

const STALE_TIMEOUT_MS = RUN_TIMEOUT_MS

function _resetIdle({ stale = false } = {}) {
  STATE.state             = 'idle'
  STATE.running           = false
  STATE.pendingRunId      = null
  STATE.runStartedAt      = null
  STATE.runStartMs        = null
  STATE.lastRunFinishedAt = new Date()
  STATE.lastStale         = stale
  STATE.stage             = 'video'
  STATE.commentsRunId     = null
  STATE.pendingPostUrls   = []
  STATE._previewCU        = null
}

function _markCompleted() {
  _logRun({
    country:     STATE.selectedCountry,
    status:      'completed',
    source:      'tiktok',
    hashtags:    STATE.lastBatch?.hashtags || [],
    itemsFound:  STATE.itemsThisCycle,
    accepted:    STATE.acceptedThisCycle,
    durationMs:  STATE.runStartMs ? Date.now() - STATE.runStartMs : null,
    estimatedCU: STATE._previewCU || null,
    completedAt: new Date().toISOString(),
  })
  STATE.state             = 'completed'
  STATE.running           = false
  STATE.pendingRunId      = null
  STATE.runStartedAt      = null
  STATE.runStartMs        = null
  STATE.lastRunFinishedAt = new Date()
  STATE.lastStatus        = 'SUCCEEDED'
  STATE.lastStale         = false
  STATE.stage             = 'video'
  STATE.commentsRunId     = null
  STATE.pendingPostUrls   = []
  STATE._previewCU        = null
}

function _markFailed(status) {
  _logRun({
    country:     STATE.selectedCountry,
    status:      'failed',
    source:      'tiktok',
    hashtags:    STATE.lastBatch?.hashtags || [],
    itemsFound:  STATE.itemsThisCycle,
    accepted:    STATE.acceptedThisCycle,
    durationMs:  STATE.runStartMs ? Date.now() - STATE.runStartMs : null,
    estimatedCU: STATE._previewCU || null,
    failReason:  status || 'FAILED',
    completedAt: new Date().toISOString(),
  })
  STATE.state             = 'failed'
  STATE.running           = false
  STATE.pendingRunId      = null
  STATE.runStartedAt      = null
  STATE.runStartMs        = null
  STATE.lastRunFinishedAt = new Date()
  STATE.lastStatus        = status || 'FAILED'
  STATE.lastStale         = false
  STATE.stage             = 'video'
  STATE.commentsRunId     = null
  STATE.pendingPostUrls   = []
  STATE._previewCU        = null
}

function _checkStale() {
  if (!STATE.running || !STATE.runStartedAt) return false
  const age = Date.now() - STATE.runStartedAt.getTime()
  if (age > STALE_TIMEOUT_MS) {
    console.warn(
      `[LeadAcquisition] Failsafe — run stale for ${Math.round(age / 60000)} min` +
      ` (timeout=${STALE_TIMEOUT_MS / 60000}min); force-reset runId=${STATE.pendingRunId}`,
    )
    _logRun({
      country:     STATE.selectedCountry,
      status:      'timeout',
      source:      'tiktok',
      hashtags:    STATE.lastBatch?.hashtags || [],
      itemsFound:  STATE.itemsThisCycle,
      accepted:    STATE.acceptedThisCycle,
      durationMs:  STATE.runStartMs ? Date.now() - STATE.runStartMs : null,
      estimatedCU: STATE._previewCU || null,
      completedAt: new Date().toISOString(),
    })
    _resetIdle({ stale: true })
    return true
  }
  return false
}

// ── Spam / praise rejection patterns ────────────────────────────────────────

const REJECT_PATTERNS = [
  /^[\p{Emoji}\s\p{P}]{1,15}$/u,
  /^(\s*#\w+\s*)+$/,
  /^@\w+(\s+@\w+)*\s*$/,
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
  /^.{0,7}$/,
  /^(love\s+(it|this|u|you)!*|nice|wow|cute|beautiful|amazing|gorgeous|stunning|so\s+pretty|❤️*|👏+|🔥+|💯+|preach|facts|true|exactly|same(\s+here)?|me\s+too)\s*\.*\!*$/i,
  /^(first|second|early|here\s+early|notification\s+squad)\s*\!*$/i,
  /^(👇|☝️|✨)+$/u,
]

// Strong non-English / non-African language markers — reject outright.
// (Cyrillic, CJK, Devanagari, Arabic non-Latin scripts.)
const NON_ENGLISH_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Devanagari}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}]/u

// Non-African / non-NG geo signals that should override anything else.
const NON_AFRICAN_REGION_PATTERNS = [
  /\b(usa|america|nyc|los\s*angeles|texas|florida|california|chicago|atlanta|miami)\b/i,
  /\b(london|manchester|britain|england|scotland)\b/i,
  /\b(canada|toronto|vancouver|montreal)\b/i,
  /\b(india|mumbai|delhi|bangalore|kolkata|chennai|hyderabad)\b/i,
  /\b(philippines|manila|filipino|filipina|pinoy|pinay)\b/i,
  /\b(australia|sydney|melbourne|brisbane)\b/i,
  /\b(china|beijing|shanghai|chinese)\b/i,
  /\b(japan|tokyo|osaka|japanese)\b/i,
  /\b(korea|seoul|korean)\b/i,
  /\b(europe|german|french|paris|berlin|amsterdam|madrid)\b/i,
]

// African positive signals — locations that BOOST relevance.
const AFRICAN_BOOST_PATTERNS = [
  /\bnigeria\b/i, /\bnaija\b/i, /\b9ja\b/i, /\bnigerian\b/i,
  /\blagos\b/i, /\babuja\b/i, /\bport\s*harcourt\b/i, /\bibadan\b/i, /\blekki\b/i,
  /\bnaira\b/i, /\bngn\b/i, /₦/,
  /\bghana\b/i, /\baccra\b/i, /\bghanaian\b/i,
  /\bkenya\b/i, /\bnairobi\b/i, /\bkenyan\b/i,
  /\bsouth\s*africa\b/i, /\bjohannesburg\b/i, /\bcape\s*town\b/i, /\bdurban\b/i,
  /\bafrican\s+skin\b/i, /\bblack\s+skin\b/i, /\bmelanin\b/i, /\bmelanin\s+skin\b/i,
]

function isLikelyAfricanContext(text) {
  return AFRICAN_BOOST_PATTERNS.some(p => p.test(text))
}

function hasForeignSignal(text) {
  return NON_ENGLISH_SCRIPT.test(text) || NON_AFRICAN_REGION_PATTERNS.some(p => p.test(text))
}

// ── Lead injection ──────────────────────────────────────────────────────────

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

// ── Pain / urgency labels (preserved for back-compat) ───────────────────────

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

// ── Batch processor ─────────────────────────────────────────────────────────

async function processRawItems(rawItems, opts = {}) {
  const normaliser       = opts.normaliser || normaliseTiktokItem
  const defaultIsComment = Boolean(opts.defaultIsComment)
  const country          = opts.country || STATE.selectedCountry || DEFAULT_COUNTRY
  const stats = {
    total:      rawItems.length,
    normalised: 0,
    stored:     0,
    nigerian:   0,
    accepted:   0,
    injected:   0,
    queued:     0,
    rejected:   0,
    captionsRejected: 0,
    cappedByAcceptStop: 0,
    reasons: {
      norm_failed:    0,
      duplicate:      0,
      spam:           0,
      foreign_geo:    0,   // Phase 37 — non-African / non-English script
      non_african:    0,   // Phase 37 — soft non-NG/non-African profile
      below_intent:   0,   // Phase 37 — buyer<45 AND pain<35
      fake_profile:   0,
      low_intent:     0,
      non_nigerian:   0,
      low_heat:       0,
    },
    accepted_samples: [],   // sample of accepted leads w/ pass reasons
    rejected_samples: [],   // sample of rejected items w/ reject reasons
    topSegments: {},
    topCities:   {},
    topPainTags: {},
    topAngles:   {},
    painSignalLeads:  0,
    buyerReadyLeads:  0,
    hotBuyerLeads:    0,
    rejectedLowQuality: 0,
    topPainPhrases:   {},
    topBuyerPhrases:  {},
    actionBreakdown:  {},
  }

  for (const raw of rawItems) {
    if (STATE.acceptedThisCycle >= MAX_ACCEPTED_LEADS) {
      STATE.acceptanceCapReached = true
      stats.cappedByAcceptStop++
      continue
    }
    const norm = normaliser(raw)
    if (!norm || !norm.text?.trim()) {
      stats.reasons.norm_failed++
      stats.rejected++
      continue
    }
    stats.normalised++

    if (REJECT_PATTERNS.some(p => p.test(norm.text))) {
      stats.reasons.spam++
      stats.rejected++
      continue
    }

    // Phase 37 — Hard geo filter. Reject anything carrying non-African region
    // signals or non-English scripts unless an African signal also fires.
    if (hasForeignSignal(norm.text) && !isLikelyAfricanContext(norm.text)) {
      stats.reasons.foreign_geo++
      stats.rejected++
      if (stats.rejected_samples.length < 5) {
        stats.rejected_samples.push({
          username: norm.username,
          text:     norm.text.slice(0, 140),
          reason:   'foreign_geo',
        })
      }
      continue
    }

    const isComment =
      typeof norm.isComment === 'boolean' ? norm.isComment : defaultIsComment

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

    const corpus = norm.text

    const ngResult = nigeriaSignal.detect(corpus, {
      username: norm.username,
      hashtag:  norm.hashtag,
    })
    if (ngResult.nigeriaConfidence >= 30) stats.nigerian++

    // Phase 37 — soft geo gate: if nigeriaSignalService detected a non-African
    // country (US/UK/IN/PH/CA), drop the lead unless African boost present.
    if (
      ngResult.detectedCountry &&
      HARD_REJECT_COUNTRIES.has(ngResult.detectedCountry) &&
      !isLikelyAfricanContext(corpus)
    ) {
      stats.reasons.non_african++
      stats.rejected++
      if (stats.rejected_samples.length < 5) {
        stats.rejected_samples.push({
          username: norm.username,
          text:     corpus.slice(0, 140),
          reason:   `non_african(${ngResult.detectedCountry})`,
        })
      }
      continue
    }

    const psychResult = leadPsychology.analyze(corpus)
    const segmentResult = leadSegmentation.classify(corpus, {
      username: norm.username,
      hashtag:  norm.hashtag,
    })
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

    const heatResult = leadHeatEngine.evaluate({
      nigeria:      ngResult,
      psychology:   psychResult,
      segmentation: segmentResult,
      engagement:   { likes: raw?.diggCount || raw?.likes, comments: raw?.commentCount },
      duplicate:    false,
      rejectNonNigerian: false,
    })

    const outreach = outreachIntelligence.generate({
      text:         corpus,
      nigeria:      ngResult,
      psychology:   psychResult,
      segmentation: segmentResult,
      username:     norm.username,
      externalId:   norm.externalId,
      painCategory: leadSegmentation.mapToConcernType(segmentResult.segment),
    })

    const legacyConcern  = leadSegmentation.mapToConcernType(segmentResult.segment)
    const legacyIntent   = Math.round(heatResult.leadHeatScore || 0)
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
        continue
      }
    }

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
          isComment:    isComment,
          sourceVideoUrl: safeStr(norm.sourceVideoUrl || norm.videoUrl),
          whatsappCta:  outreach.whatsappCta || null,
          consultCta:   outreach.consultCta  || null,
          academyCta:   outreach.academyCta  || null,
          ctaType:      outreach.ctaType     || null,
          concernType:  legacyConcern,
          intentScore:  legacyIntent,
          urgencyLevel: urgencyLabel,
          processed:    false,

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
    } catch (dbErr) {
      if (dbErr.code === 'P2002') {
        stats.reasons.duplicate++
        stats.rejected++
        continue
      }
      throw dbErr
    }

    // ── Phase 37 — Outreach-queue gate ────────────────────────────────────
    // Inject into the leads table ONLY when buyerReadiness>=45 OR painSignal>=35.
    // Anything else stays in scraped_leads silently — keeps the queue uncluttered.
    const buyer = Math.round(buyerResult.buyerReadinessScore)
    const pain  = Math.round(painClassification.painSignalScore)
    const passesGate = buyer >= INJECT_BUYER_THRESHOLD || pain >= INJECT_PAIN_THRESHOLD

    if (heatResult.rejectionReason || !passesGate) {
      const r = heatResult.rejectionReason
      if      (r === 'fake_profile') stats.reasons.fake_profile++
      else if (r === 'low_intent')   stats.reasons.low_intent++
      else if (r === 'non_nigerian') stats.reasons.non_nigerian++
      else if (r === 'low_heat')     stats.reasons.low_heat++
      else if (!passesGate) {
        stats.reasons.below_intent++
        if (stats.rejected_samples.length < 5) {
          stats.rejected_samples.push({
            username: norm.username,
            text:     corpus.slice(0, 140),
            reason:   `below_intent(buyer=${buyer},pain=${pain})`,
          })
        }
      }
      if (r && r !== 'low_heat') stats.rejected++
      continue
    }

    stats.accepted++
    try {
      const leadId = await injectToLead({ ...saved }, outreach)
      const isHot  = leadHeatEngine.isHot(heatResult.leadHeatScore)
      await prisma.scrapedLead.update({
        where: { id: saved.id },
        data:  { processed: true, injectedLeadId: leadId, outreachQueued: true },
      })

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
          const refreshed = await prisma.lead.findUnique({ where: { id: leadId } })
          if (refreshed) {
            await mceWhatsAppBridge.generateAndStoreCta(refreshed)
          }
        }
      } catch (mceErr) {
        console.error(`[MCE] post-injection hook failed leadId=${leadId}:`, mceErr.message)
      }

      stats.injected++
      STATE.acceptedThisCycle++

      if (stats.accepted_samples.length < MAX_ACCEPTED_LEADS) {
        stats.accepted_samples.push({
          username: norm.username,
          text:     corpus.slice(0, 140),
          buyer,
          pain,
          heat:     Math.round(heatResult.leadHeatScore),
          city:     ngResult.detectedCity,
          country:  ngResult.detectedCountry,
          quality:  qualityGate.leadQuality,
          isHot,
        })
      }

      if (isHot) {
        stats.queued++
        console.log(
          `[LeadAcquisition] HOT injected — @${norm.username || 'unknown'}` +
          ` heat=${Math.round(heatResult.leadHeatScore)}` +
          ` buyer=${buyer} pain=${pain}` +
          ` segment=${segmentResult.segment}` +
          ` ng=${ngResult.nigeriaConfidence}` +
          ` city=${ngResult.detectedCity || '—'}`,
        )
      }

      if (STATE.acceptedThisCycle >= MAX_ACCEPTED_LEADS) {
        STATE.acceptanceCapReached = true
        console.log(`[LeadAcquisition] Reached MAX_ACCEPTED_LEADS=${MAX_ACCEPTED_LEADS}; stopping further processing.`)
      }
    } catch (err) {
      console.error(`[LeadAcquisition] Inject failed for @${norm.username}:`, err.message)
    }
  }

  const topN = (obj, n = 5) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ') || '—'

  console.log('[LeadAcquisition] ─────────── Cycle Summary ───────────')
  console.log(
    `[LeadAcquisition] country=${country} total=${stats.total} normalised=${stats.normalised}` +
    ` stored=${stats.stored} nigerian=${stats.nigerian}` +
    ` accepted=${stats.accepted} injected=${stats.injected} queued=${stats.queued}` +
    ` rejected=${stats.rejected} cappedByAcceptStop=${stats.cappedByAcceptStop}`,
  )
  console.log('[LeadAcquisition] Rejections:    ', stats.reasons)
  console.log('[LeadAcquisition] Top segments:  ', topN(stats.topSegments))
  console.log('[LeadAcquisition] Top NG cities: ', topN(stats.topCities))
  console.log('[LeadAcquisition] Top pain tags: ', topN(stats.topPainTags, 8))
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

// ── Manual cycle ────────────────────────────────────────────────────────────

const COMMENT_FIRST_ENABLED = String(process.env.TIKTOK_COMMENT_FIRST ?? 'true').toLowerCase() !== 'false'

async function runAcquisitionCycle(opts = {}) {
  if (!process.env.APIFY_API_TOKEN) {
    console.log('[LeadAcquisition] APIFY_API_TOKEN not set — skipping')
    _markFailed('NO_APIFY_TOKEN')
    return { success: false, error: 'APIFY_API_TOKEN not configured' }
  }

  const country = opts.country
    ? getCountryProfile(opts.country).code
    : STATE.selectedCountry || DEFAULT_COUNTRY
  STATE.selectedCountry = country

  try {
    if (_checkStale()) return { success: false, error: 'stale_run_reset' }

    if (STATE.running && STATE.pendingRunId) {
      const { status, defaultDatasetId } = await getTiktokRunStatus(STATE.pendingRunId)

      if (status === 'SUCCEEDED' && defaultDatasetId) {
        console.log(
          `[LeadAcquisition] ${STATE.stage} stage SUCCEEDED — runId=${STATE.pendingRunId}` +
          ` defaultDatasetId=${defaultDatasetId}`,
        )
        const rawItems = await fetchTiktokItems(defaultDatasetId)
        STATE.itemsThisCycle = rawItems.length

        if (STATE.stage === 'video') {
          const captionStats = await processRawItems(rawItems, {
            normaliser:       normaliseTiktokItem,
            defaultIsComment: false,
            country:          STATE.selectedCountry,
          })

          if (STATE.acceptanceCapReached) {
            console.log('[LeadAcquisition] Acceptance cap reached during caption pass — skipping comments stage.')
            STATE.lastVerification = _buildVerification(captionStats, null)
            _markCompleted()
            return { success: true, stats: captionStats }
          }

          const postUrls = []
          for (const raw of rawItems) {
            const n = normaliseTiktokItem(raw)
            if (n?.videoUrl) postUrls.push(n.videoUrl)
          }
          const uniqueUrls = [...new Set(postUrls)].slice(0, MAX_VIDEOS_PER_QUERY)

          if (COMMENT_FIRST_ENABLED && uniqueUrls.length > 0) {
            try {
              const cmt = await triggerTiktokCommentsScrape(uniqueUrls, {
                commentsPerPost: MAX_COMMENTS_PER_VIDEO,
              })
              STATE.stage           = 'comments'
              STATE.pendingRunId    = cmt.runId
              STATE.commentsRunId   = cmt.runId
              STATE.runStartedAt    = new Date()
              STATE.pendingPostUrls = uniqueUrls
              STATE.lastVerification = _buildVerification(captionStats, null)
              return { success: true, partial: true, captions: captionStats }
            } catch (err) {
              console.error('[LeadAcquisition] Comments trigger failed:', err.message)
            }
          }
          STATE.lastVerification = _buildVerification(captionStats, null)
          _markCompleted()
          return { success: true, stats: captionStats }
        }

        if (STATE.stage === 'comments') {
          const commentStats = await processRawItems(rawItems, {
            normaliser:       normaliseTiktokCommentItem,
            defaultIsComment: true,
            country:          STATE.selectedCountry,
          })
          STATE.lastVerification = _buildVerification(STATE.lastVerification?.captions || null, commentStats)
          _markCompleted()
          return { success: true, stats: commentStats }
        }

      } else if (status === 'SUCCEEDED' && !defaultDatasetId) {
        console.warn(`[LeadAcquisition] Run SUCCEEDED but defaultDatasetId is missing — runId=${STATE.pendingRunId}`)
        _markFailed('SUCCEEDED_NO_DATASET')
        return { success: false, error: 'SUCCEEDED_NO_DATASET' }
      } else if (['FAILED', 'TIMED-OUT', 'ABORTED'].includes(status)) {
        console.warn(`[LeadAcquisition] Run ended with status=${status} runId=${STATE.pendingRunId}`)
        _markFailed(status)
        return { success: false, error: status }
      }
      return { success: true, stillRunning: true }
    }

    // Trigger a fresh manual run
    const painPicked = getNextPainBatch({ country: STATE.selectedCountry })
    // Safe Mode: cap hashtags to MAX_SEARCH_QUERIES
    const triggerArg = painPicked.batch.slice(0, MAX_SEARCH_QUERIES)
    const modeLabel  = `pain_point_first_${painPicked.country}`
    console.log(
      `[LeadAcquisition] Manual cycle triggered — country=${painPicked.country} (${painPicked.countryLabel})` +
      ` queries=${triggerArg.length}/${MAX_SEARCH_QUERIES} posts<=${MAX_VIDEOS_PER_QUERY} comments<=${MAX_COMMENTS_PER_VIDEO}` +
      ` batch: [${triggerArg.join(' | ')}]` +
      (painPicked.forced ? ' (forced — all batches recently used)' : ''),
    )

    const { runId, hashtags, maxItems, runMode } = await triggerTiktokHashtagScrape(
      triggerArg,
      { maxItems: MAX_VIDEOS_PER_QUERY, perTagItems: MAX_VIDEOS_PER_QUERY, modeLabel },
    )

    const now = new Date()
    STATE.state           = 'running'
    STATE.running         = true
    STATE.stage           = 'video'
    STATE.commentsRunId   = null
    STATE.pendingPostUrls = []
    STATE.pendingRunId    = runId
    STATE.runStartedAt    = now
    STATE.runStartMs      = Date.now()
    STATE.lastRunAt       = now
    STATE.lastStale       = false
    STATE.itemsThisCycle  = 0
    STATE.acceptedThisCycle    = 0
    STATE.acceptanceCapReached = false
    STATE.lastVerification     = null
    STATE.lastBatch       = {
      mode:     modeLabel,
      runMode,
      country:  painPicked.country,
      countryLabel: painPicked.countryLabel,
      hashtags: hashtags || [],
      phrases:  painPicked.phrases,
      key:      painPicked.key,
      maxItems,
      ranAt:    now.toISOString(),
    }
    STATE.nextRunAt = null
    console.log(
      `[LeadAcquisition] Run queued — runId=${runId}` +
      ` mode=${modeLabel} maxItems=${maxItems}`,
    )
    return { success: true, runId, country: painPicked.country }

  } catch (err) {
    console.error('[LeadAcquisition] Cycle error:', err.message)
    _markFailed('CYCLE_ERROR')
    return { success: false, error: err.message }
  }
}

function _buildVerification(captionStats, commentStats) {
  return {
    capturedAt:   new Date().toISOString(),
    country:      STATE.selectedCountry,
    captions:     captionStats || null,
    comments:     commentStats || null,
    accepted:     (captionStats?.accepted || 0) + (commentStats?.accepted || 0),
    rejected:     (captionStats?.rejected || 0) + (commentStats?.rejected || 0),
    accepted_samples: [
      ...(captionStats?.accepted_samples || []),
      ...(commentStats?.accepted_samples || []),
    ],
    rejected_samples: [
      ...(captionStats?.rejected_samples || []),
      ...(commentStats?.rejected_samples || []),
    ],
    reasons: {
      ...(captionStats?.reasons || {}),
      ...(commentStats?.reasons || {}),
    },
    cappedByAcceptStop: Boolean(STATE.acceptanceCapReached),
  }
}

// ── Emergency stop ─────────────────────────────────────────────────────────

function stopAcquisition() {
  if (STATE.running) {
    console.log(`[LeadAcquisition] Emergency stop — runId=${STATE.pendingRunId} stage=${STATE.stage}`)
    _logRun({
      country:     STATE.selectedCountry,
      status:      'stopped',
      source:      'tiktok',
      hashtags:    STATE.lastBatch?.hashtags || [],
      itemsFound:  STATE.itemsThisCycle,
      accepted:    STATE.acceptedThisCycle,
      durationMs:  STATE.runStartMs ? Date.now() - STATE.runStartMs : null,
      estimatedCU: STATE._previewCU || null,
      completedAt: new Date().toISOString(),
    })
  }
  _resetIdle()
}

// ── Dry run preview (no Apify call) ─────────────────────────────────────────

function previewAcquisitionRun(opts = {}) {
  const country = opts.country
    ? getCountryProfile(opts.country).code
    : STATE.selectedCountry || DEFAULT_COUNTRY

  const painPicked  = getNextPainBatch({ country, peek: true })
  const queries     = painPicked.batch.slice(0, MAX_SEARCH_QUERIES)
  const phrases     = painPicked.phrases.slice(0, MAX_SEARCH_QUERIES)

  const maxPosts    = MAX_VIDEOS_PER_QUERY
  const maxComments = MAX_COMMENTS_PER_VIDEO
  const estimatedPosts    = Math.min(queries.length * Math.ceil(maxPosts / Math.max(1, queries.length)), maxPosts)
  const estimatedComments = maxPosts * maxComments

  // Conservative CU estimate per Apify pricing
  const postCU    = estimatedPosts    * 4    // ~4 CU / TikTok video
  const commentCU = estimatedComments * 0.8  // ~0.8 CU / comment
  const totalCU   = Math.round(postCU + commentCU)
  const riskLevel = totalCU <= 30 ? 'low' : totalCU <= 80 ? 'medium' : 'high'

  return {
    country,
    countryLabel:        painPicked.countryLabel,
    queries,
    phrases,
    estimatedPosts,
    estimatedComments,
    estimatedCU:         { posts: Math.round(postCU), comments: Math.round(commentCU), total: totalCU },
    riskLevel,
    safeModeActive:      SAFE_MODE,
    limits: {
      maxSearchQueries:   MAX_SEARCH_QUERIES,
      maxPostsPerRun:     MAX_VIDEOS_PER_QUERY,
      maxCommentsPerPost: MAX_COMMENTS_PER_VIDEO,
      maxAcceptedLeads:   MAX_ACCEPTED_LEADS,
      maxApifyRuns:       1,
    },
    wouldRun:    !STATE.running,
    currentState: STATE.state,
  }
}

// ── Manual mode startup (no-op) ─────────────────────────────────────────────

function startLeadAcquisitionEngine() {
  console.log(
    '[LeadAcquisition] SAFE MODE — automatic scraping is disabled.' +
    ' Operator triggers runs from the Command Center "Run Now" button or' +
    ' POST /api/admin/acquisition/trigger.',
  )
}

// ── Stats ───────────────────────────────────────────────────────────────────

async function getAcquisitionStats() {
  _checkStale()

  const now   = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const [scrapedToday, highIntentToday, pendingOutreach, processedTotal, totalScraped, nigerianTotal, highHeatTotal] =
    await Promise.all([
      prisma.scrapedLead.count({ where: { createdAt: { gte: today } } }),
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

  let painSignalLeads     = 0
  let buyerReadyLeads     = 0
  let hotBuyerLeads       = 0
  let rejectedLowQuality  = 0
  try {
    [painSignalLeads, buyerReadyLeads, hotBuyerLeads, rejectedLowQuality] = await Promise.all([
      prisma.scrapedLead.count({ where: { painSignalScore:     { gte: 25 } } }),
      prisma.scrapedLead.count({ where: { buyerReadinessScore: { gte: 45 } } }),
      prisma.scrapedLead.count({ where: { leadQuality: 'hot' } }),
      prisma.scrapedLead.count({ where: { leadQuality: 'reject' } }),
    ])
  } catch (err) {
    console.warn('[LeadAcquisition] Pain-signal counters unavailable:', err.message)
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

    mode:                'manual',
    manualMode:          true,
    safeModeActive:      SAFE_MODE,
    selectedCountry:     STATE.selectedCountry,
    countryLabel:        getCountryProfile(STATE.selectedCountry).label,
    supportedCountries:  listSupportedCountries(),
    maxVideosPerQuery:   MAX_VIDEOS_PER_QUERY,
    maxCommentsPerVideo: MAX_COMMENTS_PER_VIDEO,
    maxAcceptedLeads:    MAX_ACCEPTED_LEADS,
    maxSearchQueries:    MAX_SEARCH_QUERIES,
    injectThreshold:     { buyer: INJECT_BUYER_THRESHOLD, pain: INJECT_PAIN_THRESHOLD },
    nextRunAt:           null,
    itemsThisCycle:      STATE.itemsThisCycle ?? 0,
    acceptedThisCycle:   STATE.acceptedThisCycle ?? 0,
    acceptanceCapReached: Boolean(STATE.acceptanceCapReached),
    lastBatch:           STATE.lastBatch,
    lastVerification:    STATE.lastVerification,
    recentBatchesBlocked: getRecentBatchSnapshot().length,
    runLog:              getRunLog(),
  }

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
    outreachCounts,
    nigerianTotal,
    highHeatTotal,
    painSignalLeads,
    buyerReadyLeads,
    hotBuyerLeads,
    rejectedLowQuality,
    acquisitionStatus,
    engineStatus: acquisitionStatus.running ? 'running' : 'idle',
  }
}

module.exports = {
  startLeadAcquisitionEngine,
  runAcquisitionCycle,
  getAcquisitionStats,
  processRawItems,
  previewAcquisitionRun,
  stopAcquisition,
  getRunLog,
}
