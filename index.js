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
    const { limit = 50, fresh = false } = req.query;
    const now = new Date();
    
    // Use a wider date range to ensure all data is captured
    const fromDate = `1/1/2025`;  // Fixed from 2025
    const toDate = `12/31/2027`;   // Fixed to 2027
    
    const cacheKey = `agm_events_2025_2027`;
    
    // Skip cache if fresh=true
    let events;
    if (fresh === 'true') {
      const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx', {
        params: { type: 'stock_event', fromDate: fromDate, toDate: toDate },
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
      });
      events = response.data.detail || [];
      cache.set(cacheKey, { data: events, timestamp: Date.now() });
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
    
    // Filter AGM events (case insensitive)
    const agmEvents = events.filter(event => 
      event.announcementDetail.toLowerCase().includes('agm')
    );
    
    // Sort by date (newest first)
    agmEvents.sort((a, b) => new Date(b.actionDate) - new Date(a.actionDate));
    
    const limited = agmEvents.slice(0, parseInt(limit));
    
    // Find Tarakhola specifically for debugging
    const tarakholaEvents = agmEvents.filter(event => 
      event.announcementDetail.toLowerCase().includes('tarakhola')
    );
    
    res.json({
      success: true,
      count: limited.length,
      total_available: agmEvents.length,
      date_range: { from: fromDate, to: toDate },
      tarakhola_found: tarakholaEvents.length,
      tarakhola_data: tarakholaEvents,
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

// ============ CHART ENDPOINT ============
app.get('/chart', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>SOPAN Candlestick Chart</title><script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.js"></script><style>body{margin:0;padding:20px;background:#1a1a2e;color:#fff}#chart{width:100%;height:600px}</style></head><body><h2>SOPAN Pharmaceuticals (SOPL)</h2><div id="chart"></div><script>fetch('/api/candles/SOPL?period=1m').then(r=>r.json()).then(data=>{const chart=LightweightCharts.createChart(document.getElementById('chart'),{width:window.innerWidth-40,height:600,layout:{background:{color:'#1a1a2e'},textColor:'#ddd'}});const series=chart.addCandlestickSeries({upColor:'#4caf50',downColor:'#f44336'});series.setData(data.data.map(c=>({time:c.date,open:c.open,high:c.high,low:c.low,close:c.close})));chart.timeScale().fitContent()});</script></body></html>`);
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
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
            color: #fff;
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        .header {
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 30px;
            margin-bottom: 20px;
            border: 1px solid rgba(255,255,255,0.1);
        }
        h1 { font-size: 32px; margin-bottom: 10px; display: flex; align-items: center; gap: 10px; }
        .badge { background: #00ff9d; color: #1a1a2e; padding: 5px 10px; border-radius: 20px; font-size: 14px; font-weight: bold; }
        .status { color: #00ff9d; margin-top: 10px; }
        .endpoints-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 20px; }
        .card {
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 20px;
            border: 1px solid rgba(255,255,255,0.1);
            transition: transform 0.3s;
        }
        .card:hover { transform: translateY(-5px); background: rgba(255,255,255,0.15); }
        .card-title {
            font-size: 20px;
            font-weight: bold;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #00ff9d;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .card-title .emoji { font-size: 24px; }
        .endpoint-list { list-style: none; }
        .endpoint-list li {
            margin-bottom: 12px;
            padding: 8px;
            border-radius: 8px;
            transition: background 0.2s;
        }
        .endpoint-list li:hover { background: rgba(255,255,255,0.1); }
        .method {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 5px;
            font-size: 11px;
            font-weight: bold;
            margin-right: 10px;
        }
        .method.get { background: #00ff9d; color: #1a1a2e; }
        .method.post { background: #ffd700; color: #1a1a2e; }
        .endpoint-url { font-family: monospace; font-size: 13px; word-break: break-all; }
        .endpoint-url a { color: #fff; text-decoration: none; border-bottom: 1px dashed rgba(255,255,255,0.3); }
        .endpoint-url a:hover { color: #00ff9d; border-bottom-color: #00ff9d; }
        .description { font-size: 11px; color: #aaa; margin-top: 5px; margin-left: 65px; }
        .footer {
            text-align: center;
            margin-top: 30px;
            padding: 20px;
            background: rgba(255,255,255,0.05);
            border-radius: 15px;
            font-size: 12px;
            color: #aaa;
        }
        @media (max-width: 768px) {
            .endpoints-grid { grid-template-columns: 1fr; }
            .description { margin-left: 0; margin-top: 8px; }
        }
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
            <!-- Live Prices -->
            <div class="card">
                <div class="card-title"><span class="emoji">🔴</span>Live Prices</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/live/prices?fresh=true" target="_blank">${baseUrl}/api/live/prices?fresh=true</a></span><div class="description">Real-time stock prices (use ?fresh=true to bypass cache)</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/live/price/NABIL" target="_blank">${baseUrl}/api/live/price/:symbol</a></span><div class="description">Live price for specific stock (e.g., NABIL, EBL, PRVU)</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/live/gainers" target="_blank">${baseUrl}/api/live/gainers</a></span><div class="description">Top gaining stocks</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/live/losers" target="_blank">${baseUrl}/api/live/losers</a></span><div class="description">Top losing stocks</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/live/active" target="_blank">${baseUrl}/api/live/active</a></span><div class="description">Most active stocks by volume</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/live/summary" target="_blank">${baseUrl}/api/live/summary</a></span><div class="description">Live market summary</div></li>
                </ul>
            </div>

            <!-- IPO -->
            <div class="card">
                <div class="card-title"><span class="emoji">🚀</span>IPO Announcements</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/ipo/all" target="_blank">${baseUrl}/api/ipo/all</a></span><div class="description">All IPO announcements</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/ipo/upcoming" target="_blank">${baseUrl}/api/ipo/upcoming</a></span><div class="description">Upcoming IPOs</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/ipo/active" target="_blank">${baseUrl}/api/ipo/active</a></span><div class="description">Currently active IPOs</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/ipo/recent" target="_blank">${baseUrl}/api/ipo/recent</a></span><div class="description">Recent IPOs (last 6 months)</div></li>
                </ul>
            </div>

            <!-- Dividends -->
            <div class="card">
                <div class="card-title"><span class="emoji">💰</span>Dividends</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/dividends/all" target="_blank">${baseUrl}/api/dividends/all</a></span><div class="description">All dividend announcements</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/dividends/latest?limit=20" target="_blank">${baseUrl}/api/dividends/latest?limit=20</a></span><div class="description">Latest dividends (6 months)</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/dividends/company/NABIL" target="_blank">${baseUrl}/api/dividends/company/:symbol</a></span><div class="description">Dividends by company</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/dividends/fiscal/2079/80" target="_blank">${baseUrl}/api/dividends/fiscal/:year</a></span><div class="description">Dividends by fiscal year</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/dividends/yield/NABIL?price=500" target="_blank">${baseUrl}/api/dividends/yield/:symbol?price=500</a></span><div class="description">Dividend yield calculation</div></li>
                </ul>
            </div>

            <!-- Bonus Shares -->
            <div class="card">
                <div class="card-title"><span class="emoji">🎁</span>Bonus Shares</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/bonus/all" target="_blank">${baseUrl}/api/bonus/all</a></span><div class="description">All bonus announcements</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/bonus/company/NABIL" target="_blank">${baseUrl}/api/bonus/company/:symbol</a></span><div class="description">Bonus by company</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/bonus/upcoming" target="_blank">${baseUrl}/api/bonus/upcoming</a></span><div class="description">Upcoming bonus announcements</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/bonus/history/2079/80" target="_blank">${baseUrl}/api/bonus/history/:fiscalYear</a></span><div class="description">Bonus history by fiscal year</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/bonus/stats/2079/80" target="_blank">${baseUrl}/api/bonus/stats/:fiscalYear</a></span><div class="description">Bonus statistics</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/bonus/impact/NABIL?price=500" target="_blank">${baseUrl}/api/bonus/impact/:symbol?price=500</a></span><div class="description">Calculate bonus impact on price</div></li>
                </ul>
            </div>

            <!-- Market Data -->
            <div class="card">
                <div class="card-title"><span class="emoji">📈</span>Market Data</div>
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

            <!-- Stocks -->
            <div class="card">
                <div class="card-title"><span class="emoji">📊</span>Stocks</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/stocks" target="_blank">${baseUrl}/api/stocks</a></span><div class="description">All stocks data</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/stock/NABIL" target="_blank">${baseUrl}/api/stock/:symbol</a></span><div class="description">Specific stock data (e.g., NABIL)</div></li>
                </ul>
            </div>

            <!-- Companies -->
            <div class="card">
                <div class="card-title"><span class="emoji">🏢</span>Companies</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/companies/search?q=NABIL" target="_blank">${baseUrl}/api/companies/search?q=NABIL</a></span><div class="description">Search companies</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/companies/all" target="_blank">${baseUrl}/api/companies/all</a></span><div class="description">All companies list</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/company/NABIL" target="_blank">${baseUrl}/api/company/:symbol</a></span><div class="description">Company details with market data</div></li>
                    <li><span class="method post">POST</span><span class="endpoint-url">${baseUrl}/api/companies/batch</span><div class="description">Batch company details (POST with JSON body)</div></li>
                </ul>
            </div>

            <!-- Events -->
            <div class="card">
                <div class="card-title"><span class="emoji">📅</span>Corporate Events</div>
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

            <!-- Candles -->
            <div class="card">
                <div class="card-title"><span class="emoji">🕯️</span>Historical Candles</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/candles/NABIL?period=1y" target="_blank">${baseUrl}/api/candles/:symbol?period=1y</a></span><div class="description">Historical OHLC data (period: 1w,1m,3m,6m,1y,2y,3y,5y)</div></li>
                    <li><span class="method post">POST</span><span class="endpoint-url">${baseUrl}/api/candles/bulk</span><div class="description">Bulk candles for multiple symbols (max 50)</div></li>
                </ul>
            </div>

            <!-- NEPSE Index -->
            <div class="card">
                <div class="card-title"><span class="emoji">📉</span>NEPSE Index</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/index/latest" target="_blank">${baseUrl}/api/index/latest</a></span><div class="description">Latest NEPSE Index value</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/api/index/historical?limit=100" target="_blank">${baseUrl}/api/index/historical?limit=100</a></span><div class="description">Historical index data (2814 records)</div></li>
                </ul>
            </div>

            <!-- Charts -->
            <div class="card">
                <div class="card-title"><span class="emoji">📊</span>Charts & Health</div>
                <ul class="endpoint-list">
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/chart" target="_blank">${baseUrl}/chart</a></span><div class="description">Interactive SOPAN candlestick chart</div></li>
                    <li><span class="method get">GET</span><span class="endpoint-url"><a href="${baseUrl}/health" target="_blank">${baseUrl}/health</a></span><div class="description">API health check</div></li>
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

// Get latest dividends (last 6 months)
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