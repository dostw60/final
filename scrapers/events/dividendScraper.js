// scrapers/events/dividendScraper.js
const axios = require('axios');
const pool = require('../../db/pool');
const dateParser = require('../../services/dateParser');
const { withRetry } = require('../../utils/retry');
const logger = require('../../utils/logger');

class NEPSEDividendScraper {
  constructor() {
    // API endpoints
    this.MEROLAGANI_DIVIDEND_API = 'https://www.merolagani.com/Handlers/GetDividendHandler.ashx';
    this.SHARESANSAR_DIVIDEND_API = 'https://www.sharesansar.com/api/dividend';
    this.NEPSE_ALPHA_DIVIDEND_API = 'https://nepsealpha.com/api/corporate-actions/dividend';
    
    // Source URLs for fallback scraping
    this.MEROLAGANI_DIVIDEND_URL = 'https://www.merolagani.com/Dividend.aspx';
    this.SHARESANSAR_DIVIDEND_URL = 'https://www.sharesansar.com/dividend';
    
    this.requestDelay = parseInt(process.env.SCRAPE_RATE_LIMIT_MS) || 1000;
    this.lastRequestTime = 0;
  }

  /**
   * Fetch all dividend announcements
   */
  async fetchDividends(fiscalYear = null) {
    try {
      logger.info(`Fetching dividend data${fiscalYear ? ` for FY ${fiscalYear}` : ''}`);
      
      const dividends = await withRetry(
        () => this.fetchFromMeroLagani(fiscalYear),
        { 
          retries: 3, 
          delay: 2000,
          onRetry: (error, attempt) => {
            logger.warn(`Retry ${attempt} for dividend fetch: ${error.message}`);
          }
        }
      );
      
      const normalized = await this.normalizeDividends(dividends);
      const saved = await this.saveDividends(normalized);
      
      logger.info(`Processed ${saved.length} dividend announcements`);
      
      return {
        success: true,
        count: saved.length,
        data: saved,
        fiscalYear
      };
      
    } catch (error) {
      logger.error('Failed to fetch dividends:', error);
      
      // Fallback to web scraping
      return this.scrapeDividendsFromWeb(fiscalYear);
    }
  }

  /**
   * Fetch from MeroLagani API (primary source)
   */
  async fetchFromMeroLagani(fiscalYear) {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.requestDelay) {
      await new Promise(resolve => 
        setTimeout(resolve, this.requestDelay - timeSinceLastRequest)
      );
    }
    
    this.lastRequestTime = Date.now();
    
