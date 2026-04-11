/**
 * requireAuth middleware
 *
 * Protects admin API routes by verifying the server-side session.
 * Applied individually to GET/PATCH routes that expose CRM data.
 * Public form-submission routes (POST) bypass this middleware.
 *
 * Session is created by POST /api/auth/login using the ADMIN_PASSWORD env var.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next()
  }
  return res.status(401).json({ success: false, message: 'Unauthorised' })
}

module.exports = requireAuth
