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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gemini_model VARCHAR(100) DEFAULT 'gemini-2.5-flash'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS claude_model VARCHAR(100) DEFAULT 'claude-haiku-4-5-20251001'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS openai_model VARCHAR(100) DEFAULT 'gpt-4o-mini'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS claude_effort VARCHAR(10) DEFAULT 'medium'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS grok_api_key TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS grok_model VARCHAR(100) DEFAULT 'grok-4.3'`);

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

  // ── Companies ──────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id                       SERIAL PRIMARY KEY,
      name                     VARCHAR(200) NOT NULL,
      created_at               TIMESTAMPTZ DEFAULT NOW(),
      updated_at               TIMESTAMPTZ DEFAULT NOW(),
      storage_provider         VARCHAR(10)  DEFAULT NULL,
      storage_bucket           VARCHAR(500) DEFAULT '',
      storage_region           VARCHAR(100) DEFAULT '',
      storage_access_key       TEXT         DEFAULT '',
      storage_secret_key       TEXT         DEFAULT '',
      storage_azure_connection TEXT         DEFAULT ''
    )
  `);
  await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS gemini_api_key TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS claude_api_key TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS openai_api_key TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS grok_api_key   TEXT DEFAULT ''`);

  // ── User company columns ───────────────────────────────────────────────────
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_role VARCHAR(20) DEFAULT 'member'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS uses_company_keys BOOLEAN DEFAULT FALSE`);

  // ── Projects ───────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(200) NOT NULL,
      description TEXT         DEFAULT '',
      company_id  INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      created_by  INTEGER      NOT NULL REFERENCES users(id),
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW(),
      status      VARCHAR(20)  DEFAULT 'active'
    )
  `);

  // ── Project files ──────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_files (
      id          SERIAL PRIMARY KEY,
      project_id  INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      uploaded_by INTEGER      NOT NULL REFERENCES users(id),
      name        VARCHAR(500) NOT NULL,
      file_type   VARCHAR(50)  NOT NULL,
      role        VARCHAR(50)  DEFAULT 'template',
      storage_key TEXT         NOT NULL,
      size_bytes  INTEGER      DEFAULT 0,
      archived    BOOLEAN      DEFAULT FALSE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── Project results ────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_results (
      id          SERIAL PRIMARY KEY,
      project_id  INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      accelerator VARCHAR(100) NOT NULL,
      result_data JSONB        NOT NULL,
      provider    VARCHAR(20),
      model       VARCHAR(100),
      created_by  INTEGER      NOT NULL REFERENCES users(id),
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_project_results_project_accel
    ON project_results(project_id, accelerator)
  `);

  // ── Project messages (chatbot) ─────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_messages (
      id         SERIAL PRIMARY KEY,
      project_id INTEGER     NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id    INTEGER     NOT NULL REFERENCES users(id),
      role       VARCHAR(10) NOT NULL,
      content    TEXT        NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
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
