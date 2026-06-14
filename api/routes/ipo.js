// api/routes/ipo.js
const express = require('express');
const router = express.Router();
const pool = require('../../db/pool');
const cache = require('../../services/redisCache');

router.get('/upcoming', async (req, res) => {
  try {
    const cached = await cache.get('ipo:upcoming');
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    
    const result = await pool.query(`
      SELECT 
        company_name,
        symbol,
        issue_type,
        units_available,
        issue_price,
        open_date,
        close_date,
        status
      FROM ipo_calendar
      WHERE close_date >= CURRENT_DATE
      ORDER BY open_date ASC
    `);
    
    await cache.setex('ipo:upcoming', 3600, JSON.stringify(result.rows));
    
    res.json({
      count: result.rows.length,
      data: result.rows,
      last_updated: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/history', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    
    const result = await pool.query(`
      SELECT 
        company_name,
        symbol,
        issue_type,
        units_available,
        issue_price,
        open_date,
        close_date,
        status
      FROM ipo_calendar
      WHERE close_date < CURRENT_DATE
      ORDER BY close_date DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    res.json({
      count: result.rows.length,
      data: result.rows,
      pagination: { limit, offset }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;