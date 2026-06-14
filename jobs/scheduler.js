// jobs/scheduler.js
const cron = require('node-cron');
const candleScraper = require('../scrapers/market/candleScraper');
const ipoScraper = require('../scrapers/events/ipoScraper');
const syncService = require('../services/syncService');
const logger = require('../utils/logger');
const livePriceScraper = require('../scrapers/market/livePriceScraper');
const companyScraper = require('../scrapers/company/companyScraper');
const cronScheduler = require('./cron');

class Scheduler {
  constructor() {
    this.jobs = [];
  }

  start() {
    logger.info('Starting job scheduler...');
    
    // Job 1: EOD scrape at 3:30 PM Nepal time
    this.jobs.push(
      cron.schedule('30 9 * * 1-5', async () => {
        logger.info('Running EOD scrape job...');
        const result = await candleScraper.scrapeDailyCandles();
        
        if (result.success) {
          logger.info(`EOD scrape successful: ${result.records} records`);
        } else {
          logger.error(`EOD scrape failed: ${result.error || result.reason}`);
        }
      }, {
        timezone: "Asia/Kathmandu"
      })
    );
    this.jobs.push(
  cron.schedule('0 22 1 * *', async () => {
    logger.info('Running monthly company data refresh...');
    const result = await companyScraper.fetchAllCompanies(true);
    
    if (result.success) {
      logger.info(`Company data refresh complete: ${result.count} companies`);
    } else {
      logger.error(`Company data refresh failed: ${result.error}`);
    }
  }, {
    timezone: "Asia/Kathmandu"
  })
);

// Job: Weekly symbol mapping validation (Sunday at 3 AM)
this.jobs.push(
  cron.schedule('0 21 * * 0', async () => {
    logger.info('Running symbol mapping validation...');
    const unmapped = await symbolMapper.getUnmappedSymbols();
    
    if (unmapped.length > 0) {
      logger.warn(`Found ${unmapped.length} unmapped symbols:`, unmapped.slice(0, 10));
    } else {
      logger.info('All symbols are properly mapped');
    }
  }, {
    timezone: "Asia/Kathmandu"
  })
);
    // Job 2: IPO calendar update every 6 hours
    this.jobs.push(
      cron.schedule('0 */6 * * *', async () => {
        logger.info('Updating IPO calendar...');
        const result = await ipoScraper.updateIPOCalendar();
        
        if (result.success) {
          logger.info(`IPO calendar updated: ${result.records} records`);
        } else {
          logger.error(`IPO update failed: ${result.error}`);
        }
      }, {
        timezone: "Asia/Kathmandu"
      })
    );
    this.jobs.push(
  cron.schedule('*/10 * * * * 1-5', async () => {
    const marketTime = dateParser.getCurrentNepalTime();
    const hour = marketTime.getHours();
    const isWeekday = marketTime.getDay() !== 6; // Not Saturday
    
    // Only run during market hours (11 AM - 3 PM)
    if (isWeekday && hour >= 11 && hour <= 15) {
      logger.debug('Updating live prices...');
      await livePriceScraper.updateLivePricesDatabase();
    }
  }, {
    timezone: "Asia/Kathmandu"
  })
);

// Job 6: Start/stop live stream with market hours
// This runs every minute to manage WebSocket connection
this.jobs.push(
  cron.schedule('* * * * * 1-5', async () => {
    const marketTime = dateParser.getCurrentNepalTime();
    const hour = marketTime.getHours();
    const isWeekday = marketTime.getDay() !== 6;
    
    const isMarketHours = isWeekday && hour >= 11 && hour <= 15;
    const dividendScraper = require('../scrapers/events/dividendScraper');
const bonusScraper = require('../scrapers/events/bonusScraper');
    if (isMarketHours && !livePriceScraper.isWatching) {
      logger.info('Market open - starting live price stream');
      livePriceScraper.startLiveStream((update) => {
        // Broadcast to connected WebSocket clients if you have them
        logger.debug(`Live update: ${update.type}`);
      });
    } else if (!isMarketHours && livePriceScraper.isWatching) {
      logger.info('Market closed - stopping live price stream');
      livePriceScraper.stopLiveStream();
    }
  }, {
    timezone: "Asia/Kathmandu"
  })
);
    // Job 3: Weekly cleanup on Sunday at 2 AM
    this.jobs.push(
      cron.schedule('0 20 * * 0', async () => {
        logger.info('Running weekly maintenance...');
        await this.runMaintenance();
      }, {
        timezone: "Asia/Kathmandu"
      })
    );
    this.jobs.push(
  cron.schedule('0 19 * * 0', async () => {
    logger.info('Running weekly dividend update...');
    const result = await dividendScraper.fetchDividends();
    
    if (result.success) {
      logger.info(`Dividend update complete: ${result.count} records`);
    } else {
      logger.error(`Dividend update failed: ${result.error}`);
    }
  }, {
    timezone: "Asia/Kathmandu"
  })
);

// Job: Weekly bonus share update (Sunday at 2 AM)
this.jobs.push(
  cron.schedule('0 20 * * 0', async () => {
    logger.info('Running weekly bonus share update...');
    const result = await bonusScraper.fetchBonusShares();
    
    if (result.success) {
      logger.info(`Bonus share update complete: ${result.count} records`);
    } else {
      logger.error(`Bonus share update failed: ${result.error}`);
    }
  }, {
    timezone: "Asia/Kathmandu"
  })
);

// Job: Monthly dividend yield calculations (1st of month at 3 AM)
this.jobs.push(
  cron.schedule('0 21 1 * *', async () => {
    logger.info('Running monthly dividend yield calculations...');
    await calculateAllDividendYields();
  }, {
    timezone: "Asia/Kathmandu"
  })
);

// Helper function for monthly calculations
async function calculateAllDividendYields() {
  const pool = require('../db/pool');
  
  try {
    const companies = await pool.query('SELECT symbol FROM companies WHERE is_active = true');
    
    for (const company of companies.rows) {
      await dividendScraper.calculateDividendYield(company.symbol);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    logger.info(`Calculated dividend yields for ${companies.rows.length} companies`);
  } catch (error) {
    logger.error('Failed to calculate dividend yields:', error);
  }
}
    // Job 4: Intraday updates every 15 minutes during market hours
    this.jobs.push(
      cron.schedule('*/15 5-9 * * 1-5', async () => {
        logger.info('Running intraday update...');
        // For live prices implementation
        logger.debug('Intraday update executed');
      }, {
        timezone: "Asia/Kathmandu"
      })
    );
    
    logger.info(`Scheduled ${this.jobs.length} jobs`);
  }

  async runMaintenance() {
    try {
      // Clean old cache
      const redisCache = require('../services/redisCache');
      await redisCache.flush();
      
      // Log rotation would be handled by winston
      
      // Database vacuum (optional)
      const pool = require('../db/pool');
      await pool.query('VACUUM ANALYZE price_candles');
      
      logger.info('Weekly maintenance completed');
      
    } catch (error) {
      logger.error('Maintenance failed:', error);
    }
  }

  stop() {
    logger.info('Stopping all scheduled jobs...');
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
  }
}
class Scheduler {
  constructor() {
    this.isInitialized = false;
  }

  async start() {
    if (this.isInitialized) {
      logger.warn('Scheduler already initialized');
      return;
    }

    logger.info('Initializing NEPSE Scheduler...');
    
    try {
      // Start cron scheduler
      await cronScheduler.start();
      
      this.isInitialized = true;
      logger.info('Scheduler initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize scheduler:', error);
      throw error;
    }
  }

  stop() {
    if (!this.isInitialized) {
      logger.warn('Scheduler not initialized');
      return;
    }
    
    cronScheduler.stop();
    this.isInitialized = false;
    logger.info('Scheduler stopped');
  }

  getStatus() {
    return cronScheduler.getJobStatus();
  }

  async triggerJob(jobName) {
    if (!this.isInitialized) {
      throw new Error('Scheduler not initialized');
    }
    
    return await cronScheduler.triggerJob(jobName);
  }
}

module.exports = new Scheduler();
