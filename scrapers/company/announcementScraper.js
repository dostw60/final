// scrapers/announcements/announcementScraper.js - UPDATED VERSION
const axios = require('axios');

class AnnouncementScraper {
  constructor() {
    this.eventsApiUrl = 'https://www.merolagani.com/handlers/webrequesthandler.ashx';
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

      // Use the events API instead
      const fromDate = filters.fromDate || '1/1/2025';
      const toDate = filters.toDate || '12/31/2026';
      
      const response = await axios.get(this.eventsApiUrl, {
        params: {
          type: 'stock_event',
          fromDate: fromDate,
          toDate: toDate
        },
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      let events = response.data.detail || [];
      
      // Apply filters
      if (filters.symbol) {
        const symbolUpper = filters.symbol.toUpperCase();
        events = events.filter(e => 
          e.announcementDetail.toUpperCase().includes(symbolUpper)
        );
      }
      
      if (filters.announcementType) {
        const typeLower = filters.announcementType.toLowerCase();
        events = events.filter(e => 
          e.announcementDetail.toLowerCase().includes(typeLower)
        );
      }
      
      if (filters.sector) {
        const sectorLower = filters.sector.toLowerCase();
        events = events.filter(e => 
          e.announcementDetail.toLowerCase().includes(sectorLower)
        );
      }

      // Format to match expected output
      const formattedEvents = events.map(event => ({
        date: event.actionDate || 'N/A',
        date_iso: this.parseDate(event.actionDate),
        company: this.extractCompanyName(event.announcementDetail),
        symbol: this.extractSymbol(event.announcementDetail),
        description: event.announcementDetail || '',
        type: this.detectAnnouncementType(event.announcementDetail || ''),
        values: this.extractValues(event.announcementDetail || '')
      }));

      const limit = filters.limit || 100;
      const limitedEvents = formattedEvents.slice(0, limit);

      const result = {
        success: true,
        count: limitedEvents.length,
        total_available: formattedEvents.length,
        filters: filters,
        data: limitedEvents,
        source: 'stock_events_api',
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

  extractCompanyName(text) {
    if (!text) return '';
    // Try to extract company name from the announcement
    const match = text.match(/^([A-Za-z\s]+?)(?:\s*[-–]\s*|\s*\(|$)/);
    return match ? match[1].trim() : '';
  }

  extractSymbol(text) {
    if (!text) return null;
    const match = text.match(/\(([A-Z]+)\)/);
    return match ? match[1] : null;
  }

  detectAnnouncementType(text) {
    if (!text) return 'General';
    const lowerText = text.toLowerCase();
    if (lowerText.includes('agm')) return 'AGM';
    if (lowerText.includes('bonus share') || lowerText.includes('bonus')) return 'Bonus Share';
    if (lowerText.includes('dividend') || lowerText.includes('cash dividend')) return 'Dividend';
    if (lowerText.includes('ipo')) return 'IPO';
    if (lowerText.includes('right share')) return 'Right Share';
    if (lowerText.includes('tender') || lowerText.includes('auction')) return 'Tender/Auction';
    if (lowerText.includes('nav')) return 'NAV';
    if (lowerText.includes('book closure') || lowerText.includes('bookclosure')) return 'Book Closure';
    if (lowerText.includes('sgm')) return 'SGM';
    if (lowerText.includes('quarterly report')) return 'Quarterly Report';
    if (lowerText.includes('annual report')) return 'Annual Report';
    if (lowerText.includes('financial statement')) return 'Financial Statement';
    if (lowerText.includes('promoter share')) return 'Promoter Share';
    if (lowerText.includes('minutes')) return 'Minutes';
    if (lowerText.includes('interest rate')) return 'Interest Rate';
    return 'General';
  }

  extractValues(text) {
    if (!text) return {};
    const values = {};

    const percentMatches = text.match(/([\d.]+)%/g);
    if (percentMatches) {
      const numbers = percentMatches.map(m => parseFloat(m.replace('%', '')));
      if (numbers.length >= 2) {
        values.bonus_percent = numbers[0];
        values.dividend_percent = numbers[1];
      } else if (numbers.length === 1) {
        values.percent = numbers[0];
      }
    }

    const unitMatches = text.match(/([\d,]+)\s*units/g);
    if (unitMatches) {
      values.units = unitMatches.map(m => parseInt(m.replace(/,/g, '').replace(' units', '')));
    }

    const priceMatch = text.match(/Rs\.\s*([\d,]+)/);
    if (priceMatch) {
      values.price = parseFloat(priceMatch[1].replace(/,/g, ''));
    }

    return values;
  }

  parseDate(dateStr) {
    if (!dateStr) return null;
    try {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        // Assuming format MM/DD/YYYY
        const date = new Date(parts[2], parts[0] - 1, parts[1]);
        return date.toISOString().split('T')[0];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = new AnnouncementScraper();