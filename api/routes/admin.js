// api/routes/admin.js (For managing cron jobs)
const express = require('express');
const router = express.Router();
const cronScheduler = require('../../jobs/cron');
const logger = require('../../utils/logger');

// Authentication middleware
const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Get all scheduled jobs
router.get('/cron/jobs', authenticate, (req, res) => {
  const status = cronScheduler.getJobStatus();
  res.json({
    success: true,
    data: status,
    timestamp: new Date().toISOString()
  });
});

// Manually trigger a job
router.post('/cron/trigger/:jobName', authenticate, async (req, res) => {
  try {
    const { jobName } = req.params;
    const result = await cronScheduler.triggerJob(jobName);
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Failed to trigger job: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// Get job logs
router.get('/cron/logs/:jobName', authenticate, async (req, res) => {
  const { jobName } = req.params;
  const { limit = 100 } = req.query;
  
  // This would fetch from a log database
  res.json({
    success: true,
    data: [],
    message: 'Logs would be available from log aggregation system'
  });
});

// Restart cron scheduler
router.post('/cron/restart', authenticate, async (req, res) => {
  try {
    cronScheduler.stop();
    await cronScheduler.start();
    res.json({
      success: true,
      message: 'Cron scheduler restarted successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to restart cron scheduler:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;