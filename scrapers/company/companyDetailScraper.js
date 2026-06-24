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
      const pageText = $('body').text();
      
      const result = {
        success: true,
        symbol: symbol.toUpperCase(),
        company_details: this.extractCompanyDetails(pageText),
        financial_metrics: this.extractFinancialMetrics(pageText),
        price_data: this.extractPriceData(pageText),
        dividend_data: this.extractDividendData(pageText),
        about: this.extractAbout($),
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
   * Extract company details from page text
   */
  extractCompanyDetails(text) {
    const details = {
      name: '',
      symbol: '',
      sector: '',
      shares_outstanding: null,
      paidup_value: null,
      total_paidup_value: null,
      listed_shares: null
    };

    // Extract sector - improved pattern
    const sectorMatch = text.match(/Sector\s+([A-Za-z\s]+?)(?=\s+(?:Shares|Market|%|EPS|P\/E|Book|PBV|Year|Day|Fiscal|Total|Listed|Paidup|Manufacturing|Commercial|Development|Finance|Hotel|Hydro|Investment|Life|Microfinance|Mutual|Non-Life|Others|Preferred|Promotor|Trading|Capital|Corporate|Government))/);
    if (sectorMatch) {
      details.sector = sectorMatch[1].trim();
    }

    // If sector not found, try alternative pattern
    if (!details.sector) {
      const altSectorMatch = text.match(/Sector\s+([A-Za-z\s]+?)(?=\d|$)/);
      if (altSectorMatch) {
        details.sector = altSectorMatch[1].trim();
      }
    }

    // Extract shares outstanding
    const sharesMatch = text.match(/Shares Outstanding\s+([\d,]+\.?\d*)/);
    if (sharesMatch) {
      details.shares_outstanding = this.parseNumber(sharesMatch[1]);
      details.listed_shares = details.shares_outstanding;
    }

    // Extract paidup value
    const paidupMatch = text.match(/Paidup Value\s+([\d,]+\.?\d*)/);
    if (paidupMatch) {
      details.paidup_value = this.parseNumber(paidupMatch[1]);
    }

    // Extract total paidup value
    const totalPaidupMatch = text.match(/Total Paidup Value\s+([\d,]+\.?\d*)/);
    if (totalPaidupMatch) {
      details.total_paidup_value = this.parseNumber(totalPaidupMatch[1]);
    }

    return details;
  }

  /**
   * Extract financial metrics
   */
  extractFinancialMetrics(text) {
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

    // Extract EPS
    const epsMatch = text.match(/EPS\s+([\d.]+)/);
    if (epsMatch) {
      metrics.eps = this.parseNumber(epsMatch[1]);
    }

    // Extract P/E Ratio
    const peMatch = text.match(/P\/E Ratio\s+([\d.]+)/);
    if (peMatch) {
      metrics.pe_ratio = this.parseNumber(peMatch[1]);
    }

    // Extract Book Value
    const bvMatch = text.match(/Book Value\s+([\d.]+)/);
    if (bvMatch) {
      metrics.book_value = this.parseNumber(bvMatch[1]);
    }

    // Extract PBV
    const pbvMatch = text.match(/PBV\s+([\d.]+)/);
    if (pbvMatch) {
      metrics.pbv = this.parseNumber(pbvMatch[1]);
    }

    // Extract Market Capitalization
    const mktCapMatch = text.match(/Market Capitalization\s+([\d,]+\.?\d*)/);
    if (mktCapMatch) {
      metrics.market_capitalization = this.parseNumber(mktCapMatch[1]);
    }

    // Extract 1 Year Yield
    const yieldMatch = text.match(/1 Year Yield\s+([\d.]+%)/);
    if (yieldMatch) {
      metrics.year_1_yield = this.parseNumber(yieldMatch[1]);
    }

    // Extract fiscal year and quarter
    const fyMatch = text.match(/FY:(\d{2}-\d{2})/);
    if (fyMatch) {
      metrics.fiscal_year = fyMatch[1];
    }
    const qMatch = text.match(/Q:(\d+)/);
    if (qMatch) {
      metrics.quarter = qMatch[1];
    }

    return metrics;
  }

  /**
   * Extract price and trading data - FIXED
   */
  extractPriceData(text) {
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

    // Extract market price
    const priceMatch = text.match(/Market Price\s+([\d,]+\.?\d*)/);
    if (priceMatch) {
      data.market_price = this.parseNumber(priceMatch[1]);
    }

    // Extract percent change - FIXED: handle negative values and % symbol
    const changeMatch = text.match(/% Change\s+(-?[\d.]+)%/);
    if (changeMatch) {
      data.percent_change = this.parseNumber(changeMatch[1]);
    }

    // Extract last traded on
    const dateMatch = text.match(/Last Traded On\s+([\d/]+\s+[\d:]+)/);
    if (dateMatch) {
      data.last_traded_on = dateMatch[1];
    }

    // Extract 52 week high-low - FIXED: handle the pattern
    const highLowMatch = text.match(/52 Weeks High - Low\s+([\d.]+)-([\d.]+)/);
    if (highLowMatch) {
      data.week_52_high = this.parseNumber(highLowMatch[1]);
      data.week_52_low = this.parseNumber(highLowMatch[2]);
    }

    // Extract averages
    const avg180Match = text.match(/180 Day Average\s+([\d,]+\.?\d*)/);
    if (avg180Match) {
      data.day_180_avg = this.parseNumber(avg180Match[1]);
    }

    const avg120Match = text.match(/120 Day Average\s+([\d,]+\.?\d*)/);
    if (avg120Match) {
      data.day_120_avg = this.parseNumber(avg120Match[1]);
    }

    // Extract volume
    const volMatch = text.match(/30-Day Avg Volume\s+([\d,]+\.?\d*)/);
    if (volMatch) {
      data.day_30_avg_volume = this.parseNumber(volMatch[1]);
    }

    return data;
  }

  /**
   * Extract dividend data - FIXED
   */
  extractDividendData(text) {
    const data = {
      percent_dividend: null,
      percent_bonus: null,
      right_share: null,
      dividend_history: []
    };

    // Extract dividend - look for # pattern or actual value
    const divMatch = text.match(/% Dividend\s+(?:#|([\d.]+))/);
    if (divMatch && divMatch[1]) {
      data.percent_dividend = this.parseNumber(divMatch[1]);
    }

    // Extract bonus
    const bonusMatch = text.match(/% Bonus\s+(?:#|([\d.]+))/);
    if (bonusMatch && bonusMatch[1]) {
      data.percent_bonus = this.parseNumber(bonusMatch[1]);
    }

    // Extract right share
    const rightMatch = text.match(/Right Share\s+(?:#|([\d:]+))/);
    if (rightMatch && rightMatch[1]) {
      data.right_share = rightMatch[1];
    }

    // Extract dividend history from the page
    // Look for patterns like "081-082 26.00 10.00 36.00"
    const historyRegex = /(\d{2}-\d{2})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g;
    let match;
    while ((match = historyRegex.exec(text)) !== null) {
      // Check if this looks like dividend data
      const fiscalYear = match[1];
      const dividend = this.parseNumber(match[2]);
      const bonus = this.parseNumber(match[3]);
      const total = this.parseNumber(match[4]);
      
      // Only add if it's a valid fiscal year format
      if (fiscalYear.match(/\d{2}-\d{2}/)) {
        data.dividend_history.push({
          fiscal_year: fiscalYear,
          dividend_percent: dividend || 0,
          bonus_percent: bonus || 0,
          total_percent: total || 0
        });
      }
    }

    return data;
  }

  /**
   * Extract "About" section
   */
  extractAbout($) {
    let aboutText = '';
    
    // Look for about section in the page
    $('div, p, .description, .about').each((i, el) => {
      const text = $(el).text().trim();
      if (text.length > 100 && 
          (text.includes('About') || text.includes('Company') || text.includes('Limited'))) {
        // Try to get meaningful text
        const sentences = text.split(/[.!?]+/);
        if (sentences.length > 1) {
          aboutText = sentences.slice(0, 3).join('. ') + '.';
        }
      }
    });

    // If no about found, try meta description
    if (!aboutText) {
      const metaDesc = $('meta[name="description"]').attr('content');
      if (metaDesc) aboutText = metaDesc;
    }

    return aboutText;
  }

  /**
   * Parse number from text with commas
   */
  parseNumber(text) {
    if (!text) return null;
    if (typeof text === 'number') return isNaN(text) ? null : text;
    
    // Remove commas, spaces, and special characters
    const cleaned = String(text).replace(/,/g, '').replace(/\s/g, '').replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * Clear cache
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