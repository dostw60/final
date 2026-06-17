// scrapers/market/livePriceScraper.js
const axios = require('axios');
const { withRetry } = require('../../utils/retry');

class NEPSEPriceScraper {
  constructor() {
    this.MEROLAGANI_MARKET_API = 'https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary';
    this.cache = new Map();
    this.requestDelay = 2000;
    this.lastRequestTime = 0;
    this.marketStatus = {
      open: false,
      lastChecked: null,
      dayName: '',
      currentTime: ''
    };
  }

  // ============ MARKET STATUS METHODS ============
  isMarketOpen() {
    try {
      const now = new Date();
      const nepalTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
      
      const day = nepalTime.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
      const hours = nepalTime.getHours();
      const minutes = nepalTime.getMinutes();
      const currentTime = hours + minutes / 60;
      
      // FIX: Monday (1) to Friday (5) are trading days
      const isWeekday = day >= 1 && day <= 5;
      
      // Trading hours: 11:00 AM to 3:00 PM (15:00)
      const isTradingHour = currentTime >= 11 && currentTime < 15;
      
      const isOpen = isWeekday && isTradingHour;
      
      // Update market status for debugging
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      this.marketStatus = {
        open: isOpen,
        lastChecked: nepalTime,
        dayName: dayNames[day],
        dayNumber: day,
        hours: hours,
        minutes: minutes,
        isWeekday: isWeekday,
        isTradingHour: isTradingHour,
        currentTime: nepalTime.toLocaleString(),
        timezone: 'Asia/Kathmandu'
      };
      
      return isOpen;
      
    } catch (error) {
      console.error('Error checking market status:', error);
      return false;
    }
  }

  // Get detailed market status for debugging
  getMarketStatus() {
    this.isMarketOpen(); // Update status
    return {
      ...this.marketStatus,
      message: this.marketStatus.open ? '✅ Market is OPEN for trading' : '❌ Market is CLOSED',
      trading_hours: '11:00 AM - 3:00 PM (Nepal Time)',
      trading_days: 'Monday - Friday'
    };
  }

  getCacheTTL() {
    return this.isMarketOpen() ? 2000 : 30000;
  }

  // ============ PRICE FETCHING METHODS ============
  async getCurrentPrices(forceFresh = false) {
    try {
      const cacheKey = 'live_prices_all';
      const cached = this.cache.get(cacheKey);
      const cacheTTL = this.getCacheTTL();
      
      if (!forceFresh && cached && Date.now() - cached.timestamp < cacheTTL) {
        return cached.data;
      }
      
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.requestDelay) {
        await new Promise(resolve => 
          setTimeout(resolve, this.requestDelay - timeSinceLastRequest)
        );
      }
      
      this.lastRequestTime = Date.now();
      
      const liveData = await withRetry(
        () => this.fetchFromMarketSummary(),
        { retries: 2, delay: 1000 }
      );
      
      const normalized = this.normalizeLiveData(liveData);
      
      this.cache.set(cacheKey, {
        data: normalized,
        timestamp: Date.now()
      });
      
      return normalized;
      
    } catch (error) {
      console.error('Failed to fetch live prices:', error.message);
      return [];
    }
  }

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
    
    return response.data;
  }

  normalizeLiveData(rawData) {
    const normalized = [];
    const stocks = rawData.stock?.detail || [];
    const turnoverData = rawData.turnover?.detail || [];
    
    // Create maps for additional data
    const turnoverMap = new Map();
    for (const item of turnoverData) {
      turnoverMap.set(item.s, item);
    }
    
    for (const item of stocks) {
      const symbol = (item.s || '').toUpperCase();
      if (!symbol) continue;
      
      const extraData = turnoverMap.get(symbol) || {};
      
      // Get core price data
      const lastPrice = this.parseNumeric(item.lp || 0);
      const change = this.parseNumeric(item.c || 0);
      
      // Calculate percent change correctly
      let percentChange = this.parseNumeric(item.pc || 0);
      if (percentChange === 0 && change !== 0 && lastPrice !== 0) {
        const prevClose = lastPrice - change;
        if (prevClose > 0) {
          percentChange = (change / prevClose) * 100;
        }
      }
      
      // Get previous close (from extraData or calculate)
      let previousClose = this.parseNumeric(extraData.pc || 0);
      if (previousClose === 0 && lastPrice !== 0 && change !== 0) {
        previousClose = lastPrice - change;
      }
      
      // Get open price (from extraData or use previous close)
      let openPrice = this.parseNumeric(extraData.op || item.op || 0);
      if (openPrice === 0 && previousClose !== 0) {
        openPrice = previousClose;
      }
      
      const livePrice = {
        symbol: symbol,
        last_traded_price: lastPrice,
        change: change,
        percent_change: parseFloat(percentChange.toFixed(2)),
        volume: parseInt(item.q || extraData.q || 0),
        turnover: this.parseNumeric(extraData.t || item.t || 0),
        high: this.parseNumeric(extraData.h || item.h || 0),
        low: this.parseNumeric(extraData.l || item.l || 0),
        open: openPrice,
        previous_close: previousClose,
        timestamp: new Date().toISOString()
      };
      
      if (livePrice.last_traded_price > 0) {
        normalized.push(livePrice);
      }
    }
    
    return normalized;
  }

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
        // Ensure numeric values are properly formatted
        stockPrice.last_traded_price = parseFloat(stockPrice.last_traded_price.toFixed(2));
        stockPrice.change = parseFloat(stockPrice.change.toFixed(2));
        stockPrice.percent_change = parseFloat(stockPrice.percent_change.toFixed(2));
        stockPrice.previous_close = parseFloat(stockPrice.previous_close.toFixed(2));
        stockPrice.open = parseFloat(stockPrice.open.toFixed(2));
        stockPrice.high = parseFloat(stockPrice.high.toFixed(2));
        stockPrice.low = parseFloat(stockPrice.low.toFixed(2));
        
        this.cache.set(cacheKey, {
          data: stockPrice,
          timestamp: Date.now()
        });
      }
      
      return stockPrice || null;
      
    } catch (error) {
      console.error(`Failed to fetch price for ${symbol}:`, error.message);
      return null;
    }
  }

  async getTopGainers(limit = 10) {
    const prices = await this.getCurrentPrices();
    return prices
      .filter(p => p.percent_change > 0)
      .sort((a, b) => b.percent_change - a.percent_change)
      .slice(0, limit);
  }

  async getTopLosers(limit = 10) {
    const prices = await this.getCurrentPrices();
    return prices
      .filter(p => p.percent_change < 0)
      .sort((a, b) => a.percent_change - b.percent_change)
      .slice(0, limit);
  }

  async getMostActive(limit = 10) {
    const prices = await this.getCurrentPrices();
    return prices
      .sort((a, b) => b.volume - a.volume)
      .slice(0, limit);
  }

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
        market_open: this.isMarketOpen(),
        market_status: this.getMarketStatus()
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
      market_status: this.getMarketStatus(),
      timestamp: new Date().toISOString()
    };
    
    return summary;
  }

  clearCache() {
    this.cache.clear();
    console.log('Live price cache cleared');
  }

  parseNumeric(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return isNaN(value) ? 0 : value;
    const cleaned = String(value).replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }
}

module.exports = new NEPSEPriceScraper();