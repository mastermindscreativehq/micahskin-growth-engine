'use strict'

/**
 * One-time migration: adds Pain Signal Classifier (Phase 35) fields to scraped_leads.
 * Run with: node scripts/migrate-pain-signal-fields.js
 *
 * Per-statement ALTER TABLE strategy — survives Supabase pooler statement_timeout
 * by using DIRECT_URL + a fresh client + SET LOCAL statement_timeout = 0
 * for every column.
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL

function makeClient() {
  return new PrismaClient({ datasources: { db: { url: directUrl } } })
}

const statements = [
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "painSignalScore"       INTEGER`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "buyerReadinessScore"   INTEGER`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "emotionalPainLevel"    INTEGER`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "problemAwarenessLevel" TEXT`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "buyingStage"           TEXT`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "matchedPainSignals"    JSONB`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "matchedBuyerSignals"   JSONB`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "leadQuality"           TEXT`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "leadQualityReason"     TEXT`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "recommendedAction"     TEXT`,
  `CREATE INDEX IF NOT EXISTS "scraped_leads_leadQuality_idx"         ON scraped_leads ("leadQuality")`,
  `CREATE INDEX IF NOT EXISTS "scraped_leads_buyingStage_idx"         ON scraped_leads ("buyingStage")`,
  `CREATE INDEX IF NOT EXISTS "scraped_leads_recommendedAction_idx"   ON scraped_leads ("recommendedAction")`,
  `CREATE INDEX IF NOT EXISTS "scraped_leads_painSignalScore_idx"     ON scraped_leads ("painSignalScore")`,
  `CREATE INDEX IF NOT EXISTS "scraped_leads_buyerReadinessScore_idx" ON scraped_leads ("buyerReadinessScore")`,
]

async function runOneStatement(sql) {
  const client = makeClient()
  try {
    await client.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = 0`)
        await tx.$executeRawUnsafe(sql)
      },
      { timeout: 300_000, maxWait: 60_000 }
    )
  } finally {
    await client.$disconnect().catch(() => {})
  }
}

async function run() {
  console.log(`[PainSignal Migration] Running ${statements.length} statements`)
  console.log('(Each uses a fresh connection + SET LOCAL to disable timeout)')

  for (const sql of statements) {
    const label =
      sql.match(/COLUMN IF NOT EXISTS "(\w+)"/)?.[1] ||
      sql.match(/INDEX IF NOT EXISTS "(\w+)"/)?.[1] ||
      sql
    try {
      await runOneStatement(sql)
      console.log(`  ✓ ${label}`)
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log(`  ~ ${label} (already exists, skipped)`)
      } else {
        console.error(`  ✗ ${label}: ${err.message}`)
        throw err
      }
    }
  }

  console.log('\n[PainSignal Migration] Complete.')
}

run().catch((err) => {
  console.error('[PainSignal Migration] Failed:', err.message)
  process.exit(1)
})
