'use strict'

/**
 * whatsappBridgeService.js — Phase 34 (MCE)
 *
 * Generates personalised WhatsApp deep links (wa.me) per lead segment +
 * tracks first-touch clicks. The OUTBOUND DELIVERY layer (whatsappService.js)
 * is separate — that one handles post-handshake automated messages. This
 * service handles the FIRST CTA: getting a lead from passive social /
 * dashboard touch into a direct WhatsApp conversation.
 *
 * Output URL format:
 *   https://wa.me/<phone>?text=<urlencoded-personalised-opener>&utm_source=mce&utm_medium=cta&utm_campaign=<funnelType>&leadId=<leadId>
 *
 *   ※ wa.me strips the leadId from its URL when opening WhatsApp, but the
 *      leadId is preserved on OUR redirect URL so /api/mce/whatsapp/redirect/:leadId
 *      can attribute the click before issuing the 302.
 */

const prisma = require('../../lib/prisma')
const localizer = require('./nigerianCopyLocalizer')
const leadTimeline = require('./leadTimelineService')

const WHATSAPP_PHONE = (process.env.WHATSAPP_PHONE_NUMBER || '+2348140468759').replace(/[^\d+]/g, '')

// ── Opener templates per funnel ──────────────────────────────────────────────

const OPENER_BY_FUNNEL = {
  product: lead => (
    `Hi Micahskin team — I’m ${lead.fullName || 'a new lead'} from ${lead.deliveryCity || lead.telegramArea || 'Nigeria'}.\n` +
    `Concern: ${(lead.primaryConcern || lead.skinConcern || 'skin issue').replace(/_/g, ' ')}.\n` +
    `I’d like to start a routine. What are my next steps?`
  ),
  consult: lead => (
    `Hi Micahskin team — I’m ${lead.fullName || 'a new lead'}.\n` +
    `I’d like to book a direct consultation about my ${(lead.primaryConcern || lead.skinConcern || 'skin').replace(/_/g, ' ')}.\n` +
    `Please walk me through what’s involved.`
  ),
  academy: lead => (
    `Hi Micahskin team — I’m ${lead.fullName || 'a new lead'}.\n` +
    `I’m interested in joining the Academy. Could you share the next intake details?`
  ),
  reseller: lead => (
    `Hi Micahskin team — I’m ${lead.fullName || 'a new lead'}.\n` +
    `I’d like to explore the reseller / partner opportunity. Please share more details.`
  ),
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _buildOpener(lead) {
  const builder = OPENER_BY_FUNNEL[lead.funnelType] || OPENER_BY_FUNNEL.product
  return builder(lead)
}

function _buildUrl({ phone, opener, lead }) {
  const params = new URLSearchParams({
    text:         opener,
    utm_source:   'mce',
    utm_medium:   'cta',
    utm_campaign: lead.funnelType || 'product',
  }).toString()
  // wa.me requires the phone with NO + prefix
  const cleanedPhone = phone.replace(/^\+/, '')
  return `https://wa.me/${cleanedPhone}?${params}`
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a personalised wa.me deep link for a lead and persist it to
 * Lead.whatsappCtaUrl. Idempotent — refreshes the URL each time so opener
 * stays current with the latest funnelType / city / concern values.
 *
 * @param {object} lead Full Lead record from Prisma
 * @returns {Promise<{ url: string, opener: string, localizer: object }>}
 */
async function generateAndStoreCta(lead) {
  if (!lead || !lead.id) return null

  const opener = _buildOpener(lead)
  const url    = _buildUrl({ phone: WHATSAPP_PHONE, opener, lead })

  const localizerOverlay = localizer.localize({
    lead,
    city:         lead.deliveryCity || lead.telegramArea || null,
    urgency:      lead.urgencyLevel || 'low',
    budgetSignal: lead.budgetSignal || 'none',
  })

  try {
    await prisma.lead.update({
      where: { id: lead.id },
      data:  { whatsappCtaUrl: url },
    })
  } catch (err) {
    console.error(`[MCE/WhatsAppBridge] persist CTA failed leadId=${lead.id}:`, err.message)
  }

  console.log(
    `[MCE/WhatsAppBridge] generated CTA leadId=${lead.id}` +
    ` city=${lead.deliveryCity || lead.telegramArea || '—'}` +
    ` funnel=${lead.funnelType || 'product'}` +
    ` angle=${lead.followupAngle || '—'}`,
  )

  return { url, opener, localizer: localizerOverlay }
}

/**
 * Record a click on a lead's WhatsApp CTA. Increments the click counter,
 * sets first-click timestamp on first hit only, appends a timeline event,
 * and returns the redirect URL.
 *
 * Best-effort: if no CTA exists yet, generate one on-the-fly.
 *
 * @param {string} leadId
 * @returns {Promise<string|null>}  Destination wa.me URL (or null if lead not found)
 */
async function trackClick(leadId) {
  if (!leadId) return null

  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) {
    console.warn(`[MCE/WhatsAppBridge] click for unknown leadId=${leadId}`)
    return null
  }

  let ctaUrl = lead.whatsappCtaUrl
  if (!ctaUrl) {
    const generated = await generateAndStoreCta(lead)
    ctaUrl = generated?.url || null
  }
  if (!ctaUrl) return null

  const isFirstClick = !lead.whatsappFirstClickAt
  const now = new Date()

  try {
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        whatsappClickCount:   { increment: 1 },
        whatsappFirstClickAt: isFirstClick ? now : lead.whatsappFirstClickAt,
        lastInteractionAt:    now,
      },
    })
  } catch (err) {
    console.error(`[MCE/WhatsAppBridge] increment click failed leadId=${leadId}:`, err.message)
  }

  console.log(
    `[MCE/WhatsAppBridge] click leadId=${leadId}` +
    ` total=${(lead.whatsappClickCount || 0) + 1}` +
    ` firstClick=${(lead.whatsappFirstClickAt || now).toISOString()}` +
    ` funnel=${lead.funnelType || '—'}`,
  )

  await leadTimeline.record({
    leadId,
    eventType:  'whatsapp_click',
    channel:    'whatsapp',
    funnelType: lead.funnelType || null,
    payload: {
      isFirstClick,
      clickCount: (lead.whatsappClickCount || 0) + 1,
    },
  })

  return ctaUrl
}

