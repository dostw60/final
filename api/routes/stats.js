// api/routes/stats.js
const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { cacheMiddleware } = require('../middleware/cache');

// Market statistics
router.get('/market', cacheMiddleware(300), statsController.getMarketStats);

// Trading volume stats
router.get('/volume', statsController.getVolumeStats);

// Most active stocks
router.get('/most-active', statsController.getMostActiveStocks);

// Gainers and losers
router.get('/gainers', statsController.getGainers);
router.get('/losers', statsController.getLosers);

// Sector performance
router.get('/sectors', statsController.getSectorPerformance);

// Historical benchmarks
router.get('/benchmarks', statsController.getBenchmarks);

// Custom reports
router.post('/reports/custom', statsController.generateCustomReport);

module.exports = router;