// scrapers/events/bonusScraper.js
const axios = require('axios');
const pool = require('../../db/pool');
const dateParser = require('../../services/dateParser');
const { withRetry } = require('../../utils/retry');
const logger = require('../../utils/logger');

class NEPSEBonusScraper {
  constructor() {
    this.MEROLAGANI_BONUS_API = 'https://www.merolagani.com/Handlers/GetBonusHandler.ashx';
    this.SHARESANSAR_BONUS_API = 'https://www.sharesansar.com/api/bonus-shares';
    this.NEPSE_ALPHA_BONUS_API = 'https://nepsealpha.com/api/corporate-actions/bonus';
    
    this.requestDelay = parseInt(process.env.SCRAPE_RATE_LIMIT_MS) || 1000;
    this.lastRequestTime = 0;
  }

  /**
   * Fetch all bonus share announcements
   */
  async fetchBonusShares(fiscalYear = null) {
    try {
      logger.info(`Fetching bonus shares data${fiscalYear ? ` for FY ${fiscalYear}` : ''}`);
      
      const bonusData = await withRetry(
        () => this.fetchFromMultipleSources(fiscalYear),
        { 
          retries: 3, 
          delay: 2000,
          onRetry: (error, attempt) => {
            logger.warn(`Retry ${attempt} for bonus fetch: ${error.message}`);
          }
        }
      );
      
      const normalized = await this.normalizeBonusData(bonusData);
      const saved = await this.saveBonusShares(normalized);
      
      // Calculate bonus impact (market cap adjustment, etc.)
      await this.calculateBonusImpact(saved);
      
      logger.info(`Processed ${saved.length} bonus announcements`);
      
      return {
        success: true,
        count: saved.length,
        data: saved,
        fiscalYear
      };
      
    } catch (error) {
      logger.error('Failed to fetch bonus shares:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Fetch from multiple sources for redundancy
   */
  async fetchFromMultipleSources(fiscalYear) {
    let allBonusData = [];
    
    // Try MeroLagani first
    try {
      const merolaganiData = await this.fetchFromMeroLagani(fiscalYear);
      allBonusData.push(...merolaganiData);
      logger.info(`Fetched ${merolaganiData.length} bonus records from MeroLagani`);
    } catch (error) {
      logger.warn('MeroLagani bonus fetch failed:', error.message);
    }
    
    // Try Sharesansar
    try {
      const sharesansarData = await this.fetchFromSharesansar(fiscalYear);
      allBonusData.push(...sharesansarData);
      logger.info(`Fetched ${sharesansarData.length} bonus records from Sharesansar`);
    } catch (error) {
      logger.warn('Sharesansar bonus fetch failed:', error.message);
    }
    
    // Try NEPSE Alpha
    try {
      const nepseAlphaData = await this.fetchFromNEPSEAlpha(fiscalYear);
      allBonusData.push(...nepseAlphaData);
      logger.info(`Fetched ${nepseAlphaData.length} bonus records from NEPSE Alpha`);
    } catch (error) {
      logger.warn('NEPSE Alpha bonus fetch failed:', error.message);
    }
    
    // Remove duplicates by company and fiscal year
    const uniqueData = this.deduplicateBonusData(allBonusData);
    
    return uniqueData;
  }

  /**
   * Fetch from MeroLagani API
   */
  async fetchFromMeroLagani(fiscalYear) {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.requestDelay) {
      await new Promise(resolve => 
        setTimeout(resolve, this.requestDelay - timeSinceLastRequest)
      );
    }
    
    this.lastRequestTime = Date.now();
    
    const response = await axios.get(this.MEROLAGANI_BONUS_API, {
      params: fiscalYear ? { fy: fiscalYear } : {},
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    let bonusData = response.data;
    if (response.data.data) bonusData = response.data.data;
    if (response.data.bonus) bonusData = response.data.bonus;
    
    return Array.isArray(bonusData) ? bonusData : [];
  }

  /**
   * Fetch from Sharesansar
   */
  async fetchFromSharesansar(fiscalYear) {
    const response = await axios.get(this.SHARESANSAR_BONUS_API, {
      params: fiscalYear ? { fiscal_year: fiscalYear } : {},
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    let bonusData = response.data;
    if (response.data.data) bonusData = response.data.data;
    if (response.data.bonus_shares) bonusData = response.data.bonus_shares;
    
    return Array.isArray(bonusData) ? bonusData : [];
  }

  /**
   * Fetch from NEPSE Alpha
   */
  async fetchFromNEPSEAlpha(fiscalYear) {
    const response = await axios.get(this.NEPSE_ALPHA_BONUS_API, {
      params: fiscalYear ? { fy: fiscalYear } : {},
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    let bonusData = response.data;
    if (response.data.data) bonusData = response.data.data;
    
    return Array.isArray(bonusData) ? bonusData : [];
  }

  /**
   * Remove duplicate bonus announcements
   */
  deduplicateBonusData(bonusData) {
    const seen = new Map();
    
    for (const item of bonusData) {
      const key = `${item.company_name || item.company}_${item.fiscal_year || item.fy}`;
      
      if (!seen.has(key)) {
        seen.set(key, item);
      } else {
        // Keep the one with more complete data
        const existing = seen.get(key);
        if (Object.keys(item).length > Object.keys(existing).length) {
          seen.set(key, item);
        }
      }
    }
    
    return Array.from(seen.values());
  }

  /**
   * Normalize bonus share data
   */
  async normalizeBonusData(bonusData) {
    const normalized = [];
    const client = await pool.connect();
    
    try {
      for (const item of bonusData) {
        // Find company
        let companyId = null;
        let symbol = null;
        
        // Try by symbol first
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
        
        // Try by name if symbol not found
        if (!companyId && (item.company_name || item.company)) {
          const companyName = item.company_name || item.company;
          const companyResult = await client.query(
            'SELECT id, symbol FROM companies WHERE name ILIKE $1',
            [`%${companyName}%`]
          );
          if (companyResult.rows.length > 0) {
            companyId = companyResult.rows[0].id;
            symbol = companyResult.rows[0].symbol;
          } else {
            // Create temporary company entry
            const insertResult = await client.query(
              `INSERT INTO companies (symbol, name, is_active) 
               VALUES ($1, $2, $3)
               ON CONFLICT (symbol) DO NOTHING
               RETURNING id`,
              [this.generateSymbol(companyName), companyName, true]
            );
            
            if (insertResult.rows.length > 0) {
              companyId = insertResult.rows[0].id;
              symbol = this.generateSymbol(companyName);
            }
          }
        }
        
        if (!companyId) continue;
        
        // Parse bonus percentage
        let bonusPercent = 0;
        if (item.bonus_percent) {
          bonusPercent = this.parseNumeric(item.bonus_percent);
        } else if (item.percentage) {
          bonusPercent = this.parseNumeric(item.percentage);
        } else if (item.bonus_ratio) {
          const ratioParts = item.bonus_ratio.split(':');
          if (ratioParts.length === 2) {
            bonusPercent = (parseInt(ratioParts[0]) / parseInt(ratioParts[1])) * 100;
          }
        }
        
        // Parse dates
        const announcementDate = dateParser.parseMarketDate(
          item.announcement_date || item.date || item.agm_date,
          'merolagani'
        );
        
        const bookClosureDate = dateParser.parseMarketDate(
          item.book_closure_date || item.book_close || item.closure_date,
          'merolagani'
        );
        
        const distributionDate = dateParser.parseMarketDate(
          item.distribution_date || item.bonus_date,
          'merolagani'
        );
        
        normalized.push({
          company_id: companyId,
          symbol: symbol,
          company_name: item.company_name || item.company,
          
          bonus_percent: bonusPercent,
          bonus_ratio: bonusPercent > 0 ? `${bonusPercent}:100` : null,
          
          previous_shares: this.parseNumeric(item.previous_shares),
          bonus_shares: this.parseNumeric(item.bonus_shares),
          total_shares_after: this.parseNumeric(item.total_shares_after),
          
          announcement_date: announcementDate,
          book_closure_date: bookClosureDate,
          distribution_date: distributionDate,
          
          fiscal_year: item.fiscal_year || item.fy,
          source: item.source || 'api',
          status: this.determineStatus(announcementDate, bookClosureDate),
          raw_data: JSON.stringify(item)
        });
      }
      
      return normalized;
      
    } finally {
      client.release();
    }
  }

  /**
   * Generate symbol from company name
   */
  generateSymbol(companyName) {
    return companyName
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .substring(0, 20);
  }

  /**
   * Determine bonus share status
   */
  determineStatus(announcementDate, bookClosureDate) {
    const now = new Date();
    
    if (!announcementDate) return 'pending';
    if (now < announcementDate) return 'announced';
    if (bookClosureDate && now >= announcementDate && now <= bookClosureDate) return 'book_closure_open';
    if (bookClosureDate && now > bookClosureDate) return 'distributed';
    return 'approved';
  }

  /**
   * Save bonus shares to database
   */
  async saveBonusShares(bonusData) {
    const client = await pool.connect();
    const saved = [];
    
    try {
      await client.query('BEGIN');
      
      for (const bonus of bonusData) {
        if (!bonus.company_id) continue;
        
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
            details = EXCLUDED.details,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id;
        `;
        
        const result = await client.query(query, [
          bonus.company_id,
          'BONUS',
          bonus.bonus_percent,
          bonus.announcement_date,
          bonus.book_closure_date,
          bonus.distribution_date,
          bonus.fiscal_year,
          bonus.source,
          JSON.stringify({
            bonus_ratio: bonus.bonus_ratio,
            previous_shares: bonus.previous_shares,
            bonus_shares: bonus.bonus_shares,
            total_shares_after: bonus.total_shares_after,
            status: bonus.status
          })
        ]);
        
        saved.push({
          id: result.rows[0].id,
          ...bonus
        });
      }
      
      await client.query('COMMIT');
      logger.info(`Saved ${saved.length} bonus share records`);
      
      return saved;
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to save bonus shares:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Calculate impact of bonus shares on market metrics
   */
  async calculateBonusImpact(bonusRecords) {
    const client = await pool.connect();
    
    try {
      for (const bonus of bonusRecords) {
        // Get current price
        const priceResult = await client.query(`
          SELECT close_price
          FROM price_candles pc
          WHERE pc.company_id = $1
          ORDER BY pc.date DESC
          LIMIT 1
        `, [bonus.company_id]);
        
        if (priceResult.rows.length === 0) continue;
        
        const currentPrice = parseFloat(priceResult.rows[0].close_price);
        const bonusPercent = bonus.bonus_percent;
        
        // Calculate adjusted price after bonus
        const adjustedPrice = (currentPrice * 100) / (100 + bonusPercent);
        const priceReduction = currentPrice - adjustedPrice;
        
        // Store impact analysis in details field
        await client.query(`
          UPDATE corporate_actions
          SET details = details || jsonb_build_object(
            'impact_analysis', jsonb_build_object(
              'price_before', $1,
              'price_after_adjustment', $2,
              'price_reduction', $3,
              'adjustment_factor', $4,
              'calculation_date', $5
            )
          )
          WHERE id = $6
        `, [
          currentPrice,
          adjustedPrice,
          priceReduction,
          (100 / (100 + bonusPercent)),
          new Date().toISOString(),
          bonus.id
        ]);
        
        logger.debug(`Calculated bonus impact for ${bonus.symbol}: ${currentPrice} -> ${adjustedPrice.toFixed(2)}`);
      }
      
    } catch (error) {
      logger.error('Failed to calculate bonus impact:', error);
    } finally {
      client.release();
    }
  }

  /**
   * Get bonus shares by company
   */
  async getBonusByCompany(symbol) {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 
          ca.*,
          c.symbol,
          c.name as company_name,
          ca.details->>'bonus_ratio' as bonus_ratio,
          ca.details->'impact_analysis' as impact_analysis
        FROM corporate_actions ca
        JOIN companies c ON ca.company_id = c.id
        WHERE c.symbol = $1 
          AND ca.action_type = 'BONUS'
        ORDER BY ca.announcement_date DESC
      `, [symbol.toUpperCase()]);
      
      return result.rows;
      
    } catch (error) {
      logger.error(`Failed to get bonus for ${symbol}:`, error);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Get upcoming bonus announcements
   */
  async getUpcomingBonus(limit = 20) {
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
        WHERE ca.action_type = 'BONUS'
          AND ca.announcement_date >= CURRENT_DATE
          AND ca.status != 'distributed'
        ORDER BY ca.announcement_date ASC
        LIMIT $1
      `, [limit]);
      
      return result.rows;
      
    } catch (error) {
      logger.error('Failed to get upcoming bonus:', error);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Get bonus history by fiscal year
   */
  async getBonusHistory(fiscalYear) {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 
          ca.*,
          c.symbol,
          c.name as company_name,
          c.sector,
          ca.percentage as bonus_percent
        FROM corporate_actions ca
        JOIN companies c ON ca.company_id = c.id
        WHERE ca.fiscal_year = $1
          AND ca.action_type = 'BONUS'
        ORDER BY ca.percentage DESC
      `, [fiscalYear]);
      
      return result.rows;
      
    } catch (error) {
      logger.error(`Failed to get bonus history for FY ${fiscalYear}:`, error);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Calculate total bonus shares distributed in a fiscal year
   */
  async getTotalBonusShares(fiscalYear) {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 
          COUNT(*) as total_companies,
          SUM(percentage) as total_bonus_percent,
          AVG(percentage) as average_bonus_percent
        FROM corporate_actions ca
        JOIN companies c ON ca.company_id = c.id
        WHERE ca.fiscal_year = $1
          AND ca.action_type = 'BONUS'
      `, [fiscalYear]);
      
      return result.rows[0];
      
    } catch (error) {
      logger.error(`Failed to get total bonus for FY ${fiscalYear}:`, error);
      return null;
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
}

module.exports = new NEPSEBonusScraper();