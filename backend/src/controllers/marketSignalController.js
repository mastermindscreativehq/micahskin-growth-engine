// Market Signal Controller
// HTTP request handlers for the Comment Intelligence Pipeline API.

const marketSignalService = require('../services/marketSignalService');

const marketSignalController = {
  async ingestSignal(req, res) {
    try {
      const { rawText, source, sourceId, sourceUrl, author, postedAt, analyzeNow = false } = req.body;
      if (!rawText || !rawText.trim()) {
        return res.status(400).json({ success: false, message: 'rawText is required' });
      }
      if (!source) {
        return res.status(400).json({ success: false, message: 'source is required' });
      }

      const signal = analyzeNow
        ? await marketSignalService.ingestAndAnalyze({ rawText, source, sourceId, sourceUrl, author, postedAt })
        : await marketSignalService.ingestRaw({ rawText, source, sourceId, sourceUrl, author, postedAt });

      return res.status(201).json({ success: true, data: signal });
    } catch (err) {
      console.error('ingestSignal error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async analyzeSignal(req, res) {
    try {
      const { id } = req.params;
      const signal = await marketSignalService.analyzeSignal(id);
      return res.json({ success: true, data: signal });
    } catch (err) {
      console.error('analyzeSignal error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async analyzePending(req, res) {
    try {
      const { limit = 10 } = req.body;
      const results = await marketSignalService.analyzePending(Math.min(Number(limit), 25));
      return res.json({ success: true, data: results, processed: results.length });
    } catch (err) {
      console.error('analyzePending error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async listSignals(req, res) {
    try {
      const { source, status, nicheCategory, audienceSegment, limit = 50, offset = 0 } = req.query;
      const signals = await marketSignalService.listSignals({
        source, status, nicheCategory, audienceSegment,
        limit: Number(limit), offset: Number(offset),
      });
      return res.json({ success: true, data: signals, count: signals.length });
    } catch (err) {
      console.error('listSignals error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async getInsights(req, res) {
    try {
      const insights = await marketSignalService.getInsights();
      return res.json({ success: true, data: insights });
    } catch (err) {
      console.error('getInsights error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async getHeatmap(req, res) {
    try {
      const heatmap = await marketSignalService.getAudienceHeatmap();
      return res.json({ success: true, data: heatmap });
    } catch (err) {
      console.error('getHeatmap error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async getTimeline(req, res) {
    try {
      const { hours = 72 } = req.query;
      const timeline = await marketSignalService.getTimeline(Number(hours));
      return res.json({ success: true, data: timeline, count: timeline.length });
    } catch (err) {
      console.error('getTimeline error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async getTopPhrases(req, res) {
    try {
      const { type = 'pain_point', limit = 20, nicheCategory } = req.query;
      const phrases = await marketSignalService.getTopPhrasesByType(type, Number(limit), nicheCategory || null);
      return res.json({ success: true, data: phrases });
    } catch (err) {
      console.error('getTopPhrases error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async getStats(req, res) {
    try {
      const stats = await marketSignalService.getStats();
      return res.json({ success: true, data: stats });
    } catch (err) {
      console.error('getStats error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = marketSignalController;
