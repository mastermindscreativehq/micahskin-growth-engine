/**
 * WhatsApp Cloud API service — plain text customer delivery.
 *
 * Uses Meta's WhatsApp Business Cloud API (graph.facebook.com/v19.0).
 * Phone numbers must be in E.164 format (normalised by phoneUtils before reaching here).
 *
 * Required env vars:
 *   WHATSAPP_ACCESS_TOKEN       — permanent system-user token from Meta Business Manager
 *   WHATSAPP_PHONE_NUMBER_ID    — Meta's internal numeric ID for your WhatsApp Business phone
 *                                 number. Found in Meta for Developers → Your App → WhatsApp
 *                                 → API Setup → "Phone number ID" field.
 *                                 THIS IS NOT THE PHONE NUMBER ITSELF.
 *                                 Example of a correct value:  1035265769668836  (15-16 digits)
 *                                 Example of a wrong value:    08137656921       (local phone no.)
 *
 * Meta expects the destination number WITHOUT a leading '+'.
 * E.g. E.164 '+2348012345678' → sent as '2348012345678'.
 */

const WHATSAPP_ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const WHATSAPP_DEFAULT_CC      = (process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '').replace(/\D/g, '')
const WHATSAPP_PROVIDER        = process.env.WHATSAPP_PROVIDER || 'meta_cloud'

const GRAPH_API_VERSION = 'v19.0'

// ── Phone masking helper ─────────────────────────────────────────────────────

/**
 * Masks all but the last 4 characters of a phone string for safe logging.
 * Works on E.164 ('+2348012345678') or raw digits ('2348012345678').
 *
 * maskPhone('+2348012345678') → '**********5678'
 * maskPhone('2348012345678')  → '*********5678'
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string' || phone.length <= 4) return '****'
  return phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4)
}

// ── Startup config validation ────────────────────────────────────────────────

/**
 * Returns a structured description of the current WhatsApp configuration.
 * Safe to log or expose — never includes token values.
 *
 * phoneNumberId check rules:
 *   ✓ purely numeric
 *   ✓ 14+ digits  (Meta Phone Number IDs are 15-16 digits)
 *   ✓ does not start with '0'  (a leading 0 means it's a local phone number, not a Meta ID)
 *
 * @returns {{ enabled: boolean, phoneNumberIdPresent: boolean, phoneNumberIdLooksValid: boolean,
 *             phoneNumberIdHint: string, tokenPresent: boolean, defaultCountryCode: string }}
 */
function getWhatsAppHealth() {
  const id = WHATSAPP_PHONE_NUMBER_ID || ''
  const tokenPresent = Boolean(WHATSAPP_ACCESS_TOKEN)
  const phoneNumberIdPresent = id.length > 0

  const isNumeric       = /^\d+$/.test(id)
  const isLongEnough    = id.length >= 14          // Meta IDs are 15-16 digits
  const noLeadingZero   = !id.startsWith('0')      // local phone numbers start with 0

  const phoneNumberIdLooksValid = phoneNumberIdPresent && isNumeric && isLongEnough && noLeadingZero

  let phoneNumberIdHint
  if (!phoneNumberIdPresent) {
    phoneNumberIdHint = 'MISSING'
  } else if (!isNumeric) {
    phoneNumberIdHint = `INVALID — contains non-digit characters (got "${id}")`
  } else if (id.startsWith('0')) {
    phoneNumberIdHint = `LIKELY WRONG — starts with 0, looks like a local phone number (got ${id.length} digits)`
  } else if (!isLongEnough) {
    phoneNumberIdHint = `LIKELY WRONG — only ${id.length} digits; Meta IDs are 15-16 digits (got "${id}")`
  } else {
    phoneNumberIdHint = `ok — ${id.length} digits, numeric, no leading zero`
  }

  return {
    enabled: WHATSAPP_PROVIDER === 'meta_cloud',
    provider: WHATSAPP_PROVIDER,
    phoneNumberIdPresent,
    phoneNumberIdLooksValid,
    phoneNumberIdHint,
    tokenPresent,
    defaultCountryCode: WHATSAPP_DEFAULT_CC || '(not set)',
  }
}

/**
 * Prints a startup config audit to stdout.
 * Called once when this module is first loaded.
 * Never prints the token value.
 */
function logStartupAudit() {
  const h = getWhatsAppHealth()
  const ok = '✓'
  const warn = '⚠'

  console.log('[WhatsApp] Config audit:')
  console.log(`  provider         : ${h.provider} ${h.enabled ? ok : warn + ' (not meta_cloud — sends will be skipped)'}`)
  console.log(`  phone_number_id  : ${h.phoneNumberIdLooksValid ? ok : warn} ${h.phoneNumberIdHint}`)
  console.log(`  access_token     : ${h.tokenPresent ? ok + ' present' : warn + ' MISSING'}`)
  console.log(`  default_cc       : ${h.defaultCountryCode}`)
}

logStartupAudit()

/**
 * Sends a plain text WhatsApp message to a single recipient.
 *
 * @param {object} params
 * @param {string} params.to             - E.164 phone number (e.g. '+2348012345678')
 * @param {string} params.body           - Message text (max ~4096 chars for plain text)
 * @returns {Promise<{ success: boolean, providerResponse?: object, error?: string }>}
 *   Never throws — always returns a result object.
 *   Callers are responsible for deciding what to do on failure.
 */
async function sendWhatsAppText({ to, body }) {
  // Validate inputs before hitting the API
  if (!to || typeof to !== 'string' || to.trim() === '') {
    return { success: false, error: 'sendWhatsAppText: no destination phone number provided' }
  }

  if (!body || typeof body !== 'string' || body.trim() === '') {
    return { success: false, error: 'sendWhatsAppText: message body is empty' }
  }

  if (!WHATSAPP_ACCESS_TOKEN) {
    return { success: false, error: 'WhatsApp not configured: WHATSAPP_ACCESS_TOKEN is missing' }
  }

  if (!WHATSAPP_PHONE_NUMBER_ID) {
    return { success: false, error: 'WhatsApp not configured: WHATSAPP_PHONE_NUMBER_ID is missing' }
  }

  // Meta Cloud API requires digits only — strip the leading '+' from E.164
  const toDigits = to.replace(/^\+/, '')
  const masked   = maskPhone(toDigits)

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`

  const payload = {
    messaging_product: 'whatsapp',
    to: toDigits,
    type: 'text',
    text: { body },
  }

  console.log(`[WhatsApp] sending → ${masked} provider=${WHATSAPP_PROVIDER}`)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!response.ok) {
      // Meta error shape: { error: { message, type, code, fbtrace_id } }
      const errMsg = data?.error?.message
        ? `Meta API error (${data.error.code}): ${data.error.message}`
        : `Meta API returned HTTP ${response.status}`
      console.error(`[WhatsApp] ✗ ${masked} HTTP ${response.status} provider=${WHATSAPP_PROVIDER} — ${errMsg}`)
      return { success: false, error: errMsg, providerResponse: data }
    }

    const messageId = data?.messages?.[0]?.id || 'unknown'
    console.log(`[WhatsApp] ✓ ${masked} HTTP ${response.status} provider=${WHATSAPP_PROVIDER} messageId=${messageId}`)
    return { success: true, providerResponse: data }
  } catch (networkErr) {
    console.error(`[WhatsApp] ✗ ${masked} provider=${WHATSAPP_PROVIDER} network error — ${networkErr.message}`)
    return { success: false, error: `Network error: ${networkErr.message}` }
  }
}

module.exports = { sendWhatsAppText, getWhatsAppHealth, maskPhone }
