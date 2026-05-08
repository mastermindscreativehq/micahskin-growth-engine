'use strict'

/**
 * scripts/seedOutreachQueue.js
 * Phase 36 — Seeds the outreach queue with 20 realistic Nigerian skincare
 * TikTok comment leads. Pushes each through the real acquisition pipeline so
 * scoring, segmentation, and CTA generation behave exactly as in production.
 *
 * Run:  node scripts/seedOutreachQueue.js
 */

const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

const prisma = require('../src/lib/prisma')
const { processRawItems } = require('../src/services/leadAcquisitionService')

const NOW = Date.now()
const day = (d) => new Date(NOW - d * 24 * 60 * 60 * 1000)

// 20 hand-crafted Nigerian-context comment items modeled after the
// clockworks/tiktok-comments-scraper output schema (cid, text, uniqueId,
// videoWebUrl, createTime).
const SAMPLE_COMMENTS = [
  {
    cid: 'seed-cmt-001', text: 'Please how much is this in Lagos? My dark spots have been killing me for over a year, I’ve tried everything 😭',
    uniqueId: 'amaka_skinjourney', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000001', createTime: Math.floor(day(0).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-002', text: 'Where can I buy this in Abuja please? I have stretch marks from pregnancy and I’m so tired of hiding them 😢',
    uniqueId: 'temi_abuja', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000002', createTime: Math.floor(day(0).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-003', text: 'Pls what can I use for these dark knuckles? It’s really embarrassing, I’ve tried so many creams and nothing works 🙏',
    uniqueId: 'chichi_glow', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000003', createTime: Math.floor(day(1).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-004', text: 'I’m starting a skincare brand in PH, can I become a reseller? I want details on the academy please',
    uniqueId: 'naomi_business', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000004', createTime: Math.floor(day(1).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-005', text: 'My acne and hyperpigmentation has been a nightmare, please help me with a routine, what worked for you?',
    uniqueId: 'biola_skin', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000005', createTime: Math.floor(day(0).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-006', text: 'How do I get rid of these stubborn pimples on my forehead? I’m so done with this 😩 send me the link please',
    uniqueId: 'fola_lagos', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000006', createTime: Math.floor(day(2).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-007', text: 'I need this! Can you DM me the price? I’m in Ibadan and my oily skin has been frustrating',
    uniqueId: 'kemi_ibadan', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000007', createTime: Math.floor(day(2).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-008', text: 'Do you do consultations? I’ve been struggling with melasma for 3 years and nothing’s working',
    uniqueId: 'ada_skinhelp', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000008', createTime: Math.floor(day(1).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-009', text: 'How much for the full routine? I want to start a skincare line in Lagos and need a mentor',
    uniqueId: 'tola_brand', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000009', createTime: Math.floor(day(3).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-010', text: 'Please ma, recommend something for my baby’s eczema, I’m desperate, please help',
    uniqueId: 'mama_zara', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000010', createTime: Math.floor(day(0).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-011', text: 'Best product for uneven skin tone? I’ve been dealing with this since secondary school 😔',
    uniqueId: 'oma_owerri', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000011', createTime: Math.floor(day(2).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-012', text: 'Send me the WhatsApp link please, I want to order. My face has been breaking out badly for months',
    uniqueId: 'kunle_ph', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000012', createTime: Math.floor(day(0).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-013', text: 'I am opening a small skincare shop in Benin, I need to learn the formulation business, where do I start?',
    uniqueId: 'ese_benin', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000013', createTime: Math.floor(day(4).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-014', text: 'Please how do I treat post-acne dark spots on melanin skin? Everything I try just makes it worse',
    uniqueId: 'ifeoma_glow', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000014', createTime: Math.floor(day(1).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-015', text: 'Do you ship to Kano? I want this 🥰 my husband even said my dark knuckles look bad now',
    uniqueId: 'hauwa_kano', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000015', createTime: Math.floor(day(2).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-016', text: 'Drop the WhatsApp number please, I’m taking my money 💸. I need a routine for combination skin',
    uniqueId: 'sade_lagos', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000016', createTime: Math.floor(day(0).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-017', text: 'Can anyone recommend something? My oily skin and breakouts are out of control, I’ve tried everything 😭',
    uniqueId: 'rita_skin', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000017', createTime: Math.floor(day(3).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-018', text: 'Please how much, I want to buy 3 sets for my sisters. We all have hyperpigmentation issues',
    uniqueId: 'gracebbq', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000018', createTime: Math.floor(day(1).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-019', text: 'I want to learn how to make these products, do you train people? I am in Lagos',
    uniqueId: 'becky_formula', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000019', createTime: Math.floor(day(5).getTime() / 1000),
  },
  {
    cid: 'seed-cmt-020', text: 'Pls I need help, my stretch marks have been embarrassing me at the beach. What worked for the lady in your video?',
    uniqueId: 'ngozi_beach', videoWebUrl: 'https://www.tiktok.com/@micahskin/video/7301000000000000020', createTime: Math.floor(day(2).getTime() / 1000),
  },
]

async function clearPriorSeeds() {
  const externalIds = SAMPLE_COMMENTS.map(c => c.cid)
  const existing = await prisma.scrapedLead.findMany({
    where: { externalId: { in: externalIds } },
    select: { id: true, injectedLeadId: true },
  })
  const leadIds = existing.map(e => e.injectedLeadId).filter(Boolean)

  if (leadIds.length) {
    const r = await prisma.lead.deleteMany({ where: { id: { in: leadIds } } })
    console.log(`[seed] Removed ${r.count} previously-seeded Lead rows`)
  }
  if (existing.length) {
    const r = await prisma.scrapedLead.deleteMany({ where: { externalId: { in: externalIds } } })
    console.log(`[seed] Removed ${r.count} previously-seeded ScrapedLead rows`)
  }
}

async function main() {
  console.log(`[seed] Pushing ${SAMPLE_COMMENTS.length} mock TikTok comments through the real pipeline…`)
  await clearPriorSeeds()

  const { normaliseTiktokCommentItem } = require('../src/services/tiktokScraperService')
  const stats = await processRawItems(SAMPLE_COMMENTS, {
    normaliser:       normaliseTiktokCommentItem,
    defaultIsComment: true,
  })

  console.log('[seed] Pipeline result:', JSON.stringify({
    total:    stats.total,
    stored:   stats.stored,
    accepted: stats.accepted,
    injected: stats.injected,
    queued:   stats.queued,
    rejected: stats.rejected,
  }, null, 2))

  // Show a sample of what's now in the queue
  const sample = await prisma.scrapedLead.findMany({
    where: { externalId: { startsWith: 'seed-cmt-' } },
    orderBy: { leadHeatScore: 'desc' },
    select: {
      username: true, comment: true, leadHeatScore: true, leadSegment: true,
      buyerReadinessScore: true, painSignalScore: true, recommendedAction: true,
      ctaType: true, whatsappCta: true, consultCta: true, academyCta: true,
      sourceVideoUrl: true, outreachStatus: true,
    },
    take: 5,
  })
  console.log('[seed] Sample top 5:', JSON.stringify(sample, null, 2))

  console.log(`[seed] Done — open the Outreach Queue tab to review.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] Failed:', err)
    process.exit(1)
  })
