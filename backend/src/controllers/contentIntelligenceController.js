// Content Intelligence Controller
// Request handlers for content generation API endpoints

const contentIntelligenceService = require('../services/contentIntelligenceService');
const hookLibraryService = require('../services/hookLibraryService');
const painPointService = require('../services/painPointDatabaseService');

const contentIntelligenceController = {
  // ═══════════════════════════════════════════════════════════════════════════════════
  // QUEUE & RETRIEVAL
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getQueue(req, res) {
    try {
      const { date } = req.query;
      const queue = await contentIntelligenceService.getDailyQueue({ date });

      return res.json({
        success: true,
        data: queue,
        count: queue.length,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // GENERATION
  // ═══════════════════════════════════════════════════════════════════════════════════

  async generateSinglePiece(req, res) {
    try {
      const { painCategory, platform, pillar, contentType } = req.body;

      if (!platform) {
        return res.status(400).json({
          success: false,
          message: 'Platform is required',
        });
      }

      const { contentStyle, objective } = req.body;

      const piece = await contentIntelligenceService.generateSinglePiece({
        painCategory: painCategory || 'general',
        platform,
        pillar: pillar || 'pain_point',
        contentType,
        contentStyle: contentStyle || null,
        objective: objective || null,
        generationMode: 'manual',
      });

      return res.status(201).json({
        success: true,
        data: piece,
        message: 'Content piece generated successfully',
      });
    } catch (error) {
      console.error('generateSinglePiece error:', error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  async generateDailyBatch(req, res) {
    try {
      const { date, count } = req.body;

      const result = await contentIntelligenceService.generateDailyBatch({
        date,
        count: count || 10,
      });

      if (result.skipped) {
        return res.status(200).json({
          success: true,
          message: result.message,
          skipped: true,
        });
      }

      return res.status(201).json({
        success: true,
        data: result.pieces,
        generated: result.generated,
        failed: result.failed,
        batchDate: result.batchDate,
      });
    } catch (error) {
      console.error('generateDailyBatch error:', error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // STATUS MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════════

  async updateContentStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({
          success: false,
          message: 'Status is required',
        });
      }

      const updated = await contentIntelligenceService.updateContentStatus(id, status);

      return res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  async updateContentPerformance(req, res) {
    try {
      const { id } = req.params;
      const { views, leads, conversions } = req.body;

      const updated = await contentIntelligenceService.updateContentPerformance(id, {
        views,
        leads,
        conversions,
      });

      return res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // HOOK LIBRARY
  // ═══════════════════════════════════════════════════════════════════════════════════

  async saveHook(req, res) {
    try {
      const { id } = req.params;
      const { performanceNote } = req.body;

      const piece = await contentIntelligenceService.markAsWinning(id, performanceNote);

      return res.json({
        success: true,
        data: piece,
        message: 'Hook saved to library',
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getHooks(req, res) {
    try {
      const { platform, pillar, painCategory, limit } = req.query;

      const hooks = await hookLibraryService.getHooks({
        platform,
        pillar,
        painCategory,
        limit: limit ? parseInt(limit) : 50,
      });

      return res.json({
        success: true,
        data: hooks,
        count: hooks.length,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  async deactivateHook(req, res) {
    try {
      const { id } = req.params;

      const deactivated = await hookLibraryService.deactivateHook(id);

      return res.json({
        success: true,
        data: deactivated,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // PAIN CATEGORIES & METADATA
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getMetadata(req, res) {
    try {
      return res.json({
        success: true,
        data: {
          pillars: contentIntelligenceService.getAllPillars(),
          platforms: contentIntelligenceService.getAllPlatforms(),
          painCategories: contentIntelligenceService.getAllPainCategories(),
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async getPainCategories(req, res) {
    try {
      const categories = contentIntelligenceService.getAllPainCategories();

      return res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getPillars(req, res) {
    try {
      const pillars = contentIntelligenceService.getAllPillars();

      return res.json({
        success: true,
        data: pillars,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getPlatforms(req, res) {
    try {
      const platforms = contentIntelligenceService.getAllPlatforms();
      return res.json({ success: true, data: platforms });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async getContentStyles(req, res) {
    try {
      return res.json({ success: true, data: contentIntelligenceService.getAllContentStyles() });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  async getObjectives(req, res) {
    try {
      return res.json({ success: true, data: contentIntelligenceService.getAllObjectives() });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════════════════════════════════════════════

  async getStats(req, res) {
    try {
      const { days } = req.query;

      const stats = await contentIntelligenceService.getContentStats({
        days: days ? parseInt(days) : 30,
      });

      return res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
};

module.exports = contentIntelligenceController;
