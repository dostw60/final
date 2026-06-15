// index.js - COMPLETE PRODUCTION READY VERSION
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.API_PORT || 3000;

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

app.get('/api/events', async (req, res) => {
  try {
    const { from, to, type, symbol, limit = 100 } = req.query;
    const now = new Date();
    const fromDate = from || `${now.getMonth() + 1}/1/${now.getFullYear()}`;
    const toDate = to || `${now.getMonth() + 2}/0/${now.getFullYear()}`;
    
    const cacheKey = `events_${fromDate}_${toDate}`;
    const cached = cache.get(cacheKey);
    let events;
    if (cached && Date.now() - cached.timestamp < 3600000) {
      events = cached.data;
    } else {
      events = await fetchStockEvents(fromDate, toDate);
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
    
    res.json({ success: true, count: events.length, data: events, filters: { from: fromDate, to: toDate, type, symbol, limit }, timestamp: new Date().toISOString() });
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
  res.json({
    name: 'NEPSE Market Data API', version: '3.0.0', status: 'running',
    endpoints: {
      market: { summary: 'GET /api/market/summary', overall: 'GET /api/market/overall', turnover: 'GET /api/market/turnover', sectors: 'GET /api/market/sectors', brokers: 'GET /api/market/brokers', gainers: 'GET /api/market/gainers', losers: 'GET /api/market/losers', active: 'GET /api/market/active' },
      stocks: { all: 'GET /api/stocks', single: 'GET /api/stock/:symbol' },
      companies: { search: 'GET /api/companies/search?q=NABIL', all: 'GET /api/companies/all', details: 'GET /api/company/:symbol', batch: 'POST /api/companies/batch' },
      events: { all: 'GET /api/events', upcoming: 'GET /api/events/upcoming?months=3', ipo: 'GET /api/events/ipo', dividends: 'GET /api/events/dividends', agm: 'GET /api/events/agm', rightShare: 'GET /api/events/right-share', byCompany: 'GET /api/events/company/:symbol', stats: 'GET /api/events/stats' },
      candles: { single: 'GET /api/candles/:symbol?period=1y', bulk: 'POST /api/candles/bulk' },
      index: { latest: 'GET /api/index/latest', historical: 'GET /api/index/historical' },
      chart: 'GET /chart', health: 'GET /health'
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
const server = app.listen(PORT, () => {
  console.log(`\n🚀 NEPSE Market Data API running on http://localhost:${PORT}\n📊 Market: http://localhost:${PORT}/api/market/summary\n📅 Events: http://localhost:${PORT}/api/events\n📈 Index: http://localhost:${PORT}/api/index/latest\n📉 Chart: http://localhost:${PORT}/chart\n`);
});

module.exports = app;