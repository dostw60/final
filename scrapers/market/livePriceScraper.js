// scrapers/market/livePriceScraper.js
const axios = require('axios');
const { withRetry } = require('../../utils/retry');
const logger = require('../../utils/logger');

class NEPSEPriceScraper {
  constructor() {
    // MeroLagani API endpoints (working sources)
    this.MEROLAGANI_MARKET_API = 'https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary';
    this.MEROLAGANI_LIVE_API = 'https://www.merolagani.com/Handlers/GetLiveMarketDataHandler.ashx';
    
    // Simple in-memory cache (no Redis required)
    this.cache = new Map();
    
    // Rate limiting
    this.requestDelay = parseInt(process.env.SCRAPE_RATE_LIMIT_MS) || 2000;
    this.lastRequestTime = 0;
    
    // Market hours tracking
    this.isWatching = false;
    this.updateInterval = null;
  }

  /**
   * Check if market is currently open
   */
  isMarketOpen() {
    const now = new Date();
    const nepalTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
    const hour = nepalTime.getHours();
    const day = nepalTime.getDay(); // 0 = Sunday, 1-4 = weekdays, 6 = Saturday
    
    // Market open: Sunday to Thursday (0-4), 11 AM to 3 PM
    const isWeekday = day >= 0 && day <= 4;
    const isTradingHour = hour >= 11 && hour <= 15;
    
    return isWeekday && isTradingHour;
  }

  /**
   * Get cache TTL based on market hours
   */
  getCacheTTL() {
    return this.isMarketOpen() ? 2000 : 30000; // 2 seconds during market, 30 seconds when closed
  }

