'use strict'
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })
const prisma = require('../src/lib/prisma')
;(async () => {
  const since = new Date(Date.now() - 60 * 60 * 1000)
  const rows = await prisma.scrapedLead.findMany({
    where: { createdAt: { gte: since }, isComment: true },
    select: { leadHeatScore: true, buyerIntentScore: true, painScore: true, rejectionReason: true },
    orderBy: { leadHeatScore: 'desc' },
  })
  const buckets = { ge35: 0, ge25: 0, ge15: 0, ge10: 0, ge5: 0, zero: 0 }
  for (const r of rows) {
    const h = Number(r.leadHeatScore) || 0
    if      (h >= 35) buckets.ge35++
    else if (h >= 25) buckets.ge25++
    else if (h >= 15) buckets.ge15++
    else if (h >= 10) buckets.ge10++
    else if (h >= 5)  buckets.ge5++
    else              buckets.zero++
  }
  console.log('total=' + rows.length, JSON.stringify(buckets))
  await prisma.$disconnect()
})()
