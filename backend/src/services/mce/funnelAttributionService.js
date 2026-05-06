'use strict'

/**
 * funnelAttributionService.js — Phase 34 (MCE)
 *
 * Aggregates revenue, lead counts, and conversion rates broken down by
 * funnelType (product / consult / academy / reseller) and by city.
 * Used by the admin dashboard's "Funnel Conversion Stats" panel.
 *
 * Read-only; never throws — returns defaults on error.
 */

const prisma = require('../../lib/prisma')

async function _safe(label, fn, fallback) {
  try {
    return await fn()
  } catch (err) {
    console.error(`[MCE/Attribution] ${label} failed:`, err.message)
    return fallback
  }
}

/**
 * Per-funnel summary:
 *   { funnelType, leadCount, conversions, conversionRatePct, revenueNgn }
 */
async function getFunnelStats() {
  const FUNNELS = ['product', 'consult', 'academy', 'reseller']

  // Lead counts by funnelType
  const leadGroups = await _safe('leadGroups',
    () => prisma.lead.groupBy({
      by:   ['funnelType'],
      where: { funnelType: { not: null } },
      _count: { _all: true },
    }),
    []
  )
  const leadCounts = {}
  for (const g of leadGroups) leadCounts[g.funnelType] = g._count._all

  // Conversions per funnel — sourced from LeadTimeline event_type=conversion
  const convGroups = await _safe('convGroups',
    () => prisma.leadTimeline.groupBy({
      by:    ['funnelType'],
      where: { eventType: 'conversion', funnelType: { not: null } },
      _count: { _all: true },
    }),
    []
  )
  const convCounts = {}
  for (const g of convGroups) convCounts[g.funnelType] = g._count._all

  // Revenue per funnel
  // - product: paymentTransactions of leads where funnelType=product
  // - academy: academyRegistration paid totals (existing source of truth)
  // - consult: external WhatsApp bookings — we don't track revenue here
  // - reseller: paymentTransactions of leads where funnelType=reseller (rare for now)
  const productRevenue = await _safe('productRevenue',
    async () => {
      const agg = await prisma.paymentTransaction.aggregate({
        where: {
          status: 'success',
          lead:   { funnelType: 'product' },
        },
        _sum: { amount: true },
      })
      return agg._sum.amount || 0
    },
    0
  )

  const resellerRevenue = await _safe('resellerRevenue',
    async () => {
      const agg = await prisma.paymentTransaction.aggregate({
        where: {
          status: 'success',
          lead:   { funnelType: 'reseller' },
        },
        _sum: { amount: true },
      })
      return agg._sum.amount || 0
    },
    0
  )

  const academyRevenue = await _safe('academyRevenue',
    async () => {
      const agg = await prisma.academyRegistration.aggregate({
        where: { paymentStatus: 'paid' },
        _sum:  { academyAmount: true },
      })
      return agg._sum.academyAmount || 0
    },
    0
  )

  const revenueByFunnel = {
    product:  productRevenue,
    consult:  0, // external WhatsApp bookings, not tracked here
    academy:  academyRevenue,
    reseller: resellerRevenue,
  }

  const summary = FUNNELS.map(f => {
    const leadCount   = leadCounts[f] || 0
    const conversions = convCounts[f] || 0
    const rate        = leadCount > 0 ? Math.round((conversions / leadCount) * 1000) / 10 : 0
    return {
      funnelType:        f,
      leadCount,
      conversions,
      conversionRatePct: rate,
      revenueNgn:        revenueByFunnel[f] || 0,
    }
  })

  for (const row of summary) {
    console.log(
      `[MCE/Attribution] funnel=${row.funnelType}` +
      ` leads=${row.leadCount}` +
      ` conversions=${row.conversions}` +
      ` rate=${row.conversionRatePct}%` +
      ` revenue_ngn=${row.revenueNgn}`,
    )
  }

  const totalRevenue = summary.reduce((s, r) => s + (r.revenueNgn || 0), 0)
  return { summary, totalRevenue }
}

/**
 * Top objection types over the last 30 days, with funnelType breakdown.
 */
async function getTopObjections({ days = 30, limit = 10 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return _safe('topObjections',
    async () => {
      const events = await prisma.leadTimeline.findMany({
        where:  { eventType: 'objection', createdAt: { gte: since } },
        select: { payload: true, funnelType: true },
        take:   2000,  // hard cap so we don't run away
      })
      const counts   = {}
      const byFunnel = {}
      for (const e of events) {
        const t = e.payload?.type || 'unknown'
        counts[t] = (counts[t] || 0) + 1
        byFunnel[t] = byFunnel[t] || { product: 0, consult: 0, academy: 0, reseller: 0, unknown: 0 }
        const f = e.funnelType || 'unknown'
        byFunnel[t][f] = (byFunnel[t][f] || 0) + 1
      }
      const summary = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([type, count]) => ({ type, count, byFunnel: byFunnel[type] }))
      return { days, summary, totalObjections: events.length }
    },
    { days, summary: [], totalObjections: 0 }
  )
}

/**
 * City × funnel breakdown — drives the localiser feedback loop.
 */
async function getCityFunnelBreakdown({ limit = 10 } = {}) {
  return _safe('cityFunnelBreakdown',
    async () => {
      const groups = await prisma.lead.groupBy({
        by:    ['deliveryCity', 'funnelType'],
        where: { deliveryCity: { not: null }, funnelType: { not: null } },
        _count: { _all: true },
      })
      const cities = {}
      for (const g of groups) {
        const city = g.deliveryCity
        cities[city] = cities[city] || { city, total: 0, byFunnel: {} }
        cities[city].byFunnel[g.funnelType] = g._count._all
        cities[city].total += g._count._all
      }
      return Object.values(cities)
        .sort((a, b) => b.total - a.total)
        .slice(0, limit)
    },
    []
  )
}

module.exports = {
  getFunnelStats,
  getTopObjections,
  getCityFunnelBreakdown,
}
