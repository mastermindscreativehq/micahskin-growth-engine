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

// ═══════════════════════════════════════════════════════════════════════════════════
// STATISTICS & ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════════

router.get('/stats', controller.getStats);

module.exports = router;
