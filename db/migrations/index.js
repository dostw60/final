// db/migrations/index.js
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');

class MigrationManager {
  constructor() {
    this.pool = null;
    this.migrationsTable = 'schema_migrations';
    this.migrationsPath = path.join(__dirname, 'sql');
  }

  async initialize() {
    const { Pool } = require('pg');
    this.pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

    await this.createMigrationsTable();
  }

  async createMigrationsTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS ${this.migrationsTable} (
        id SERIAL PRIMARY KEY,
        version VARCHAR(50) NOT NULL UNIQUE,
        description TEXT NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        execution_time_ms INTEGER,
        success BOOLEAN DEFAULT true,
        error_message TEXT
      );
    `;
    
    await this.pool.query(query);
    logger.info('Migrations table created/verified');
  }

  async getExecutedMigrations() {
    const result = await this.pool.query(
      `SELECT version FROM ${this.migrationsTable} WHERE success = true ORDER BY version`
    );
    return result.rows.map(row => row.version);
  }

  async getMigrationFiles() {
    const files = await fs.readdir(this.migrationsPath);
    return files
      .filter(file => file.endsWith('.sql'))
      .sort(); // Sort to ensure proper order
  }

  async executeMigration(file, version, description) {
    const startTime = Date.now();
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Read and execute migration SQL
      const sql = await fs.readFile(path.join(this.migrationsPath, file), 'utf8');
      await client.query(sql);
      
      // Record successful migration
      await client.query(
        `INSERT INTO ${this.migrationsTable} (version, description, execution_time_ms, success)
         VALUES ($1, $2, $3, $4)`,
        [version, description, Date.now() - startTime, true]
      );
      
      await client.query('COMMIT');
      logger.info(`Migration ${version} completed in ${Date.now() - startTime}ms`);
      return true;
      
    } catch (error) {
      await client.query('ROLLBACK');
      
      // Record failed migration
      await client.query(
        `INSERT INTO ${this.migrationsTable} (version, description, execution_time_ms, success, error_message)
         VALUES ($1, $2, $3, $4, $5)`,
        [version, description, Date.now() - startTime, false, error.message]
      );
      
      logger.error(`Migration ${version} failed:`, error);
      throw error;
      
    } finally {
      client.release();
    }
  }

  async migrate(version = null) {
    await this.initialize();
    
    const executed = await this.getExecutedMigrations();
    const files = await this.getMigrationFiles();
    
    let migrationsToRun = files.filter(file => {
      const version = file.split('_')[0];
      return !executed.includes(version);
    });
    
    if (version) {
      migrationsToRun = migrationsToRun.filter(file => file.startsWith(version));
    }
    
    if (migrationsToRun.length === 0) {
      logger.info('No pending migrations');
      return;
    }
    
    logger.info(`Found ${migrationsToRun.length} pending migrations`);
    
    for (const file of migrationsToRun) {
      const [version, ...rest] = file.split('_');
      const description = rest.join('_').replace('.sql', '').replace(/_/g, ' ');
      
      logger.info(`Running migration: ${version} - ${description}`);
      await this.executeMigration(file, version, description);
    }
    
    logger.info('All migrations completed successfully');
  }

  async rollback(steps = 1) {
    await this.initialize();
    
    const result = await this.pool.query(
      `SELECT version FROM ${this.migrationsTable} 
       WHERE success = true 
       ORDER BY version DESC 
       LIMIT $1`,
      [steps]
    );
    
    const migrationsToRollback = result.rows;
    
    for (const migration of migrationsToRollback) {
      logger.info(`Rolling back migration: ${migration.version}`);
      // Rollback logic would go here
      await this.pool.query(
        `DELETE FROM ${this.migrationsTable} WHERE version = $1`,
        [migration.version]
      );
    }
    
    logger.info(`Rolled back ${migrationsToRollback.length} migrations`);
  }

  async getStatus() {
    await this.initialize();
    
    const executed = await this.getExecutedMigrations();
    const files = await this.getMigrationFiles();
    
    const status = [];
    for (const file of files) {
      const version = file.split('_')[0];
      const isExecuted = executed.includes(version);
      
      const result = await this.pool.query(
        `SELECT executed_at, execution_time_ms, success, error_message 
         FROM ${this.migrationsTable} 
         WHERE version = $1`,
        [version]
      );
      
      status.push({
        version,
        file,
        executed: isExecuted,
        executed_at: result.rows[0]?.executed_at,
        execution_time_ms: result.rows[0]?.execution_time_ms,
        success: result.rows[0]?.success,
        error: result.rows[0]?.error_message
      });
    }
    
    return status;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

module.exports = new MigrationManager();