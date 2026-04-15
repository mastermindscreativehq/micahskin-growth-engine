'use strict'

/**
 * conversionService.js — Phase 18: Conversion Tracking
 *
 * Tracks lead actions (clicks, registrations, payments) and updates
 * lead state + revenue on the Lead record.
 *
 * Event types:
 *   academy_click  → leadStage: interested  (lead clicked academy CTA)
 *   consult_click  → leadStage: engaged     (lead clicked consult CTA)
 *   academy_signup → leadStage: converted   (lead submitted academy form)
 *   academy_paid   → leadStage: converted   (lead completed payment)
 *
 * All writes are best-effort: a missing leadId or unknown lead logs a warning
 * but never throws — callers should not block on this.
 */

const prisma = require('../lib/prisma')

const STAGE_MAP = {
  academy_click:  'interested',
  consult_click:  'engaged',
  academy_signup: 'converted',
  academy_paid:   'converted',
}

/**
 * Record a conversion event against a Lead record.
 *
 * @param {object} opts
 * @param {string}  opts.leadId  Lead.id
 * @param {string}  opts.type    One of: academy_click | consult_click | academy_signup | academy_paid
 * @param {number}  [opts.value] Revenue value (required for academy_paid)
 */
async function trackEvent({ leadId, type, value }) {
  if (!leadId || !type) {
    console.warn('[Conversion] trackEvent called with missing leadId or type — skipping')
    return
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) {
    console.warn(`[Conversion] Lead not found: ${leadId} — skipping`)
    return
  }

  const now  = new Date()
  const data = {
    lastInteractionAt: now,
    leadStage: STAGE_MAP[type] || lead.leadStage,
  }

  if (type === 'academy_paid' && value != null) {
    data.conversionType  = 'academy_paid'
    data.conversionValue = value
    data.conversionAt    = now
  }

  await prisma.lead.update({ where: { id: leadId }, data })

  if (type === 'academy_paid') {
    console.log(`[Conversion] academy_paid → leadId: ${leadId} | value: ${value}`)
  } else {
    console.log(`[Conversion] ${type} → leadId: ${leadId}`)
  }
}

module.exports = { trackEvent }
