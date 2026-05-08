'use strict'

/**
 * scripts/reprocessStoredComments.js
 * Phase 36 — Re-scores ScrapedLead rows already in the DB using the latest
 * lexicon + thresholds. No Apify cost. Touches only rows we just scraped
 * (last 60 minutes) so it never disturbs historical data.
 */

const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

const prisma = require('../src/lib/prisma')

const nigeriaSignal       = require('../src/services/nigeriaSignalService')
const leadPsychology      = require('../src/services/leadPsychologyService')
const leadSegmentation    = require('../src/services/leadSegmentationService')
const outreachIntelligence = require('../src/services/outreachIntelligenceService')
const leadHeatEngine      = require('../src/services/leadHeatEngine')
const painSignalClassifier = require('../src/services/painSignalClassifierService')
const buyerReadiness       = require('../src/services/buyerReadinessService')
const leadQualityGate      = require('../src/services/leadQualityGateService')

async function main() {
  const since = new Date(Date.now() - 60 * 60 * 1000)
  const rows = await prisma.scrapedLead.findMany({
    where: { createdAt: { gte: since }, isComment: true },
    orderBy: { createdAt: 'desc' },
  })
  console.log('[reprocess] re-scoring ' + rows.length + ' stored comment rows…')

  let updated = 0
  let injected = 0
  for (const row of rows) {
    const text = row.comment
    const ng    = nigeriaSignal.detect(text, { username: row.username, hashtag: row.hashtag })
    const psych = leadPsychology.analyze(text)
    const seg   = leadSegmentation.classify(text, { username: row.username, hashtag: row.hashtag })
    const pain  = painSignalClassifier.classify(text)
    const buy   = buyerReadiness.evaluate(text, { painClassification: pain, segmentation: seg })
    const heat  = leadHeatEngine.evaluate({
      nigeria: ng, psychology: psych, segmentation: seg, engagement: {}, duplicate: false,
    })
    const gate  = leadQualityGate.evaluate({
      painClassification: pain, buyerReadiness: buy, nigeriaSignal: ng, segmentation: seg,
    })

    const outreach = outreachIntelligence.generate({
      text, nigeria: ng, psychology: psych, segmentation: seg,
      username: row.username, externalId: row.externalId,
      painCategory: leadSegmentation.mapToConcernType(seg.segment),
    })

    await prisma.scrapedLead.update({
      where: { id: row.id },
      data: {
        nigeriaConfidence:  ng.nigeriaConfidence,
        countryConfidence:  ng.countryConfidence,
        detectedCity:       ng.detectedCity,
        detectedCountry:    ng.detectedCountry,
        detectedLanguage:   ng.detectedLanguage,
        locationSignals:    ng.locationSignals,
        painScore:          psych.painScore,
        urgencyScore:       psych.urgencyScore,
        buyerIntentScore:   psych.buyerIntentScore,
        authenticityScore:  psych.authenticityScore,
        emotionalIntensity: psych.emotionalIntensity,
        painSignals:        psych.painSignals,
        buyerSignals:       psych.buyerSignals,
        leadHeatScore:      heat.leadHeatScore,
        leadSegment:        seg.segment,
        rejectionReason:    heat.rejectionReason,
        aiSummary:          outreach.aiSummary,
        outreachAngle:      outreach.outreachAngle,
        whatsappCta:        outreach.whatsappCta || row.whatsappCta,
        consultCta:         outreach.consultCta  || row.consultCta,
        academyCta:         outreach.academyCta  || row.academyCta,
        ctaType:            outreach.ctaType     || row.ctaType,
        painSignalScore:       Math.round(pain.painSignalScore || 0),
        buyerReadinessScore:   Math.round(buy.buyerReadinessScore || 0),
        emotionalPainLevel:    Math.round(pain.emotionalPainLevel || 0),
        problemAwarenessLevel: pain.problemAwarenessLevel,
        buyingStage:           buy.buyingStage,
        matchedPainSignals:    pain.matchedPainSignals,
        matchedBuyerSignals:   buy.matchedBuyerSignals,
        leadQuality:           gate.leadQuality,
        leadQualityReason:     gate.leadQualityReason,
        recommendedAction:     gate.recommendedAction,
      },
    })
    updated++

    // Inject as Lead if score now passes the warm threshold and we haven't already
    if (!row.injectedLeadId && heat.leadHeatScore >= leadHeatEngine.WARM_THRESHOLD) {
      const concern = leadSegmentation.mapToConcernType(seg.segment) || 'general'
      const skinLabel = concern.replace(/_/g, ' ')
      const priority = leadHeatEngine.isHot(heat.leadHeatScore)
        ? 'high'
        : leadHeatEngine.isWarm(heat.leadHeatScore) ? 'medium' : 'low'
      const lead = await prisma.lead.create({
        data: {
          fullName:           '@' + (row.username || 'unknown') + ' (TikTok)',
          sourcePlatform:     'tiktok',
          sourceType:         'scraped',
          skinConcern:        skinLabel,
          message:            row.comment,
          handle:             row.username,
          status:             'new',
          priority,
          productIntentScore: Math.round(heat.leadHeatScore),
          consultIntentScore: Math.round(heat.leadHeatScore * 0.6),
          academyIntentScore: leadSegmentation.isAcademySegment(seg.segment)
            ? Math.round(Math.max(60, heat.leadHeatScore))
            : Math.round(heat.leadHeatScore * 0.4),
          primaryConcern:     concern,
          urgencyLevel:       row.urgencyLevel,
          leadStage:          'new',
          lastInteractionAt:  new Date(),
          suggestedReply:     outreach.suggestedReply,
          followupAngle:      outreach.outreachAngle,
        },
      })
      await prisma.scrapedLead.update({
        where: { id: row.id },
        data: {
          processed:      true,
          injectedLeadId: lead.id,
          outreachQueued: leadHeatEngine.isHot(heat.leadHeatScore),
        },
      })
      injected++
    }
  }
  console.log('[reprocess] updated=' + updated + ' newlyInjected=' + injected)

  // Print top accepted comment leads (cold or above)
  const top = await prisma.scrapedLead.findMany({
    where: {
      createdAt: { gte: since },
      isComment: true,
      leadHeatScore: { gte: leadHeatEngine.COLD_THRESHOLD },
    },
    orderBy: [{ leadHeatScore: 'desc' }],
    take: 30,
  })
  console.log('\n[reprocess] === REAL ACCEPTED COMMENT LEADS (heat >= ' + leadHeatEngine.COLD_THRESHOLD + ', total=' + top.length + ') ===')
  for (const r of top) {
    const lead = r.injectedLeadId
      ? await prisma.lead.findUnique({ where: { id: r.injectedLeadId } })
      : null
    console.log(JSON.stringify({
      username:       r.username,
      comment:        r.comment,
      painType:       r.concernType || r.leadSegment || 'general',
      buyerIntent:    Math.round(r.buyerIntentScore || 0),
      buyerReadiness: r.buyerReadinessScore,
      heat:           Math.round(r.leadHeatScore || 0),
      temperature:    leadHeatEngine.temperatureLabel(r.leadHeatScore),
      suggestedReply: lead?.suggestedReply || r.consultCta,
      whatsappCta:    r.whatsappCta,
      consultCta:     r.consultCta,
      academyCta:     r.academyCta,
      videoUrl:       r.sourceVideoUrl || r.videoUrl,
      profileUrl:     r.username ? 'https://www.tiktok.com/@' + r.username.replace(/^@/, '') : null,
      outreachStatus: r.outreachStatus,
    }, null, 2))
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[reprocess] fatal:', err)
    process.exit(1)
  })
