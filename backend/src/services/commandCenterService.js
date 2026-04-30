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

async function getCommandCenter() {
  const now = new Date()
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const h48 = new Date(now.getTime() - 48 * 60 * 60 * 1000)

  const [
    productRevAgg,
    academyRevAgg,
    unpaidQuoteAgg,
    paidFulfillAgg,

    hotLeads,
    academyLockedLeads,
    abandonedPaymentLeads,
    stuckFlowLeads,

    activeConsults,
    completedReviewConsults,
    redFlagConsults,
    completedNoProductCount,

    fulfillmentGroups,

    failedTelegramCount,
    quotePendingTooLong,
    diagnosisPendingLeads,
    noProductMatchLeads,
    followUpsDue,
    acquisitionStats,
  ] = await Promise.all([

    // ── Revenue ────────────────────────────────────────────────────────────────

    // Product: PaymentTransaction linked to a ProductQuote
    prisma.paymentTransaction.aggregate({
      where: { quoteId: { not: null }, status: 'success' },
      _sum: { amount: true },
    }),

    // Academy: registrations marked paid
    prisma.academyRegistration.aggregate({
      where: { paymentStatus: 'paid' },
      _sum: { academyAmount: true },
    }),

    // Unpaid quotes: sent but not yet paid
    prisma.productQuote.aggregate({
      where: { status: 'sent', paymentStatus: { not: 'paid' } },
      _sum: { totalAmount: true },
    }),

    // Paid → pending fulfillment: paid orders not yet delivered
    prisma.fulfillmentOrder.aggregate({
      where: { status: { in: ['awaiting_address', 'pending_fulfillment', 'packed'] } },
      _sum: { totalAmount: true },
    }),

    // ── Lead Priority Queue ────────────────────────────────────────────────────

    // Hot product leads: high priority in product flow OR high product intent score
    prisma.lead.findMany({
      where: {
        status: { notIn: ['closed'] },
        OR: [
          {
            priority: 'high',
            currentFlow: { in: ['product_quote_pending_review', 'product_quote_sent'] },
          },
          { productIntentScore: { gte: 70 }, status: { notIn: ['closed'] } },
        ],
      },
      select: LEAD_MINI,
      orderBy: [{ priority: 'desc' }, { lastInteractionAt: 'desc' }],
      take: 8,
    }),

    // Academy locked leads
    prisma.lead.findMany({
      where: { currentFlow: 'academy_locked' },
      select: LEAD_MINI,
      orderBy: { lastInteractionAt: 'desc' },
      take: 8,
    }),

    // Abandoned payment: quote sent >24h ago still unpaid
    prisma.lead.findMany({
      where: {
        status: { notIn: ['closed'] },
        quotes: {
          some: {
            status: 'sent',
            paymentStatus: { not: 'paid' },
            sentAt: { lt: h24 },
          },
        },
      },
      select: LEAD_MINI,
      orderBy: { lastInteractionAt: 'desc' },
      take: 8,
    }),

    // Stuck flows: current flow set but no interaction in 48h+
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

    // ── Consult Queue ──────────────────────────────────────────────────────────

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

    prisma.deepConsultation.findMany({
      where: { redFlags: { isEmpty: false } },
      include: {
        lead: { select: { id: true, fullName: true, telegramChatId: true, primaryConcern: true, currentFlow: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    }),

    // Consult completed but no product quote generated
    prisma.lead.count({
      where: {
        status: { notIn: ['closed'] },
        deepConsultations: { some: { status: 'completed' } },
        quotes: { none: {} },
      },
    }),

    // ── Fulfillment ────────────────────────────────────────────────────────────

    prisma.fulfillmentOrder.groupBy({
      by: ['status'],
      _count: { id: true },
    }),

    // ── System Alerts ──────────────────────────────────────────────────────────

    // Failed Telegram sends in last 24h
    prisma.messageLog.count({
      where: { channel: 'telegram', status: 'failed', createdAt: { gte: h24 } },
    }),

    // Quotes stuck in pending_review for >24h
    prisma.productQuote.findMany({
      where: { status: 'pending_review', createdAt: { lt: h24 } },
      include: {
        lead: { select: { id: true, fullName: true, telegramChatId: true, primaryConcern: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    }),

    // Telegram connected >24h ago but no diagnosis sent
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

    // Diagnosis sent but product recommendation never generated
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

    // Follow-ups due (Phase 30)
    countFollowUpsDue(),

    // Lead acquisition stats (Phase 32)
    getAcquisitionStats(),
  ])

  // Build fulfillment status map
  const fulfillMap = {}
  for (const row of fulfillmentGroups) {
    fulfillMap[row.status] = row._count.id
  }

  return {
    generatedAt: now.toISOString(),

    revenue: {
      productRevenue:              productRevAgg._sum.amount ?? 0,
      academyRevenue:              academyRevAgg._sum.academyAmount ?? 0,
      consultRevenue:              0,
      unpaidQuoteTotal:            unpaidQuoteAgg._sum.totalAmount ?? 0,
      paidPendingFulfillmentTotal: paidFulfillAgg._sum.totalAmount ?? 0,
    },

    leadQueue: {
      hotProductLeads:   { count: hotLeads.length, leads: hotLeads },
      deepConsultActive: activeConsults.length,
      humanReviewNeeded: completedReviewConsults.length,
      abandonedPayment:  { count: abandonedPaymentLeads.length, leads: abandonedPaymentLeads },
      academyLocked:     { count: academyLockedLeads.length, leads: academyLockedLeads },
      stuckFlows:        { count: stuckFlowLeads.length, leads: stuckFlowLeads },
    },

    fulfillment: {
      awaitingAddress:    fulfillMap['awaiting_address']    ?? 0,
      pendingFulfillment: fulfillMap['pending_fulfillment'] ?? 0,
      packed:             fulfillMap['packed']              ?? 0,
      delivered:          fulfillMap['delivered']           ?? 0,
      cancelled:          fulfillMap['cancelled']           ?? 0,
    },

    consults: {
      activeDeepConsults:      { count: activeConsults.length,          items: activeConsults },
      completedNeedingReview:  { count: completedReviewConsults.length, items: completedReviewConsults },
      redFlagLeads:            { count: redFlagConsults.length,         items: redFlagConsults },
      completedNoProductAction: completedNoProductCount,
    },

    alerts: {
      failedTelegramSends:     failedTelegramCount,
      quotePendingTooLong:     { count: quotePendingTooLong.length,    quotes: quotePendingTooLong },
      diagnosisPendingTooLong: { count: diagnosisPendingLeads.length,  leads: diagnosisPendingLeads },
      noProductMatches:        { count: noProductMatchLeads.length,    leads: noProductMatchLeads },
      stuckCurrentFlow:        { count: stuckFlowLeads.length,         leads: stuckFlowLeads },
    },

    followUps: followUpsDue,

    leadSources: acquisitionStats,
  }
}

module.exports = { getCommandCenter }
