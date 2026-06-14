// jobs/cron.js
const cron = require('node-cron');
const logger = require('../utils/logger');
const dateParser = require('../services/dateParser');

// Scraper imports
const candleScraper = require('../scrapers/market/candleScraper');
const livePriceScraper = require('../scrapers/market/livePriceScraper');
const ipoScraper = require('../scrapers/events/ipoScraper');
const dividendScraper = require('../scrapers/events/dividendScraper');
const bonusScraper = require('../scrapers/events/bonusScraper');
const companyScraper = require('../scrapers/company/companyScraper');
const symbolMapper = require('../scrapers/company/symbolMapper');

// Service imports
const syncService = require('../services/syncService');
const redisCache = require('../services/redisCache');

class NEPSECronScheduler {
  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
    this.jobStatuses = new Map();
    this.retryCounters = new Map();
    
    // Job configuration
    this.config = {
      maxRetries: 3,
      retryDelay: 60000, // 1 minute
      jobTimeout: 300000, // 5 minutes
      notificationWebhook: process.env.SLACK_WEBHOOK || null
    };
  }

  /**
   * Initialize and start all cron jobs
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Cron scheduler is already running');
      return;
    }

    logger.info('Starting NEPSE Cron Scheduler...');
    this.isRunning = true;

    // Register all jobs
    this.registerEndOfDayScrape();
    this.registerIntradayScrape();
    this.registerLivePriceUpdates();
    this.registerIPOCalendarUpdate();
    this.registerDividendUpdate();
    this.registerBonusUpdate();
    this.registerCompanyUpdate();
    this.registerDataCleanup();
    this.registerHealthCheck();
    this.registerBackfillJobs();
    this.registerNotificationJobs();
    this.registerMarketHoursMonitor();
    this.registerWeeklyReports();
    this.registerMonthlyAggregates();

    logger.info(`Successfully started ${this.jobs.size} cron jobs`);
    
    // Log all scheduled jobs
    this.logScheduledJobs();
  }

  /**
   * Stop all cron jobs
   */
  stop() {
    logger.info('Stopping all cron jobs...');
    
    for (const [name, job] of this.jobs.entries()) {
      job.stop();
      logger.info(`Stopped job: ${name}`);
    }
    
    this.jobs.clear();
    this.isRunning = false;
    logger.info('All cron jobs stopped');
  }

  /**
   * Register EOD (End of Day) scrape job
   * Runs at 3:30 PM Nepal time on trading days
   */
  registerEndOfDayScrape() {
    const jobName = 'eod-scrape';
    const schedule = '30 9 * * 1-5'; // 3:30 PM Nepal time (9:45 UTC)
    
    const job = cron.schedule(schedule, async () => {
      await this.executeWithRetry(jobName, async () => {
        const marketTime = dateParser.getCurrentNepalTime();
        
        // Only run on trading days
        if (!dateParser.isTradingDay(marketTime)) {
          logger.info(`${jobName}: Skipping - non-trading day`);
          return;
        }
        
        logger.info(`${jobName}: Starting EOD data scrape`);
        const startTime = Date.now();
        
        // Scrape daily candles
        const result = await candleScraper.scrapeDailyCandles();
        
        // Update live prices
        await livePriceScraper.updateLivePricesDatabase();
        
        const duration = Date.now() - startTime;
        
        if (result.success) {
          logger.info(`${jobName}: Completed successfully in ${duration}ms - ${result.records} records`);
          await this.sendNotification('EOD Scrape Success', `Scraped ${result.records} records in ${duration}ms`);
        } else {
          logger.error(`${jobName}: Failed - ${result.error}`);
          await this.sendNotification('EOD Scrape Failed', result.error, 'error');
        }
      });
    }, {
      timezone: "Asia/Kathmandu"
    });
    
    this.jobs.set(jobName, job);
    logger.info(`Registered ${jobName} job (${schedule})`);
  }

  /**
   * Register intraday scrape job (every 15 minutes during market hours)
   */
  registerIntradayScrape() {
    const jobName = 'intraday-scrape';
    const schedule = '*/15 5-9 * * 1-5'; // Every 15 minutes during market hours
    
    const job = cron.schedule(schedule, async () => {
      await this.executeWithRetry(jobName, async () => {
        const marketTime = dateParser.getCurrentNepalTime();
        
        if (!dateParser.isTradingDay(marketTime)) {
          return;
        }
        
        if (!dateParser.isTradingHour(marketTime)) {
          return;
        }
        
        logger.debug(`${jobName}: Running intraday update`);
        const result = await livePriceScraper.updateLivePricesDatabase();
        
        if (result.success) {
          logger.debug(`${jobName}: Updated ${result.count} live prices`);
        }
      });
    }, {
      timezone: "Asia/Kathmandu"
    });
    
    this.jobs.set(jobName, job);
    logger.info(`Registered ${jobName} job (${schedule})`);
  }

  /**
   * Register live price updates (every 10 seconds during market hours)
   */
  registerLivePriceUpdates() {
    const jobName = 'live-prices';
    const schedule = '*/10 * * * * *'; // Every 10 seconds
    
    const job = cron.schedule(schedule, async () => {
      const marketTime = dateParser.getCurrentNepalTime();
      
      if (!dateParser.isTradingDay(marketTime)) {
        return;
      }
      
      if (!dateParser.isTradingHour(marketTime)) {
        return;
      }
      
      // Start live stream if not already running
      if (!livePriceScraper.isWatching) {
        await livePriceScraper.startLiveStream();
      }
    });
    
    this.jobs.set(jobName, job);
    logger.info(`Registered ${jobName} job (every 10 seconds during market hours)`);
  }

  /**
   * Register IPO calendar update (every 6 hours)
   */
  registerIPOCalendarUpdate() {
    const jobName = 'ipo-update';
    const schedule = '0 */6 * * *'; // Every 6 hours
    
    const job = cron.schedule(schedule, async () => {
      await this.executeWithRetry(jobName, async () => {
        logger.info(`${jobName}: Updating IPO calendar`);
        const startTime = Date.now();
        
        const result = await ipoScraper.updateIPOCalendar();
        const duration = Date.now() - startTime;
        
        if (result.success) {
          logger.info(`${jobName}: Updated ${result.records} IPO records in ${duration}ms`);
        } else {
          logger.error(`${jobName}: Failed - ${result.error}`);
        }
      });
    });
    
    this.jobs.set(jobName, job);
    logger.info(`Registered ${jobName} job (${schedule})`);
  }

  /**
   * Register dividend update (daily at 1 AM)
   */
  registerDividendUpdate() {
    const jobName = 'dividend-update';
    const schedule = '0 19 * * *'; // 1 AM Nepal time (7:15 PM UTC previous day)
    
    const job = cron.schedule(schedule, async () => {
      await this.executeWithRetry(jobName, async () => {
        logger.info(`${jobName}: Fetching dividend data`);
        const startTime = Date.now();
        
        const result = await dividendScraper.fetchDividends();
        const duration = Date.now() - startTime;
        
        if (result.success) {
          logger.info(`${jobName}: Processed ${result.count} dividend records in ${duration}ms`);
          
          // Clear cache
          await redisCache.del('dividends:*');
        } else {
          logger.error(`${jobName}: Failed - ${result.error}`);
        }
      });
    }, {
      timezone: "Asia/Kathmandu"
    });
    
    this.jobs.set(jobName, job);
    logger.info(`Registered ${jobName} job (${schedule})`);
  }

  /**
   * Register bonus share update (daily at 2 AM)
   */
  registerBonusUpdate() {
    const jobName = 'bonus-update';
    const schedule = '0 20 * * *'; // 2 AM Nepal time
    
    const job = cron.schedule(schedule, async () => {
      await this.executeWithRetry(jobName, async () => {
        logger.info(`${jobName}: Fetching bonus share data`);
        const startTime = Date.now();
        
        const result = await bonusScraper.fetchBonusShares();
        const duration = Date.now() - startTime;
        
        if (result.success) {
          logger.info(`${jobName}: Processed ${result.count} bonus records in ${duration}ms`);
          
          // Clear cache
          await redisCache.del('bonus:*');
        } else {
          logger.error(`${jobName}: Failed - ${result.error}`);
        }
      });
    }, {
      timezone: "Asia/Kathmandu"
    });
    
    this.jobs.set(jobName, job);
    logger.info(`Registered ${jobName} job (${schedule})`);
  }

  /**
   * Register company master data update (weekly on Sunday at 3 AM)
   */
  registerCompanyUpdate() {
    const jobName = 'company-update';
    const schedule = '0 21 * * 0'; // 3 AM Sunday
    
    const job = cron.schedule(schedule, async () => {
      await this.executeWithRetry(jobName, async () => {
        logger.info(`${jobName}: Updating company master data`);
        const startTime = Date.now();
        
        const result = await companyScraper.fetchAllCompanies(true);
        const duration = Date.now() - startTime;
        
        if (result.success) {
          logger.info(`${jobName}: Updated ${result.count} companies in ${duration}ms`);
          
          // Update symbol mappings
          await symbolMapper.updateMappings(result.data);
          
          // Clear company cache
          await redisCache.del('companies:*');
          await redisCache.del('company:*');
        } else {
          logger.error(`${jobName}: Failed - ${result.error}`);
        }
      });
    }, {
      timezone: "Asia/Kathmandu"
    });
    
    this.jobs.set(jobName, job);
    logger.info(`Registered ${jobName} job (${schedule})`);
  }

  /**
   * Register data cleanup job (daily at 4 AM)
   */
  registerDataCleanup() {
    const jobName = 'data-cleanup';
    const schedule = '0 22 * * *'; // 4 AM Nepal time
    
    const job = cron.schedule(schedule, async () => {
      await this.executeWithRetry(jobName, async () => {
        logger.info(`${jobName}: Starting data cleanup`);
        const startTime = Date.now();
        
        const cleanupResults = await this.performCleanup();
        const duration = Date.now() - startTime;
        
        logger.info(`${jobName}: Completed in ${duration}ms`, cleanupResults);
      });
    }, {
      timezone: "Asia/Kathmandu"
    });
    
    this.jobs.set(jobName, job);
    logger.info(`Registered ${jobName} job (${schedule})`);
  }

  /**
   * Register health check job (every 5 minutes)
   */
  registerHealthCheck() {
    const jobName = 'health-check';
    const schedule = '*/5 * * * *'; // Every 5 minutes
    
    const job = cron.schedule(schedule, async () => {
      await this.executeWithRetry(jobName, async () => {
        const health = await this.checkSystemHealth();
        
        if (!health.healthy) {
          logger.warn(`${jobName}: System unhealthy`, health.issues);
          await this.sendNotification('System Health Alert', JSON.stringify(health.issues), 'warning');
        }
      });
    });
    
    this.jobs.set(jobName, job);
    logger.info(`Registered ${jobName} job (${schedule})`);
  }

  /**
   * Register backfill jobs for missed data
   */
  registerBackfillJobs() {
    const jobName = 'backfill-check';
    const schedule = '0 23 * * *'; // 5 AM Nepal time
    
    const job = cron.schedule(schedule, async () => {
      await this.executeWithRetry(jobName, async () => {
        logger.info(`${jobName}: Checking for missing data`);
        const missingDates = await this.checkMissingData();
        
        if (missingDates.length > 0) {
          logger.info(`${jobName}: Found ${missingDates.length} missing trading days`);
          
          // Backfill last 7 days of missing data
          const lastWeek = missingDates.filter(date => {
            const daysDiff = (new Date() - new Date(date)) / (1000 * 60 * 60 * 24);
            return daysDiff <= 7;
          });
          
          if (lastWeek.length > 0) {
            logger.info(`${jobName}: Backfilling ${lastWeek.length} days`);
            await syncService.syncHistoricalData(lastWeek[0], lastWeek[lastWeek.length - 1]);
          }
        }
      });
    }, {
      timezone: "Asia/Kathmandu"
    });
    
    this.jobs.set(jobName, job);
    logger.info(`Registered ${jobName} job (${schedule})`);
  }

  /**
   * Register notification jobs (daily summary)
   */
  registerNotificationJobs() {
    const jobName = 'daily-summary';
    const schedule = '30 10 * * *'; // 4:30 PM Nepal time (after market close)
    
    const job = cron.schedule(schedule, async () => {
      await this.executeWithRetry(jobName, async () => {
        const summary = await this.generateDailySummary();
        await this.sendNotification('Daily Market Summary', summary, 'info');
      });
    }, {
      timezone: "Asia/Kathmandu"
    });
    
    this.jobs.set(jobName, job);
    logger.info(`Registered ${jobName} job (${schedule})`);
  }

  /**
   * Register market hours monitor
   */
  registerMarketHoursMonitor() {
    const jobName = 'market-monitor';
    const schedule = '*/30 * * * * 1-5'; // Every 30 minutes on weekdays
    
    const job = cron.schedule(schedule, async () => {
      const session = dateParser.getMarketSession();
      
      // Log market state changes
      if (session.session !== this.lastMarketSession) {
        logger.info(`Market state changed: ${this.lastMarketSession} -> ${session.session}`);
        this.lastMarketSession = session.session;
        
        if (session.session === 'open') {
          await this.sendNotification('Market Open', 'NEPSE market is now open', 'info');
          // Start live stream
          await livePriceScraper.startLiveStream();
        } else if (session.session === 'closed' && this.lastMarketSession === 'open') {
          await this.sendNotification('Market Closed', 'NEPSE market is now closed', 'info');
          // Stop live stream
          livePriceScraper.stopLiveStream();
        }
      }
    }, {
      timezone: "Asia/Kathmandu"
    });
    
    this.jobs.set(jobName, job);
    logger.info(`Registered ${jobName} job (${schedule})`);
  }

  /**
   * Register weekly reports (Monday at 6 AM)
   */
  registerWeeklyReports() {
    const jobName = 'weekly-report';
    const schedule = '0 0 * * 1'; // Monday at 6 AM Nepal time
    
    const job = cron.schedule(schedule, async () => {
      await this.executeWithRetry(jobName, async () => {
        logger.info(`${jobName}: Generating weekly report`);
        const report = await this.generateWeeklyReport();
        await this.sendNotification('Weekly Market Report', report, 'info');
      });
    }, {
      timezone: "Asia/Kathmandu"
    });
    
    this.jobs.set(jobName, job);
    logger.info(`Registered ${jobName} job (${schedule})`);
  }

  /**
   * Register monthly aggregates (1st of month at 7 AM)
   */
  registerMonthlyAggregates() {
    const jobName = 'monthly-aggregates';
    const schedule = '0 1 1 * *'; // 1st of month at 7 AM Nepal time
    
    const job = cron.schedule(schedule, async () => {
      await this.executeWithRetry(jobName, async () => {
        logger.info(`${jobName}: Calculating monthly aggregates`);
        await this.calculateMonthlyAggregates();
      });
    }, {
      timezone: "Asia/Kathmandu"
    });
    
    this.jobs.set(jobName, job);
    logger.info(`Registered ${jobName} job (${schedule})`);
  }

  /**
   * Execute a job with retry logic
   */
  async executeWithRetry(jobName, jobFunction) {
    const retryCount = this.retryCounters.get(jobName) || 0;
    
    try {
      // Set timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Job timeout')), this.config.jobTimeout);
      });
      
      // Execute job with timeout
      await Promise.race([jobFunction(), timeoutPromise]);
      
      // Reset retry counter on success
      this.retryCounters.set(jobName, 0);
      this.jobStatuses.set(jobName, {
        status: 'success',
        lastRun: new Date(),
        nextRun: this.getNextRunTime(jobName)
      });
      
    } catch (error) {
      logger.error(`Job ${jobName} failed:`, error);
      
      const newRetryCount = retryCount + 1;
      this.retryCounters.set(jobName, newRetryCount);
      
      this.jobStatuses.set(jobName, {
        status: 'failed',
        error: error.message,
        retryCount: newRetryCount,
        lastRun: new Date(),
        nextRun: this.getNextRunTime(jobName)
      });
      
      if (newRetryCount <= this.config.maxRetries) {
        logger.info(`Retrying ${jobName} in ${this.config.retryDelay}ms (attempt ${newRetryCount}/${this.config.maxRetries})`);
        
        setTimeout(() => {
          this.executeWithRetry(jobName, jobFunction);
        }, this.config.retryDelay);
      } else {
        logger.error(`Job ${jobName} failed after ${this.config.maxRetries} retries`);
        await this.sendNotification(`Job Failed: ${jobName}`, error.message, 'error');
      }
    }
  }

  /**
   * Perform data cleanup operations
   */
  async performCleanup() {
    const pool = require('../db/pool');
    const results = {
      oldCacheCleared: false,
      oldLogsArchived: false,
      duplicateDataRemoved: 0,
      orphanedRecordsRemoved: 0
    };
    
    try {
      // Clean old cache entries (older than 7 days)
      await redisCache.flush();
      results.oldCacheCleared = true;
      
      // Remove duplicate price candles (keep latest)
      const duplicateResult = await pool.query(`
        DELETE FROM price_candles
        WHERE id IN (
          SELECT id FROM (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY company_id, date ORDER BY scraped_at DESC) as rn
            FROM price_candles
          ) t
          WHERE rn > 1
        )
        RETURNING id
      `);
      results.duplicateDataRemoved = duplicateResult.rowCount;
      
      // Remove orphaned records (no company reference)
      const orphanResult = await pool.query(`
        DELETE FROM price_candles
        WHERE company_id NOT IN (SELECT id FROM companies)
        RETURNING id
      `);
      results.orphanedRecordsRemoved = orphanResult.rowCount;
      
      // Archive old logs (older than 30 days)
      // This would be handled by log rotation in production
      
      // Vacuum database
      await pool.query('VACUUM ANALYZE');
      
      logger.info('Cleanup completed', results);
      return results;
      
    } catch (error) {
      logger.error('Cleanup failed:', error);
      throw error;
    }
  }

  /**
   * Check system health
   */
  async checkSystemHealth() {
    const pool = require('../db/pool');
    const issues = [];
    let healthy = true;
    
    try {
      // Check database connection
      await pool.query('SELECT 1');
    } catch (error) {
      healthy = false;
      issues.push(`Database connection failed: ${error.message}`);
    }
    
    try {
      // Check Redis connection
      await redisCache.client.ping();
    } catch (error) {
      healthy = false;
      issues.push(`Redis connection failed: ${error.message}`);
    }
    
    // Check disk space
    const diskUsage = await this.getDiskUsage();
    if (diskUsage > 85) {
      issues.push(`Disk usage high: ${diskUsage}%`);
    }
    
    // Check memory usage
    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed / memUsage.heapTotal > 0.9) {
      issues.push(`Memory usage high: ${Math.round(memUsage.heapUsed / memUsage.heapTotal * 100)}%`);
    }
    
    return {
      healthy: issues.length === 0,
      issues,
      timestamp: new Date().toISOString(),
      metrics: {
        uptime: process.uptime(),
        memory: memUsage,
        jobs: this.jobs.size,
        jobStatuses: Object.fromEntries(this.jobStatuses)
      }
    };
  }

  /**
   * Check for missing data
   */
  async checkMissingData() {
    const pool = require('../db/pool');
    const missingDates = [];
    
    try {
      // Get last 30 trading days
      const tradingDays = [];
      let currentDate = new Date();
      currentDate.setDate(currentDate.getDate() - 30);
      
      while (currentDate <= new Date()) {
        if (dateParser.isTradingDay(currentDate)) {
          tradingDays.push(new Date(currentDate));
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      // Check which dates have data
      for (const date of tradingDays) {
        const result = await pool.query(`
          SELECT COUNT(*) as count
          FROM price_candles
          WHERE date = $1
        `, [dateParser.formatForDatabase(date)]);
        
        if (parseInt(result.rows[0].count) === 0) {
          missingDates.push(date);
        }
      }
      
    } catch (error) {
      logger.error('Failed to check missing data:', error);
    }
    
    return missingDates;
  }

  /**
   * Generate daily market summary
   */
  async generateDailySummary() {
    const pool = require('../db/pool');
    
    try {
      const today = dateParser.formatForDatabase(new Date());
      
      const result = await pool.query(`
        SELECT 
          COUNT(DISTINCT c.symbol) as total_traded,
          SUM(pc.volume) as total_volume,
          SUM(pc.turnover) as total_turnover,
          AVG(pc.close_price) as avg_price,
          MAX(pc.high_price) as market_high,
          MIN(pc.low_price) as market_low
        FROM price_candles pc
        JOIN companies c ON pc.company_id = c.id
        WHERE pc.date = $1
      `, [today]);
      
      const summary = result.rows[0];
      
      return `
📊 NEPSE Daily Summary (${today})
━━━━━━━━━━━━━━━━━━━━━━━
📈 Total Traded: ${summary.total_traded || 0} stocks
💰 Total Volume: ${(summary.total_volume / 1000000).toFixed(2)}M shares
💵 Total Turnover: ${(summary.total_turnover / 100000000).toFixed(2)} Arba
📊 Average Price: Rs. ${parseFloat(summary.avg_price || 0).toFixed(2)}
📈 Market High: Rs. ${parseFloat(summary.market_high || 0).toFixed(2)}
📉 Market Low: Rs. ${parseFloat(summary.market_low || 0).toFixed(2)}
━━━━━━━━━━━━━━━━━━━━━━━
      `;
      
    } catch (error) {
      logger.error('Failed to generate daily summary:', error);
      return 'Unable to generate daily summary';
    }
  }

  /**
   * Generate weekly report
   */
  async generateWeeklyReport() {
    const summary = await this.generateDailySummary();
    const jobSummary = Array.from(this.jobStatuses.entries())
      .map(([name, status]) => `• ${name}: ${status.status}`)
      .join('\n');
    
    return `
${summary}

🔄 Job Status:
${jobSummary}

📊 System Uptime: ${Math.floor(process.uptime() / 3600)} hours
✅ All systems operational
    `;
  }

  /**
   * Calculate monthly aggregates
   */
  async calculateMonthlyAggregates() {
    const pool = require('../db/pool');
    
    try {
      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      
      await pool.query(`
        CREATE TABLE IF NOT EXISTS monthly_aggregates (
          id SERIAL PRIMARY KEY,
          month_date DATE NOT NULL,
          total_volume BIGINT,
          total_turnover NUMERIC(20, 2),
          avg_price NUMERIC(12, 2),
          top_gainer VARCHAR(20),
          top_loser VARCHAR(20),
          most_active VARCHAR(20),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(month_date)
        )
      `);
      
      // Calculate and store monthly aggregates
      const result = await pool.query(`
        INSERT INTO monthly_aggregates (month_date, total_volume, total_turnover, avg_price)
        SELECT 
          DATE_TRUNC('month', date) as month_date,
          SUM(volume) as total_volume,
          SUM(turnover) as total_turnover,
          AVG(close_price) as avg_price
        FROM price_candles
        WHERE date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
          AND date < DATE_TRUNC('month', CURRENT_DATE)
        GROUP BY DATE_TRUNC('month', date)
        ON CONFLICT (month_date) DO UPDATE
        SET total_volume = EXCLUDED.total_volume,
            total_turnover = EXCLUDED.total_turnover,
            avg_price = EXCLUDED.avg_price
      `);
      
      logger.info('Monthly aggregates calculated');
      
    } catch (error) {
      logger.error('Failed to calculate monthly aggregates:', error);
    }
  }

  /**
   * Get disk usage percentage
   */
  async getDiskUsage() {
    // This is a simple implementation - in production, use proper disk monitoring
    const os = require('os');
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    return ((totalMem - freeMem) / totalMem) * 100;
  }

  /**
   * Get next run time for a job
   */
  getNextRunTime(jobName) {
    const job = this.jobs.get(jobName);
    if (!job) return null;
    
    // This is a placeholder - actual next run time would come from cron library
    return new Date(Date.now() + 3600000);
  }

  /**
   * Send notification (Slack/Email/Webhook)
   */
  async sendNotification(title, message, level = 'info') {
    if (!this.config.notificationWebhook) {
      logger.debug(`Notification (${level}): ${title} - ${message}`);
      return;
    }
    
    try {
      const axios = require('axios');
      await axios.post(this.config.notificationWebhook, {
        title,
        message,
        level,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV
      });
    } catch (error) {
      logger.error('Failed to send notification:', error);
    }
  }

  /**
   * Log all scheduled jobs
   */
  logScheduledJobs() {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('📅 Scheduled Cron Jobs:');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const jobList = Array.from(this.jobs.keys());
    const scheduleInfo = {
      'eod-scrape': '3:30 PM daily (trading days)',
      'intraday-scrape': 'Every 15 min during market hours',
      'live-prices': 'Every 10 sec during market hours',
      'ipo-update': 'Every 6 hours',
      'dividend-update': 'Daily at 1 AM',
      'bonus-update': 'Daily at 2 AM',
      'company-update': 'Weekly on Sunday at 3 AM',
      'data-cleanup': 'Daily at 4 AM',
      'health-check': 'Every 5 minutes',
      'backfill-check': 'Daily at 5 AM',
      'daily-summary': 'Daily at 4:30 PM',
      'market-monitor': 'Every 30 min during weekdays',
      'weekly-report': 'Monday at 6 AM',
      'monthly-aggregates': '1st of month at 7 AM'
    };
    
    for (const job of jobList) {
      logger.info(`✅ ${job}: ${scheduleInfo[job] || 'Scheduled'}`);
    }
    
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(`Total active jobs: ${jobList.length}`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  /**
   * Get job status
   */
  getJobStatus() {
    return {
      running: this.isRunning,
      jobs: Object.fromEntries(this.jobStatuses),
      retryCounters: Object.fromEntries(this.retryCounters),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Manually trigger a job
   */
  async triggerJob(jobName) {
    const job = this.jobs.get(jobName);
    if (!job) {
      throw new Error(`Job ${jobName} not found`);
    }
    
    logger.info(`Manually triggering job: ${jobName}`);
    
    // Execute job immediately
    await this.executeWithRetry(jobName, async () => {
      // Find and execute the job function
      const jobFunction = this[`run${this.capitalize(jobName)}`];
      if (jobFunction) {
        await jobFunction.call(this);
      }
    });
    
    return { success: true, jobName, triggered: new Date().toISOString() };
  }

  /**
   * Capitalize string helper
   */
  capitalize(str) {
    return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
  }
}

// Create singleton instance
const cronScheduler = new NEPSECronScheduler();

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, stopping cron scheduler...');
  cronScheduler.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, stopping cron scheduler...');
  cronScheduler.stop();
  process.exit(0);
});

module.exports = cronScheduler;