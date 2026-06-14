// scripts/healthCheck.js
require('dotenv').config();
const axios = require('axios');

async function healthCheck() {
  console.log('\n🏥 Running health check...\n');
  
  const apiUrl = `http://localhost:${process.env.API_PORT || 3000}`;
  
  try {
    const response = await axios.get(`${apiUrl}/health`);
    
    if (response.status === 200 && response.data.status === 'healthy') {
      console.log('✅ API is healthy');
      console.log(`   Uptime: ${Math.floor(response.data.uptime)} seconds`);
      console.log(`   Timestamp: ${response.data.timestamp}\n`);
      process.exit(0);
    } else {
      console.error('❌ API is unhealthy:', response.data);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    process.exit(1);
  }
}

healthCheck();