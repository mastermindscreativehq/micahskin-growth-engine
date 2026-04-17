const prisma = require('../lib/prisma')

const VALID_EVENTS = ['academy_joined', 'lesson_started', 'lesson_completed', 'cta_clicked', 'inactive']

// Engagement score delta per event type
const ENGAGEMENT_DELTAS = {
  academy_joined:    10,
  lesson_started:     5,
  lesson_completed:  15,
  cta_clicked:       10,
  inactive:          -5,
}

// Fit score boost per event (rewards real academy behaviour retroactively)
const FIT_SCORE_BOOSTS = {
  academy_joined:    10,
  lesson_started:     0,
  lesson_completed:   5,
  cta_clicked:        3,
  inactive:           0,
}

async function findLeadByIdentifier({ telegram_id, phone }) {
  if (telegram_id) {
    const lead = await prisma.lead.findFirst({ where: { telegramChatId: String(telegram_id) } })
    if (lead) return lead
  }
  if (phone) {
    const lead = await prisma.lead.findFirst({ where: { phone: String(phone) } })
    if (lead) return lead
  }
  return null
}

/**
 * Main sync handler. Receives an event from n8n, maps it to a Lead,
 * and updates CRM fields + scoring accordingly.
 *
 * @param {object} params
 * @param {string|number} params.telegram_id   - Telegram chat_id from n8n
 * @param {string}        params.invite_code   - Academy invite code (optional)
 * @param {string}        params.event_type    - One of VALID_EVENTS
 * @param {string}        params.phone         - E.164 phone fallback (optional)
 * @param {string}        params.lesson_id     - Lesson identifier (optional, for context)
 */
async function syncAcademyEvent({ telegram_id, invite_code, event_type, phone, lesson_id }) {
  if (!event_type || !VALID_EVENTS.includes(event_type)) {
    const err = new Error(`Invalid event_type. Must be one of: ${VALID_EVENTS.join(', ')}`)
    err.status = 400
    throw err
  }

  if (!telegram_id && !phone) {
    const err = new Error('telegram_id or phone is required to identify lead')
    err.status = 400
    throw err
  }

  const lead = await findLeadByIdentifier({ telegram_id, phone })
  if (!lead) {
    const err = new Error('No lead found matching the provided telegram_id or phone')
    err.status = 404
    throw err
  }

  const now = new Date()
  const currentEngagement = lead.academyEngagementScore ?? 0
  const currentFitScore   = lead.academyFitScore ?? 0

  const newEngagementScore = Math.max(0, Math.min(100, currentEngagement + (ENGAGEMENT_DELTAS[event_type] ?? 0)))
  const newFitScore        = Math.min(100, currentFitScore + (FIT_SCORE_BOOSTS[event_type] ?? 0))

  const updateData = {
    academyEngagementScore: newEngagementScore,
    academyProgressStage:   event_type,
    lastInteractionAt:      now,
  }

  if (newFitScore > currentFitScore) {
    updateData.academyFitScore = newFitScore
  }

  if (event_type === 'academy_joined') {
    updateData.academyAccess  = true
    updateData.academyJoinedAt = lead.academyJoinedAt ?? now  // only set once
    if (invite_code) updateData.academyInviteCode = invite_code

    // Conversion fields — only write if not already recorded
    if (!lead.leadStage || lead.leadStage !== 'converted') {
      updateData.leadStage = 'converted'
    }
    if (!lead.conversionType) {
      updateData.conversionType = 'academy_paid'
    }
    if (!lead.conversionAt) {
      updateData.conversionAt = now
    }
    updateData.conversionIntent = 'academy'
  }

  if (['lesson_completed', 'cta_clicked'].includes(event_type)) {
    updateData.conversionIntent = 'academy'
  }

  // lesson_id stored in progressStage when available for richer audit trail
  if (lesson_id && ['lesson_started', 'lesson_completed'].includes(event_type)) {
    updateData.academyProgressStage = `${event_type}:${lesson_id}`
  }

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: updateData,
  })

  console.log(
    `[AcademySync] event=${event_type} | leadId=${lead.id} | ` +
    `engagementScore=${updated.academyEngagementScore} | fitScore=${updated.academyFitScore} | ` +
    `stage=${updated.academyProgressStage}`
  )

  return {
    leadId:                lead.id,
    event_type,
    academyAccess:         updated.academyAccess,
    academyEngagementScore: updated.academyEngagementScore,
    academyFitScore:       updated.academyFitScore,
    academyProgressStage:  updated.academyProgressStage,
    leadStage:             updated.leadStage,
    conversionIntent:      updated.conversionIntent,
  }
}

module.exports = { syncAcademyEvent, findLeadByIdentifier }
