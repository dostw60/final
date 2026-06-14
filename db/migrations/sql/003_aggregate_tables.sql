-- db/migrations/sql/003_aggregate_tables.sql
-- Description: Aggregate tables for faster reporting

-- Daily market aggregates
CREATE TABLE IF NOT EXISTS daily_market_aggregates (
    id SERIAL PRIMARY KEY,
    date DATE UNIQUE NOT NULL,
    total_volume BIGINT,
    total_turnover NUMERIC(20, 2),
    total_trades INTEGER,
    advancing_stocks INTEGER,
    declining_stocks INTEGER,
    unchanged_stocks INTEGER,
    market_cap NUMERIC(20, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Monthly aggregates
CREATE TABLE IF NOT EXISTS monthly_aggregates (
    id SERIAL PRIMARY KEY,
    month_date DATE UNIQUE NOT NULL,
    total_volume BIGINT,
    total_turnover NUMERIC(20, 2),
    avg_price NUMERIC(12, 2),
    max_price NUMERIC(12, 2),
    min_price NUMERIC(12, 2),
    top_gainer_symbol VARCHAR(20),
    top_loser_symbol VARCHAR(20),
    most_active_symbol VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for aggregates
CREATE INDEX IF NOT EXISTS idx_daily_aggregates_date ON daily_market_aggregates(date DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_aggregates_date ON monthly_aggregates(month_date DESC);

-- Function to update daily aggregates
CREATE OR REPLACE FUNCTION update_daily_aggregates(target_date DATE)
RETURNS VOID AS $$
BEGIN
    INSERT INTO daily_market_aggregates (date, total_volume, total_turnover, advancing_stocks, declining_stocks, unchanged_stocks)
    SELECT 
        target_date,
        SUM(pc.volume) as total_volume,
        SUM(pc.turnover) as total_turnover,
        COUNT(CASE WHEN pc.close_price > pc.open_price THEN 1 END) as advancing,
        COUNT(CASE WHEN pc.close_price < pc.open_price THEN 1 END) as declining,
        COUNT(CASE WHEN pc.close_price = pc.open_price THEN 1 END) as unchanged
    FROM price_candles pc
    WHERE pc.date = target_date
    ON CONFLICT (date) DO UPDATE SET
        total_volume = EXCLUDED.total_volume,
        total_turnover = EXCLUDED.total_turnover,
        advancing_stocks = EXCLUDED.advancing_stocks,
        declining_stocks = EXCLUDED.declining_stocks,
        unchanged_stocks = EXCLUDED.unchanged_stocks;
END;
$$ LANGUAGE plpgsql;