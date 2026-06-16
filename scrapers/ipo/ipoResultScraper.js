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
    }
    return this.browser;
  }

  /**
   * Fetch IPO result from CDSC website using Puppeteer
   */
  async fetchIPOResult(ipoName) {
    try {
      const cacheKey = `ipo_result_${ipoName}`;
      const cached = this.cache.get(cacheKey);
      
      // Cache for 24 hours
      if (cached && Date.now() - cached.timestamp < 86400000) {
        return cached.data;
      }

      const browser = await this.getBrowser();
      const page = await browser.newPage();
      
      // Set user agent to avoid blocking
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Navigate to CDSC IPO result page
      await page.goto(this.CDSC_IPO_URL, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      // Wait for the table to load
      await page.waitForSelector('table', { timeout: 10000 });

      // Extract table data
      const result = await page.evaluate((searchName) => {
        const data = [];
        const rows = document.querySelectorAll('table tbody tr');
        
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            const companyName = cells[0]?.textContent?.trim() || '';
            const issueManager = cells[1]?.textContent?.trim() || '';
            const issueDate = cells[2]?.textContent?.trim() || '';
            
            // Check if this is the company we're looking for
            if (searchName && !companyName.toLowerCase().includes(searchName.toLowerCase())) {
              continue;
            }

            // Check for allotment status (if available)
            const statusCell = cells[3]?.textContent?.trim() || 'Pending';
            
            data.push({
              company_name: companyName,
              issue_manager: issueManager,
              issue_date: issueDate,
              status: statusCell,
              has_result: statusCell.toLowerCase() !== 'pending'
            });
          }
        }
        return data;
      }, ipoName);

      await page.close();

      // If we found results, also try to fetch detailed allotment data
      let detailedResult = null;
      if (result.length > 0 && result[0].has_result) {
        detailedResult = await this.fetchDetailedAllotment(ipoName);
      }

      const finalResult = {
        ipo_name: ipoName,
        found: result.length > 0,
        results: result,
        detailed_allotment: detailedResult,
        fetched_at: new Date().toISOString()
      };

      // Cache the result
      this.cache.set(cacheKey, { data: finalResult, timestamp: Date.now() });
      
      return finalResult;

    } catch (error) {
      console.error('Error fetching IPO result from CDSC:', error.message);
      
      // Fallback: Try using axios + cheerio as backup
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

      $('table tbody tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 4) {
          const companyName = $(cells[0]).text().trim();
          if (companyName.toLowerCase().includes(ipoName.toLowerCase())) {
            results.push({
              company_name: companyName,
              issue_manager: $(cells[1]).text().trim(),
              issue_date: $(cells[2]).text().trim(),
              status: $(cells[3]).text().trim() || 'Pending'
            });
          }
        }
      });

      return {
        ipo_name: ipoName,
        found: results.length > 0,
        results: results,
        detailed_allotment: null,
        fetched_at: new Date().toISOString(),
        source: 'fallback'
      };

    } catch (error) {
      console.error('Fallback IPO fetch failed:', error.message);
      return {
        ipo_name: ipoName,
        found: false,
        error: error.message,
        results: [],
        fetched_at: new Date().toISOString()
      };
    }
  }

  /**
   * Fetch detailed allotment information
   */
  async fetchDetailedAllotment(ipoName) {
    try {
      // Try to find a detailed allotment page
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      
      // Try different URL patterns
      const urls = [
        `https://www.cdsc.com.np/result/${ipoName.toLowerCase()}`,
        `https://www.cdsc.com.np/allotment/${ipoName}`,
        `https://www.cdsc.com.np/public/ipo/${ipoName}`
      ];

      let allotmentData = null;

      for (const url of urls) {
        try {
          await page.goto(url, { waitUntil: 'networkidle0', timeout: 10000 });
          
          const data = await page.evaluate(() => {
            const tables = document.querySelectorAll('table');
            const info = {};
            
            // Extract allotment details
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
    const batchSize = 3; // Process 3 at a time to avoid rate limiting

    for (let i = 0; i < ipoNames.length; i += batchSize) {
      const batch = ipoNames.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(name => this.fetchIPOResult(name))
      );
      results.push(...batchResults);
      
      // Delay between batches
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
        fetched_at: new Date().toISOString()
      };

      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;

    } catch (error) {
      console.error('Error fetching all IPOs from CDSC:', error.message);
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
    
    // Also try to get detailed data for matches
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