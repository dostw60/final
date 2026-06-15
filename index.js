// index.js - COMPLETE PRODUCTION READY VERSION
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

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

// ============ STOCK EVENT ENDPOINTS ============
async function fetchStockEvents(fromDate, toDate) {
  const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx', {
    params: { type: 'stock_event', fromDate: fromDate, toDate: toDate },
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
  });
  return response.data.detail || [];
}

// Helper function to validate and fix dates
function validateDateRange(fromDate, toDate) {
  let from = fromDate;
  let to = toDate;
  
  // Fix invalid "to" date (e.g., 7/0/2026)
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
    
    // Fix invalid dates
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
    const { limit = 50 } = req.query;
    const now = new Date();
    const fromDate = `1/1/${now.getFullYear()}`;
    const toDate = `12/31/${now.getFullYear() + 1}`;
    const events = await fetchStockEvents(fromDate, toDate);
    const agmEvents = events.filter(event => event.announcementDetail.toLowerCase().includes('agm')).slice(0, parseInt(limit));
    res.json({ success: true, count: agmEvents.length, data: agmEvents, timestamp: new Date().toISOString() });
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
// ============ DIVIDEND ENDPOINTS ============
const dividendScraper = require('./scrapers/events/dividendScraper');

// Get all dividends
app.get('/api/dividends/all', async (req, res) => {
  try {
    const { fiscalYear } = req.query;
    const result = await dividendScraper.fetchDividends(fiscalYear);
    res.json({
      success: result.success,
      count: result.count,
      data: result.data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching dividends:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get latest dividends
app.get('/api/dividends/latest', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const dividends = await dividendScraper.getLatestDividends(limit);
    res.json({
      success: true,
      count: dividends.length,
      data: dividends,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching latest dividends:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get dividends by company
app.get('/api/dividends/company/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    const dividends = await dividendScraper.getDividendsByCompany(symbol, limit);
    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      count: dividends.length,
      data: dividends,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error fetching dividends for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get dividends by fiscal year
app.get('/api/dividends/fiscal/:year', async (req, res) => {
  try {
    const { year } = req.params;
    const dividends = await dividendScraper.getDividendsByFiscalYear(year);
    res.json({
      success: true,
      fiscal_year: year,
      count: dividends.length,
      data: dividends,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error fetching dividends for FY ${req.params.year}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Calculate dividend yield
app.get('/api/dividends/yield/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { price } = req.query;
    const result = await dividendScraper.calculateDividendYield(symbol, price ? parseFloat(price) : null);
    
    if (!result) {
      return res.status(404).json({ error: 'No dividend data found for symbol' });
    }
    
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error calculating dividend yield for ${req.params.symbol}:`, error.message);
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
// ============ BONUS SHARE ENDPOINTS ============
const bonusScraper = require('./scrapers/events/bonusScraper');

// Get all bonus shares
app.get('/api/bonus/all', async (req, res) => {
  try {
    const { fiscalYear } = req.query;
    const result = await bonusScraper.fetchBonusShares(fiscalYear);
    res.json({
      success: result.success,
      count: result.count,
      data: result.data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching bonus shares:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get bonus by company
app.get('/api/bonus/company/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    const bonuses = await bonusScraper.getBonusByCompany(symbol, limit);
    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      count: bonuses.length,
      data: bonuses,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error fetching bonus for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get upcoming bonus
app.get('/api/bonus/upcoming', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const upcoming = await bonusScraper.getUpcomingBonus(limit);
    res.json({
      success: true,
      count: upcoming.length,
      data: upcoming,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching upcoming bonus:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get bonus history by fiscal year
app.get('/api/bonus/history/:fiscalYear', async (req, res) => {
  try {
    const { fiscalYear } = req.params;
    const history = await bonusScraper.getBonusHistory(fiscalYear);
    res.json({
      success: true,
      fiscal_year: fiscalYear,
      count: history.length,
      data: history,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error fetching bonus history for FY ${req.params.fiscalYear}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get bonus statistics
app.get('/api/bonus/stats/:fiscalYear', async (req, res) => {
  try {
    const { fiscalYear } = req.params;
    const stats = await bonusScraper.getTotalBonusShares(fiscalYear);
    const history = await bonusScraper.getBonusHistory(fiscalYear);
    res.json({
      success: true,
      fiscal_year: fiscalYear,
      statistics: stats,
      top_bonus: history.slice(0, 10),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error fetching bonus stats for FY ${req.params.fiscalYear}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Calculate bonus impact
app.get('/api/bonus/impact/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { price } = req.query;
    
    if (!price) {
      return res.status(400).json({ error: 'Price parameter required' });
    }
    
    const impact = await bonusScraper.calculateBonusImpact(symbol, parseFloat(price));
    
    if (!impact) {
      return res.status(404).json({ error: 'No bonus data found for symbol' });
    }
    
    res.json({
      success: true,
      data: impact,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error calculating bonus impact for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});
// ============ CHART ENDPOINT ============
app.get('/chart', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>SOPAN Candlestick Chart</title><script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.js"></script><style>body{margin:0;padding:20px;background:#1a1a2e;color:#fff}#chart{width:100%;height:600px}</style></head><body><h2>SOPAN Pharmaceuticals (SOPL)</h2><div id="chart"></div><script>fetch('/api/candles/SOPL?period=1m').then(r=>r.json()).then(data=>{const chart=LightweightCharts.createChart(document.getElementById('chart'),{width:window.innerWidth-40,height:600,layout:{background:{color:'#1a1a2e'},textColor:'#ddd'}});const series=chart.addCandlestickSeries({upColor:'#4caf50',downColor:'#f44336'});series.setData(data.data.map(c=>({time:c.date,open:c.open,high:c.high,low:c.low,close:c.close})));chart.timeScale().fitContent()});</script></body></html>`);
});
// ============ IPO ENDPOINTS ============
const ipoScraper = require('./scrapers/events/ipoScraper');

// Get all IPOs
app.get('/api/ipo/all', async (req, res) => {
  try {
    const ipos = await ipoScraper.fetchIPOData();
    res.json({
      success: true,
      count: ipos.length,
      data: ipos,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching IPOs:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get upcoming IPOs
app.get('/api/ipo/upcoming', async (req, res) => {
  try {
    const ipos = await ipoScraper.getUpcomingIPOs();
    res.json({
      success: true,
      count: ipos.length,
      data: ipos,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching upcoming IPOs:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get active IPOs
app.get('/api/ipo/active', async (req, res) => {
  try {
    const ipos = await ipoScraper.getActiveIPOs();
    res.json({
      success: true,
      count: ipos.length,
      data: ipos,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching active IPOs:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get recent IPOs
app.get('/api/ipo/recent', async (req, res) => {
  try {
    const ipos = await ipoScraper.getRecentIPOs();
    res.json({
      success: true,
      count: ipos.length,
      data: ipos,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching recent IPOs:', error.message);
    res.status(500).json({ error: error.message });
  }
});
// ============ HEALTH & ROOT ============
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString(), uptime: process.uptime(), cache_size: cache.size });
});

app.get('/', (req, res) => {
  res.json({
    name: 'NEPSE Market Data API',
    version: '3.0.0',
    status: 'running',
    market_data_source: 'MeroLagani',
    endpoints: {
      live: {
        prices: 'GET /api/live/prices?fresh=true - Real-time stock prices',
        price: 'GET /api/live/price/:symbol - Live price for specific stock',
        gainers: 'GET /api/live/gainers - Top gainers',
        losers: 'GET /api/live/losers - Top losers',
        active: 'GET /api/live/active - Most active stocks',
        summary: 'GET /api/live/summary - Live market summary'
      },
      ipo: {
  all: 'GET /api/ipo/all - All IPO announcements',
  upcoming: 'GET /api/ipo/upcoming - Upcoming IPOs',
  active: 'GET /api/ipo/active - Currently active IPOs',
  recent: 'GET /api/ipo/recent - Recent IPOs (last 6 months)'
},
dividends: {
  all: 'GET /api/dividends/all - All dividend announcements',
  latest: 'GET /api/dividends/latest?limit=20 - Latest dividends (6 months)',
  byCompany: 'GET /api/dividends/company/:symbol - Dividends by company',
  byFiscalYear: 'GET /api/dividends/fiscal/:year - Dividends by fiscal year',
  yield: 'GET /api/dividends/yield/:symbol?price=500 - Dividend yield calculation'
},
bonus: {
  all: 'GET /api/bonus/all - All bonus announcements',
  byCompany: 'GET /api/bonus/company/:symbol - Bonus by company',
  upcoming: 'GET /api/bonus/upcoming - Upcoming bonus announcements',
  history: 'GET /api/bonus/history/:fiscalYear - Bonus history by fiscal year',
  stats: 'GET /api/bonus/stats/:fiscalYear - Bonus statistics',
  impact: 'GET /api/bonus/impact/:symbol?price=500 - Calculate bonus impact on price'
},
      market: {
        summary: 'GET /api/market/summary',
        overall: 'GET /api/market/overall',
        turnover: 'GET /api/market/turnover',
        sectors: 'GET /api/market/sectors',
        brokers: 'GET /api/market/brokers',
        gainers: 'GET /api/market/gainers',
        losers: 'GET /api/market/losers',
        active: 'GET /api/market/active'
      },
      stocks: {
        all: 'GET /api/stocks',
        single: 'GET /api/stock/:symbol'
      },
      companies: {
        search: 'GET /api/companies/search?q=NABIL',
        all: 'GET /api/companies/all',
        details: 'GET /api/company/:symbol',
        batch: 'POST /api/companies/batch'
      },
      events: {
        all: 'GET /api/events',
        upcoming: 'GET /api/events/upcoming?months=3',
        ipo: 'GET /api/events/ipo',
        dividends: 'GET /api/events/dividends',
        agm: 'GET /api/events/agm',
        rightShare: 'GET /api/events/right-share',
        byCompany: 'GET /api/events/company/:symbol',
        stats: 'GET /api/events/stats'
      },
      candles: {
        single: 'GET /api/candles/:symbol?period=1y',
        bulk: 'POST /api/candles/bulk'
      },
      index: {
        latest: 'GET /api/index/latest',
        historical: 'GET /api/index/historical'
      },
      chart: 'GET /chart',
      health: 'GET /health'
    },
    timestamp: new Date().toISOString()
  });
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
  console.log(`📉 Chart: http://localhost:${PORT}/chart`);
  console.log(`💚 Health: http://localhost:${PORT}/health`);
  console.log(`🔴 Live Price: http://localhost:${PORT}/api/live/price/NABIL`);
});

module.exports = app;