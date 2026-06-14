-- db/migrations/sql/007_seed_initial_data.sql
-- Description: Seed initial data (companies, holidays, etc.)

-- Insert common market holidays for 2024-2025
INSERT INTO market_holidays (holiday_date, reason, is_annual) VALUES
    ('2024-01-15', 'Maghe Sankranti', false),
    ('2024-01-30', 'Sonam Lhosar', false),
    ('2024-02-19', 'Praja Tantra Diwas', false),
    ('2024-03-08', 'Maha Shivaratri', false),
    ('2024-03-24', 'Holi', false),
    ('2024-04-13', 'Nepali New Year', false),
    ('2024-05-23', 'Buddha Jayanti', false),
    ('2024-08-19', 'Gai Jatra', false),
    ('2024-08-26', 'Krishna Janmashtami', false),
    ('2024-10-02', 'Dashain (Ghatasthapana)', false),
    ('2024-10-11', 'Dashain (Fulpati)', false),
    ('2024-10-12', 'Dashain (Maha Astami)', false),
    ('2024-10-13', 'Dashain (Maha Navami)', false),
    ('2024-10-14', 'Dashain (Vijaya Dashami)', false),
    ('2024-10-31', 'Tihar (Laxmi Puja)', false),
    ('2024-11-01', 'Tihar (Govardhan Puja)', false),
    ('2024-11-02', 'Tihar (Bhai Tika)', false),
    ('2024-11-15', 'Chhath Puja', false),
    ('2024-12-25', 'Christmas Day', false),
    ('2025-01-14', 'Maghe Sankranti', false),
    ('2025-03-04', 'Maha Shivaratri', false),
    ('2025-04-14', 'Nepali New Year', false)
ON CONFLICT (holiday_date) DO NOTHING;

-- Insert some common stock sectors
INSERT INTO companies (symbol, name, sector, is_active) VALUES
    ('NABIL', 'Nabil Bank Limited', 'Banking', true),
    ('EBL', 'Everest Bank Limited', 'Banking', true),
    ('NIB', 'Nepal Investment Bank', 'Banking', true),
    ('NICA', 'NIC Asia Bank', 'Banking', true),
    ('GBIME', 'Global IME Bank', 'Banking', true),
    ('PRVU', 'Prabhu Bank', 'Banking', true),
    ('SANIMA', 'Sanima Bank', 'Banking', true),
    ('MEGA', 'Mega Bank', 'Banking', true),
    ('CZBIL', 'Citizen Bank', 'Banking', true),
    ('SBI', 'Nepal SBI Bank', 'Banking', true)
ON CONFLICT (symbol) DO NOTHING;

-- Insert symbol mappings for common variations
INSERT INTO symbol_mappings (original_symbol, mapped_symbol, confidence, source) VALUES
    ('NABILB', 'NABIL', 90, 'seed'),
    ('NABILPO', 'NABIL', 80, 'seed'),
    ('EBLB', 'EBL', 90, 'seed'),
    ('NIBL', 'NIB', 90, 'seed'),
    ('NICAB', 'NICA', 90, 'seed'),
    ('GBIMEB', 'GBIME', 90, 'seed'),
    ('PRVUB', 'PRVU', 90, 'seed'),
    ('SANIMAB', 'SANIMA', 90, 'seed'),
    ('MEGAB', 'MEGA', 90, 'seed'),
    ('CZBILB', 'CZBIL', 90, 'seed')
ON CONFLICT (original_symbol, mapped_symbol) DO NOTHING;