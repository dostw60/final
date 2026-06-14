-- db/migrations/sql/006_views_for_reporting.sql
-- Description: Views for common reporting queries

-- View for latest stock prices
CREATE OR REPLACE VIEW latest_stock_prices AS
SELECT DISTINCT ON (c.symbol)
    c.symbol,
    c.name,
    c.sector,
    lp.last_traded_price as price,
    lp.change,
    lp.percent_change,
    lp.volume,
    lp.timestamp as last_updated
FROM live_prices lp
JOIN companies c ON lp.company_id = c.id
WHERE c.is_active = true
ORDER BY c.symbol, lp.timestamp DESC;

-- View for stock performance summary
CREATE OR REPLACE VIEW stock_performance_summary AS
SELECT 
    c.symbol,
    c.name,
    c.sector,
    pc.date,
    pc.close_price,
    pc.volume,
    LAG(pc.close_price, 1) OVER (PARTITION BY c.symbol ORDER BY pc.date) as prev_close,
    LAG(pc.close_price, 5) OVER (PARTITION BY c.symbol ORDER BY pc.date) as prev_5d_close,
    LAG(pc.close_price, 20) OVER (PARTITION BY c.symbol ORDER BY pc.date) as prev_20d_close,
    LAG(pc.close_price, 252) OVER (PARTITION BY c.symbol ORDER BY pc.date) as prev_52w_close,
    AVG(pc.volume) OVER (PARTITION BY c.symbol ORDER BY pc.date ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) as avg_5d_volume
FROM price_candles pc
JOIN companies c ON pc.company_id = c.id
WHERE c.is_active = true;

-- View for upcoming corporate actions
CREATE OR REPLACE VIEW upcoming_corporate_actions AS
SELECT 
    c.symbol,
    c.name,
    ca.action_type,
    ca.percentage,
    ca.announcement_date,
    ca.book_closure_date,
    ca.distribution_date,
    ca.fiscal_year,
    CASE 
        WHEN ca.action_type = 'DIVIDEND' THEN 'Dividend'
        WHEN ca.action_type = 'BONUS' THEN 'Bonus Share'
        ELSE ca.action_type
    END as action_description
FROM corporate_actions ca
JOIN companies c ON ca.company_id = c.id
WHERE ca.book_closure_date >= CURRENT_DATE
   OR ca.distribution_date >= CURRENT_DATE
ORDER BY ca.book_closure_date ASC;

-- View for IPO dashboard
CREATE OR REPLACE VIEW ipo_dashboard AS
SELECT 
    company_name,
    symbol,
    issue_type,
    issue_price,
    open_date,
    close_date,
    units_available,
    status,
    CASE 
        WHEN status = 'upcoming' AND open_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'Soon'
        WHEN status = 'open' THEN 'Open Now'
        WHEN status = 'closed' THEN 'Closed'
        ELSE status
    END as display_status,
    (CURRENT_DATE - open_date) as days_into_issue
FROM ipo_calendar
WHERE close_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY open_date ASC;