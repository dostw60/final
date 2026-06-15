// scrapers/events/dividendScraper.js
const axios = require('axios');

class NEPSEDividendScraper {
  constructor() {
    this.MEROLAGANI_STOCK_EVENT_API = 'https://www.merolagani.com/handlers/webrequesthandler.ashx';
    this.cache = new Map();
  }

  async fetchDividends(fiscalYear = null) {
    try {
      const dividends = await this.fetchFromStockEvents();
      let filtered = dividends;
      if (fiscalYear) {
        filtered = dividends.filter(d => d.fiscal_year === fiscalYear);
      }
      return { success: true, count: filtered.length, data: filtered };
    } catch (error) {
      console.error('Failed to fetch dividends:', error.message);
      return { success: false, error: error.message, data: [] };
    }
  }

  async fetchFromStockEvents() {
    const cacheKey = 'dividend_data';
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 3600000) {
      return cached.data;
    }
    
    const now = new Date();
    const fromDate = `1/1/${now.getFullYear() - 2}`;
    const toDate = `12/31/${now.getFullYear() + 1}`;
    
    const response = await axios.get(this.MEROLAGANI_STOCK_EVENT_API, {
      params: { type: 'stock_event', fromDate: fromDate, toDate: toDate },
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    
    const events = response.data.detail || [];
    const dividendEvents = events.filter(event => {
      const text = event.announcementDetail.toLowerCase();
      return text.includes('dividend') || text.includes('cash dividend') || text.includes('bonus share');
    });
    
    const parsedDividends = this.parseDividendEvents(dividendEvents);
    this.cache.set(cacheKey, { data: parsedDividends, timestamp: Date.now() });
    
    return parsedDividends;
  }

  parseDividendEvents(events) {
    const dividends = [];
    for (const event of events) {
      const text = event.announcementDetail;
      dividends.push({
        company_name: this.extractCompanyName(text),
        symbol: this.extractSymbol(text),
        cash_dividend_percent: this.extractCashDividend(text),
        bonus_percent: this.extractBonusPercent(text),
        total_dividend_percent: this.extractTotalPercent(text),
        announcement_date: event.actionDate,
        fiscal_year: this.extractFiscalYear(text),
        description: text
      });
    }
    return dividends;
  }

  extractCompanyName(text) {
    const patterns = [
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Limited|Ltd|Bank|Company)))/i,
      /-\s*([A-Z][A-Za-z\s]+(?:Limited|Ltd|Bank))/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) return match[1].trim();
    }
    return null;
  }

  extractSymbol(text) {
    let match = text.match(/\(([A-Z]{3,})\)/);
    if (match) return match[1];
    
    const knownSymbols = ['NABIL', 'EBL', 'PRVU', 'NIB', 'GBIME', 'SANIMA', 'NICA'];
    for (const sym of knownSymbols) {
      if (text.includes(sym)) return sym;
    }
    return null;
  }

  extractCashDividend(text) {
    const match = text.match(/(\d+(?:\.\d+)?)%?\s*(?:cash|Cash)\s*(?:dividend|Dividend)/i);
    return match ? parseFloat(match[1]) : 0;
  }

  extractBonusPercent(text) {
    const match = text.match(/(\d+(?:\.\d+)?)%?\s*(?:bonus|Bonus)\s*(?:share|Share)/i);
    return match ? parseFloat(match[1]) : 0;
  }

  extractTotalPercent(text) {
    const match = text.match(/(\d+(?:\.\d+)?)%\s*(?:dividend|Dividend)(?!(?:\s*(?:cash|bonus)))/i);
    return match ? parseFloat(match[1]) : 0;
  }

  extractFiscalYear(text) {
    const match = text.match(/(?:FY|Fiscal Year)\s*(\d{4}\/\d{2})/i);
    return match ? match[1] : null;
  }

  async getLatestDividends(limit = 20) {
    const result = await this.fetchDividends();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const filtered = result.data.filter(d => {
      if (!d.announcement_date) return false;
      return new Date(d.announcement_date) >= sixMonthsAgo;
    });
    return filtered.slice(0, limit);
  }

  async getDividendsByCompany(symbol, limit = 10) {
    const result = await this.fetchDividends();
    const filtered = result.data.filter(d => d.symbol === symbol.toUpperCase());
    return filtered.slice(0, limit);
  }

  async getDividendsByFiscalYear(fiscalYear) {
    const result = await this.fetchDividends();
    return result.data.filter(d => d.fiscal_year === fiscalYear);
  }

  async calculateDividendYield(symbol, currentPrice = null) {
    const dividends = await this.getDividendsByCompany(symbol, 1);
    if (dividends.length === 0) return null;
    
    const dividend = dividends[0];
    const dividendPercent = dividend.total_dividend_percent || dividend.cash_dividend_percent;
    
    if (!dividendPercent || dividendPercent === 0) {
      return { symbol: symbol.toUpperCase(), dividend_percent: dividendPercent, current_price: currentPrice, dividend_yield: null, message: 'Current price needed to calculate yield' };
    }
    
    if (!currentPrice) {
      return { symbol: symbol.toUpperCase(), dividend_percent: dividendPercent, current_price: null, dividend_yield: null, message: 'Current price needed to calculate yield' };
    }
    
    const dividendYield = (dividendPercent / currentPrice) * 100;
    
    return {
      symbol: symbol.toUpperCase(),
      dividend_percent: dividendPercent,
      current_price: currentPrice,
      dividend_yield: parseFloat(dividendYield.toFixed(2)),
      fiscal_year: dividend.fiscal_year,
      announcement_date: dividend.announcement_date
    };
  }
}

module.exports = new NEPSEDividendScraper();