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
app.set('trust proxy', 1)

// ── Request logger (diagnostic — remove once stable) ─────────────────────────
app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.path} origin=${req.headers.origin || '—'}`)
  next()
})

// ── Health — must come before CORS/session so Railway probes always succeed ──
// Railway health check hits /api/health; keep this before every other middleware.
app.get('/api/health', (_req, res) => res.status(200).json({ ok: true }))
app.use('/health', healthRouter)

// ── Middleware ──────────────────────────────────────────────────────────────

// CORS — if ALLOWED_ORIGINS is unset, allow all origins (open dev/staging mode).
// Production: set ALLOWED_ORIGINS=https://your-vercel-domain.vercel.app in Railway.
// Local dev: set ALLOWED_ORIGINS=http://localhost:5173 in backend/.env.

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

const corsOptions = {
  origin: function (origin, callback) {
    // server-to-server / curl / Railway probes have no origin — always allow
    if (!origin) return callback(null, true)
    // if no whitelist is configured, allow everything
    if (allowedOrigins.length === 0) return callback(null, true)
    if (allowedOrigins.includes(origin)) return callback(null, true)
    console.warn('[cors] blocked origin:', origin)
    return callback(null, false)   // return 200 with no ACAO header (safe, not a crash)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

// Capture raw body for Paystack webhook signature verification
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf },
}))

// Session middleware
const isLocalDev = process.env.NODE_ENV === 'development'

app.use(session({
  name: 'sid',
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

// ── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[express error]', req.method, req.path, err.message, err.stack)
  if (res.headersSent) return
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal server error' })
})

module.exports = app
