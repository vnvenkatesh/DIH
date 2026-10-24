import { Request, Response, NextFunction } from 'express';
import { compare } from 'bcryptjs';
import pool from '../db.js';

declare global {
  namespace Express {
    interface Request {
      apiKeyUserId?: number;
    }
  }
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'API key required' });

  const prefix = token.slice(0, 12);
  const { rows } = await pool.query(
    `SELECT id, user_id, key_hash FROM pdf_api_keys WHERE key_prefix = $1`,
    [prefix]
  );
  if (!rows.length) return res.status(401).json({ error: 'Invalid API key' });

  const row = rows[0];
  const valid = await compare(token, row.key_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid API key' });

  await pool.query(`UPDATE pdf_api_keys SET last_used_at = NOW() WHERE id = $1`, [row.id]);
  req.apiKeyUserId = row.user_id;
  next();
}
