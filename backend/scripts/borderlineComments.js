'use strict'
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })
const prisma = require('../src/lib/prisma')
;(async () => {
  const since = new Date(Date.now() - 60 * 60 * 1000)
  const rows = await prisma.scrapedLead.findMany({
    where: {
      createdAt: { gte: since },
      isComment: true,
      leadHeatScore: { gte: 5, lt: 15 },
    },
    select: {
      username: true, comment: true, leadHeatScore: true,
      buyerIntentScore: true, painScore: true, buyerReadinessScore: true,
    },
    orderBy: { leadHeatScore: 'desc' },
    take: 20,
  })
  console.log('=== borderline (heat 5-14) ===')
  for (const r of rows) {
    console.log(JSON.stringify({
      u: r.username,
      c: r.comment.slice(0, 110),
      heat:  Math.round(r.leadHeatScore),
      pain:  Math.round(r.painScore),
      buyer: Math.round(r.buyerIntentScore),
      bReady: r.buyerReadinessScore,
    }))
  }
  await prisma.$disconnect()
})()
