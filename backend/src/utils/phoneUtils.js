/**
 * phoneUtils.js — shared phone number normalisation for international WhatsApp delivery.
 *
 * Normalises any reasonable user input to E.164 format: +[country code][subscriber number]
 *
 * Accepted input forms (examples use +234 Nigeria as the fallback country):
 *   +2348012345678   → +2348012345678  (already E.164 — preserved as-is)
 *   +447911123456    → +447911123456   (UK E.164 — preserved as-is)
 *   +12125551234     → +12125551234    (US E.164 — preserved as-is)
 *   00447911123456   → +447911123456   (00-prefix international dialling)
 *   08012345678      → +2348012345678  (Nigerian local, leading 0 stripped)
 *   8012345678       → +2348012345678  (bare digits, country code prepended)
 *   07700 900000     → +447700900000   (UK local with spaces, if countryCode=44)
 *
 * Rejects:
 *   Too short (<7 digits after +) or too long (>15 digits) per E.164 spec.
 *   Any string that remains non-numeric after stripping formatting chars.
 */

const DEFAULT_COUNTRY_CODE = (process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '').replace(/\D/g, '')

/**
 * Normalise a phone number string to E.164 format.
 *
 * @param {string|null|undefined} raw  - User-supplied phone number.
 * @param {string} [countryCode]       - Digits-only country code (e.g. '234', '44', '1').
 *                                       Falls back to WHATSAPP_DEFAULT_COUNTRY_CODE env var.
 *                                       Only used when the number has no international prefix.
 * @returns {string|null}              - E.164 string or null if input is empty.
 * @throws {Error}                     - status 400 for invalid numbers; 500 for missing country code config.
 */
function normalizePhoneNumber(raw, countryCode) {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') return null

  // Strip common formatting chars: spaces, dashes, dots, parentheses
  const stripped = raw.trim().replace(/[\s\-.()]/g, '')

  if (stripped === '') return null

  // Reject anything that contains unexpected characters
  if (!/^[+\d]+$/.test(stripped)) {
    const err = new Error(
      `Invalid phone number "${raw}". Use digits and optional leading + or country code, e.g. +2348012345678`
    )
    err.status = 400
    throw err
  }

  let e164

  if (stripped.startsWith('+')) {
    // Already in full international format — accept as-is
    e164 = stripped
  } else if (stripped.startsWith('00')) {
    // International dialling prefix (common outside the Americas)
    e164 = '+' + stripped.slice(2)
  } else {
    // Need the fallback country code
    const code = String(countryCode || DEFAULT_COUNTRY_CODE).replace(/\D/g, '')
    if (!code) {
      const err = new Error(
        'Cannot normalise phone number: no country code provided and WHATSAPP_DEFAULT_COUNTRY_CODE is not set'
      )
      err.status = 500
      throw err
    }

    if (stripped.startsWith('0')) {
      // Local format with leading trunk digit (e.g. 08012345678 → +2348012345678)
      e164 = '+' + code + stripped.slice(1)
    } else {
      // Bare digits without leading zero (e.g. US 10-digit 2125551234)
      e164 = '+' + code + stripped
    }
  }

  // E.164 validation: '+' followed by 7–15 digits
  if (!/^\+\d{7,15}$/.test(e164)) {
    const err = new Error(
      `Invalid phone number "${raw}". Please include your country code, e.g. +234... (Nigeria), +44... (UK), +1... (US)`
    )
    err.status = 400
    throw err
  }

  return e164
}

module.exports = { normalizePhoneNumber }
