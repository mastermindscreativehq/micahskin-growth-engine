// Content Scheduler Service
// Manages daily batch generation at 6am WAT (05:00 UTC)
// Also handles content scheduling and posting queues

const contentIntelligenceService = require('./contentIntelligenceService');

let dailyPollerInterval = null;
let isPollerRunning = false;

const contentSchedulerService = {
  // ═══════════════════════════════════════════════════════════════════════════════════
  // MAIN POLLER — 6am WAT daily batch generation
  // ═══════════════════════════════════════════════════════════════════════════════════

  async startContentDailyPoller() {
    if (isPollerRunning) {
      console.warn('Content daily poller is already running');
      return;
    }

    console.log('Starting Content Daily Poller (6am WAT = 05:00 UTC)');

    isPollerRunning = true;

    // Check every 5 minutes if it's batch time
    dailyPollerInterval = setInterval(async () => {
      try {
        if (await this._isBatchGenerationTime()) {
          console.log('🚀 Batch generation time triggered (6am WAT)');
          await this._runDailyBatch();
        }
      } catch (error) {
        console.error('Error in daily poller:', error.message);
      }
    }, 5 * 60 * 1000); // Check every 5 minutes

    // Also run immediately on startup to seed today if needed
    setTimeout(async () => {
      try {
        if (await this._isBatchGenerationTime()) {
          console.log('🚀 Running initial batch check on startup');
          await this._runDailyBatch();
        }
      } catch (error) {
        console.error('Error in initial batch run:', error.message);
      }
    }, 2000);
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════════

  // Check if current time is between 05:00 and 05:05 UTC (6am WAT window)
  async _isBatchGenerationTime() {
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();

    // WAT = UTC+1, so 6am WAT = 5am UTC
    // Check if time is 5:00-5:05 UTC (allows 5 minute window for timing variations)
    const isBatchWindow = utcHours === 5 && utcMinutes < 5;

    // Debug log every check (commented out to reduce noise)
    // console.log(`[Batch Time Check] UTC ${utcHours}:${String(utcMinutes).padStart(2, '0')} - IsBatchWindow: ${isBatchWindow}`)

    return isBatchWindow;
  },

  // Run the daily batch generation
  async _runDailyBatch() {
    console.log('▶ Running daily batch generation...');

    try {
      const result = await contentIntelligenceService.generateDailyBatch({
        count: 10, // Generate 10 pieces per day
      });

      if (result.skipped) {
        console.log(`⏭ Batch already exists for today: ${result.message}`);
        return;
      }

      console.log(`✅ Daily batch complete: Generated ${result.generated} pieces`);
      if (result.failed > 0) {
        console.warn(`⚠ ${result.failed} pieces failed to generate`);
      }

      // Optional: Send admin notification
      await this._notifyAdminBatchComplete(result);
    } catch (error) {
      console.error('❌ Daily batch generation failed:', error.message);
      // Optional: Send error alert to admin via Telegram
      await this._notifyAdminBatchFailed(error);
    }
  },

  // Optional: Notify admin via Telegram when batch completes
  async _notifyAdminBatchComplete(result) {
    // This would integrate with your existing Telegram notification system
    // For now, just log
    console.log(`📊 [Admin Alert] Daily batch generated: ${result.generated} pieces for ${result.batchDate}`);
  },

  // Optional: Notify admin when batch fails
  async _notifyAdminBatchFailed(error) {
    // This would integrate with your existing Telegram notification system
    // For now, just log
    console.error(`⚠ [Admin Alert] Batch generation failed: ${error.message}`);
  },

  // Stop the poller
  stopContentDailyPoller() {
    if (dailyPollerInterval) {
      clearInterval(dailyPollerInterval);
      dailyPollerInterval = null;
      isPollerRunning = false;
      console.log('Content Daily Poller stopped');
    }
  },

  // Check if poller is running
  isRunning() {
    return isPollerRunning;
  },

  // Manual trigger for batch generation (useful for testing or recovery)
  async manualTriggerBatch({ date = null, count = 10 } = {}) {
    console.log(`⚡ Manual batch trigger: ${date || 'today'} (${count} pieces)`);
    return contentIntelligenceService.generateDailyBatch({ date, count });
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // CONTENT SCHEDULING (for future use)
  // ═══════════════════════════════════════════════════════════════════════════════════

  // Get content due for posting today
  async getContentDueForPosting() {
    // TODO: Query ContentPiece where scheduledAt <= now() and status == 'scheduled'
    // Return list of pieces ready to post
    return [];
  },

  // Check if content should be posted and post it
  async checkAndPostContent() {
    // TODO: Integrate with Telegram, Instagram, TikTok, Facebook APIs
    // Mark status as 'posted' and update postedAt timestamp
    return null;
  },
};

module.exports = contentSchedulerService;
module.exports.startContentDailyPoller = contentSchedulerService.startContentDailyPoller.bind(contentSchedulerService);
