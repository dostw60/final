// api/controllers/healthController.js
const pool = require('../../db/pool');
const cache = require('../../services/redisCache');
const os = require('os');

class HealthController {
  async basicHealth(req, res) {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  }

  async detailedHealth(req, res) {
    const checks = {
      database: await this.checkDatabase(),
      redis: await this.checkRedis(),
      memory: this.checkMemory(),
      disk: await this.checkDisk(),
      system: this.checkSystem()
    };
    
    const allHealthy = Object.values(checks).every(check => check.status === 'healthy');
    
    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks,
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV
    });
  }

  async readinessCheck(req, res) {
    // Check if app is ready to serve traffic
    const isDatabaseReady = await this.checkDatabase();
    const isRedisReady = await this.checkRedis();
    
    if (isDatabaseReady.status === 'healthy' && isRedisReady.status === 'healthy') {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not ready' });
    }
  }

  async livenessCheck(req, res) {
    // Simple check if app is alive
    res.status(200).json({ status: 'alive' });
  }

  async databaseHealth(req, res) {
    const result = await this.checkDatabase();
    res.status(result.status === 'healthy' ? 200 : 503).json(result);
  }

  async redisHealth(req, res) {
    const result = await this.checkRedis();
    res.status(result.status === 'healthy' ? 200 : 503).json(result);
  }

  async checkDatabase() {
    try {
      const startTime = Date.now();
      await pool.query('SELECT 1');
      const responseTime = Date.now() - startTime;
      
      // Get connection count
      const connResult = await pool.query('SELECT COUNT(*) FROM pg_stat_activity');
      
      return {
        status: 'healthy',
        response_time_ms: responseTime,
        connections: parseInt(connResult.rows[0].count),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async checkRedis() {
    try {
      const startTime = Date.now();
      await cache.client.ping();
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        response_time_ms: responseTime,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  checkMemory() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const usagePercent = (usedMemory / totalMemory) * 100;
    
    const status = usagePercent < 85 ? 'healthy' : (usagePercent < 95 ? 'degraded' : 'unhealthy');
    
    return {
      status,
      total_gb: (totalMemory / 1024 / 1024 / 1024).toFixed(2),
      free_gb: (freeMemory / 1024 / 1024 / 1024).toFixed(2),
      used_gb: (usedMemory / 1024 / 1024 / 1024).toFixed(2),
      usage_percent: usagePercent.toFixed(2),
      timestamp: new Date().toISOString()
    };
  }

  async checkDisk() {
    // This is a simplified version - in production use proper disk check
    return {
      status: 'healthy',
      message: 'Disk check would require additional monitoring',
      timestamp: new Date().toISOString()
    };
  }

  checkSystem() {
    return {
      status: 'healthy',
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      load_avg: os.loadavg(),
      uptime: os.uptime(),
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new HealthController();