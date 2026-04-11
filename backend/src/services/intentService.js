/**
 * Rule-based intent detection for incoming lead replies.
 *
 * Intents and their downstream effects:
 *   PRICE  → lead status: interested   (asking about cost/pricing)
 *   HOT    → lead status: engaged      (ready to buy)
 *   DELAY  → lead status: contacted, follow-up rescheduled (not now)
 *   DEAD   → lead status: closed       (opt-out / no)
 *   UNKNOWN → no status change
 */

const INTENT_RULES = [
  {
    intent: 'DEAD',
    // Check DEAD before DELAY so "no" isn't masked by a softer rule
    keywords: ['no', 'stop', 'unsubscribe', 'leave me alone', 'not interested', 'do not contact', "don't contact"],
  },
  {
    intent: 'DELAY',
    keywords: ['later', 'not now', 'maybe later', 'not yet', 'some other time', 'another time', 'remind me', 'busy right now'],
  },
  {
    intent: 'HOT',
    keywords: ['interested', 'buy', "i'm in", 'sign me up', 'let\'s do it', 'yes please', 'how do i order', 'i want'],
  },
  {
    intent: 'PRICE',
    keywords: ['price', 'cost', 'how much', 'pricing', 'rate', 'fee', 'charges', 'affordable', 'expensive'],
  },
]

/**
 * Detects the intent of an incoming message.
 * @param {string} message - Raw message text from the lead
 * @returns {'PRICE'|'HOT'|'DELAY'|'DEAD'|'UNKNOWN'}
 */
function detectIntent(message) {
  if (!message || typeof message !== 'string') return 'UNKNOWN'
  const lower = message.toLowerCase()

  for (const rule of INTENT_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule.intent
    }
  }
  return 'UNKNOWN'
}

/**
 * Maps a detected intent to the lead status update and follow-up action.
 * @param {string} intent
 * @returns {{ newStatus: string|null, rescheduleFollowUp: boolean }}
 */
function intentToLeadAction(intent) {
  switch (intent) {
    case 'PRICE':
      return { newStatus: 'interested', rescheduleFollowUp: false }
    case 'HOT':
      return { newStatus: 'engaged', rescheduleFollowUp: false }
    case 'DELAY':
      return { newStatus: 'contacted', rescheduleFollowUp: true }
    case 'DEAD':
      return { newStatus: 'closed', rescheduleFollowUp: false }
    default:
      return { newStatus: null, rescheduleFollowUp: false }
  }
}

/**
 * Generates the response message to send back to the lead based on detected intent.
 * @param {string} intent
 * @param {object} lead - Lead record from DB
 * @returns {string}
 */
function generateIntentResponse(intent, lead) {
  const firstName = (lead.fullName || '').split(' ')[0] || 'there'
  const concern = (lead.skinConcern || 'skin concern').replace(/_/g, ' ')

  switch (intent) {
    case 'PRICE':
      return (
        `Hi ${firstName}! Great question about pricing. Our ${concern} solutions start from very affordable packages — ` +
        `let me send you our current price list and we can find the best fit for your budget. ` +
        `Can I get your preferred contact to send it over? 💰`
      )
    case 'HOT':
      return (
        `Hi ${firstName}! Amazing — so glad you're ready to get started! 🎉 ` +
        `Let's get your ${concern} sorted right away. ` +
        `I'll send you the next steps to place your order. Stand by!`
      )
    case 'DELAY':
      return (
        `No worries at all, ${firstName}! I totally understand. ` +
        `I'll check back with you in a bit. In the meantime, feel free to reach out whenever you're ready ` +
        `to tackle your ${concern}. We're here for you! 🌿`
      )
    case 'DEAD':
      return (
        `Understood, ${firstName}. I'll stop reaching out — no hard feelings! ` +
        `If you ever change your mind about your ${concern}, ` +
        `we'll always be here. Take care! 🙏`
      )
    default:
      return (
        `Hi ${firstName}! Thanks for your message. ` +
        `One of our team will follow up with you shortly about your ${concern}. ` +
        `Stay tuned! 😊`
      )
  }
}

module.exports = { detectIntent, intentToLeadAction, generateIntentResponse }
