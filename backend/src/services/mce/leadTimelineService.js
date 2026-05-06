'use strict'

/**
 * leadTimelineService.js — Phase 34 (MCE)
 *
 * Append-only event log per lead. Powers the per-lead timeline panel and
 * the dashboard reports (top objections, WhatsApp click rate, funnel
 * attribution). Pure I/O wrapper around the LeadTimeline Prisma model —
 * never throws, always best-effort.
 *
 * Allowed eventType values:
 *   route_assigned     — conversation router tagged a lead
 *   whatsapp_click     — lead clicked a wa.me CTA
 *   reply_received     — inbound reply ingested
 *   objection          — objection detector matched (pricing/trust/timing/skepticism)
 *   offer_viewed       — offer link click attribution
 *   followup_sent      — MCE follow-up dispatched
 *   conversion         — lead converted (paid / booked)
 */

const prisma = require('../../lib/prisma')

const ALLOWED_EVENT_TYPES = new Set([
  'route_assigned',
  'whatsapp_click',
  'reply_received',
  'objection',
  'offer_viewed',
  'followup_sent',
  'conversion',
])

const ALLOWED_CHANNELS = new Set(['whatsapp', 'telegram', 'email', 'system'])

async function record({ leadId, eventType, channel = 'system', funnelType = null, payload = null }) {
  if (!leadId || !eventType) return null
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    console.warn(`[MCE/Timeline] rejected unknown eventType=${eventType} leadId=${leadId}`)
    return null
  }
  if (channel && !ALLOWED_CHANNELS.has(channel)) channel = 'system'

  try {
    const row = await prisma.leadTimeline.create({
      data: {
        leadId,
        eventType,
        channel,
        funnelType,
        payload: payload || undefined,
      },
    })
    console.log(
      `[MCE/Timeline] recorded leadId=${leadId} event=${eventType}` +
      ` funnel=${funnelType || '—'} channel=${channel}`,
    )
    return row
  } catch (err) {
    console.error(`[MCE/Timeline] record failed leadId=${leadId} event=${eventType}:`, err.message)
    return null
  }
}

async function listForLead(leadId, { limit = 100 } = {}) {
  if (!leadId) return []
  try {
    return await prisma.leadTimeline.findMany({
      where:   { leadId },
      orderBy: { createdAt: 'desc' },
      take:    Math.max(1, Math.min(limit, 500)),
    })
  } catch (err) {
    console.error(`[MCE/Timeline] listForLead failed leadId=${leadId}:`, err.message)
    return []
  }
}

/**
 * Counts of each eventType across the whole table within a time window.
 * Used by the admin dashboard for headline numbers.
 */
async function countsByEventType({ since = null } = {}) {
  try {
    const where = since ? { createdAt: { gte: since } } : {}
    const groups = await prisma.leadTimeline.groupBy({
      by: ['eventType'],
      where,
      _count: { _all: true },
    })
    const out = {}
    for (const g of groups) out[g.eventType] = g._count._all
    return out
  } catch (err) {
    console.error('[MCE/Timeline] countsByEventType failed:', err.message)
    return {}
  }
}

module.exports = {
  record,
  listForLead,
  countsByEventType,
  ALLOWED_EVENT_TYPES,
  ALLOWED_CHANNELS,
}
