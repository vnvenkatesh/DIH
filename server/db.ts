import { Pool } from 'pg';
import { hash } from 'bcryptjs';

console.log('[db] creating pool, PGHOST:', process.env.PGHOST ?? '(not set)');

const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

pool.on('error', (err) => {
  console.error('[db] pool error:', err.message);
});

export async function initDb(): Promise<void> {
  console.log('[db] initDb: ensuring schema...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('Admin', 'AppUser')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Add preference columns (safe to run repeatedly)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(10) DEFAULT 'light'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_provider VARCHAR(20) DEFAULT 'gemini'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gemini_api_key TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS claude_api_key TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS openai_api_key TEXT DEFAULT ''`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS llm_usage_logs (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider      VARCHAR(20) NOT NULL,
      model         VARCHAR(100) NOT NULL,
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd      NUMERIC(12, 8) NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Idempotent column additions for tables that pre-date these commits
  await pool.query(`ALTER TABLE llm_usage_logs ADD COLUMN IF NOT EXISTS accelerator VARCHAR(100) NOT NULL DEFAULT 'Other'`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_user_provider
    ON llm_usage_logs(user_id, provider)
  `);

  console.log('[db] initDb: schema ready');

  const { rowCount } = await pool.query("SELECT id FROM users WHERE role = 'Admin' LIMIT 1");
  if (!rowCount) {
    console.log('[db] initDb: seeding default admin...');
    const passwordHash = await hash('Admin@123', 10);
    await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'Admin')",
      ['admin', passwordHash]
    );
    console.log('[db] initDb: default admin created → username: admin  password: Admin@123');
  } else {
    console.log('[db] initDb: admin already exists, skip seed');
  }
}

export default pool;
