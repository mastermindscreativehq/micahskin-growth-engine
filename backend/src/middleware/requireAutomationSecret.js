const crypto = require('crypto')

/**
 * Protects automation gateway routes by verifying x-automation-secret header.
 * Uses timing-safe comparison to prevent secret enumeration via timing attacks.
 * Reads secret from AUTOMATION_SECRET env var.
 */
function requireAutomationSecret(req, res, next) {
  const secret = process.env.AUTOMATION_SECRET

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[AutomationGateway] AUTOMATION_SECRET not set in production — request blocked')
      return res.status(503).json({ success: false, message: 'Automation gateway not configured' })
    }
    console.warn('[AutomationGateway] AUTOMATION_SECRET not set — skipping auth (dev only)')
    return next()
  }

  const provided = req.headers['x-automation-secret']

  if (!provided) {
    return res.status(401).json({ success: false, message: 'Missing x-automation-secret header' })
  }

  let authorized = false
  try {
    const secretBuf = Buffer.from(secret)
    const providedBuf = Buffer.from(provided)
    // timingSafeEqual requires same length — length mismatch is itself a rejection
    if (secretBuf.length === providedBuf.length) {
      authorized = crypto.timingSafeEqual(secretBuf, providedBuf)
    }
  } catch {
    authorized = false
  }

  if (!authorized) {
    return res.status(401).json({ success: false, message: 'Invalid automation secret' })
  }

  next()
}

module.exports = requireAutomationSecret
