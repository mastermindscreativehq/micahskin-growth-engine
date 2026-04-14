'use strict'

/**
 * One-time migration script: adds diagnosis engine fields to the leads table.
 * Run with: node scripts/migrate-diagnosis-fields.js
 *
 * Uses individual ALTER TABLE statements to avoid Supabase statement_timeout
 * when adding many columns in a single operation.
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

// Use the direct (non-pooled) URL for DDL.
const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL

// Creates a fresh client for each DDL operation to survive idle connection drops.
function makeClient() {
  return new PrismaClient({ datasources: { db: { url: directUrl } } })
}

// Each column as a separate ALTER TABLE to stay under statement timeout
const columns = [
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "diagnosisSummary" TEXT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "primaryConcern" TEXT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "secondaryConcern" TEXT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "routineType" TEXT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "productRecommendation" JSONB`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "recommendedProductsText" TEXT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "academyFitScore" INTEGER`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "conversionIntent" TEXT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "urgencyLevel" TEXT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "confidenceScore" INTEGER`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "nextBestAction" TEXT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "followupAngle" TEXT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "recommendedReply" TEXT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "diagnosisSource" TEXT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS "diagnosedAt" TIMESTAMPTZ`,
]

async function runOneColumn(sql) {
  // Fresh client per column: survives idle connection drops between ALTER TABLEs.
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
  console.log(`Running diagnosis field migration — ${columns.length} columns`)
  console.log('(Each column uses a fresh connection + SET LOCAL to disable timeout)')

  for (const sql of columns) {
    const columnName = sql.match(/"(\w+)"/)?.[1] || sql
    try {
      await runOneColumn(sql)
      console.log(`  ✓ ${columnName}`)
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log(`  ~ ${columnName} (already exists, skipped)`)
      } else {
        console.error(`  ✗ ${columnName}: ${err.message}`)
        throw err
      }
    }
  }

  console.log('\nMigration complete.')
}

run()
  .catch((err) => {
    console.error('Migration failed:', err.message)
    process.exit(1)
  })
