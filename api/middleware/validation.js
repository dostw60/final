// api/middleware/validation.js
const Joi = require('joi');

const validateSymbol = (req, res, next) => {
  const { symbol } = req.params;
  
  if (!symbol || symbol.length < 1 || symbol.length > 20) {
    return res.status(400).json({ error: 'Invalid symbol format' });
  }
  
  // Symbol should be uppercase letters, numbers, and optional dots
  const symbolRegex = /^[A-Z0-9.]+$/;
  if (!symbolRegex.test(symbol.toUpperCase())) {
    return res.status(400).json({ error: 'Symbol must contain only letters, numbers, and dots' });
  }
  
  next();
};

const validateDateRange = (req, res, next) => {
  const { from, to } = req.query;
  
  if (from && isNaN(Date.parse(from))) {
    return res.status(400).json({ error: 'Invalid from date format' });
  }
  
  if (to && isNaN(Date.parse(to))) {
    return res.status(400).json({ error: 'Invalid to date format' });
  }
  
  if (from && to && new Date(from) > new Date(to)) {
    return res.status(400).json({ error: 'From date must be before to date' });
  }
  
  next();
};

const validatePagination = (req, res, next) => {
  let { limit, offset } = req.query;
  
  limit = parseInt(limit);
  offset = parseInt(offset);
  
  if (isNaN(limit)) limit = 50;
  if (isNaN(offset)) offset = 0;
  
  if (limit < 1) limit = 1;
  if (limit > 1000) limit = 1000;
  if (offset < 0) offset = 0;
  
  req.pagination = { limit, offset };
  next();
};

module.exports = {
  validateSymbol,
  validateDateRange,
  validatePagination
};