// api/controllers/ipoController.js
const pool = require('../../db/pool');
const cache = require('../../services/redisCache');
const ipoScraper = require('../../scrapers/events/ipoScraper');
const logger = require('../../utils/logger');

class IPOController {
  async getUpcomingIPOs(req, res) {
    try {
      const { limit = 50 } = req.query;
      
      const result = await pool.query(`
        SELECT 
          id,
          company_name,
          symbol,
          issue_type,
          units_available,
          issue_price,
          open_date,
          close_date,
          status,
          created_at
        FROM ipo_calendar
        WHERE close_date >= CURRENT_DATE
          AND status != 'closed'
        ORDER BY open_date ASC
        LIMIT $1
      `, [limit]);
      
      res.json({
        success: true,
        count: result.rows.length,
        data: result.rows,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Error fetching upcoming IPOs:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getIPOHistory(req, res) {
    try {
      const { limit = 50, offset = 0, year } = req.query;
      
      let query = `
        SELECT 
          id,
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
      `;
      
      const params = [];
      let paramIndex = 1;
      
      if (year) {
        query += ` AND EXTRACT(YEAR FROM close_date) = $${paramIndex}`;
        params.push(year);
        paramIndex++;
      }
      
      query += ` ORDER BY close_date DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);
      
      const result = await pool.query(query, params);
      
      res.json({
        success: true,
        count: result.rows.length,
        data: result.rows,
        pagination: { limit, offset },
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Error fetching IPO history:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getIPOById(req, res) {
    try {
      const { id } = req.params;
      
      const result = await pool.query(`
        SELECT 
          *
        FROM ipo_calendar
        WHERE id = $1
      `, [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'IPO not found' });
      }
      
      res.json({
        success: true,
        data: result.rows[0],
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Error fetching IPO by ID:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getIPOStats(req, res) {
    try {
      const stats = await pool.query(`
        SELECT 
          COUNT(*) as total_ipos,
          COUNT(CASE WHEN status = 'upcoming' THEN 1 END) as upcoming,
          COUNT(CASE WHEN status = 'open' THEN 1 END) as open,
          COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed,
          AVG(units_available) as avg_units,
          AVG(issue_price) as avg_price,
          SUM(units_available) as total_units_available,
          EXTRACT(YEAR FROM open_date) as year
        FROM ipo_calendar
        GROUP BY EXTRACT(YEAR FROM open_date)
        ORDER BY year DESC
      `);
      
      res.json({
        success: true,
        data: stats.rows,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Error fetching IPO stats:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getIPOsByCompany(req, res) {
    try {
      const { symbol } = req.params;
      
      const result = await pool.query(`
        SELECT 
          *
        FROM ipo_calendar
        WHERE symbol = $1
        ORDER BY open_date DESC
      `, [symbol.toUpperCase()]);
      
      res.json({
        success: true,
        count: result.rows.length,
        data: result.rows,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Error fetching IPOs by company:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getActiveIPOs(req, res) {
    try {
      const result = await pool.query(`
        SELECT 
          *
        FROM ipo_calendar
        WHERE open_date <= CURRENT_DATE
          AND close_date >= CURRENT_DATE
          AND status = 'open'
        ORDER BY close_date ASC
      `);
      
      res.json({
        success: true,
        count: result.rows.length,
        data: result.rows,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Error fetching active IPOs:', error);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new IPOController();