import express from 'express';
import { compare } from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

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
      console.log('[auth/login] user not found:', username);
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    console.log('[auth/login] comparing password...');
    const valid = await compare(password, user.password_hash);
    if (!valid) {
      console.log('[auth/login] password mismatch for:', username);
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    console.log('[auth/login] signing token for:', username, user.role);
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    console.log('[auth/login] success:', username);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error('[auth/login] error:', message);
    res.status(500).json({ error: `Login error: ${message}` });
  }
});

router.get('/me', requireAuth as any, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

export default router;
