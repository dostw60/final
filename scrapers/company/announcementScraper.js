// scrapers/announcements/announcementScraper.js
const axios = require('axios');
const cheerio = require('cheerio');

class AnnouncementScraper {
  constructor() {
    this.baseUrl = 'https://merolagani.com/AnnouncementList.aspx';
    this.cache = new Map();
    this.cacheTTL = 300000; // 5 minutes
  }

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

  parseAnnouncements($) {
    const announcements = [];

    // Look for announcement items in the page
    // The page shows announcements in a list format
    $('.announcement-item, .announcement-list li, .event-item, .news-item, .list-group-item').each((i, element) => {
      const text = $(element).text().trim();
      if (!text || text.length < 20) return;

      // Try to extract date - looks for "Month DD, YYYY" pattern
      const dateMatch = text.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
      if (!dateMatch) return;

      const dateStr = `${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`;
      const description = text.replace(dateStr, '').replace(/^[\s-]+/, '').trim();

      // Try to extract company symbol from description
      const symbolMatch = description.match(/\(([A-Z]+)\)/);
      const symbol = symbolMatch ? symbolMatch[1] : null;

      // Try to extract company name
      const companyMatch = description.match(/^([A-Za-z\s]+?)(?:\s*[-–]\s*|\s*\(|$)/);
      const company = companyMatch ? companyMatch[1].trim() : '';

      // Detect announcement type
      const type = this.detectAnnouncementType(description);

      announcements.push({
        date: dateStr,
        date_iso: this.parseDate(dateStr),
        company: company,
        symbol: symbol,
        description: description,
        type: type,
        values: this.extractValues(description)
      });
    });

    return announcements;
  }

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
      values.units = unitMatches.map(m => parseInt(m.replace(/,/g, '').replace(' units', '')));
    }

    // Extract price values
    const priceMatch = description.match(/Rs\.\s*([\d,]+)/);
    if (priceMatch) {
      values.price = parseFloat(priceMatch[1].replace(/,/g, ''));
    }

    return values;
  }

  parseDate(dateStr) {
    try {
      const date = new Date(dateStr);
      return date.toISOString().split('T')[0];
    } catch (e) {
      return null;
    }
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = new AnnouncementScraper();