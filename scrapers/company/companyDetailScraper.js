// scrapers/company/companyDetailScraper.js
const axios = require('axios');
const cheerio = require('cheerio');

class CompanyDetailScraper {
  constructor() {
    this.baseUrl = 'https://merolagani.com/CompanyDetail.aspx';
    this.cache = new Map();
    this.cacheTTL = 3600000; // 1 hour
  }

  /**
   * Fetch complete company details from Merolagani
   * @param {string} symbol - Company symbol (e.g., NABIL, EBL)
   * @param {boolean} forceFresh - Bypass cache
   * @returns {Object} Company details
   */
  async fetchCompanyDetails(symbol, forceFresh = false) {
    try {
      const cacheKey = `company_${symbol.toUpperCase()}`;
      
      // Check cache
      if (!forceFresh && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTTL) {
          return cached.data;
        }
      }

      // Fetch the company detail page
      const response = await axios.get(this.baseUrl, {
        params: { symbol: symbol.toUpperCase() },
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache'
        }
      });

      const $ = cheerio.load(response.data);
      
      // Extract company details
      const details = this.extractCompanyDetails($, symbol);
      
      // Extract financial data from tabs
      const financials = this.extractFinancialData($);
      
      // Extract price history
      const priceHistory = this.extractPriceHistory($);
      
      // Extract announcements
      const announcements = this.extractAnnouncements($);
      
      // Extract news
      const news = this.extractNews($);
      
      // Extract major shareholders
      const shareholders = this.extractMajorShareholders($);
      
      // Extract dividend history
      const dividendHistory = this.extractDividendHistory($);

      const result = {
        success: true,
        symbol: symbol.toUpperCase(),
        company_details: details,
        financials: financials,
        price_history: priceHistory,
        announcements: announcements,
        news: news,
        major_shareholders: shareholders,
        dividend_history: dividendHistory,
        last_updated: new Date().toISOString()
      };

