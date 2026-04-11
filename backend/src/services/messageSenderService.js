const { deliverToLead } = require('./deliveryService')

/**
 * Unified message sender — Phase 4 / Phase 7 / Phase 9 (outbound channel routing).
 *
 * Builds the email subject for the message type, then delegates to deliveryService
 * which picks the best channel: email → whatsapp (future) → telegram fallback.
 *
 * @param {object} params
 * @param {object} params.lead           - Lead record from DB
 * @param {string} params.message        - Message body text
 * @param {string} params.messageType    - 'initial' | 'follow_up_1' | 'follow_up_2' | 'follow_up_3'
 * @param {boolean} [params.auto]        - Auto-triggered send
 * @param {string}  [params.triggerReason] - 'initial_auto' | 'fu1_auto' | 'manual'
 * @returns {Promise<{ success?: boolean, skipped?: boolean, channel: string, recipient: string, fallbackUsed: boolean }>}
 */
async function sendMessage({ lead, message, messageType, auto = false, triggerReason = null }) {
  const subject = generateEmailSubject(lead, messageType)
  return deliverToLead({ lead, message, subject, messageType, auto, triggerReason })
}

/**
 * Generates a contextual email subject line for each message type.
 * Used as the email subject when the lead has an email address on file.
 */
function generateEmailSubject(lead, messageType) {
  const firstName = (lead.fullName || '').split(' ')[0] || 'there'
  const concern = (lead.skinConcern || 'skin').replace(/_/g, ' ')

  switch (messageType) {
    case 'initial':
      return `Hi ${firstName} — your MICAHSKIN skincare consultation`
    case 'follow_up_1':
      return `Following up on your ${concern} enquiry`
    case 'follow_up_2':
      return `Still here to help with your ${concern}`
    case 'follow_up_3':
      return `One last message from MICAHSKIN`
    default:
      return 'A message from MICAHSKIN'
  }
}

module.exports = { sendMessage }
