const express = require('express')
const cors = require('cors')

const app = express()

const allowedOrigins = [
  'https://micahskin-growth-engine.vercel.app',
  'http://localhost:5173',
]

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) return callback(null, true)
    return callback(null, false)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}

app.use(cors(corsOptions))
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://micahskin-growth-engine.vercel.app')
  res.header('Access-Control-Allow-Credentials', 'true')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200)
  }

  next()
})
app.options('*', cors(corsOptions))

app.get('/debug-cors', (req, res) => {
  res.json({ cors: 'active' })
})

module.exports = app