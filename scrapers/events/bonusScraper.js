// scrapers/events/bonusScraper.js
const axios = require('axios');
const { withRetry } = require('../../utils/retry');

class NEPSEBonusScraper {
  constructor() {
    this.MEROLAGANI_STOCK_EVENT_API = 'https://www.merolagani.com/handlers/webrequesthandler.ashx';
    this.cache = new Map();
  }

  /**
   * Fetch all bonus share announcements
   */
  async fetchBonusShares(fiscalYear = null) {
    try {
      console.log(`Fetching bonus shares data${fiscalYear ? ` for FY ${fiscalYear}` : ''}`);
      
      const bonusData = await withRetry(
        () => this.fetchFromStockEvents(),
        { retries: 2, delay: 2000 }
      );
      
      // Filter by fiscal year if specified
      let filtered = bonusData;
      if (fiscalYear) {
        filtered = bonusData.filter(b => b.fiscal_year === fiscalYear);
      }
      
      return {
        success: true,
        count: filtered.length,
        data: filtered,
        fiscalYear
      };
      
    } catch (error) {
      console.error('Failed to fetch bonus shares:', error.message);
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Fetch from stock events API (reliable source)
   */
  async fetchFromStockEvents() {
    const cacheKey = 'bonus_data';
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
    
    // Filter bonus-related events
    const bonusEvents = events.filter(event => {
      const text = event.announcementDetail.toLowerCase();
      return text.includes('bonus') || 
             text.includes('bonus share') || 
             text.includes('bonus shares');
    });
    
    const parsedBonuses = this.parseBonusEvents(bonusEvents);
    
    this.cache.set(cacheKey, { data: parsedBonuses, timestamp: Date.now() });
    
    return parsedBonuses;
  }

  /**
   * Parse bonus events from announcement text
   */
  parseBonusEvents(events) {
    const bonuses = [];
    
    for (const event of events) {
      const text = event.announcementDetail;
      
      // Extract company name and symbol
      let companyName = this.extractCompanyName(text);
      let symbol = this.extractSymbol(text);
      
      // Extract bonus percentage
      const bonusPercent = this.extractBonusPercent(text);
      
      // Extract fiscal year
      const fiscalYear = this.extractFiscalYear(text);
      
      // Extract dates
      const announcementDate = event.actionDate;
      let bookClosureDate = this.extractBookClosureDate(text);
      let distributionDate = this.extractDistributionDate(text);
      
      // Determine status
      let status = this.determineStatus(announcementDate, bookClosureDate);
      
      // Extract bonus ratio (e.g., "1:0.5" or "10%")
      let bonusRatio = null;
      if (bonusPercent > 0) {
        bonusRatio = `${bonusPercent}:100`;
      }
      
      // Extract shares information
      let bonusShares = null;
      let previousShares = null;
      
      // Look for patterns like "XX,XX,XXX units"
      const sharesMatch = text.match(/(\d[\d,]+\.?\d*)\s*units/);
      if (sharesMatch) {
        bonusShares = parseInt(sharesMatch[1].replace(/,/g, ''));
      }
      
      bonuses.push({
        company_name: companyName,
        symbol: symbol,
        bonus_percent: bonusPercent,
        bonus_ratio: bonusRatio,
        bonus_shares: bonusShares,
        previous_shares: previousShares,
        announcement_date: announcementDate,
        book_closure_date: bookClosureDate,
        distribution_date: distributionDate,
        fiscal_year: fiscalYear,
        status: status,
        description: text,
        source_date: event.actionDate,
        raw: text
      });
    }
    
    return bonuses;
  }

  /**
   * Extract company name from text
   */
  extractCompanyName(text) {
    // Look for patterns like "Company Name Limited"
    const patterns = [
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Limited|Ltd|Bank|Company|Finance|Development|Insurance)))/i,
      /-\s*([A-Z][A-Za-z\s]+(?:Limited|Ltd|Bank|Company))/i,
      /([A-Z][A-Za-z\s]+(?:Limited|Ltd))\s+(?:has|will|is)/i
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
   * Extract bonus percentage from text
   */
  extractBonusPercent(text) {
    // Patterns like "10% bonus share" or "Bonus: 10%"
    const patterns = [
      /(\d+(?:\.\d+)?)%?\s*(?:bonus|Bonus)\s*(?:share|Share|shares|Shares)/i,
      /(?:bonus|Bonus)\s*(?:share|Share)\s*:?\s*(\d+(?:\.\d+)?)%/i,
      /(\d+(?:\.\d+)?)%\s*(?:bonus|Bonus)/i,
      /(\d+(?:\.\d+)?):100/i,
      /(\d+(?:\.\d+)?)\s*%\s*(?:bonus)/i
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
   * Extract distribution date
   */
  extractDistributionDate(text) {
    // Patterns like "distributed on Jestha 19, 2083"
    const match = text.match(/distributed\s*(?:on|from)\s*([^.,]+)/i);
    if (match) {
      return match[1].trim();
    }
    return null;
  }

  /**
   * Determine bonus share status
   */
  determineStatus(announcementDate, bookClosureDate) {
    if (!announcementDate) return 'pending';
    
    const now = new Date();
    const announceDate = new Date(announcementDate);
    
    if (now < announceDate) return 'announced';
    
    if (bookClosureDate) {
      const closureDate = new Date(bookClosureDate);
      if (now >= announceDate && now <= closureDate) return 'book_closure_open';
      if (now > closureDate) return 'distributed';
    }
    
    return 'approved';
  }

  /**
   * Get bonus shares by company
   */
  async getBonusByCompany(symbol, limit = 10) {
    const result = await this.fetchBonusShares();
    const filtered = result.data.filter(b => 
      b.symbol && b.symbol.toUpperCase() === symbol.toUpperCase()
    );
    return filtered.slice(0, limit);
  }

  /**
   * Get upcoming bonus announcements
   */
  async getUpcomingBonus(limit = 20) {
    const result = await this.fetchBonusShares();
    const now = new Date();
    
    const upcoming = result.data.filter(b => {
      if (!b.announcement_date) return false;
      const announceDate = new Date(b.announcement_date);
      return announceDate >= now && b.status !== 'distributed';
    });
    
    return upcoming.slice(0, limit);
  }

  /**
   * Get bonus history by fiscal year
   */
  async getBonusHistory(fiscalYear) {
    const result = await this.fetchBonusShares();
    return result.data.filter(b => b.fiscal_year === fiscalYear);
  }

  /**
   * Get total bonus shares statistics
   */
  async getTotalBonusShares(fiscalYear) {
    const result = await this.fetchBonusShares();
    const filtered = result.data.filter(b => b.fiscal_year === fiscalYear);
    
    if (filtered.length === 0) {
      return {
        total_companies: 0,
        total_bonus_percent: 0,
        average_bonus_percent: 0
      };
    }
    
    const totalBonus = filtered.reduce((sum, b) => sum + (b.bonus_percent || 0), 0);
    
    return {
      total_companies: filtered.length,
      total_bonus_percent: totalBonus,
      average_bonus_percent: parseFloat((totalBonus / filtered.length).toFixed(2))
    };
  }

  /**
   * Calculate bonus impact on price
   */
  async calculateBonusImpact(symbol, currentPrice) {
    const bonuses = await this.getBonusByCompany(symbol, 1);
    
    if (bonuses.length === 0) {
      return null;
    }
    
    const bonus = bonuses[0];
    const bonusPercent = bonus.bonus_percent;
    
    if (!bonusPercent || bonusPercent === 0) {
      return null;
    }
    
    const adjustedPrice = (currentPrice * 100) / (100 + bonusPercent);
    const priceReduction = currentPrice - adjustedPrice;
    
    return {
      symbol: symbol.toUpperCase(),
      company_name: bonus.company_name,
      bonus_percent: bonusPercent,
      current_price: currentPrice,
      adjusted_price: parseFloat(adjustedPrice.toFixed(2)),
      price_reduction: parseFloat(priceReduction.toFixed(2)),
      adjustment_factor: parseFloat((100 / (100 + bonusPercent)).toFixed(4)),
      announcement_date: bonus.announcement_date
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('Bonus cache cleared');
  }
}

module.exports = new NEPSEBonusScraper();