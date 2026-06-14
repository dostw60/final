-- db/migrations/sql/005_job_tracking.sql
-- Description: Tables for tracking scraper jobs and their status

-- Job execution history
CREATE TABLE IF NOT EXISTS job_executions (
    id BIGSERIAL PRIMARY KEY,
    job_name VARCHAR(100) NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    status VARCHAR(20) CHECK (status IN ('running', 'success', 'failed', 'skipped')),
    records_processed INTEGER,
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Data quality checks table
CREATE TABLE IF NOT EXISTS data_quality_checks (
    id SERIAL PRIMARY KEY,
    check_name VARCHAR(100) NOT NULL,
    check_date DATE NOT NULL,
    status VARCHAR(20) CHECK (status IN ('pass', 'fail', 'warning')),
    expected_value TEXT,
    actual_value TEXT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rate limiting logs
CREATE TABLE IF NOT EXISTS rate_limit_logs (
    id BIGSERIAL PRIMARY KEY,
    endpoint VARCHAR(200),
    source VARCHAR(50),
    request_count INTEGER,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for job tracking
CREATE INDEX IF NOT EXISTS idx_job_executions_name_time ON job_executions(job_name, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_job_executions_status ON job_executions(status);
CREATE INDEX IF NOT EXISTS idx_data_quality_date ON data_quality_checks(check_date DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit_timestamp ON rate_limit_logs(timestamp DESC);