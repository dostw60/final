-- db/migrations/sql/008_stored_procedures.sql
-- Description: Stored procedures for common operations

-- Procedure to refresh materialized views
CREATE OR REPLACE PROCEDURE refresh_market_views()
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY latest_stock_prices;
    REFRESH MATERIALIZED VIEW CONCURRENTLY stock_performance_summary;
    RAISE NOTICE 'Market views refreshed at %', CURRENT_TIMESTAMP;
END;
$$;

-- Procedure to clean old data
CREATE OR REPLACE PROCEDURE clean_old_data(days_to_keep INTEGER DEFAULT 90)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Delete old live prices (keep last 7 days)
    DELETE FROM live_prices 
    WHERE timestamp < CURRENT_DATE - INTERVAL '7 days';
    
    -- Delete old job logs
    DELETE FROM job_executions 
    WHERE created_at < CURRENT_DATE - (days_to_keep || ' days')::INTERVAL;
    
    -- Delete old rate limit logs
    DELETE FROM rate_limit_logs 
    WHERE timestamp < CURRENT_DATE - INTERVAL '30 days';
    
    RAISE NOTICE 'Cleaned data older than % days', days_to_keep;
END;
$$;

-- Procedure to calculate stock moving averages
CREATE OR REPLACE FUNCTION calculate_moving_averages(symbol_input VARCHAR)
RETURNS TABLE(
    date DATE,
    close_price NUMERIC,
    ma_5 NUMERIC,
    ma_20 NUMERIC,
    ma_50 NUMERIC,
    ma_200 NUMERIC
) LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH price_data AS (
        SELECT 
            pc.date,
            pc.close_price,
            AVG(pc.close_price) OVER (ORDER BY pc.date ROWS BETWEEN 4 PRECEDING AND CURRENT ROW) as ma_5,
            AVG(pc.close_price) OVER (ORDER BY pc.date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) as ma_20,
            AVG(pc.close_price) OVER (ORDER BY pc.date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) as ma_50,
            AVG(pc.close_price) OVER (ORDER BY pc.date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) as ma_200
        FROM price_candles pc
        JOIN companies c ON pc.company_id = c.id
        WHERE c.symbol = symbol_input
    )
    SELECT * FROM price_data
    ORDER BY date DESC
    LIMIT 252;
END;
$$;