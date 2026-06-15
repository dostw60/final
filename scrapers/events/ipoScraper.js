// scrapers/events/ipoScraper.js
const axios = require('axios');
const { withRetry } = require('../../utils/retry');

class NEPSEIPOScraper {
  constructor() {
    // MeroLagani endpoints for IPO data
    this.MEROLAGANI_STOCK_EVENT_API = 'https://www.merolagani.com/handlers/webrequesthandler.ashx';
    this.cache = new Map();
  }

  /**
   * Fetch IPO data from stock events
   */
  async fetchIPOData() {
    try {
      const cacheKey = 'ipo_data';
      const cached = this.cache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < 3600000) {
        return cached.data;
      }
      
      // Fetch from stock events API
      const now = new Date();
      const fromDate = `1/1/${now.getFullYear() - 1}`;
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
      
      // Filter IPO events
      const ipoEvents = events.filter(event => 
        event.announcementDetail.toLowerCase().includes('ipo') ||
        event.announcementDetail.toLowerCase().includes('initial public offering')
      );
      
      const parsedIPOs = this.parseIPOEvents(ipoEvents);
      
      this.cache.set(cacheKey, { data: parsedIPOs, timestamp: Date.now() });
      
      return parsedIPOs;
      
    } catch (error) {
      console.error('Failed to fetch IPO data:', error.message);
      return [];
    }
  }

  /**
   * Parse IPO events from announcement text
   */
  parseIPOEvents(events) {
    const ipos = [];
    
    for (const event of events) {
      const text = event.announcementDetail;
      
      // Extract company name
      let companyName = this.extractCompanyName(text);
      let symbol = this.extractSymbol(text);
      
      // Extract units
      let units = null;
      const unitsMatch = text.match(/(\d[\d,]+\.?\d*)\s*units/);
      if (unitsMatch) {
        units = parseInt(unitsMatch[1].replace(/,/g, ''));
      }
      
      // Extract issue price
      let issuePrice = 100; // Default face value
      const priceMatch = text.match(/@\s*Rs\.?\s*(\d+(?:\.\d+)?)/i);
      if (priceMatch) {
        issuePrice = parseFloat(priceMatch[1]);
      }
      
      // Extract dates
      let openDate = null;
      let closeDate = null;
      
      // Look for date patterns like "from 18th - 21st Jestha, 2083"
      const dateMatch = text.match(/from\s+(\d+)\w*\s*-\s*(\d+)\w*\s+([^,]+),\s+(\d{4})/i);
      if (dateMatch) {
        // This would need Nepali date conversion - use actionDate as fallback
        openDate = event.actionDate;
        closeDate = event.actionDate;
      }
      
      // Determine status based on dates
      let status = 'upcoming';
      if (openDate) {
        const now = new Date();
        const open = new Date(openDate);
        const close = closeDate ? new Date(closeDate) : open;
        
        if (now < open) status = 'upcoming';
        else if (now >= open && now <= close) status = 'open';
        else status = 'closed';
      }
      
      ipos.push({
        company_name: companyName,
        symbol: symbol,
        issue_type: 'IPO',
        units_available: units,
        issue_price: issuePrice,
        open_date: openDate,
        close_date: closeDate,
        status: status,
        description: text,
        source_date: event.actionDate,
        raw: text
      });
    }
    
    return ipos;
  }

  /**
   * Extract company name from announcement text
   */
  extractCompanyName(text) {
    // Look for patterns like "Company Name Limited"
    const patterns = [
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Limited|Ltd|Bank|Company|Finance|Development|Insurance|Microfinance|Hydropower|Power)))/i,
      /([A-Z][A-Z\s]+(?:Limited|Ltd|Bank|Company))/i,
      /(\w+(?:\s+\w+)*)\s+(?:is going to|has|will)/
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
   * Extract symbol from announcement text
   */
  extractSymbol(text) {
    // Look for symbol in parentheses
    let match = text.match(/\(([A-Z]{3,})\)/);
    if (match) return match[1];
    
    // Look for common patterns
    match = text.match(/-\s.*?\(([A-Z]{3,})\)/);
    if (match) return match[1];
    
    // Check for known symbols
    const knownSymbols = ['NABIL', 'EBL', 'PRVU', 'NIB', 'GBIME', 'SANIMA', 'NICA', 'SOPL', 'APHL', 'MANDU', 'HDHPC'];
    for (const sym of knownSymbols) {
      if (text.includes(sym)) return sym;
    }
    
    return null;
  }

  /**
   * Get upcoming IPOs
   */
  async getUpcomingIPOs() {
    const allIPOs = await this.fetchIPOData();
    const now = new Date();
    
    return allIPOs.filter(ipo => {
      if (!ipo.open_date) return true;
      const openDate = new Date(ipo.open_date);
      return openDate >= now || ipo.status === 'upcoming';
    });
  }

  /**
   * Get active IPOs (currently open for subscription)
   */
  async getActiveIPOs() {
    const allIPOs = await this.fetchIPOData();
    const now = new Date();
    
    return allIPOs.filter(ipo => {
      if (!ipo.open_date || !ipo.close_date) return false;
      const openDate = new Date(ipo.open_date);
      const closeDate = new Date(ipo.close_date);
      return now >= openDate && now <= closeDate;
    });
  }

  /**
   * Get recent IPOs (last 6 months)
   */
  async getRecentIPOs() {
    const allIPOs = await this.fetchIPOData();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    return allIPOs.filter(ipo => {
      if (!ipo.close_date) return false;
      const closeDate = new Date(ipo.close_date);
      return closeDate >= sixMonthsAgo;
    });
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('IPO cache cleared');
  }
}

module.exports = new NEPSEIPOScraper();