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
      
      // Extract data using the actual page structure
      const result = {
        success: true,
        symbol: symbol.toUpperCase(),
        company_details: this.extractCompanyDetails($),
        financial_metrics: this.extractFinancialMetrics($),
        price_data: this.extractPriceData($),
        dividend_data: this.extractDividendData($),
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
   * Extract company details from the page
   * Looking for pattern: Label: Value pairs in the main content
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

    // Get company name from the heading
    const headingText = $('h1').first().text().trim();
    if (headingText) {
      // Extract name and symbol from "Company Name (SYMBOL)"
      const match = headingText.match(/(.+?)\s*\((\w+)\)/);
      if (match) {
        details.name = match[1].trim();
        details.symbol = match[2].trim();
      } else {
        details.name = headingText;
      }
    }

    // Look for all text content and extract key-value pairs
    // The page uses patterns like "Sector Manufacturing And Processing"
    const pageText = $('body').text();
    
    // Extract sector
    const sectorMatch = pageText.match(/Sector\s+([A-Za-z\s]+?)(?=\s+[A-Z][a-z]+|\s+Shares|\s+Market|\s+$)/);
    if (sectorMatch) {
      details.sector = sectorMatch[1].trim();
    }

    // Extract shares outstanding
    const sharesMatch = pageText.match(/Shares Outstanding\s+([\d,]+\.?\d*)/);
    if (sharesMatch) {
      details.shares_outstanding = this.parseNumber(sharesMatch[1]);
      details.listed_shares = details.shares_outstanding;
    }

    // Extract paidup value
    const paidupMatch = pageText.match(/Paidup Value\s+([\d,]+\.?\d*)/);
    if (paidupMatch) {
      details.paidup_value = this.parseNumber(paidupMatch[1]);
    }

    // Extract total paidup value
    const totalPaidupMatch = pageText.match(/Total Paidup Value\s+([\d,]+\.?\d*)/);
    if (totalPaidupMatch) {
      details.total_paidup_value = this.parseNumber(totalPaidupMatch[1]);
    }

    return details;
  }

  /**
   * Extract financial metrics from the page
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

    const pageText = $('body').text();

    // Extract EPS
    const epsMatch = pageText.match(/EPS\s+([\d.]+)/);
    if (epsMatch) {
      metrics.eps = this.parseNumber(epsMatch[1]);
    }

    // Extract P/E Ratio
    const peMatch = pageText.match(/P\/E Ratio\s+([\d.]+)/);
    if (peMatch) {
      metrics.pe_ratio = this.parseNumber(peMatch[1]);
    }

    // Extract Book Value
    const bvMatch = pageText.match(/Book Value\s+([\d.]+)/);
    if (bvMatch) {
      metrics.book_value = this.parseNumber(bvMatch[1]);
    }

    // Extract PBV
    const pbvMatch = pageText.match(/PBV\s+([\d.]+)/);
    if (pbvMatch) {
      metrics.pbv = this.parseNumber(pbvMatch[1]);
    }

    // Extract Market Capitalization
    const mktCapMatch = pageText.match(/Market Capitalization\s+([\d,]+\.?\d*)/);
    if (mktCapMatch) {
      metrics.market_capitalization = this.parseNumber(mktCapMatch[1]);
    }

    // Extract 1 Year Yield
    const yieldMatch = pageText.match(/1 Year Yield\s+([\d.]+%)/);
    if (yieldMatch) {
      metrics.year_1_yield = this.parseNumber(yieldMatch[1]);
    }

    // Extract fiscal year and quarter from EPS context
    const fyMatch = pageText.match(/FY:(\d{2}-\d{2})/);
    if (fyMatch) {
      metrics.fiscal_year = fyMatch[1];
    }
    const qMatch = pageText.match(/Q:(\d+)/);
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

    const pageText = $('body').text();

    // Extract market price
    const priceMatch = pageText.match(/Market Price\s+([\d,]+\.?\d*)/);
    if (priceMatch) {
      data.market_price = this.parseNumber(priceMatch[1]);
    }

    // Extract percent change
    const changeMatch = pageText.match(/% Change\s+([\d.-]+)%/);
    if (changeMatch) {
      data.percent_change = this.parseNumber(changeMatch[1]);
    }

    // Extract last traded on
    const dateMatch = pageText.match(/Last Traded On\s+([\d/]+\s+[\d:]+)/);
    if (dateMatch) {
      data.last_traded_on = dateMatch[1];
    }

    // Extract 52 week high-low
    const highLowMatch = pageText.match(/52 Weeks High - Low\s+([\d.]+)-([\d.]+)/);
    if (highLowMatch) {
      data.week_52_high = this.parseNumber(highLowMatch[1]);
      data.week_52_low = this.parseNumber(highLowMatch[2]);
    }

    // Extract averages
    const avg180Match = pageText.match(/180 Day Average\s+([\d,]+\.?\d*)/);
    if (avg180Match) {
      data.day_180_avg = this.parseNumber(avg180Match[1]);
    }

    const avg120Match = pageText.match(/120 Day Average\s+([\d,]+\.?\d*)/);
    if (avg120Match) {
      data.day_120_avg = this.parseNumber(avg120Match[1]);
    }

    // Extract volume
    const volMatch = pageText.match(/30-Day Avg Volume\s+([\d,]+\.?\d*)/);
    if (volMatch) {
      data.day_30_avg_volume = this.parseNumber(volMatch[1]);
    }

    return data;
  }

  /**
   * Extract dividend and bonus data
   */
  extractDividendData($) {
    const data = {
      percent_dividend: null,
      percent_bonus: null,
      right_share: null,
      dividend_history: []
    };

    const pageText = $('body').text();

    // Extract dividend
    const divMatch = pageText.match(/% Dividend\s+([\d.]+)/);
    if (divMatch) {
      data.percent_dividend = this.parseNumber(divMatch[1]);
    }

    // Extract bonus
    const bonusMatch = pageText.match(/% Bonus\s+([\d.]+)/);
    if (bonusMatch) {
      data.percent_bonus = this.parseNumber(bonusMatch[1]);
    }

    // Extract right share
    const rightMatch = pageText.match(/Right Share\s+([\d:]+)/);
    if (rightMatch) {
      data.right_share = rightMatch[1];
    }

    // Try to extract dividend history from tables
    $('table').each((i, table) => {
      const tableText = $(table).text();
      if (tableText.includes('Fiscal Year') && 
          (tableText.includes('Dividend') || tableText.includes('Bonus'))) {
        
        $(table).find('tr').each((j, row) => {
          if (j === 0) return; // Skip header
          const cols = $(row).find('td');
          if (cols.length >= 2) {
            const fiscalYear = $(cols[0]).text().trim();
            const dividend = this.parseNumber($(cols[1]).text());
            const bonus = cols.length > 2 ? this.parseNumber($(cols[2]).text()) : 0;
            
            if (fiscalYear && (dividend !== null || bonus !== null)) {
              data.dividend_history.push({
                fiscal_year: fiscalYear,
                dividend_percent: dividend || 0,
                bonus_percent: bonus || 0,
                total_percent: (dividend || 0) + (bonus || 0)
              });
            }
          }
        });
      }
    });

    return data;
  }

  /**
   * Extract "About" section
   */
  extractAbout($) {
    let aboutText = '';
    
    // Look for about section
    $('div').each((i, el) => {
      const text = $(el).text().trim();
      if (text.includes('About') && text.length > 50) {
        // Extract the description
        const aboutMatch = text.match(/About[^]*?([A-Z][^.]+\.[^.]*)/);
        if (aboutMatch) {
          aboutText = aboutMatch[1].trim();
        }
      }
    });

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