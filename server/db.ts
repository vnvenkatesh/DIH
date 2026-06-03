import { Pool } from 'pg';
import { hash } from 'bcryptjs';

const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

export async function initDb(): Promise<void> {
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

  const { rowCount } = await pool.query("SELECT id FROM users WHERE role = 'Admin' LIMIT 1");
  if (!rowCount) {
    const passwordHash = await hash('Admin@123', 10);
    await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'Admin')",
      ['admin', passwordHash]
    );
    console.log('  ✦ Default admin created → username: admin  password: Admin@123');
  }
}

export default pool;
