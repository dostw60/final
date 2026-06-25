// scrapers/market/floorSheetScraper.js - CORRECTED VERSION
const axios = require('axios');
const cheerio = require('cheerio');

class FloorSheetScraper {
  constructor() {
    this.baseUrl = 'https://merolagani.com/Floorsheet.aspx';
    this.cache = new Map();
    this.cacheTTL = 60000; // 1 minute
  }

  async fetchFloorSheet(date = null, forceFresh = false) {
    try {
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
   * Parse floor sheet HTML - CORRECTED column indices
   */
  parseFloorSheet($) {
    const trades = [];

    // Find the floor sheet table
    $('table').each((i, table) => {
      const tableText = $(table).text();
      
      // Check if this is the floor sheet table by looking for specific headers
      if (tableText.includes('Transact. No.') && 
          tableText.includes('Symbol') && 
          tableText.includes('Buyer') && 
          tableText.includes('Seller')) {
        
        $(table).find('tr').each((j, row) => {
          // Skip header row
          if (j === 0) return;
          
          const cols = $(row).find('td');
          if (cols.length >= 8) {
            // Column indices based on debug output:
            // 0: "#"
            // 1: "Transact. No." (contract number)
            // 2: "Symbol" ← THIS IS THE ONE WE WANT
            // 3: "Buyer"
            // 4: "Seller"
            // 5: "Quantity"
            // 6: "Rate"
            // 7: "Amount"
            
            const contractNo = $(cols[1]).text().trim(); // Transact. No.
            const symbol = $(cols[2]).text().trim().toUpperCase(); // Symbol - CORRECT INDEX!
            const buyer = $(cols[3]).text().trim();
            const seller = $(cols[4]).text().trim();
            const quantity = this.parseNumber($(cols[5]).text());
            const rate = this.parseNumber($(cols[6]).text());
            const amount = this.parseNumber($(cols[7]).text());
            
            // Only add if symbol looks like a valid stock symbol
            if (symbol && quantity > 0 && rate > 0 && this.isValidSymbol(symbol)) {
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
   * Check if a symbol is a valid stock symbol
   */
  isValidSymbol(symbol) {
    if (!symbol) return false;
    // Stock symbols are typically alphabetic, 2-5 characters
    // Examples: AHL, NABIL, SOPL, EBL
    return /^[A-Z]{2,6}$/.test(symbol);
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

  parseNumber(text) {
    if (!text) return 0;
    if (typeof text === 'number') return isNaN(text) ? 0 : text;
    
    const cleaned = String(text).replace(/,/g, '').replace(/\s/g, '').replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = new FloorSheetScraper();