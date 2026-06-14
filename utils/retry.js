// utils/retry.js
const logger = require('./logger');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, options = {}) {
  const {
    retries = parseInt(process.env.MAX_RETRIES) || 3,
    delay = parseInt(process.env.RETRY_DELAY_MS) || 2000,
    backoff = true,
    onRetry = null
  } = options;
  
  let lastError;
  
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (i === retries) {
        logger.error(`All ${retries} retries failed:`, error);
        throw error;
      }
      
      const waitTime = backoff ? delay * Math.pow(2, i) : delay;
      
      if (onRetry) {
        onRetry(error, i + 1, waitTime);
      } else {
        logger.warn(`Attempt ${i + 1} failed. Retrying in ${waitTime}ms...`, {
          error: error.message,
          attempt: i + 1
        });
      }
      
      await sleep(waitTime);
    }
  }
  
  throw lastError;
}

module.exports = { withRetry, sleep };