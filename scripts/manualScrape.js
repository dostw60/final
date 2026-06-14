// scripts/manualScrape.js
require('dotenv').config();
const candleScraper = require('../scrapers/market/candleScraper');
const syncService = require('../services/syncService');
const logger = require('../utils/logger');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'today') {
    const result = await candleScraper.scrapeDailyCandles();
    console.log('Scrape result:', result);
    
  } else if (command === 'historical') {
    const startDate = args[1] || '2024-01-01';
    const endDate = args[2] || new Date().toISOString().split('T')[0];
    
    const result = await syncService.syncHistoricalData(startDate, endDate);
    console.log('Historical sync result:', result);
    
  } else if (command === 'ipo') {
    const ipoScraper = require('../scrapers/events/ipoScraper');
    const result = await ipoScraper.updateIPOCalendar();
    console.log('IPO update result:', result);
    
  } else {
    console.log(`
Usage:
  npm run scrape:eod today              - Scrape today's data
  npm run scrape:eod historical 2024-01-01 2024-12-31 - Scrape date range
  npm run scrape:ipo                     - Update IPO calendar
    `);
  }
  
  process.exit(0);
}

main().catch(error => {
  logger.error('Script failed:', error);
  process.exit(1);
});