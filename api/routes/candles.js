// api/routes/candles.js
const express = require('express');
const router = express.Router();
const pool = require('../../db/pool');
const cache = require('../../services/redisCache');
const logger = require('../../utils/logger');

router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { from, to, interval = 'daily', limit = 100 } = req.query;
    
    const cacheKey = `candles:${symbol}:${from}:${to}:${interval}:${limit}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    
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
    params.push(limit);
    
    const result = await pool.query(query, params);
    
    const response = {
      symbol: symbol.toUpperCase(),
      interval,
      data: result.rows.reverse(),
      count: result.rows.length,
      last_updated: new Date().toISOString()
    };
    
    await cache.setex(cacheKey, 60, JSON.stringify(response));
    
    res.json(response);
    
  } catch (error) {
    logger.error('Error fetching candles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:symbol/latest', async (req, res) => {
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
        c.turnover
      FROM price_candles c
      JOIN companies comp ON c.company_id = comp.id
      WHERE comp.symbol = $1
      ORDER BY c.date DESC
      LIMIT 1
    `, [symbol.toUpperCase()]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No data found for symbol' });
    }
    
    res.json(result.rows[0]);
    
  } catch (error) {
    logger.error('Error fetching latest candle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;