  /**
   * Get current live prices for all active stocks
   */
  async getCurrentPrices(forceFresh = false) {
    try {
      // Check cache first
      const cacheKey = 'live_prices_all';
      const cached = this.cache.get(cacheKey);
      const cacheTTL = this.getCacheTTL();
      
      if (!forceFresh && cached && Date.now() - cached.timestamp < cacheTTL) {
        logger.debug('Returning cached live prices');
        return cached.data;
      }
      
      // Rate limiting
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.requestDelay) {
        await new Promise(resolve => 
          setTimeout(resolve, this.requestDelay - timeSinceLastRequest)
        );
      }
      
      this.lastRequestTime = Date.now();
      
      // Fetch from market summary (most reliable source)
      const liveData = await withRetry(
        () => this.fetchFromMarketSummary(),
        { 
          retries: 2, 
          delay: 1000,
          onRetry: (error, attempt) => {
            logger.warn(`Retry ${attempt} for live prices: ${error.message}`);
          }
        }
      );
      
      const normalized = this.normalizeLiveData(liveData);
      
      // Cache the results
      this.cache.set(cacheKey, {
        data: normalized,
        timestamp: Date.now()
      });
      
      return normalized;
      
    } catch (error) {
      logger.error('Failed to fetch live prices:', error);
      return [];
    }
  }

  /**
   * Fetch from MeroLagani Market Summary (most reliable)
   */
  async fetchFromMarketSummary() {
    const response = await axios.get(this.MEROLAGANI_MARKET_API, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.data || !response.data.stock) {
      throw new Error('Invalid response from market summary API');
    }
    
    return response.data.stock?.detail || [];
  }

  /**
   * Fetch from MeroLagani Live API (backup)
   */
  async fetchFromMeroLaganiLive() {
    const response = await axios.get(this.MEROLAGANI_LIVE_API, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
    
    return response.data;
  }

  /**
   * Normalize live price data from different sources
   */
  normalizeLiveData(rawData) {
    const normalized = [];
    
    for (const item of rawData) {
      // Extract symbol from various possible field names
      const symbol = (item.s || item.symbol || item.ticker || item.scrip || '').toUpperCase();
      if (!symbol) continue;
      
      const livePrice = {
        symbol: symbol,
        last_traded_price: this.parseNumeric(item.lp || item.LTP || item.close || item.price || 0),
        change: this.parseNumeric(item.c || item.change || item.netChange || 0),
        percent_change: this.parseNumeric(item.pc || item.percentChange || item.changePercent || 0),
        volume: parseInt(item.q || item.volume || item.tradedShares || item.vol || 0),
        turnover: this.parseNumeric(item.t || item.turnover || item.amount || 0),
        high: this.parseNumeric(item.h || item.high || item.dayHigh || 0),
        low: this.parseNumeric(item.l || item.low || item.dayLow || 0),
        open: this.parseNumeric(item.op || item.open || item.openPrice || 0),
        previous_close: this.parseNumeric(item.pc || item.previousClose || item.prevClose || 0),
        timestamp: new Date().toISOString()
      };
      
      // Only include if we have a valid price
      if (livePrice.last_traded_price > 0) {
        normalized.push(livePrice);
      }
    }
    
    return normalized;
  }

  /**
   * Get live price for specific symbol
   */
  async getStockPrice(symbol) {
    try {
      const cacheKey = `live_price_${symbol.toUpperCase()}`;
      const cached = this.cache.get(cacheKey);
      const cacheTTL = this.getCacheTTL();
      
      if (cached && Date.now() - cached.timestamp < cacheTTL) {
        return cached.data;
      }
      
      const allPrices = await this.getCurrentPrices();
      const stockPrice = allPrices.find(p => p.symbol === symbol.toUpperCase());
      
      if (stockPrice) {
        this.cache.set(cacheKey, {
          data: stockPrice,
          timestamp: Date.now()
        });
      }
      
      return stockPrice || null;
      
    } catch (error) {
      logger.error(`Failed to fetch price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get top gainers
   */
  async getTopGainers(limit = 10) {
    const prices = await this.getCurrentPrices();
    
    const gainers = prices
      .filter(p => p.percent_change > 0)
      .sort((a, b) => b.percent_change - a.percent_change)
      .slice(0, limit);
    
    return gainers;
  }

  /**
   * Get top losers
   */
  async getTopLosers(limit = 10) {
    const prices = await this.getCurrentPrices();
    
    const losers = prices
      .filter(p => p.percent_change < 0)
      .sort((a, b) => a.percent_change - b.percent_change)
      .slice(0, limit);
    
    return losers;
  }

  /**
   * Get most active stocks by volume
   */
  async getMostActive(limit = 10) {
    const prices = await this.getCurrentPrices();
    
    const active = prices
      .sort((a, b) => b.volume - a.volume)
      .slice(0, limit);
    
    return active;
  }

  /**
   * Get market summary
   */
  async getMarketSummary() {
    const prices = await this.getCurrentPrices();
    
    if (prices.length === 0) {
      return {
        total_stocks: 0,
        total_volume: 0,
        total_turnover: 0,
        advancing: 0,
        declining: 0,
        unchanged: 0,
        avg_change: 0,
        market_open: this.isMarketOpen()
      };
    }
    
    const summary = {
      total_stocks: prices.length,
      total_volume: prices.reduce((sum, p) => sum + p.volume, 0),
      total_turnover: prices.reduce((sum, p) => sum + p.turnover, 0),
      advancing: prices.filter(p => p.change > 0).length,
      declining: prices.filter(p => p.change < 0).length,
      unchanged: prices.filter(p => p.change === 0).length,
      avg_change: (prices.reduce((sum, p) => sum + p.percent_change, 0) / prices.length).toFixed(2),
      market_open: this.isMarketOpen(),
      timestamp: new Date().toISOString()
    };
    
    return summary;
  }

  /**
   * Start polling for live updates
   */
  startLiveUpdates(callback, intervalMs = 3000) {
    if (this.isWatching) {
      logger.warn('Live updates already running');
      return;
    }
    
    logger.info(`Starting live updates every ${intervalMs}ms`);
    this.isWatching = true;
    
    this.updateInterval = setInterval(async () => {
      if (!this.isWatching) return;
      
      // Only update during market hours
      if (this.isMarketOpen()) {
        try {
          const prices = await this.getCurrentPrices(true); // Force fresh
          if (callback && typeof callback === 'function') {
            callback({
              type: 'live_update',
              data: prices,
              market_open: true,
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          logger.error('Live update failed:', error);
        }
      }
    }, intervalMs);
  }

  /**
   * Stop live updates
   */
  stopLiveUpdates() {
    logger.info('Stopping live updates...');
    this.isWatching = false;
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Clear cache (useful for manual refresh)
   */
  clearCache() {
    this.cache.clear();
    logger.info('Live price cache cleared');
  }

  /**
   * Parse numeric values safely
   */
  parseNumeric(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return isNaN(value) ? 0 : value;
    
    const cleaned = String(value).replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }
}

module.exports = new NEPSEPriceScraper();