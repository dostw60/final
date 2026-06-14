// scrapers/market/livePriceScraper.js
const axios = require('axios');
const pool = require('../../db/pool');
const redisCache = require('../../services/redisCache');
const dateParser = require('../../services/dateParser');
const { withRetry } = require('../../utils/retry');
const logger = require('../../utils/logger');

class NEPSEPriceScraper {
  constructor() {
    // NEPSE Live API endpoints
    this.NEPSE_LIVE_API = 'https://nepsealpha.com/api/todays-price';
    this.MEROLAGANI_LIVE_API = 'https://www.merolagani.com/Handlers/GetLiveMarketDataHandler.ashx';
    this.SHARESANSAR_LIVE_API = 'https://www.sharesansar.com/api/live-trading';
    
    // WebSocket endpoint for real-time (if available)
    this.WS_URL = 'wss://nepsealpha.com/ws/live';
    
    this.isWatching = false;
    this.wsConnection = null;
    this.updateInterval = null;
    this.lastUpdateTime = null;
    this.priceBuffer = new Map(); // Buffer for batch processing
    this.BUFFER_SIZE = 50; // Process after 50 updates
    
    // Rate limiting
    this.requestDelay = parseInt(process.env.SCRAPE_RATE_LIMIT_MS) || 2000;
    this.lastRequestTime = 0;
  }

  /**
   * Get current live prices for all active stocks
   */
  async getCurrentPrices() {
    try {
      // Check cache first (5 second TTL for live data)
      const cacheKey = 'live:prices:all';
      const cached = await redisCache.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        const age = Date.now() - parsed.timestamp;
        if (age < 5000) { // 5 seconds freshness
          return parsed.data;
        }
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
      
      // Fetch from primary source
      const liveData = await withRetry(
        () => this.fetchFromNEPSEAlpha(),
        { 
          retries: 2, 
          delay: 1000,
          onRetry: (error, attempt) => {
            logger.warn(`Retry ${attempt} for live prices: ${error.message}`);
          }
        }
      );
      
      const normalized = await this.normalizeLiveData(liveData);
      
      // Cache for 5 seconds
      await redisCache.setex(cacheKey, 5, JSON.stringify({
        data: normalized,
        timestamp: Date.now()
      }));
      
      // Store in buffer for batch database update
      await this.bufferPrices(normalized);
      
      return normalized;
      
    } catch (error) {
      logger.error('Failed to fetch live prices:', error);
      
      // Fallback to last known prices from database
      return this.getLastKnownPrices();
    }
  }

