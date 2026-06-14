// scripts/fetch-all-candles.js
const axios = require('axios');
const fs = require('fs');

const API_BASE = 'https://final-ocai.onrender.com';
const OUTPUT_FILE = 'all-candles-data.json';

async function fetchAllCompanies() {
  try {
    const response = await axios.get(`${API_BASE}/api/companies/all`);
    return response.data.data;
  } catch (error) {
    console.error('Error fetching companies:', error.message);
    return [];
  }
}

async function fetchCandles(symbol, period = '1y') {
  try {
    const response = await axios.get(`${API_BASE}/api/candles/${symbol}?period=${period}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching candles for ${symbol}:`, error.message);
    return null;
  }
}

async function fetchAllCandles(period = '1y', batchSize = 5) {
  console.log('🚀 Fetching all companies...');
  const companies = await fetchAllCompanies();
  
  if (companies.length === 0) {
    console.log('❌ No companies found');
    return;
  }
  
  console.log(`📊 Found ${companies.length} companies`);
  console.log(`📈 Fetching ${period} of candle data for each...\n`);
  
  const results = [];
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    console.log(`[${i + 1}/${companies.length}] Fetching ${company.symbol}...`);
    
    const candleData = await fetchCandles(company.symbol, period);
    
    if (candleData && candleData.success && candleData.count > 0) {
      results.push({
        symbol: company.symbol,
        name: company.name,
        period: period,
        count: candleData.count,
        data: candleData.data
      });
      successCount++;
      console.log(`  ✅ ${candleData.count} candles retrieved`);
    } else {
      failCount++;
      console.log(`  ❌ No data available`);
    }
    
    // Wait between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Save results to file
  const output = {
    generated_at: new Date().toISOString(),
    period: period,
    total_companies: companies.length,
    success_count: successCount,
    fail_count: failCount,
    data: results
  };
  
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✅ Saved to ${OUTPUT_FILE}`);
  console.log(`📊 Summary: ${successCount} successful, ${failCount} failed`);
  
  return output;
}

// Run with command line argument for period
const period = process.argv[2] || '1y';
fetchAllCandles(period).catch(console.error);