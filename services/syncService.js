// services/syncService.js
const candleScraper = require('../scrapers/market/candleScraper');
const ipoScraper = require('../scrapers/events/ipoScraper');
const logger = require('../utils/logger');

class SyncService {
  constructor() {
    this.isRunning = false;
  }

  async syncHistoricalData(startDate, endDate) {
    if (this.isRunning) {
      logger.warn('Sync already in progress');
      return { success: false, reason: 'sync_in_progress' };
    }
    
    this.isRunning = true;
    
    try {
      logger.info(`Starting historical sync from ${startDate} to ${endDate}`);
      
      let currentDate = new Date(startDate);
      const end = new Date(endDate);
      const results = [];
      
      while (currentDate <= end) {
        const result = await candleScraper.scrapeDailyCandles(currentDate);
        results.push(result);
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
        
        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success && !r.skipped).length;
      const skipped = results.filter(r => r.skipped).length;
      
      logger.info(`Historical sync complete: ${successful} success, ${failed} failed, ${skipped} skipped`);
      
      return {
        success: true,
        total: results.length,
        successful,
        failed,
        skipped,
        results
      };
      
    } catch (error) {
      logger.error('Historical sync failed:', error);
      return { success: false, error: error.message };
      
    } finally {
      this.isRunning = false;
    }
  }

  async syncAll() {
    logger.info('Starting full sync...');
    
    const marketResult = await candleScraper.scrapeDailyCandles();
    const ipoResult = await ipoScraper.updateIPOCalendar();
    
    return {
      market: marketResult,
      ipo: ipoResult,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new SyncService();