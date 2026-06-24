// scrapers/announcements/announcementScraper.js
const axios = require('axios');
const cheerio = require('cheerio');

class AnnouncementScraper {
  constructor() {
    this.baseUrl = 'https://merolagani.com/AnnouncementList.aspx';
    this.cache = new Map();
    this.cacheTTL = 300000; // 5 minutes
  }

  /**
   * Fetch announcements with optional filters
   * @param {Object} filters - Filter options
   * @param {string} filters.symbol - Company symbol
   * @param {string} filters.sector - Sector name
   * @param {string} filters.fiscalYear - Fiscal year (e.g., '082-083')
   * @param {string} filters.announcementType - Type (AGM, Bonus, Dividend, etc.)
   * @param {number} filters.limit - Number of announcements to return
   * @param {boolean} forceFresh - Bypass cache
   * @returns {Object} Announcements data
   */
  async fetchAnnouncements(filters = {}, forceFresh = false) {
    try {
      const cacheKey = `announcements_${JSON.stringify(filters)}`;
      
      if (!forceFresh && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTTL) {
          return cached.data;
        }
      }

      // Build query parameters
      const params = new URLSearchParams();
      if (filters.symbol) params.append('symbol', filters.symbol.toUpperCase());
      if (filters.sector) params.append('sector', filters.sector);
      if (filters.fiscalYear) params.append('fiscalYear', filters.fiscalYear);
      if (filters.announcementType) params.append('type', filters.announcementType);

      const url = params.toString() ? `${this.baseUrl}?${params.toString()}` : this.baseUrl;

      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      const $ = cheerio.load(response.data);
      const announcements = this.parseAnnouncements($);
      
      // Apply limit
      const limit = filters.limit || 100;
      const limitedAnnouncements = announcements.slice(0, limit);

      const result = {
        success: true,
        count: limitedAnnouncements.length,
        total_available: announcements.length,
        filters: filters,
        data: limitedAnnouncements,
        timestamp: new Date().toISOString()
      };

      this.cache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      console.error('Error fetching announcements:', error.message);
      return {
        success: false,
        error: error.message,
        filters: filters
      };
    }
  }

  /**
   * Parse announcements from HTML
   */
  parseAnnouncements($) {
    const announcements = [];

    // Find announcement items - they appear as list items with date and description
    $('.announcement-item, .announcement-list li, .event-item, .news-item').each((i, element) => {
      const text = $(element).text().trim();
      if (!text) return;

      // Try to extract date and description
      // Pattern: "Date - Description" or "Date Description"
      const dateMatch = text.match(/^([A-Za-z]+\s+\d{1,2},\s+\d{4})/);
      if (!dateMatch) return;

      const dateStr = dateMatch[1];
      const description = text.replace(dateStr, '').replace(/^[\s-]+/, '').trim();

      // Try to extract company symbol/name from description
      const companyMatch = description.match(/([A-Z\s]+?)(?:\s*[-–]\s*|\s*\(|$)/);
      const company = companyMatch ? companyMatch[1].trim() : '';

      // Try to extract announcement type
      const type = this.detectAnnouncementType(description);

      announcements.push({
        date: dateStr,
        date_iso: this.parseDate(dateStr),
        company: company,
        description: description,
        type: type,
        // Try to extract symbol from description
        symbol: this.extractSymbol(description),
        // Try to extract numeric values (dividend %, bonus %, etc.)
        values: this.extractValues(description)
      });
    });

    return announcements;
  }

  /**
   * Detect announcement type from description
   */
  detectAnnouncementType(description) {
    const text = description.toLowerCase();
    if (text.includes('agm')) return 'AGM';
    if (text.includes('bonus share') || text.includes('bonus')) return 'Bonus Share';
    if (text.includes('dividend') || text.includes('cash dividend')) return 'Dividend';
    if (text.includes('ipo')) return 'IPO';
    if (text.includes('right share')) return 'Right Share';
    if (text.includes('tender') || text.includes('auction')) return 'Tender/Auction';
    if (text.includes('nav')) return 'NAV';
    if (text.includes('book closure') || text.includes('bookclosure')) return 'Book Closure';
    if (text.includes('sgm')) return 'SGM';
    if (text.includes('quarterly report')) return 'Quarterly Report';
    if (text.includes('annual report')) return 'Annual Report';
    if (text.includes('financial statement')) return 'Financial Statement';
    if (text.includes('promoter share')) return 'Promoter Share';
    if (text.includes('minutes')) return 'Minutes';
    if (text.includes('interest rate')) return 'Interest Rate';
    return 'General';
  }

  /**
   * Extract symbol from description
   */
  extractSymbol(description) {
    // Look for pattern like (SYMBOL) or "SYMBOL -"
    const symbolMatch = description.match(/\(([A-Z]+)\)/);
    if (symbolMatch) return symbolMatch[1];

    const dashMatch = description.match(/([A-Z]+)\s*[-–]/);
    if (dashMatch) return dashMatch[1];

    // Look for "Company Name (SYMBOL)" pattern
    const companySymbolMatch = description.match(/([A-Z]+)\s*(?:-|–|:|$)/);
    if (companySymbolMatch && companySymbolMatch[1].length >= 3) {
      return companySymbolMatch[1];
    }

    return null;
  }

  /**
   * Extract numeric values from description
   */
  extractValues(description) {
    const values = {};

    // Extract percentage values
    const percentMatches = description.match(/([\d.]+)%/g);
    if (percentMatches) {
      const numbers = percentMatches.map(m => parseFloat(m.replace('%', '')));
      if (numbers.length >= 2) {
        values.bonus_percent = numbers[0];
        values.dividend_percent = numbers[1];
      } else if (numbers.length === 1) {
        values.percent = numbers[0];
      }
    }

    // Extract unit values
    const unitMatches = description.match(/([\d,]+)\s*units/g);
    if (unitMatches) {
      const units = unitMatches.map(m => parseInt(m.replace(/,/g, '').replace(' units', '')));
      values.units = units;
    }

    // Extract price values (Rs. X)
    const priceMatch = description.match(/Rs\.\s*([\d,]+)/);
    if (priceMatch) {
      values.price = parseFloat(priceMatch[1].replace(/,/g, ''));
    }

    return values;
  }

  /**
   * Parse date string to ISO format
   */
  parseDate(dateStr) {
    try {
      const date = new Date(dateStr);
      return date.toISOString().split('T')[0];
    } catch (e) {
      return null;
    }
  }

  /**
   * Get available filter options
   */
  async getFilterOptions() {
    try {
      const response = await axios.get(this.baseUrl, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      const $ = cheerio.load(response.data);
      
      const options = {
        sectors: [],
        fiscalYears: [],
        announcementTypes: []
      };

      // Extract sector options
      $('#sectorSelect option, select[name="sector"] option').each((i, el) => {
        const value = $(el).val();
        if (value && value !== 'All') {
          options.sectors.push(value);
        }
      });

      // Extract fiscal year options
      $('#fiscalYearSelect option, select[name="fiscalYear"] option').each((i, el) => {
        const value = $(el).val();
        if (value && value !== 'All') {
          options.fiscalYears.push(value);
        }
      });

      // Extract announcement type options
      $('#typeSelect option, select[name="type"] option').each((i, el) => {
        const value = $(el).val();
        if (value && value !== 'All') {
          options.announcementTypes.push(value);
        }
      });

      return {
        success: true,
        data: options,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Error fetching filter options:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = new AnnouncementScraper();