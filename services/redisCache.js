// services/redisCache.js
const redis = require('redis');
const logger = require('../utils/logger');

class RedisCache {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      this.client = redis.createClient({
        socket: {
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || 6379
        }
      });
      
      this.client.on('error', (err) => {
        logger.error('Redis error:', err);
        this.isConnected = false;
      });
      
      this.client.on('connect', () => {
        logger.info('Redis connected');
        this.isConnected = true;
      });
      
      await this.client.connect();
      
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      this.isConnected = false;
    }
  }

  async get(key) {
    if (!this.isConnected) return null;
    
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error(`Redis get error for key ${key}:`, error);
      return null;
    }
  }

  async set(key, value, ttlSeconds = 3600) {
    if (!this.isConnected) return false;
    
    try {
      await this.client.set(key, value, { EX: ttlSeconds });
      return true;
    } catch (error) {
      logger.error(`Redis set error for key ${key}:`, error);
      return false;
    }
  }

  async setex(key, seconds, value) {
    return this.set(key, value, seconds);
  }

  async del(key) {
    if (!this.isConnected) return false;
    
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error(`Redis del error for key ${key}:`, error);
      return false;
    }
  }

  async flush() {
    if (!this.isConnected) return false;
    
    try {
      await this.client.flushAll();
      return true;
    } catch (error) {
      logger.error('Redis flush error:', error);
      return false;
    }
  }
}

module.exports = new RedisCache();