    const response = await axios.get(this.MEROLAGANI_DIVIDEND_API, {
      params: fiscalYear ? { fy: fiscalYear } : {},
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.merolagani.com/'
      },
      timeout: parseInt(process.env.REQUEST_TIMEOUT_MS) || 10000
    });
    
    if (!response.data) {
      throw new Error('No dividend data received from MeroLagani');
    }
    
    // Handle different response formats
    let dividendData = response.data;
    if (response.data.data) dividendData = response.data.data;
    if (response.data.dividends) dividendData = response.data.dividends;
    
    return Array.isArray(dividendData) ? dividendData : [];
  }

  /**
   * Fallback: Scrape dividends from web pages
   */
  async scrapeDividendsFromWeb(fiscalYear) {
    try {
      logger.info('Falling back to web scraping for dividends');
      
      const response = await axios.get(this.MEROLAGANI_DIVIDEND_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 15000
      });
      
      // Parse HTML (using regex for simplicity, but cheerio would be better)
      const html = response.data;
      const dividends = this.parseDividendHTML(html);
      
      return this.fetchDividends(fiscalYear); // Retry with parsed data
      
    } catch (error) {
      logger.error('Web scraping fallback failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Parse dividend data from HTML
   */
  parseDividendHTML(html) {
    const dividends = [];
    
    // Look for table rows containing dividend data
    const tableRegex = /<tr[^>]*>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;
    let match;
    
    while ((match = tableRegex.exec(html)) !== null) {
      const company = match[1].replace(/<[^>]*>/g, '').trim();
      const dividendPercent = match[2].replace(/<[^>]*>/g, '').trim();
      const fiscalYear = match[3].replace(/<[^>]*>/g, '').trim();
      
      if (company && dividendPercent) {
        dividends.push({
          company_name: company,
          cash_dividend_percent: this.extractCashDividend(dividendPercent),
          bonus_percent: this.extractBonusPercent(dividendPercent),
          total_percent: this.extractTotalPercent(dividendPercent),
          fiscal_year: fiscalYear,
          announcement_date: new Date(),
          source: 'web_scrape'
        });
      }
    }
    
    return dividends;
  }

  /**
   * Extract cash dividend percentage from string
   */
  extractCashDividend(dividendStr) {
    const cashMatch = dividendStr.match(/(\d+(?:\.\d+)?)%?\s*(?:cash|नगद)/i);
    return cashMatch ? parseFloat(cashMatch[1]) : 0;
  }

  /**
   * Extract bonus percentage from string
   */
  extractBonusPercent(dividendStr) {
    const bonusMatch = dividendStr.match(/(\d+(?:\.\d+)?)%?\s*(?:bonus|बोनस)/i);
    return bonusMatch ? parseFloat(bonusMatch[1]) : 0;
  }

  /**
   * Extract total dividend percentage
   */
  extractTotalPercent(dividendStr) {
    const totalMatch = dividendStr.match(/(\d+(?:\.\d+)?)%/);
    return totalMatch ? parseFloat(totalMatch[1]) : 0;
  }

  /**
   * Normalize dividend data
   */
  async normalizeDividends(dividends) {
    const normalized = [];
    const client = await pool.connect();
    
    try {
      for (const item of dividends) {
        // Find company
        let companyId = null;
        let symbol = null;
        
        if (item.symbol) {
          const companyResult = await client.query(
            'SELECT id, symbol FROM companies WHERE symbol = $1',
            [item.symbol.toUpperCase()]
          );
          if (companyResult.rows.length > 0) {
            companyId = companyResult.rows[0].id;
            symbol = companyResult.rows[0].symbol;
          }
        }
        
        if (!companyId && item.company_name) {
          const companyResult = await client.query(
            'SELECT id, symbol FROM companies WHERE name ILIKE $1',
            [`%${item.company_name}%`]
          );
          if (companyResult.rows.length > 0) {
            companyId = companyResult.rows[0].id;
            symbol = companyResult.rows[0].symbol;
          }
        }
        
        // Parse dates
        const announcementDate = dateParser.parseMarketDate(
          item.announcement_date || item.date || new Date(),
          'merolagani'
        );
        
        const bookClosureDate = dateParser.parseMarketDate(
          item.book_closure_date || item.bookClose || item.closure_date,
          'merolagani'
        );
        
        const distributionDate = dateParser.parseMarketDate(
          item.distribution_date || item.payment_date,
          'merolagani'
        );
        
        normalized.push({
          company_id: companyId,
          symbol: symbol,
          company_name: item.company_name || item.company,
          
          // Dividend types
          cash_dividend_percent: this.parseNumeric(item.cash_dividend || item.cash || item.cash_percent),
          bonus_percent: this.parseNumeric(item.bonus_shares || item.bonus || item.bonus_percent),
          total_dividend_percent: this.parseNumeric(item.total_dividend || item.total || item.dividend),
          
          // Additional info
          meeting_date: dateParser.parseMarketDate(item.meeting_date || item.agm_date),
          book_closure_date: bookClosureDate,
          distribution_date: distributionDate,
          announcement_date: announcementDate,
          
          fiscal_year: item.fiscal_year || item.fy,
          source: item.source || 'merolagani',
          raw_data: JSON.stringify(item)
        });
      }
      
      return normalized;
      
    } finally {
      client.release();
    }
  }

  /**
   * Save dividends to database
   */
  async saveDividends(dividends) {
    const client = await pool.connect();
    const saved = [];
    
    try {
      await client.query('BEGIN');
      
      for (const div of dividends) {
        // Skip if no company found
        if (!div.company_id && !div.symbol) {
          logger.warn(`Skipping dividend - no company match: ${div.company_name}`);
          continue;
        }
        
        // Get company ID if we only have symbol
        let companyId = div.company_id;
        if (!companyId && div.symbol) {
          const result = await client.query(
            'SELECT id FROM companies WHERE symbol = $1',
            [div.symbol]
          );
          if (result.rows.length > 0) {
            companyId = result.rows[0].id;
          }
        }
        
        if (!companyId) continue;
        
        // Insert dividend record
        const query = `
          INSERT INTO corporate_actions (
            company_id, action_type, percentage, 
            announcement_date, book_closure_date, distribution_date,
            fiscal_year, source, details, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
          ON CONFLICT (company_id, announcement_date, action_type) 
          DO UPDATE SET
            percentage = EXCLUDED.percentage,
            book_closure_date = EXCLUDED.book_closure_date,
            distribution_date = EXCLUDED.distribution_date,
            fiscal_year = EXCLUDED.fiscal_year,
            details = EXCLUDED.details,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id;
        `;
        
        // Save cash dividend
        if (div.cash_dividend_percent > 0) {
          const result = await client.query(query, [
            companyId,
            'DIVIDEND',
            div.cash_dividend_percent,
            div.announcement_date || new Date(),
            div.book_closure_date,
            div.distribution_date,
            div.fiscal_year,
            div.source,
            JSON.stringify({ type: 'cash', total_dividend: div.total_dividend_percent, ...div })
          ]);
          saved.push({ id: result.rows[0].id, type: 'cash', ...div });
        }
        
        // Save bonus shares as separate record
        if (div.bonus_percent > 0) {
          const result = await client.query(query, [
            companyId,
            'BONUS',
            div.bonus_percent,
            div.announcement_date || new Date(),
            div.book_closure_date,
            div.distribution_date,
            div.fiscal_year,
            div.source,
            JSON.stringify({ type: 'bonus', ...div })
          ]);
          saved.push({ id: result.rows[0].id, type: 'bonus', ...div });
        }
      }
      
      await client.query('COMMIT');
      logger.info(`Saved ${saved.length} dividend records`);
      
      return saved;
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to save dividends:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get dividends by company
   */
  async getDividendsByCompany(symbol, limit = 10) {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 
          ca.*,
          c.symbol,
          c.name as company_name
        FROM corporate_actions ca
        JOIN companies c ON ca.company_id = c.id
        WHERE c.symbol = $1 
          AND ca.action_type IN ('DIVIDEND', 'BONUS')
        ORDER BY ca.announcement_date DESC
        LIMIT $2
      `, [symbol.toUpperCase(), limit]);
      
      return result.rows;
      
    } catch (error) {
      logger.error(`Failed to get dividends for ${symbol}:`, error);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Get latest dividend announcements
   */
  async getLatestDividends(limit = 20) {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 
          ca.*,
          c.symbol,
          c.name as company_name,
          c.sector
        FROM corporate_actions ca
        JOIN companies c ON ca.company_id = c.id
        WHERE ca.action_type = 'DIVIDEND'
          AND ca.announcement_date >= NOW() - INTERVAL '6 months'
        ORDER BY ca.announcement_date DESC
        LIMIT $1
      `, [limit]);
      
      return result.rows;
      
    } catch (error) {
      logger.error('Failed to get latest dividends:', error);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Get dividends by fiscal year
   */
  async getDividendsByFiscalYear(fiscalYear) {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 
          ca.*,
          c.symbol,
          c.name as company_name,
          c.sector
        FROM corporate_actions ca
        JOIN companies c ON ca.company_id = c.id
        WHERE ca.fiscal_year = $1
          AND ca.action_type IN ('DIVIDEND', 'BONUS')
        ORDER BY ca.percentage DESC
      `, [fiscalYear]);
      
      return result.rows;
      
    } catch (error) {
      logger.error(`Failed to get dividends for FY ${fiscalYear}:`, error);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Parse numeric values
   */
  parseNumeric(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    const cleaned = String(value).replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Calculate dividend yield for a company
   */
  async calculateDividendYield(symbol, currentPrice = null) {
    const client = await pool.connect();
    
    try {
      // Get latest dividend
      const dividendResult = await client.query(`
        SELECT percentage, fiscal_year
        FROM corporate_actions ca
        JOIN companies c ON ca.company_id = c.id
        WHERE c.symbol = $1 
          AND ca.action_type = 'DIVIDEND'
        ORDER BY ca.announcement_date DESC
        LIMIT 1
      `, [symbol.toUpperCase()]);
      
      if (dividendResult.rows.length === 0) {
        return null;
      }
      
      // Get current price if not provided
      let price = currentPrice;
      if (!price) {
        const priceResult = await client.query(`
          SELECT close_price
          FROM price_candles pc
          JOIN companies c ON pc.company_id = c.id
          WHERE c.symbol = $1
          ORDER BY pc.date DESC
          LIMIT 1
        `, [symbol.toUpperCase()]);
        
        if (priceResult.rows.length > 0) {
          price = parseFloat(priceResult.rows[0].close_price);
        }
      }
      
      if (!price || price === 0) {
        return null;
      }
      
      const dividendPercent = parseFloat(dividendResult.rows[0].percentage);
      const dividendYield = (dividendPercent / price) * 100;
      
      return {
        symbol: symbol.toUpperCase(),
        dividend_percent: dividendPercent,
        current_price: price,
        dividend_yield: parseFloat(dividendYield.toFixed(2)),
        fiscal_year: dividendResult.rows[0].fiscal_year
      };
      
    } catch (error) {
      logger.error(`Failed to calculate dividend yield for ${symbol}:`, error);
      return null;
    } finally {
      client.release();
    }
  }
}

module.exports = new NEPSEDividendScraper();