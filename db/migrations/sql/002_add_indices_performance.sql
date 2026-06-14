-- db/migrations/sql/002_add_indices_performance.sql
-- Description: Additional performance indices for better query performance

-- Composite indexes for common queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_candles_date_company 
ON price_candles(date, company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_candles_close_price 
ON price_candles(close_price) WHERE close_price IS NOT NULL;

-- Partial indexes for active data
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_active 
ON companies(symbol) WHERE is_active = true;

-- Index for live price lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_live_prices_latest 
ON live_prices(company_id, timestamp DESC);

-- Index for IPO searches
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ipo_calendar_status 
ON ipo_calendar(status, open_date);

-- Index for corporate actions searches
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_corporate_actions_fy 
ON corporate_actions(fiscal_year, action_type);

-- GIN index for JSONB queries in corporate actions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_corporate_actions_details 
ON corporate_actions USING GIN (details);