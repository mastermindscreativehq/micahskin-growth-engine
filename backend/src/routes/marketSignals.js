// Market Signal Routes
// Comment Intelligence Pipeline — audience psychology ingestion and analysis API.

const express = require('express');
const controller = require('../controllers/marketSignalController');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.use(requireAuth);

// Ingestion
router.post('/ingest', controller.ingestSignal);
router.post('/analyze-pending', controller.analyzePending);
router.post('/:id/analyze', controller.analyzeSignal);

// Retrieval
router.get('/', controller.listSignals);
router.get('/stats', controller.getStats);
router.get('/insights', controller.getInsights);
router.get('/heatmap', controller.getHeatmap);
router.get('/timeline', controller.getTimeline);
router.get('/phrases', controller.getTopPhrases);

module.exports = router;
