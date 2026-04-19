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
  console.error('❌ PORT env missing')
  process.exit(1)
}

process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled promise rejection:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[process] Uncaught exception:', err)
})

function launchService(name, fn) {
  setImmediate(async () => {
    try {
      await fn()
      console.log(`[services] ✅ ${name} started`)
    } catch (err) {
      console.error(`[services] ❌ ${name} failed to start:`, err)
    }
  })
}

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ MICAHSKIN Growth Engine listening on port ${PORT}`)

  prisma.$queryRaw`SELECT 1`
    .then(() => console.log('[db] ✅ Database connection OK'))
    .catch((err) => console.error('[db] ❌ Database connection failed:', err.message))

  launchService('schedulerService', startScheduler)
  launchService('autoTriggerService', startAutoTrigger)
  launchService('orchestrationService', startOrchestrationPoller)
  launchService('actionEngineService', startActionEngine)
  launchService('academyOnboardingService', startAcademyOnboarding)
  launchService('academyExperienceService', startAcademyExperience)
})

server.on('error', (err) => {
  console.error('[server] Fatal listen error:', err)
  process.exit(1)
})