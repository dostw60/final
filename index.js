// index.js - COMPLETE PRODUCTION READY VERSION WITH UNIVERSAL CHART & COMPANY DETAILS & ANNOUNCEMENTS & FLOOR SHEET
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// Simple in-memory cache
const cache = new Map();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// ============ LIVE PRICE SCRAPER ============
class LivePriceScraper {
  constructor() {
    this.MEROLAGANI_MARKET_API = 'https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary';
    this.cache = new Map();
    this.lastRequestTime = 0;
    this.requestDelay = 2000;
  }

  isMarketOpen() {
    const now = new Date();
    const nepalTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
    const hour = nepalTime.getHours();
    const day = nepalTime.getDay();
    const isWeekday = day >= 0 && day <= 4;
    const isTradingHour = hour >= 11 && hour <= 15;
    return isWeekday && isTradingHour;
  }

  getCacheTTL() {
    return this.isMarketOpen() ? 2000 : 30000;
  }

  async getCurrentPrices(forceFresh = false) {
    try {
      const cacheKey = 'live_prices_all';
      const cached = this.cache.get(cacheKey);
      const cacheTTL = this.getCacheTTL();
      
      if (!forceFresh && cached && Date.now() - cached.timestamp < cacheTTL) {
        return cached.data;
      }
      
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.requestDelay) {
        await new Promise(resolve => setTimeout(resolve, this.requestDelay - timeSinceLastRequest));
      }
      
      this.lastRequestTime = Date.now();
      
      const response = await axios.get(this.MEROLAGANI_MARKET_API, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });
      
      const stocks = response.data.stock?.detail || [];
      const turnoverData = response.data.turnover?.detail || [];
      const turnoverMap = new Map();
      
      for (const item of turnoverData) {
        turnoverMap.set(item.s, item);
      }
      
      const normalized = [];
      for (const item of stocks) {
        const symbol = (item.s || '').toUpperCase();
        if (!symbol) continue;
        
        const extraData = turnoverMap.get(symbol) || {};
        const lastPrice = this.parseNumeric(item.lp || 0);
        const change = this.parseNumeric(item.c || 0);
        
        let percentChange = this.parseNumeric(item.pc || 0);
        if (percentChange === 0 && change !== 0 && lastPrice !== 0) {
          const prevClose = lastPrice - change;
          if (prevClose > 0) {
            percentChange = (change / prevClose) * 100;
          }
        }
        
        let previousClose = this.parseNumeric(extraData.pc || 0);
        if (previousClose === 0 && lastPrice !== 0 && change !== 0) {
          previousClose = lastPrice - change;
        }
        
        let openPrice = this.parseNumeric(extraData.op || item.op || 0);
        if (openPrice === 0 && previousClose !== 0) {
          openPrice = previousClose;
        }
        
        normalized.push({
          symbol: symbol,
          last_traded_price: lastPrice,
          change: change,
          percent_change: parseFloat(percentChange.toFixed(2)),
          volume: parseInt(item.q || extraData.q || 0),
          turnover: this.parseNumeric(extraData.t || item.t || 0),
          high: this.parseNumeric(extraData.h || item.h || 0),
          low: this.parseNumeric(extraData.l || item.l || 0),
          open: openPrice,
          previous_close: previousClose,
          timestamp: new Date().toISOString()
        });
      }
      
      this.cache.set(cacheKey, { data: normalized, timestamp: Date.now() });
      return normalized;
      
    } catch (error) {
      console.error('Failed to fetch live prices:', error.message);
      return [];
    }
  }

  async getStockPrice(symbol) {
    try {
      const cacheKey = `live_price_${symbol.toUpperCase()}`;
      const cached = this.cache.get(cacheKey);
      const cacheTTL = this.getCacheTTL();
      
      if (cached && Date.now() - cached.timestamp < cacheTTL) {
        return cached.data;
      }
      
      const allPrices = await this.getCurrentPrices();
      const stockPrice = allPrices.find(p => p.symbol === symbol.toUpperCase());
      
      if (stockPrice) {
        this.cache.set(cacheKey, { data: stockPrice, timestamp: Date.now() });
      }
      
      return stockPrice || null;
    } catch (error) {
      console.error(`Failed to fetch price for ${symbol}:`, error.message);
      return null;
    }
  }

  async getTopGainers(limit = 10) {
    const prices = await this.getCurrentPrices();
    return prices.filter(p => p.percent_change > 0).sort((a, b) => b.percent_change - a.percent_change).slice(0, limit);
  }

  async getTopLosers(limit = 10) {
    const prices = await this.getCurrentPrices();
    return prices.filter(p => p.percent_change < 0).sort((a, b) => a.percent_change - b.percent_change).slice(0, limit);
  }

  async getMostActive(limit = 10) {
    const prices = await this.getCurrentPrices();
    return prices.sort((a, b) => b.volume - a.volume).slice(0, limit);
  }

  async getMarketSummary() {
    const prices = await this.getCurrentPrices();
    if (prices.length === 0) {
      return { total_stocks: 0, total_volume: 0, total_turnover: 0, advancing: 0, declining: 0, unchanged: 0, avg_change: 0, market_open: this.isMarketOpen() };
    }
    return {
      total_stocks: prices.length,
      total_volume: prices.reduce((sum, p) => sum + p.volume, 0),
      total_turnover: prices.reduce((sum, p) => sum + p.turnover, 0),
      advancing: prices.filter(p => p.change > 0).length,
      declining: prices.filter(p => p.change < 0).length,
      unchanged: prices.filter(p => p.change === 0).length,
      avg_change: (prices.reduce((sum, p) => sum + p.percent_change, 0) / prices.length).toFixed(2),
      market_open: this.isMarketOpen(),
      timestamp: new Date().toISOString()
    };
  }

  parseNumeric(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return isNaN(value) ? 0 : value;
    const cleaned = String(value).replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }
}

const livePriceScraper = new LivePriceScraper();

// Helper function to calculate start date based on period
function getStartDate(period) {
  const date = new Date();
  switch(period) {
    case '1w': date.setDate(date.getDate() - 7); break;
    case '2w': date.setDate(date.getDate() - 14); break;
    case '1m': date.setMonth(date.getMonth() - 1); break;
    case '3m': date.setMonth(date.getMonth() - 3); break;
    case '6m': date.setMonth(date.getMonth() - 6); break;
    case '1y': date.setFullYear(date.getFullYear() - 1); break;
    case '2y': date.setFullYear(date.getFullYear() - 2); break;
    case '3y': date.setFullYear(date.getFullYear() - 3); break;
    case '5y': date.setFullYear(date.getFullYear() - 5); break;
    default: date.setFullYear(date.getFullYear() - 1);
  }
  return date;
}

