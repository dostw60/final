// scrapers/ipo/ipoResultScraper.js
const axios = require('axios');
const cheerio = require('cheerio');

class IPOResultScraper {
  constructor() {
    this.CDSC_IPO_URL = 'https://www.cdsc.com.np/result/';
    this.cache = new Map();
  }

  /**
   * Clean company name for better matching
   */
  cleanCompanyName(name) {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^a-z0-9 ]/g, '')
      .trim();
  }

  /**
   * Check if company names match (with variations)
   */
  companyNameMatches(searchName, companyName) {
    if (!searchName || !companyName) return false;
    
    const cleanSearch = this.cleanCompanyName(searchName);
    const cleanCompany = this.cleanCompanyName(companyName);
    
    // Direct match
    if (cleanCompany.includes(cleanSearch) || cleanSearch.includes(cleanCompany)) {
      return true;
    }
    
    // Check for common variations
    const variations = this.getCompanyNameVariations(searchName);
    for (const variation of variations) {
      if (cleanCompany.includes(variation)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get common name variations
   */
  getCompanyNameVariations(name) {
    const variations = new Set();
    const clean = this.cleanCompanyName(name);
    variations.add(clean);
    
    // Remove common suffixes
    const suffixes = [' limited', ' ltd', ' company', ' corp', ' pvt', ' private'];
    for (const suffix of suffixes) {
      if (clean.endsWith(suffix)) {
        variations.add(clean.replace(suffix, ''));
      }
    }
    
    // Handle common abbreviations
    const replacements = {
      'pharmaceuticals': ['pharma', 'pharmaceutical'],
      'bank': ['banka', 'banking'],
      'finance': ['financial', 'fin'],
      'insurance': ['ins', 'insur'],
      'development': ['dev', 'develop'],
      'hydropower': ['hydro', 'power'],
      'microfinance': ['micro', 'mf'],
      'laghubitta': ['laghu', 'lb']
    };
    
    for (const [word, alternatives] of Object.entries(replacements)) {
      if (clean.includes(word)) {
        for (const alt of alternatives) {
          variations.add(clean.replace(word, alt));
        }
      }
    }
    
    return Array.from(variations);
  }

  /**
   * Fetch IPO result from CDSC website
   */
  async fetchIPOResult(ipoName) {
    try {
      // If searching for 'all', return all IPOs
      if (ipoName.toLowerCase() === 'all') {
        return this.getAllIPOs();
      }

      const cacheKey = `ipo_result_${ipoName}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < 86400000) {
        return cached.data;
      }

      // Try to fetch with proper headers
      const response = await axios.get(this.CDSC_IPO_URL, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });

      const $ = cheerio.load(response.data);
      const results = [];
      const allIPOs = [];

      // Try different table selectors
      let tableFound = false;
      const tableSelectors = ['table', '.table', '.ipo-table', 'table.ipo-result-table'];
      
      for (const selector of tableSelectors) {
        const table = $(selector);
        if (table.length > 0) {
          tableFound = true;
          break;
        }
      }

      // Parse the table
      $('table tbody tr, table tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 3) {
          const companyName = $(cells[0]).text().trim() || '';
          const issueManager = $(cells[1]).text().trim() || '';
          const issueDate = $(cells[2]).text().trim() || '';
          const status = cells.length >= 4 ? $(cells[3]).text().trim() : 'Pending';
          
          if (companyName) {
            const ipoData = {
              company_name: companyName,
              issue_manager: issueManager,
              issue_date: issueDate,
              status: status || 'Pending'
            };
            
            allIPOs.push(ipoData);
            
            if (this.companyNameMatches(ipoName, companyName)) {
              results.push(ipoData);
            }
          }
        }
      });

      // If no results found, try alternative parsing
      if (allIPOs.length === 0) {
        // Try to find any table with data
        $('table').each((i, table) => {
          $(table).find('tr').each((j, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 2) {
              const firstCell = $(cells[0]).text().trim();
              if (firstCell && !firstCell.includes('S.N.') && !firstCell.includes('SN')) {
                allIPOs.push({
                  company_name: firstCell,
                  issue_manager: cells.length > 1 ? $(cells[1]).text().trim() : '',
                  issue_date: cells.length > 2 ? $(cells[2]).text().trim() : '',
                  status: cells.length > 3 ? $(cells[3]).text().trim() : 'Pending'
                });
              }
            }
          });
        });
      }

      // If still no results, return a helpful message
      if (allIPOs.length === 0) {
        return {
          ipo_name: ipoName,
          found: false,
          message: 'Could not fetch IPO data from CDSC. The website structure may have changed.',
          results: [],
          all_available_ipos: [],
          total_available: 0,
          fetched_at: new Date().toISOString(),
          source: 'error'
        };
      }

      const finalResult = {
        ipo_name: ipoName,
        found: results.length > 0,
        results: results.length > 0 ? results : allIPOs.slice(0, 10),
        all_available_ipos: allIPOs.slice(0, 20),
        total_available: allIPOs.length,
        message: results.length > 0 ? 'Found matching IPOs' : 'No exact match found. Showing all available IPOs.',
        fetched_at: new Date().toISOString(),
        source: 'cheerio'
      };

      this.cache.set(cacheKey, { data: finalResult, timestamp: Date.now() });
      return finalResult;

    } catch (error) {
      console.error('IPO fetch failed:', error.message);
      
      // Return a helpful error message
      return {
        ipo_name: ipoName,
        found: false,
        error: error.message,
        message: 'Failed to fetch IPO data. Please try again later or check the CDSC website directly.',
        results: [],
        all_available_ipos: [],
        total_available: 0,
        fetched_at: new Date().toISOString(),
        source: 'error'
      };
    }
  }

  /**
   * Get multiple IPO results in bulk
   */
  async fetchBulkIPOResults(ipoNames) {
    const results = [];
    const batchSize = 3;

    for (let i = 0; i < ipoNames.length; i += batchSize) {
      const batch = ipoNames.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(name => this.fetchIPOResult(name))
      );
      results.push(...batchResults);
      
      if (i + batchSize < ipoNames.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return results;
  }

  /**
   * Get all IPOs from CDSC
   */
  async getAllIPOs() {
    try {
      const cacheKey = 'cdsc_all_ipos';
      const cached = this.cache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < 86400000) {
        return cached.data;
      }

      const response = await axios.get(this.CDSC_IPO_URL, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml'
        }
      });

      const $ = cheerio.load(response.data);
      const ipos = [];

      $('table tbody tr, table tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 3) {
          const companyName = $(cells[0]).text().trim() || '';
          if (companyName && !companyName.includes('S.N.') && !companyName.includes('SN')) {
            ipos.push({
              company_name: companyName,
              issue_manager: cells.length > 1 ? $(cells[1]).text().trim() : '',
              issue_date: cells.length > 2 ? $(cells[2]).text().trim() : '',
              status: cells.length > 3 ? $(cells[3]).text().trim() : 'Pending'
            });
          }
        }
      });

      const result = {
        total: ipos.length,
        ipo_list: ipos,
        fetched_at: new Date().toISOString(),
        source: 'cheerio',
        message: ipos.length > 0 ? 'Successfully fetched IPO list' : 'No IPOs found'
      };

      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;

    } catch (error) {
      console.error('Error fetching all IPOs:', error.message);
      return { 
        error: error.message, 
        ipo_list: [],
        total: 0,
        message: 'Failed to fetch IPO list'
      };
    }
  }

  /**
   * Search IPOs by company name pattern
   */
  async searchIPOByCompany(companyName) {
    const allIPOs = await this.getAllIPOs();
    const results = allIPOs.ipo_list.filter(ipo => 
      ipo.company_name.toLowerCase().includes(companyName.toLowerCase())
    );
    
    const detailedResults = [];
    for (const ipo of results) {
      const detail = await this.fetchIPOResult(ipo.company_name);
      detailedResults.push({
        ...ipo,
        ...detail
      });
    }

    return {
      query: companyName,
      found: results.length,
      results: detailedResults,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('IPO result cache cleared');
  }
}

module.exports = new IPOResultScraper();