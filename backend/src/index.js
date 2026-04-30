require('dotenv').config()

const app = require('./app')
const prisma = require('./lib/prisma')

const { startScheduler } = require('./services/schedulerService')
const { startAutoTrigger } = require('./services/autoTriggerService')
const { startOrchestrationPoller } = require('./services/orchestrationService')
const { startActionEngine } = require('./services/actionEngineService')
const { startAcademyOnboarding } = require('./services/academyOnboardingService')
const { startAcademyExperience } = require('./services/academyExperienceService')
const { startAutoFollowUpService }     = require('./services/autoFollowUpService')
const { startLeadAcquisitionEngine }   = require('./services/leadAcquisitionService')

const PORT = Number(process.env.PORT) || 4000
const HOST = '0.0.0.0'

let servicesStarted = false

async function checkDatabaseConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`
    console.log('✅ Database connection OK')
    return true
  } catch (err) {
    console.error('❌ Database connection FAILED:', err.message)
    console.error('   Check DATABASE_URL on Railway / backend env')
    return false
  }
}

function safeStartService(name, fn) {
  try {
    fn()
    console.log(`✅ ${name} started`)
  } catch (err) {
    console.error(`❌ ${name} failed to start:`, err.message)
  }
}

function startBackgroundServices() {
  if (servicesStarted) {
    console.log('⚠️ Background services already started, skipping duplicate boot')
    return
  }

  servicesStarted = true

  safeStartService('Follow-up scheduler', startScheduler)
  safeStartService('Auto-trigger service', startAutoTrigger)
  safeStartService('Orchestration poller', startOrchestrationPoller)
  safeStartService('Action Engine', startActionEngine)
  safeStartService('Academy Onboarding Service', startAcademyOnboarding)
  safeStartService('Academy Experience Service', startAcademyExperience)
  safeStartService('Auto Follow-Up Conversion Engine', startAutoFollowUpService)
  safeStartService('Lead Acquisition Engine', startLeadAcquisitionEngine)
}

async function start() {
  console.log('🚀 Booting MICAHSKIN Growth Engine...')

  await checkDatabaseConnection()

  const server = app.listen(PORT, HOST, () => {
    console.log(`✅ MICAHSKIN Growth Engine running on port ${PORT}`)
    console.log(`   Health check: http://localhost:${PORT}/health`)
    console.log(`   API health:   http://localhost:${PORT}/api/health`)

    startBackgroundServices()
  })

  server.on('error', (err) => {
    console.error('❌ Server failed to start:', err.message)
    process.exit(1)
  })

  const shutdown = async (signal) => {
    console.log(`\n⚠️ Received ${signal}. Shutting down gracefully...`)

    server.close(async () => {
      try {
        await prisma.$disconnect()
        console.log('✅ Prisma disconnected')
      } catch (err) {
        console.error('❌ Error during Prisma disconnect:', err.message)
      } finally {
        process.exit(0)
      }
    })

    setTimeout(() => {
      console.error('❌ Forced shutdown after timeout')
      process.exit(1)
    }, 10000).unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Promise Rejection:', reason)
  })

  process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err)
  })
}

start()