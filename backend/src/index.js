require('dotenv').config()

const app = require('./app')
const prisma = require('./lib/prisma')
const { startScheduler } = require('./services/schedulerService')
const { startAutoTrigger } = require('./services/autoTriggerService')
const { startOrchestrationPoller } = require('./services/orchestrationService')
const { startActionEngine } = require('./services/actionEngineService')
const { startAcademyOnboarding } = require('./services/academyOnboardingService')
const { startAcademyExperience } = require('./services/academyExperienceService')

const PORT = process.env.PORT

if (!PORT) {
  console.error('❌ PORT not provided — aborting')
  process.exit(1)
}

// ─── Global safety net ───────────────────────────────────────────────────────
// Prevents a single unhandled rejection from killing the process.
// Log it and keep running — background jobs failing should never kill the HTTP server.
process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled promise rejection:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[process] Uncaught exception:', err)
  // Do NOT exit — Railway would restart and hit the same crash loop.
  // Investigate the logged error instead.
})

// ─── Isolated service launcher ───────────────────────────────────────────────
// Wraps each background service so a crash/throw in one never affects others
// or the HTTP server. Uses setImmediate to yield the event loop between starts.
function launchService(name, fn) {
  setImmediate(async () => {
    try {
      await fn()
      console.log(`[services] ✅ ${name} started`)
    } catch (err) {
      console.error(`[services] ❌ ${name} failed to start:`, err.message)
    }
  })
}

// ─── Boot ────────────────────────────────────────────────────────────────────
// CRITICAL: bind the port FIRST so Railway's health check passes immediately.
// All other work (DB check, services) runs after the server is accepting requests.
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ MICAHSKIN Growth Engine listening on port ${PORT}`)

  // DB connectivity check — informational only, does not block HTTP traffic
  prisma.$queryRaw`SELECT 1`
    .then(() => console.log('[db] ✅ Database connection OK'))
    .catch((err) => console.error('[db] ❌ Database connection failed:', err.message))

  // Background services — each is isolated; one failure cannot affect the others
  launchService('schedulerService',        startScheduler)
  launchService('autoTriggerService',      startAutoTrigger)
  launchService('orchestrationService',    startOrchestrationPoller)
  launchService('actionEngineService',     startActionEngine)
  launchService('academyOnboardingService',startAcademyOnboarding)
  launchService('academyExperienceService',startAcademyExperience)
})

server.on('error', (err) => {
  console.error('[server] Fatal listen error:', err)
  process.exit(1)
})
