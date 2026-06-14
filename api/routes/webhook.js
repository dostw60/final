// api/routes/webhook.js
const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const { verifyWebhookSignature } = require('../middleware/webhook');

// Register webhook endpoint
router.post('/register', webhookController.registerWebhook);

// List webhooks
router.get('/', webhookController.listWebhooks);

// Delete webhook
router.delete('/:id', webhookController.deleteWebhook);

// Webhook delivery endpoint (for external services to call)
router.post('/delivery/:id', verifyWebhookSignature, webhookController.handleWebhookDelivery);

// Test webhook
router.post('/test/:id', webhookController.testWebhook);

module.exports = router;