// ============ COMPANY DETAIL SCRAPER CLASS ============
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

    const sectorMatch = text.match(/Sector\s+([A-Za-z\s]+?)(?=\s+(?:Shares|Market|%|EPS|P\/E|Book|PBV|Year|Day|Fiscal|Total|Listed|Paidup|Manufacturing|Commercial|Development|Finance|Hotel|Hydro|Investment|Life|Microfinance|Mutual|Non-Life|Others|Preferred|Promotor|Trading|Capital|Corporate|Government))/);
    if (sectorMatch) {
      details.sector = sectorMatch[1].trim();
    }

    if (!details.sector) {
      const altSectorMatch = text.match(/Sector\s+([A-Za-z\s]+?)(?=\d|$)/);
      if (altSectorMatch) {
        details.sector = altSectorMatch[1].trim();
      }
    }

    const sharesMatch = text.match(/Shares Outstanding\s+([\d,]+\.?\d*)/);
    if (sharesMatch) {
      details.shares_outstanding = this.parseNumber(sharesMatch[1]);
      details.listed_shares = details.shares_outstanding;
    }

    const paidupMatch = text.match(/Paidup Value\s+([\d,]+\.?\d*)/);
    if (paidupMatch) {
      details.paidup_value = this.parseNumber(paidupMatch[1]);
    }

    const totalPaidupMatch = text.match(/Total Paidup Value\s+([\d,]+\.?\d*)/);
    if (totalPaidupMatch) {
      details.total_paidup_value = this.parseNumber(totalPaidupMatch[1]);
    }

    return details;
  }

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

    const epsMatch = text.match(/EPS\s+([\d.]+)/);
    if (epsMatch) {
      metrics.eps = this.parseNumber(epsMatch[1]);
    }

    const peMatch = text.match(/P\/E Ratio\s+([\d.]+)/);
    if (peMatch) {
      metrics.pe_ratio = this.parseNumber(peMatch[1]);
    }

    const bvMatch = text.match(/Book Value\s+([\d.]+)/);
    if (bvMatch) {
      metrics.book_value = this.parseNumber(bvMatch[1]);
    }

    const pbvMatch = text.match(/PBV\s+([\d.]+)/);
    if (pbvMatch) {
      metrics.pbv = this.parseNumber(pbvMatch[1]);
    }

    const mktCapMatch = text.match(/Market Capitalization\s+([\d,]+\.?\d*)/);
    if (mktCapMatch) {
      metrics.market_capitalization = this.parseNumber(mktCapMatch[1]);
    }

    const yieldMatch = text.match(/1 Year Yield\s+([\d.]+%)/);
    if (yieldMatch) {
      metrics.year_1_yield = this.parseNumber(yieldMatch[1]);
    }

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

    const priceMatch = text.match(/Market Price\s+([\d,]+\.?\d*)/);
    if (priceMatch) {
      data.market_price = this.parseNumber(priceMatch[1]);
    }

    const changeMatch = text.match(/% Change\s+(-?[\d.]+)%/);
    if (changeMatch) {
      data.percent_change = this.parseNumber(changeMatch[1]);
    }

    const dateMatch = text.match(/Last Traded On\s+([\d/]+\s+[\d:]+)/);
    if (dateMatch) {
      data.last_traded_on = dateMatch[1];
    }

    const highLowMatch = text.match(/52 Weeks High - Low\s+([\d.]+)-([\d.]+)/);
    if (highLowMatch) {
      data.week_52_high = this.parseNumber(highLowMatch[1]);
      data.week_52_low = this.parseNumber(highLowMatch[2]);
    }

    const avg180Match = text.match(/180 Day Average\s+([\d,]+\.?\d*)/);
    if (avg180Match) {
      data.day_180_avg = this.parseNumber(avg180Match[1]);
    }

    const avg120Match = text.match(/120 Day Average\s+([\d,]+\.?\d*)/);
    if (avg120Match) {
      data.day_120_avg = this.parseNumber(avg120Match[1]);
    }

    const volMatch = text.match(/30-Day Avg Volume\s+([\d,]+\.?\d*)/);
    if (volMatch) {
      data.day_30_avg_volume = this.parseNumber(volMatch[1]);
    }

    return data;
  }

  extractDividendData(text) {
    const data = {
      percent_dividend: null,
      percent_bonus: null,
      right_share: null,
      dividend_history: []
    };

    const divMatch = text.match(/% Dividend\s+(?:#|([\d.]+))/);
    if (divMatch && divMatch[1]) {
      data.percent_dividend = this.parseNumber(divMatch[1]);
    }

    const bonusMatch = text.match(/% Bonus\s+(?:#|([\d.]+))/);
    if (bonusMatch && bonusMatch[1]) {
      data.percent_bonus = this.parseNumber(bonusMatch[1]);
    }

    const rightMatch = text.match(/Right Share\s+(?:#|([\d:]+))/);
    if (rightMatch && rightMatch[1]) {
      data.right_share = rightMatch[1];
    }

    const historyRegex = /(\d{2}-\d{2})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g;
    let match;
    while ((match = historyRegex.exec(text)) !== null) {
      const fiscalYear = match[1];
      const dividend = this.parseNumber(match[2]);
      const bonus = this.parseNumber(match[3]);
      const total = this.parseNumber(match[4]);
      
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

  extractAbout($) {
    let aboutText = '';
    
    $('div, p, .description, .about').each((i, el) => {
      const text = $(el).text().trim();
      if (text.length > 100 && 
          (text.includes('About') || text.includes('Company') || text.includes('Limited'))) {
        const sentences = text.split(/[.!?]+/);
        if (sentences.length > 1) {
          aboutText = sentences.slice(0, 3).join('. ') + '.';
        }
      }
    });

    if (!aboutText) {
      const metaDesc = $('meta[name="description"]').attr('content');
      if (metaDesc) aboutText = metaDesc;
    }

    return aboutText;
  }

  parseNumber(text) {
    if (!text) return null;
    if (typeof text === 'number') return isNaN(text) ? null : text;
    
    const cleaned = String(text).replace(/,/g, '').replace(/\s/g, '').replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  }

  clearCache(symbol = null) {
    if (symbol) {
      this.cache.delete(`company_${symbol.toUpperCase()}`);
    } else {
      this.cache.clear();
    }
  }
}

const companyDetailScraper = new CompanyDetailScraper();

// ============ ANNOUNCEMENT SCRAPER ============
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

    $('.announcement-item, .announcement-list li, .event-item, .news-item, .list-group-item').each((i, element) => {
      const text = $(element).text().trim();
      if (!text || text.length < 20) return;

      const dateMatch = text.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
      if (!dateMatch) return;

      const dateStr = `${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`;
      const description = text.replace(dateStr, '').replace(/^[\s-]+/, '').trim();

      const symbolMatch = description.match(/\(([A-Z]+)\)/);
      const symbol = symbolMatch ? symbolMatch[1] : null;

      const companyMatch = description.match(/^([A-Za-z\s]+?)(?:\s*[-–]\s*|\s*\(|$)/);
      const company = companyMatch ? companyMatch[1].trim() : '';

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

    const unitMatches = description.match(/([\d,]+)\s*units/g);
    if (unitMatches) {
      values.units = unitMatches.map(m => parseInt(m.replace(/,/g, '').replace(' units', '')));
    }

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

const announcementScraper = new AnnouncementScraper();

// ============ FLOOR SHEET SCRAPER ============
class FloorSheetScraper {
  constructor() {
    this.baseUrl = 'https://merolagani.com/Floorsheet.aspx';
    this.cache = new Map();
    this.cacheTTL = 60000; // 1 minute for floor sheet data
  }

  async fetchFloorSheet(date = null, forceFresh = false) {
    try {
      if (!date) {
        const now = new Date();
        date = now.toISOString().split('T')[0];
      }

      const cacheKey = `floorsheet_${date}`;
      
      if (!forceFresh && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTTL) {
          return cached.data;
        }
      }

      const url = `${this.baseUrl}?date=${date}`;

      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      const $ = cheerio.load(response.data);
      const trades = this.parseFloorSheet($);
      const activity = this.calculateActivity(trades);

      const result = {
        success: true,
        date: date,
        total_trades: trades.length,
        total_volume: activity.total_volume,
        total_turnover: activity.total_turnover,
        unique_symbols: activity.unique_symbols,
        data: trades,
        activity: activity,
        timestamp: new Date().toISOString()
      };

      this.cache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      console.error(`Error fetching floor sheet for ${date}:`, error.message);
      return {
        success: false,
        error: error.message,
        date: date
      };
    }
  }

  parseFloorSheet($) {
    const trades = [];

    $('table').each((i, table) => {
      const tableText = $(table).text();
      
      if (tableText.includes('Contract No.') || 
          tableText.includes('Stock Symbol') || 
          tableText.includes('Buyer') || 
          tableText.includes('Seller')) {
        
        $(table).find('tr').each((j, row) => {
          if (j === 0) return;
          
          const cols = $(row).find('td');
          if (cols.length >= 6) {
            const contractNo = $(cols[0]).text().trim();
            const symbol = $(cols[1]).text().trim().toUpperCase();
            const buyer = $(cols[2]).text().trim();
            const seller = $(cols[3]).text().trim();
            const quantity = this.parseNumber($(cols[4]).text());
            const rate = this.parseNumber($(cols[5]).text());
            const amount = cols.length > 6 ? this.parseNumber($(cols[6]).text()) : quantity * rate;
            
            if (symbol && quantity > 0 && rate > 0) {
              trades.push({
                contract_no: contractNo,
                symbol: symbol,
                buyer: buyer,
                seller: seller,
                quantity: quantity,
                rate: rate,
                amount: amount || quantity * rate,
                time: this.extractTime($(row).text())
              });
            }
          }
        });
      }
    });

    return trades;
  }

  extractTime(text) {
    const timeMatch = text.match(/(\d{1,2}:\d{2}:\d{2})/);
    return timeMatch ? timeMatch[1] : null;
  }

  calculateActivity(trades) {
    const symbolMap = new Map();
    let totalVolume = 0;
    let totalTurnover = 0;

    for (const trade of trades) {
      totalVolume += trade.quantity;
      totalTurnover += trade.amount;
      
      if (!symbolMap.has(trade.symbol)) {
        symbolMap.set(trade.symbol, {
          symbol: trade.symbol,
          volume: 0,
          turnover: 0,
          trades: 0,
          last_price: trade.rate
        });
      }
      
      const symbolData = symbolMap.get(trade.symbol);
      symbolData.volume += trade.quantity;
      symbolData.turnover += trade.amount;
      symbolData.trades += 1;
      symbolData.last_price = trade.rate;
    }

    return {
      total_volume: totalVolume,
      total_turnover: totalTurnover,
      unique_symbols: symbolMap.size,
      symbol_summary: Array.from(symbolMap.values())
        .sort((a, b) => b.turnover - a.turnover)
    };
  }

  async getTradesBySymbol(symbol, date = null) {
    try {
      const result = await this.fetchFloorSheet(date);
      if (!result.success) return [];
      
      const symbolTrades = result.data.filter(
        trade => trade.symbol === symbol.toUpperCase()
      );
      
      return symbolTrades;
    } catch (error) {
      console.error(`Error fetching trades for ${symbol}:`, error.message);
      return [];
    }
  }

  async getTopTradedSymbols(limit = 10, date = null) {
    try {
      const result = await this.fetchFloorSheet(date);
      if (!result.success) return [];
      
      return result.activity.symbol_summary.slice(0, limit);
    } catch (error) {
      console.error('Error fetching top traded symbols:', error.message);
      return [];
    }
  }

  async getMarketActivity(date = null) {
    try {
      const result = await this.fetchFloorSheet(date);
      if (!result.success) return null;
      
      return {
        date: result.date,
        total_trades: result.total_trades,
        total_volume: result.total_volume,
        total_turnover: result.total_turnover,
        unique_symbols: result.unique_symbols,
        top_symbols: result.activity.symbol_summary.slice(0, 10),
        timestamp: result.timestamp
      };
    } catch (error) {
      console.error('Error fetching market activity:', error.message);
      return null;
    }
  }

  async fetchFloorSheetRange(fromDate, toDate, limit = 20) {
    try {
      const results = [];
      const currentDate = new Date(fromDate);
      const endDate = new Date(toDate);
      
      while (currentDate <= endDate && results.length < limit) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const result = await this.fetchFloorSheet(dateStr);
        
        if (result.success && result.total_trades > 0) {
          results.push({
            date: dateStr,
            total_trades: result.total_trades,
            total_volume: result.total_volume,
            total_turnover: result.total_turnover,
            unique_symbols: result.unique_symbols
          });
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      return {
        success: true,
        from: fromDate,
        to: toDate,
        count: results.length,
        data: results,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('Error fetching floor sheet range:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  parseNumber(text) {
    if (!text) return 0;
    if (typeof text === 'number') return isNaN(text) ? 0 : text;
    
    const cleaned = String(text).replace(/,/g, '').replace(/\s/g, '').replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }

  clearCache() {
    this.cache.clear();
  }
}

const floorSheetScraper = new FloorSheetScraper();

// ============ MARKET SUMMARY ENDPOINTS ============
app.get('/api/market/summary', async (req, res) => {
  try {
    const cacheKey = 'market_summary';
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 5000) return res.json(cached.data);
    
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary', {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    
    const result = { success: true, data: response.data, timestamp: new Date().toISOString(), source: 'merolagani' };
    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    res.json(result);
  } catch (error) {
    console.error('Error fetching market summary:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/overall', async (req, res) => {
  try {
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    res.json({ success: true, data: response.data.overall, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/turnover', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    const turnoverLeaders = response.data.turnover?.detail?.slice(0, limit) || [];
    res.json({ success: true, count: turnoverLeaders.length, data: turnoverLeaders, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/sectors', async (req, res) => {
  try {
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    const sectors = response.data.sector?.detail || [];
    res.json({ success: true, count: sectors.length, data: sectors, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/brokers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    const brokers = response.data.broker?.detail?.slice(0, limit) || [];
    res.json({ success: true, count: brokers.length, data: brokers, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stocks', async (req, res) => {
  try {
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    const stocks = response.data.stock?.detail || [];
    res.json({ success: true, count: stocks.length, data: stocks, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stock/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    const stocks = response.data.stock?.detail || [];
    const stock = stocks.find(s => s.s === symbol.toUpperCase());
    if (!stock) return res.status(404).json({ error: 'Stock not found' });
    res.json({ success: true, data: stock, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/gainers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    const stocks = response.data.stock?.detail || [];
    const gainers = stocks.filter(stock => stock.c > 0).sort((a, b) => b.c - a.c).slice(0, limit);
    res.json({ success: true, count: gainers.length, data: gainers, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/losers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    const stocks = response.data.stock?.detail || [];
    const losers = stocks.filter(stock => stock.c < 0).sort((a, b) => a.c - b.c).slice(0, limit);
    res.json({ success: true, count: losers.length, data: losers, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/active', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    const stocks = response.data.stock?.detail || [];
    const active = stocks.sort((a, b) => b.q - a.q).slice(0, limit);
    res.json({ success: true, count: active.length, data: active, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ LIVE PRICE ENDPOINTS ============
app.get('/api/live/prices', async (req, res) => {
  try {
    const forceFresh = req.query.fresh === 'true';
    const prices = await livePriceScraper.getCurrentPrices(forceFresh);
    res.json({ success: true, count: prices.length, data: prices, market_open: livePriceScraper.isMarketOpen(), timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching live prices:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/live/price/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const price = await livePriceScraper.getStockPrice(symbol);
    if (!price) return res.status(404).json({ error: 'Stock not found' });
    res.json({ success: true, data: price, market_open: livePriceScraper.isMarketOpen(), timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(`Error fetching live price for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/live/gainers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const gainers = await livePriceScraper.getTopGainers(limit);
    res.json({ success: true, count: gainers.length, data: gainers, market_open: livePriceScraper.isMarketOpen(), timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching gainers:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/live/losers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const losers = await livePriceScraper.getTopLosers(limit);
    res.json({ success: true, count: losers.length, data: losers, market_open: livePriceScraper.isMarketOpen(), timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching losers:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/live/active', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const active = await livePriceScraper.getMostActive(limit);
    res.json({ success: true, count: active.length, data: active, market_open: livePriceScraper.isMarketOpen(), timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching active stocks:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/live/summary', async (req, res) => {
  try {
    const summary = await livePriceScraper.getMarketSummary();
    res.json({ success: true, data: summary, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching market summary:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ COMPANY SEARCH ENDPOINTS ============
app.get('/api/companies/search', async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, data: [], message: 'Please provide at least 2 characters for search' });
    
    const response = await axios.get('https://www.merolagani.com/handlers/AutoSuggestHandler.ashx?type=Company', {
      timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    
    const searchTerm = q.toUpperCase();
    const matches = response.data.filter(company => company.l.toUpperCase().includes(searchTerm) || company.d.toUpperCase().includes(searchTerm)).slice(0, limit).map(company => {
      let fullName = company.l;
      const nameMatch = company.l.match(/\(([^)]+)\)/);
      if (nameMatch) fullName = nameMatch[1];
      return { symbol: company.d, name: fullName, id: company.v };
    });
    
    res.json({ success: true, count: matches.length, data: matches, query: q, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error searching companies:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/companies/all', async (req, res) => {
  try {
    const cacheKey = 'all_companies';
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 3600000) return res.json(cached.data);
    
    const response = await axios.get('https://www.merolagani.com/handlers/AutoSuggestHandler.ashx?type=Company', {
      timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    
    const companies = response.data.map(company => {
      let fullName = company.l;
      const nameMatch = company.l.match(/\(([^)]+)\)/);
      if (nameMatch) fullName = nameMatch[1];
      return { symbol: company.d, name: fullName, id: company.v };
    });
    
    const result = { success: true, count: companies.length, data: companies, timestamp: new Date().toISOString() };
    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    res.json(result);
  } catch (error) {
    console.error('Error fetching companies:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/company/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const companiesResponse = await axios.get('https://www.merolagani.com/handlers/AutoSuggestHandler.ashx?type=Company', {
      timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    
    const companyInfo = companiesResponse.data.find(c => c.d.toUpperCase() === symbol.toUpperCase());
    if (!companyInfo) return res.status(404).json({ error: 'Company not found' });
    
    let fullName = companyInfo.l;
    const nameMatch = companyInfo.l.match(/\(([^)]+)\)/);
    if (nameMatch) fullName = nameMatch[1];
    
    const marketResponse = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary', { timeout: 5000 });
    const stockData = marketResponse.data.stock?.detail?.find(s => s.s === symbol.toUpperCase());
    
    res.json({ success: true, data: { symbol: companyInfo.d, name: fullName, id: companyInfo.v, market_data: stockData || null, last_updated: new Date().toISOString() } });
  } catch (error) {
    console.error('Error fetching company details:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/companies/batch', async (req, res) => {
  try {
    const { symbols } = req.body;
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) return res.status(400).json({ error: 'Symbols array required' });
    
    const companiesResponse = await axios.get('https://www.merolagani.com/handlers/AutoSuggestHandler.ashx?type=Company', { timeout: 5000 });
    const marketResponse = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary', { timeout: 5000 });
    
    const results = [];
    for (const symbol of symbols) {
      const companyInfo = companiesResponse.data.find(c => c.d.toUpperCase() === symbol.toUpperCase());
      const stockData = marketResponse.data.stock?.detail?.find(s => s.s === symbol.toUpperCase());
      if (companyInfo) {
        let fullName = companyInfo.l;
        const nameMatch = companyInfo.l.match(/\(([^)]+)\)/);
        if (nameMatch) fullName = nameMatch[1];
        results.push({ symbol: companyInfo.d, name: fullName, id: companyInfo.v, market_data: stockData || null });
      }
    }
    res.json({ success: true, count: results.length, data: results, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching batch companies:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ COMPANY DETAIL SCRAPER ENDPOINTS ============

app.get('/api/company/detail/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const forceFresh = req.query.fresh === 'true';
    
    const result = await companyDetailScraper.fetchCompanyDetails(symbol, forceFresh);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json({
        success: false,
        error: `Company "${symbol}" not found or data unavailable`,
        symbol: symbol.toUpperCase()
      });
    }
  } catch (error) {
    console.error(`Error fetching company detail for ${req.params.symbol}:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      symbol: req.params.symbol.toUpperCase()
    });
  }
});

app.get('/api/company/full/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const forceFresh = req.query.fresh === 'true';
    
    const detailResult = await companyDetailScraper.fetchCompanyDetails(symbol, forceFresh);
    const livePrice = await livePriceScraper.getStockPrice(symbol);
    
    const response = {
      success: true,
      symbol: symbol.toUpperCase(),
      company: detailResult.success ? detailResult.company_details : null,
      live_data: livePrice || null,
      financials: detailResult.success ? detailResult.financial_metrics : null,
      price_data: detailResult.success ? detailResult.price_data : null,
      dividend_data: detailResult.success ? detailResult.dividend_data : null,
      announcements: detailResult.success ? detailResult.announcements : null,
      news: detailResult.success ? detailResult.news : null,
      shareholders: detailResult.success ? detailResult.major_shareholders : null,
      timestamp: new Date().toISOString()
    };
    
    res.json(response);
  } catch (error) {
    console.error(`Error fetching full company data for ${req.params.symbol}:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      symbol: req.params.symbol.toUpperCase()
    });
  }
});

app.get('/api/company/overview/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const forceFresh = req.query.fresh === 'true';
    
    const result = await companyDetailScraper.fetchCompanyDetails(symbol, forceFresh);
    
    if (result.success) {
      const overview = {
        symbol: result.symbol,
        name: result.company_details.name || symbol.toUpperCase(),
        sector: result.company_details.sector,
        market_price: result.price_data.market_price,
        change_percent: result.price_data.percent_change,
        shares_outstanding: result.company_details.shares_outstanding,
        market_cap: result.financial_metrics.market_capitalization,
        eps: result.financial_metrics.eps,
        pe_ratio: result.financial_metrics.pe_ratio,
        book_value: result.financial_metrics.book_value,
        pbv: result.financial_metrics.pbv,
        dividend_percent: result.dividend_data.percent_dividend,
        bonus_percent: result.dividend_data.percent_bonus,
        week_52_high: result.price_data.week_52_high,
        week_52_low: result.price_data.week_52_low,
        last_traded_on: result.price_data.last_traded_on
      };
      
      res.json({
        success: true,
        data: overview,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error(`Error fetching overview for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/company/cache/clear', async (req, res) => {
  try {
    const { symbol } = req.body;
    companyDetailScraper.clearCache(symbol);
    res.json({
      success: true,
      message: symbol ? `Cache cleared for ${symbol}` : 'All company cache cleared',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error clearing company cache:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/company/debug/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    const response = await axios.get('https://merolagani.com/CompanyDetail.aspx', {
      params: { symbol: symbol.toUpperCase() },
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const $ = cheerio.load(response.data);
    const bodyText = $('body').text();
    
    const patterns = [];
    const regex = /([A-Za-z\s]+?)\s+([\d,]+\.?\d*%?)/g;
    let match;
    while ((match = regex.exec(bodyText)) !== null) {
      patterns.push({
        label: match[1].trim(),
        value: match[2].trim()
      });
    }

    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      html_length: response.data.length,
      body_text_length: bodyText.length,
      sample_text: bodyText.substring(0, 2000),
      patterns: patterns.slice(0, 50),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Debug error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ ANNOUNCEMENT ENDPOINTS ============

app.get('/api/announcements', async (req, res) => {
  try {
    const { symbol, sector, fiscalYear, type, limit, fresh } = req.query;
    
    const filters = {
      symbol: symbol,
      sector: sector,
      fiscalYear: fiscalYear,
      announcementType: type,
      limit: limit ? parseInt(limit) : 100
    };
    
    const forceFresh = fresh === 'true';
    const result = await announcementScraper.fetchAnnouncements(filters, forceFresh);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching announcements:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/announcements/latest', async (req, res) => {
  try {
    const { limit = 20, fresh } = req.query;
    
    const result = await announcementScraper.fetchAnnouncements({
      limit: parseInt(limit)
    }, fresh === 'true');
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error fetching latest announcements:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/announcements/company/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { limit = 50, fresh } = req.query;
    
    const result = await announcementScraper.fetchAnnouncements({
      symbol: symbol,
      limit: parseInt(limit)
    }, fresh === 'true');
    
    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      ...result
    });
  } catch (error) {
    console.error(`Error fetching announcements for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/announcements/type/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { limit = 50, fresh } = req.query;
    
    const result = await announcementScraper.fetchAnnouncements({
      announcementType: type,
      limit: parseInt(limit)
    }, fresh === 'true');
    
    res.json({
      success: true,
      type: type,
      ...result
    });
  } catch (error) {
    console.error(`Error fetching ${req.params.type} announcements:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/announcements/sector/:sector', async (req, res) => {
  try {
    const { sector } = req.params;
    const { limit = 50, fresh } = req.query;
    
    const result = await announcementScraper.fetchAnnouncements({
      sector: sector,
      limit: parseInt(limit)
    }, fresh === 'true');
    
    res.json({
      success: true,
      sector: sector,
      ...result
    });
  } catch (error) {
    console.error(`Error fetching announcements for sector ${req.params.sector}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/announcements/fiscal/:year', async (req, res) => {
  try {
    const { year } = req.params;
    const { limit = 50, fresh } = req.query;
    
    const result = await announcementScraper.fetchAnnouncements({
      fiscalYear: year,
      limit: parseInt(limit)
    }, fresh === 'true');
    
    res.json({
      success: true,
      fiscal_year: year,
      ...result
    });
  } catch (error) {
    console.error(`Error fetching announcements for fiscal year ${req.params.year}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/announcements/cache/clear', async (req, res) => {
  try {
    announcementScraper.clearCache();
    res.json({
      success: true,
      message: 'Announcement cache cleared',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error clearing announcement cache:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ FLOOR SHEET ENDPOINTS ============

app.get('/api/floorsheet', async (req, res) => {
  try {
    const { date, fresh } = req.query;
    const forceFresh = fresh === 'true';
    const result = await floorSheetScraper.fetchFloorSheet(date, forceFresh);
    res.json(result);
  } catch (error) {
    console.error('Error fetching floor sheet:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/floorsheet/symbol/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { date } = req.query;
    const trades = await floorSheetScraper.getTradesBySymbol(symbol, date);
    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      date: date || 'today',
      count: trades.length,
      data: trades,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching trades by symbol:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/floorsheet/top', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const { date } = req.query;
    const topSymbols = await floorSheetScraper.getTopTradedSymbols(limit, date);
    res.json({
      success: true,
      date: date || 'today',
      count: topSymbols.length,
      data: topSymbols,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching top traded symbols:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/floorsheet/activity', async (req, res) => {
  try {
    const { date } = req.query;
    const activity = await floorSheetScraper.getMarketActivity(date);
    res.json({
      success: true,
      data: activity,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching market activity:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/floorsheet/range', async (req, res) => {
  try {
    const { from, to, limit = 20 } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'Both "from" and "to" dates are required (YYYY-MM-DD)' });
    }
    const result = await floorSheetScraper.fetchFloorSheetRange(from, to, parseInt(limit));
    res.json(result);
  } catch (error) {
    console.error('Error fetching floor sheet range:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/floorsheet/cache/clear', async (req, res) => {
  try {
    floorSheetScraper.clearCache();
    res.json({
      success: true,
      message: 'Floor sheet cache cleared',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error clearing floor sheet cache:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ STOCK EVENT ENDPOINTS ============
async function fetchStockEvents(fromDate, toDate) {
  const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx', {
    params: { type: 'stock_event', fromDate: fromDate, toDate: toDate },
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
  });
  return response.data.detail || [];
}

function validateDateRange(fromDate, toDate) {
  let from = fromDate;
  let to = toDate;
  
  const toParts = to.split('/');
  if (parseInt(toParts[1]) === 0) {
    const year = parseInt(toParts[2]);
    const month = parseInt(toParts[0]) - 1;
    const lastDay = new Date(year, month, 0);
    to = `${lastDay.getMonth() + 1}/${lastDay.getDate()}/${lastDay.getFullYear()}`;
  }
  
  return { from, to };
}

app.get('/api/events', async (req, res) => {
  try {
    let { from, to, type, symbol, limit = 100 } = req.query;
    
    const now = new Date();
    if (!from) from = `${now.getMonth() + 1}/1/${now.getFullYear()}`;
    if (!to) {
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      to = `${lastDay.getMonth() + 1}/${lastDay.getDate()}/${lastDay.getFullYear()}`;
    }
    
    const validated = validateDateRange(from, to);
    
    const cacheKey = `events_${validated.from}_${validated.to}`;
    const cached = cache.get(cacheKey);
    let events;
    if (cached && Date.now() - cached.timestamp < 3600000) {
      events = cached.data;
    } else {
      events = await fetchStockEvents(validated.from, validated.to);
      cache.set(cacheKey, { data: events, timestamp: Date.now() });
    }
    
    if (type) {
      const typeLower = type.toLowerCase();
      events = events.filter(event => event.announcementDetail.toLowerCase().includes(typeLower));
    }
    if (symbol) {
      const symbolUpper = symbol.toUpperCase();
      events = events.filter(event => event.announcementDetail.toUpperCase().includes(symbolUpper));
    }
    events = events.slice(0, parseInt(limit));
    
    res.json({
      success: true,
      count: events.length,
      data: events,
      date_range: { from: validated.from, to: validated.to },
      filters: { from, to, type, symbol, limit },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching events:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events/upcoming', async (req, res) => {
  try {
    const { months = 3, limit = 100 } = req.query;
    const now = new Date();
    const fromDate = `${now.getMonth() + 1}/1/${now.getFullYear()}`;
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + parseInt(months));
    const toDate = `${endDate.getMonth() + 1}/${endDate.getDate()}/${endDate.getFullYear()}`;
    
    const events = await fetchStockEvents(fromDate, toDate);
    const limitedEvents = events.slice(0, parseInt(limit));
    
    res.json({ success: true, period: `${months} months`, date_range: { from: fromDate, to: toDate }, count: limitedEvents.length, data: limitedEvents, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching upcoming events:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events/upcoming/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { months = 3, limit = 50 } = req.query;
    const now = new Date();
    const fromDate = `${now.getMonth() + 1}/1/${now.getFullYear()}`;
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + parseInt(months));
    const toDate = `${endDate.getMonth() + 1}/${endDate.getDate()}/${endDate.getFullYear()}`;
    
    let events = await fetchStockEvents(fromDate, toDate);
    events = events.filter(event => event.announcementDetail.toLowerCase().includes(type.toLowerCase())).slice(0, parseInt(limit));
    res.json({ success: true, type: type, period: `${months} months`, count: events.length, data: events, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(`Error fetching upcoming ${req.params.type} events:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events/ipo', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const now = new Date();
    const fromDate = `1/1/${now.getFullYear() - 1}`;
    const toDate = `12/31/${now.getFullYear() + 1}`;
    const events = await fetchStockEvents(fromDate, toDate);
    const ipoEvents = events.filter(event => event.announcementDetail.toLowerCase().includes('ipo') || event.announcementDetail.toLowerCase().includes('initial public offering')).slice(0, parseInt(limit));
    res.json({ success: true, count: ipoEvents.length, data: ipoEvents, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching IPO events:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events/dividends', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const now = new Date();
    const fromDate = `1/1/${now.getFullYear() - 1}`;
    const toDate = `12/31/${now.getFullYear() + 1}`;
    const events = await fetchStockEvents(fromDate, toDate);
    const dividendEvents = events.filter(event => event.announcementDetail.toLowerCase().includes('dividend') || event.announcementDetail.toLowerCase().includes('bonus share')).slice(0, parseInt(limit));
    res.json({ success: true, count: dividendEvents.length, data: dividendEvents, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching dividend events:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events/agm', async (req, res) => {
  try {
    const { limit = 100, fresh = false } = req.query;
    const fromDate = `1/1/2025`;
    const toDate = `12/31/2027`;
    
    const cacheKey = `agm_events_2025_2027`;
    
    let events;
    if (fresh === 'true') {
      const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx', {
        params: { type: 'stock_event', fromDate: fromDate, toDate: toDate },
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
      });
      events = response.data.detail || [];
    } else {
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 3600000) {
        events = cached.data;
      } else {
        const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx', {
          params: { type: 'stock_event', fromDate: fromDate, toDate: toDate },
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
        });
        events = response.data.detail || [];
        cache.set(cacheKey, { data: events, timestamp: Date.now() });
      }
    }
    
    const agmEvents = events.filter(event => 
      event.announcementDetail.toLowerCase().includes('agm')
    );
    
    agmEvents.sort((a, b) => new Date(b.actionDate) - new Date(a.actionDate));
    
    const limited = agmEvents.slice(0, parseInt(limit));
    
    res.json({
      success: true,
      count: limited.length,
      total_available: agmEvents.length,
      date_range: { from: fromDate, to: toDate },
      data: limited,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching AGM events:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events/right-share', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const now = new Date();
    const fromDate = `1/1/${now.getFullYear() - 1}`;
    const toDate = `12/31/${now.getFullYear() + 1}`;
    const events = await fetchStockEvents(fromDate, toDate);
    const rightShareEvents = events.filter(event => event.announcementDetail.toLowerCase().includes('right share')).slice(0, parseInt(limit));
    res.json({ success: true, count: rightShareEvents.length, data: rightShareEvents, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching right share events:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events/company/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { limit = 50 } = req.query;
    const now = new Date();
    const fromDate = `1/1/${now.getFullYear() - 2}`;
    const toDate = `12/31/${now.getFullYear() + 1}`;
    const events = await fetchStockEvents(fromDate, toDate);
    const companyEvents = events.filter(event => event.announcementDetail.toUpperCase().includes(symbol.toUpperCase())).slice(0, parseInt(limit));
    res.json({ success: true, symbol: symbol.toUpperCase(), count: companyEvents.length, data: companyEvents, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(`Error fetching events for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events/stats', async (req, res) => {
  try {
    const now = new Date();
    const fromDate = `1/1/${now.getFullYear()}`;
    const toDate = `12/31/${now.getFullYear()}`;
    const events = await fetchStockEvents(fromDate, toDate);
    const stats = {
      total_events: events.length,
      ipo_count: events.filter(e => e.announcementDetail.toLowerCase().includes('ipo')).length,
      dividend_count: events.filter(e => e.announcementDetail.toLowerCase().includes('dividend')).length,
      agm_count: events.filter(e => e.announcementDetail.toLowerCase().includes('agm')).length,
      right_share_count: events.filter(e => e.announcementDetail.toLowerCase().includes('right share')).length,
      by_month: {}
    };
    events.forEach(event => {
      const month = event.actionDate.split('/')[1];
      stats.by_month[month] = (stats.by_month[month] || 0) + 1;
    });
    res.json({ success: true, data: stats, year: now.getFullYear(), timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching event stats:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ HISTORICAL CANDLES ENDPOINTS ============
app.get('/api/candles/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { period = '1y' } = req.query;
    const endDate = new Date();
    const startDate = getStartDate(period);
    const rangeStartDate = Math.floor(startDate.getTime() / 1000);
    const rangeEndDate = Math.floor(endDate.getTime() / 1000);
    
    const response = await axios.get('https://www.merolagani.com/handlers/TechnicalChartHandler.ashx', {
      params: { type: 'get_advanced_chart', symbol: symbol.toUpperCase(), resolution: '1D', rangeStartDate, rangeEndDate, isAdjust: 1, currencyCode: 'NPR' },
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    
    const candles = [];
    if (response.data && response.data.s === 'ok') {
      for (let i = 0; i < response.data.t.length; i++) {
        candles.push({
          date: new Date(response.data.t[i] * 1000).toISOString().split('T')[0],
          open: response.data.o[i], high: response.data.h[i], low: response.data.l[i],
          close: response.data.c[i], volume: response.data.v[i]
        });
      }
    }
    res.json({ success: true, symbol: symbol.toUpperCase(), period: period, count: candles.length, data: candles, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching candles:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/candles/bulk', async (req, res) => {
  try {
    const { symbols, period = '1y' } = req.body;
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) return res.status(400).json({ error: 'Symbols array required' });
    if (symbols.length > 50) return res.status(400).json({ error: 'Maximum 50 symbols per request' });
    
    const results = [];
    let successCount = 0;
    for (const symbol of symbols) {
      try {
        const startDate = getStartDate(period);
        const endDate = new Date();
        const response = await axios.get('https://www.merolagani.com/handlers/TechnicalChartHandler.ashx', {
          params: { type: 'get_advanced_chart', symbol: symbol.toUpperCase(), resolution: '1D', rangeStartDate: Math.floor(startDate.getTime() / 1000), rangeEndDate: Math.floor(endDate.getTime() / 1000), isAdjust: 1, currencyCode: 'NPR' },
          timeout: 15000
        });
        
        const candles = [];
        if (response.data && response.data.s === 'ok') {
          for (let i = 0; i < response.data.t.length; i++) {
            candles.push({
              date: new Date(response.data.t[i] * 1000).toISOString().split('T')[0],
              open: response.data.o[i], high: response.data.h[i], low: response.data.l[i],
              close: response.data.c[i], volume: response.data.v[i]
            });
          }
        }
        results.push({ symbol: symbol.toUpperCase(), success: true, count: candles.length, data: candles });
        successCount++;
      } catch (error) {
        results.push({ symbol: symbol.toUpperCase(), success: false, error: error.message, count: 0, data: [] });
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    res.json({ success: true, period: period, total_requested: symbols.length, successful: successCount, failed: symbols.length - successCount, data: results, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error in bulk candles:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ NEPSE INDEX ENDPOINTS ============
app.get('/api/index/historical', async (req, res) => {
  try {
    const { limit = 100, page = 1 } = req.query;
    const cacheKey = `nepse_index_historical_page_${page}_limit_${limit}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 3600000) return res.json(cached.data);
    
    const response = await axios.get('https://merolagani.com/Indices.aspx', { timeout: 15000 });
    const html = response.data;
    const tableRegex = /<td[^>]*>([\d\-/]+)<\/td>\s*<td[^>]*>([\d,]+\.?\d*)<\/td>\s*<td[^>]*>(-?[\d,]+\.?\d*)<\/td>\s*<td[^>]*>(-?[\d,]+\.?\d*%)<\/td>/g;
    
    const indices = [];
    let match;
    while ((match = tableRegex.exec(html)) !== null) {
      indices.push({ date: match[1], index_value: parseFloat(match[2].replace(/,/g, '')), absolute_change: parseFloat(match[3].replace(/,/g, '')), percentage_change: match[4] });
    }
    
    const start = (parseInt(page) - 1) * parseInt(limit);
    const paginatedData = indices.slice(start, start + parseInt(limit));
    const result = {
      success: true, source: 'merolagani',
      data: { latest: indices[0] || null, statistics: { highest: Math.max(...indices.map(i => i.index_value)), lowest: Math.min(...indices.map(i => i.index_value)), total_records: indices.length }, historical: paginatedData, pagination: { current_page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(indices.length / parseInt(limit)), total_records: indices.length } },
      timestamp: new Date().toISOString()
    };
    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    res.json(result);
  } catch (error) {
    console.error('Error fetching NEPSE index data:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/index/latest', async (req, res) => {
  try {
    const cacheKey = 'nepse_index_latest';
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 3600000) return res.json(cached.data);
    
    const response = await axios.get('https://merolagani.com/Indices.aspx', { timeout: 10000 });
    const html = response.data;
    const firstRowRegex = /<tr[^>]*>[\s\S]*?<td[^>]*>([\d\-/]+)<\/td>[\s\S]*?<td[^>]*>([\d,]+\.?\d*)<\/td>[\s\S]*?<td[^>]*>(-?[\d,]+\.?\d*)<\/td>[\s\S]*?<td[^>]*>(-?[\d,]+\.?\d*%)<\/td>/;
    const match = html.match(firstRowRegex);
    if (!match) throw new Error('Could not parse index data');
    
    const result = { success: true, data: { date: match[1], index_value: parseFloat(match[2].replace(/,/g, '')), absolute_change: parseFloat(match[3].replace(/,/g, '')), percentage_change: match[4] }, timestamp: new Date().toISOString() };
    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    res.json(result);
  } catch (error) {
    console.error('Error fetching latest index:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ UNIVERSAL CHART ENDPOINT ============
app.get('/chart/:symbol?', (req, res) => {
  const symbol = req.params.symbol || 'SOPL';
  const period = req.query.period || '1m';
  
  res.send(`<!DOCTYPE html>
<html>
<head>
    <title>${symbol} Candlestick Chart</title>
    <script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.js"></script>
    <style>
        body { margin: 0; padding: 20px; background: #1a1a2e; color: #fff; font-family: Arial, sans-serif; }
        .container { max-width: 1400px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
        #chart { width: 100%; height: 600px; background: #1a1a2e; border-radius: 10px; }
        .controls { display: flex; gap: 10px; flex-wrap: wrap; margin: 15px 0; }
        button { background: #2a2a3e; color: #fff; padding: 8px 16px; border: none; border-radius: 5px; cursor: pointer; transition: all 0.3s; }
        button:hover { background: #3a3a5e; }
        button.active { background: #ffd700; color: #1a1a2e; font-weight: bold; }
        .info { margin-top: 15px; padding: 15px; background: rgba(255,255,255,0.05); border-radius: 8px; text-align: center; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 15px; }
        .stat-card { background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; text-align: center; }
        .stat-value { font-size: 20px; font-weight: bold; color: #ffd700; }
        .stat-label { font-size: 12px; color: #aaa; }
        .error { color: #ff4d4d; }
        .positive { color: #4caf50; }
        .negative { color: #f44336; }
        input[type="text"] { background: #2a2a3e; color: #fff; border: 1px solid #3a3a5e; padding: 8px 12px; border-radius: 5px; font-size: 14px; width: 150px; }
        input[type="text"]:focus { outline: none; border-color: #ffd700; }
        @media (max-width: 768px) { .header { flex-direction: column; align-items: stretch; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>📈 ${symbol} - Candlestick Chart</h2>
            <div>
                <input type="text" id="symbolInput" value="${symbol}" placeholder="Enter symbol..." style="width:150px;">
                <button onclick="loadSymbol()">Go</button>
                <button onclick="loadChart('${period}')" style="background:#ffd700;color:#1a1a2e;">Refresh</button>
            </div>
        </div>
        
        <div class="controls">
            <button class="period-btn" data-period="1w">1 Week</button>
            <button class="period-btn active" data-period="1m">1 Month</button>
            <button class="period-btn" data-period="3m">3 Months</button>
            <button class="period-btn" data-period="6m">6 Months</button>
            <button class="period-btn" data-period="1y">1 Year</button>
            <button class="period-btn" data-period="2y">2 Years</button>
            <button class="period-btn" data-period="3y">3 Years</button>
            <button class="period-btn" data-period="5y">5 Years</button>
        </div>
        
        <div id="chart"></div>
        <div id="info" class="info">Loading ${symbol} data...</div>
        
        <div class="stats" id="stats">
            <div class="stat-card"><div class="stat-value">--</div><div class="stat-label">Current Price</div></div>
            <div class="stat-card"><div class="stat-value">--</div><div class="stat-label">Change</div></div>
            <div class="stat-card"><div class="stat-value">--</div><div class="stat-label">High</div></div>
            <div class="stat-card"><div class="stat-value">--</div><div class="stat-label">Low</div></div>
            <div class="stat-card"><div class="stat-value">--</div><div class="stat-label">Volume</div></div>
            <div class="stat-card"><div class="stat-value">--</div><div class="stat-label">Candles</div></div>
        </div>
    </div>

    <script>
        let chart = null;
        let series = null;
        let currentSymbol = '${symbol}';
        let currentPeriod = '${period}';
        
        function initChart() {
            const container = document.getElementById('chart');
            chart = LightweightCharts.createChart(container, {
                width: container.clientWidth,
                height: 600,
                layout: { background: { color: '#1a1a2e' }, textColor: '#ddd' },
                grid: { vertLines: { color: '#2a2a3e' }, horzLines: { color: '#2a2a3e' } },
                crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
                rightPriceScale: { borderColor: '#2a2a3e' },
                timeScale: { borderColor: '#2a2a3e', timeVisible: true }
            });
            
            series = chart.addCandlestickSeries({
                upColor: '#4caf50',
                downColor: '#f44336',
                borderVisible: false,
                wickUpColor: '#4caf50',
                wickDownColor: '#f44336'
            });
            
            window.addEventListener('resize', () => {
                chart.applyOptions({ width: container.clientWidth });
            });
        }
        
        function loadSymbol() {
            const input = document.getElementById('symbolInput');
            const symbol = input.value.trim().toUpperCase();
            if (symbol) {
                currentSymbol = symbol;
                document.querySelector('h2').textContent = \`📈 \${symbol} - Candlestick Chart\`;
                loadChart(currentPeriod);
            }
        }
        
        async function loadChart(period) {
            const infoDiv = document.getElementById('info');
            infoDiv.innerHTML = 'Loading data...';
            currentPeriod = period;
            
            document.querySelectorAll('.period-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.period === period);
            });
            
            try {
                const url = \`/api/candles/\${currentSymbol}?period=\${period}\`;
                console.log('Fetching:', url);
                
                const response = await fetch(url);
                const data = await response.json();
                console.log('Data received:', data);
                
                if (data.success && data.data && data.data.length > 0) {
                    const chartData = data.data.map(c => ({
                        time: c.date,
                        open: c.open,
                        high: c.high,
                        low: c.low,
                        close: c.close
                    }));
                    
                    series.setData(chartData);
                    chart.timeScale().fitContent();
                    
                    const latest = data.data[data.data.length - 1];
                    const first = data.data[0];
                    const change = ((latest.close - first.open) / first.open * 100).toFixed(2);
                    const highest = Math.max(...data.data.map(c => c.high));
                    const lowest = Math.min(...data.data.map(c => c.low));
                    const totalVolume = data.data.reduce((sum, c) => sum + c.volume, 0);
                    
                    document.getElementById('stats').innerHTML = \`
                        <div class="stat-card"><div class="stat-value">Rs. \${latest.close.toFixed(2)}</div><div class="stat-label">Current Price</div></div>
                        <div class="stat-card"><div class="stat-value \${change >= 0 ? 'positive' : 'negative'}">\${change >= 0 ? '+' : ''}\${change}%</div><div class="stat-label">Change</div></div>
                        <div class="stat-card"><div class="stat-value positive">Rs. \${highest.toFixed(2)}</div><div class="stat-label">High</div></div>
                        <div class="stat-card"><div class="stat-value negative">Rs. \${lowest.toFixed(2)}</div><div class="stat-label">Low</div></div>
                        <div class="stat-card"><div class="stat-value">\${totalVolume.toLocaleString()}</div><div class="stat-label">Total Volume</div></div>
                        <div class="stat-card"><div class="stat-value">\${data.data.length}</div><div class="stat-label">Candles</div></div>
                    \`;
                    
                    infoDiv.innerHTML = \`✅ \${currentSymbol}: \${data.data.length} candles | Latest: Rs. \${latest.close.toFixed(2)} | Change: \${change >= 0 ? '📈' : '📉'} \${change}%\`;
                } else {
                    infoDiv.innerHTML = \`⚠️ No data available for \${currentSymbol}. Try a different period or check if the stock is listed.\`;
                }
            } catch (error) {
                console.error('Error:', error);
                infoDiv.innerHTML = \`❌ Error: \${error.message}\`;
            }
        }
        
        document.getElementById('symbolInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadSymbol();
        });
        
        document.querySelectorAll('.period-btn').forEach(btn => {
            btn.addEventListener('click', () => loadChart(btn.dataset.period));
        });
        
        initChart();
        loadChart('${period}');
    </script>
</body>
</html>`);
});

// ============ MARKET STATUS ENDPOINTS ============
app.get('/api/market/status/debug', (req, res) => {
  try {
    const status = livePriceScraper.getMarketStatus();
    res.json({
      success: true,
      data: status,
      server_time: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting market status:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/is-open', (req, res) => {
  try {
    const isOpen = livePriceScraper.isMarketOpen();
    const status = livePriceScraper.getMarketStatus();
    res.json({
      success: true,
      market_open: isOpen,
      details: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error checking market status:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/force-refresh', async (req, res) => {
  try {
    const prices = await livePriceScraper.getCurrentPrices(true);
    const isOpen = livePriceScraper.isMarketOpen();
    const status = livePriceScraper.getMarketStatus();
    
    res.json({
      success: true,
      market_open: isOpen,
      status: status,
      prices_count: prices.length,
      sample_price: prices.length > 0 ? prices[0] : null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error forcing refresh:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ HEALTH & ROOT ============
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString(), uptime: process.uptime(), cache_size: cache.size });
});

app.get('/', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NEPSE Market Data API</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: linear-gradient(135deg, #0f0c29, #302b63, #24243e); color: #fff; min-height: 100vh; padding: 20px; }
        .container { max-width: 1400px; margin: 0 auto; }
        .header { background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); border-radius: 15px; padding: 30px; margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.1); }
        h1 { font-size: 32px; margin-bottom: 10px; display: flex; align-items: center; gap: 10px; }
        .badge { background: #00ff9d; color: #1a1a2e; padding: 5px 10px; border-radius: 20px; font-size: 14px; font-weight: bold; }
        .status { color: #00ff9d; margin-top: 10px; }
        .endpoints-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 20px; }
        .card { background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); border-radius: 15px; padding: 20px; border: 1px solid rgba(255,255,255,0.1); transition: transform 0.3s; }
        .card:hover { transform: translateY(-5px); background: rgba(255,255,255,0.15); }
        .card-title { font-size: 20px; font-weight: bold; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #00ff9d; display: flex; align-items: center; gap: 10px; }
        .card-title .emoji { font-size: 24px; }
        .endpoint-list { list-style: none; }
        .endpoint-list li { margin-bottom: 12px; padding: 8px; border-radius: 8px; transition: background 0.2s; }
        .endpoint-list li:hover { background: rgba(255,255,255,0.1); }
        .method { display: inline-block; padding: 3px 8px; border-radius: 5px; font-size: 11px; font-weight: bold; margin-right: 10px; }
        .method.get { background: #00ff9d; color: #1a1a2e; }
        .method.post { background: #ffd700; color: #1a1a2e; }
        .endpoint-url { font-family: monospace; font-size: 13px; word-break: break-all; }
        .endpoint-url a { color: #fff; text-decoration: none; border-bottom: 1px dashed rgba(255,255,255,0.3); }
        .endpoint-url a:hover { color: #00ff9d; border-bottom-color: #00ff9d; }
        .description { font-size: 11px; color: #aaa; margin-top: 5px; margin-left: 65px; }
        .footer { text-align: center; margin-top: 30px; padding: 20px; background: rgba(255,255,255,0.05); border-radius: 15px; font-size: 12px; color: #aaa; }
        @media (max-width: 768px) { .endpoints-grid { grid-template-columns: 1fr; } .description { margin-left: 0; margin-top: 8px; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 NEPSE Market Data API <span class="badge">v3.0.0</span></h1>
            <p>Real-time and historical stock data for Nepal Stock Exchange</p>
            <div class="status">🟢 Status: Running | Data Source: MeroLagani</div>
        </div>
        <div class="endpoints-grid">
            <div class="card"><div class="card-title"><span class="emoji">🔴</span>Live Prices</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/live/prices?fresh=true" target="_blank">${baseUrl}/api/live/prices?fresh=true</a></span><div class="description">Real-time stock prices (use ?fresh=true to bypass cache)</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/live/price/NABIL" target="_blank">${baseUrl}/api/live/price/:symbol</a></span><div class="description">Live price for specific stock (e.g., NABIL, EBL, PRVU)</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/live/gainers" target="_blank">${baseUrl}/api/live/gainers</a></span><div class="description">Top gaining stocks</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/live/losers" target="_blank">${baseUrl}/api/live/losers</a></span><div class="description">Top losing stocks</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/live/active" target="_blank">${baseUrl}/api/live/active</a></span><div class="description">Most active stocks by volume</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/live/summary" target="_blank">${baseUrl}/api/live/summary</a></span><div class="description">Live market summary</div></li>
                </ul>
            </div>
            <div class="card"><div class="card-title"><span class="emoji">📈</span>Market Data</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/market/summary" target="_blank">${baseUrl}/api/market/summary</a></span><div class="description">Complete market summary</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/market/overall" target="_blank">${baseUrl}/api/market/overall</a></span><div class="description">Overall market statistics</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/market/turnover" target="_blank">${baseUrl}/api/market/turnover</a></span><div class="description">Top turnover leaders</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/market/sectors" target="_blank">${baseUrl}/api/market/sectors</a></span><div class="description">Sector-wise performance</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/market/brokers" target="_blank">${baseUrl}/api/market/brokers</a></span><div class="description">Broker-wise performance</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/market/gainers" target="_blank">${baseUrl}/api/market/gainers</a></span><div class="description">Top gainers</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/market/losers" target="_blank">${baseUrl}/api/market/losers</a></span><div class="description">Top losers</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/market/active" target="_blank">${baseUrl}/api/market/active</a></span><div class="description">Most active stocks</div></li>
                </ul>
            </div>
            <div class="card"><div class="card-title"><span class="emoji">🏢</span>Companies</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/companies/search?q=NABIL" target="_blank">${baseUrl}/api/companies/search?q=NABIL</a></span><div class="description">Search companies</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/companies/all" target="_blank">${baseUrl}/api/companies/all</a></span><div class="description">All companies list</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/company/NABIL" target="_blank">${baseUrl}/api/company/:symbol</a></span><div class="description">Company details with market data</div></li>
                    <li><span class="method post">POST</span><span class="endpoint-url">${baseUrl}/api/companies/batch</span><div class="description">Batch company details (POST with JSON body)</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/company/detail/NABIL" target="_blank">${baseUrl}/api/company/detail/:symbol</a></span><div class="description">Complete company details from CompanyDetail.aspx</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/company/full/NABIL" target="_blank">${baseUrl}/api/company/full/:symbol</a></span><div class="description">Company details + live market data combined</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/company/overview/NABIL" target="_blank">${baseUrl}/api/company/overview/:symbol</a></span><div class="description">Company overview summary</div></li>
                    <li><span class="method post">POST</span><span class="endpoint-url">${baseUrl}/api/company/cache/clear</span><div class="description">Clear cached company data</div></li>
                </ul>
            </div>
            <div class="card"><div class="card-title"><span class="emoji">📢</span>Announcements</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/announcements" target="_blank">${baseUrl}/api/announcements</a></span><div class="description">All announcements with filters (symbol, sector, fiscalYear, type)</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/announcements/latest?limit=10" target="_blank">${baseUrl}/api/announcements/latest</a></span><div class="description">Latest announcements</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/announcements/company/NABIL" target="_blank">${baseUrl}/api/announcements/company/:symbol</a></span><div class="description">Announcements by company</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/announcements/type/AGM" target="_blank">${baseUrl}/api/announcements/type/:type</a></span><div class="description">Announcements by type (AGM, Bonus, Dividend, IPO, etc.)</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/announcements/sector/Commercial%20Banks" target="_blank">${baseUrl}/api/announcements/sector/:sector</a></span><div class="description">Announcements by sector</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/announcements/fiscal/082-083" target="_blank">${baseUrl}/api/announcements/fiscal/:year</a></span><div class="description">Announcements by fiscal year</div></li>
                    <li><span class="method post">POST</span><span class="endpoint-url">${baseUrl}/api/announcements/cache/clear</span><div class="description">Clear announcement cache</div></li>
                </ul>
            </div>
            <div class="card"><div class="card-title"><span class="emoji">📋</span>Floor Sheet</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/floorsheet" target="_blank">${baseUrl}/api/floorsheet</a></span><div class="description">Get today's floor sheet data</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/floorsheet?date=2026-06-24" target="_blank">${baseUrl}/api/floorsheet?date=YYYY-MM-DD</a></span><div class="description">Get floor sheet for a specific date</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/floorsheet/symbol/NABIL" target="_blank">${baseUrl}/api/floorsheet/symbol/:symbol</a></span><div class="description">Get trades for a specific stock</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/floorsheet/top?limit=10" target="_blank">${baseUrl}/api/floorsheet/top?limit=10</a></span><div class="description">Top traded symbols by turnover</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/floorsheet/activity" target="_blank">${baseUrl}/api/floorsheet/activity</a></span><div class="description">Market activity summary</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/floorsheet/range?from=2026-06-01&to=2026-06-24" target="_blank">${baseUrl}/api/floorsheet/range?from=YYYY-MM-DD&to=YYYY-MM-DD</a></span><div class="description">Floor sheet for date range</div></li>
                    <li><span class="method post">POST</span><span class="endpoint-url">${baseUrl}/api/floorsheet/cache/clear</span><div class="description">Clear floor sheet cache</div></li>
                </ul>
            </div>
            <div class="card"><div class="card-title"><span class="emoji">📅</span>Corporate Events</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/events" target="_blank">${baseUrl}/api/events</a></span><div class="description">All corporate events</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/events/upcoming?months=3" target="_blank">${baseUrl}/api/events/upcoming?months=3</a></span><div class="description">Upcoming events (next 3 months)</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/events/ipo" target="_blank">${baseUrl}/api/events/ipo</a></span><div class="description">IPO events</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/events/dividends" target="_blank">${baseUrl}/api/events/dividends</a></span><div class="description">Dividend events</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/events/agm" target="_blank">${baseUrl}/api/events/agm</a></span><div class="description">AGM events</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/events/right-share" target="_blank">${baseUrl}/api/events/right-share</a></span><div class="description">Right share events</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/events/company/NABIL" target="_blank">${baseUrl}/api/events/company/:symbol</a></span><div class="description">Events by company</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/events/stats" target="_blank">${baseUrl}/api/events/stats</a></span><div class="description">Event statistics</div></li>
                </ul>
            </div>
            <div class="card"><div class="card-title"><span class="emoji">🕯️</span>Historical Candles</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/candles/NABIL?period=1y" target="_blank">${baseUrl}/api/candles/:symbol?period=1y</a></span><div class="description">Historical OHLC data (period: 1w,1m,3m,6m,1y,2y,3y,5y)</div></li>
                    <li><span class="method post">POST</span><span class="endpoint-url">${baseUrl}/api/candles/bulk</span><div class="description">Bulk candles for multiple symbols (max 50)</div></li>
                </ul>
            </div>
            <div class="card"><div class="card-title"><span class="emoji">📉</span>NEPSE Index</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/index/latest" target="_blank">${baseUrl}/api/index/latest</a></span><div class="description">Latest NEPSE Index value</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/index/historical?limit=100" target="_blank">${baseUrl}/api/index/historical?limit=100</a></span><div class="description">Historical index data</div></li>
                </ul>
            </div>
            <div class="card"><div class="card-title"><span class="emoji">📊</span>Charts & Health</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/chart" target="_blank">${baseUrl}/chart</a></span><div class="description">Interactive candlestick chart for any symbol</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/chart/NABIL?period=1y" target="_blank">${baseUrl}/chart/:symbol?period=1y</a></span><div class="description">Universal chart - change symbol in URL</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/health" target="_blank">${baseUrl}/health</a></span><div class="description">API health check</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/market/is-open" target="_blank">${baseUrl}/api/market/is-open</a></span><div class="description">Check if market is open</div></li>
                </ul>
            </div>
        </div>
        <div class="footer">
            <p>🚀 NEPSE Market Data API | Real-time data from MeroLagani | Cached for performance</p>
            <p>💡 Tip: Use ?fresh=true to bypass cache and get latest data</p>
            <p>📅 Last Updated: ${new Date().toISOString()}</p>
        </div>
    </div>
</body>
</html>`);
});
// Debug: Check the raw floor sheet HTML structure
app.get('/api/floorsheet/debug', async (req, res) => {
  try {
    const { date } = req.query;
    const today = new Date().toISOString().split('T')[0];
    const targetDate = date || today;
    
    const response = await axios.get(`https://merolagani.com/Floorsheet.aspx?date=${targetDate}`, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    // Find all tables and log their structure
    const tables = [];
    $('table').each((i, table) => {
      const headers = $(table).find('th').map((_, th) => $(th).text().trim()).get();
      const firstRow = $(table).find('tr').eq(1).find('td').map((_, td) => $(td).text().trim()).get();
      const html = $(table).html().substring(0, 500);
      
      tables.push({
        index: i,
        header_count: headers.length,
        headers: headers,
        sample_row: firstRow,
        has_headers: headers.length > 0,
        html_sample: html
      });
    });
    
    // Also extract all text from the page to see what's there
    const allText = $('body').text().substring(0, 2000);
    
    res.json({
      success: true,
      date: targetDate,
      table_count: tables.length,
      tables: tables,
      sample_text: allText
    });
  } catch (error) {
    console.error('Debug error:', error.message);
    res.status(500).json({ error: error.message });
  }
});
// ============ ERROR HANDLING ============
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message, timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.url, timestamp: new Date().toISOString() });
});

// ============ START SERVER ============
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 NEPSE Market Data API running on port ${PORT}`);
  console.log(`📊 Market Summary: http://localhost:${PORT}/api/market/summary`);
  console.log(`📈 NEPSE Index: http://localhost:${PORT}/api/index/latest`);
  console.log(`📅 Events: http://localhost:${PORT}/api/events`);
  console.log(`📢 Announcements: http://localhost:${PORT}/api/announcements`);
  console.log(`📋 Floor Sheet: http://localhost:${PORT}/api/floorsheet`);
  console.log(`📉 Chart: http://localhost:${PORT}/chart`);
  console.log(`🔴 Live Price: http://localhost:${PORT}/api/live/price/NABIL`);
  console.log(`🏢 Company Detail: http://localhost:${PORT}/api/company/detail/SOPL`);
  console.log(`📊 Universal Chart: http://localhost:${PORT}/chart/SOPL?period=1m`);
  console.log(`💚 Health: http://localhost:${PORT}/health`);
});

module.exports = app;