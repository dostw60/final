-- db/migrations/sql/004_historical_data_partitions.sql
-- Description: Partition price_candles table by year for better performance

-- Create partitioned table for price_candles (if not already partitioned)
-- Note: This is a complex migration that should be run during maintenance window

-- Create yearly partition function
CREATE OR REPLACE FUNCTION create_yearly_partition(year INTEGER)
RETURNS VOID AS $$
DECLARE
    start_date DATE := make_date(year, 1, 1);
    end_date DATE := make_date(year, 12, 31);
    partition_name TEXT := 'price_candles_' || year;
BEGIN
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I PARTITION OF price_candles
        FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date + 1
    );
END;
$$ LANGUAGE plpgsql;

-- Create partitions for recent years
SELECT create_yearly_partition(2020);
SELECT create_yearly_partition(2021);
SELECT create_yearly_partition(2022);
SELECT create_yearly_partition(2023);
SELECT create_yearly_partition(2024);
SELECT create_yearly_partition(2025);