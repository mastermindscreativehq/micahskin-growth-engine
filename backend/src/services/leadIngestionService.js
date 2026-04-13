/**
 * leadIngestionService.js
 * Orchestrates the full Instagram (Apify) lead-ingestion pipeline.
 *
 * Pipeline steps for each raw item:
 *   1. Normalise (done by apifyService before this runs)
 *   2. Deduplicate — skip if externalId already in raw_social_items
 *   3. Pre-filter — skip if text is missing/too short (droppedMissingText)
 *   4. Persist raw item to raw_social_items
 *   5. Classify intent (intentClassifierService)
 *   6. Score + assign temperature (leadScoringService)
 *   7. Persist decision to social_lead_decisions
 *   8. If decision = 'ingest' (hot or warm) → create CRM Lead record
 *   9. Link created Lead ID back to the decision row
 *
 * Every non-duplicate item lands in exactly one outcome bucket:
 *   droppedMissingText | processed (qualifiedLeads | rejected) | errors
 *
 * Invariants guaranteed:
 *   rawFetched = droppedInvalidShape + duplicatesSkipped + droppedMissingText + sentToProcessing
 *   sentToProcessing = processed + errors
 *   processed = qualifiedLeads + rejected
 *
 * Returns an ImportSummary object to the controller.
 */

const prisma = require('../lib/prisma')
const { fetchAndNormaliseDataset } = require('./apifyService')
const { classify } = require('./intentClassifierService')
const { scoreItem } = require('./leadScoringService')
const { findExistingIds } = require('./dedupeService')

