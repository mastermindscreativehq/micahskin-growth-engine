'use strict'

/**
 * funnelEventService.js
 *
 * Append-only analytics log for the paid assessment + product bundle features.
 * Unlike conversionService.js (which mutates a handful of scalar fields on
 * Lead and therefore only ever remembers the *last* event), every call here
 * writes its own row — leadId is nullable because assessment_started /
 * bundle_viewed fire before a Lead exists.
 *
 * Does not replace conversionService.js — that keeps doing its narrower job
 * (Lead.leadStage transitions for the 4 pre-existing event types).
 */

const prisma = require('../lib/prisma')

const ALLOWED_EVENT_TYPES = new Set([
  // Assessment funnel
  'assessment_started',
  'intake_completed',
  'assessment_payment_started',
  'assessment_payment_success',
  'assessment_payment_failed',
  'assessment_unlocked',
  'assessment_viewed',
  'recommendation_viewed',
  // Bundle funnel
  'bundle_viewed',
  'bundle_product_clicked',
  'bundle_customization_started',
  'bundle_contact_clicked',
  'bundle_checkout_started',
  'bundle_purchase_completed',
  'bundle_assessment_clicked',
])

async function logFunnelEvent({ eventType, leadId, sessionId, bundleId, value, metadata } = {}) {
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    console.warn(`[FunnelEvent] rejected unknown eventType=${eventType}`)
    return null
  }
  return prisma.funnelEvent.create({
    data: {
      eventType,
      leadId: leadId || null,
      sessionId: sessionId || null,
      bundleId: bundleId || null,
      value: value != null ? Number(value) : null,
      metadata: metadata || undefined,
    },
  }).catch((e) => {
    console.error('[FunnelEvent] write failed:', e.message)
    return null
  })
}

module.exports = { logFunnelEvent, ALLOWED_EVENT_TYPES }
