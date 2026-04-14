/**
 * orchestrationService.js
 * Runs the full Instagram discovery → lead ingestion → comment harvest pipeline
 * in a single sequential call, then provides status polling to auto-trigger
 * Stage 4 (comment ingestion) once the Apify run completes.
 *
 * Stages:
 *   1. importApifyDataset              — raw items → classify → score → CRM leads
 *   2. prepareCommentTargets           — same dataset → extract post URLs → comment_scrape_targets
 *   3. runCommentHarvest               — pending targets → trigger Apify comment scrape run
 *   4. importInstagramCommentDataset   — triggered automatically on SUCCEEDED (via polling)
 */

const prisma = require('../lib/prisma')
const { importApifyDataset } = require('./leadIngestionService')
const { prepareCommentTargets, runCommentHarvest } = require('./commentScrapeService')
const { importInstagramCommentDataset } = require('./commentIngestionService')
const { getApifyRunStatus } = require('./apifyService')

// ── Stage 1–3 orchestration ───────────────────────────────────────────────────

/**
 * Run Stage 1 + Stage 2 + Stage 3 in sequence for a single discovery dataset.
 * After Stage 3, persists an OrchestrationRun row so the caller can poll for
 * Stage 4 completion via checkOrchestrationStatus().
 *
 * @param {object} options
 * @param {string} options.discoveryDatasetId  Apify dataset ID from the post-discovery run
 * @param {string} [options.platform]          Target platform (default: 'instagram')
 * @param {number} [options.harvestLimit]      Max comment targets to queue in Stage 3 (default: 50)
 * @returns {Promise<OrchestrationResult>}
 */
async function runInstagramOrchestration({ discoveryDatasetId, platform = 'instagram', harvestLimit = 50 }) {
  console.log(
    `[Orchestration] Starting Instagram orchestration — ` +
    `discoveryDatasetId=${discoveryDatasetId} platform=${platform} harvestLimit=${harvestLimit}`,
  )

  // ── Stage 1: import discovery dataset → CRM leads ────────────────────────────
  console.log('[Orchestration] Stage 1: importing discovery dataset...')
  const stage1 = await importApifyDataset(discoveryDatasetId, platform)
  console.log(
    `[Orchestration] Stage 1 complete — ` +
    `rawFetched=${stage1.rawFetched} qualifiedLeads=${stage1.qualifiedLeads} ` +
    `hot=${stage1.hot} warm=${stage1.warm} rejected=${stage1.rejected}`,
  )

  // ── Stage 2: prepare comment scrape targets from the same discovery dataset ──
  console.log('[Orchestration] Stage 2: preparing comment scrape targets...')
  const stage2 = await prepareCommentTargets(discoveryDatasetId)
  console.log(
    `[Orchestration] Stage 2 complete — ` +
    `rawItemsSeen=${stage2.rawItemsSeen} newTargetsSaved=${stage2.newTargetsSaved} ` +
    `duplicatesSkipped=${stage2.duplicatesSkipped}`,
  )

  // ── Stage 3: trigger Instagram comment harvest ────────────────────────────────
  console.log(`[Orchestration] Stage 3: triggering comment harvest (limit=${harvestLimit})...`)
  const stage3 = await runCommentHarvest(harvestLimit)
  console.log(
    `[Orchestration] Stage 3 complete — ` +
    `pendingFound=${stage3.pendingFound} targetsQueued=${stage3.targetsQueued} ` +
    `apifyRunId=${stage3.apifyRunId}`,
  )

  // ── Persist OrchestrationRun for status polling ───────────────────────────────
  // Only created when Stage 3 actually queued an Apify run. If no pending targets
  // existed, apifyRunId will be null and there is nothing to poll.
  let orchestrationRunId = null
  if (stage3.apifyRunId) {
    const run = await prisma.orchestrationRun.create({
      data: {
        platform,
        discoveryDatasetId,
        commentRunId: stage3.apifyRunId,
        status: 'running',
      },
    })
    orchestrationRunId = run.id
    console.log(
      `[Orchestration] OrchestrationRun persisted — ` +
      `orchestrationRunId=${orchestrationRunId} commentRunId=${stage3.apifyRunId}`,
    )
  } else {
    console.log('[Orchestration] No Apify run queued — skipping OrchestrationRun creation')
  }

  const result = {
    discoveryDatasetId,
    platform,
    orchestrationRunId,
    stage1,
    stage2,
    stage3,
  }

  console.log('[Orchestration] Final combined result:', JSON.stringify(result))

  return result
}

