// api/middleware/rateLimit.js
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redis = require('../../services/redisCache');

const rateLimiter = (options = {}) => {
  const {
    windowMs = 60000, // 1 minute
    max = 60, // 60 requests per minute
    message = 'Too many requests, please try again later.'
  } = options;
  
  return rateLimit({
    store: new RedisStore({
      sendCommand: (...args) => redis.client.sendCommand(args),
    }),
    windowMs,
    max,
    message: {
      error: message,
      retry_after: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

const strictRateLimiter = rateLimiter({ windowMs: 60000, max: 10 });
const moderateRateLimiter = rateLimiter({ windowMs: 60000, max: 30 });
const relaxedRateLimiter = rateLimiter({ windowMs: 60000, max: 100 });

module.exports = {
  rateLimiter,
  strictRateLimiter,
  moderateRateLimiter,
  relaxedRateLimiter
};