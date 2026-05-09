// Content Intelligence Service
// Orchestrator for content generation, scheduling, and performance tracking
// Coordinates Claude API, database, and pain point intelligence

const { PrismaClient } = require('@prisma/client');
const claudeContentClient = require('./claudeContentClient');
const painPointService = require('./painPointDatabaseService');

const prisma = new PrismaClient();

// Content generation strategy
const GENERATION_STRATEGY = {
  PLATFORM_DISTRIBUTION: {
    tiktok: 3,
    instagram_reel: 3,
    facebook: 2,
    whatsapp_status: 2,
  },
  PILLAR_DISTRIBUTION: [
    'pain_point',
    'pain_point', // 2 pain point pieces
    'academy',
    'growth_os',
    'authority',
    'conversion_cta',
    'pain_point', // Extra pain point because it converts best
  ],
  CONTENT_TYPE_MAP: {
    tiktok: 'short_form_video',
    instagram_reel: 'short_form_video',
    facebook: 'carousel',
    whatsapp_status: 'whatsapp_status',
  },
};

const contentIntelligenceService = {
  // ═══════════════════════════════════════════════════════════════════════════════════
  // SINGLE PIECE GENERATION
  // ═══════════════════════════════════════════════════════════════════════════════════

  async generateSinglePiece({
    painCategory = 'general',
    platform = 'tiktok',
    pillar = 'pain_point',
    contentType = null, // Auto-detect if null
    generationMode = 'manual',
  }) {
    // Auto-detect content type if not provided
    const type = contentType || GENERATION_STRATEGY.CONTENT_TYPE_MAP[platform] || 'short_form_video';

    let generatedContent = {};
    const claudeModel = type === 'short_form_video' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';

    try {
      // Generate content based on type
      if (type === 'short_form_video') {
        generatedContent = await claudeContentClient.generateShortFormScript({
          painCategory,
          platform,
          pillar,
        });
      } else if (type === 'carousel') {
        generatedContent = await claudeContentClient.generateCarousel({
          painCategory,
          platform,
          pillar,
        });
      } else if (type === 'whatsapp_status') {
        generatedContent = await claudeContentClient.generateWhatsAppStatus({
          painCategory,
          pillar,
        });
      } else if (type === 'caption_post') {
        generatedContent = await claudeContentClient.generateCaption({
          painCategory,
          platform,
          pillar,
        });
      }

      // Generate CTA
      const ctaResult = await claudeContentClient.generatePlatformCTA({
        platform,
        funnelTarget: pillar === 'conversion_cta' ? 'telegram' : pillar === 'academy' ? 'academy' : 'telegram',
        painCategory,
      });

      // Generate hook variants (for admin to choose from)
      const hookVariants = await claudeContentClient.generateHookVariants({
        painCategory,
        platform,
        pillar,
        count: 3,
      });

      // Use the first hook variant
      const hook = hookVariants.hooks[0].text;

      // Optionally localize with Naija tone (skip for Haiku to save tokens)
      let naijaTone = null;
      if (type === 'short_form_video' && Math.random() > 0.5) {
        // 50% of the time, add Naija tone to scripts
        const scriptText = generatedContent.problem_setup || generatedContent.hook || '';
        naijaTone = await claudeContentClient.localizeWithNaijaTone(scriptText, {
          platform,
          urgency: pillar === 'conversion_cta' ? 'high' : 'medium',
        });
      }

      // Prepare body (JSON format depends on content type)
      let body = {};
      if (type === 'short_form_video') {
        body = {
          hook: generatedContent.hook,
          problem_setup: generatedContent.problem_setup,
          agitate: generatedContent.agitate,
          solution_reveal: generatedContent.solution_reveal,
          script_sections: generatedContent.script_sections,
        };
      } else if (type === 'carousel') {
        body = generatedContent; // Already structured
      } else if (type === 'whatsapp_status' || type === 'caption_post') {
        body = {
          status_text: generatedContent.status_text,
          body: generatedContent.body,
        };
      }

      // Create content piece in database
      const contentPiece = await prisma.contentPiece.create({
        data: {
          batchDate: this._getTodayWAT(),
          pillar,
          painCategory,
          platform,
          contentType: type,
          hook: generatedContent.hook || generatedContent.status_text || generatedContent.body || 'Untitled',
          body: JSON.stringify(body),
          cta: ctaResult.primary_cta || 'DM us on Telegram',
          telegramCta: 'DM START on Telegram for your free diagnosis',
          hashtags: JSON.stringify(generatedContent.hashtags || ['#skincare', '#nigerian', '#micahskin']),
          naijaTone,
          claudeModel,
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

  // ═══════════════════════════════════════════════════════════════════════════════════
  // DAILY BATCH GENERATION
  // ═══════════════════════════════════════════════════════════════════════════════════

  async generateDailyBatch({ date = null, count = 10 } = {}) {
    const batchDate = date || this._getTodayWAT();

    // Check if batch already exists for today
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

    // Generate pieces across platforms and pillars
    const platforms = Object.keys(GENERATION_STRATEGY.PLATFORM_DISTRIBUTION);
    const platformCounts = GENERATION_STRATEGY.PLATFORM_DISTRIBUTION;

    for (const platform of platforms) {
      const platformCount = platformCounts[platform];

      for (let i = 0; i < platformCount; i++) {
        try {
          // Pick pillar (rotate through the strategy)
          const pillarIndex = (generatedPieces.length + i) % GENERATION_STRATEGY.PILLAR_DISTRIBUTION.length;
          const pillar = GENERATION_STRATEGY.PILLAR_DISTRIBUTION[pillarIndex];

          // Pick pain category (rotate through categories for diversity)
          const categoryIndex = generatedPieces.length % allCategories.length;
          const painCategory = allCategories[categoryIndex].id;

          console.log(`Generating: ${platform} - ${pillar} - ${painCategory}`);

          const piece = await this.generateSinglePiece({
            painCategory,
            platform,
            pillar,
            generationMode: 'auto',
          });

          generatedPieces.push(piece);
          console.log(`✓ Generated piece ${generatedPieces.length}/${count}`);
        } catch (error) {
          failureCount++;
          console.error(`✗ Failed to generate ${platform} piece:`, error.message);

          // Continue with next piece instead of failing the entire batch
          if (failureCount > 3) {
            console.warn('Too many failures, stopping batch generation');
            break;
          }
        }
      }
    }

    return {
      success: true,
      batchDate,
      generated: generatedPieces.length,
      failed: failureCount,
      pieces: generatedPieces,
    };
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // QUEUE & RETRIEVAL
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getDailyQueue({ date = null } = {}) {
    const batchDate = date || this._getTodayWAT();

    const queue = await prisma.contentPiece.findMany({
      where: { batchDate },
      orderBy: [{ pillar: 'asc' }, { createdAt: 'desc' }],
    });

    return queue;
  },

  async getContentPiece(pieceId) {
    return prisma.contentPiece.findUnique({
      where: { id: pieceId },
    });
  },

  async listContentPieces({ status = null, platform = null, limit = 50, offset = 0 } = {}) {
    const where = {};
    if (status) where.status = status;
    if (platform) where.platform = platform;

    return prisma.contentPiece.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // STATUS & PERFORMANCE TRACKING
  // ═══════════════════════════════════════════════════════════════════════════════════

  async updateContentStatus(pieceId, newStatus) {
    if (!['draft', 'approved', 'scheduled', 'posted', 'archived'].includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }

    return prisma.contentPiece.update({
      where: { id: pieceId },
      data: { status: newStatus, updatedAt: new Date() },
    });
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
    const piece = await prisma.contentPiece.update({
      where: { id: pieceId },
      data: { isWinning: true },
    });

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

  // ═══════════════════════════════════════════════════════════════════════════════════
  // STATISTICS & ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getContentStats({ days = 30 } = {}) {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const pieces = await prisma.contentPiece.findMany({
      where: {
        createdAt: { gte: sinceDate },
      },
    });

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

    // Top performers by views
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

  // ═══════════════════════════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════════════

  // Get today's date in WAT (West Africa Time = UTC+1)
  _getTodayWAT() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const wat = new Date(utc + 1 * 60 * 60000); // UTC+1

    // Return as YYYY-MM-DD string
    const year = wat.getFullYear();
    const month = String(wat.getMonth() + 1).padStart(2, '0');
    const day = String(wat.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // Utility: Get random pain category
  getRandomPainCategory() {
    const categories = painPointService.getAllCategories();
    return categories[Math.floor(Math.random() * categories.length)].id;
  },

  // Utility: Get all pain categories for dropdown options
  getAllPainCategories() {
    return painPointService.getAllCategories();
  },

  // Utility: Get all pillars
  getAllPillars() {
    return [
      { id: 'pain_point', label: 'Pain Point' },
      { id: 'academy', label: 'Academy' },
      { id: 'growth_os', label: 'Growth OS' },
      { id: 'authority', label: 'Authority' },
      { id: 'conversion_cta', label: 'Conversion CTA' },
    ];
  },

  // Utility: Get all platforms
  getAllPlatforms() {
    return [
      { id: 'tiktok', label: 'TikTok' },
      { id: 'instagram_reel', label: 'Instagram Reels' },
      { id: 'facebook', label: 'Facebook' },
      { id: 'whatsapp_status', label: 'WhatsApp Status' },
    ];
  },
};

module.exports = contentIntelligenceService;
