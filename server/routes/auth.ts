import express from 'express';
import { compare } from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

function toClientUser(row: any) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    theme: row.theme ?? 'light',
    llm_provider: row.llm_provider ?? 'gemini',
    gemini_api_key: row.gemini_api_key ?? '',
    claude_api_key: row.claude_api_key ?? '',
    openai_api_key: row.openai_api_key ?? '',
    gemini_model: row.gemini_model ?? 'gemini-2.5-flash',
    claude_model: row.claude_model ?? 'claude-haiku-4-5-20251001',
    openai_model: row.openai_model ?? 'gpt-4o-mini',
    claude_effort: row.claude_effort ?? 'medium',
    grok_api_key: row.grok_api_key ?? '',
    grok_model: row.grok_model ?? 'grok-4.3',
    company_id: row.company_id ?? null,
    company_role: row.company_role ?? null,
    company_name: row.company_name ?? null,
    uses_company_keys: row.uses_company_keys ?? false,
    has_storage: Boolean(row.storage_provider),
    storage_provider: row.storage_provider ?? null,
    company_has_storage: Boolean(row.company_storage_provider),
  };
}

router.post('/login', async (req, res) => {
  try {
    console.log('[auth/login] attempt:', req.body?.username);

    const { username, password, company } = req.body ?? {};
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    if (!process.env.JWT_SECRET) {
      console.error('[auth/login] JWT_SECRET is not set');
      res.status(500).json({ error: 'Server misconfiguration: JWT_SECRET is not set' });
      return;
    }

    console.log('[auth/login] querying user...');
    // Fetch user by username first (no company filter yet)
    const { rows } = await pool.query(
      `SELECT u.*, c.name AS company_name, c.storage_provider AS company_storage_provider
       FROM users u
       LEFT JOIN companies c ON u.company_id = c.id
       WHERE LOWER(u.username) = LOWER($1)`,
      [username]
    );
    let user = rows[0];
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // For non-App-Admin users enforce company match when a company was supplied
    const companyFilter = company?.trim();
    if (companyFilter && user.role !== 'Admin') {
      const companyMatch =
        user.company_name && user.company_name.toLowerCase() === companyFilter.toLowerCase();
      if (!companyMatch) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }
    }

    console.log('[auth/login] comparing password...');
    const valid = await compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const clientUser = toClientUser(user);
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, user: clientUser });
    console.log('[auth/login] success:', username);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error('[auth/login] error:', message);
    res.status(500).json({ error: `Login error: ${message}` });
  }
});

router.get('/me', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.*, c.name AS company_name, c.storage_provider AS company_storage_provider FROM users u LEFT JOIN companies c ON u.company_id = c.id WHERE u.id = $1`,
      [req.user!.id]
    );
    if (!rows[0]) { res.status(404).json({ error: 'User not found' }); return; }
    res.json({ user: toClientUser(rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
});

router.put('/preferences', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const {
      theme, llm_provider, gemini_api_key, claude_api_key, openai_api_key,
      gemini_model, claude_model, openai_model, claude_effort, grok_api_key, grok_model,
      storage_provider, storage_bucket, storage_region,
      storage_access_key, storage_secret_key, storage_azure_connection,
    } = req.body ?? {};

    const setClauses: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const add = (col: string, val: any) => {
      if (val === undefined) return;
      setClauses.push(`${col} = $${idx++}`);
      params.push(val);
    };

    add('theme', theme);
    add('llm_provider', llm_provider);
    add('gemini_api_key', gemini_api_key);
    add('claude_api_key', claude_api_key);
    add('openai_api_key', openai_api_key);
    add('gemini_model', gemini_model);
    add('claude_model', claude_model);
    add('openai_model', openai_model);
    add('claude_effort', claude_effort);
    add('grok_api_key', grok_api_key);
    add('grok_model', grok_model);
    if (storage_provider !== undefined) add('storage_provider', storage_provider || null);
    add('storage_bucket', storage_bucket);
    add('storage_region', storage_region);
    if (storage_access_key?.trim()) add('storage_access_key', storage_access_key.trim());
    if (storage_secret_key?.trim()) add('storage_secret_key', storage_secret_key.trim());
    if (storage_azure_connection?.trim()) add('storage_azure_connection', storage_azure_connection.trim());

    if (setClauses.length > 0) {
      params.push(req.user!.id);
      await pool.query(
        `UPDATE users SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
        params
      );
    }

    const { rows } = await pool.query(
      `SELECT u.*, c.name AS company_name, c.storage_provider AS company_storage_provider
       FROM users u LEFT JOIN companies c ON u.company_id = c.id WHERE u.id = $1`,
      [req.user!.id]
    );
    res.json({ user: toClientUser(rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
});

export default router;
