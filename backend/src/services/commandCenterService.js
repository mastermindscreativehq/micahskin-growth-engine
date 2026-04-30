'use strict'

const prisma = require('../lib/prisma')
const { Prisma } = require('@prisma/client')
const { countFollowUpsDue } = require('./autoFollowUpService')
const { getAcquisitionStats } = require('./leadAcquisitionService')

const LEAD_MINI = {
  id: true,
  fullName: true,
  telegramChatId: true,
  currentFlow: true,
  lastFlowGuardReason: true,
  priority: true,
  status: true,
  primaryConcern: true,
  lastInteractionAt: true,
  createdAt: true,
  conversionStage: true,
  productIntentScore: true,
}

// Run fn(); on failure log the error, return defaultVal merged with {error: message}.
// This prevents one slow/failing section from crashing the whole dashboard.
async function safeSection(label, defaultVal, fn) {
  try {
    return await fn()
  } catch (err) {
    console.error(`[CommandCenter] Section "${label}" failed:`, err.message)
    return { ...defaultVal, error: err.message }
  }
}

async function getCommandCenter() {
  const now = new Date()
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const h48 = new Date(now.getTime() - 48 * 60 * 60 * 1000)

  // ── 1. Revenue — 2 batches of 2, run sequentially ─────────────────────────
  const revenue = await safeSection('revenue', {
    productRevenue: 0, academyRevenue: 0, consultRevenue: 0,
    unpaidQuoteTotal: 0, paidPendingFulfillmentTotal: 0,
  }, async () => {
    const [productRevAgg, academyRevAgg] = await Promise.all([
      prisma.paymentTransaction.aggregate({
        where: { quoteId: { not: null }, status: 'success' },
        _sum: { amount: true },
      }),
      prisma.academyRegistration.aggregate({
        where: { paymentStatus: 'paid' },
        _sum: { academyAmount: true },
      }),
    ])
    const [unpaidQuoteAgg, paidFulfillAgg] = await Promise.all([
      prisma.productQuote.aggregate({
        where: { status: 'sent', paymentStatus: { not: 'paid' } },
        _sum: { totalAmount: true },
      }),
      prisma.fulfillmentOrder.aggregate({
        where: { status: { in: ['awaiting_address', 'pending_fulfillment', 'packed'] } },
        _sum: { totalAmount: true },
      }),
    ])
    return {
      productRevenue:              productRevAgg._sum.amount          ?? 0,
      academyRevenue:              academyRevAgg._sum.academyAmount   ?? 0,
      consultRevenue:              0,
      unpaidQuoteTotal:            unpaidQuoteAgg._sum.totalAmount    ?? 0,
      paidPendingFulfillmentTotal: paidFulfillAgg._sum.totalAmount    ?? 0,
    }
  })

  // ── 2. Lead queue raw — 2 batches of 2, run sequentially ──────────────────
  const leadQueueRaw = await safeSection('leadQueue', {
    hotLeads: [], academyLockedLeads: [], abandonedPaymentLeads: [], stuckFlowLeads: [],
  }, async () => {
    const [hotLeads, academyLockedLeads] = await Promise.all([
      prisma.lead.findMany({
        where: {
          status: { notIn: ['closed'] },
          OR: [
            { priority: 'high', currentFlow: { in: ['product_quote_pending_review', 'product_quote_sent'] } },
            { productIntentScore: { gte: 70 }, status: { notIn: ['closed'] } },
          ],
        },
        select: LEAD_MINI,
        orderBy: [{ priority: 'desc' }, { lastInteractionAt: 'desc' }],
        take: 8,
      }),
      prisma.lead.findMany({
        where: { currentFlow: 'academy_locked' },
        select: LEAD_MINI,
        orderBy: { lastInteractionAt: 'desc' },
        take: 8,
      }),
    ])
    const [abandonedPaymentLeads, stuckFlowLeads] = await Promise.all([
      prisma.lead.findMany({
        where: {
          status: { notIn: ['closed'] },
          quotes: { some: { status: 'sent', paymentStatus: { not: 'paid' }, sentAt: { lt: h24 } } },
        },
        select: LEAD_MINI,
        orderBy: { lastInteractionAt: 'desc' },
        take: 8,
      }),
      prisma.lead.findMany({
        where: {
          currentFlow: { not: null },
          status: { notIn: ['closed'] },
          OR: [
            { lastInteractionAt: { lt: h48 } },
            { lastInteractionAt: null, createdAt: { lt: h48 } },
          ],
        },
        select: LEAD_MINI,
        orderBy: { lastInteractionAt: 'asc' },
        take: 10,
      }),
    ])
    return { hotLeads, academyLockedLeads, abandonedPaymentLeads, stuckFlowLeads }
  })

  // ── 3. Consult queue — 2 batches of 2, run sequentially ───────────────────
  const consults = await safeSection('consults', {
    activeDeepConsults:       { count: 0, items: [] },
    completedNeedingReview:   { count: 0, items: [] },
    redFlagLeads:             { count: 0, items: [] },
    completedNoProductAction: 0,
  }, async () => {
    const [activeConsults, completedReviewConsults] = await Promise.all([
      prisma.deepConsultation.findMany({
        where: { status: 'in_progress' },
        include: {
          lead: { select: { id: true, fullName: true, telegramChatId: true, primaryConcern: true, currentFlow: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      prisma.deepConsultation.findMany({
        where: { status: 'completed', needsHumanReview: true },
        include: {
          lead: { select: { id: true, fullName: true, telegramChatId: true, primaryConcern: true, currentFlow: true } },
        },
        orderBy: { completedAt: 'desc' },
        take: 8,
      }),
    ])
    const [redFlagConsults, completedNoProductCount] = await Promise.all([
      prisma.deepConsultation.findMany({
        where: { redFlags: { isEmpty: false } },
        include: {
          lead: { select: { id: true, fullName: true, telegramChatId: true, primaryConcern: true, currentFlow: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
      prisma.lead.count({
        where: {
          status: { notIn: ['closed'] },
          deepConsultations: { some: { status: 'completed' } },
          quotes: { none: {} },
        },
      }),
    ])
    return {
      activeDeepConsults:       { count: activeConsults.length,          items: activeConsults },
      completedNeedingReview:   { count: completedReviewConsults.length, items: completedReviewConsults },
      redFlagLeads:             { count: redFlagConsults.length,         items: redFlagConsults },
      completedNoProductAction: completedNoProductCount,
    }
  })

  // Build leadQueue from raw + consult counts (both sections already resolved)
  const leadQueue = {
    hotProductLeads:  { count: leadQueueRaw.hotLeads?.length             ?? 0, leads: leadQueueRaw.hotLeads             ?? [] },
    deepConsultActive: consults.activeDeepConsults?.count                 ?? 0,
    humanReviewNeeded: consults.completedNeedingReview?.count             ?? 0,
    abandonedPayment: { count: leadQueueRaw.abandonedPaymentLeads?.length ?? 0, leads: leadQueueRaw.abandonedPaymentLeads ?? [] },
    academyLocked:    { count: leadQueueRaw.academyLockedLeads?.length   ?? 0, leads: leadQueueRaw.academyLockedLeads   ?? [] },
    stuckFlows:       { count: leadQueueRaw.stuckFlowLeads?.length       ?? 0, leads: leadQueueRaw.stuckFlowLeads       ?? [] },
    error:            leadQueueRaw.error ?? null,
  }

  // ── 4. Fulfillment — single groupBy ───────────────────────────────────────
  const fulfillment = await safeSection('fulfillment', {
    awaitingAddress: 0, pendingFulfillment: 0, packed: 0, delivered: 0, cancelled: 0,
  }, async () => {
    const groups = await prisma.fulfillmentOrder.groupBy({
      by: ['status'],
      _count: { id: true },
    })
    const m = {}
    for (const row of groups) m[row.status] = row._count.id
    return {
      awaitingAddress:    m['awaiting_address']    ?? 0,
      pendingFulfillment: m['pending_fulfillment'] ?? 0,
      packed:             m['packed']              ?? 0,
      delivered:          m['delivered']           ?? 0,
      cancelled:          m['cancelled']           ?? 0,
    }
  })

  // ── 5. System alerts — 2 batches of 2, run sequentially ───────────────────
  const alerts = await safeSection('alerts', {
    failedTelegramSends:     0,
    quotePendingTooLong:     { count: 0, quotes: [] },
    diagnosisPendingTooLong: { count: 0, leads: [] },
    noProductMatches:        { count: 0, leads: [] },
    stuckCurrentFlow:        { count: 0, leads: [] },
  }, async () => {
    const [failedTelegramCount, quotePendingTooLong] = await Promise.all([
      prisma.messageLog.count({
        where: { channel: 'telegram', status: 'failed', createdAt: { gte: h24 } },
      }),
      prisma.productQuote.findMany({
        where: { status: 'pending_review', createdAt: { lt: h24 } },
        include: { lead: { select: { id: true, fullName: true, telegramChatId: true, primaryConcern: true } } },
        orderBy: { createdAt: 'asc' },
        take: 10,
      }),
    ])
    const [diagnosisPendingLeads, noProductMatchLeads] = await Promise.all([
      prisma.lead.findMany({
        where: {
          telegramStarted: true,
          diagnosisSent: false,
          status: { notIn: ['closed'] },
          OR: [
            { telegramConnectedAt: { lt: h24 } },
            { telegramConnectedAt: null, createdAt: { lt: h48 } },
          ],
        },
        select: LEAD_MINI,
        orderBy: { createdAt: 'asc' },
        take: 8,
      }),
      prisma.lead.findMany({
        where: {
          diagnosisSent: true,
          productRecommendation: { equals: Prisma.DbNull },
          status: { notIn: ['closed'] },
        },
        select: LEAD_MINI,
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
    ])
    return {
      failedTelegramSends:     failedTelegramCount,
      quotePendingTooLong:     { count: quotePendingTooLong.length,   quotes: quotePendingTooLong },
      diagnosisPendingTooLong: { count: diagnosisPendingLeads.length, leads: diagnosisPendingLeads },
      noProductMatches:        { count: noProductMatchLeads.length,   leads: noProductMatchLeads },
      // reuse already-fetched stuckFlows data — no extra query
      stuckCurrentFlow:        { count: leadQueue.stuckFlows.count,   leads: leadQueue.stuckFlows.leads },
    }
  })

  // ── 6. Follow-ups — runs alone after all main queries finish ──────────────
  const followUps = await safeSection('followUps', {
    total: 0, paused: false,
    quoteDue: 0, pendingDue: 0, consultDue: 0, diagnosisDue: 0, abandonedDue: 0,
  }, countFollowUpsDue)

  // ── 7. Acquisition stats — runs last ──────────────────────────────────────
  const leadSources = await safeSection('leadSources', {
    scrapedToday: 0, highIntentToday: 0, pendingOutreach: 0,
    processedTotal: 0, totalScraped: 0, engineStatus: 'idle',
  }, getAcquisitionStats)

  return {
    generatedAt: now.toISOString(),
    revenue,
    leadQueue,
    fulfillment,
    consults,
    alerts,
    followUps,
    leadSources,
  }
}

module.exports = { getCommandCenter }