// ── Stage 4 status polling ────────────────────────────────────────────────────

/**
 * Poll Apify for the status of the comment harvest run linked to an OrchestrationRun.
 * If the Apify run has SUCCEEDED, automatically triggers Stage 4 (comment ingestion),
 * updates the OrchestrationRun to "completed", and returns the Stage 4 result.
 *
 * Intended to be called repeatedly (e.g. every 30–60 s) until status is no longer
 * "running". Once the run reaches "completed" or "failed" it will not re-execute
 * Stage 4 on subsequent calls.
 *
 * @param {string} runId  OrchestrationRun.id (UUID, NOT the Apify run ID)
 * @returns {Promise<StatusCheckResult>}
 */
async function checkOrchestrationStatus(runId) {
  console.log(`[Orchestration] Polling status for orchestration run ${runId}`)

  const run = await prisma.orchestrationRun.findUnique({ where: { id: runId } })
  if (!run) {
    const err = new Error(`OrchestrationRun not found: ${runId}`)
    err.status = 404
    throw err
  }

  // Already in a terminal state — return cached result without hitting Apify
  if (run.status === 'completed' || run.status === 'failed') {
    console.log(`[Orchestration] Run ${runId} already in terminal state: ${run.status}`)
    return {
      orchestrationRunId: runId,
      status: run.status,
      commentRunId: run.commentRunId,
      commentDatasetId: run.commentDatasetId,
      stage4: run.stage4Result,
    }
  }

  if (!run.commentRunId) {
    console.log(`[Orchestration] Run ${runId} has no commentRunId — cannot poll Apify`)
    return {
      orchestrationRunId: runId,
      status: 'running',
      apifyStatus: null,
      message: 'No Apify run ID recorded on this orchestration run',
    }
  }

  // ── Poll Apify ────────────────────────────────────────────────────────────────
  console.log(`[Orchestration] Checking Apify run ${run.commentRunId}...`)
  const { status: apifyStatus, defaultDatasetId } = await getApifyRunStatus(run.commentRunId)
  console.log(`[Orchestration] Apify run ${run.commentRunId} — status=${apifyStatus}`)

  // Not finished yet
  if (apifyStatus !== 'SUCCEEDED') {
    // Mark as failed in DB if Apify reports a terminal failure
    if (apifyStatus === 'FAILED' || apifyStatus === 'TIMED-OUT' || apifyStatus === 'ABORTED') {
      await prisma.orchestrationRun.update({
        where: { id: runId },
        data: { status: 'failed' },
      })
      console.log(`[Orchestration] Run ${runId} marked failed — Apify status: ${apifyStatus}`)
      return {
        orchestrationRunId: runId,
        status: 'failed',
        apifyStatus,
        commentRunId: run.commentRunId,
      }
    }

    return {
      orchestrationRunId: runId,
      status: 'running',
      apifyStatus,
      commentRunId: run.commentRunId,
    }
  }

  // ── Apify SUCCEEDED → trigger Stage 4 ────────────────────────────────────────
  console.log(
    `[Orchestration] Apify run SUCCEEDED — ` +
    `triggering Stage 4 with commentDatasetId=${defaultDatasetId}`,
  )

  let stage4Result
  try {
    stage4Result = await importInstagramCommentDataset(defaultDatasetId)
    console.log(
      `[Orchestration] Stage 4 complete — ` +
      `leadsCreated=${stage4Result.leadsCreated} inserted=${stage4Result.inserted} ` +
      `duplicates=${stage4Result.duplicates}`,
    )
  } catch (err) {
    console.error(`[Orchestration] Stage 4 failed — commentDatasetId=${defaultDatasetId}:`, err.message)
    await prisma.orchestrationRun.update({
      where: { id: runId },
      data: { status: 'failed', commentDatasetId: defaultDatasetId },
    })
    throw err
  }

  // ── Mark orchestration run completed ─────────────────────────────────────────
  await prisma.orchestrationRun.update({
    where: { id: runId },
    data: {
      status: 'completed',
      commentDatasetId: defaultDatasetId,
      stage4Result,
    },
  })

  console.log(`[Orchestration] Run ${runId} marked completed`)

  return {
    orchestrationRunId: runId,
    status: 'completed',
    apifyStatus,
    commentRunId: run.commentRunId,
    commentDatasetId: defaultDatasetId,
    stage4: stage4Result,
  }
}

