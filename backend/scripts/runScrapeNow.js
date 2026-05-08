'use strict'

/**
 * scripts/runScrapeNow.js
 * Phase 36 — One-shot driver: kicks the acquisition cycle, polls Apify until
 * both the video and chained comments stages finish, then prints the real
 * accepted comment leads. No fake seeds, no test fixtures.
 *
 * Run from backend dir:
 *   node scripts/runScrapeNow.js
 */

const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

const prisma = require('../src/lib/prisma')
const { runAcquisitionCycle } = require('../src/services/leadAcquisitionService')
const { listOutreachQueue, getOutreachCounts } = require('../src/services/outreachQueueService')

const POLL_EVERY_MS = 25_000
const MAX_TICKS     = 24            // 24 × 25s = 10 min total
const NEW_SINCE     = new Date()    // only show rows created during this run

async function tick(label) {
  process.stdout.write(`[runScrapeNow] tick ${label} at ${new Date().toISOString()}\n`)
  try {
    await runAcquisitionCycle()
  } catch (err) {
    console.error(`[runScrapeNow] cycle error: ${err.message}`)
  }
}

async function snapshotState() {
  const [counts, totalSinceStart, commentsSinceStart] = await Promise.all([
    getOutreachCounts(),
    prisma.scrapedLead.count({ where: { createdAt: { gte: NEW_SINCE } } }),
    prisma.scrapedLead.count({ where: { createdAt: { gte: NEW_SINCE }, isComment: true } }),
  ])
  return { counts, totalSinceStart, commentsSinceStart }
}

async function main() {
  const t0 = Date.now()

  // Tick #1 — either polls the in-flight video run or queues a fresh one.
  await tick('1')

  for (let i = 2; i <= MAX_TICKS; i++) {
    const state = await snapshotState()
    console.log(
      `[runScrapeNow] state — sinceStart total=${state.totalSinceStart}` +
      ` comments=${state.commentsSinceStart}` +
      ` queue ready=${state.counts.readyToReply}` +
      ` hot=${state.counts.pendingByTemperature.hot}` +
      ` warm=${state.counts.pendingByTemperature.warm}` +
      ` cold=${state.counts.pendingByTemperature.cold}`,
    )
    if (state.commentsSinceStart >= 5) {
      console.log('[runScrapeNow] Comments arrived — exiting poll loop')
      break
    }
    await new Promise(r => setTimeout(r, POLL_EVERY_MS))
    await tick(String(i))
  }

  const finalCounts = await getOutreachCounts()
  console.log('[runScrapeNow] Final outreach counts:', JSON.stringify(finalCounts, null, 2))

  const accepted = await prisma.scrapedLead.findMany({
    where: { createdAt: { gte: NEW_SINCE }, isComment: true },
    orderBy: [{ leadHeatScore: 'desc' }, { createdAt: 'desc' }],
    take: 25,
    select: {
      username: true, comment: true, sourceVideoUrl: true, videoUrl: true,
      concernType: true, leadSegment: true, painSignalScore: true,
      buyerReadinessScore: true, leadHeatScore: true, recommendedAction: true,
      ctaType: true, whatsappCta: true, consultCta: true, academyCta: true,
      outreachStatus: true, rejectionReason: true,
    },
  })

  console.log(`\n[runScrapeNow] ── REAL ACCEPTED COMMENT LEADS (${accepted.length}) ──`)
  for (const r of accepted) {
    console.log(JSON.stringify({
      username:        r.username,
      comment:         r.comment,
      painType:        r.concernType || r.leadSegment,
      buyerIntent:     r.buyerReadinessScore,
      heat:            r.leadHeatScore,
      suggestedReply:  r.consultCta || r.whatsappCta,
      videoUrl:        r.sourceVideoUrl || r.videoUrl,
      outreachStatus:  r.outreachStatus,
    }, null, 2))
  }

  const rejected = await prisma.scrapedLead.findMany({
    where: { createdAt: { gte: NEW_SINCE }, isComment: true, rejectionReason: { not: null } },
    take: 10,
    select: { username: true, comment: true, rejectionReason: true, leadHeatScore: true },
  })
  console.log(`\n[runScrapeNow] ── REJECTED (${rejected.length}) ──`)
  for (const r of rejected) {
    console.log(JSON.stringify(r))
  }

  console.log(`\n[runScrapeNow] Done in ${Math.round((Date.now() - t0) / 1000)}s`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[runScrapeNow] fatal:', err)
    process.exit(1)
  })
