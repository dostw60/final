// db/init.js
const pool = require('./pool');
const logger = require('../utils/logger');

async function initDatabase() {
  const client = await pool.connect();
  
  try {
    // Create tables
    await client.query(`
      -- Companies table
      CREATE TABLE IF NOT EXISTS companies (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(20) UNIQUE NOT NULL,
          name VARCHAR(200) NOT NULL,
          sector VARCHAR(100),
          listed_date DATE,
          is_active BOOLEAN DEFAULT true,
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
      
      -- IPO calendar
      CREATE TABLE IF NOT EXISTS ipo_calendar (
          id SERIAL PRIMARY KEY,
          company_name VARCHAR(200) NOT NULL,
          symbol VARCHAR(20),
          issue_type VARCHAR(10) CHECK (issue_type IN ('IPO', 'FPO', 'RIGHT')),
          units_available BIGINT,
          issue_price NUMERIC(10, 2),
          open_date DATE NOT NULL,
          close_date DATE NOT NULL,
          status VARCHAR(20) DEFAULT 'upcoming',
          source_url TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(company_name, open_date)
      );
      
      -- Corporate actions
      CREATE TABLE IF NOT EXISTS corporate_actions (
          id SERIAL PRIMARY KEY,
          company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
          action_type VARCHAR(20) CHECK (action_type IN ('DIVIDEND', 'BONUS', 'RIGHT', 'SPLIT')),
          percentage NUMERIC(5, 2),
          announcement_date DATE,
          book_closure_date DATE,
          distribution_date DATE,
          fiscal_year VARCHAR(9),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(company_id, announcement_date, action_type)
      );
      
      -- Market holidays
      CREATE TABLE IF NOT EXISTS market_holidays (
          id SERIAL PRIMARY KEY,
          holiday_date DATE UNIQUE NOT NULL,
          reason VARCHAR(100),
          is_annual BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Create indexes for performance
      CREATE INDEX IF NOT EXISTS idx_price_candles_date ON price_candles(date);
      CREATE INDEX IF NOT EXISTS idx_price_candles_company ON price_candles(company_id);
      CREATE INDEX IF NOT EXISTS idx_ipo_calendar_dates ON ipo_calendar(open_date, close_date);
      CREATE INDEX IF NOT EXISTS idx_corporate_actions_company ON corporate_actions(company_id);
      
      -- Create function to update updated_at timestamp
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      -- Create triggers
      DROP TRIGGER IF EXISTS update_companies_updated_at ON companies;
      CREATE TRIGGER update_companies_updated_at
          BEFORE UPDATE ON companies
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
          
      DROP TRIGGER IF EXISTS update_ipo_calendar_updated_at ON ipo_calendar;
      CREATE TRIGGER update_ipo_calendar_updated_at
          BEFORE UPDATE ON ipo_calendar
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
    `);
    
    logger.info('Database schema initialized');
    
    // Insert default holidays
    await seedHolidays(client);
    
  } catch (error) {
    logger.error('Database initialization failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function seedHolidays(client) {
  // Insert 2024 holidays (Saturdays handled by isTradingDay function)
  const holidays2024 = [
    ['2024-01-15', 'Maghe Sankranti', false],
    ['2024-01-30', 'Sonam Lhosar', false],
    ['2024-02-19', 'Praja Tantra Diwas', false],
    ['2024-03-08', 'Maha Shivaratri', false],
    ['2024-03-24', 'Holi', false],
    ['2024-04-13', 'Nepali New Year', false],
    ['2024-05-23', 'Buddha Jayanti', false],
    ['2024-08-19', 'Gai Jatra', false],
    ['2024-08-26', 'Krishna Janmashtami', false],
    ['2024-10-02', 'Dashain (Ghatasthapana)', false],
    ['2024-10-11', 'Dashain (Fulpati)', false],
    ['2024-10-12', 'Dashain (Maha Astami)', false],
    ['2024-10-13', 'Dashain (Maha Navami)', false],
    ['2024-10-14', 'Dashain (Vijaya Dashami)', false],
    ['2024-10-31', 'Tihar (Laxmi Puja)', false],
    ['2024-11-01', 'Tihar (Govardhan Puja)', false],
    ['2024-11-02', 'Tihar (Bhai Tika)', false],
    ['2024-11-15', 'Chhath Puja', false],
    ['2024-12-25', 'Christmas Day', false]
  ];
  
  for (const [date, reason, isAnnual] of holidays2024) {
    await client.query(`
      INSERT INTO market_holidays (holiday_date, reason, is_annual)
      VALUES ($1, $2, $3)
      ON CONFLICT (holiday_date) DO NOTHING
    `, [date, reason, isAnnual]);
  }
  
  logger.info(`Seeded ${holidays2024.length} holidays`);
}

module.exports = { initDatabase };