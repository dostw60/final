// scrapers/events/bonusScraper.js
const axios = require('axios');

class NEPSEBonusScraper {
  constructor() {
    this.MEROLAGANI_STOCK_EVENT_API = 'https://www.merolagani.com/handlers/webrequesthandler.ashx';
    this.cache = new Map();
  }

  async fetchBonusShares(fiscalYear = null) {
    try {
      const bonusData = await this.fetchFromStockEvents();
      let filtered = bonusData;
      if (fiscalYear) {
        filtered = bonusData.filter(b => b.fiscal_year === fiscalYear);
      }
      return { success: true, count: filtered.length, data: filtered };
    } catch (error) {
      console.error('Failed to fetch bonus shares:', error.message);
      return { success: false, error: error.message, data: [] };
    }
  }

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
      params: { type: 'stock_event', fromDate: fromDate, toDate: toDate },
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    
    const events = response.data.detail || [];
    const bonusEvents = events.filter(event => {
      const text = event.announcementDetail.toLowerCase();
      return text.includes('bonus') || text.includes('bonus share');
    });
    
    const parsedBonuses = this.parseBonusEvents(bonusEvents);
    this.cache.set(cacheKey, { data: parsedBonuses, timestamp: Date.now() });
    
    return parsedBonuses;
  }

  parseBonusEvents(events) {
    const bonuses = [];
    for (const event of events) {
      const text = event.announcementDetail;
      bonuses.push({
        company_name: this.extractCompanyName(text),
        symbol: this.extractSymbol(text),
        bonus_percent: this.extractBonusPercent(text),
        announcement_date: event.actionDate,
        description: text
      });
    }
    return bonuses;
  }

  extractCompanyName(text) {
    const patterns = [
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Limited|Ltd|Bank|Company)))/i,
      /-\s*([A-Z][A-Za-z\s]+(?:Limited|Ltd|Bank))/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) return match[1].trim();
    }
    return null;
  }

  extractSymbol(text) {
    let match = text.match(/\(([A-Z]{3,})\)/);
    if (match) return match[1];
    
    const knownSymbols = ['NABIL', 'EBL', 'PRVU', 'NIB', 'GBIME', 'SANIMA', 'NICA'];
    for (const sym of knownSymbols) {
      if (text.includes(sym)) return sym;
    }
    return null;
  }

  extractBonusPercent(text) {
    const match = text.match(/(\d+(?:\.\d+)?)%?\s*(?:bonus|Bonus)/i);
    return match ? parseFloat(match[1]) : 0;
  }

  async getBonusByCompany(symbol, limit = 10) {
    const result = await this.fetchBonusShares();
    const filtered = result.data.filter(b => b.symbol === symbol.toUpperCase());
    return filtered.slice(0, limit);
  }

  async getUpcomingBonus(limit = 20) {
    const result = await this.fetchBonusShares();
    const now = new Date();
    const upcoming = result.data.filter(b => {
      if (!b.announcement_date) return false;
      return new Date(b.announcement_date) >= now;
    });
    return upcoming.slice(0, limit);
  }

  async getBonusHistory(fiscalYear) {
    const result = await this.fetchBonusShares();
    return result.data.filter(b => b.fiscal_year === fiscalYear);
  }

  async getTotalBonusShares(fiscalYear) {
    const result = await this.fetchBonusShares();
    const filtered = result.data.filter(b => b.fiscal_year === fiscalYear);
    const totalBonus = filtered.reduce((sum, b) => sum + (b.bonus_percent || 0), 0);
    return {
      total_companies: filtered.length,
      total_bonus_percent: totalBonus,
      average_bonus_percent: filtered.length > 0 ? parseFloat((totalBonus / filtered.length).toFixed(2)) : 0
    };
  }

  async calculateBonusImpact(symbol, currentPrice) {
    const bonuses = await this.getBonusByCompany(symbol, 1);
    if (bonuses.length === 0) return null;
    
    const bonus = bonuses[0];
    const bonusPercent = bonus.bonus_percent;
    if (!bonusPercent) return null;
    
    const adjustedPrice = (currentPrice * 100) / (100 + bonusPercent);
    return {
      symbol: symbol.toUpperCase(),
      bonus_percent: bonusPercent,
      current_price: currentPrice,
      adjusted_price: parseFloat(adjustedPrice.toFixed(2)),
      price_reduction: parseFloat((currentPrice - adjustedPrice).toFixed(2))
    };
  }
}

module.exports = new NEPSEBonusScraper();