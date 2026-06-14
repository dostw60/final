// scripts/seedDatabase.js
require('dotenv').config();
const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function seedDatabase() {
  console.log('\n🌱 Seeding database with initial data...\n');
  
  try {
    // Seed market holidays
    await seedHolidays();
    
    // Seed initial companies
    await seedCompanies();
    
    // Seed symbol mappings
    await seedSymbolMappings();
    
    console.log('\n✅ Database seeding completed successfully!\n');
    
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    logger.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function seedHolidays() {
  console.log('📅 Seeding market holidays...');
  
  const holidays = [
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
    ['2024-12-25', 'Christmas Day', false],
    ['2025-01-14', 'Maghe Sankranti', false],
    ['2025-03-04', 'Maha Shivaratri', false],
    ['2025-04-14', 'Nepali New Year', false]
  ];
  
  for (const [date, reason, isAnnual] of holidays) {
    await pool.query(`
      INSERT INTO market_holidays (holiday_date, reason, is_annual)
      VALUES ($1, $2, $3)
      ON CONFLICT (holiday_date) DO NOTHING
    `, [date, reason, isAnnual]);
  }
  
  console.log(`  ✅ Seeded ${holidays.length} holidays`);
}

async function seedCompanies() {
  console.log('🏢 Seeding initial companies...');
  
  const companies = [
    ['NABIL', 'Nabil Bank Limited', 'Banking'],
    ['EBL', 'Everest Bank Limited', 'Banking'],
    ['NIB', 'Nepal Investment Bank Limited', 'Banking'],
    ['NICA', 'NIC Asia Bank Limited', 'Banking'],
    ['GBIME', 'Global IME Bank Limited', 'Banking'],
    ['PRVU', 'Prabhu Bank Limited', 'Banking'],
    ['SANIMA', 'Sanima Bank Limited', 'Banking'],
    ['MEGA', 'Mega Bank Nepal Limited', 'Banking'],
    ['CZBIL', 'Citizen Bank International Limited', 'Banking'],
    ['SBI', 'Nepal SBI Bank Limited', 'Banking'],
    ['KBL', 'Kumari Bank Limited', 'Banking'],
    ['LBL', 'Laxmi Bank Limited', 'Banking'],
    ['MBL', 'Machhapuchchhre Bank Limited', 'Banking'],
    ['NMB', 'NMB Bank Limited', 'Banking'],
    ['PCBL', 'Prime Commercial Bank Limited', 'Banking'],
    ['SBL', 'Siddhartha Bank Limited', 'Banking'],
    ['SCB', 'Standard Chartered Bank Nepal', 'Banking'],
    ['HBL', 'Himalayan Bank Limited', 'Banking'],
    ['NCCB', 'Nepal Credit and Commerce Bank', 'Banking'],
    ['JBNL', 'Janata Bank Nepal Limited', 'Banking']
  ];
  
  for (const [symbol, name, sector] of companies) {
    await pool.query(`
      INSERT INTO companies (symbol, name, sector, is_active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (symbol) DO UPDATE SET
        name = EXCLUDED.name,
        sector = EXCLUDED.sector
    `, [symbol, name, sector]);
  }
  
  console.log(`  ✅ Seeded ${companies.length} companies`);
}

async function seedSymbolMappings() {
  console.log('🔗 Seeding symbol mappings...');
  
  const mappings = [
    ['NABILB', 'NABIL', 90, 'seed'],
    ['NABILPO', 'NABIL', 80, 'seed'],
    ['EBLB', 'EBL', 90, 'seed'],
    ['NIBL', 'NIB', 90, 'seed'],
    ['NICAB', 'NICA', 90, 'seed'],
    ['GBIMEB', 'GBIME', 90, 'seed'],
    ['PRVUB', 'PRVU', 90, 'seed'],
    ['SANIMAB', 'SANIMA', 90, 'seed'],
    ['MEGAB', 'MEGA', 90, 'seed'],
    ['CZBILB', 'CZBIL', 90, 'seed'],
    ['KBLPO', 'KBL', 80, 'seed'],
    ['LBLB', 'LBL', 90, 'seed'],
    ['MBLB', 'MBL', 90, 'seed'],
    ['NMBPO', 'NMB', 80, 'seed'],
    ['PCBLPO', 'PCBL', 80, 'seed'],
    ['SBLPO', 'SBL', 80, 'seed']
  ];
  
  for (const [original, mapped, confidence, source] of mappings) {
    await pool.query(`
      INSERT INTO symbol_mappings (original_symbol, mapped_symbol, confidence, source)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (original_symbol, mapped_symbol) DO NOTHING
    `, [original, mapped, confidence, source]);
  }
  
  console.log(`  ✅ Seeded ${mappings.length} symbol mappings`);
}

seedDatabase();