// scrapers/ipo/ipoResultScraper.js
const puppeteer = require('puppeteer');
const axios = require('axios');
const cheerio = require('cheerio');

class IPOResultScraper {
  constructor() {
    this.CDSC_IPO_URL = 'https://www.cdsc.com.np/result/';
    this.cache = new Map();
    this.browser = null;
  }

  /**
   * Initialize browser (lazy loading)
   */
  async getBrowser() {
    if (!this.browser) {
      try {
        this.browser = await puppeteer.launch({
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
          ]
        });
      } catch (error) {
        console.error('Failed to launch browser:', error.message);
        return null;
      }
    }
    return this.browser;
  }

  /**
   * Clean company name for better matching
   */
  cleanCompanyName(name) {
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
   * Fetch IPO result from CDSC website using Puppeteer
   */
  async fetchIPOResult(ipoName) {
    try {
      const cacheKey = `ipo_result_${ipoName}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < 86400000) {
        return cached.data;
      }

      const browser = await this.getBrowser();
      
      if (!browser) {
        return this.fetchIPOResultFallback(ipoName);
      }

      const page = await browser.newPage();
      
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      await page.goto(this.CDSC_IPO_URL, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      await page.waitForSelector('table', { timeout: 10000 });

      // Extract all IPO data from the table
      const allIPOData = await page.evaluate(() => {
        const data = [];
        const rows = document.querySelectorAll('table tbody tr');
        
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            data.push({
              company_name: cells[0]?.textContent?.trim() || '',
              issue_manager: cells[1]?.textContent?.trim() || '',
              issue_date: cells[2]?.textContent?.trim() || '',
              status: cells[3]?.textContent?.trim() || 'Pending'
            });
          }
        }
        return data;
      });

      await page.close();

      // Find matching companies using improved matching
      const matchedResults = allIPOData.filter(item => 
        this.companyNameMatches(ipoName, item.company_name)
      );

      let detailedResult = null;
      
      // If we found results, try to get detailed allotment data
      if (matchedResults.length > 0) {
        // Check if any have result available
        const hasResult = matchedResults.some(r => r.status.toLowerCase() !== 'pending');
        
        if (hasResult) {
          detailedResult = await this.fetchDetailedAllotment(ipoName);
        }
        
        // Log the match for debugging
        console.log(`Found ${matchedResults.length} matches for "${ipoName}"`);
        matchedResults.forEach(r => {
          console.log(`  - ${r.company_name} (${r.status})`);
        });
      }

      const finalResult = {
        ipo_name: ipoName,
        found: matchedResults.length > 0,
        results: matchedResults,
        detailed_allotment: detailedResult,
        all_available_ipos: allIPOData.slice(0, 10), // Include first 10 for debugging
        fetched_at: new Date().toISOString(),
        source: 'puppeteer'
      };

      this.cache.set(cacheKey, { data: finalResult, timestamp: Date.now() });
      
      return finalResult;

    } catch (error) {
      console.error('Error fetching IPO result from CDSC:', error.message);
      return this.fetchIPOResultFallback(ipoName);
    }
  }

  /**
   * Fallback method using axios + cheerio
   */
  async fetchIPOResultFallback(ipoName) {
    try {
      const response = await axios.get(this.CDSC_IPO_URL, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml'
        }
      });

      const $ = cheerio.load(response.data);
      const results = [];
      const allIPOs = [];

      $('table tbody tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 4) {
          const companyName = $(cells[0]).text().trim();
          const ipoData = {
            company_name: companyName,
            issue_manager: $(cells[1]).text().trim(),
            issue_date: $(cells[2]).text().trim(),
            status: $(cells[3]).text().trim() || 'Pending'
          };
          
          allIPOs.push(ipoData);
          
          if (this.companyNameMatches(ipoName, companyName)) {
            results.push(ipoData);
          }
        }
      });

      const finalResult = {
        ipo_name: ipoName,
        found: results.length > 0,
        results: results,
        detailed_allotment: null,
        all_available_ipos: allIPOs.slice(0, 10),
        fetched_at: new Date().toISOString(),
        source: 'fallback'
      };

      this.cache.set(`ipo_result_${ipoName}`, { data: finalResult, timestamp: Date.now() });
      return finalResult;

    } catch (error) {
      console.error('Fallback IPO fetch failed:', error.message);
      return {
        ipo_name: ipoName,
        found: false,
        error: error.message,
        results: [],
        fetched_at: new Date().toISOString(),
        source: 'error'
      };
    }
  }

  /**
   * Fetch detailed allotment information
   */
  async fetchDetailedAllotment(ipoName) {
    try {
      const browser = await this.getBrowser();
      
      if (!browser) {
        return null;
      }

      const page = await browser.newPage();
      
      const urls = [
        `https://www.cdsc.com.np/result/${ipoName.toLowerCase().replace(/\s+/g, '-')}`,
        `https://www.cdsc.com.np/allotment/${ipoName.toLowerCase().replace(/\s+/g, '-')}`,
        `https://www.cdsc.com.np/public/ipo/${ipoName.toLowerCase().replace(/\s+/g, '-')}`
      ];

      let allotmentData = null;

      for (const url of urls) {
        try {
          await page.goto(url, { waitUntil: 'networkidle0', timeout: 10000 });
          
          const data = await page.evaluate(() => {
            const info = {};
            const rows = document.querySelectorAll('tr');
            rows.forEach(row => {
              const cells = row.querySelectorAll('td, th');
              if (cells.length === 2) {
                const key = cells[0]?.textContent?.trim() || '';
                const value = cells[1]?.textContent?.trim() || '';
                if (key) info[key] = value;
              }
            });
            return info;
          });

          if (data && Object.keys(data).length > 0) {
            allotmentData = data;
            break;
          }
        } catch (e) {
          // Continue to next URL
        }
      }

      await page.close();
      return allotmentData;

    } catch (error) {
      console.error('Error fetching detailed allotment:', error.message);
      return null;
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

      const browser = await this.getBrowser();
      
      if (!browser) {
        return this.getAllIPOsFallback();
      }

      const page = await browser.newPage();
      
      await page.goto(this.CDSC_IPO_URL, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      const ipos = await page.evaluate(() => {
        const data = [];
        const rows = document.querySelectorAll('table tbody tr');
        
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 3) {
            data.push({
              company_name: cells[0]?.textContent?.trim() || '',
              issue_manager: cells[1]?.textContent?.trim() || '',
              issue_date: cells[2]?.textContent?.trim() || '',
              status: cells[3]?.textContent?.trim() || 'Pending'
            });
          }
        });
        
        return data;
      });

      await page.close();

      const result = {
        total: ipos.length,
        ipo_list: ipos,
        fetched_at: new Date().toISOString(),
        source: 'puppeteer'
      };

      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;

    } catch (error) {
      console.error('Error fetching all IPOs from CDSC:', error.message);
      return this.getAllIPOsFallback();
    }
  }

  /**
   * Fallback for getting all IPOs
   */
  async getAllIPOsFallback() {
    try {
      const response = await axios.get(this.CDSC_IPO_URL, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'text/html'
        }
      });

      const $ = cheerio.load(response.data);
      const ipos = [];

      $('table tbody tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 3) {
          ipos.push({
            company_name: $(cells[0]).text().trim() || '',
            issue_manager: $(cells[1]).text().trim() || '',
            issue_date: $(cells[2]).text().trim() || '',
            status: $(cells[3]).text().trim() || 'Pending'
          });
        }
      });

      return {
        total: ipos.length,
        ipo_list: ipos,
        fetched_at: new Date().toISOString(),
        source: 'fallback'
      };

    } catch (error) {
      console.error('Error fetching all IPOs (fallback):', error.message);
      return { error: error.message, ipo_list: [] };
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

  /**
   * Close browser
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = new IPOResultScraper();