      // Cache the result
      this.cache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      console.error(`Error fetching company details for ${symbol}:`, error.message);
      return {
        success: false,
        error: error.message,
        symbol: symbol.toUpperCase()
      };
    }
  }

  /**
   * Extract basic company details
   */
  extractCompanyDetails($, symbol) {
    const details = {
      symbol: symbol.toUpperCase(),
      name: '',
      sector: '',
      shares_outstanding: null,
      market_price: null,
      percent_change: null,
      last_traded_on: null,
      week_52_high: null,
      week_52_low: null,
      day_180_avg: null,
      day_120_avg: null,
      year_1_yield: null,
      eps: null,
      pe_ratio: null,
      book_value: null,
      pbv: null,
      percent_dividend: null,
      percent_bonus: null,
      right_share: null,
      day_30_avg_volume: null,
      market_capitalization: null,
      about: ''
    };

    // Try to extract from the page - adjust selectors based on actual HTML structure
    // This is a common pattern but may need adjustment

    // Company Name - look for heading
    const nameElement = $('h1, .company-name, .stock-name, .detail-title');
    if (nameElement.length) {
      details.name = nameElement.first().text().trim();
    }

    // Sector - look for sector info
    const sectorElement = $('.sector, .industry, .company-sector');
    if (sectorElement.length) {
      details.sector = sectorElement.first().text().trim();
    }

    // About section
    const aboutElement = $('.about-company, .company-description, #about');
    if (aboutElement.length) {
      details.about = aboutElement.text().trim();
    }

    // Extract from tables or specific elements
    $('.detail-row, .info-row, .company-info tr').each((i, row) => {
      const text = $(row).text().trim();
      const label = $(row).find('td:first-child, .label, th').text().trim().toLowerCase();
      const value = $(row).find('td:last-child, .value').text().trim();

      if (label.includes('shares outstanding') || label.includes('total shares')) {
        details.shares_outstanding = this.parseNumber(value);
      } else if (label.includes('market price') || label.includes('ltp')) {
        details.market_price = this.parseNumber(value);
      } else if (label.includes('change') || label.includes('percent change')) {
        details.percent_change = this.parseNumber(value);
      } else if (label.includes('52 week high')) {
        details.week_52_high = this.parseNumber(value);
      } else if (label.includes('52 week low')) {
        details.week_52_low = this.parseNumber(value);
      } else if (label.includes('eps')) {
        details.eps = this.parseNumber(value);
      } else if (label.includes('pe ratio')) {
        details.pe_ratio = this.parseNumber(value);
      } else if (label.includes('book value')) {
        details.book_value = this.parseNumber(value);
      } else if (label.includes('pbv')) {
        details.pbv = this.parseNumber(value);
      } else if (label.includes('dividend')) {
        details.percent_dividend = this.parseNumber(value);
      } else if (label.includes('bonus')) {
        details.percent_bonus = this.parseNumber(value);
      } else if (label.includes('right share')) {
        details.right_share = this.parseNumber(value);
      } else if (label.includes('market cap')) {
        details.market_capitalization = this.parseNumber(value);
      }
    });

    return details;
  }

  /**
   * Extract financial data
   */
  extractFinancialData($) {
    const financials = {
      quarterly: [],
      annual: []
    };

    // Look for financial tables
    $('.financial-table, .quarterly-table, .annual-table').each((i, table) => {
      const rows = [];
      $(table).find('tr').each((j, row) => {
        const cols = [];
        $(row).find('td, th').each((k, col) => {
          cols.push($(col).text().trim());
        });
        if (cols.length > 0) rows.push(cols);
      });
      
      // Determine if quarterly or annual
      const tableText = $(table).text().toLowerCase();
      if (tableText.includes('quarterly') || tableText.includes('qtr')) {
        financials.quarterly.push(rows);
      } else if (tableText.includes('annual') || tableText.includes('yearly')) {
        financials.annual.push(rows);
      }
    });

    return financials;
  }

  /**
   * Extract price history
   */
  extractPriceHistory($) {
    const history = [];
    
    $('.price-history-table, .historical-data tr').each((i, row) => {
      const cols = $(row).find('td');
      if (cols.length >= 5) {
        history.push({
          date: $(cols[0]).text().trim(),
          open: this.parseNumber($(cols[1]).text()),
          high: this.parseNumber($(cols[2]).text()),
          low: this.parseNumber($(cols[3]).text()),
          close: this.parseNumber($(cols[4]).text()),
          volume: this.parseNumber($(cols[5]?.text() || '0'))
        });
      }
    });

    return history.slice(0, 100); // Limit to 100 records
  }

  /**
   * Extract announcements
   */
  extractAnnouncements($) {
    const announcements = [];
    
    $('.announcement-list li, .announcement-item, .event-item').each((i, item) => {
      announcements.push({
        title: $(item).find('.title, .announcement-title').text().trim(),
        date: $(item).find('.date, .announcement-date').text().trim(),
        description: $(item).find('.description, .announcement-body').text().trim()
      });
    });

    return announcements;
  }

  /**
   * Extract news
   */
  extractNews($) {
    const news = [];
    
    $('.news-list li, .news-item, .company-news').each((i, item) => {
      news.push({
        title: $(item).find('.title, .news-title').text().trim(),
        date: $(item).find('.date, .news-date').text().trim(),
        excerpt: $(item).find('.excerpt, .news-summary').text().trim()
      });
    });

    return news;
  }

  /**
   * Extract major shareholders
   */
  extractMajorShareholders($) {
    const shareholders = [];
    
    $('.shareholder-table tr, .major-shareholders tr').each((i, row) => {
      const cols = $(row).find('td');
      if (cols.length >= 2) {
        shareholders.push({
          name: $(cols[0]).text().trim(),
          shares: this.parseNumber($(cols[1]).text()),
          percentage: this.parseNumber($(cols[2]?.text() || '0'))
        });
      }
    });

    return shareholders.slice(0, 10);
  }

  /**
   * Extract dividend history
   */
  extractDividendHistory($) {
    const dividends = [];
    
    $('.dividend-table tr, .dividend-history tr').each((i, row) => {
      const cols = $(row).find('td');
      if (cols.length >= 3) {
        dividends.push({
          fiscal_year: $(cols[0]).text().trim(),
          dividend_percent: this.parseNumber($(cols[1]).text()),
          bonus_percent: this.parseNumber($(cols[2]?.text() || '0')),
          total: this.parseNumber($(cols[3]?.text() || '0'))
        });
      }
    });

    return dividends;
  }

  /**
   * Helper: Parse number from text
   */
  parseNumber(text) {
    if (!text) return null;
    const cleaned = String(text).replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * Clear cache for a specific symbol or all
   */
  clearCache(symbol = null) {
    if (symbol) {
      this.cache.delete(`company_${symbol.toUpperCase()}`);
    } else {
      this.cache.clear();
    }
  }
}

module.exports = new CompanyDetailScraper();