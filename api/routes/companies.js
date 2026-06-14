// api/routes/companies.js (Enhanced)
const express = require('express');
const router = express.Router();
const companyScraper = require('../../scrapers/company/companyScraper');
const symbolMapper = require('../../scrapers/company/symbolMapper');
const cache = require('../../services/redisCache');
const logger = require('../../utils/logger');

// Get all companies
router.get('/', async (req, res) => {
  try {
    const { sector, search, limit = 100, offset = 0, active = 'true' } = req.query;
    
    const filters = {
      sector,
      search,
      limit: parseInt(limit),
      offset: parseInt(offset),
      is_active: active === 'true'
    };
    
    const cacheKey = `companies:list:${JSON.stringify(filters)}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    
    const companies = await companyScraper.getAllCompanies(filters);
    
    await cache.setex(cacheKey, 3600, JSON.stringify(companies));
    
    res.json({
      success: true,
      ...companies,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Error fetching companies:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get company by symbol
router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    // First validate and map symbol
    const mappedSymbol = await symbolMapper.validateSymbol(symbol);
    if (!mappedSymbol) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    const cacheKey = `company:${mappedSymbol}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    
    const company = await companyScraper.getCompanyBySymbol(mappedSymbol);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Get symbol variations
    const variations = await symbolMapper.getSymbolVariations(mappedSymbol);
    company.symbol_variations = variations;
    
    await cache.setex(cacheKey, 3600, JSON.stringify(company));
    
    res.json({
      success: true,
      data: company,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Error fetching company ${req.params.symbol}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get sector breakdown
router.get('/meta/sectors', async (req, res) => {
  try {
    const cacheKey = 'companies:sectors';
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    
    const sectors = await companyScraper.getSectorBreakdown();
    
    await cache.setex(cacheKey, 86400, JSON.stringify({
      success: true,
      data: sectors,
      timestamp: new Date().toISOString()
    }));
    
    res.json({
      success: true,
      data: sectors,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Error fetching sector breakdown:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update company status
router.patch('/:symbol/status', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { is_active } = req.body;
    
    const result = await companyScraper.updateCompanyStatus(symbol, is_active);
    
    if (!result) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Clear cache
    await cache.del(`company:${symbol.toUpperCase()}`);
    await cache.del('companies:list:*');
    
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Error updating company status for ${req.params.symbol}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Map a symbol (utility endpoint)
router.post('/map-symbol', async (req, res) => {
  try {
    const { symbol } = req.body;
    
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol required' });
    }
    
    const mapping = await symbolMapper.mapSymbol(symbol);
    
    res.json({
      success: true,
      data: mapping,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Error mapping symbol:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add custom symbol mapping
router.post('/mappings', async (req, res) => {
  try {
    const { original_symbol, mapped_symbol, confidence } = req.body;
    
    if (!original_symbol || !mapped_symbol) {
      return res.status(400).json({ error: 'original_symbol and mapped_symbol required' });
    }
    
    const result = await symbolMapper.addMapping(original_symbol, mapped_symbol, confidence);
    
    if (result) {
      // Clear cache
      await cache.flush();
    }
    
    res.json({
      success: result,
      message: result ? 'Mapping added successfully' : 'Failed to add mapping',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Error adding symbol mapping:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger to scrape companies
router.post('/scrape', async (req, res) => {
  try {
    const { force_refresh = false } = req.body;
    
    const result = await companyScraper.fetchAllCompanies(force_refresh);
    
    // Clear cache
    await cache.flush();
    
    res.json({
      success: result.success,
      message: `Processed ${result.count || 0} companies`,
      data: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Error triggering company scrape:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;