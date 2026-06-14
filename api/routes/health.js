// api/routes/health.js
const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');

// Basic health check
router.get('/', healthController.basicHealth);

// Detailed health check
router.get('/detailed', healthController.detailedHealth);

// Readiness probe (for k8s)
router.get('/ready', healthController.readinessCheck);

// Liveness probe (for k8s)
router.get('/live', healthController.livenessCheck);

// Database health
router.get('/database', healthController.databaseHealth);

// Redis health
router.get('/redis', healthController.redisHealth);

module.exports = router;