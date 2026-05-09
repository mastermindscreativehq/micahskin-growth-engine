// Content Intelligence Service
// Orchestrates content generation, scheduling, and performance tracking
// Provider: OpenAI (default) or Anthropic (see CONTENT_AI_PROVIDER env)

const { PrismaClient } = require('@prisma/client');
const aiClient = require('./claudeContentClient');
const painPointService = require('./painPointDatabaseService');

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
  }) {
    const type = contentType || GENERATION_STRATEGY.CONTENT_TYPE_MAP[platform] || 'short_form_video';
    let generatedContent = {};
    let aiModel = aiClient.PROVIDER === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4.1-mini';

    try {
      if (type === 'short_form_video') {
        generatedContent = await aiClient.generateShortFormScript({ painCategory, platform, pillar, contentStyle, objective });
      } else if (type === 'carousel') {
        generatedContent = await aiClient.generateCarousel({ painCategory, platform, pillar, contentStyle, objective });
      } else if (type === 'whatsapp_status') {
        generatedContent = await aiClient.generateWhatsAppStatus({ painCategory, pillar, contentStyle, objective });
      } else if (type === 'caption_post') {
        generatedContent = await aiClient.generateCaption({ painCategory, platform, pillar, contentStyle, objective });
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

      const cta =
        generatedContent.cta ||
        generatedContent.telegram_cta ||
        'DM START on Telegram for your free skin diagnosis';

      const hashtags = generatedContent.hashtags || ['#skincare', '#nigerian', '#micahskin'];

      const telegramCta =
        generatedContent.telegram_cta ||
        'DM START on Telegram @micahskin_academy_bot for your free diagnosis';

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
          telegramCta,
          hashtags: JSON.stringify(hashtags),
          claudeModel: aiModel,
          status: 'draft',
          generationMode,
        },
      });

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

          const piece = await this.generateSinglePiece({ painCategory, platform, pillar, generationMode: 'auto' });
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

    return { success: true, batchDate, generated: generatedPieces.length, failed: failureCount, pieces: generatedPieces };
  },

  // ── Queue & retrieval ───────────────────────────────────────────────────────

  async getDailyQueue({ date = null } = {}) {
    const batchDate = date || this._getTodayWAT();
    return prisma.contentPiece.findMany({
      where: { batchDate },
      orderBy: [{ pillar: 'asc' }, { createdAt: 'desc' }],
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
    return prisma.contentPiece.update({ where: { id: pieceId }, data: { status: newStatus, updatedAt: new Date() } });
  },

  async updateContentPerformance(pieceId, { views, leads, conversions }) {
    return prisma.contentPiece.update({
      where: { id: pieceId },
      data: {
        views: views !== undefined ? views : undefined,
        leads: leads !== undefined ? leads : undefined,
        conversions: conversions !== undefined ? conversions : undefined,
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
      totalLeads: 0,
      totalConversions: 0,
      byPlatform: {},
      byPillar: {},
      byStatus: {},
      topPerformers: [],
    };

    pieces.forEach(piece => {
      stats.totalViews += piece.views;
      stats.totalLeads += piece.leads;
      stats.totalConversions += piece.conversions;
      stats.byPlatform[piece.platform] = (stats.byPlatform[piece.platform] || 0) + 1;
      stats.byPillar[piece.pillar] = (stats.byPillar[piece.pillar] || 0) + 1;
      stats.byStatus[piece.status] = (stats.byStatus[piece.status] || 0) + 1;
    });

    stats.topPerformers = pieces
      .sort((a, b) => b.views - a.views)
      .slice(0, 10)
      .map(p => ({
        id: p.id,
        hook: p.hook.substring(0, 50),
        platform: p.platform,
        views: p.views,
        leads: p.leads,
        conversions: p.conversions,
        conversionRate: p.views > 0 ? ((p.conversions / p.views) * 100).toFixed(2) : 0,
      }));

    if (stats.totalViews > 0) {
      stats.conversionRate = ((stats.totalConversions / stats.totalViews) * 100).toFixed(2);
    }

    return stats;
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
      { id: 'Telegram Conversion', label: 'Telegram Conversion' },
      { id: 'Academy Sales', label: 'Academy Sales' },
      { id: 'Product Sales', label: 'Product Sales' },
      { id: 'Brand Awareness', label: 'Brand Awareness' },
      { id: 'Engagement', label: 'Engagement' },
      { id: 'Authority Positioning', label: 'Authority Positioning' },
    ];
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
