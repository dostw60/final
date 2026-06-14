// api/controllers/candleController.js
const pool = require('../../db/pool');
const cache = require('../../services/redisCache');
const logger = require('../../utils/logger');
const dateParser = require('../../services/dateParser');
const { Parser } = require('json2csv');

class CandleController {
  async getCandles(req, res) {
    try {
      const { symbol } = req.params;
      const { from, to, interval = 'daily', limit = 500 } = req.query;
      
      let query = `
        SELECT 
          c.date,
          c.open_price as open,
          c.high_price as high,
          c.low_price as low,
          c.close_price as close,
          c.volume,
          c.turnover
        FROM price_candles c
        JOIN companies comp ON c.company_id = comp.id
        WHERE comp.symbol = $1
      `;
      
      const params = [symbol.toUpperCase()];
      let paramIndex = 2;
      
      if (from) {
        query += ` AND c.date >= $${paramIndex}`;
        params.push(from);
        paramIndex++;
      }
      
      if (to) {
        query += ` AND c.date <= $${paramIndex}`;
        params.push(to);
        paramIndex++;
      }
      
      query += ` ORDER BY c.date DESC LIMIT $${paramIndex}`;
      params.push(parseInt(limit));
      
      const result = await pool.query(query, params);
      
      // Apply interval aggregation if needed
      let data = result.rows;
      if (interval !== 'daily') {
        data = this.aggregateByInterval(data, interval);
      }
      
      res.json({
        success: true,
        symbol: symbol.toUpperCase(),
        interval,
        data: data.reverse(),
        count: data.length,
        from: from || data[0]?.date,
        to: to || data[data.length - 1]?.date,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Error fetching candles:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getLatestCandle(req, res) {
    try {
      const { symbol } = req.params;
      
      const result = await pool.query(`
        SELECT 
          c.date,
          c.open_price as open,
          c.high_price as high,
          c.low_price as low,
          c.close_price as close,
          c.volume,
          c.turnover,
          c.scraped_at
        FROM price_candles c
        JOIN companies comp ON c.company_id = comp.id
        WHERE comp.symbol = $1
        ORDER BY c.date DESC
        LIMIT 1
      `, [symbol.toUpperCase()]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'No data found for symbol' });
      }
      
      res.json({
        success: true,
        data: result.rows[0],
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Error fetching latest candle:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getBulkCandles(req, res) {
    try {
      const { symbols, from, to } = req.body;
      
      if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ error: 'Symbols array required' });
      }
      
      const result = await pool.query(`
        SELECT 
          comp.symbol,
          c.date,
          c.open_price,
          c.high_price,
          c.low_price,
          c.close_price,
          c.volume,
          c.turnover
        FROM price_candles c
        JOIN companies comp ON c.company_id = comp.id
        WHERE comp.symbol = ANY($1)
          AND c.date BETWEEN COALESCE($2, '2020-01-01') AND COALESCE($3, CURRENT_DATE)
        ORDER BY comp.symbol, c.date DESC
      `, [symbols, from, to]);
      
      // Group by symbol
      const grouped = {};
      for (const row of result.rows) {
        if (!grouped[row.symbol]) {
          grouped[row.symbol] = [];
        }
        grouped[row.symbol].push(row);
      }
      
      res.json({
        success: true,
        data: grouped,
        count: result.rows.length,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Error fetching bulk candles:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getCandleStats(req, res) {
    try {
      const { symbol } = req.params;
      
      const result = await pool.query(`
        SELECT 
          MIN(low_price) as all_time_low,
          MAX(high_price) as all_time_high,
          AVG(close_price) as avg_price,
          STDDEV(close_price) as price_volatility,
          COUNT(*) as total_days,
          MIN(date) as data_from,
          MAX(date) as data_to
        FROM price_candles c
        JOIN companies comp ON c.company_id = comp.id
        WHERE comp.symbol = $1
      `, [symbol.toUpperCase()]);
      
      // Get 52-week high/low
      const yearResult = await pool.query(`
        SELECT 
          MAX(high_price) as high_52_week,
          MIN(low_price) as low_52_week
        FROM price_candles c
        JOIN companies comp ON c.company_id = comp.id
        WHERE comp.symbol = $1
          AND date >= CURRENT_DATE - INTERVAL '1 year'
      `, [symbol.toUpperCase()]);
      
      const stats = {
        ...result.rows[0],
        high_52_week: yearResult.rows[0]?.high_52_week,
        low_52_week: yearResult.rows[0]?.low_52_week
      };
      
      res.json({
        success: true,
        symbol: symbol.toUpperCase(),
        data: stats,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Error fetching candle stats:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getTechnicalIndicators(req, res) {
    try {
      const { symbol } = req.params;
      const { period = 20 } = req.query;
      
      // Get price data for calculations
      const priceData = await pool.query(`
        SELECT date, close_price, high_price, low_price, volume
        FROM price_candles c
        JOIN companies comp ON c.company_id = comp.id
        WHERE comp.symbol = $1
        ORDER BY date DESC
        LIMIT 252
      `, [symbol.toUpperCase()]);
      
      const prices = priceData.rows.reverse();
      
      const indicators = {
        sma: this.calculateSMA(prices, parseInt(period)),
        ema: this.calculateEMA(prices, parseInt(period)),
        rsi: this.calculateRSI(prices, 14),
        macd: this.calculateMACD(prices),
        bollinger: this.calculateBollingerBands(prices, 20, 2),
        volume_avg: this.calculateVolumeAverage(prices, 20),
        atr: this.calculateATR(prices, 14)
      };
      
      res.json({
        success: true,
        symbol: symbol.toUpperCase(),
        data: indicators,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Error calculating technical indicators:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async exportCandles(req, res) {
    try {
      const { symbol } = req.params;
      const { from, to, format = 'csv' } = req.query;
      
      const result = await pool.query(`
        SELECT 
          c.date,
          c.open_price,
          c.high_price,
          c.low_price,
          c.close_price,
          c.volume,
          c.turnover
        FROM price_candles c
        JOIN companies comp ON c.company_id = comp.id
        WHERE comp.symbol = $1
          AND c.date BETWEEN COALESCE($2, '2020-01-01') AND COALESCE($3, CURRENT_DATE)
        ORDER BY c.date ASC
      `, [symbol.toUpperCase(), from, to]);
      
      if (format === 'json') {
        return res.json({
          success: true,
          data: result.rows,
          count: result.rows.length,
          timestamp: new Date().toISOString()
        });
      }
      
      // Export as CSV
      const fields = ['date', 'open_price', 'high_price', 'low_price', 'close_price', 'volume', 'turnover'];
      const json2csv = new Parser({ fields });
      const csv = json2csv.parse(result.rows);
      
      res.header('Content-Type', 'text/csv');
      res.attachment(`${symbol}_candles_${from}_${to}.csv`);
      res.send(csv);
      
    } catch (error) {
      logger.error('Error exporting candles:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Helper methods for technical indicators
  calculateSMA(prices, period) {
    const sma = [];
    for (let i = period - 1; i < prices.length; i++) {
      const sum = prices.slice(i - period + 1, i + 1).reduce((s, p) => s + p.close_price, 0);
      sma.push({
        date: prices[i].date,
        value: sum / period
      });
    }
    return sma;
  }

  calculateEMA(prices, period) {
    const multiplier = 2 / (period + 1);
    const ema = [];
    let firstEMA = prices.slice(0, period).reduce((s, p) => s + p.close_price, 0) / period;
    ema.push({ date: prices[period - 1].date, value: firstEMA });
    
    for (let i = period; i < prices.length; i++) {
      const value = (prices[i].close_price - ema[ema.length - 1].value) * multiplier + ema[ema.length - 1].value;
      ema.push({ date: prices[i].date, value });
    }
    return ema;
  }

  calculateRSI(prices, period = 14) {
    const rsi = [];
    let gains = 0, losses = 0;
    
    for (let i = 1; i <= period; i++) {
      const change = prices[i].close_price - prices[i - 1].close_price;
      if (change >= 0) gains += change;
      else losses -= change;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    let rs = avgGain / avgLoss;
    rsi.push({ date: prices[period].date, value: 100 - (100 / (1 + rs)) });
    
    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i].close_price - prices[i - 1].close_price;
      avgGain = (avgGain * (period - 1) + (change >= 0 ? change : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
      rs = avgGain / avgLoss;
      rsi.push({ date: prices[i].date, value: 100 - (100 / (1 + rs)) });
    }
    
    return rsi;
  }

  calculateMACD(prices) {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = [];
    
    for (let i = 0; i < ema12.length && i < ema26.length; i++) {
      if (ema12[i].date === ema26[i].date) {
        macd.push({
          date: ema12[i].date,
          macd: ema12[i].value - ema26[i].value,
          signal: null
        });
      }
    }
    
    // Calculate signal line (9-day EMA of MACD)
    const signal = this.calculateEMA(macd.map(m => ({ close_price: m.macd, date: m.date })), 9);
    
    for (let i = 0; i < macd.length && i < signal.length; i++) {
      if (macd[i].date === signal[i].date) {
        macd[i].signal = signal[i].value;
        macd[i].histogram = macd[i].macd - macd[i].signal;
      }
    }
    
    return macd;
  }

  calculateBollingerBands(prices, period = 20, stdDev = 2) {
    const bands = [];
    
    for (let i = period - 1; i < prices.length; i++) {
      const slice = prices.slice(i - period + 1, i + 1);
      const sma = slice.reduce((s, p) => s + p.close_price, 0) / period;
      const variance = slice.reduce((s, p) => s + Math.pow(p.close_price - sma, 2), 0) / period;
      const std = Math.sqrt(variance);
      
      bands.push({
        date: prices[i].date,
        upper: sma + (stdDev * std),
        middle: sma,
        lower: sma - (stdDev * std)
      });
    }
    
    return bands;
  }

  calculateVolumeAverage(prices, period = 20) {
    const avg = [];
    
    for (let i = period - 1; i < prices.length; i++) {
      const sum = prices.slice(i - period + 1, i + 1).reduce((s, p) => s + p.volume, 0);
      avg.push({
        date: prices[i].date,
        value: sum / period
      });
    }
    
    return avg;
  }

  calculateATR(prices, period = 14) {
    const tr = [];
    const atr = [];
    
    for (let i = 1; i < prices.length; i++) {
      const highLow = prices[i].high_price - prices[i].low_price;
      const highClose = Math.abs(prices[i].high_price - prices[i - 1].close_price);
      const lowClose = Math.abs(prices[i].low_price - prices[i - 1].close_price);
      tr.push(Math.max(highLow, highClose, lowClose));
    }
    
    let firstATR = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
    atr.push({ date: prices[period].date, value: firstATR });
    
    for (let i = period; i < tr.length; i++) {
      const value = (atr[atr.length - 1].value * (period - 1) + tr[i]) / period;
      atr.push({ date: prices[i + 1].date, value });
    }
    
    return atr;
  }

  aggregateByInterval(data, interval) {
    const aggregated = [];
    const groups = {};
    
    for (const candle of data) {
      let key;
      const date = new Date(candle.date);
      
      switch (interval) {
        case 'weekly':
          const week = this.getWeekNumber(date);
          key = `${date.getFullYear()}-W${week}`;
          break;
        case 'monthly':
          key = `${date.getFullYear()}-${date.getMonth() + 1}`;
          break;
        case 'yearly':
          key = date.getFullYear();
          break;
        default:
          return data;
      }
      
      if (!groups[key]) {
        groups[key] = {
          date: key,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: 0,
          turnover: 0
        };
      }
      
      groups[key].high = Math.max(groups[key].high, candle.high);
      groups[key].low = Math.min(groups[key].low, candle.low);
      groups[key].close = candle.close;
      groups[key].volume += candle.volume;
      groups[key].turnover += candle.turnover;
    }
    
    return Object.values(groups);
  }

  getWeekNumber(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  }
}

module.exports = new CandleController();