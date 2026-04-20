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

// Trust Railway's load balancer so req.secure is correct for cookie.secure
app.set('trust proxy', 1)

// ── CORS ─────────────────────────────────────────────────────────────────────

const allowedOrigins = [
  'https://micahskin-growth-engine.vercel.app',
  'http://localhost:5173',
]

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) return callback(null, true)
    console.log('[CORS] blocked:', origin)
    return callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

// ── Body parsing ──────────────────────────────────────────────────────────────

// Raw body captured so Paystack can verify webhook signatures
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf },
}))

// ── Session ───────────────────────────────────────────────────────────────────

// Vercel (vercel.app) → Railway (railway.app) is cross-site.
// Browsers block SameSite=Lax on cross-site fetch, so we need SameSite=None + Secure.
// Default to production-safe so a missing NODE_ENV on Railway doesn't break login.
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

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/health', healthRouter)

// Auth — public: login, logout, session check
app.use('/api/auth', authRouter)

// Leads — POST public (form submission), GET+PATCH protected (see routes/leads.js)
app.use('/api/leads', leadsRouter)

// Academy — POST /register public, GET+PATCH protected; POST /sync is n8n webhook
app.use('/api/academy', academyRouter)

// Stats — fully protected
app.use('/api/stats', statsRouter)

// Replies — POST public (webhook/manual), GET protected (admin CRM)
app.use('/api/replies', repliesRouter)

// Telegram bot webhook — public, receives updates from Telegram Bot API
app.use('/api/telegram', telegramRouter)

// Paystack — public webhook (signature-verified) for payment confirmation
app.use('/api/paystack', paystackRouter)

// Scraping — admin-only; Apify import + raw item browser
app.use('/api/scraping', scrapingRouter)

// Conversion tracking — public; records clicks, signups, payments against leads
app.use('/api/conversion', conversionRouter)

// ── Debug (admin-only) ────────────────────────────────────────────────────────

app.get('/api/debug/db', async (req, res) => {
  try {
    const leads = await prisma.lead.findMany({ take: 1 })
    const registrations = await prisma.academyRegistration.findMany({ take: 1 })
    res.json({ success: true, leads, registrations })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

app.get('/api/debug/whatsapp', requireAuth, (req, res) => {
  res.json({ success: true, whatsapp: getWhatsAppHealth() })
})

// ── 404 catch-all ─────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` })
})

module.exports = app
