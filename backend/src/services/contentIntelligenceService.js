// Content Intelligence Service
// Orchestrates content generation, scheduling, and performance tracking
// Provider: OpenAI (default) or Anthropic (see CONTENT_AI_PROVIDER env)

const { PrismaClient } = require('@prisma/client');
const aiClient = require('./claudeContentClient');
const painPointService = require('./painPointDatabaseService');
const ctaEngine = require('./ctaEngineService');
const scoringService = require('./contentScoringService');
const marketSignalService = require('./marketSignalService');

const prisma = new PrismaClient();

const GENERATION_STRATEGY = {
  PLATFORM_DISTRIBUTION: {
    tiktok: 3,
    instagram_reel: 3,
    facebook: 2,
    whatsapp_status: 2,
  },
  PILLAR_DISTRIBUTION: [
    'pain_point',
    'pain_point',
    'academy',
    'growth_os',
    'authority',
    'conversion_cta',
    'pain_point',
  ],
  CONTENT_TYPE_MAP: {
    tiktok: 'short_form_video',
    instagram_reel: 'short_form_video',
    facebook: 'carousel',
    whatsapp_status: 'whatsapp_status',
  },
};

// ── Academy & business growth categories ─────────────────────────────────────

const ACADEMY_CATEGORIES = [
  { id: 'ai_growth_systems', label: 'AI Growth Systems', group: 'Academy & Business' },
  { id: 'lead_generation', label: 'Lead Generation', group: 'Academy & Business' },
  { id: 'automation', label: 'Automation', group: 'Academy & Business' },
  { id: 'brand_positioning', label: 'Brand Positioning', group: 'Academy & Business' },
  { id: 'customer_psychology', label: 'Customer Psychology', group: 'Academy & Business' },
  { id: 'conversion_systems', label: 'Conversion Systems', group: 'Academy & Business' },
  { id: 'backend_infrastructure', label: 'Backend Infrastructure', group: 'Academy & Business' },
  { id: 'content_systems', label: 'Content Systems', group: 'Academy & Business' },
  { id: 'skincare_business', label: 'Skincare Business', group: 'Academy & Business' },
  { id: 'authority_building', label: 'Authority Building', group: 'Academy & Business' },
];

