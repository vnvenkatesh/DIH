import express from 'express';
import { hash } from 'bcryptjs';
import pool from '../db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { Response } from 'express';

const router = express.Router();

type ManagerContext =
  | { appAdmin: true }
  | { appAdmin: false; companyId: number; companyName: string };

function getCompanyId(ctx: ManagerContext): number | null {
  if (ctx.appAdmin === true) return null;
  const c = ctx as { appAdmin: false; companyId: number; companyName: string };
  return c.companyId;
}

/**
 * Resolves who can manage users:
 *   - App Admin  (role = 'Admin')         → sees/manages all users
 *   - Company Admin (company_role='admin', company != 'General') → sees/manages own company only
 * Returns null and sends 403 if neither.
 */
async function resolveManager(req: AuthRequest, res: Response): Promise<ManagerContext | null> {
  if (req.user?.role === 'Admin') return { appAdmin: true };
  const { rows } = await pool.query(
    `SELECT u.company_role, u.company_id, c.name AS company_name
     FROM users u LEFT JOIN companies c ON u.company_id = c.id
     WHERE u.id = $1`,
    [req.user!.id]
  );
  const r = rows[0];
  if (r?.company_role === 'admin' && r?.company_name && r.company_name !== 'General') {
    return { appAdmin: false, companyId: r.company_id, companyName: r.company_name };
  }
  res.status(403).json({ error: 'Access requires App Admin or Company Admin role' });
  return null;
}

// ── List users ─────────────────────────────────────────────────────────────
router.get('/', requireAuth as any, async (req: AuthRequest, res) => {
  const ctx = await resolveManager(req, res);
  if (!ctx) return;
  try {
    const baseSelect = `SELECT u.id, u.username, u.role, u.company_id, u.company_role,
                               c.name AS company_name, u.created_at
                        FROM users u LEFT JOIN companies c ON u.company_id = c.id`;
    const { rows } = ctx.appAdmin
      ? await pool.query(`${baseSelect} ORDER BY u.created_at ASC`)
      : await pool.query(`${baseSelect} WHERE u.company_id = $1 ORDER BY u.created_at ASC`, [getCompanyId(ctx)]);
    res.json(rows);
  } catch (err) {
    console.error('[users/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Create user ────────────────────────────────────────────────────────────
router.post('/', requireAuth as any, async (req: AuthRequest, res) => {
  const ctx = await resolveManager(req, res);
  if (!ctx) return;
  try {
    const { username, password, role, company_id } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }
    // Company admins can only create AppUser role in their own company
    const effectiveRole: string = ctx.appAdmin ? (role ?? 'AppUser') : 'AppUser';
    if (!['Admin', 'AppUser'].includes(effectiveRole)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }
    const effectiveCompanyId: number | null = ctx.appAdmin ? (company_id ?? null) : getCompanyId(ctx);

    const passwordHash = await hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, role, company_id, company_role)
       VALUES ($1, $2, $3, $4, 'member')
       RETURNING id, username, role, company_id, company_role, created_at`,
      [username, passwordHash, effectiveRole, effectiveCompanyId]
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

// ── Update user ────────────────────────────────────────────────────────────
router.put('/:id', requireAuth as any, async (req: AuthRequest, res) => {
  const ctx = await resolveManager(req, res);
  if (!ctx) return;
  try {
    // Company admins may only edit users within their own company
    if (!ctx.appAdmin) {
      const { rows: target } = await pool.query('SELECT company_id, role FROM users WHERE id=$1', [req.params.id]);
      if (!target[0] || target[0].company_id !== getCompanyId(ctx)) {
        res.status(403).json({ error: 'You can only manage users in your company' });
        return;
      }
      if (target[0].role === 'Admin') {
        res.status(403).json({ error: 'Cannot modify App Admin users' });
        return;
      }
    }

    const { username, role, password, company_id } = req.body;
    if (!username) { res.status(400).json({ error: 'username is required' }); return; }

    const effectiveRole: string = ctx.appAdmin ? (role ?? 'AppUser') : 'AppUser';
    // App Admins may reassign a user's company; company admins cannot change company
    const effectiveCompanyId: number | null | undefined = ctx.appAdmin
      ? (company_id === '' || company_id === null ? null : company_id != null ? Number(company_id) : undefined)
      : undefined;

    const sets: string[] = ['username=$1', 'role=$2', 'updated_at=NOW()'];
    const params: any[] = [username, effectiveRole];
    let idx = 3;
    if (password) { const passwordHash = await hash(password, 10); sets.push(`password_hash=$${idx++}`); params.push(passwordHash); }
    if (effectiveCompanyId !== undefined) { sets.push(`company_id=$${idx++}`); params.push(effectiveCompanyId); }
    params.push(req.params.id);
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${idx}`, params);
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.role, u.company_id, u.company_role, c.name AS company_name, u.created_at
       FROM users u LEFT JOIN companies c ON u.company_id = c.id WHERE u.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) { res.status(404).json({ error: 'User not found' }); return; }
    res.json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') { res.status(409).json({ error: 'Username already exists' }); return; }
    console.error('[users/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete user ────────────────────────────────────────────────────────────
router.delete('/:id', requireAuth as any, async (req: AuthRequest, res) => {
  const ctx = await resolveManager(req, res);
  if (!ctx) return;
  try {
    if (String(req.user?.id) === req.params.id) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }
    if (!ctx.appAdmin) {
      const { rows: target } = await pool.query('SELECT company_id, role FROM users WHERE id=$1', [req.params.id]);
      if (!target[0] || target[0].company_id !== getCompanyId(ctx)) {
        res.status(403).json({ error: 'You can only delete users in your company' });
        return;
      }
      if (target[0].role === 'Admin') {
        res.status(403).json({ error: 'Cannot delete App Admin users' });
        return;
      }
    }
    const { rowCount } = await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    if (!rowCount) { res.status(404).json({ error: 'User not found' }); return; }
    res.status(204).send();
  } catch (err) {
    console.error('[users/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
