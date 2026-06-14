// api/middleware/cache.js
const cache = require('../../services/redisCache');
const logger = require('../../utils/logger');

const cacheMiddleware = (durationSeconds = 60) => {
  return async (req, res, next) => {
    // Skip cache for non-GET requests
    if (req.method !== 'GET') {
      return next();
    }
    
    // Create cache key from URL and query params
    const cacheKey = `${req.method}:${req.originalUrl}`;
    
    try {
      const cachedData = await cache.get(cacheKey);
      
      if (cachedData) {
        logger.debug(`Cache hit for ${cacheKey}`);
        const data = JSON.parse(cachedData);
        return res.json({
          ...data,
          cached: true,
          cache_age: Math.floor((Date.now() - new Date(data.timestamp).getTime()) / 1000)
        });
      }
      
      // Store original send function
      const originalSend = res.json;
      
      // Override send function to cache response
      res.json = function(data) {
        // Only cache successful responses
        if (res.statusCode === 200 && data.success !== false) {
          cache.setex(cacheKey, durationSeconds, JSON.stringify(data))
            .catch(err => logger.error('Cache set error:', err));
        }
        
        originalSend.call(this, data);
      };
      
      next();
      
    } catch (error) {
      logger.error('Cache middleware error:', error);
      next();
    }
  };
};

const invalidateCache = async (pattern) => {
  // Implementation would depend on Redis pattern matching
  // This is a placeholder
  logger.info(`Invalidating cache for pattern: ${pattern}`);
};

module.exports = { cacheMiddleware, invalidateCache };