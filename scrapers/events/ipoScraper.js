// scrapers/events/ipoScraper.js
const axios = require('axios');
const pool = require('../../db/pool');
const dateParser = require('../../services/dateParser');
const { withRetry } = require('../../utils/retry');
const logger = require('../../utils/logger');

class NEPSEIPOScraper {
  constructor() {
    this.SHARESANSAR_API = `${process.env.SHARESANSAR_API}/ipo`;
  }

  async updateIPOCalendar() {
    try {
      logger.info('Fetching IPO calendar...');
      
      const data = await withRetry(
        () => this.fetchIPOData(),
        { retries: 2, delay: 3000 }
      );
      
      const parsedIPO = await this.parseIPOData(data);
      const inserted = await this.upsertIPOs(parsedIPO);
      
      logger.info(`Updated ${inserted.length} IPO entries`);
      
      return {
        success: true,
        records: inserted.length
      };
      
    } catch (error) {
      logger.error('IPO scraping failed:', error);
      return { success: false, error: error.message };
    }
  }

  async fetchIPOData() {
    const response = await axios.get(this.SHARESANSAR_API, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    return response.data;
  }

  async parseIPOData(data) {
    const ipos = [];
    
    // This is a template - actual parsing depends on the API response structure
    const ipoList = data.ipos || data.data || [];
    
    for (const item of ipoList) {
      ipos.push({
        company_name: item.name || item.companyName,
        symbol: item.symbol,
        issue_type: this.determineIssueType(item),
        units_available: parseInt(item.units) || parseInt(item.shares) || 0,
        issue_price: parseFloat(item.price) || 100,
        open_date: dateParser.parseMarketDate(item.openDate, 'sharesansar'),
        close_date: dateParser.parseMarketDate(item.closeDate, 'sharesansar'),
        status: this.determineStatus(item),
        source_url: item.url
      });
    }
    
    return ipos.filter(ipo => ipo.open_date && ipo.close_date);
  }

  determineIssueType(item) {
    if (item.type === 'FPO' || item.issueType === 'FPO') return 'FPO';
    if (item.type === 'RIGHT' || item.issueType === 'RIGHT') return 'RIGHT';
    return 'IPO';
  }

  determineStatus(item) {
    const now = new Date();
    const openDate = new Date(item.openDate);
    const closeDate = new Date(item.closeDate);
    
    if (now < openDate) return 'upcoming';
    if (now >= openDate && now <= closeDate) return 'open';
    return 'closed';
  }

  async upsertIPOs(ipos) {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const results = [];
      
      for (const ipo of ipos) {
        const query = `
          INSERT INTO ipo_calendar 
            (company_name, symbol, issue_type, units_available, issue_price, open_date, close_date, status, source_url)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (company_name, open_date) 
          DO UPDATE SET
            close_date = EXCLUDED.close_date,
            units_available = EXCLUDED.units_available,
            issue_price = EXCLUDED.issue_price,
            status = EXCLUDED.status,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id;
        `;
        
        const res = await client.query(query, [
          ipo.company_name,
          ipo.symbol,
          ipo.issue_type,
          ipo.units_available,
          ipo.issue_price,
          dateParser.formatForDatabase(ipo.open_date),
          dateParser.formatForDatabase(ipo.close_date),
          ipo.status,
          ipo.source_url
        ]);
        
        results.push(res.rows[0]);
      }
      
      await client.query('COMMIT');
      return results;
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new NEPSEIPOScraper();