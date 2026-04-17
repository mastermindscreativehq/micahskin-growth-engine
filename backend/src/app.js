require('dotenv').config()

const express = require('express')
const cors = require('cors')
const session = require('express-session')

const healthRouter = require('./routes/health')
const authRouter = require('./routes/auth')
const leadsRouter = require('./routes/leads')
const academyRouter = require('./routes/academy')
const statsRouter = require('./routes/stats')
const repliesRouter = require('./routes/replies')
const telegramRouter = require('./routes/telegram')
const paystackRouter = require('./routes/paystack')
const scrapingRouter = require('./routes/scraping')
const conversionRouter = require('./routes/conversionRoutes')
const prisma = require('./lib/prisma')
const requireAuth = require('./middleware/requireAuth')
const { getWhatsAppHealth } = require('./services/whatsappService')

const app = express()

// Trust the first proxy (Railway's load balancer) so req.secure is correct.
// Required for session cookie.secure to work in production.
app.set('trust proxy', 1)

// ── Middleware ──────────────────────────────────────────────────────────────

// CORS — credentials: true is required so the browser sends the session cookie
// on cross-origin requests from the frontend.
// Production: set ALLOWED_ORIGINS=https://your-vercel-domain.vercel.app in Railway.
// Local dev: set ALLOWED_ORIGINS=http://localhost:5173 in backend/.env.
const corsOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',').map(o => o.trim()).filter(Boolean)

app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  credentials: true,
}))

// Capture raw body for Paystack webhook signature verification
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf },
}))

// Session middleware — stores admin login state server-side and sends
// an HTTP-only signed cookie to the browser.
//
// REQUIRED ENV VARS:
//   SESSION_SECRET  — long random string to sign/verify the session cookie
//                     (e.g. run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
//
// NOTE: This uses the default in-memory store, which is fine for a single-process
// local/small-server setup. For multi-process or Redis-backed prod, swap the store.
// Cross-site setup: Vercel frontend (vercel.app) → Railway backend (railway.app).
// Browsers refuse to forward SameSite=Lax cookies on cross-site fetch/XHR calls.
// SameSite=None + Secure=true is required. Default to production-safe unless
// explicitly in local development, so missing NODE_ENV in Railway doesn't break login.
const isLocalDev = process.env.NODE_ENV === 'development'

app.use(session({
  name: 'sid',
  // REQUIRED: set SESSION_SECRET in backend/.env
  secret: process.env.SESSION_SECRET || 'dev-fallback-secret-change-before-deploying',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: !isLocalDev,
    sameSite: isLocalDev ? 'lax' : 'none',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
}))

// ── Routes ──────────────────────────────────────────────────────────────────

app.use('/health', healthRouter)

// Auth — public: login, logout, session check
app.use('/api/auth', authRouter)

// Leads — POST is public (form submission), GET+PATCH protected (see routes/leads.js)
app.use('/api/leads', leadsRouter)

// Academy — POST /register is public, GET+PATCH protected (see routes/academy.js)
app.use('/api/academy', academyRouter)

// Stats — fully protected
app.use('/api/stats', statsRouter)

// Replies — POST public (webhook/manual), GET protected (admin CRM)
app.use('/api/replies', repliesRouter)

// Telegram Bot webhook — public, receives updates from Telegram Bot API
app.use('/api/telegram', telegramRouter)

// Paystack — public webhook (signature-verified) for payment confirmation
app.use('/api/paystack', paystackRouter)

// Scraping — admin-only; Apify import + raw item browser
app.use('/api/scraping', scrapingRouter)

// Conversion tracking — public; records clicks, signups, payments against leads
app.use('/api/conversion', conversionRouter)

// ── Debug (admin-only) ───────────────────────────────────────────────────────

app.get('/api/debug/db', async (req, res) => {
  try {
    const leads = await prisma.lead.findMany({ take: 1 })
    const registrations = await prisma.academyRegistration.findMany({ take: 1 })
    res.json({ success: true, leads, registrations })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// WhatsApp config health check — no token values exposed.
// Requires admin login (session cookie).
app.get('/api/debug/whatsapp', requireAuth, (req, res) => {
  res.json({ success: true, whatsapp: getWhatsAppHealth() })
})

// ── 404 catch-all ───────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` })
})

module.exports = app
