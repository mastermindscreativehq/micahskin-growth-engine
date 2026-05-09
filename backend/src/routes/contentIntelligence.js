// Content Intelligence Routes
// API endpoints for content generation, management, and analytics

const express = require('express');
const controller = require('../controllers/contentIntelligenceController');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════════════════════════════
// CONTENT QUEUE & RETRIEVAL
// ═══════════════════════════════════════════════════════════════════════════════════

router.get('/queue', controller.getQueue);
router.get('/queue/:date', controller.getQueue);

// ═══════════════════════════════════════════════════════════════════════════════════
// CONTENT GENERATION
// ═══════════════════════════════════════════════════════════════════════════════════

router.post('/generate', controller.generateSinglePiece);
router.post('/generate-batch', controller.generateDailyBatch);

// ═══════════════════════════════════════════════════════════════════════════════════
// CONTENT STATUS & PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════════════

router.patch('/:id/status', controller.updateContentStatus);
router.patch('/:id/performance', controller.updateContentPerformance);

// ═══════════════════════════════════════════════════════════════════════════════════
// HOOK LIBRARY
// ═══════════════════════════════════════════════════════════════════════════════════

router.post('/:id/save-hook', controller.saveHook);
router.get('/hooks', controller.getHooks);
router.delete('/hooks/:id', controller.deactivateHook);

// ═══════════════════════════════════════════════════════════════════════════════════
// METADATA
// ═══════════════════════════════════════════════════════════════════════════════════

router.get('/metadata', controller.getMetadata);
router.get('/categories/pain', controller.getPainCategories);
router.get('/metadata/pillars', controller.getPillars);
router.get('/metadata/platforms', controller.getPlatforms);
router.get('/metadata/styles', controller.getContentStyles);
router.get('/metadata/objectives', controller.getObjectives);

// ═══════════════════════════════════════════════════════════════════════════════════
// STATISTICS & ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════════

router.get('/stats', controller.getStats);

// ═══════════════════════════════════════════════════════════════════════════════════
// PAIN SIGNAL DATABASE
// ═══════════════════════════════════════════════════════════════════════════════════

router.get('/signals', controller.getPainSignals);
router.post('/signals', controller.addPainSignal);
router.delete('/signals/:id', controller.deletePainSignal);
router.get('/signals/top', controller.getTopPainSignals);
router.get('/metadata/cta-styles', controller.getCtaStyles);
router.get('/metadata/signal-types', controller.getSignalTypes);
router.get('/metadata/signal-sources', controller.getSignalSources);

// ═══════════════════════════════════════════════════════════════════════════════════
// GENERATION SESSIONS (Phase 40)
// ═══════════════════════════════════════════════════════════════════════════════════

router.get('/sessions', controller.getGenerationSessions);
router.get('/sessions/:id', controller.getGenerationSession);
router.post('/:id/viewed', controller.markViewed);

module.exports = router;
