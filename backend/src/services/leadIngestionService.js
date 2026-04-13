/**
 * leadIngestionService.js
 * Orchestrates the full Instagram (Apify) lead-ingestion pipeline.
 *
 * Pipeline steps for each raw item:
 *   1. Normalise (done by apifyService before this runs)
 *   2. Deduplicate — skip if externalId already in raw_social_items
 *   3. Persist raw item to raw_social_items
 *   4. Classify intent (intentClassifierService)
 *   5. Score + assign temperature (leadScoringService)
 *   6. Persist decision to social_lead_decisions
 *   7. If decision = 'ingest' (hot or warm) → create CRM Lead record
 *   8. Link created Lead ID back to the decision row
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
  const items = await fetchAndNormaliseDataset(datasetId, platform)

  if (items.length === 0) {
    console.log('[Ingestion] Dataset is empty or produced no normalisable items.')
    return buildSummary(0, [], [])
  }

  // 2 — Batch dedupe check before the loop (one DB query instead of N)
  const allExternalIds = items.map(i => i.externalId)
  const existingIds = await findExistingIds(allExternalIds)

  const newItems = items.filter(i => !existingIds.has(i.externalId))
  const skippedDupes = items.length - newItems.length

  console.log(`[Ingestion] ${items.length} total | ${skippedDupes} duplicates skipped | ${newItems.length} to process`)

  // 3–7 — Process each new item sequentially to keep DB load manageable
  const decisions = []

  for (const item of newItems) {
    try {
      const result = await processOneItem(item)
      decisions.push(result)
    } catch (err) {
      // Log and continue — one bad item should not abort the whole import
      console.error(`[Ingestion] Failed to process item ${item.externalId}:`, err.message)
    }
  }

  const summary = buildSummary(items.length, decisions, existingIds)

  console.log(
    `[Ingestion] Done — raw=${summary.importedRaw}, qualified=${summary.qualifiedLeads}, ` +
    `hot=${summary.hot}, warm=${summary.warm}, cold=${summary.cold}, rejected=${summary.rejected}, ` +
    `dupes=${summary.duplicatesSkipped}`,
  )

  return summary
}

// ── Core per-item pipeline ────────────────────────────────────────────────────

async function processOneItem(item) {
  // Step 3 — Persist raw item
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

  // Step 4 — Intent classification
  const classification = classify(item.text)

  // Step 5 — Score + temperature
  const scoring = scoreItem(item, classification)

  const decisionReason =
    `${classification.reason} | ` +
    scoring.breakdown.join(', ')

  // Step 6 — Persist decision
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

  // Step 7 — Create CRM Lead if hot or warm
  let createdLeadId = null
  if (scoring.decision === 'ingest') {
    createdLeadId = await createCrmLead(item, classification, scoring, raw.id)

    // Step 8 — Link lead back to decision
    if (createdLeadId) {
      await prisma.socialLeadDecision.update({
        where: { id: decision.id },
        data: { createdLeadId },
      })
    }
  }

  return {
    temperature: scoring.temperature,
    decision: scoring.decision,
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

function buildSummary(totalFetched, decisions, existingIds) {
  const hot = decisions.filter(d => d.temperature === 'hot').length
  const warm = decisions.filter(d => d.temperature === 'warm').length
  const cold = decisions.filter(d => d.temperature === 'cold').length
  const rejected = decisions.filter(d => d.decision === 'reject').length
  const qualifiedLeads = decisions.filter(d => d.createdLeadId !== null).length

  return {
    importedRaw: totalFetched,
    duplicatesSkipped: existingIds.size,
    processed: decisions.length,
    qualifiedLeads,
    hot,
    warm,
    cold,
    rejected,
  }
}

// ── Types (JSDoc) ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} ImportSummary
 * @property {number} importedRaw        Total items returned by Apify
 * @property {number} duplicatesSkipped  Items that were already in the DB
 * @property {number} processed          Items that went through the pipeline
 * @property {number} qualifiedLeads     CRM Lead records created (hot + warm)
 * @property {number} hot
 * @property {number} warm
 * @property {number} cold
 * @property {number} rejected
 */

module.exports = { importApifyDataset }
