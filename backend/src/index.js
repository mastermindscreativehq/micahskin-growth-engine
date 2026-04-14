require('dotenv').config()

const app = require('./app')
const prisma = require('./lib/prisma')
const { startScheduler } = require('./services/schedulerService')
const { startAutoTrigger } = require('./services/autoTriggerService')
const { startOrchestrationPoller } = require('./services/orchestrationService')
const { startActionEngine } = require('./services/actionEngineService')

const PORT = process.env.PORT || 4000

async function start() {
  // Verify DB connectivity on boot
  try {
    await prisma.$queryRaw`SELECT 1`
    console.log('✅ Database connection OK (pooler)')
  } catch (err) {
    console.error('❌ Database connection FAILED:', err.message)
    console.error('   Check DATABASE_URL in backend/.env — must use port 6543 with ?pgbouncer=true')
  }

  app.listen(PORT, () => {
    console.log(`\n✅ MICAHSKIN Growth Engine running on http://localhost:${PORT}`)
    console.log(`   Health check: http://localhost:${PORT}/health\n`)

    // Phase 6 — start follow-up alert scheduler (notifies admin of due follow-ups)
    startScheduler()
    // Phase 7 — start auto-trigger service (executes sends automatically)
    startAutoTrigger()
    // Phase 15 — orchestration poller: auto-triggers Stage 4 when Apify run succeeds
    startOrchestrationPoller()
    // Phase 17 — action engine: executes all scheduled lead actions (diagnosis, check-in, product reco, academy offer)
    startActionEngine()
  })
}

start()
