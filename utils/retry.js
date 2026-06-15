// utils/retry.js
// Remove the logger require line

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, options = {}) {
  const {
    retries = 3,
    delay = 2000,
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
        console.error(`All ${retries} retries failed:`, error.message);
        throw error;
      }
      
      const waitTime = backoff ? delay * Math.pow(2, i) : delay;
      
      if (onRetry) {
        onRetry(error, i + 1, waitTime);
      } else {
        console.warn(`Attempt ${i + 1} failed. Retrying in ${waitTime}ms...`);
      }
      
      await sleep(waitTime);
    }
  }
  
  throw lastError;
}

module.exports = { withRetry, sleep };