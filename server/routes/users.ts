import express from 'express';
import { hash } from 'bcryptjs';
import pool from '../db.js';
import { requireAdmin, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

router.get('/', requireAdmin as any, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, role, created_at FROM users ORDER BY created_at ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('[users/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAdmin as any, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || !['Admin', 'AppUser'].includes(role)) {
      res.status(400).json({ error: 'username, password, and valid role (Admin|AppUser) required' });
      return;
    }
    const passwordHash = await hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
      [username, passwordHash, role]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }
    console.error('[users/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', requireAdmin as any, async (req, res) => {
  try {
    const { username, role, password } = req.body;
    if (!username || !['Admin', 'AppUser'].includes(role)) {
      res.status(400).json({ error: 'username and valid role (Admin|AppUser) required' });
      return;
    }
    if (password) {
      const passwordHash = await hash(password, 10);
      await pool.query(
        'UPDATE users SET username=$1, role=$2, password_hash=$3, updated_at=NOW() WHERE id=$4',
        [username, role, passwordHash, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE users SET username=$1, role=$2, updated_at=NOW() WHERE id=$3',
        [username, role, req.params.id]
      );
    }
    const { rows } = await pool.query(
      'SELECT id, username, role, created_at FROM users WHERE id=$1',
      [req.params.id]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }
    console.error('[users/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', requireAdmin as any, async (req: AuthRequest, res) => {
  try {
    if (String(req.user?.id) === req.params.id) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }
    const { rowCount } = await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    if (!rowCount) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error('[users/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
