// api/routes/corporateActions.js
const express = require('express');
const router = express.Router();
const dividendScraper = require('../../scrapers/events/dividendScraper');
const bonusScraper = require('../../scrapers/events/bonusScraper');
const cache = require('../../services/redisCache');
const logger = require('../../utils/logger');

// Get all dividends
router.get('/dividends', async (req, res) => {
  try {
    const { fiscal_year, limit = 50 } = req.query;
    
    const cacheKey = `dividends:${fiscal_year || 'all'}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    
    let dividends;
    if (fiscal_year) {
      dividends = await dividendScraper.getDividendsByFiscalYear(fiscal_year);
    } else {
      dividends = await dividendScraper.getLatestDividends(parseInt(limit));
    }
    
    await cache.setex(cacheKey, 3600, JSON.stringify({
      success: true,
      count: dividends.length,
      data: dividends,
      timestamp: new Date().toISOString()
    }));
    
    res.json({
      success: true,
      count: dividends.length,
      data: dividends,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Error fetching dividends:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get dividends by company
router.get('/dividends/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { limit = 10 } = req.query;
    
    const dividends = await dividendScraper.getDividendsByCompany(symbol, parseInt(limit));
    
    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      count: dividends.length,
      data: dividends,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Error fetching dividends for ${req.params.symbol}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get dividend yield
router.get('/dividends/:symbol/yield', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { price } = req.query;
    
    const yieldData = await dividendScraper.calculateDividendYield(symbol, price);
    
    if (!yieldData) {
      return res.status(404).json({ error: 'No dividend data found' });
    }
    
    res.json({
      success: true,
      data: yieldData,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Error calculating dividend yield for ${req.params.symbol}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get all bonus shares
router.get('/bonus', async (req, res) => {
  try {
    const { fiscal_year, upcoming = false, limit = 50 } = req.query;
    
    let bonusData;
    if (upcoming === 'true') {
      bonusData = await bonusScraper.getUpcomingBonus(parseInt(limit));
    } else if (fiscal_year) {
      bonusData = await bonusScraper.getBonusHistory(fiscal_year);
    } else {
      const result = await bonusScraper.fetchBonusShares(fiscal_year);
      bonusData = result.data || [];
    }
    
    res.json({
      success: true,
      count: bonusData.length,
      data: bonusData,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Error fetching bonus shares:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get bonus by company
router.get('/bonus/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    const bonusData = await bonusScraper.getBonusByCompany(symbol);
    
    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      count: bonusData.length,
      data: bonusData,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Error fetching bonus for ${req.params.symbol}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get bonus statistics by fiscal year
router.get('/bonus/stats/:fiscal_year', async (req, res) => {
  try {
    const { fiscal_year } = req.params;
    
    const stats = await bonusScraper.getTotalBonusShares(fiscal_year);
    const bonuses = await bonusScraper.getBonusHistory(fiscal_year);
    
    res.json({
      success: true,
      fiscal_year,
      statistics: stats,
      top_bonus: bonuses.slice(0, 10),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Error fetching bonus stats for ${req.params.fiscal_year}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger to scrape dividends
router.post('/scrape/dividends', async (req, res) => {
  try {
    const { fiscal_year } = req.body;
    
    const result = await dividendScraper.fetchDividends(fiscal_year);
    
    // Clear cache
    await cache.flush();
    
    res.json({
      success: result.success,
      message: `Processed ${result.count || 0} dividend records`,
      data: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Error triggering dividend scrape:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger to scrape bonus shares
router.post('/scrape/bonus', async (req, res) => {
  try {
    const { fiscal_year } = req.body;
    
    const result = await bonusScraper.fetchBonusShares(fiscal_year);
    
    // Clear cache
    await cache.flush();
    
    res.json({
      success: result.success,
      message: `Processed ${result.count || 0} bonus records`,
      data: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Error triggering bonus scrape:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;