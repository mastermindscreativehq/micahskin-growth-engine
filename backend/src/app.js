const express = require('express')

const app = express()

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, route: '/health' })
})

app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true, route: '/api/health' })
})

app.get('/', (_req, res) => {
  res.status(200).json({ ok: true, route: '/' })
})

module.exports = app