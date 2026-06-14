-- db/migrations/sql/001_initial_schema.sql
-- Description: Initial database schema for NEPSE scraper

-- Companies table
CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    sector VARCHAR(100),
    sub_sector VARCHAR(100),
    listed_date DATE,
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(100),
    website VARCHAR(200),
    registrar VARCHAR(200),
    registrar_phone VARCHAR(50),
    pan_number VARCHAR(50),
    fiscal_year_end VARCHAR(20),
    issued_shares BIGINT,
    paid_up_capital NUMERIC(20, 2),
    promoter_percent NUMERIC(5, 2),
    public_percent NUMERIC(5, 2),
    is_active BOOLEAN DEFAULT true,
    source VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Price candles table
CREATE TABLE IF NOT EXISTS price_candles (
    id BIGSERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    open_price NUMERIC(12, 2) NOT NULL,
    high_price NUMERIC(12, 2) NOT NULL,
    low_price NUMERIC(12, 2) NOT NULL,
    close_price NUMERIC(12, 2) NOT NULL,
    volume BIGINT NOT NULL,
    turnover NUMERIC(20, 2),
    source VARCHAR(50) DEFAULT 'merolagani',
    scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, date)
);

-- Live prices table
CREATE TABLE IF NOT EXISTS live_prices (
    id BIGSERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    last_traded_price NUMERIC(12, 2) NOT NULL,
    change NUMERIC(12, 2),
    percent_change NUMERIC(8, 2),
    volume BIGINT,
    turnover NUMERIC(20, 2),
    high NUMERIC(12, 2),
    low NUMERIC(12, 2),
    open_price NUMERIC(12, 2),
    previous_close NUMERIC(12, 2),
    total_trades INTEGER,
    timestamp TIMESTAMP NOT NULL,
    source VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, timestamp)
);

-- IPO calendar table
CREATE TABLE IF NOT EXISTS ipo_calendar (
    id SERIAL PRIMARY KEY,
    company_name VARCHAR(200) NOT NULL,
    symbol VARCHAR(20),
    issue_type VARCHAR(10) CHECK (issue_type IN ('IPO', 'FPO', 'RIGHT')),
    units_available BIGINT,
    issue_price NUMERIC(10, 2),
    open_date DATE NOT NULL,
    close_date DATE NOT NULL,
    allotment_date DATE,
    refund_date DATE,
    listing_date DATE,
    status VARCHAR(20) DEFAULT 'upcoming',
    source_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_name, open_date)
);

-- Corporate actions table (dividends, bonus, splits, etc.)
CREATE TABLE IF NOT EXISTS corporate_actions (
    id SERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    action_type VARCHAR(20) CHECK (action_type IN ('DIVIDEND', 'BONUS', 'RIGHT', 'SPLIT', 'MERGER')),
    percentage NUMERIC(10, 2),
    amount NUMERIC(20, 2),
    announcement_date DATE,
    book_closure_date DATE,
    distribution_date DATE,
    record_date DATE,
    fiscal_year VARCHAR(9),
    description TEXT,
    source VARCHAR(50),
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, announcement_date, action_type)
);

-- Market holidays table
CREATE TABLE IF NOT EXISTS market_holidays (
    id SERIAL PRIMARY KEY,
    holiday_date DATE UNIQUE NOT NULL,
    reason VARCHAR(100),
    is_annual BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Symbol mappings table
CREATE TABLE IF NOT EXISTS symbol_mappings (
    id SERIAL PRIMARY KEY,
    original_symbol VARCHAR(20) NOT NULL,
    mapped_symbol VARCHAR(20) NOT NULL,
    confidence INTEGER DEFAULT 100,
    source VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(original_symbol, mapped_symbol)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_price_candles_date ON price_candles(date);
CREATE INDEX IF NOT EXISTS idx_price_candles_company ON price_candles(company_id);
CREATE INDEX IF NOT EXISTS idx_price_candles_company_date ON price_candles(company_id, date);
CREATE INDEX IF NOT EXISTS idx_live_prices_timestamp ON live_prices(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_live_prices_symbol ON live_prices(symbol);
CREATE INDEX IF NOT EXISTS idx_ipo_calendar_dates ON ipo_calendar(open_date, close_date);
CREATE INDEX IF NOT EXISTS idx_corporate_actions_company ON corporate_actions(company_id);
CREATE INDEX IF NOT EXISTS idx_corporate_actions_dates ON corporate_actions(announcement_date, book_closure_date);
CREATE INDEX IF NOT EXISTS idx_symbol_mappings_original ON symbol_mappings(original_symbol);
CREATE INDEX IF NOT EXISTS idx_symbol_mappings_mapped ON symbol_mappings(mapped_symbol);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers
CREATE TRIGGER update_companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ipo_calendar_updated_at
    BEFORE UPDATE ON ipo_calendar
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_corporate_actions_updated_at
    BEFORE UPDATE ON corporate_actions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();