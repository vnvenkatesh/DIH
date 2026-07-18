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
  };
}

router.post('/login', async (req, res) => {
  try {
    console.log('[auth/login] attempt:', req.body?.username);

    const { username, password } = req.body ?? {};
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
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    const user = rows[0];
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
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
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user!.id]);
    if (!rows[0]) { res.status(404).json({ error: 'User not found' }); return; }
    res.json({ user: toClientUser(rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
});

router.put('/preferences', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const { theme, llm_provider, gemini_api_key, claude_api_key, openai_api_key, gemini_model, claude_model, openai_model } = req.body ?? {};
    await pool.query(
      `UPDATE users
         SET theme          = COALESCE($1, theme),
             llm_provider   = COALESCE($2, llm_provider),
             gemini_api_key = COALESCE($3, gemini_api_key),
             claude_api_key = COALESCE($4, claude_api_key),
             openai_api_key = COALESCE($5, openai_api_key),
             gemini_model   = COALESCE($6, gemini_model),
             claude_model   = COALESCE($7, claude_model),
             openai_model   = COALESCE($8, openai_model),
             updated_at     = NOW()
       WHERE id = $9`,
      [theme ?? null, llm_provider ?? null, gemini_api_key ?? null, claude_api_key ?? null, openai_api_key ?? null, gemini_model ?? null, claude_model ?? null, openai_model ?? null, req.user!.id]
    );
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user!.id]);
    res.json({ user: toClientUser(rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
});

export default router;
