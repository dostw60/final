// api/routes/index.js
const express = require('express');
const router = express.Router();
const candleRoutes = require('./candles');
const ipoRoutes = require('./ipo');
const companyRoutes = require('./companies');

router.use('/candles', candleRoutes);
router.use('/ipo', ipoRoutes);
router.use('/companies', companyRoutes);

module.exports = router;