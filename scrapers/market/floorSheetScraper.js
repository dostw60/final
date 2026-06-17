// scrapers/market/floorSheetScraper.js
const axios = require('axios');
const cheerio = require('cheerio');

class FloorSheetScraper {
  constructor() {
    this.baseUrl = 'https://merolagani.com';
    this.cache = new Map();
    this.cacheTTL = 60000; // 1 minute - floor sheets update frequently
  }

  /**
   * Fetches the floor sheet for a given date.
   * @param {string} date - Date in 'YYYY-MM-DD' format. If null, fetches today's.
   * @returns {Promise<Object>} - { success, date, count, data, timestamp }
   */
  async fetchFloorSheet(date = null) {
    try {
      const targetDate = date || this.getTodayDate();
      const cacheKey = `floorsheet_${targetDate}`;

      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }

      console.log(`Fetching floor sheet for date: ${targetDate}`);
      const url = `${this.baseUrl}/Floorsheet.aspx?date=${targetDate}`;
      
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        }
      });

      // Check if the response contains data or an error message
      if (response.data.includes('No data found') || response.data.includes('No Record Found')) {
        return {
          success: true,
          date: targetDate,
          count: 0,
          data: [],
          message: 'No trading data found for this date.',
          timestamp: new Date().toISOString()
        };
      }

      const parsedData = this.parseFloorSheet(response.data);
      
      const result = {
        success: true,
        date: targetDate,
        count: parsedData.length,
        data: parsedData,
        timestamp: new Date().toISOString()
      };

      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;

    } catch (error) {
      console.error(`Error fetching floor sheet for ${date}:`, error.message);
      return { 
        success: false, 
        count: 0, 
        data: [], 
        error: error.message,
        date: date || this.getTodayDate()
      };
    }
  }

  /**
   * Parses the HTML of the floor sheet page.
   * Uses multiple strategies to find the data table.
   */
  parseFloorSheet(html) {
    const $ = cheerio.load(html);
    const trades = [];

    // --- Strategy 1: Find the main data table by its ID or class ---
    let dataTable = null;
    
    // Common table identifiers on Merolagani
    const tableSelectors = [
      '#ctl00_ContentPlaceHolder1_gvFloorSheet', // Common ASP.NET ID
      '.grid-view', 
      '.table-bordered',
      'table[cellpadding="4"]',
      'table[border="1"]'
    ];

    for (const selector of tableSelectors) {
      const table = $(selector);
      if (table.length > 0 && table.find('tr').length > 1) {
        dataTable = table;
        break;
      }
    }

    // --- Strategy 2: If not found, find any table with typical floor sheet headers ---
    if (!dataTable) {
      const allTables = $('table');
      allTables.each((i, table) => {
        const headerRow = $(table).find('tr').first();
        const headerText = headerRow.text().toLowerCase();
        // Look for keywords in the header
        if (headerText.includes('contract') || 
            headerText.includes('buyer') || 
            headerText.includes('seller') ||
            headerText.includes('symbol') ||
            headerText.includes('rate')) {
          dataTable = $(table);
          return false; // break the loop
        }
      });
    }

    // --- Strategy 3: Look for tabular data in divs or structured lists (fallback) ---
    if (!dataTable) {
      console.warn('Could not find a standard table. Attempting to parse list-like structure...');
      // This is a very basic fallback for non-table structures
      const rows = $('div.trade-row, div.row-item, li.trade-item');
      if (rows.length > 0) {
        rows.each((i, row) => {
          const cols = $(row).find('span, div.col');
          if (cols.length >= 4) {
            trades.push({
              contract_no: $(cols[0]).text().trim(),
              stock_symbol: $(cols[1]).text().trim(),
              buyer_broker: $(cols[2]).text().trim(),
              seller_broker: $(cols[3]).text().trim(),
              quantity: this.parseNumeric($(cols[4]).text()),
              rate: this.parseNumeric($(cols[5]).text()),
              amount: this.parseNumeric($(cols[6]).text()),
              time: $(cols[7]).text().trim()
            });
          }
        });
        return trades; // Return early if we parsed something
      }
      
      console.warn('No data structure could be parsed.');
      return trades;
    }

    // --- Parse the found table ---
    const headerRow = dataTable.find('tr').first();
    const headers = [];
    headerRow.find('th, td').each((i, el) => {
      headers.push($(el).text().trim().toLowerCase());
    });

    // Map column indices based on header text
    const colMap = {
      sn: this.findColumnIndex(headers, ['s.n.', 'sn', 'sno', '#']),
      contract: this.findColumnIndex(headers, ['contract', 'contract no', 'contract no.', 'ticket no']),
      symbol: this.findColumnIndex(headers, ['symbol', 'scrip', 'company', 'stock']),
      buyer: this.findColumnIndex(headers, ['buyer', 'buyer broker', 'b.broker', 'b/']),
      seller: this.findColumnIndex(headers, ['seller', 'seller broker', 's.broker', 's/']),
      quantity: this.findColumnIndex(headers, ['quantity', 'qty', 'shares']),
      rate: this.findColumnIndex(headers, ['rate', 'price', 'rate(rs.)']),
      amount: this.findColumnIndex(headers, ['amount', 'total', 'turnover']),
      time: this.findColumnIndex(headers, ['time', 'transaction time'])
    };

    // If we couldn't identify the columns, use a default mapping based on common order
    if (Object.values(colMap).every(idx => idx === -1)) {
      console.warn('Headers not recognized. Using default column mapping.');
      // Assume order: SN, Contract, Symbol, Buyer, Seller, Qty, Rate, Amount, Time
      const defaultMap = { sn:0, contract:1, symbol:2, buyer:3, seller:4, quantity:5, rate:6, amount:7, time:8 };
      return this.parseTableRows(dataTable, defaultMap, $);
    }

    return this.parseTableRows(dataTable, colMap, $);
  }

  /**
   * Helper to find the index of a column based on possible header names.
   */
  findColumnIndex(headers, possibleNames) {
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i].trim();
      if (possibleNames.some(name => header.includes(name))) {
        return i;
      }
    }
    return -1; // Not found
  }

  /**
   * Parses the rows of a table using a column map.
   */
  parseTableRows(table, colMap, $) {
    const rows = [];
    table.find('tr').each((i, row) => {
      if (i === 0) return; // Skip header row
      
      const cols = $(row).find('td');
      if (cols.length < 3) return; // Skip rows that are too short

      const trade = {
        sn: i,
        contract_no: $(cols[colMap.contract] || cols[1]).text().trim(),
        stock_symbol: $(cols[colMap.symbol] || cols[2]).text().trim().toUpperCase(),
        buyer_broker: $(cols[colMap.buyer] || cols[3]).text().trim(),
        seller_broker: $(cols[colMap.seller] || cols[4]).text().trim(),
        quantity: this.parseNumeric($(cols[colMap.quantity] || cols[5]).text()),
        rate: this.parseNumeric($(cols[colMap.rate] || cols[6]).text()),
        amount: this.parseNumeric($(cols[colMap.amount] || cols[7]).text()),
        time: $(cols[colMap.time] || cols[8]).text().trim()
      };

      // Only add if we have at least a symbol and quantity
      if (trade.stock_symbol && trade.quantity > 0) {
        rows.push(trade);
      }
    });
    return rows;
  }

  /**
   * Gets trades for a specific stock symbol on a given date.
   */
  async getTradesBySymbol(symbol, date = null) {
    const result = await this.fetchFloorSheet(date);
    if (!result.success) return [];
    return result.data.filter(trade => 
      trade.stock_symbol.toUpperCase() === symbol.toUpperCase()
    );
  }

  /**
   * Gets the top traded symbols by volume/amount for a date.
   */
  async getTopTradedSymbols(limit = 10, date = null) {
    const result = await this.fetchFloorSheet(date);
    if (!result.success) return [];

    const symbolMap = new Map();
    result.data.forEach(trade => {
      if (symbolMap.has(trade.stock_symbol)) {
        const existing = symbolMap.get(trade.stock_symbol);
        existing.quantity += trade.quantity;
        existing.amount += trade.amount;
        existing.trades += 1;
        existing.last_price = trade.rate;
      } else {
        symbolMap.set(trade.stock_symbol, {
          symbol: trade.stock_symbol,
          quantity: trade.quantity,
          amount: trade.amount,
          trades: 1,
          last_price: trade.rate,
          avg_rate: trade.rate
        });
      }
    });

    // Calculate average rate for each symbol
    const aggregated = Array.from(symbolMap.values()).map(item => ({
      ...item,
      avg_rate: item.amount / item.quantity
    }));

    // Sort by amount (turnover)
    aggregated.sort((a, b) => b.amount - a.amount);
    return aggregated.slice(0, limit);
  }

  /**
   * Gets an overall market activity summary for a date.
   */
  async getMarketActivity(date = null) {
    const result = await this.fetchFloorSheet(date);
    if (!result.success || result.data.length === 0) {
      return {
        date: date || this.getTodayDate(),
        total_trades: 0,
        total_quantity: 0,
        total_amount: 0,
        unique_symbols: 0,
        average_rate: 0,
        message: 'No data available'
      };
    }

    const totalTrades = result.data.length;
    const totalQuantity = result.data.reduce((sum, t) => sum + t.quantity, 0);
    const totalAmount = result.data.reduce((sum, t) => sum + t.amount, 0);
    const uniqueSymbols = new Set(result.data.map(t => t.stock_symbol));

    return {
      date: result.date,
      total_trades: totalTrades,
      total_quantity: totalQuantity,
      total_amount: totalAmount,
      unique_symbols: uniqueSymbols.size,
      average_rate: totalQuantity > 0 ? (totalAmount / totalQuantity) : 0
    };
  }

  /**
   * Fetches floor sheets for a date range (basic implementation).
   */
  async fetchFloorSheetRange(fromDate, toDate, limit = 10) {
    const results = [];
    let currentDate = new Date(fromDate);
    const endDate = new Date(toDate);
    
    // Limit to prevent excessive requests
    let daysProcessed = 0;
    const maxDays = 30;

    while (currentDate <= endDate && daysProcessed < maxDays && results.length < limit) {
      const dateStr = this.formatDate(currentDate);
      const result = await this.fetchFloorSheet(dateStr);
      
      if (result.success && result.data.length > 0) {
        // Add date context to each trade
        result.data.forEach(trade => trade.trade_date = dateStr);
        results.push(...result.data);
      }
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
      daysProcessed++;
      
      // Add delay to be respectful
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return {
      success: true,
      from_date: fromDate,
      to_date: toDate,
      total_processed_days: daysProcessed,
      count: results.length,
      data: results.slice(0, limit),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Helper to get today's date in 'YYYY-MM-DD' format.
   */
  getTodayDate() {
    return this.formatDate(new Date());
  }

  /**
   * Helper to format a date object to 'YYYY-MM-DD'.
   */
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Safe numeric parser.
   */
  parseNumeric(value) {
    if (!value) return 0;
    // Remove commas, spaces, and other non-numeric characters (except decimal point)
    const cleaned = String(value).replace(/[^0-9.]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Clears the cache.
   */
  clearCache() {
    this.cache.clear();
    console.log('Floor sheet cache cleared');
  }
}

module.exports = new FloorSheetScraper();