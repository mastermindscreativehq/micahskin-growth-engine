const { Router } = require('express')

const router = Router()

/**
 * POST /api/auth/login
 * Body: { password: string }
 *
 * Validates the submitted password against the ADMIN_PASSWORD env var.
 * The password is NEVER sent back to the client — only a success/failure flag.
 * On success, sets req.session.authenticated = true (HTTP-only cookie session).
 *
 * REQUIRED ENV VAR: ADMIN_PASSWORD — set this in backend/.env
 */
router.post('/login', (req, res) => {
  // DEBUG — safe to leave in place; never logs the actual password value
  console.log('[auth/login] body keys:', Object.keys(req.body || {}))
  console.log('[auth/login] ADMIN_PASSWORD set:', !!process.env.ADMIN_PASSWORD)
  if (process.env.ADMIN_PASSWORD) {
    console.log('[auth/login] ADMIN_PASSWORD length:', process.env.ADMIN_PASSWORD.length)
  }

  const { password } = req.body

  // REQUIRED: set ADMIN_PASSWORD in backend/.env before using this endpoint.
  // Trim guards against Railway env vars saved with accidental leading/trailing whitespace.
  const adminPassword = (process.env.ADMIN_PASSWORD || '').trim()

  if (!adminPassword) {
    console.error('❌ ADMIN_PASSWORD env var is not set — admin login is disabled')
    return res.status(500).json({ success: false, message: 'Server misconfiguration: ADMIN_PASSWORD not set' })
  }

  if (!password || password !== adminPassword) {
    console.warn('[auth/login] password mismatch — received length:', (password || '').length)
    return res.status(401).json({ success: false, message: 'Invalid password' })
  }

  // Mark session as authenticated; express-session signs and stores this server-side
  req.session.authenticated = true
  return res.json({ success: true })
})

/**
 * POST /api/auth/logout
 *
 * Destroys the server-side session and clears the session cookie.
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Logout failed' })
    }
    // Clear the cookie on the client too
    res.clearCookie('sid')
    return res.json({ success: true })
  })
})

/**
 * GET /api/auth/me
 *
 * Returns 200 + { authenticated: true } if the session is valid.
 * Returns 401 + { authenticated: false } if not.
 * Used by the frontend to check login state on page load without re-entering password.
 */
router.get('/me', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.json({ success: true, authenticated: true })
  }
  return res.status(401).json({ success: false, authenticated: false })
})

module.exports = router
