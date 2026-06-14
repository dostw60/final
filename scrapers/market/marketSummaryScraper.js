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
   * Fetch complete market summary data
   */
  async fetchMarketSummary() {
    try {
      const cacheKey = 'market_summary';
      const cached = this.cache.get(cacheKey);
      
      // Return cached data if less than 5 seconds old
      if (cached && Date.now() - cached.timestamp < 5000) {
        return cached.data;
      }
      
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
      
      // Cache for 5 seconds
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
    const stocks = await getAllStocks();
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
}

module.exports = new MarketSummaryScraper();