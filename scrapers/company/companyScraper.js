// scrapers/company/companyScraper.js
const axios = require('axios');
const pool = require('../../db/pool');
const { withRetry } = require('../../utils/retry');
const logger = require('../../utils/logger');
const symbolMapper = require('./symbolMapper');

class NEPSECompanyScraper {
  constructor() {
    // API endpoints
    this.MEROLAGANI_COMPANY_API = 'https://www.merolagani.com/Handlers/CompanyListHandler.ashx';
    this.NEPSE_ALPHA_COMPANY_API = 'https://nepsealpha.com/api/companies';
    this.SHARESANSAR_COMPANY_API = 'https://www.sharesansar.com/api/companies';
    this.NEPSE_OFFICIAL_API = 'https://www.nepse.org.np/api/company/list';
    
    this.requestDelay = parseInt(process.env.SCRAPE_RATE_LIMIT_MS) || 1000;
    this.lastRequestTime = 0;
  }

  /**
   * Fetch all companies from all sources
   */
  async fetchAllCompanies(forceRefresh = false) {
    try {
      logger.info('Fetching company master data...');
      
      // Check cache first
      if (!forceRefresh) {
        const cached = await this.getCachedCompanies();
        if (cached && cached.length > 0) {
          logger.info(`Returning ${cached.length} companies from cache`);
          return cached;
        }
      }
      
      // Fetch from multiple sources
      const companies = await this.fetchFromMultipleSources();
      
      // Deduplicate and merge
      const merged = await this.mergeCompanyData(companies);
      
      // Save to database
      const saved = await this.saveCompanies(merged);
      
      // Update symbol mappings
      await symbolMapper.updateMappings(saved);
      
      // Cache the results
      await this.cacheCompanies(saved);
      
      logger.info(`Saved ${saved.length} companies to database`);
      
      return {
        success: true,
        count: saved.length,
        data: saved,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      logger.error('Failed to fetch companies:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Fetch from multiple sources for redundancy
   */
  async fetchFromMultipleSources() {
    let allCompanies = [];
    
    // Try MeroLagani first (most reliable)
    try {
      const merolaganiData = await this.fetchFromMeroLagani();
      allCompanies.push(...merolaganiData);
      logger.info(`Fetched ${merolaganiData.length} companies from MeroLagani`);
    } catch (error) {
      logger.warn('MeroLagani company fetch failed:', error.message);
    }
    
    // Try NEPSE Alpha
    try {
      const nepseAlphaData = await this.fetchFromNEPSEAlpha();
      allCompanies.push(...nepseAlphaData);
      logger.info(`Fetched ${nepseAlphaData.length} companies from NEPSE Alpha`);
    } catch (error) {
      logger.warn('NEPSE Alpha company fetch failed:', error.message);
    }
    
    // Try Sharesansar
    try {
      const sharesansarData = await this.fetchFromSharesansar();
      allCompanies.push(...sharesansarData);
      logger.info(`Fetched ${sharesansarData.length} companies from Sharesansar`);
    } catch (error) {
      logger.warn('Sharesansar company fetch failed:', error.message);
    }
    
    // Remove duplicates
    const uniqueCompanies = this.deduplicateCompanies(allCompanies);
    
    return uniqueCompanies;
  }

  /**
   * Fetch from MeroLagani API
   */
  async fetchFromMeroLagani() {
    await this.rateLimit();
    
    const response = await axios.get(this.MEROLAGANI_COMPANY_API, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.merolagani.com/'
      },
      timeout: parseInt(process.env.REQUEST_TIMEOUT_MS) || 10000
    });
    
    let companies = response.data;
    if (response.data.data) companies = response.data.data;
    if (response.data.companies) companies = response.data.companies;
    
    if (!Array.isArray(companies)) {
      throw new Error('Invalid response format from MeroLagani');
    }
    
    return companies.map(company => this.normalizeMeroLaganiCompany(company));
  }

  /**
   * Fetch from NEPSE Alpha API
   */
  async fetchFromNEPSEAlpha() {
    await this.rateLimit();
    
    const response = await axios.get(this.NEPSE_ALPHA_COMPANY_API, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    let companies = response.data;
    if (response.data.data) companies = response.data.data;
    if (response.data.companies) companies = response.data.companies;
    
    if (!Array.isArray(companies)) {
      throw new Error('Invalid response format from NEPSE Alpha');
    }
    
    return companies.map(company => this.normalizeNEPSEAlphaCompany(company));
  }

  /**
   * Fetch from Sharesansar API
   */
  async fetchFromSharesansar() {
    await this.rateLimit();
    
    const response = await axios.get(this.SHARESANSAR_COMPANY_API, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    let companies = response.data;
    if (response.data.data) companies = response.data.data;
    if (response.data.companies) companies = response.data.companies;
    
    if (!Array.isArray(companies)) {
      throw new Error('Invalid response format from Sharesansar');
    }
    
    return companies.map(company => this.normalizeSharesansarCompany(company));
  }

  /**
   * Normalize company data from MeroLagani
   */
  normalizeMeroLaganiCompany(raw) {
    return {
      symbol: (raw.symbol || raw.ticker || raw.scrip || '').toUpperCase(),
      name: raw.name || raw.companyName || raw.company_name || '',
      sector: raw.sector || raw.industry || raw.sector_name || '',
      sub_sector: raw.subSector || raw.sub_sector || '',
      listed_date: raw.listedDate || raw.listed_date || raw.ipoDate,
      address: raw.address || '',
      phone: raw.phone || '',
      email: raw.email || '',
      website: raw.website || '',
      registrar: raw.registrar || raw.shareRegistrar || '',
      registrar_phone: raw.registrarPhone || '',
      pan_number: raw.panNumber || raw.pan || '',
      fiscal_year_end: raw.fiscalYearEnd || raw.fy_end || 'Ashad',
      issued_shares: this.parseNumeric(raw.issuedShares || raw.totalShares),
      paid_up_capital: this.parseNumeric(raw.paidUpCapital),
      promoter_percent: this.parseNumeric(raw.promoterPercent),
      public_percent: this.parseNumeric(raw.publicPercent),
      is_active: true,
      source: 'merolagani'
    };
  }

  /**
   * Normalize company data from NEPSE Alpha
   */
  normalizeNEPSEAlphaCompany(raw) {
    return {
      symbol: (raw.symbol || raw.code || '').toUpperCase(),
      name: raw.name || raw.companyName || raw.title || '',
      sector: raw.sector || raw.industry || '',
      sub_sector: raw.subSector || '',
      listed_date: raw.listedDate || raw.listingDate,
      address: raw.address || '',
      phone: raw.phone || '',
      email: raw.email || '',
      website: raw.website || '',
      registrar: raw.registrar || '',
      registrar_phone: raw.registrarPhone || '',
      pan_number: raw.pan || '',
      fiscal_year_end: raw.fiscalYearEnd || 'Ashad',
      issued_shares: this.parseNumeric(raw.totalShares),
      paid_up_capital: this.parseNumeric(raw.paidUpCapital),
      promoter_percent: this.parseNumeric(raw.promoterPercentage),
      public_percent: this.parseNumeric(raw.publicPercentage),
      is_active: raw.isActive !== false,
      source: 'nepse_alpha'
    };
  }

  /**
   * Normalize company data from Sharesansar
   */
  normalizeSharesansarCompany(raw) {
    return {
      symbol: (raw.symbol || raw.stockSymbol || '').toUpperCase(),
      name: raw.name || raw.companyName || raw.company || '',
      sector: raw.sector || raw.industryType || '',
      sub_sector: raw.subSector || '',
      listed_date: raw.listedDate || raw.listingDate,
      address: raw.address || raw.officeAddress || '',
      phone: raw.phone || raw.contactNumber || '',
      email: raw.email || '',
      website: raw.website || '',
      registrar: raw.registrar || raw.shareRegistrar || '',
      registrar_phone: raw.registrarPhone || '',
      pan_number: raw.pan || '',
      fiscal_year_end: raw.fiscalYearEnd || 'Ashad',
      issued_shares: this.parseNumeric(raw.issuedCapital || raw.totalShares),
      paid_up_capital: this.parseNumeric(raw.paidUpCapital),
      promoter_percent: this.parseNumeric(raw.promoterShare),
      public_percent: this.parseNumeric(raw.publicShare),
      is_active: raw.status === 'Active',
      source: 'sharesansar'
    };
  }

  /**
   * Remove duplicate companies
   */
  deduplicateCompanies(companies) {
    const seen = new Map();
    
    for (const company of companies) {
      if (!company.symbol) continue;
      
      const key = company.symbol;
      
      if (!seen.has(key)) {
        seen.set(key, company);
      } else {
        // Merge data, keeping more complete information
        const existing = seen.get(key);
        seen.set(key, this.mergeCompanyInfo(existing, company));
      }
    }
    
    return Array.from(seen.values());
  }

  /**
   * Merge company information from different sources
   */
  mergeCompanyInfo(company1, company2) {
    const merged = { ...company1 };
    
    // Take non-empty values from company2
    for (const [key, value] of Object.entries(company2)) {
      if (value && (!merged[key] || merged[key] === '')) {
        merged[key] = value;
      }
    }
    
    // Combine sources
    const sources = new Set([
      ...(merged.sources || [merged.source]),
      company2.source
    ]);
    merged.sources = Array.from(sources);
    merged.source = merged.sources.join(',');
    
    return merged;
  }

  /**
   * Merge all company data and resolve conflicts
   */
  async mergeCompanyData(companies) {
    const merged = [];
    const client = await pool.connect();
    
    try {
      for (const company of companies) {
        // Check if company exists in database
        const existing = await client.query(
          'SELECT * FROM companies WHERE symbol = $1',
          [company.symbol]
        );
        
        if (existing.rows.length > 0) {
          // Merge with existing data
          const existingCompany = existing.rows[0];
          merged.push({
            id: existingCompany.id,
            symbol: company.symbol,
            name: company.name || existingCompany.name,
            sector: company.sector || existingCompany.sector,
            sub_sector: company.sub_sector || existingCompany.sub_sector,
            listed_date: company.listed_date || existingCompany.listed_date,
            address: company.address || existingCompany.address,
            phone: company.phone || existingCompany.phone,
            email: company.email || existingCompany.email,
            website: company.website || existingCompany.website,
            registrar: company.registrar || existingCompany.registrar,
            registrar_phone: company.registrar_phone || existingCompany.registrar_phone,
            pan_number: company.pan_number || existingCompany.pan_number,
            fiscal_year_end: company.fiscal_year_end || existingCompany.fiscal_year_end,
            issued_shares: company.issued_shares || existingCompany.issued_shares,
            paid_up_capital: company.paid_up_capital || existingCompany.paid_up_capital,
            promoter_percent: company.promoter_percent || existingCompany.promoter_percent,
            public_percent: company.public_percent || existingCompany.public_percent,
            is_active: company.is_active !== undefined ? company.is_active : existingCompany.is_active,
            source: `${existingCompany.source},${company.source}`
          });
        } else {
          merged.push(company);
        }
      }
      
      return merged;
      
    } finally {
      client.release();
    }
  }

  /**
   * Save companies to database
   */
  async saveCompanies(companies) {
    const client = await pool.connect();
    const saved = [];
    
    try {
      await client.query('BEGIN');
      
      for (const company of companies) {
        if (!company.symbol) {
          logger.warn('Skipping company without symbol');
          continue;
        }
        
        const query = `
          INSERT INTO companies (
            symbol, name, sector, sub_sector, listed_date,
            address, phone, email, website, registrar, registrar_phone,
            pan_number, fiscal_year_end, issued_shares, paid_up_capital,
            promoter_percent, public_percent, is_active, source, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP)
          ON CONFLICT (symbol) 
          DO UPDATE SET
            name = EXCLUDED.name,
            sector = EXCLUDED.sector,
            sub_sector = EXCLUDED.sub_sector,
            listed_date = EXCLUDED.listed_date,
            address = EXCLUDED.address,
            phone = EXCLUDED.phone,
            email = EXCLUDED.email,
            website = EXCLUDED.website,
            registrar = EXCLUDED.registrar,
            registrar_phone = EXCLUDED.registrar_phone,
            pan_number = EXCLUDED.pan_number,
            fiscal_year_end = EXCLUDED.fiscal_year_end,
            issued_shares = EXCLUDED.issued_shares,
            paid_up_capital = EXCLUDED.paid_up_capital,
            promoter_percent = EXCLUDED.promoter_percent,
            public_percent = EXCLUDED.public_percent,
            is_active = EXCLUDED.is_active,
            source = EXCLUDED.source,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id, symbol, name, sector;
        `;
        
        const result = await client.query(query, [
          company.symbol,
          company.name,
          company.sector,
          company.sub_sector,
          company.listed_date,
          company.address,
          company.phone,
          company.email,
          company.website,
          company.registrar,
          company.registrar_phone,
          company.pan_number,
          company.fiscal_year_end,
          company.issued_shares,
          company.paid_up_capital,
          company.promoter_percent,
          company.public_percent,
          company.is_active !== false,
          company.source || 'api'
        ]);
        
        saved.push(result.rows[0]);
      }
      
      await client.query('COMMIT');
      logger.info(`Saved/updated ${saved.length} companies`);
      
      return saved;
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to save companies:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get company details by symbol
   */
  async getCompanyBySymbol(symbol) {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 
          id, symbol, name, sector, sub_sector, listed_date,
          address, phone, email, website, registrar, registrar_phone,
          pan_number, fiscal_year_end, issued_shares, paid_up_capital,
          promoter_percent, public_percent, is_active, created_at, updated_at
        FROM companies
        WHERE symbol = $1 AND is_active = true
      `, [symbol.toUpperCase()]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      // Get additional stats
      const company = result.rows[0];
      
      // Get latest price
      const priceResult = await client.query(`
        SELECT close_price, date
        FROM price_candles
        WHERE company_id = $1
        ORDER BY date DESC
        LIMIT 1
      `, [company.id]);
      
      if (priceResult.rows.length > 0) {
        company.last_price = parseFloat(priceResult.rows[0].close_price);
        company.last_price_date = priceResult.rows[0].date;
      }
      
      // Get 52-week high/low
      const yearResult = await client.query(`
        SELECT 
          MAX(high_price) as high_52_week,
          MIN(low_price) as low_52_week
        FROM price_candles
        WHERE company_id = $1
          AND date >= CURRENT_DATE - INTERVAL '1 year'
      `, [company.id]);
      
      if (yearResult.rows.length > 0) {
        company.high_52_week = parseFloat(yearResult.rows[0].high_52_week);
        company.low_52_week = parseFloat(yearResult.rows[0].low_52_week);
      }
      
      return company;
      
    } catch (error) {
      logger.error(`Failed to get company ${symbol}:`, error);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * Get all companies with pagination and filtering
   */
  async getAllCompanies(filters = {}) {
    const client = await pool.connect();
    
    try {
      let query = `
        SELECT 
          id, symbol, name, sector, sub_sector, listed_date,
          issued_shares, paid_up_capital, is_active
        FROM companies
        WHERE 1=1
      `;
      
      const params = [];
      let paramIndex = 1;
      
      if (filters.sector) {
        query += ` AND sector ILIKE $${paramIndex}`;
        params.push(`%${filters.sector}%`);
        paramIndex++;
      }
      
      if (filters.is_active !== undefined) {
        query += ` AND is_active = $${paramIndex}`;
        params.push(filters.is_active);
        paramIndex++;
      }
      
      if (filters.search) {
        query += ` AND (symbol ILIKE $${paramIndex} OR name ILIKE $${paramIndex})`;
        params.push(`%${filters.search}%`);
        paramIndex++;
      }
      
      query += ` ORDER BY symbol ASC`;
      
      if (filters.limit) {
        query += ` LIMIT $${paramIndex}`;
        params.push(filters.limit);
        paramIndex++;
      }
      
      if (filters.offset) {
        query += ` OFFSET $${paramIndex}`;
        params.push(filters.offset);
      }
      
      const result = await client.query(query, params);
      
      return {
        count: result.rows.length,
        data: result.rows,
        filters
      };
      
    } catch (error) {
      logger.error('Failed to get companies:', error);
      return { count: 0, data: [], error: error.message };
    } finally {
      client.release();
    }
  }

  /**
   * Get sector-wise company breakdown
   */
  async getSectorBreakdown() {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 
          sector,
          COUNT(*) as company_count,
          SUM(issued_shares) as total_shares,
          SUM(paid_up_capital) as total_capital
        FROM companies
        WHERE is_active = true AND sector IS NOT NULL
        GROUP BY sector
        ORDER BY company_count DESC
      `);
      
      return result.rows;
      
    } catch (error) {
      logger.error('Failed to get sector breakdown:', error);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Update company active status
   */
  async updateCompanyStatus(symbol, isActive) {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        UPDATE companies
        SET is_active = $1, updated_at = CURRENT_TIMESTAMP
        WHERE symbol = $2
        RETURNING id, symbol, is_active
      `, [isActive, symbol.toUpperCase()]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      logger.info(`Updated ${symbol} status to ${isActive}`);
      return result.rows[0];
      
    } catch (error) {
      logger.error(`Failed to update company status for ${symbol}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cache companies in Redis
   */
  async cacheCompanies(companies) {
    try {
      const redisCache = require('../../services/redisCache');
      await redisCache.setex('companies:all', 86400, JSON.stringify(companies));
      await redisCache.setex('companies:timestamp', 86400, JSON.stringify(Date.now()));
      logger.info('Companies cached successfully');
    } catch (error) {
      logger.warn('Failed to cache companies:', error);
    }
  }

  /**
   * Get cached companies
   */
  async getCachedCompanies() {
    try {
      const redisCache = require('../../services/redisCache');
      const cached = await redisCache.get('companies:all');
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      logger.warn('Failed to get cached companies:', error);
    }
    return null;
  }

  /**
   * Rate limiting helper
   */
  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.requestDelay) {
      await new Promise(resolve => 
        setTimeout(resolve, this.requestDelay - timeSinceLastRequest)
      );
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Parse numeric values safely
   */
  parseNumeric(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    const cleaned = String(value).replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }
}

module.exports = new NEPSECompanyScraper();