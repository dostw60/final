// index.js
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

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Serve static files (for charts, etc.)
app.use(express.static('public'));

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

// Get complete market summary
app.get('/api/market/summary', async (req, res) => {
  try {
    const cacheKey = 'market_summary';
    const cached = cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 5000) {
      return res.json(cached.data);
    }
    
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary', {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
    
    const result = {
      success: true,
      data: response.data,
      timestamp: new Date().toISOString(),
      source: 'merolagani'
    };
    
    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    res.json(result);
    
  } catch (error) {
    console.error('Error fetching market summary:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get overall market stats
app.get('/api/market/overall', async (req, res) => {
  try {
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    
    res.json({
      success: true,
      data: response.data.overall,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get turnover leaders
app.get('/api/market/turnover', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    
    const turnoverLeaders = response.data.turnover?.detail?.slice(0, limit) || [];
    
    res.json({
      success: true,
      count: turnoverLeaders.length,
      data: turnoverLeaders,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get sector performance
app.get('/api/market/sectors', async (req, res) => {
  try {
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    
    const sectors = response.data.sector?.detail || [];
    
    res.json({
      success: true,
      count: sectors.length,
      data: sectors,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get broker performance
app.get('/api/market/brokers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    
    const brokers = response.data.broker?.detail?.slice(0, limit) || [];
    
    res.json({
      success: true,
      count: brokers.length,
      data: brokers,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all stocks
app.get('/api/stocks', async (req, res) => {
  try {
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    
    const stocks = response.data.stock?.detail || [];
    
    res.json({
      success: true,
      count: stocks.length,
      data: stocks,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific stock
app.get('/api/stock/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    
    const stocks = response.data.stock?.detail || [];
    const stock = stocks.find(s => s.s === symbol.toUpperCase());
    
    if (!stock) {
      return res.status(404).json({ error: 'Stock not found' });
    }
    
    res.json({
      success: true,
      data: stock,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get top gainers
app.get('/api/market/gainers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    
    const stocks = response.data.stock?.detail || [];
    const gainers = stocks
      .filter(stock => stock.c > 0)
      .sort((a, b) => b.c - a.c)
      .slice(0, limit);
    
    res.json({
      success: true,
      count: gainers.length,
      data: gainers,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get top losers
app.get('/api/market/losers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    
    const stocks = response.data.stock?.detail || [];
    const losers = stocks
      .filter(stock => stock.c < 0)
      .sort((a, b) => a.c - b.c)
      .slice(0, limit);
    
    res.json({
      success: true,
      count: losers.length,
      data: losers,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get most active stocks by volume
app.get('/api/market/active', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const response = await axios.get('https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary');
    
    const stocks = response.data.stock?.detail || [];
    const active = stocks
      .sort((a, b) => b.q - a.q)
      .slice(0, limit);
    
    res.json({
      success: true,
      count: active.length,
      data: active,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ COMPANY SEARCH ENDPOINTS ============

// Search companies (autocomplete)
app.get('/api/companies/search', async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({
        success: true,
        data: [],
        message: 'Please provide at least 2 characters for search'
      });
    }
    
    const response = await axios.get(
      `https://www.merolagani.com/handlers/AutoSuggestHandler.ashx?type=Company`,
      {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      }
    );
    
    const searchTerm = q.toUpperCase();
    const matches = response.data
      .filter(company => 
        company.l.toUpperCase().includes(searchTerm) || 
        company.d.toUpperCase().includes(searchTerm)
      )
      .slice(0, limit)
      .map(company => {
        let fullName = company.l;
        const nameMatch = company.l.match(/\(([^)]+)\)/);
        if (nameMatch) {
          fullName = nameMatch[1];
        }
        return {
          symbol: company.d,
          name: fullName,
          id: company.v
        };
      });
    
    res.json({
      success: true,
      count: matches.length,
      data: matches,
      query: q,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error searching companies:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get all companies list
app.get('/api/companies/all', async (req, res) => {
  try {
    const cacheKey = 'all_companies';
    const cached = cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 3600000) {
      return res.json(cached.data);
    }
    
    const response = await axios.get(
      'https://www.merolagani.com/handlers/AutoSuggestHandler.ashx?type=Company',
      {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      }
    );
    
    const companies = response.data.map(company => {
      let fullName = company.l;
      const nameMatch = company.l.match(/\(([^)]+)\)/);
      if (nameMatch) {
        fullName = nameMatch[1];
      }
      return {
        symbol: company.d,
        name: fullName,
        id: company.v
      };
    });
    
    const result = {
      success: true,
      count: companies.length,
      data: companies,
      timestamp: new Date().toISOString()
    };
    
    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    res.json(result);
    
  } catch (error) {
    console.error('Error fetching companies:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get company details by symbol
app.get('/api/company/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    const companiesResponse = await axios.get(
      'https://www.merolagani.com/handlers/AutoSuggestHandler.ashx?type=Company',
      {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      }
    );
    
    const companyInfo = companiesResponse.data.find(
      c => c.d.toUpperCase() === symbol.toUpperCase()
    );
    
    if (!companyInfo) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    let fullName = companyInfo.l;
    const nameMatch = companyInfo.l.match(/\(([^)]+)\)/);
    if (nameMatch) {
      fullName = nameMatch[1];
    }
    
    const marketResponse = await axios.get(
      'https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary',
      {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      }
    );
    
    const stockData = marketResponse.data.stock?.detail?.find(
      s => s.s === symbol.toUpperCase()
    );
    
    const result = {
      success: true,
      data: {
        symbol: companyInfo.d,
        name: fullName,
        id: companyInfo.v,
        market_data: stockData || null,
        last_updated: new Date().toISOString()
      }
    };
    
    res.json(result);
    
  } catch (error) {
    console.error('Error fetching company details:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Batch company details
app.post('/api/companies/batch', async (req, res) => {
  try {
    const { symbols } = req.body;
    
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: 'Symbols array required' });
    }
    
    const companiesResponse = await axios.get(
      'https://www.merolagani.com/handlers/AutoSuggestHandler.ashx?type=Company',
      {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      }
    );
    
    const marketResponse = await axios.get(
      'https://www.merolagani.com/handlers/webrequesthandler.ashx?type=market_summary',
      {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      }
    );
    
    const results = [];
    for (const symbol of symbols) {
      const companyInfo = companiesResponse.data.find(
        c => c.d.toUpperCase() === symbol.toUpperCase()
      );
      
      const stockData = marketResponse.data.stock?.detail?.find(
        s => s.s === symbol.toUpperCase()
      );
      
      if (companyInfo) {
        let fullName = companyInfo.l;
        const nameMatch = companyInfo.l.match(/\(([^)]+)\)/);
        if (nameMatch) {
          fullName = nameMatch[1];
        }
        results.push({
          symbol: companyInfo.d,
          name: fullName,
          id: companyInfo.v,
          market_data: stockData || null
        });
      }
    }
    
    res.json({
      success: true,
      count: results.length,
      data: results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching batch companies:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ STOCK EVENT ENDPOINTS ============

// Helper function to fetch stock events
async function fetchStockEvents(fromDate, toDate) {
  const response = await axios.get(
    'https://www.merolagani.com/handlers/webrequesthandler.ashx',
    {
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
    }
  );
  return response.data.detail || [];
}

// Get all events for a date range
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
      events = events.filter(event => 
        event.announcementDetail.toLowerCase().includes(typeLower)
      );
    }
    
    if (symbol) {
      const symbolUpper = symbol.toUpperCase();
      events = events.filter(event => 
        event.announcementDetail.toUpperCase().includes(symbolUpper)
      );
    }
    
    events = events.slice(0, parseInt(limit));
    
    res.json({
      success: true,
      count: events.length,
      data: events,
      filters: { from: fromDate, to: toDate, type, symbol, limit },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching events:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get IPO events
app.get('/api/events/ipo', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const now = new Date();
    const fromDate = `1/1/${now.getFullYear() - 1}`;
    const toDate = `12/31/${now.getFullYear() + 1}`;
    
    const events = await fetchStockEvents(fromDate, toDate);
    
    const ipoEvents = events
      .filter(event => 
        event.announcementDetail.toLowerCase().includes('ipo') ||
        event.announcementDetail.toLowerCase().includes('initial public offering')
      )
      .slice(0, parseInt(limit))
      .map(event => ({
        date: event.actionDate,
        description: event.announcementDetail,
        day: event.day
      }));
    
    res.json({
      success: true,
      count: ipoEvents.length,
      data: ipoEvents,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching IPO events:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get dividend and bonus events
app.get('/api/events/dividends', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const now = new Date();
    const fromDate = `1/1/${now.getFullYear() - 1}`;
    const toDate = `12/31/${now.getFullYear() + 1}`;
    
    const events = await fetchStockEvents(fromDate, toDate);
    
    const dividendEvents = events
      .filter(event => 
        event.announcementDetail.toLowerCase().includes('dividend') ||
        event.announcementDetail.toLowerCase().includes('bonus share') ||
        event.announcementDetail.toLowerCase().includes('cash dividend')
      )
      .slice(0, parseInt(limit))
      .map(event => ({
        date: event.actionDate,
        description: event.announcementDetail,
        day: event.day
      }));
    
    res.json({
      success: true,
      count: dividendEvents.length,
      data: dividendEvents,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching dividend events:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get AGM events
app.get('/api/events/agm', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const now = new Date();
    const fromDate = `1/1/${now.getFullYear()}`;
    const toDate = `12/31/${now.getFullYear() + 1}`;
    
    const events = await fetchStockEvents(fromDate, toDate);
    
    const agmEvents = events
      .filter(event => 
        event.announcementDetail.toLowerCase().includes('agm') ||
        event.announcementDetail.toLowerCase().includes('annual general meeting')
      )
      .slice(0, parseInt(limit))
      .map(event => ({
        date: event.actionDate,
        description: event.announcementDetail,
        day: event.day
      }));
    
    res.json({
      success: true,
      count: agmEvents.length,
      data: agmEvents,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching AGM events:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get right share events
app.get('/api/events/right-share', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const now = new Date();
    const fromDate = `1/1/${now.getFullYear() - 1}`;
    const toDate = `12/31/${now.getFullYear() + 1}`;
    
    const events = await fetchStockEvents(fromDate, toDate);
    
    const rightShareEvents = events
      .filter(event => 
        event.announcementDetail.toLowerCase().includes('right share')
      )
      .slice(0, parseInt(limit))
      .map(event => ({
        date: event.actionDate,
        description: event.announcementDetail,
        day: event.day
      }));
    
    res.json({
      success: true,
      count: rightShareEvents.length,
      data: rightShareEvents,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching right share events:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get events by company symbol
app.get('/api/events/company/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { limit = 50 } = req.query;
    const now = new Date();
    const fromDate = `1/1/${now.getFullYear() - 2}`;
    const toDate = `12/31/${now.getFullYear() + 1}`;
    
    const events = await fetchStockEvents(fromDate, toDate);
    
    const companyEvents = events
      .filter(event => 
        event.announcementDetail.toUpperCase().includes(symbol.toUpperCase())
      )
      .slice(0, parseInt(limit))
      .map(event => ({
        date: event.actionDate,
        description: event.announcementDetail,
        day: event.day
      }));
    
    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      count: companyEvents.length,
      data: companyEvents,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`Error fetching events for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get event summary statistics
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
      bonus_count: events.filter(e => e.announcementDetail.toLowerCase().includes('bonus')).length,
      agm_count: events.filter(e => e.announcementDetail.toLowerCase().includes('agm')).length,
      right_share_count: events.filter(e => e.announcementDetail.toLowerCase().includes('right share')).length,
      by_month: {}
    };
    
    events.forEach(event => {
      const month = event.actionDate.split('/')[1];
      if (!stats.by_month[month]) {
        stats.by_month[month] = 0;
      }
      stats.by_month[month]++;
    });
    
    res.json({
      success: true,
      data: stats,
      year: now.getFullYear(),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching event stats:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ HISTORICAL CANDLES ENDPOINTS ============

// Get historical OHLC data (single symbol)
app.get('/api/candles/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { period = '1y' } = req.query;
    
    // Calculate date range based on period
    const endDate = new Date();
    const startDate = getStartDate(period);
    
    // Convert to Unix timestamps
    const rangeStartDate = Math.floor(startDate.getTime() / 1000);
    const rangeEndDate = Math.floor(endDate.getTime() / 1000);
    
    console.log(`Fetching candles for ${symbol} from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    const response = await axios.get(
      'https://www.merolagani.com/handlers/TechnicalChartHandler.ashx',
      {
        params: {
          type: 'get_advanced_chart',
          symbol: symbol.toUpperCase(),
          resolution: '1D',
          rangeStartDate: rangeStartDate,
          rangeEndDate: rangeEndDate,
          isAdjust: 1,
          currencyCode: 'NPR'
        },
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      }
    );
    
    // Format the response
    const candles = [];
    if (response.data && response.data.s === 'ok') {
      for (let i = 0; i < response.data.t.length; i++) {
        candles.push({
          date: new Date(response.data.t[i] * 1000).toISOString().split('T')[0],
          open: response.data.o[i],
          high: response.data.h[i],
          low: response.data.l[i],
          close: response.data.c[i],
          volume: response.data.v[i]
        });
      }
    }
    
    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      period: period,
      count: candles.length,
      data: candles,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching candles:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get candles for multiple symbols at once (BULK endpoint)
app.post('/api/candles/bulk', async (req, res) => {
  try {
    const { symbols, period = '1y' } = req.body;
    
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ 
        error: 'Symbols array required',
        example: { symbols: ['NABIL', 'EBL', 'PRVU'], period: '1m' }
      });
    }
    
    // Limit to 50 symbols per request for performance
    if (symbols.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 symbols per request' });
    }
    
    const results = [];
    let successCount = 0;
    
    for (const symbol of symbols) {
      try {
        const startDate = getStartDate(period);
        const endDate = new Date();
        
        const response = await axios.get(
          'https://www.merolagani.com/handlers/TechnicalChartHandler.ashx',
          {
            params: {
              type: 'get_advanced_chart',
              symbol: symbol.toUpperCase(),
              resolution: '1D',
              rangeStartDate: Math.floor(startDate.getTime() / 1000),
              rangeEndDate: Math.floor(endDate.getTime() / 1000),
              isAdjust: 1,
              currencyCode: 'NPR'
            },
            timeout: 15000,
            headers: {
              'User-Agent': 'Mozilla/5.0',
              'Accept': 'application/json'
            }
          }
        );
        
        const candles = [];
        if (response.data && response.data.s === 'ok') {
          for (let i = 0; i < response.data.t.length; i++) {
            candles.push({
              date: new Date(response.data.t[i] * 1000).toISOString().split('T')[0],
              open: response.data.o[i],
              high: response.data.h[i],
              low: response.data.l[i],
              close: response.data.c[i],
              volume: response.data.v[i]
            });
          }
        }
        
        results.push({
          symbol: symbol.toUpperCase(),
          success: true,
          count: candles.length,
          data: candles
        });
        successCount++;
        
      } catch (error) {
        results.push({
          symbol: symbol.toUpperCase(),
          success: false,
          error: error.message,
          count: 0,
          data: []
        });
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    res.json({
      success: true,
      period: period,
      total_requested: symbols.length,
      successful: successCount,
      failed: symbols.length - successCount,
      data: results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error in bulk candles:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ NEPSE INDEX ENDPOINTS ============

// Get historical NEPSE Index data
app.get('/api/index/historical', async (req, res) => {
  try {
    const { limit = 100, page = 1 } = req.query;
    
    const cacheKey = `nepse_index_historical_page_${page}_limit_${limit}`;
    const cached = cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 3600000) {
      return res.json(cached.data);
    }
    
    // Fetch the Indices page from MeroLagani
    const response = await axios.get('https://merolagani.com/Indices.aspx', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    
    const html = response.data;
    
    // Extract the table data using regex
    const tableRegex = /<td[^>]*>([\d\-/]+)<\/td>\s*<td[^>]*>([\d,]+\.?\d*)<\/td>\s*<td[^>]*>(-?[\d,]+\.?\d*)<\/td>\s*<td[^>]*>(-?[\d,]+\.?\d*%)<\/td>/g;
    
    const indices = [];
    let match;
    
    while ((match = tableRegex.exec(html)) !== null) {
      indices.push({
        date: match[1],
        index_value: parseFloat(match[2].replace(/,/g, '')),
        absolute_change: parseFloat(match[3].replace(/,/g, '')),
        percentage_change: match[4]
      });
    }
    
    // Apply pagination
    const start = (parseInt(page) - 1) * parseInt(limit);
    const end = start + parseInt(limit);
    const paginatedData = indices.slice(start, end);
    
    // Get latest index (first row)
    const latest = indices[0] || null;
    
    // Calculate basic statistics
    const values = indices.map(i => i.index_value);
    const highest = Math.max(...values);
    const lowest = Math.min(...values);
    const average = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
    
    const result = {
      success: true,
      source: 'merolagani',
      data: {
        latest: latest,
        statistics: {
          highest: highest,
          lowest: lowest,
          average: parseFloat(average),
          total_records: indices.length
        },
        historical: paginatedData,
        pagination: {
          current_page: parseInt(page),
          limit: parseInt(limit),
          total_pages: Math.ceil(indices.length / parseInt(limit)),
          total_records: indices.length
        }
      },
      timestamp: new Date().toISOString()
    };
    
    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    res.json(result);
    
  } catch (error) {
    console.error('Error fetching NEPSE index data:', error.message);
    res.status(500).json({ error: 'Failed to fetch index data', message: error.message });
  }
});

// Get latest NEPSE Index only
app.get('/api/index/latest', async (req, res) => {
  try {
    const cacheKey = 'nepse_index_latest';
    const cached = cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 3600000) {
      return res.json(cached.data);
    }
    
    const response = await axios.get('https://merolagani.com/Indices.aspx', {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html'
      }
    });
    
    const html = response.data;
    
    // Extract the first row (latest index)
    const firstRowRegex = /<tr[^>]*>[\s\S]*?<td[^>]*>([\d\-/]+)<\/td>[\s\S]*?<td[^>]*>([\d,]+\.?\d*)<\/td>[\s\S]*?<td[^>]*>(-?[\d,]+\.?\d*)<\/td>[\s\S]*?<td[^>]*>(-?[\d,]+\.?\d*%)<\/td>/;
    const match = html.match(firstRowRegex);
    
    if (!match) {
      throw new Error('Could not parse index data');
    }
    
    const result = {
      success: true,
      data: {
        date: match[1],
        index_value: parseFloat(match[2].replace(/,/g, '')),
        absolute_change: parseFloat(match[3].replace(/,/g, '')),
        percentage_change: match[4]
      },
      timestamp: new Date().toISOString()
    };
    
    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    res.json(result);
    
  } catch (error) {
    console.error('Error fetching latest index:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ CHART ENDPOINT (SOPAN Candlestick Chart) ============
app.get('/chart', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SOPAN Candlestick Chart - NEPSE</title>
        <script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.js"></script>
        <style>
            body {
                margin: 0;
                padding: 20px;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: #1a1a2e;
                color: #fff;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
            }
            .header {
                text-align: center;
                margin-bottom: 20px;
            }
            #chart-container {
                width: 100%;
                height: 600px;
                background: #1a1a2e;
                border-radius: 10px;
                margin-bottom: 20px;
            }
            .controls {
                text-align: center;
                margin-bottom: 20px;
            }
            button {
                background: #ffd700;
                color: #1a1a2e;
                border: none;
                padding: 10px 20px;
                margin: 0 5px;
                border-radius: 5px;
                cursor: pointer;
                font-weight: bold;
            }
            button.active {
                background: #ffaa00;
                transform: scale(1.05);
            }
            .info {
                background: rgba(255,255,255,0.1);
                padding: 15px;
                border-radius: 10px;
                margin-top: 20px;
            }
            .price {
                font-size: 24px;
                color: #ffd700;
            }
            .positive { color: #4caf50; }
            .negative { color: #f44336; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>📈 SOPAN Pharmaceuticals Limited (SOPL)</h1>
                <p>NEPSE Candlestick Chart - Live Data from MeroLagani API</p>
            </div>
            
            <div class="controls">
                <button class="period-btn" data-period="1w">1 Week</button>
                <button class="period-btn active" data-period="1m">1 Month</button>
                <button class="period-btn" data-period="3m">3 Months</button>
                <button class="period-btn" data-period="6m">6 Months</button>
                <button class="period-btn" data-period="1y">1 Year</button>
            </div>
            
            <div id="chart-container"></div>
            
            <div class="info" id="info">
                Loading SOPAN data...
            </div>
        </div>

        <script>
            let chart = null;
            let candleSeries = null;
            let currentPeriod = '1m';
            
            function initChart() {
                const container = document.getElementById('chart-container');
                
                if (chart) chart.remove();
                
                chart = LightweightCharts.createChart(container, {
                    width: container.clientWidth,
                    height: 600,
                    layout: {
                        background: { color: '#1a1a2e' },
                        textColor: '#d1d4dc',
                    },
                    grid: {
                        vertLines: { color: 'rgba(42, 46, 57, 0.6)' },
                        horzLines: { color: 'rgba(42, 46, 57, 0.6)' },
                    },
                    crosshair: {
                        mode: LightweightCharts.CrosshairMode.Normal,
                    },
                    rightPriceScale: {
                        borderColor: 'rgba(197, 203, 206, 0.4)',
                    },
                    timeScale: {
                        borderColor: 'rgba(197, 203, 206, 0.4)',
                        timeVisible: true,
                        secondsVisible: false,
                    },
                });
                
                candleSeries = chart.addCandlestickSeries({
                    upColor: '#4caf50',
                    downColor: '#f44336',
                    borderVisible: true,
                    wickUpColor: '#4caf50',
                    wickDownColor: '#f44336',
                });
                
                window.addEventListener('resize', () => {
                    if (chart) {
                        chart.applyOptions({ width: container.clientWidth });
                    }
                });
            }
            
            async function loadData(period) {
                document.getElementById('info').innerHTML = 'Loading SOPAN data...';
                currentPeriod = period;
                
                try {
                    const response = await fetch('/api/candles/bulk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symbols: ['SOPL'], period: period })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success && data.data && data.data[0] && data.data[0].success) {
                        const candles = data.data[0].data;
                        
                        if (candles && candles.length > 0) {
                            const chartData = candles.map(c => ({
                                time: c.date,
                                open: c.open,
                                high: c.high,
                                low: c.low,
                                close: c.close
                            }));
                            
                            candleSeries.setData(chartData);
                            chart.timeScale().fitContent();
                            
                            const latest = candles[candles.length - 1];
                            const first = candles[0];
                            const change = ((latest.close - first.close) / first.close * 100).toFixed(2);
                            const changeClass = change >= 0 ? 'positive' : 'negative';
                            
                            document.getElementById('info').innerHTML = \`
                                <strong>SOPAN Pharmaceuticals Limited (SOPL)</strong><br>
                                <span class="price">Current Price: Rs. \${latest.close}</span><br>
                                Period Change: <span class="\${changeClass}">\${change >= 0 ? '▲' : '▼'} \${Math.abs(change)}%</span><br>
                                Period High: Rs. \${Math.max(...candles.map(c => c.high))}<br>
                                Period Low: Rs. \${Math.min(...candles.map(c => c.low))}<br>
                                Total Volume: \${candles.reduce((s, c) => s + c.volume, 0).toLocaleString()}<br>
                                Trading Days: \${candles.length}<br>
                                Data Period: \${first.date} to \${latest.date}
                            \`;
                        } else {
                            document.getElementById('info').innerHTML = 'No data available for this period. Try a different time range.';
                        }
                    } else {
                        document.getElementById('info').innerHTML = 'Failed to load data. Please try again.';
                    }
                } catch (error) {
                    document.getElementById('info').innerHTML = \`Error loading data: \${error.message}\`;
                }
            }
            
            function changePeriod(period) {
                currentPeriod = period;
                document.querySelectorAll('.period-btn').forEach(btn => {
                    if (btn.dataset.period === period) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                });
                loadData(period);
            }
            
            // Initialize
            initChart();
            loadData('1m');
            
            // Set up period button listeners
            document.querySelectorAll('.period-btn').forEach(btn => {
                btn.addEventListener('click', () => changePeriod(btn.dataset.period));
            });
        </script>
    </body>
    </html>
  `);
});

// ============ HEALTH & ROOT ============
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    cache_size: cache.size
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'NEPSE Market Data API',
    version: '2.0.0',
    status: 'running',
    market_data_source: 'MeroLagani Market Summary API',
    chart_url: 'https://final-ocai.onrender.com/chart',
    endpoints: {
      market: {
        summary: 'GET /api/market/summary',
        overall: 'GET /api/market/overall',
        turnover: 'GET /api/market/turnover?limit=20',
        sectors: 'GET /api/market/sectors',
        brokers: 'GET /api/market/brokers?limit=20',
        gainers: 'GET /api/market/gainers?limit=10',
        losers: 'GET /api/market/losers?limit=10',
        active: 'GET /api/market/active?limit=10'
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
        all: 'GET /api/events?from=6/1/2026&to=6/30/2026',
        ipo: 'GET /api/events/ipo',
        dividends: 'GET /api/events/dividends',
        agm: 'GET /api/events/agm',
        rightShare: 'GET /api/events/right-share',
        byCompany: 'GET /api/events/company/:symbol',
        stats: 'GET /api/events/stats'
      },
      candles: {
        single: 'GET /api/candles/:symbol?period=1y',
        bulk: 'POST /api/candles/bulk - Body: {"symbols": ["NABIL", "EBL"], "period": "1m"}'
      },
      index: {
        latest: 'GET /api/index/latest - Current NEPSE Index value',
        historical: 'GET /api/index/historical?limit=100&page=1 - Historical index data (2814 records)'
      },
      chart: {
        sopan: 'GET /chart - Interactive SOPAN candlestick chart'
      },
      health: 'GET /health'
    },
    timestamp: new Date().toISOString()
  });
});

// ============ ERROR HANDLING (MUST BE LAST) ============
// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler - MUST BE THE LAST app.use
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.url,
    timestamp: new Date().toISOString()
  });
});

// ============ START SERVER ============
const server = app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║     🚀 NEPSE Market Data API is running successfully!        ║
║     📊 Using MeroLagani Market Summary & Events API          ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝

📡 Server: http://localhost:${PORT}
🏥 Health: http://localhost:${PORT}/health
📈 Market Summary: http://localhost:${PORT}/api/market/summary
📅 Events: http://localhost:${PORT}/api/events
📊 Candles: 
   • Single: http://localhost:${PORT}/api/candles/NABIL?period=1y
   • Bulk: POST http://localhost:${PORT}/api/candles/bulk
📉 NEPSE Index:
   • Latest: http://localhost:${PORT}/api/index/latest
   • Historical: http://localhost:${PORT}/api/index/historical?limit=100
📉 SOPAN Chart: http://localhost:${PORT}/chart

💡 Quick Tests:
   curl http://localhost:${PORT}/api/market/summary
   curl http://localhost:${PORT}/api/companies/search?q=NABIL
   curl "http://localhost:${PORT}/api/candles/NABIL?period=1m"
   curl "http://localhost:${PORT}/api/index/latest"
   curl "http://localhost:${PORT}/api/index/historical?limit=10"
   curl -X POST http://localhost:${PORT}/api/candles/bulk -H "Content-Type: application/json" -d '{"symbols": ["NABIL", "EBL"], "period": "1m"}'
   Open browser: http://localhost:${PORT}/chart
  `);
});

module.exports = app;