// ── Types (JSDoc) ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} OrchestrationResult
 * @property {string}          discoveryDatasetId  Apify dataset ID used for Stage 1 + 2
 * @property {string}          platform            'instagram'
 * @property {string|null}     orchestrationRunId  UUID to poll via checkOrchestrationStatus (null if no targets queued)
 * @property {ImportSummary}   stage1              Result from leadIngestionService.importApifyDataset
 * @property {PrepareSummary}  stage2              Result from commentScrapeService.prepareCommentTargets
 * @property {HarvestResult}   stage3              Result from commentScrapeService.runCommentHarvest
 */

/**
 * @typedef {object} StatusCheckResult
 * @property {string}      orchestrationRunId
 * @property {string}      status             running | completed | failed
 * @property {string|null} apifyStatus        Raw Apify run status (null if not yet polled)
 * @property {string|null} commentRunId       Apify run ID
 * @property {string|null} commentDatasetId   Apify output dataset ID (set on SUCCEEDED)
 * @property {object|null} stage4             Stage 4 import result (set on completed)
 */

// ── Background orchestration poller ──────────────────────────────────────────

/**
 * One polling cycle: find every OrchestrationRun in "running" state and advance
 * it through checkOrchestrationStatus(), which is already idempotent — terminal
 * runs return their cached result instantly without hitting Apify again.
 */
async function pollRunningOrchestrations() {
  let runs
  try {
    runs = await prisma.orchestrationRun.findMany({
      where: { status: 'running' },
      select: { id: true, commentRunId: true },
    })
  } catch (err) {
    console.error('[OrchestrationPoller] DB query failed:', err.message)
    return
  }

  if (runs.length === 0) return

  console.log(`[OrchestrationPoller] Checking ${runs.length} running orchestration(s)...`)

  for (const run of runs) {
    try {
      const result = await checkOrchestrationStatus(run.id)
      if (result.status !== 'running') {
        console.log(
          `[OrchestrationPoller] Run ${run.id} → ${result.status}` +
          (result.apifyStatus ? ` (Apify: ${result.apifyStatus})` : ''),
        )
      }
    } catch (err) {
      console.error(`[OrchestrationPoller] checkOrchestrationStatus(${run.id}) failed:`, err.message)
    }
  }
}

/**
 * Starts the background orchestration poller.
 * Polls every 30 s by default (overridable via ORCHESTRATION_POLL_INTERVAL_MS).
 * Runs once immediately on boot so any run that completed while the server was
 * down is picked up without waiting a full interval.
 *
 * When the Apify comment run SUCCEEDS, checkOrchestrationStatus() automatically
 * calls importInstagramCommentDataset() (Stage 4) and marks the run "completed".
 * On FAILED / TIMED-OUT / ABORTED it marks the run "failed". The function is
 * idempotent: once a run is in a terminal state it is never re-processed.
 */
function startOrchestrationPoller() {
  const intervalMs = parseInt(process.env.ORCHESTRATION_POLL_INTERVAL_MS || '30000', 10)
  console.log(`✅ Orchestration poller started (checks every ${intervalMs / 1000}s)`)
  pollRunningOrchestrations()
  setInterval(pollRunningOrchestrations, intervalMs)
}

module.exports = { runInstagramOrchestration, checkOrchestrationStatus, startOrchestrationPoller }
