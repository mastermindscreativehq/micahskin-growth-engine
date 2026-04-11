const prisma = require('../lib/prisma')
const { sendMessage } = require('./messageSenderService')
const { generateFollowUpMessage } = require('./leadsService')

// Statuses that stop all automated sends
const STOP_STATUSES = ['engaged', 'interested', 'closed']

// Max messages per minute — configurable via env, default 5
const MAX_PER_MINUTE = parseInt(process.env.AUTO_REPLY_MAX_PER_MINUTE || '5', 10)

/**
 * Rolling-window rate limiter.
 * Shared across all processAuto* functions within the same runAutoTrigger() cycle.
 * Resets when the current 60-second window expires.
 */
const rateLimiter = {
  count: 0,
  windowStart: Date.now(),
}

function canSend() {
  const now = Date.now()
  if (now - rateLimiter.windowStart >= 60_000) {
    rateLimiter.count = 0
    rateLimiter.windowStart = now
  }
  if (rateLimiter.count >= MAX_PER_MINUTE) return false
  rateLimiter.count++
  return true
}

/**
 * Auto-trigger initial replies for qualifying DM leads.
 *
 * Fires when ALL of:
 *   - autoReplyEnabled = true
 *   - initialReplySentAt = null   (initial reply not yet sent)
 *   - replyLock = false           (not already being processed)
 *   - sourceType = 'dm'
 *   - intentTag contains 'price' OR 'urgent'
 *   - status not in (engaged, interested, closed)
 *
 * Idempotency: initialReplySentAt is set after a successful send.
 * The atomic claim on replyLock prevents concurrent double-sends.
 * If the send fails, the lock is released so the next cycle retries.
 */
async function processAutoReplies() {
  const now = new Date()

  try {
    const leads = await prisma.lead.findMany({
      where: {
        autoReplyEnabled: true,
        initialReplySentAt: null,
        replyLock: false,
        sourceType: 'dm',
        status: { notIn: STOP_STATUSES },
        OR: [
          { intentTag: { contains: 'price', mode: 'insensitive' } },
          { intentTag: { contains: 'urgent', mode: 'insensitive' } },
        ],
      },
    })

    for (const lead of leads) {
      if (!canSend()) {
        console.log('[AutoTrigger] Rate limit reached — deferring remaining initial replies to next cycle')
        break
      }

      // Atomic claim: only one process can hold replyLock=true for this lead at a time
      const claimed = await prisma.lead.updateMany({
        where: { id: lead.id, initialReplySentAt: null, replyLock: false },
        data: { replyLock: true },
      })
      if (claimed.count === 0) continue // Another process already claimed it

      const message = lead.suggestedReply ||
        `Hi! We saw your message and would love to help with your ${(lead.skinConcern || '').replace(/_/g, ' ')}.`

      try {
        const result = await sendMessage({
          lead,
          message,
          messageType: 'initial',
          auto: true,
          triggerReason: 'initial_auto',
        })

        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            initialReplySentAt: now,
            initialMessageSent: true,
            lastMessageSentAt: now,
            lastMessageChannel: result.channel,
            lastDeliveryChannel: result.channel,
            lastDeliveredAt: now,
            lastDeliveryStatus: result.status,
            replyLock: false,
            ...(lead.status === 'new' ? { status: 'contacted' } : {}),
          },
        })

        console.log(
          `[AutoTrigger] initial_auto → ${lead.fullName} (${lead.id}) intent="${lead.intentTag}"`
        )
      } catch (sendErr) {
        // Release lock so the next cycle can retry
        await prisma.lead.update({ where: { id: lead.id }, data: { replyLock: false } }).catch(() => {})
        console.error(`[AutoTrigger] initial_auto FAILED for ${lead.id}:`, sendErr.message)
      }
    }
  } catch (err) {
    console.error('[AutoTrigger] processAutoReplies error:', err.message)
  }
}

/**
 * Auto-trigger follow-up 1 for qualifying leads.
 *
 * Fires when ALL of:
 *   - autoReplyEnabled = true
 *   - followUp1 <= now            (due or overdue)
 *   - followUp1SentAt = null      (follow-up not yet sent)
 *   - replyLock = false           (not being processed)
 *   - status not in (engaged, interested, closed)
 *
 * Also sets followUp1Sent=true in the atomic claim so the scheduler
 * does not send a duplicate admin alert for the same follow-up.
 */
async function processAutoFollowUp1() {
  const now = new Date()

  try {
    const leads = await prisma.lead.findMany({
      where: {
        autoReplyEnabled: true,
        followUp1: { lte: now },
        followUp1SentAt: null,
        replyLock: false,
        status: { notIn: STOP_STATUSES },
      },
    })

    for (const lead of leads) {
      if (!canSend()) {
        console.log('[AutoTrigger] Rate limit reached — deferring remaining follow-up 1s to next cycle')
        break
      }

      // Atomic claim: also set followUp1Sent=true to prevent the scheduler
      // from firing a duplicate admin alert for this follow-up.
      const claimed = await prisma.lead.updateMany({
        where: { id: lead.id, followUp1SentAt: null, replyLock: false },
        data: { replyLock: true, followUp1Sent: true },
      })
      if (claimed.count === 0) continue

      const message = generateFollowUpMessage(lead, 1)

      try {
        const result = await sendMessage({
          lead,
          message,
          messageType: 'follow_up_1',
          auto: true,
          triggerReason: 'fu1_auto',
        })

        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            followUp1SentAt: now,
            followUp1Sent: true,
            lastMessageSentAt: now,
            lastMessageChannel: result.channel,
            lastDeliveryChannel: result.channel,
            lastDeliveredAt: now,
            lastDeliveryStatus: result.status,
            replyLock: false,
          },
        })

        console.log(
          `[AutoTrigger] fu1_auto → ${lead.fullName} (${lead.id})`
        )
      } catch (sendErr) {
        // Release lock so the next cycle can retry; clear the alert flag too
        await prisma.lead.update({
          where: { id: lead.id },
          data: { replyLock: false, followUp1Sent: false },
        }).catch(() => {})
        console.error(`[AutoTrigger] fu1_auto FAILED for ${lead.id}:`, sendErr.message)
      }
    }
  } catch (err) {
    console.error('[AutoTrigger] processAutoFollowUp1 error:', err.message)
  }
}

/**
 * Runs one full auto-trigger cycle: initial replies then follow-up 1.
 * The rate-limiter budget is shared across both passes.
 */
async function runAutoTrigger() {
  await processAutoReplies()
  await processAutoFollowUp1()
}

/**
 * Starts the auto-trigger service.
 * Runs immediately on boot (to catch leads created while server was down),
 * then every 60 seconds.
 */
function startAutoTrigger() {
  console.log(
    `✅ Auto-trigger service started (checks every 60s, max ${MAX_PER_MINUTE} msgs/min)`
  )
  runAutoTrigger()
  setInterval(runAutoTrigger, 60_000)
}

module.exports = { startAutoTrigger, processAutoReplies, processAutoFollowUp1 }
