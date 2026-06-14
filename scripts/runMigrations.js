// scripts/runMigrations.js (Fixed - No shebang line)
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

const MIGRATIONS_TABLE = 'schema_migrations';
const MIGRATIONS_PATH = path.join(__dirname, '../db/migrations/sql');

async function runMigrations() {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  
  console.log('\n🔄 Database Migration Tool\n');
  
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'nepse_data',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
  
  try {
    await ensureMigrationsTable(pool);
    
    switch (command) {
      case 'up':
        await migrateUp(pool, args[0]);
        break;
      case 'down':
        const steps = parseInt(args[0]) || 1;
        await migrateDown(pool, steps);
        break;
      case 'status':
        await showStatus(pool);
        break;
      case 'create':
        if (!args[0]) {
          console.error('❌ Please provide a migration name');
          process.exit(1);
        }
        await createMigration(args[0]);
        break;
      default:
        showHelp();
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      version VARCHAR(50) NOT NULL UNIQUE,
      description TEXT NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      execution_time_ms INTEGER,
      success BOOLEAN DEFAULT true,
      error_message TEXT
    );
  `);
  console.log('✅ Migrations table ready');
}

async function getExecutedMigrations(pool) {
  const result = await pool.query(
    `SELECT version FROM ${MIGRATIONS_TABLE} WHERE success = true ORDER BY version`
  );
  return result.rows.map(row => row.version);
}

async function getMigrationFiles() {
  try {
    const files = await fs.readdir(MIGRATIONS_PATH);
    return files
      .filter(file => file.endsWith('.sql'))
      .sort();
  } catch (error) {
    console.error('❌ Could not read migrations directory:', error.message);
    return [];
  }
}

async function migrateUp(pool, version = null) {
  console.log('📊 Running migrations...\n');
  
  const executed = await getExecutedMigrations(pool);
  const files = await getMigrationFiles();
  
  let migrationsToRun = files.filter(file => {
    const fileVersion = file.split('_')[0];
    return !executed.includes(fileVersion);
  });
  
  if (version) {
    migrationsToRun = migrationsToRun.filter(file => file.startsWith(version));
  }
  
  if (migrationsToRun.length === 0) {
    console.log('✅ No pending migrations');
    return;
  }
  
  console.log(`📋 Found ${migrationsToRun.length} pending migrations:\n`);
  
  for (const file of migrationsToRun) {
    const [version, ...rest] = file.split('_');
    const description = rest.join('_').replace('.sql', '').replace(/_/g, ' ');
    
    console.log(`🔄 Running migration: ${version} - ${description}`);
    
    const startTime = Date.now();
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const sql = await fs.readFile(path.join(MIGRATIONS_PATH, file), 'utf8');
      await client.query(sql);
      
      await client.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (version, description, execution_time_ms, success)
         VALUES ($1, $2, $3, $4)`,
        [version, description, Date.now() - startTime, true]
      );
      
      await client.query('COMMIT');
      console.log(`  ✅ Completed in ${Date.now() - startTime}ms\n`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      
      await client.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (version, description, execution_time_ms, success, error_message)
         VALUES ($1, $2, $3, $4, $5)`,
        [version, description, Date.now() - startTime, false, error.message]
      );
      
      console.log(`  ❌ Failed: ${error.message}\n`);
      throw error;
      
    } finally {
      client.release();
    }
  }
  
  console.log('✅ All migrations completed successfully');
}

async function migrateDown(pool, steps) {
  console.log(`📊 Rolling back ${steps} migration(s)...\n`);
  
  const result = await pool.query(
    `SELECT version, description FROM ${MIGRATIONS_TABLE} 
     WHERE success = true 
     ORDER BY version DESC 
     LIMIT $1`,
    [steps]
  );
  
  const migrationsToRollback = result.rows;
  
  for (const migration of migrationsToRollback) {
    console.log(`🔄 Rolling back: ${migration.version} - ${migration.description}`);
    
    await pool.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE version = $1`, [migration.version]);
    console.log(`  ✅ Rolled back\n`);
  }
  
  console.log(`✅ Rolled back ${migrationsToRollback.length} migration(s)`);
}

async function showStatus(pool) {
  console.log('📊 Migration Status:\n');
  
  const executed = await getExecutedMigrations(pool);
  const files = await getMigrationFiles();
  
  console.log('┌─────────┬──────────────────────────────┬──────────┐');
  console.log('│ Version │ Description                  │ Status   │');
  console.log('├─────────┼──────────────────────────────┼──────────┤');
  
  for (const file of files) {
    const version = file.split('_')[0];
    const description = file.split('_').slice(1).join('_').replace('.sql', '').replace(/_/g, ' ');
    const isExecuted = executed.includes(version);
    
    const status = isExecuted ? '✅ Applied' : '⏳ Pending';
    console.log(`│ ${version.padEnd(7)} │ ${description.padEnd(28)} │ ${status.padEnd(8)} │`);
  }
  
  console.log('└─────────┴──────────────────────────────┴──────────┘');
  console.log(`\n📊 Total: ${executed.length} applied, ${files.length - executed.length} pending`);
}

async function createMigration(name) {
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const filename = `${timestamp}_${name.toLowerCase().replace(/ /g, '_')}.sql`;
  const filepath = path.join(MIGRATIONS_PATH, filename);
  
  const template = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}
-- Description: ${name}

-- Write your migration here

-- Up migration
-- TODO: Add your migration SQL here

-- Down migration (optional)
-- TODO: Add rollback SQL here if needed
`;
  
  await fs.writeFile(filepath, template);
  console.log(`✅ Created migration: ${filename}`);
  console.log(`📍 Location: ${filepath}`);
}

function showHelp() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║              Database Migration Commands                  ║
╚═══════════════════════════════════════════════════════════╝

Usage:
  npm run db:migrate up              - Run all pending migrations
  npm run db:migrate up [version]    - Run pending migrations (optional version)
  npm run db:migrate down [steps]    - Rollback N migrations (default: 1)
  npm run db:migrate status          - Show migration status
  npm run db:migrate create <name>   - Create a new migration

Examples:
  npm run db:migrate up
  npm run db:migrate down 3
  npm run db:migrate create add_user_table
  `);
}

runMigrations().catch(console.error);