// scripts/flushCache.js
require('dotenv').config();
const redisCache = require('../services/redisCache');
const logger = require('../utils/logger');

async function flushCache() {
  console.log('\n🗑️ Flushing Redis cache...\n');
  
  try {
    await redisCache.connect();
    await redisCache.flush();
    console.log('✅ Cache flushed successfully!\n');
  } catch (error) {
    console.error('❌ Failed to flush cache:', error.message);
    logger.error('Cache flush failed:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

flushCache();