// ── Concern → Lead.skinConcern mapping ───────────────────────────────────────
// Lead.skinConcern accepts: acne | dark_spots | stretch_marks | dry_skin |
//                           hyperpigmentation | body_care | other
const CONCERN_MAP = {
  acne: 'acne',
  hyperpigmentation: 'hyperpigmentation',
  stretch_marks: 'stretch_marks',
  dry_skin: 'dry_skin',
  oily_skin: 'other',
  sensitive_skin: 'other',
  uneven_tone: 'hyperpigmentation',
  general: 'other',
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Import an Apify dataset, run the full pipeline, and return a summary.
 *
 * @param {string} datasetId   Apify dataset ID
 * @param {string} platform    'instagram' (others may be added later)
 * @returns {Promise<ImportSummary>}
 */
async function importApifyDataset(datasetId, platform) {
  console.log(`[Ingestion] Starting import — datasetId=${datasetId}, platform=${platform}`)

  // 1 — Fetch + normalise from Apify
  const { rawCount, items, droppedInvalidShape } = await fetchAndNormaliseDataset(datasetId, platform)

  console.log(
    `[Ingestion] Apify rawCount=${rawCount} | normalised=${items.length} | ` +
    `droppedInvalidShape=${droppedInvalidShape}`,
  )

  if (rawCount === 0) {
    console.log('[Ingestion] Dataset is empty or produced no items.')
    return buildSummary({
      rawCount: 0,
      droppedInvalidShape: 0,
      skippedDupes: 0,
      droppedMissingText: 0,
      decisions: [],
      errors: 0,
    })
  }

  // 2 — Batch dedupe check (one DB query instead of N)
  const allExternalIds = items.map(i => i.externalId)
  const existingIds = await findExistingIds(allExternalIds)
  const newItems = items.filter(i => !existingIds.has(i.externalId))
  // FIX: count actual items removed from the batch, not unique DB IDs matched.
  // existingIds.size undercounts when the same externalId appears >1 time in this
  // batch AND that ID is already in the DB — those extras were previously unaccounted.
  const skippedDupes = items.length - newItems.length

  console.log(
    `[Ingestion] after-dedupe: normalised=${items.length} | dbMatches=${existingIds.size} | ` +
    `skippedDupes=${skippedDupes} | newItems=${newItems.length}`,
  )

  // Detect within-batch duplicates whose IDs are already in the DB.
  // These are the items that were previously "phantom" (filtered but not counted).
  if (skippedDupes > existingIds.size) {
    const phantomCount = skippedDupes - existingIds.size
    const seenIds = new Set()
    const phantomSamples = []
    for (const item of items) {
      if (existingIds.has(item.externalId)) {
        if (seenIds.has(item.externalId) && phantomSamples.length < 3) {
          phantomSamples.push(item)
        }
        seenIds.add(item.externalId)
      }
    }
    console.warn(
      `[Ingestion] WITHIN-BATCH DUPES: ${phantomCount} item(s) share an externalId that ` +
      `appears >1 time in this batch AND is already in DB — previously missing from accounting`,
    )
    phantomSamples.forEach((s, idx) => {
      console.warn(
        `[Ingestion] phantom-dupe[${idx + 1}]: externalId=${s.externalId} | ` +
        `sourceUrl=${s.sourceUrl || 'n/a'} | ` +
        `text=${(s.text || '').slice(0, 80)}`,
      )
    })
  }

  // 3 — Pre-filter: drop items with no usable text before hitting the DB
  let droppedMissingText = 0
  const itemsToProcess = []

  for (const item of newItems) {
    if (!item.text || item.text.trim().length < 3) {
      droppedMissingText++
      console.warn(
        `[Ingestion] droppedMissingText — externalId=${item.externalId} ` +
        `url=${item.sourceUrl || 'n/a'} username=@${item.username || 'unknown'}`,
      )
    } else {
      itemsToProcess.push(item)
    }
  }

  const sentToProcessing = itemsToProcess.length

  console.log(
    `[Ingestion] pipeline: rawCount=${rawCount} | droppedInvalidShape=${droppedInvalidShape} | ` +
    `skippedDupes=${skippedDupes} | droppedMissingText=${droppedMissingText} | ` +
    `sentToProcessing=${sentToProcessing}`,
  )

  // 4–9 — Process each new item sequentially to keep DB load manageable
  const decisions = []
  let errors = 0

  for (const item of itemsToProcess) {
    try {
      const result = await processOneItem(item)
      decisions.push(result)
    } catch (err) {
      errors++
      // Log full details so the admin can diagnose why items fail
      console.error(
        `[Ingestion] ITEM ERROR — externalId=${item.externalId} ` +
        `url=${item.sourceUrl || 'n/a'} username=@${item.username || 'unknown'} — ` +
        `${err.message}`,
        err.stack,
      )
    }
  }

  const summary = buildSummary({ rawCount, droppedInvalidShape, skippedDupes, droppedMissingText, decisions, errors })

  // Verify pipeline invariants in logs — helps catch future accounting regressions
  const expectedRaw = droppedInvalidShape + skippedDupes + droppedMissingText + summary.sentToProcessing
  if (expectedRaw !== rawCount) {
    console.warn(
      `[Ingestion] INVARIANT MISMATCH: rawCount=${rawCount} but ` +
      `droppedInvalidShape(${droppedInvalidShape}) + skippedDupes(${skippedDupes}) + ` +
      `droppedMissingText(${droppedMissingText}) + sentToProcessing(${summary.sentToProcessing}) = ${expectedRaw}`,
    )
  }

  console.log(
    `[Ingestion] Done — rawFetched=${summary.rawFetched} | dupes=${summary.duplicatesSkipped} | ` +
    `sentToProcessing=${summary.sentToProcessing} | processed=${summary.processed} | ` +
    `qualified=${summary.qualifiedLeads} | rejected=${summary.rejected} | ` +
    `hot=${summary.hot} warm=${summary.warm} cold=${summary.cold} | ` +
    `droppedMissingText=${summary.droppedMissingText} | droppedInvalidShape=${summary.droppedInvalidShape} | ` +
    `errors=${summary.errors}`,
  )

  return summary
}

// ── Core per-item pipeline ────────────────────────────────────────────────────

async function processOneItem(item) {
  // Step 4 — Persist raw item
  const raw = await prisma.rawSocialItem.create({
    data: {
      platform: item.platform,
      sourceType: item.sourceType,
      sourceUrl: item.sourceUrl,
      externalId: item.externalId,
      username: item.username,
      displayName: item.displayName,
      text: item.text,
      matchedHashtag: item.matchedHashtag,
      postedAt: item.postedAt,
      likesCount: item.likesCount,
      commentsCount: item.commentsCount,
      rawJson: item.rawJson,
    },
  })

  // Step 5 — Intent classification
  const classification = classify(item.text)

  // Step 6 — Score + temperature
  const scoring = scoreItem(item, classification)

  const decisionReason =
    `${classification.reason} | ` +
    scoring.breakdown.join(', ')

  // Step 7 — Persist decision
  const decision = await prisma.socialLeadDecision.create({
    data: {
      rawSocialItemId: raw.id,
      intentType: classification.intentType,
      concern: classification.concern,
      academyIntent: classification.academyIntent,
      score: scoring.score,
      temperature: scoring.temperature,
      decision: scoring.decision,
      reason: decisionReason.slice(0, 1000), // guard against very long reasons
    },
  })

  // Step 8 — Create CRM Lead if hot or warm
  let createdLeadId = null
  if (scoring.decision === 'ingest') {
    createdLeadId = await createCrmLead(item, classification, scoring, raw.id)

    // Step 9 — Link lead back to decision
    if (createdLeadId) {
      await prisma.socialLeadDecision.update({
        where: { id: decision.id },
        data: { createdLeadId },
      })
    } else {
      console.warn(
        `[Ingestion] Lead creation failed for ingest-decision item ` +
        `externalId=${item.externalId} — counted in qualifiedLeads (decision=ingest) ` +
        `but no CRM record was written`,
      )
    }
  }

  return {
    temperature: scoring.temperature,
    decision: scoring.decision,   // 'ingest' | 'reject'
    intentType: classification.intentType,
    createdLeadId,
  }
}

// ── CRM Lead creation ─────────────────────────────────────────────────────────

/**
 * Create a Lead record from a qualified scraped item.
 * Bypasses leadsService.createLead() to avoid mass admin Telegram alerts —
 * scraped leads are reviewed in bulk via the CRM, not alerted one-by-one.
 *
 * @returns {Promise<string|null>} created Lead.id or null on failure
 */
async function createCrmLead(item, classification, scoring, rawSocialItemId) {
  try {
    const fullName = item.displayName || item.username || 'Instagram User'
    const message = item.text || '(no caption)'
    const skinConcern = mapConcern(classification.concern)
    const intentTag = buildIntentTag(classification, scoring.temperature)

    const lead = await prisma.lead.create({
      data: {
        fullName,
        sourcePlatform: 'Instagram',
        sourceType: 'comment',          // hashtag post treated as a public comment
        handle: item.username,
        skinConcern,
        message: message.slice(0, 2000), // guard against very long captions
        status: 'new',
        priority: scoring.temperature === 'hot' ? 'high' : 'medium',
        intentTag,
        campaign: item.matchedHashtag ? `hashtag:${item.matchedHashtag}` : 'apify_import',
        // No follow-up scheduling for scraped leads — handled manually via CRM
        autoReplyEnabled: false,
      },
    })

    console.log(
      `[Ingestion] Created Lead ${lead.id} for @${item.username || 'unknown'} ` +
      `(${scoring.temperature}, ${scoring.score}pts)`,
    )
    return lead.id
  } catch (err) {
    console.error(`[Ingestion] Failed to create Lead for item ${rawSocialItemId}:`, err.message)
    return null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapConcern(concern) {
  return CONCERN_MAP[concern] || 'other'
}

function buildIntentTag(classification, temperature) {
  if (classification.intentType === 'academy') {
    return `academy_prospect:${classification.academyIntent || 'general'}:${temperature}`
  }
  if (classification.concern) {
    return `${classification.concern}:${temperature}`
  }
  return `consumer:${temperature}`
}

/**
 * Build the canonical ImportSummary object.
 * All invariants are enforced here — every item must end up in exactly one bucket.
 *
 * Invariants:
 *   rawFetched = droppedInvalidShape + duplicatesSkipped + droppedMissingText + sentToProcessing
 *   sentToProcessing = processed + errors
 *   processed = qualifiedLeads + rejected
 */
function buildSummary({ rawCount, droppedInvalidShape, skippedDupes, droppedMissingText, decisions, errors }) {
  const hot           = decisions.filter(d => d.temperature === 'hot').length
  const warm          = decisions.filter(d => d.temperature === 'warm').length
  const cold          = decisions.filter(d => d.temperature === 'cold').length
  // qualifiedLeads = items scored hot or warm (decision === 'ingest')
  const qualifiedLeads = decisions.filter(d => d.decision === 'ingest').length
  // rejected = items scored cold or below (decision === 'reject')
  const rejected      = decisions.filter(d => d.decision === 'reject').length
  const processed     = decisions.length  // qualifiedLeads + rejected
  const sentToProcessing = processed + errors

  return {
    rawFetched: rawCount,
    duplicatesSkipped: skippedDupes,
    sentToProcessing,
    processed,
    qualifiedLeads,
    hot,
    warm,
    cold,
    rejected,
    droppedMissingText,
    droppedInvalidShape,
    errors,
  }
}

// ── Types (JSDoc) ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} ImportSummary
 * @property {number} rawFetched          Total items returned by Apify (before any filtering)
 * @property {number} duplicatesSkipped   Items already in the DB (externalId match)
 * @property {number} sentToProcessing    New items with usable text sent through classify+score
 * @property {number} processed           Items that completed the pipeline (qualifiedLeads + rejected)
 * @property {number} qualifiedLeads      Items scored hot/warm — CRM Lead record attempted
 * @property {number} hot
 * @property {number} warm
 * @property {number} cold
 * @property {number} rejected            Items scored cold/reject — no Lead created
 * @property {number} droppedMissingText  New items skipped due to empty/too-short text
 * @property {number} droppedInvalidShape Items skipped during normalisation (no external ID)
 * @property {number} errors              Items that threw an unexpected error during processing
 */

module.exports = { importApifyDataset }
