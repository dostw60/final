// scrapers/events/dividendScraper.js
const axios = require('axios');
const { withRetry } = require('../../utils/retry');

class NEPSEDividendScraper {
  constructor() {
    this.MEROLAGANI_STOCK_EVENT_API = 'https://www.merolagani.com/handlers/webrequesthandler.ashx';
    this.cache = new Map();
  }

  /**
   * Fetch dividend announcements from stock events
   */
  async fetchDividends(fiscalYear = null) {
    try {
      console.log(`Fetching dividend data${fiscalYear ? ` for FY ${fiscalYear}` : ''}`);
      
      const dividends = await withRetry(
        () => this.fetchFromStockEvents(),
        { retries: 2, delay: 2000 }
      );
      
      // Filter by fiscal year if specified
      let filtered = dividends;
      if (fiscalYear) {
        filtered = dividends.filter(d => d.fiscal_year === fiscalYear);
      }
      
      return {
        success: true,
        count: filtered.length,
        data: filtered,
        fiscalYear
      };
      
    } catch (error) {
      console.error('Failed to fetch dividends:', error.message);
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Fetch from stock events API (reliable source)
   */
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
      params: {
        type: 'stock_event',
        fromDate: fromDate,
        toDate: toDate
      },
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
    
    const events = response.data.detail || [];
    
    // Filter dividend-related events
    const dividendEvents = events.filter(event => {
      const text = event.announcementDetail.toLowerCase();
      return text.includes('dividend') || 
             text.includes('cash dividend') || 
             text.includes('bonus share') ||
             text.includes('bonus shares');
    });
    
    const parsedDividends = this.parseDividendEvents(dividendEvents);
    
    this.cache.set(cacheKey, { data: parsedDividends, timestamp: Date.now() });
    
    return parsedDividends;
  }

  /**
   * Parse dividend events from announcement text
   */
  parseDividendEvents(events) {
    const dividends = [];
    
    for (const event of events) {
      const text = event.announcementDetail;
      
      // Extract company name and symbol
      let companyName = this.extractCompanyName(text);
      let symbol = this.extractSymbol(text);
      
      // Extract dividend percentages
      const cashDividend = this.extractCashDividend(text);
      const bonusPercent = this.extractBonusPercent(text);
      const totalPercent = this.extractTotalPercent(text);
      
      // Extract fiscal year
      const fiscalYear = this.extractFiscalYear(text);
      
      // Extract dates
      const announcementDate = event.actionDate;
      let bookClosureDate = this.extractBookClosureDate(text);
      let agmDate = this.extractAGMDate(text);
      
      dividends.push({
        company_name: companyName,
        symbol: symbol,
        cash_dividend_percent: cashDividend,
        bonus_percent: bonusPercent,
        total_dividend_percent: totalPercent || (cashDividend + bonusPercent),
        announcement_date: announcementDate,
        book_closure_date: bookClosureDate,
        agm_date: agmDate,
        fiscal_year: fiscalYear,
        description: text,
        source_date: event.actionDate,
        raw: text
      });
    }
    
    return dividends;
  }

  /**
   * Extract company name from text
   */
  extractCompanyName(text) {
    // Look for patterns like "Company Name Limited"
    const patterns = [
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Limited|Ltd|Bank|Company|Finance|Development|Insurance)))/i,
      /-\s*([A-Z][A-Za-z\s]+(?:Limited|Ltd|Bank|Company))/i,
      /([A-Z][A-Za-z\s]+(?:Limited|Ltd))\s+has/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1].length > 5) {
        return match[1].trim();
      }
    }
    
    return null;
  }

  /**
   * Extract symbol from text
   */
  extractSymbol(text) {
    // Look for symbol in parentheses
    let match = text.match(/\(([A-Z]{3,})\)/);
    if (match) return match[1];
    
    // Look for pattern "Company (SYMBOL)"
    match = text.match(/[-\s]+([A-Z]{3,})\)/);
    if (match) return match[1];
    
    // Check for known symbols
    const knownSymbols = ['NABIL', 'EBL', 'PRVU', 'NIB', 'GBIME', 'SANIMA', 'NICA', 'SOPL', 'NMB', 'KBL', 'MBL', 'SBI'];
    for (const sym of knownSymbols) {
      if (text.includes(sym)) return sym;
    }
    
    return null;
  }

  /**
   * Extract cash dividend percentage
   */
  extractCashDividend(text) {
    // Patterns like "10% cash dividend" or "Cash Dividend: 10%"
    const patterns = [
      /(\d+(?:\.\d+)?)%?\s*(?:cash|Cash)\s*(?:dividend|Dividend)/i,
      /(?:cash|Cash)\s*(?:dividend|Dividend)\s*:?\s*(\d+(?:\.\d+)?)%/i,
      /(\d+(?:\.\d+)?)%\s*(?:cash|Cash)/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return parseFloat(match[1]);
      }
    }
    
    return 0;
  }

  /**
   * Extract bonus share percentage
   */
  extractBonusPercent(text) {
    // Patterns like "15% bonus share" or "Bonus Share: 15%"
    const patterns = [
      /(\d+(?:\.\d+)?)%?\s*(?:bonus|Bonus)\s*(?:share|Share|shares|Shares)/i,
      /(?:bonus|Bonus)\s*(?:share|Share)\s*:?\s*(\d+(?:\.\d+)?)%/i,
      /(\d+(?:\.\d+)?)%\s*(?:bonus|Bonus)/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return parseFloat(match[1]);
      }
    }
    
    return 0;
  }

  /**
   * Extract total dividend percentage
   */
  extractTotalPercent(text) {
    // Patterns like "25% dividend" or "Dividend: 25%"
    const patterns = [
      /(\d+(?:\.\d+)?)%\s*(?:dividend|Dividend)(?!(?:\s*(?:cash|bonus)))/i,
      /(?:dividend|Dividend)\s*:?\s*(\d+(?:\.\d+)?)%/i,
      /(?:total|Total)\s*(?:dividend|Dividend)\s*:?\s*(\d+(?:\.\d+)?)%/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return parseFloat(match[1]);
      }
    }
    
    return 0;
  }

  /**
   * Extract fiscal year
   */
  extractFiscalYear(text) {
    // Patterns like "FY 2079/80" or "Fiscal Year 2079/80"
    const patterns = [
      /(?:FY|Fiscal Year)\s*(\d{4}\/\d{2})/i,
      /(\d{4}\/\d{2})/,
      /for the year (\d{4}\/\d{2})/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    return null;
  }

  /**
   * Extract book closure date
   */
  extractBookClosureDate(text) {
    // Patterns like "book closure on Jestha 18, 2083"
    const match = text.match(/book\s*closure\s*(?:on|date)\s*([^.,]+)/i);
    if (match) {
      return match[1].trim();
    }
    return null;
  }

  /**
   * Extract AGM date
   */
  extractAGMDate(text) {
    // Patterns like "AGM scheduled for Jestha 18, 2083"
    const match = text.match(/AGM\s*(?:scheduled for|on)\s*([^.,]+)/i);
    if (match) {
      return match[1].trim();
    }
    return null;
  }

  /**
   * Get latest dividends (last 6 months)
   */
  async getLatestDividends(limit = 20) {
    const result = await this.fetchDividends();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const filtered = result.data.filter(d => {
      if (!d.announcement_date) return false;
      const date = new Date(d.announcement_date);
      return date >= sixMonthsAgo;
    });
    
    return filtered.slice(0, limit);
  }

  /**
   * Get dividends by company symbol
   */
  async getDividendsByCompany(symbol, limit = 10) {
    const result = await this.fetchDividends();
    const filtered = result.data.filter(d => 
      d.symbol && d.symbol.toUpperCase() === symbol.toUpperCase()
    );
    return filtered.slice(0, limit);
  }

  /**
   * Get dividends by fiscal year
   */
  async getDividendsByFiscalYear(fiscalYear) {
    const result = await this.fetchDividends();
    return result.data.filter(d => d.fiscal_year === fiscalYear);
  }

  /**
   * Calculate dividend yield for a company
   */
  async calculateDividendYield(symbol, currentPrice = null) {
    const dividends = await this.getDividendsByCompany(symbol, 1);
    
    if (dividends.length === 0) {
      return null;
    }
    
    const dividend = dividends[0];
    const dividendPercent = dividend.total_dividend_percent || dividend.cash_dividend_percent;
    
    if (!dividendPercent || dividendPercent === 0) {
      return null;
    }
    
    // If no price provided, we can't calculate yield
    if (!currentPrice) {
      return {
        symbol: symbol.toUpperCase(),
        dividend_percent: dividendPercent,
        current_price: null,
        dividend_yield: null,
        message: 'Current price needed to calculate yield'
      };
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

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('Dividend cache cleared');
  }
}

module.exports = new NEPSEDividendScraper();