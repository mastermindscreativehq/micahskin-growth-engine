'use strict'

/**
 * outreachQueueService.js
 * Phase 36 — Human-Assisted TikTok Conversion Engine
 *
 * Lightweight read/write helpers around the scraped_leads table for the
 * operator's outreach queue. No new state machine — just selects, ordering,
 * and a status setter.
 */

const prisma           = require('../lib/prisma')
const leadHeatEngine   = require('./leadHeatEngine')

const VALID_STATUSES = new Set(['pending', 'replied', 'converted', 'skipped'])
const VALID_TEMPS    = new Set(['hot', 'warm', 'cold'])

/**
 * listOutreachQueue
 *
 * Returns rows ready for the operator to act on. Defaults: pending, all
 * temperatures with score >= COLD_THRESHOLD, newest first, limit 100.
 *
 * @param {object} [opts]
 * @param {string} [opts.status='pending']  pending|replied|converted|skipped|all
 * @param {string} [opts.temperature='all'] hot|warm|cold|all
 * @param {boolean}[opts.commentsOnly=true] Only include commenter rows.
 * @param {number} [opts.limit=100]
 * @param {number} [opts.minScore]          Override floor (default COLD_THRESHOLD)
 */
async function listOutreachQueue(opts = {}) {
  const status        = opts.status        || 'pending'
  const temperature   = opts.temperature   || 'all'
  const commentsOnly  = opts.commentsOnly !== false
  const limit         = Math.min(500, Math.max(1, Number(opts.limit) || 100))
  const minScore      = Number.isFinite(Number(opts.minScore))
    ? Number(opts.minScore)
    : leadHeatEngine.COLD_THRESHOLD

  const where = {}
  if (status !== 'all' && VALID_STATUSES.has(status)) {
    where.outreachStatus = status
  }
  if (commentsOnly) {
    where.isComment = true
  }
  // Heat band filter
  if (temperature === 'hot') {
    where.leadHeatScore = { gte: leadHeatEngine.HOT_THRESHOLD }
  } else if (temperature === 'warm') {
    where.leadHeatScore = {
      gte: leadHeatEngine.WARM_THRESHOLD,
      lt:  leadHeatEngine.HOT_THRESHOLD,
    }
  } else if (temperature === 'cold') {
    where.leadHeatScore = {
      gte: leadHeatEngine.COLD_THRESHOLD,
      lt:  leadHeatEngine.WARM_THRESHOLD,
    }
  } else {
    where.leadHeatScore = { gte: minScore }
  }

  const rows = await prisma.scrapedLead.findMany({
    where,
    orderBy: [{ leadHeatScore: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    select: {
      id:                  true,
      platform:            true,
      username:            true,
      comment:             true,
      videoUrl:            true,
      sourceVideoUrl:      true,
      hashtag:             true,
      isComment:           true,
      postedAt:            true,
      createdAt:           true,
      concernType:         true,
      detectedCity:        true,
      leadHeatScore:       true,
      leadSegment:         true,
      buyerReadinessScore: true,
      painSignalScore:     true,
      buyingStage:         true,
      recommendedAction:   true,
      aiSummary:           true,
      outreachAngle:       true,
      ctaType:             true,
      // Reply pack — suggestedReply lives on Lead, joined below
      whatsappCta:         true,
      consultCta:          true,
      academyCta:          true,
      // Status
      outreachStatus:      true,
      outreachStatusUpdatedAt: true,
      outreachOperator:    true,
      injectedLeadId:      true,
      outreachQueued:      true,
    },
  })

  // Annotate each row with temperature label + a profile URL + the chosen
  // suggested reply (joined from Lead.suggestedReply when available).
  const leadIds = rows.map(r => r.injectedLeadId).filter(Boolean)
  const leadMap = new Map()
  if (leadIds.length) {
    const leads = await prisma.lead.findMany({
      where:  { id: { in: leadIds } },
      select: { id: true, suggestedReply: true, status: true, leadStage: true },
    })
    for (const l of leads) leadMap.set(l.id, l)
  }

  return rows.map(r => {
    const linkedLead = r.injectedLeadId ? leadMap.get(r.injectedLeadId) : null
    return {
      id:                   r.id,
      platform:             r.platform,
      username:             r.username,
      profileUrl:           r.username ? `https://www.tiktok.com/@${r.username.replace(/^@/, '')}` : null,
      commentText:          r.comment,
      sourceVideoUrl:       r.sourceVideoUrl || r.videoUrl || null,
      hashtag:              r.hashtag,
      isComment:            r.isComment,
      postedAt:             r.postedAt,
      createdAt:            r.createdAt,
      painCategory:         r.concernType || r.leadSegment || 'general',
      detectedCity:         r.detectedCity,
      leadHeatScore:        r.leadHeatScore,
      buyerReadinessScore:  r.buyerReadinessScore,
      painSignalScore:      r.painSignalScore,
      buyingStage:          r.buyingStage,
      recommendedAction:    r.recommendedAction,
      aiSummary:            r.aiSummary,
      outreachAngle:        r.outreachAngle,
      temperature:          leadHeatEngine.temperatureLabel(r.leadHeatScore),
      ctaType:              r.ctaType || r.recommendedAction,
      suggestedReply:       linkedLead?.suggestedReply || null,
      whatsappCta:          r.whatsappCta,
      consultCta:           r.consultCta,
      academyCta:           r.academyCta,
      outreachStatus:       r.outreachStatus || 'pending',
      outreachStatusUpdatedAt: r.outreachStatusUpdatedAt,
      outreachOperator:     r.outreachOperator,
      injectedLeadId:       r.injectedLeadId,
      leadStage:            linkedLead?.leadStage || null,
    }
  })
}

async function updateOutreachStatus(id, { status, operator } = {}) {
  if (!id) {
    const err = new Error('id is required')
    err.status = 400
    throw err
  }
  if (!VALID_STATUSES.has(status)) {
    const err = new Error(`status must be one of ${[...VALID_STATUSES].join(', ')}`)
    err.status = 400
    throw err
  }

  const updated = await prisma.scrapedLead.update({
    where: { id },
    data: {
      outreachStatus:          status,
      outreachStatusUpdatedAt: new Date(),
      outreachOperator:        operator || null,
    },
    select: {
      id: true, outreachStatus: true, outreachStatusUpdatedAt: true, outreachOperator: true,
      injectedLeadId: true,
    },
  })

  // Mirror conversion onto the Lead record so downstream funnels notice.
  if (updated.injectedLeadId && (status === 'replied' || status === 'converted')) {
    try {
      await prisma.lead.update({
        where: { id: updated.injectedLeadId },
        data: {
          status:            status === 'converted' ? 'converted' : 'engaged',
          leadStage:         status === 'converted' ? 'converted' : 'replied',
          lastInteractionAt: new Date(),
        },
      })
    } catch (err) {
      console.warn(`[OutreachQueue] Lead mirror failed for ${updated.injectedLeadId}:`, err.message)
    }
  }

  return updated
}

async function getOutreachCounts() {
  const [pending, replied, converted, skipped, hot, warm, cold] = await Promise.all([
    prisma.scrapedLead.count({ where: { outreachStatus: 'pending',   isComment: true, leadHeatScore: { gte: leadHeatEngine.COLD_THRESHOLD } } }),
    prisma.scrapedLead.count({ where: { outreachStatus: 'replied' } }),
    prisma.scrapedLead.count({ where: { outreachStatus: 'converted' } }),
    prisma.scrapedLead.count({ where: { outreachStatus: 'skipped' } }),
    prisma.scrapedLead.count({ where: { outreachStatus: 'pending', leadHeatScore: { gte: leadHeatEngine.HOT_THRESHOLD } } }),
    prisma.scrapedLead.count({ where: { outreachStatus: 'pending', leadHeatScore: { gte: leadHeatEngine.WARM_THRESHOLD, lt: leadHeatEngine.HOT_THRESHOLD } } }),
    prisma.scrapedLead.count({ where: { outreachStatus: 'pending', leadHeatScore: { gte: leadHeatEngine.COLD_THRESHOLD, lt: leadHeatEngine.WARM_THRESHOLD } } }),
  ])

  return {
    readyToReply: pending,
    replied,
    converted,
    skipped,
    pendingByTemperature: { hot, warm, cold },
    thresholds: {
      hot:  leadHeatEngine.HOT_THRESHOLD,
      warm: leadHeatEngine.WARM_THRESHOLD,
      cold: leadHeatEngine.COLD_THRESHOLD,
    },
  }
}

module.exports = {
  listOutreachQueue,
  updateOutreachStatus,
  getOutreachCounts,
}