const contentIntelligenceService = {
  // ── Single piece generation ─────────────────────────────────────────────────

  async generateSinglePiece({
    painCategory = 'general',
    platform = 'tiktok',
    pillar = 'pain_point',
    contentType = null,
    contentStyle = null,
    objective = null,
    generationMode = 'manual',
    // Phase 40 — Lineage tracking
    generationSessionId = null,
    generationType = null,
    generationReason = null,
    generationBatchLabel = null,
  }) {
    const type = contentType || GENERATION_STRATEGY.CONTENT_TYPE_MAP[platform] || 'short_form_video';
    let generatedContent = {};
    let aiModel = aiClient.PROVIDER === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4.1-mini';

    try {
      // Pull real audience signals to inject into AI prompts
      let liveSignals = [];
      try {
        liveSignals = await marketSignalService.getSignalsForGeneration(painCategory);
      } catch (_) { /* signals are optional — generation proceeds without them */ }

      if (type === 'short_form_video') {
        generatedContent = await aiClient.generateShortFormScript({ painCategory, platform, pillar, contentStyle, objective, liveSignals });
      } else if (type === 'carousel') {
        generatedContent = await aiClient.generateCarousel({ painCategory, platform, pillar, contentStyle, objective, liveSignals });
      } else if (type === 'whatsapp_status') {
        generatedContent = await aiClient.generateWhatsAppStatus({ painCategory, pillar, contentStyle, objective, liveSignals });
      } else if (type === 'caption_post') {
        generatedContent = await aiClient.generateCaption({ painCategory, platform, pillar, contentStyle, objective, liveSignals });
      }

      if (generatedContent._aiModel) {
        aiModel = generatedContent._aiModel;
        delete generatedContent._aiModel;
      }

      const contentTitle = generatedContent.content_title || null;

      const hook =
        generatedContent.hook ||
        generatedContent.status_slides?.[0]?.slide_text ||
        generatedContent.hook_slide?.heading ||
        'Untitled';

      // Dynamic CTA — platform-native bio link, no direct bot DM references
      const { text: dynamicCta, style: ctaStyle } = ctaEngine.getCTA({ pillar, platform });

      const cta =
        generatedContent.cta ||
        dynamicCta;

      const hashtags = generatedContent.hashtags || ['#skincare', '#nigerian', '#micahskin'];

      const bioLinkedCta =
        generatedContent.bio_cta ||
        dynamicCta;

      // Score the piece
      const scores = scoringService.scorePiece({
        hook,
        body: JSON.stringify(generatedContent),
        pillar,
        painCategory,
        platform,
        cta,
        claudeModel: aiModel,
      });

      // Phase 40 — Lineage fields
      const signalInfluenceScore = Math.min(100, Math.round((liveSignals.length / 12) * 100));
      const effectiveGenerationType = generationType || (liveSignals.length > 0 ? 'signal-driven' : 'manual');

      // Auto-create a session if one wasn't injected by batch generation
      let effectiveSessionId = generationSessionId;
      if (!effectiveSessionId) {
        const autoSession = await this.createGenerationSession({
          triggerType: 'manual',
          triggerSource: 'admin_ui',
          batchLabel: this._getTodayWAT(),
        });
        effectiveSessionId = autoSession.id;
      }

      const contentPiece = await prisma.contentPiece.create({
        data: {
          batchDate: this._getTodayWAT(),
          pillar,
          painCategory,
          platform,
          contentType: type,
          contentTitle,
          hook,
          body: JSON.stringify({ ...generatedContent, _contentStyle: contentStyle, _objective: objective }),
          cta,
          ctaStyle,
          telegramCta: bioLinkedCta,
          hashtags: JSON.stringify(hashtags),
          claudeModel: aiModel,
          status: 'draft',
          generationMode,
          hookScore:       scores.hookScore,
          emotionalScore:  scores.emotionalScore,
          viralityScore:   scores.viralityScore,
          conversionScore: scores.conversionScore,
          authorityScore:  scores.authorityScore,
          overallScore:    scores.overallScore,
          estimatedReach:  scores.estimatedReach,
          // Phase 40
          generationSessionId: effectiveSessionId || null,
          generatedAt:         new Date(),
          generationType:      effectiveGenerationType,
          generatedFromSignals: liveSignals.length > 0 ? liveSignals : null,
          freshnessState:      'new',
          signalInfluenceScore,
          generationReason:    generationReason || null,
          generationBatchLabel: generationBatchLabel || null,
        },
      });

      // Update single-piece session count
      if (!generationSessionId && effectiveSessionId) {
        await prisma.generationSession.update({
          where: { id: effectiveSessionId },
          data: {
            contentCount: 1,
            signalCount: signalInfluenceScore > 0 ? 1 : 0,
            averageScores: {
              hook: contentPiece.hookScore,
              virality: contentPiece.viralityScore,
              conversion: contentPiece.conversionScore,
              overall: contentPiece.overallScore,
            },
            dominantNiche: painCategory,
          },
        }).catch(() => {});
      }

      return contentPiece;
    } catch (error) {
      console.error('Error in generateSinglePiece:', error);
      throw new Error(`Failed to generate content: ${error.message}`);
    }
  },

  // ── Daily batch generation ──────────────────────────────────────────────────

  async generateDailyBatch({ date = null, count = 10 } = {}) {
    const batchDate = date || this._getTodayWAT();

    const existing = await prisma.contentPiece.findFirst({
      where: { batchDate, generationMode: 'auto' },
    });

    if (existing) {
      console.log(`Daily batch already exists for ${batchDate}`);
      return { skipped: true, batchDate, message: 'Batch already generated today' };
    }

    console.log(`Generating daily batch for ${batchDate}...`);

    // Phase 40 — Create generation session for this batch
    const session = await this.createGenerationSession({
      triggerType: 'batch',
      triggerSource: 'admin_ui',
      batchLabel: batchDate,
    });

    const allCategories = painPointService.getAllCategories();
    const generatedPieces = [];
    let failureCount = 0;

    const platforms = Object.keys(GENERATION_STRATEGY.PLATFORM_DISTRIBUTION);

    for (const platform of platforms) {
      const platformCount = GENERATION_STRATEGY.PLATFORM_DISTRIBUTION[platform];

      for (let i = 0; i < platformCount; i++) {
        try {
          const pillarIndex = (generatedPieces.length + i) % GENERATION_STRATEGY.PILLAR_DISTRIBUTION.length;
          const pillar = GENERATION_STRATEGY.PILLAR_DISTRIBUTION[pillarIndex];
          const categoryIndex = generatedPieces.length % allCategories.length;
          const painCategory = allCategories[categoryIndex].id;

          console.log(`Generating: ${platform} - ${pillar} - ${painCategory}`);

          const piece = await this.generateSinglePiece({
            painCategory, platform, pillar, generationMode: 'auto',
            generationSessionId: session.id,
            generationBatchLabel: batchDate,
          });
          generatedPieces.push(piece);
          console.log(`✓ Generated piece ${generatedPieces.length}/${count}`);
        } catch (error) {
          failureCount++;
          console.error(`✗ Failed to generate ${platform} piece:`, error.message);
          if (failureCount > 3) {
            console.warn('Too many failures, stopping batch generation');
            break;
          }
        }
      }
    }

    // Phase 40 — Update session with final stats
    if (generatedPieces.length > 0) {
      const niches = generatedPieces.map(p => p.painCategory);
      const nicheFreq = niches.reduce((acc, n) => { acc[n] = (acc[n] || 0) + 1; return acc; }, {});
      const dominantNiche = Object.entries(nicheFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const signalCount = generatedPieces.reduce((s, p) => s + (p.signalInfluenceScore > 0 ? 1 : 0), 0);
      const avgScores = {
        hook:       Math.round(generatedPieces.reduce((s, p) => s + p.hookScore, 0) / generatedPieces.length),
        virality:   Math.round(generatedPieces.reduce((s, p) => s + p.viralityScore, 0) / generatedPieces.length),
        conversion: Math.round(generatedPieces.reduce((s, p) => s + p.conversionScore, 0) / generatedPieces.length),
        overall:    Math.round(generatedPieces.reduce((s, p) => s + p.overallScore, 0) / generatedPieces.length),
      };
      await prisma.generationSession.update({
        where: { id: session.id },
        data: { contentCount: generatedPieces.length, signalCount, averageScores: avgScores, dominantNiche },
      });
    }

    return { success: true, batchDate, sessionId: session.id, generated: generatedPieces.length, failed: failureCount, pieces: generatedPieces };
  },

  // ── Queue & retrieval ───────────────────────────────────────────────────────

  async getDailyQueue({ date = null } = {}) {
    const batchDate = date || this._getTodayWAT();
    return prisma.contentPiece.findMany({
      where: { batchDate },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getContentPiece(pieceId) {
    return prisma.contentPiece.findUnique({ where: { id: pieceId } });
  },

  async listContentPieces({ status = null, platform = null, limit = 50, offset = 0 } = {}) {
    const where = {};
    if (status) where.status = status;
    if (platform) where.platform = platform;
    return prisma.contentPiece.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset });
  },

  // ── Status & performance ────────────────────────────────────────────────────

  async updateContentStatus(pieceId, newStatus) {
    if (!['draft', 'approved', 'scheduled', 'posted', 'archived'].includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }
    const data = { status: newStatus, updatedAt: new Date() };
    if (newStatus === 'posted') data.freshnessState = 'posted';
    return prisma.contentPiece.update({ where: { id: pieceId }, data });
  },

  async updateContentPerformance(pieceId, metrics) {
    const { views, saves, comments, replies, ctaClicks, leads, conversions, watchRetention } = metrics;
    return prisma.contentPiece.update({
      where: { id: pieceId },
      data: {
        ...(views          !== undefined && { views }),
        ...(saves          !== undefined && { saves }),
        ...(comments       !== undefined && { comments }),
        ...(replies        !== undefined && { replies }),
        ...(ctaClicks      !== undefined && { ctaClicks }),
        ...(leads          !== undefined && { leads }),
        ...(conversions    !== undefined && { conversions }),
        ...(watchRetention !== undefined && { watchRetention: parseFloat(watchRetention) }),
        updatedAt: new Date(),
      },
    });
  },

  async markAsWinning(pieceId, performanceNote = null) {
    const piece = await prisma.contentPiece.update({ where: { id: pieceId }, data: { isWinning: true } });
    const hookService = require('./hookLibraryService');
    await hookService.saveHook({
      hook: piece.hook,
      platform: piece.platform,
      pillar: piece.pillar,
      painCategory: piece.painCategory,
      hookType: 'statement',
      performanceNote: performanceNote || `Saved from ContentPiece ${pieceId}`,
    });
    return piece;
  },

  // ── Analytics ──────────────────────────────────────────────────────────────

  async getContentStats({ days = 30 } = {}) {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const pieces = await prisma.contentPiece.findMany({ where: { createdAt: { gte: sinceDate } } });

    const stats = {
      totalPieces: pieces.length,
      totalViews: 0,
      totalSaves: 0,
      totalLeads: 0,
      totalConversions: 0,
      byPlatform: {},
      byPillar: {},
      byStatus: {},
      byCtaStyle: {},
      byEstimatedReach: {},
      avgScores: { hook: 0, emotional: 0, virality: 0, conversion: 0, authority: 0, overall: 0 },
      topPerformers: [],
      topScoredPieces: [],
    };

    pieces.forEach(piece => {
      stats.totalViews       += piece.views;
      stats.totalSaves       += piece.saves || 0;
      stats.totalLeads       += piece.leads;
      stats.totalConversions += piece.conversions;
      stats.byPlatform[piece.platform] = (stats.byPlatform[piece.platform] || 0) + 1;
      stats.byPillar[piece.pillar]     = (stats.byPillar[piece.pillar] || 0) + 1;
      stats.byStatus[piece.status]     = (stats.byStatus[piece.status] || 0) + 1;
      if (piece.ctaStyle) stats.byCtaStyle[piece.ctaStyle] = (stats.byCtaStyle[piece.ctaStyle] || 0) + 1;
      if (piece.estimatedReach) stats.byEstimatedReach[piece.estimatedReach] = (stats.byEstimatedReach[piece.estimatedReach] || 0) + 1;

      stats.avgScores.hook       += piece.hookScore       || 0;
      stats.avgScores.emotional  += piece.emotionalScore  || 0;
      stats.avgScores.virality   += piece.viralityScore   || 0;
      stats.avgScores.conversion += piece.conversionScore || 0;
      stats.avgScores.authority  += piece.authorityScore  || 0;
      stats.avgScores.overall    += piece.overallScore    || 0;
    });

    if (pieces.length > 0) {
      Object.keys(stats.avgScores).forEach(k => {
        stats.avgScores[k] = Math.round(stats.avgScores[k] / pieces.length);
      });
    }

    stats.topPerformers = pieces
      .sort((a, b) => b.views - a.views)
      .slice(0, 10)
      .map(p => ({
        id: p.id,
        hook: p.hook.substring(0, 60),
        platform: p.platform,
        views: p.views,
        leads: p.leads,
        conversions: p.conversions,
        overallScore: p.overallScore,
        conversionRate: p.views > 0 ? ((p.conversions / p.views) * 100).toFixed(2) : 0,
      }));

    stats.topScoredPieces = pieces
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, 5)
      .map(p => ({
        id: p.id,
        hook: p.hook.substring(0, 60),
        platform: p.platform,
        overallScore: p.overallScore,
        estimatedReach: p.estimatedReach,
      }));

    if (stats.totalViews > 0) {
      stats.conversionRate = ((stats.totalConversions / stats.totalViews) * 100).toFixed(2);
    }

    return stats;
  },

  // ── Pain Signal Database ────────────────────────────────────────────────────

  async addPainSignal({ signal, signalType, painCategory, source = 'manual', notes = null }) {
    // Check for existing signal to increment frequency instead of duplicate
    const existing = await prisma.painSignalEntry.findFirst({
      where: { signal: { equals: signal }, painCategory, signalType },
    });

    if (existing) {
      return prisma.painSignalEntry.update({
        where: { id: existing.id },
        data: { frequency: { increment: 1 }, updatedAt: new Date() },
      });
    }

    return prisma.painSignalEntry.create({
      data: { signal, signalType, painCategory, source, notes },
    });
  },

  async getPainSignals({ painCategory = null, signalType = null, source = null, limit = 100 } = {}) {
    const where = { isActive: true };
    if (painCategory) where.painCategory = painCategory;
    if (signalType)   where.signalType   = signalType;
    if (source)       where.source       = source;

    return prisma.painSignalEntry.findMany({
      where,
      orderBy: [{ frequency: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
  },

  async deletePainSignal(signalId) {
    return prisma.painSignalEntry.update({
      where: { id: signalId },
      data: { isActive: false, updatedAt: new Date() },
    });
  },

  async getTopPainSignals({ limit = 20 } = {}) {
    return prisma.painSignalEntry.findMany({
      where: { isActive: true },
      orderBy: { frequency: 'desc' },
      take: limit,
    });
  },

  // ── Metadata ────────────────────────────────────────────────────────────────

  getAllPainCategories() {
    const skincare = painPointService.getAllCategories().map(c => ({ ...c, group: 'Skincare' }));
    return [...skincare, ...ACADEMY_CATEGORIES];
  },

  getAllPillars() {
    return [
      { id: 'pain_point', label: 'Pain Point' },
      { id: 'academy', label: 'Academy' },
      { id: 'growth_os', label: 'Growth OS' },
      { id: 'authority', label: 'Authority' },
      { id: 'conversion_cta', label: 'Conversion CTA' },
    ];
  },

  getAllPlatforms() {
    return [
      { id: 'tiktok', label: 'TikTok' },
      { id: 'instagram_reel', label: 'Instagram Reels' },
      { id: 'facebook', label: 'Facebook' },
      { id: 'whatsapp_status', label: 'WhatsApp Status' },
    ];
  },

  getAllContentStyles() {
    return [
      { id: 'auto', label: 'Auto (AI decides)' },
      { id: 'Cinematic', label: 'Cinematic' },
      { id: 'Luxury', label: 'Luxury' },
      { id: 'Authority', label: 'Authority' },
      { id: 'Emotional', label: 'Emotional' },
      { id: 'Educational', label: 'Educational' },
      { id: 'Viral', label: 'Viral' },
      { id: 'Documentary', label: 'Documentary' },
      { id: 'Founder Story', label: 'Founder Story' },
      { id: 'Direct Response', label: 'Direct Response' },
    ];
  },

  getAllObjectives() {
    return [
      { id: 'auto', label: 'Auto (AI decides)' },
      { id: 'Lead Generation', label: 'Lead Generation' },
      { id: 'Bio Link Conversion', label: 'Bio Link Conversion' },
      { id: 'Academy Sales', label: 'Academy Sales' },
      { id: 'Product Sales', label: 'Product Sales' },
      { id: 'Brand Awareness', label: 'Brand Awareness' },
      { id: 'Engagement', label: 'Engagement' },
      { id: 'Authority Positioning', label: 'Authority Positioning' },
    ];
  },

  getAllCtaStyles() {
    return ctaEngine.CTA_STYLES.map(id => ({
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, ' '),
    }));
  },

  getPainSignalTypes() {
    return [
      { id: 'pain_point',       label: 'Pain Point' },
      { id: 'emotional_phrase', label: 'Emotional Phrase' },
      { id: 'frustration',      label: 'Frustration' },
      { id: 'objection',        label: 'Objection' },
      { id: 'desire',           label: 'Desire' },
      { id: 'trending_concern', label: 'Trending Concern' },
      { id: 'question',         label: 'Audience Question' },
    ];
  },

  getPainSignalSources() {
    return [
      { id: 'manual',   label: 'Manual Entry' },
      { id: 'comment',  label: 'Comment' },
      { id: 'lead',     label: 'Lead Conversation' },
      { id: 'academy',  label: 'Academy Question' },
      { id: 'crm',      label: 'CRM Note' },
      { id: 'scraping', label: 'Scraping' },
      { id: 'content',  label: 'Content Performance' },
    ];
  },

  // ── Generation Sessions (Phase 40) ─────────────────────────────────────────

  async createGenerationSession({ triggerType = 'manual', triggerSource = null, batchLabel = null, notes = null } = {}) {
    return prisma.generationSession.create({
      data: { triggerType, triggerSource, batchLabel, notes },
    });
  },

  async listGenerationSessions({ limit = 20, offset = 0 } = {}) {
    const sessions = await prisma.generationSession.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { _count: { select: { contentPieces: true } } },
    });
    return sessions.map(s => ({ ...s, contentCount: s._count.contentPieces }));
  },

  async getGenerationSession(sessionId) {
    return prisma.generationSession.findUnique({
      where: { id: sessionId },
      include: {
        contentPieces: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, hook: true, platform: true, pillar: true,
            painCategory: true, status: true, freshnessState: true,
            overallScore: true, generationType: true, signalInfluenceScore: true,
          },
        },
      },
    });
  },

  async markContentViewed(pieceId) {
    const piece = await prisma.contentPiece.findUnique({ where: { id: pieceId }, select: { id: true, freshnessState: true } });
    if (!piece || piece.freshnessState !== 'new') return piece;
    return prisma.contentPiece.update({
      where: { id: pieceId },
      data: { freshnessState: 'viewed', updatedAt: new Date() },
    });
  },

  // ── Utilities ───────────────────────────────────────────────────────────────

  _getTodayWAT() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const wat = new Date(utc + 1 * 60 * 60000);
    const year = wat.getFullYear();
    const month = String(wat.getMonth() + 1).padStart(2, '0');
    const day = String(wat.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  getRandomPainCategory() {
    const categories = painPointService.getAllCategories();
    return categories[Math.floor(Math.random() * categories.length)].id;
  },
};

module.exports = contentIntelligenceService;
