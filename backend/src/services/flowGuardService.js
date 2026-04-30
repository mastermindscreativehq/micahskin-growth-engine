'use strict'

/**
 * flowGuardService.js — Phase 29: Flow Guard + Event Logging
 *
 * Thin helpers for:
 *   1. Writing FlowEventLog entries (audit trail for bot decisions)
 *   2. Updating a lead's currentFlow with optional legacy-field sync
 *
 * Used by telegramController, deepConsultService, actionEngineService,
 * productQuoteService, and the admin /flow endpoint.
 */

const prisma = require('../lib/prisma')

/**
 * Write a flow event to the audit log. Best-effort — never throws.
 */
async function logFlowEvent(leadId, eventType, fromFlow, toFlow, reason, metadata) {
  return prisma.flowEventLog.create({
    data: {
      leadId,
      eventType,
      fromFlow:  fromFlow  || null,
      toFlow:    toFlow    || null,
      reason:    reason    || null,
      metadata:  metadata  || undefined,
    },
  }).catch(err => console.error('[FlowGuard] logFlowEvent failed:', err.message))
}

/**
 * Update currentFlow on a Lead and write an audit log entry.
 * Also syncs legacy fields (leadStage, status, followupSuppressed) where needed.
 *
 * @param {string}  leadId
 * @param {string}  newFlow  — one of the allowed flow values
 * @param {string}  [reason] — optional reason for the change
 * @param {object}  [extra]  — additional Prisma data fields to merge in
 */
async function setLeadFlow(leadId, newFlow, reason, extra) {
  const current = await prisma.lead.findUnique({
    where:  { id: leadId },
    select: { currentFlow: true },
  })
  const fromFlow = current?.currentFlow || null

  const data = {
    currentFlow:         newFlow,
    lastFlowGuardReason: reason || null,
    ...(extra || {}),
  }

  // Sync legacy fields for backward compat
  if (newFlow === 'academy_locked') {
    data.leadStage          = 'academy_locked'
    data.followupSuppressed = true
  }
  if (newFlow === 'closed') {
    data.status             = 'closed'
    data.followupSuppressed = true
  }

  await prisma.lead.update({ where: { id: leadId }, data })
  await logFlowEvent(leadId, 'flow_changed', fromFlow, newFlow, reason)
}

module.exports = { logFlowEvent, setLeadFlow }
