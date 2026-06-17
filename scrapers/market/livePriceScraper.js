// ============ MARKET STATUS DEBUG ENDPOINTS ============

// Detailed market status debug
app.get('/api/market/status/debug', (req, res) => {
  try {
    // Check if the method exists
    if (typeof livePriceScraper.getMarketStatus !== 'function') {
      return res.status(500).json({
        error: 'getMarketStatus method not found',
        available_methods: Object.getOwnPropertyNames(Object.getPrototypeOf(livePriceScraper))
      });
    }
    
    const status = livePriceScraper.getMarketStatus();
    res.json({
      success: true,
      data: status,
      server_time: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting market status:', error.message);
    res.status(500).json({ 
      error: error.message,
      stack: error.stack 
    });
  }
});

// Simple market open check
app.get('/api/market/is-open', (req, res) => {
  try {
    const isOpen = livePriceScraper.isMarketOpen();
    const status = livePriceScraper.getMarketStatus();
    res.json({
      success: true,
      market_open: isOpen,
      details: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error checking market status:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Force refresh market data with status
app.get('/api/market/force-refresh', async (req, res) => {
  try {
    const prices = await livePriceScraper.getCurrentPrices(true);
    const isOpen = livePriceScraper.isMarketOpen();
    const status = livePriceScraper.getMarketStatus();
    
    res.json({
      success: true,
      market_open: isOpen,
      status: status,
      prices_count: prices.length,
      sample_price: prices.length > 0 ? prices[0] : null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error forcing refresh:', error.message);
    res.status(500).json({ error: error.message });
  }
});