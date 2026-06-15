// scrapers/market/marketSummaryScraper.js
const axios = require('axios');
const { withRetry } = require('../../utils/retry');
const logger = require('../../utils/logger');

class MarketSummaryScraper {
  constructor() {
    this.MARKET_SUMMARY_API = 'https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary';
    this.cache = new Map();
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
   * Fetch complete market summary data
   */
  async fetchMarketSummary(forceFresh = false) {
    try {
      const cacheKey = 'market_summary';
      const cached = this.cache.get(cacheKey);
      const cacheTTL = this.getCacheTTL();
      
      // Return cached data if not expired and not forcing fresh
      if (!forceFresh && cached && Date.now() - cached.timestamp < cacheTTL) {
        logger.debug('Returning cached market summary');
        return cached.data;
      }
      
      logger.debug('Fetching fresh market summary from API');
      
      const response = await withRetry(
        () => axios.get(this.MARKET_SUMMARY_API, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Referer': 'https://www.merolagani.com/'
          }
        }),
        { retries: 2, delay: 1000 }
      );
      
      const data = response.data;
      
      this.cache.set(cacheKey, {
        data: data,
        timestamp: Date.now()
      });
      
      return data;
      
    } catch (error) {
      logger.error('Failed to fetch market summary:', error);
      throw error;
    }
  }

  /**
   * Get overall market statistics
   */
  async getOverallStats() {
    const data = await this.fetchMarketSummary();
    return data.overall;
  }

  /**
   * Get turnover leaders (top performing stocks by turnover)
   */
  async getTurnoverLeaders(limit = 10) {
    const data = await this.fetchMarketSummary();
    const turnover = data.turnover?.detail || [];
    return turnover.slice(0, limit);
  }

  /**
   * Get sector-wise performance
   */
  async getSectorPerformance() {
    const data = await this.fetchMarketSummary();
    return data.sector?.detail || [];
  }

  /**
   * Get broker-wise performance
   */
  async getBrokerPerformance() {
    const data = await this.fetchMarketSummary();
    return data.broker?.detail || [];
  }

  /**
   * Get all stocks data
   */
  async getAllStocks() {
    const data = await this.fetchMarketSummary();
    return data.stock?.detail || [];
  }

  /**
   * Get specific stock data
   */
  async getStockBySymbol(symbol) {
    const stocks = await this.getAllStocks();
    return stocks.find(stock => stock.s === symbol.toUpperCase());
  }

  /**
   * Get top gainers
   */
  async getTopGainers(limit = 10) {
    const stocks = await this.getAllStocks();
    return stocks
      .filter(stock => stock.c > 0)
      .sort((a, b) => b.c - a.c)
      .slice(0, limit);
  }

  /**
   * Get top losers
   */
  async getTopLosers(limit = 10) {
    const stocks = await this.getAllStocks();
    return stocks
      .filter(stock => stock.c < 0)
      .sort((a, b) => a.c - b.c)
      .slice(0, limit);
  }

  /**
   * Get most active stocks by volume
   */
  async getMostActive(limit = 10) {
    const stocks = await this.getAllStocks();
    return stocks
      .sort((a, b) => b.q - a.q)
      .slice(0, limit);
  }

  /**
   * Clear cache (useful for manual refresh)
   */
  clearCache() {
    this.cache.clear();
    logger.info('Market summary cache cleared');
  }
}

module.exports = new MarketSummaryScraper();