  /**
   * Fetch from NEPSE Alpha API (most reliable)
   */
  async fetchFromNEPSEAlpha() {
    const response = await axios.get(this.NEPSE_LIVE_API, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
      },
      timeout: parseInt(process.env.REQUEST_TIMEOUT_MS) || 10000
    });
    
    if (!response.data || !response.data.success) {
      throw new Error('Invalid response from NEPSE Alpha');
    }
    
    return response.data.data || response.data.stocks || [];
  }

  /**
   * Fetch from MeroLagani (backup source)
   */
  async fetchFromMeroLagani() {
    const response = await axios.get(this.MEROLAGANI_LIVE_API, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    return response.data;
  }

  /**
   * Normalize live price data from different sources
   */
  async normalizeLiveData(rawData) {
    const normalized = [];
    const client = await pool.connect();
    
    try {
      for (const item of rawData) {
        // Find company ID
        const symbol = (item.symbol || item.ticker || item.scrip).toUpperCase();
        if (!symbol) continue;
        
        const companyResult = await client.query(
          'SELECT id FROM companies WHERE symbol = $1 AND is_active = true',
          [symbol]
        );
        
        if (companyResult.rows.length === 0) continue;
        
        const livePrice = {
          company_id: companyResult.rows[0].id,
          symbol: symbol,
          last_traded_price: this.parseNumeric(item.lastPrice || item.LTP || item.close || item.price),
          change: this.parseNumeric(item.change || item.netChange || 0),
          percent_change: this.parseNumeric(item.percentChange || item.changePercent || 0),
          volume: parseInt(item.volume || item.tradedShares || item.vol || 0),
          turnover: this.parseNumeric(item.turnover || item.amount || 0),
          high: this.parseNumeric(item.high || item.dayHigh || item.maxPrice),
          low: this.parseNumeric(item.low || item.dayLow || item.minPrice),
          open: this.parseNumeric(item.open || item.openPrice),
          previous_close: this.parseNumeric(item.previousClose || item.prevClose),
          total_trades: parseInt(item.totalTrades || item.trades || 0),
          timestamp: new Date(),
          source: 'live_nepse_alpha'
        };
        
        // Validate data
        if (livePrice.last_traded_price > 0) {
          normalized.push(livePrice);
        }
      }
      
      return normalized;
      
    } finally {
      client.release();
    }
  }

  /**
   * Buffer prices before batch insert to database
   */
  async bufferPrices(prices) {
    const now = Date.now();
    
    for (const price of prices) {
      const key = price.symbol;
      
      if (!this.priceBuffer.has(key)) {
        this.priceBuffer.set(key, []);
      }
      
      const buffer = this.priceBuffer.get(key);
      buffer.push(price);
      
      // Keep only last 10 updates per symbol
      if (buffer.length > 10) {
        buffer.shift();
      }
    }
    
    // If buffer size exceeds threshold, flush to database
    let totalItems = 0;
    for (const buffer of this.priceBuffer.values()) {
      totalItems += buffer.length;
    }
    
    if (totalItems >= this.BUFFER_SIZE) {
      await this.flushPriceBuffer();
    }
  }

  /**
   * Flush buffered prices to database
   */
  async flushPriceBuffer() {
    if (this.priceBuffer.size === 0) return;
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      let insertedCount = 0;
      
      for (const [symbol, prices] of this.priceBuffer.entries()) {
        const latestPrice = prices[prices.length - 1];
        
        // Insert into live_prices table (create if not exists)
        await client.query(`
          INSERT INTO live_prices 
            (company_id, symbol, last_traded_price, change, percent_change, 
             volume, turnover, high, low, open_price, previous_close, 
             total_trades, timestamp, source)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (company_id, timestamp) 
          DO UPDATE SET
            last_traded_price = EXCLUDED.last_traded_price,
            change = EXCLUDED.change,
            percent_change = EXCLUDED.percent_change,
            volume = EXCLUDED.volume,
            turnover = EXCLUDED.turnover,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            timestamp = EXCLUDED.timestamp
        `, [
          latestPrice.company_id,
          latestPrice.symbol,
          latestPrice.last_traded_price,
          latestPrice.change,
          latestPrice.percent_change,
          latestPrice.volume,
          latestPrice.turnover,
          latestPrice.high,
          latestPrice.low,
          latestPrice.open,
          latestPrice.previous_close,
          latestPrice.total_trades,
          latestPrice.timestamp,
          latestPrice.source
        ]);
        
        insertedCount++;
      }
      
      await client.query('COMMIT');
      logger.debug(`Flushed ${insertedCount} live prices to database`);
      
      // Clear buffer
      this.priceBuffer.clear();
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to flush price buffer:', error);
    } finally {
      client.release();
    }
  }

  /**
   * Get last known prices from database (fallback)
   */
  async getLastKnownPrices() {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT DISTINCT ON (lp.company_id)
          c.symbol,
          lp.last_traded_price,
          lp.change,
          lp.percent_change,
          lp.volume,
          lp.timestamp
        FROM live_prices lp
        JOIN companies c ON lp.company_id = c.id
        WHERE lp.timestamp >= NOW() - INTERVAL '1 hour'
        ORDER BY lp.company_id, lp.timestamp DESC
      `);
      
      return result.rows;
      
    } catch (error) {
      logger.error('Failed to get last known prices:', error);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Get live price for specific symbol
   */
  async getStockPrice(symbol) {
    try {
      // Check cache first
      const cacheKey = `live:price:${symbol.toUpperCase()}`;
      const cached = await redisCache.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        const age = Date.now() - parsed.timestamp;
        if (age < 3000) { // 3 seconds freshness
          return parsed.data;
        }
      }
      
      const allPrices = await this.getCurrentPrices();
      const stockPrice = allPrices.find(p => 
        p.symbol === symbol.toUpperCase()
      );
      
      if (stockPrice) {
        await redisCache.setex(cacheKey, 3, JSON.stringify({
          data: stockPrice,
          timestamp: Date.now()
        }));
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
   * Start live price streaming (WebSocket for real-time)
   */
  async startLiveStream(callback) {
    if (this.isWatching) {
      logger.warn('Live stream already active');
      return;
    }
    
    logger.info('Starting live price stream...');
    this.isWatching = true;
    
    // Start polling-based updates (WebSocket fallback)
    this.startPollingUpdates(callback);
    
    // Try WebSocket connection if available
    await this.connectWebSocket(callback);
  }

  /**
   * Polling-based updates (fallback when WebSocket unavailable)
   */
  startPollingUpdates(callback) {
    // Update every 10 seconds during market hours
    this.updateInterval = setInterval(async () => {
      if (!this.isWatching) return;
      
      const marketTime = dateParser.getCurrentNepalTime();
      const hour = marketTime.getHours();
      
      // Only update during market hours (11 AM - 3 PM)
      if (hour >= 11 && hour <= 15) {
        try {
          const prices = await this.getCurrentPrices();
          if (callback && typeof callback === 'function') {
            callback({
              type: 'market_update',
              data: prices,
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          logger.error('Polling update failed:', error);
        }
      }
    }, 10000); // 10 seconds
  }

  /**
   * WebSocket connection for real-time data
   */
  async connectWebSocket(callback) {
    try {
      const WebSocket = require('ws');
      
      this.wsConnection = new WebSocket(this.WS_URL);
      
      this.wsConnection.on('open', () => {
        logger.info('WebSocket connected for live prices');
        
        // Subscribe to all stocks
        this.wsConnection.send(JSON.stringify({
          action: 'subscribe',
          type: 'all_stocks'
        }));
      });
      
      this.wsConnection.on('message', async (data) => {
        try {
          const parsed = JSON.parse(data);
          
          if (parsed.type === 'price_update') {
            const normalized = await this.normalizeLiveData([parsed.data]);
            await this.bufferPrices(normalized);
            
            if (callback && typeof callback === 'function') {
              callback({
                type: 'realtime',
                data: normalized[0],
                timestamp: new Date().toISOString()
              });
            }
          }
        } catch (error) {
          logger.error('WebSocket message parsing error:', error);
        }
      });
      
      this.wsConnection.on('error', (error) => {
        logger.error('WebSocket error:', error);
        this.wsConnection = null;
      });
      
      this.wsConnection.on('close', () => {
        logger.info('WebSocket disconnected');
        this.wsConnection = null;
        
        // Reconnect after 5 seconds
        setTimeout(() => {
          if (this.isWatching) {
            this.connectWebSocket(callback);
          }
        }, 5000);
      });
      
    } catch (error) {
      logger.error('Failed to establish WebSocket connection:', error);
      // Fallback to polling is already running
    }
  }

  /**
   * Stop live streaming
   */
  stopLiveStream() {
    logger.info('Stopping live price stream...');
    this.isWatching = false;
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
    
    // Flush remaining buffer
    this.flushPriceBuffer();
  }

  /**
   * Get market summary (index values, market cap, etc.)
   */
  async getMarketSummary() {
    try {
      const cacheKey = 'live:market:summary';
      const cached = await redisCache.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
      
      const prices = await this.getCurrentPrices();
      
      const summary = {
        total_stocks_traded: prices.length,
        total_volume: prices.reduce((sum, p) => sum + p.volume, 0),
        total_turnover: prices.reduce((sum, p) => sum + (p.turnover || 0), 0),
        advancing_stocks: prices.filter(p => p.change > 0).length,
        declining_stocks: prices.filter(p => p.change < 0).length,
        unchanged_stocks: prices.filter(p => p.change === 0).length,
        average_change: prices.reduce((sum, p) => sum + (p.percent_change || 0), 0) / prices.length,
        timestamp: new Date().toISOString()
      };
      
      await redisCache.setex(cacheKey, 10, JSON.stringify(summary));
      
      return summary;
      
    } catch (error) {
      logger.error('Failed to get market summary:', error);
      return null;
    }
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

  /**
   * Update database with live prices (called by scheduler)
   */
  async updateLivePricesDatabase() {
    try {
      const prices = await this.getCurrentPrices();
      await this.bufferPrices(prices);
      await this.flushPriceBuffer();
      
      logger.info(`Updated live prices for ${prices.length} stocks`);
      return { success: true, count: prices.length };
      
    } catch (error) {
      logger.error('Failed to update live prices database:', error);
      return { success: false, error: error.message };
    }
  }
}

// Create the live_prices table if not exists
async function createLivePricesTable() {
  const pool = require('../../db/pool');
  const logger = require('../../utils/logger');
  
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS live_prices (
          id BIGSERIAL PRIMARY KEY,
          company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
          symbol VARCHAR(20) NOT NULL,
          last_traded_price NUMERIC(12, 2) NOT NULL,
          change NUMERIC(12, 2),
          percent_change NUMERIC(8, 2),
          volume BIGINT,
          turnover NUMERIC(20, 2),
          high NUMERIC(12, 2),
          low NUMERIC(12, 2),
          open_price NUMERIC(12, 2),
          previous_close NUMERIC(12, 2),
          total_trades INTEGER,
          timestamp TIMESTAMP NOT NULL,
          source VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(company_id, timestamp)
      );
      
      CREATE INDEX IF NOT EXISTS idx_live_prices_timestamp 
        ON live_prices(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_live_prices_symbol 
        ON live_prices(symbol);
      CREATE INDEX IF NOT EXISTS idx_live_prices_company 
        ON live_prices(company_id, timestamp DESC);
    `);
    
    logger.info('Live prices table created/verified');
  } catch (error) {
    logger.error('Failed to create live_prices table:', error);
  }
}

// Initialize table
createLivePricesTable().catch(console.error);

module.exports = new NEPSEPriceScraper();