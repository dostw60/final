// scrapers/company/symbolMapper.js
const pool = require('../../db/pool');
const logger = require('../../utils/logger');

class SymbolMapper {
  constructor() {
    // Common symbol variations and corrections
    this.symbolVariations = new Map();
    this.symbolCorrections = new Map();
    this.initializeMappings();
  }

  /**
   * Initialize common symbol mappings
   */
  initializeMappings() {
    // Common symbol variations
    this.symbolVariations.set('NIB', ['NIBL', 'NIBPO', 'NIBLPO']);
    this.symbolVariations.set('NABIL', ['NABILB', 'NABILPO']);
    this.symbolVariations.set('EBL', ['EBLPO', 'EBLB']);
    this.symbolVariations.set('NICA', ['NICAB', 'NICAPO']);
    this.symbolVariations.set('GBIME', ['GBIMEPO', 'GBIMEB']);
    this.symbolVariations.set('PRVU', ['PRVUPO', 'PRVUB']);
    this.symbolVariations.set('SANIMA', ['SANIMAPO', 'SANIMAB']);
    this.symbolVariations.set('MEGA', ['MEGAPO', 'MEGAB']);
    this.symbolVariations.set('CZBIL', ['CZBILB', 'CZBILPO']);
    this.symbolVariations.set('SBI', ['SBIB', 'SBIPO']);
    
    // Symbol corrections (wrong to correct)
    this.symbolCorrections.set('NIBL', 'NIB');
    this.symbolCorrections.set('NABILB', 'NABIL');
    this.symbolCorrections.set('EBLB', 'EBL');
    this.symbolCorrections.set('NICAB', 'NICA');
    this.symbolCorrections.set('GBIMEB', 'GBIME');
    this.symbolCorrections.set('PRVUB', 'PRVU');
    
    // Common spelling mistakes
    this.commonMistakes = {
      'NABIL': ['NABILB', 'Nabil', 'nabil', 'NABIL BANK'],
      'NIB': ['NIBL', 'Nib', 'NIB BANK', 'Nepal Investment Bank'],
      'EBL': ['EBLB', 'Ebl', 'Everest Bank'],
      'NICA': ['NICAB', 'Nica', 'NIC Asia', 'NIC ASIA'],
      'GBIME': ['GBIMEB', 'Gbime', 'Global IME', 'GLOBAL IME'],
      'PRVU': ['PRVUB', 'Prvu', 'Prabhu', 'PRABHU BANK'],
      'SANIMA': ['SANIMAB', 'Sanima', 'SANIMA BANK'],
      'MEGA': ['MEGAB', 'Mega', 'MEGA BANK'],
      'CZBIL': ['CZBILB', 'Czbil', 'Citizen Bank', 'CITIZEN BANK'],
      'SBI': ['SBIB', 'Sbi', 'SBI BANK', 'State Bank of India']
    };
  }

