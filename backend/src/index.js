require('dotenv').config()

const app = require('./app')
const prisma = require('./lib/prisma')
const { startScheduler } = require('./services/schedulerService')
const { startAutoTrigger } = require('./services/autoTriggerService')
const { startOrchestrationPoller } = require('./services/orchestrationService')
const { startActionEngine } = require('./services/actionEngineService')
const { startAcademyOnboarding } = require('./services/academyOnboardingService')
const { startAcademyExperience } = require('./services/academyExperienceService')

const PORT = process.env.PORT || 4000

async function start() {
  try {
    await prisma.$queryRaw`SELECT 1`
    console.log('✅ Database connection OK')
  } catch (err) {
    console.error('❌ Database connection FAILED:', err.message)
    console.error('   Check DATABASE_URL in backend/.env — must use port 6543 with ?pgbouncer=true')
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ MICAHSKIN Growth Engine running on port ${PORT}`)
    console.log(`   Health check: http://localhost:${PORT}/health\n`)

    // Each service is isolated — a crash in one does not take down the server
    try { startScheduler() } catch (e) { console.error('[scheduler] start failed:', e.message) }
    try { startAutoTrigger() } catch (e) { console.error('[autoTrigger] start failed:', e.message) }
    try { startOrchestrationPoller() } catch (e) { console.error('[orchestration] start failed:', e.message) }
    try { startActionEngine() } catch (e) { console.error('[actionEngine] start failed:', e.message) }
    try { startAcademyOnboarding() } catch (e) { console.error('[academyOnboarding] start failed:', e.message) }
    try { startAcademyExperience() } catch (e) { console.error('[academyExperience] start failed:', e.message) }
  })
}

start()
