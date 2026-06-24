// scrapers/company/companyDetailScraper.js
const axios = require('axios');
const cheerio = require('cheerio');

class CompanyDetailScraper {
  constructor() {
    this.baseUrl = 'https://merolagani.com/CompanyDetail.aspx';
    this.cache = new Map();
    this.cacheTTL = 3600000; // 1 hour
  }

  async fetchCompanyDetails(symbol, forceFresh = false) {
    try {
      const cacheKey = `company_${symbol.toUpperCase()}`;
      
      if (!forceFresh && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTTL) {
          return cached.data;
        }
      }

      const response = await axios.get(this.baseUrl, {
        params: { symbol: symbol.toUpperCase() },
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      const $ = cheerio.load(response.data);
      
      // Extract all data sections
      const result = {
        success: true,
        symbol: symbol.toUpperCase(),
        company_details: this.extractCompanyDetails($),
        financial_metrics: this.extractFinancialMetrics($),
        price_data: this.extractPriceData($),
        dividend_data: this.extractDividendData($),
        about: this.extractAbout($),
        // Note: These sections require additional API calls or tab clicks
        // We'll handle them separately
        announcements: [],
        news: [],
        price_history: [],
        floorsheet: [],
        agm: [],
        quarterly_report: [],
        tender_auction: [],
        major_shareholders: []
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
   * Extract basic company details from the top section
   */
  extractCompanyDetails($) {
    const details = {
      name: '',
      symbol: '',
      sector: '',
      shares_outstanding: null,
      paidup_value: null,
      total_paidup_value: null,
      listed_shares: null
    };

    // Company name and symbol - from the header
    const headerText = $('h1, .company-name, .stock-name').first().text().trim();
    if (headerText) {
      const match = headerText.match(/(.+?)\s*\((\w+)\)/);
      if (match) {
        details.name = match[1].trim();
        details.symbol = match[2].trim();
      } else {
        details.name = headerText;
      }
    }

    // Find all detail rows in the company info section
    $('.company-info tr, .detail-row, .info-row').each((i, row) => {
      const label = $(row).find('td:first-child, .label, th').text().trim();
      const value = $(row).find('td:last-child, .value').text().trim();

      if (label.includes('Sector')) {
        details.sector = value;
      } else if (label.includes('Shares Outstanding') || label.includes('Listed Shares')) {
        details.shares_outstanding = this.parseNumber(value);
        details.listed_shares = this.parseNumber(value);
      } else if (label.includes('Paidup Value')) {
        details.paidup_value = this.parseNumber(value);
      } else if (label.includes('Total Paidup Value')) {
        details.total_paidup_value = this.parseNumber(value);
      }
    });

    return details;
  }

  /**
   * Extract financial metrics from the main data panel
   */
  extractFinancialMetrics($) {
    const metrics = {
      eps: null,
      pe_ratio: null,
      book_value: null,
      pbv: null,
      market_capitalization: null,
      year_1_yield: null,
      fiscal_year: null,
      quarter: null,
      sector: null
    };

    // Look for the key metrics in the page
    // These appear in the "Discover more" section or main data panel
    const metricLabels = [
      'EPS', 'P/E Ratio', 'Book Value', 'PBV', 
      'Market Capitalization', '1 Year Yield', 'Sector'
    ];

    $('.metric-item, .stat-item, .data-point').each((i, el) => {
      const text = $(el).text().trim();
      for (const label of metricLabels) {
        if (text.includes(label)) {
          const value = text.replace(label, '').replace(/[:\s]+/g, '').trim();
          const numValue = this.parseNumber(value);
          
          if (label === 'EPS') metrics.eps = numValue;
          else if (label === 'P/E Ratio') metrics.pe_ratio = numValue;
          else if (label === 'Book Value') metrics.book_value = numValue;
          else if (label === 'PBV') metrics.pbv = numValue;
          else if (label === 'Market Capitalization') metrics.market_capitalization = numValue;
          else if (label === '1 Year Yield') metrics.year_1_yield = numValue;
          else if (label === 'Sector') metrics.sector = value;
        }
      }
    });

    // Check for fiscal year info in EPS
    const epsText = $('*:contains("EPS")').text();
    const fyMatch = epsText.match(/FY:(\d{2}-\d{2})/);
    if (fyMatch) {
      metrics.fiscal_year = fyMatch[1];
    }
    const qMatch = epsText.match(/Q:(\d+)/);
    if (qMatch) {
      metrics.quarter = qMatch[1];
    }

    return metrics;
  }

  /**
   * Extract price and trading data
   */
  extractPriceData($) {
    const data = {
      market_price: null,
      percent_change: null,
      last_traded_on: null,
      week_52_high: null,
      week_52_low: null,
      day_180_avg: null,
      day_120_avg: null,
      day_30_avg_volume: null,
      previous_close: null,
      open: null,
      high: null,
      low: null
    };

    // Extract from the main price display
    $('.price-display, .stock-price, .current-price').each((i, el) => {
      const text = $(el).text().trim();
      const numValue = this.parseNumber(text);
      if (numValue !== null && !data.market_price) {
        data.market_price = numValue;
      }
    });

    // Look for change percentage
    const changeText = $('.change-percent, .price-change').text().trim();
    if (changeText) {
      data.percent_change = this.parseNumber(changeText);
    }

    // Look for date/time
    const dateText = $('.last-traded, .trade-date').text().trim();
    if (dateText) {
      data.last_traded_on = dateText;
    }

    // Scan for other metrics in text
    $('*').each((i, el) => {
      const text = $(el).text().trim();
      
      if (text.includes('52 Weeks High - Low')) {
        const match = text.match(/([\d.]+)\s*-\s*([\d.]+)/);
        if (match) {
          data.week_52_high = this.parseNumber(match[1]);
          data.week_52_low = this.parseNumber(match[2]);
        }
      }
      
      if (text.includes('Day Average')) {
        const match = text.match(/(\d+)\s*Day Average\s*([\d.]+)/i);
        if (match) {
          const days = parseInt(match[1]);
          const value = this.parseNumber(match[2]);
          if (days === 180) data.day_180_avg = value;
          else if (days === 120) data.day_120_avg = value;
        }
      }
      
      if (text.includes('Avg Volume')) {
        const match = text.match(/Avg Volume\s*([\d,]+)/i);
        if (match) {
          data.day_30_avg_volume = this.parseNumber(match[1]);
        }
      }
    });

    return data;
  }

  /**
   * Extract dividend and bonus data from the dividend section
   */
  extractDividendData($) {
    const data = {
      percent_dividend: null,
      percent_bonus: null,
      right_share: null,
      dividend_history: []
    };

    // Extract from the dividend display section
    $('.dividend-display, .dividend-info').each((i, el) => {
      const text = $(el).text().trim();
      
      if (text.includes('% Dividend')) {
        const match = text.match(/% Dividend\s*([\d.]+)/i);
        if (match) data.percent_dividend = this.parseNumber(match[1]);
      }
      
      if (text.includes('% Bonus')) {
        const match = text.match(/% Bonus\s*([\d.]+)/i);
        if (match) data.percent_bonus = this.parseNumber(match[1]);
      }
      
      if (text.includes('Right Share')) {
        const match = text.match(/Right Share\s*([\d:]+)/i);
        if (match) data.right_share = match[1];
      }
    });

    // Extract dividend history table
    $('.dividend-history-table tr, .dividend-table tr').each((i, row) => {
      if (i === 0) return; // Skip header
      const cols = $(row).find('td');
      if (cols.length >= 2) {
        data.dividend_history.push({
          fiscal_year: $(cols[0]).text().trim(),
          dividend_percent: this.parseNumber($(cols[1]).text()),
          bonus_percent: this.parseNumber($(cols[2]?.text() || '0')),
          total_percent: this.parseNumber($(cols[3]?.text() || '0'))
        });
      }
    });

    return data;
  }

  /**
   * Extract the "About" section
   */
  extractAbout($) {
    let aboutText = '';
    
    $('.about-section, .company-description, #about').each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 20) {
        aboutText = text;
      }
    });

    // If no about section found, look for description in meta
    if (!aboutText) {
      const metaDesc = $('meta[name="description"]').attr('content');
      if (metaDesc) aboutText = metaDesc;
    }

    return aboutText;
  }

  /**
   * Helper: Parse number from text
   */
  parseNumber(text) {
    if (!text) return null;
    if (typeof text === 'number') return isNaN(text) ? null : text;
    
    // Remove commas and special characters
    const cleaned = String(text).replace(/,/g, '').replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * Fetch additional tab data (requires separate API calls)
   */
  async fetchTabData(symbol, tabName) {
    // Merolagani likely uses JavaScript to load tab data
    // You may need to find the actual API endpoints
    // For now, return empty array
    return [];
  }

  clearCache(symbol = null) {
    if (symbol) {
      this.cache.delete(`company_${symbol.toUpperCase()}`);
    } else {
      this.cache.clear();
    }
  }
}

module.exports = new CompanyDetailScraper();