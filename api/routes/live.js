// api/routes/live.js
const express = require('express');
const router = express.Router();
const livePriceScraper = require('../../scrapers/market/livePriceScraper');
const cache = require('../../services/redisCache');
const logger = require('../../utils/logger');

// Get all live prices
router.get('/prices', async (req, res) => {
  try {
    const prices = await livePriceScraper.getCurrentPrices();
    res.json({
      success: true,
      count: prices.length,
      data: prices,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching live prices:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single stock live price
router.get('/price/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const price = await livePriceScraper.getStockPrice(symbol);
    
    if (!price) {
      return res.status(404).json({ error: 'Stock not found' });
    }
    
    res.json({
      success: true,
      data: price,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error fetching price for ${req.params.symbol}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get top gainers
router.get('/gainers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const gainers = await livePriceScraper.getTopGainers(limit);
    
    res.json({
      success: true,
      count: gainers.length,
      data: gainers,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching gainers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get top losers
router.get('/losers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const losers = await livePriceScraper.getTopLosers(limit);
    
    res.json({
      success: true,
      count: losers.length,
      data: losers,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching losers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get most active stocks
router.get('/active', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const active = await livePriceScraper.getMostActive(limit);
    
    res.json({
      success: true,
      count: active.length,
      data: active,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching active stocks:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get market summary
router.get('/summary', async (req, res) => {
  try {
    const summary = await livePriceScraper.getMarketSummary();
    
    res.json({
      success: true,
      data: summary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching market summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// WebSocket endpoint for real-time streaming
router.ws('/stream', (ws, req) => {
  logger.info('New WebSocket client connected for live prices');
  
  // Send initial data
  livePriceScraper.getCurrentPrices().then(prices => {
    ws.send(JSON.stringify({
      type: 'init',
      data: prices,
      timestamp: new Date().toISOString()
    }));
  });
  
  // Subscribe to live updates
  const updateHandler = (update) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(update));
    }
  };
  
  // Start streaming if not already
  if (!livePriceScraper.isWatching) {
    livePriceScraper.startLiveStream(updateHandler);
  } else {
    // Attach handler to existing stream
    livePriceScraper.on('update', updateHandler);
  }
  
  ws.on('close', () => {
    logger.info('WebSocket client disconnected');
    // Remove handler
    livePriceScraper.removeListener('update', updateHandler);
  });
});

module.exports = router;