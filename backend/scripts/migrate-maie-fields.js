'use strict'

/**
 * One-time migration: adds MAIE (Phase 33) intelligence fields to scraped_leads.
 * Run with: node scripts/migrate-maie-fields.js
 *
 * Per-column ALTER TABLE strategy — survives Supabase pooler statement_timeout
 * by using DIRECT_URL + a fresh client + SET LOCAL statement_timeout = 0
 * for every column.
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL

function makeClient() {
  return new PrismaClient({ datasources: { db: { url: directUrl } } })
}

const columns = [
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "countryConfidence"  DOUBLE PRECISION`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "nigeriaConfidence"  DOUBLE PRECISION`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "painScore"          DOUBLE PRECISION`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "urgencyScore"       DOUBLE PRECISION`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "buyerIntentScore"   DOUBLE PRECISION`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "authenticityScore"  DOUBLE PRECISION`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "emotionalIntensity" DOUBLE PRECISION`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "leadHeatScore"      DOUBLE PRECISION`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "leadSegment"        TEXT`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "detectedCity"       TEXT`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "detectedCountry"    TEXT`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "detectedLanguage"   TEXT`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "painSignals"        JSONB`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "buyerSignals"       JSONB`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "locationSignals"    JSONB`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "rejectionReason"    TEXT`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "aiSummary"          TEXT`,
  `ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS "outreachAngle"      TEXT`,
  `CREATE INDEX IF NOT EXISTS "scraped_leads_leadHeatScore_idx"     ON scraped_leads ("leadHeatScore")`,
  `CREATE INDEX IF NOT EXISTS "scraped_leads_leadSegment_idx"       ON scraped_leads ("leadSegment")`,
  `CREATE INDEX IF NOT EXISTS "scraped_leads_nigeriaConfidence_idx" ON scraped_leads ("nigeriaConfidence")`,
  `CREATE INDEX IF NOT EXISTS "scraped_leads_rejectionReason_idx"   ON scraped_leads ("rejectionReason")`,
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
  console.log(`[MAIE Migration] Running ${columns.length} statements`)
  console.log('(Each uses a fresh connection + SET LOCAL to disable timeout)')

  for (const sql of columns) {
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

  console.log('\n[MAIE Migration] Complete.')
}

run().catch((err) => {
  console.error('[MAIE Migration] Failed:', err.message)
  process.exit(1)
})
