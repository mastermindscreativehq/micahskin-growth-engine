// Market Signal Service
// Ingests, analyzes, and aggregates real audience signals from all sources.
// Feeds live intelligence into the Content Intelligence Engine.

const { PrismaClient } = require('@prisma/client');
const commentIntelligenceService = require('./commentIntelligenceService');

const prisma = new PrismaClient();

const PHRASE_FIELD_MAP = {
  pain_point:         'painPoints',
  emotional_language: 'emotionalLanguage',
  frustration:        'frustrations',
  objection:          'objections',
  desire:             'desires',
  urgency:            'urgencySignals',
  trust_issue:        'trustIssues',
  slang:              'slang',
  question:           'repeatedQuestions',
};

const marketSignalService = {
  // ── Ingestion ─────────────────────────────────────────────────────────────────

  async ingestRaw({ rawText, source, sourceId = null, sourceUrl = null, author = null, postedAt = null }) {
    return prisma.marketSignal.create({
      data: {
        rawText: rawText.trim(),
        source,
        sourceId: sourceId || null,
        sourceUrl: sourceUrl || null,
        author: author || null,
        postedAt: postedAt ? new Date(postedAt) : null,
        status: 'pending',
      },
    });
  },

  async ingestAndAnalyze({ rawText, source, sourceId = null, sourceUrl = null, author = null, postedAt = null }) {
    const signal = await this.ingestRaw({ rawText, source, sourceId, sourceUrl, author, postedAt });
    return this.analyzeSignal(signal.id);
  },

  // ── Analysis ──────────────────────────────────────────────────────────────────

  async analyzeSignal(signalId) {
    const signal = await prisma.marketSignal.findUnique({ where: { id: signalId } });
    if (!signal) throw new Error(`Signal ${signalId} not found`);
    if (signal.status === 'analyzed') return signal;

    try {
      const analysis = await commentIntelligenceService.analyzeText(signal.rawText, signal.source);

      const updated = await prisma.marketSignal.update({
        where: { id: signalId },
        data: {
          status: 'analyzed',
          analyzedAt: new Date(),
          painPoints:           analysis.painPoints           || [],
          emotionalLanguage:    analysis.emotionalLanguage    || [],
          frustrations:         analysis.frustrations         || [],
          objections:           analysis.objections           || [],
          desires:              analysis.desires              || [],
          urgencySignals:       analysis.urgencySignals       || [],
          trustIssues:          analysis.trustIssues          || [],
          slang:                analysis.slang                || [],
          repeatedQuestions:    analysis.repeatedQuestions    || [],
          buyingIntentDetected: analysis.buyingIntentDetected || false,
          emotionalIntensity:   analysis.emotionalIntensity   || 0,
          conversionPotential:  analysis.conversionPotential  || 0,
          viralityPotential:    analysis.viralityPotential    || 0,
          primarySignalType:    analysis.primarySignalType    || 'neutral',
          audienceSegment:      analysis.audienceSegment      || 'unknown',
          nicheCategory:        analysis.nicheCategory        || 'general',
          aiSummary:            analysis.aiSummary            || null,
        },
      });

      await this._updateSignalPhrases(updated);
      return updated;
    } catch (err) {
      await prisma.marketSignal.update({
        where: { id: signalId },
        data: { status: 'failed' },
      });
      throw err;
    }
  },

  async analyzePending(limit = 10) {
    const pending = await prisma.marketSignal.findMany({
      where: { status: 'pending', isActive: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    const results = [];
    for (const signal of pending) {
      try {
        const analyzed = await this.analyzeSignal(signal.id);
        results.push({ id: signal.id, success: true, nicheCategory: analyzed.nicheCategory });
      } catch (err) {
        results.push({ id: signal.id, success: false, error: err.message });
      }
    }
    return results;
  },

  // ── Phrase aggregation ────────────────────────────────────────────────────────

  async _updateSignalPhrases(signal) {
    const nicheCategory  = signal.nicheCategory  || 'general';
    const audienceSegment = signal.audienceSegment || 'consumer';

    for (const [signalType, fieldName] of Object.entries(PHRASE_FIELD_MAP)) {
      const phrases = signal[fieldName];
      if (!Array.isArray(phrases)) continue;

      for (const phrase of phrases) {
        if (!phrase || phrase.trim().length < 3) continue;
        const normalizedPhrase = phrase.toLowerCase().trim().substring(0, 500);

        try {
          const existing = await prisma.signalPhrase.findFirst({
            where: { normalizedPhrase, signalType, nicheCategory },
          });

          if (existing) {
            const n = existing.frequency + 1;
            await prisma.signalPhrase.update({
              where: { id: existing.id },
              data: {
                frequency: n,
                avgEmotionalIntensity:  ((existing.avgEmotionalIntensity  * existing.frequency) + signal.emotionalIntensity)  / n,
                avgConversionPotential: ((existing.avgConversionPotential * existing.frequency) + signal.conversionPotential) / n,
                avgViralityPotential:   ((existing.avgViralityPotential   * existing.frequency) + signal.viralityPotential)   / n,
                lastSeenAt: new Date(),
                updatedAt:  new Date(),
              },
            });
          } else {
            await prisma.signalPhrase.create({
              data: {
                phrase:                phrase.trim(),
                normalizedPhrase,
                signalType,
                nicheCategory,
                audienceSegment,
                frequency:              1,
                avgEmotionalIntensity:  signal.emotionalIntensity,
                avgConversionPotential: signal.conversionPotential,
                avgViralityPotential:   signal.viralityPotential,
                firstSeenAt:  new Date(),
                lastSeenAt:   new Date(),
              },
            });
          }
        } catch (err) {
          if (!err.message?.includes('Unique constraint')) {
            console.error('SignalPhrase upsert error:', err.message);
          }
        }
      }
    }
  },

  // ── Queries ───────────────────────────────────────────────────────────────────

  async listSignals({ source = null, status = null, nicheCategory = null, audienceSegment = null, limit = 50, offset = 0 } = {}) {
    const where = { isActive: true };
    if (source)         where.source         = source;
    if (status)         where.status         = status;
    if (nicheCategory)  where.nicheCategory  = nicheCategory;
    if (audienceSegment) where.audienceSegment = audienceSegment;

    return prisma.marketSignal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  },

  async getTopPhrasesByType(signalType, limit = 20, nicheCategory = null) {
    const where = { signalType, isActive: true };
    if (nicheCategory) where.nicheCategory = nicheCategory;

    return prisma.signalPhrase.findMany({
      where,
      orderBy: [{ frequency: 'desc' }, { avgEmotionalIntensity: 'desc' }],
      take: limit,
    });
  },

  async getTopPainPoints(limit = 20) {
    return this.getTopPhrasesByType('pain_point', limit);
  },

  async getTopConvertingPhrases(limit = 20) {
    return prisma.signalPhrase.findMany({
      where: { isActive: true },
      orderBy: [{ avgConversionPotential: 'desc' }, { frequency: 'desc' }],
      take: limit,
    });
  },

  async getEmotionalTrends(limit = 15) {
    return prisma.signalPhrase.findMany({
      where: { signalType: 'emotional_language', isActive: true },
      orderBy: [{ avgEmotionalIntensity: 'desc' }, { frequency: 'desc' }],
      take: limit,
    });
  },

  async getAudienceHeatmap() {
    const data = await prisma.marketSignal.groupBy({
      by: ['audienceSegment', 'nicheCategory'],
      where: { status: 'analyzed', isActive: true },
      _count: { id: true },
      _avg: { emotionalIntensity: true, conversionPotential: true },
    });

    return data.map(row => ({
      segment:       row.audienceSegment  || 'unknown',
      niche:         row.nicheCategory    || 'general',
      count:         row._count.id,
      avgEmotional:  Math.round(row._avg.emotionalIntensity  || 0),
      avgConversion: Math.round(row._avg.conversionPotential || 0),
    }));
  },

  async getTimeline(hours = 72) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return prisma.marketSignal.findMany({
      where: { status: 'analyzed', isActive: true, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  },

  async getStats() {
    const [total, analyzed, pending, failed, bySource, last24h, totalPhrases] = await Promise.all([
      prisma.marketSignal.count({ where: { isActive: true } }),
      prisma.marketSignal.count({ where: { status: 'analyzed', isActive: true } }),
      prisma.marketSignal.count({ where: { status: 'pending',  isActive: true } }),
      prisma.marketSignal.count({ where: { status: 'failed',   isActive: true } }),
      prisma.marketSignal.groupBy({ by: ['source'], where: { isActive: true }, _count: { id: true } }),
      prisma.marketSignal.count({ where: { isActive: true, createdAt: { gte: new Date(Date.now() - 86400000) } } }),
      prisma.signalPhrase.count({ where: { isActive: true } }),
    ]);

    return {
      totalSignals: total,
      analyzed,
      pending,
      failed,
      last24h,
      totalPhrases,
      bySource: Object.fromEntries(bySource.map(r => [r.source, r._count.id])),
    };
  },

  // Pulled by content generation to inject real phrases into AI prompts
  async getSignalsForGeneration(nicheCategory = 'general', limit = 12) {
    const phrases = await prisma.signalPhrase.findMany({
      where: {
        isActive: true,
        nicheCategory: { in: [nicheCategory, 'general'] },
      },
      orderBy: [{ frequency: 'desc' }, { avgEmotionalIntensity: 'desc' }],
      take: limit,
    });

    return phrases.map(p => ({
      phrase:             p.phrase,
      type:               p.signalType,
      frequency:          p.frequency,
      emotionalIntensity: Math.round(p.avgEmotionalIntensity),
      conversionPotential: Math.round(p.avgConversionPotential),
    }));
  },

  // Full insights snapshot for the Market Signals dashboard
  async getInsights() {
    const [stats, topPainPoints, topConverting, emotionalTrends, objections, questions, desires, slang] = await Promise.all([
      this.getStats(),
      this.getTopPainPoints(15),
      this.getTopConvertingPhrases(15),
      this.getEmotionalTrends(15),
      this.getTopPhrasesByType('objection', 10),
      this.getTopPhrasesByType('question', 10),
      this.getTopPhrasesByType('desire', 10),
      this.getTopPhrasesByType('slang', 10),
    ]);

    return { stats, topPainPoints, topConverting, emotionalTrends, objections, questions, desires, slang };
  },
};

module.exports = marketSignalService;
