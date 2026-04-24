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
const automationRouter = require('./routes/automation')
const productsRouter     = require('./routes/products')
const paymentsRouter     = require('./routes/payments')
const fulfillmentRouter  = require('./routes/fulfillment')

const app = express()

// Railway sits behind a proxy/load balancer.
// This makes secure cookies work correctly behind Railway.
app.set('trust proxy', 1)

// ─────────────────────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────────────────────

const nodeEnv = process.env.NODE_ENV || 'development'
const isProduction = nodeEnv === 'production'

const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret) {
  throw new Error('SESSION_SECRET is required')
}

const rawAllowedOrigins = process.env.ALLOWED_ORIGINS || ''

const allowedOrigins = rawAllowedOrigins
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

// Optional local dev origins only when not in production
if (!isProduction) {
  const devOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]

  for (const origin of devOrigins) {
    if (!allowedOrigins.includes(origin)) {
      allowedOrigins.push(origin)
    }
  }
}

// ─────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────

const corsOptions = {
  origin(origin, callback) {
    // Allow non-browser tools / server-to-server requests with no origin
    if (!origin) {
      return callback(null, true)
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true)
    }

    console.log('[CORS] blocked origin:', origin)
    return callback(new Error(`Not allowed by CORS: ${origin}`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

// ─────────────────────────────────────────────────────────────
// Body parsing
// ─────────────────────────────────────────────────────────────

// Keep rawBody so Paystack signature verification still works
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf
  },
}))

app.use(express.urlencoded({ extended: true }))

// ─────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────

// Frontend on Vercel + backend on Railway = cross-site cookie in production.
// That means production MUST use:
//   secure: true
//   sameSite: 'none'
app.use(session({
  name: 'sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
}))

// ─────────────────────────────────────────────────────────────
// Health / root
// ─────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.status(200).send('MICAHSKIN Growth Engine API is running')
})

app.use('/health', healthRouter)

// Optional compatibility route if anything still calls /api/health
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    environment: nodeEnv,
  })
})

// ─────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────

// Auth — public: login, logout, session check
app.use('/api/auth', authRouter)

// Leads — POST public, GET/PATCH protected inside router
app.use('/api/leads', leadsRouter)

// Academy — public register, protected reads/updates, sync webhook inside router
app.use('/api/academy', academyRouter)

// Stats — protected inside router
app.use('/api/stats', statsRouter)

// Replies
app.use('/api/replies', repliesRouter)

// Telegram webhook
app.use('/api/telegram', telegramRouter)

// Paystack webhook
app.use('/api/paystack', paystackRouter)

// Scraping routes
app.use('/api/scraping', scrapingRouter)

// Conversion tracking
app.use('/api/conversion', conversionRouter)

// Automation gateway — n8n webhook endpoints, protected by x-automation-secret
app.use('/api/automation', automationRouter)

// Product catalog, ingestion, matching, quotes
app.use('/api/products', productsRouter)

// Payment transactions
app.use('/api/payments', paymentsRouter)

// Fulfillment orders
app.use('/api/fulfillment', fulfillmentRouter)

// ─────────────────────────────────────────────────────────────
// 404
// ─────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  })
})

// ─────────────────────────────────────────────────────────────
// Error handler
// ─────────────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error('[APP ERROR]', err)

  if (err.message && err.message.startsWith('Not allowed by CORS')) {
    return res.status(403).json({
      success: false,
      message: err.message,
    })
  }

  return res.status(500).json({
    success: false,
    message: 'Internal server error',
  })
})

module.exports = app