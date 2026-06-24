// scrapers/market/floorSheetScraper.js
const axios = require('axios');
const cheerio = require('cheerio');

class FloorSheetScraper {
  constructor() {
    this.baseUrl = 'https://merolagani.com/Floorsheet.aspx';
    this.cache = new Map();
    this.cacheTTL = 60000; // 1 minute for floor sheet data
  }

  /**
   * Fetch floor sheet for a specific date
   * @param {string} date - Date in YYYY-MM-DD format (optional, defaults to today)
   * @param {boolean} forceFresh - Bypass cache
   * @returns {Object} Floor sheet data
   */
  async fetchFloorSheet(date = null, forceFresh = false) {
    try {
      // If no date provided, use today
      if (!date) {
        const now = new Date();
        date = now.toISOString().split('T')[0];
      }

      const cacheKey = `floorsheet_${date}`;
      
      if (!forceFresh && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTTL) {
          return cached.data;
        }
      }

      // Build URL with date parameter
      const url = `${this.baseUrl}?date=${date}`;

      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      const $ = cheerio.load(response.data);
      const trades = this.parseFloorSheet($);
      
      // Calculate market activity
      const activity = this.calculateActivity(trades);

      const result = {
        success: true,
        date: date,
        total_trades: trades.length,
        total_volume: activity.total_volume,
        total_turnover: activity.total_turnover,
        unique_symbols: activity.unique_symbols,
        data: trades,
        activity: activity,
        timestamp: new Date().toISOString()
      };

      this.cache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      console.error(`Error fetching floor sheet for ${date}:`, error.message);
      return {
        success: false,
        error: error.message,
        date: date
      };
    }
  }

  /**
   * Parse floor sheet HTML
   */
  parseFloorSheet($) {
    const trades = [];

    // Look for the floor sheet table
    // The page typically has a table with columns: Contract No., Stock Symbol, Buyer, Seller, Quantity, Rate, Amount
    $('table').each((i, table) => {
      const tableText = $(table).text();
      
      // Check if this is the floor sheet table
      if (tableText.includes('Contract No.') || 
          tableText.includes('Stock Symbol') || 
          tableText.includes('Buyer') || 
          tableText.includes('Seller')) {
        
        $(table).find('tr').each((j, row) => {
          if (j === 0) return; // Skip header row
          
          const cols = $(row).find('td');
          if (cols.length >= 6) {
            const contractNo = $(cols[0]).text().trim();
            const symbol = $(cols[1]).text().trim().toUpperCase();
            const buyer = $(cols[2]).text().trim();
            const seller = $(cols[3]).text().trim();
            const quantity = this.parseNumber($(cols[4]).text());
            const rate = this.parseNumber($(cols[5]).text());
            const amount = cols.length > 6 ? this.parseNumber($(cols[6]).text()) : quantity * rate;
            
            if (symbol && quantity > 0 && rate > 0) {
              trades.push({
                contract_no: contractNo,
                symbol: symbol,
                buyer: buyer,
                seller: seller,
                quantity: quantity,
                rate: rate,
                amount: amount || quantity * rate,
                time: this.extractTime($(row).text())
              });
            }
          }
        });
      }
    });

    return trades;
  }

  /**
   * Extract time from row text if available
   */
  extractTime(text) {
    const timeMatch = text.match(/(\d{1,2}:\d{2}:\d{2})/);
    return timeMatch ? timeMatch[1] : null;
  }

  /**
   * Calculate market activity from trades
   */
  calculateActivity(trades) {
    const symbolMap = new Map();
    let totalVolume = 0;
    let totalTurnover = 0;

    for (const trade of trades) {
      totalVolume += trade.quantity;
      totalTurnover += trade.amount;
      
      if (!symbolMap.has(trade.symbol)) {
        symbolMap.set(trade.symbol, {
          symbol: trade.symbol,
          volume: 0,
          turnover: 0,
          trades: 0,
          last_price: trade.rate
        });
      }
      
      const symbolData = symbolMap.get(trade.symbol);
      symbolData.volume += trade.quantity;
      symbolData.turnover += trade.amount;
      symbolData.trades += 1;
      symbolData.last_price = trade.rate;
    }

    return {
      total_volume: totalVolume,
      total_turnover: totalTurnover,
      unique_symbols: symbolMap.size,
      symbol_summary: Array.from(symbolMap.values())
        .sort((a, b) => b.turnover - a.turnover)
    };
  }

  /**
   * Get trades for a specific symbol on a date
   */
  async getTradesBySymbol(symbol, date = null) {
    try {
      const result = await this.fetchFloorSheet(date);
      if (!result.success) return [];
      
      const symbolTrades = result.data.filter(
        trade => trade.symbol === symbol.toUpperCase()
      );
      
      return symbolTrades;
    } catch (error) {
      console.error(`Error fetching trades for ${symbol}:`, error.message);
      return [];
    }
  }

  /**
   * Get top traded symbols by turnover
   */
  async getTopTradedSymbols(limit = 10, date = null) {
    try {
      const result = await this.fetchFloorSheet(date);
      if (!result.success) return [];
      
      return result.activity.symbol_summary.slice(0, limit);
    } catch (error) {
      console.error('Error fetching top traded symbols:', error.message);
      return [];
    }
  }

  /**
   * Get market activity summary
   */
  async getMarketActivity(date = null) {
    try {
      const result = await this.fetchFloorSheet(date);
      if (!result.success) return null;
      
      return {
        date: result.date,
        total_trades: result.total_trades,
        total_volume: result.total_volume,
        total_turnover: result.total_turnover,
        unique_symbols: result.unique_symbols,
        top_symbols: result.activity.symbol_summary.slice(0, 10),
        timestamp: result.timestamp
      };
    } catch (error) {
      console.error('Error fetching market activity:', error.message);
      return null;
    }
  }

  /**
   * Fetch floor sheet for a date range
   */
  async fetchFloorSheetRange(fromDate, toDate, limit = 20) {
    try {
      const results = [];
      const currentDate = new Date(fromDate);
      const endDate = new Date(toDate);
      
      while (currentDate <= endDate && results.length < limit) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const result = await this.fetchFloorSheet(dateStr);
        
        if (result.success && result.total_trades > 0) {
          results.push({
            date: dateStr,
            total_trades: result.total_trades,
            total_volume: result.total_volume,
            total_turnover: result.total_turnover,
            unique_symbols: result.unique_symbols
          });
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      return {
        success: true,
        from: fromDate,
        to: toDate,
        count: results.length,
        data: results,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('Error fetching floor sheet range:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Parse number from text
   */
  parseNumber(text) {
    if (!text) return 0;
    if (typeof text === 'number') return isNaN(text) ? 0 : text;
    
    const cleaned = String(text).replace(/,/g, '').replace(/\s/g, '').replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = new FloorSheetScraper();