/**
 * Aggregate WhatsApp click stats for the admin dashboard.
 *   - totalClicks
 *   - uniqueLeadsClicked
 *   - clicksLast24h
 *   - byFunnel: { product: n, consult: n, academy: n, reseller: n }
 *   - clickRatePct (clicks / leads with whatsappCtaUrl set)
 */
async function getClickStats() {
  const now = new Date()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  try {
    const [agg, uniqueClicked, last24h, byFunnelGroups, totalLeadsWithCta] = await Promise.all([
      prisma.lead.aggregate({
        _sum: { whatsappClickCount: true },
      }),
      prisma.lead.count({ where: { whatsappFirstClickAt: { not: null } } }),
      prisma.leadTimeline.count({
        where: { eventType: 'whatsapp_click', createdAt: { gte: since24h } },
      }),
      prisma.leadTimeline.groupBy({
        by: ['funnelType'],
        where:  { eventType: 'whatsapp_click' },
        _count: { _all: true },
      }),
      prisma.lead.count({ where: { whatsappCtaUrl: { not: null } } }),
    ])

    const byFunnel = { product: 0, consult: 0, academy: 0, reseller: 0 }
    for (const g of byFunnelGroups) {
      const k = g.funnelType || 'unknown'
      byFunnel[k] = (byFunnel[k] || 0) + g._count._all
    }

    const totalClicks = agg._sum.whatsappClickCount || 0
    const clickRatePct = totalLeadsWithCta > 0
      ? Math.round((uniqueClicked / totalLeadsWithCta) * 1000) / 10
      : 0

    return {
      totalClicks,
      uniqueLeadsClicked: uniqueClicked,
      clicksLast24h:      last24h,
      ctaGenerated:       totalLeadsWithCta,
      clickRatePct,
      byFunnel,
    }
  } catch (err) {
    console.error('[MCE/WhatsAppBridge] getClickStats failed:', err.message)
    return {
      totalClicks: 0,
      uniqueLeadsClicked: 0,
      clicksLast24h: 0,
      ctaGenerated: 0,
      clickRatePct: 0,
      byFunnel: { product: 0, consult: 0, academy: 0, reseller: 0 },
      error: err.message,
    }
  }
}

module.exports = {
  generateAndStoreCta,
  trackClick,
  getClickStats,
  WHATSAPP_PHONE,
}