  /**
   * Update symbol mappings from database
   */
  async updateMappings(companies) {
    const client = await pool.connect();
    
    try {
      // Clear existing mappings
      await client.query('DROP TABLE IF EXISTS symbol_mappings CASCADE');
      
      // Create mapping table
      await client.query(`
        CREATE TABLE IF NOT EXISTS symbol_mappings (
          id SERIAL PRIMARY KEY,
          original_symbol VARCHAR(20) NOT NULL,
          mapped_symbol VARCHAR(20) NOT NULL,
          confidence INTEGER DEFAULT 100,
          source VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(original_symbol, mapped_symbol)
        );
        
        CREATE INDEX IF NOT EXISTS idx_symbol_mappings_original 
          ON symbol_mappings(original_symbol);
        CREATE INDEX IF NOT EXISTS idx_symbol_mappings_mapped 
          ON symbol_mappings(mapped_symbol);
      `);
      
      // Insert mappings from known companies
      for (const company of companies) {
        // Map primary symbol
        await client.query(`
          INSERT INTO symbol_mappings (original_symbol, mapped_symbol, confidence, source)
          VALUES ($1, $1, 100, 'primary')
          ON CONFLICT (original_symbol, mapped_symbol) DO NOTHING
        `, [company.symbol]);
        
        // Map variations
        const variations = this.symbolVariations.get(company.symbol) || [];
        for (const variation of variations) {
          await client.query(`
            INSERT INTO symbol_mappings (original_symbol, mapped_symbol, confidence, source)
            VALUES ($1, $2, 80, 'variation')
            ON CONFLICT (original_symbol, mapped_symbol) DO NOTHING
          `, [variation, company.symbol]);
        }
        
        // Map common mistakes
        const mistakes = this.commonMistakes[company.symbol] || [];
        for (const mistake of mistakes) {
          await client.query(`
            INSERT INTO symbol_mappings (original_symbol, mapped_symbol, confidence, source)
            VALUES ($1, $2, 70, 'common_mistake')
            ON CONFLICT (original_symbol, mapped_symbol) DO NOTHING
          `, [mistake, company.symbol]);
        }
      }
      
      logger.info(`Updated symbol mappings for ${companies.length} companies`);
      
    } catch (error) {
      logger.error('Failed to update symbol mappings:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Map a symbol to its correct form
   */
  async mapSymbol(inputSymbol) {
    if (!inputSymbol) return null;
    
    const client = await pool.connect();
    
    try {
      const cleanSymbol = inputSymbol.toString().toUpperCase().trim();
      
      // Check if it's already a valid symbol
      const validCheck = await client.query(
        'SELECT id FROM companies WHERE symbol = $1 AND is_active = true',
        [cleanSymbol]
      );
      
      if (validCheck.rows.length > 0) {
        return {
          original: inputSymbol,
          mapped: cleanSymbol,
          confidence: 100,
          is_valid: true
        };
      }
      
      // Check mappings
      const mappingResult = await client.query(`
        SELECT mapped_symbol, MAX(confidence) as confidence
        FROM symbol_mappings
        WHERE original_symbol = $1
        GROUP BY mapped_symbol
        ORDER BY confidence DESC
        LIMIT 1
      `, [cleanSymbol]);
      
      if (mappingResult.rows.length > 0) {
        const mapped = mappingResult.rows[0].mapped_symbol;
        
        // Verify mapped symbol exists
        const verifyResult = await client.query(
          'SELECT id FROM companies WHERE symbol = $1',
          [mapped]
        );
        
        if (verifyResult.rows.length > 0) {
          return {
            original: inputSymbol,
            mapped: mapped,
            confidence: mappingResult.rows[0].confidence,
            is_valid: true
          };
        }
      }
      
      // Try fuzzy matching
      const fuzzyMatch = await this.fuzzyMatchSymbol(cleanSymbol);
      if (fuzzyMatch) {
        return {
          original: inputSymbol,
          mapped: fuzzyMatch,
          confidence: 50,
          is_valid: true,
          fuzzy_match: true
        };
      }
      
      return {
        original: inputSymbol,
        mapped: null,
        confidence: 0,
        is_valid: false
      };
      
    } catch (error) {
      logger.error(`Failed to map symbol ${inputSymbol}:`, error);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * Fuzzy match symbol using Levenshtein distance
   */
  async fuzzyMatchSymbol(inputSymbol) {
    const client = await pool.connect();
    
    try {
      // Get all active symbols
      const result = await client.query(
        'SELECT symbol FROM companies WHERE is_active = true'
      );
      
      let bestMatch = null;
      let bestScore = 0;
      
      for (const row of result.rows) {
        const symbol = row.symbol;
        const score = this.calculateSimilarity(inputSymbol, symbol);
        
        if (score > bestScore && score > 0.6) { // 60% similarity threshold
          bestScore = score;
          bestMatch = symbol;
        }
      }
      
      return bestMatch;
      
    } catch (error) {
      logger.error('Fuzzy matching failed:', error);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * Calculate similarity between two strings
   */
  calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Levenshtein distance algorithm
   */
  levenshteinDistance(str1, str2) {
    const track = Array(str2.length + 1).fill(null).map(() =>
      Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i += 1) {
      track[0][i] = i;
    }
    for (let j = 0; j <= str2.length; j += 1) {
      track[j][0] = j;
    }
    
    for (let j = 1; j <= str2.length; j += 1) {
      for (let i = 1; i <= str1.length; i += 1) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        track[j][i] = Math.min(
          track[j][i - 1] + 1,
          track[j - 1][i] + 1,
          track[j - 1][i - 1] + indicator,
        );
      }
    }
    
    return track[str2.length][str1.length];
  }

  /**
   * Batch map multiple symbols
   */
  async batchMapSymbols(symbols) {
    const results = {};
    
    for (const symbol of symbols) {
      results[symbol] = await this.mapSymbol(symbol);
    }
    
    return results;
  }

  /**
   * Get all symbol variations for a company
   */
  async getSymbolVariations(symbol) {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT original_symbol, confidence
        FROM symbol_mappings
        WHERE mapped_symbol = $1
        ORDER BY confidence DESC
      `, [symbol.toUpperCase()]);
      
      return result.rows.map(row => ({
        symbol: row.original_symbol,
        confidence: row.confidence
      }));
      
    } catch (error) {
      logger.error(`Failed to get variations for ${symbol}:`, error);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Add custom symbol mapping
   */
  async addMapping(originalSymbol, mappedSymbol, confidence = 90) {
    const client = await pool.connect();
    
    try {
      await client.query(`
        INSERT INTO symbol_mappings (original_symbol, mapped_symbol, confidence, source)
        VALUES ($1, $2, $3, 'custom')
        ON CONFLICT (original_symbol, mapped_symbol) 
        DO UPDATE SET confidence = EXCLUDED.confidence
      `, [originalSymbol.toUpperCase(), mappedSymbol.toUpperCase(), confidence]);
      
      logger.info(`Added mapping: ${originalSymbol} -> ${mappedSymbol}`);
      return true;
      
    } catch (error) {
      logger.error('Failed to add mapping:', error);
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Get unmapped symbols (for monitoring)
   */
  async getUnmappedSymbols() {
    const client = await pool.connect();
    
    try {
      // This query finds symbols that appear in data but aren't mapped
      const result = await client.query(`
        SELECT DISTINCT symbol
        FROM (
          SELECT DISTINCT symbol FROM price_candles
          UNION
          SELECT DISTINCT symbol FROM live_prices
          UNION
          SELECT DISTINCT symbol FROM ipo_calendar WHERE symbol IS NOT NULL
        ) AS all_symbols
        WHERE symbol NOT IN (SELECT mapped_symbol FROM symbol_mappings)
        LIMIT 100
      `);
      
      return result.rows.map(row => row.symbol);
      
    } catch (error) {
      logger.error('Failed to get unmapped symbols:', error);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Validate and correct a symbol
   */
  async validateSymbol(symbol) {
    const mapping = await this.mapSymbol(symbol);
    
    if (!mapping || !mapping.is_valid) {
      return null;
    }
    
    return mapping.mapped;
  }

  /**
   * Get company ID from any symbol variation
   */
  async getCompanyId(symbol) {
    const client = await pool.connect();
    
    try {
      const mapped = await this.validateSymbol(symbol);
      if (!mapped) return null;
      
      const result = await client.query(
        'SELECT id FROM companies WHERE symbol = $1',
        [mapped]
      );
      
      return result.rows.length > 0 ? result.rows[0].id : null;
      
    } catch (error) {
      logger.error(`Failed to get company ID for ${symbol}:`, error);
      return null;
    } finally {
      client.release();
    }
  }
}

module.exports = new SymbolMapper();