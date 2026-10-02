import express from 'express';
import pool from '../db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

function toClientCompany(row: any) {
  return {
    id: row.id,
    name: row.name,
    storageProvider: row.storage_provider ?? null,
    storageBucket: row.storage_bucket ?? '',
    storageRegion: row.storage_region ?? '',
    hasGeminiKey: Boolean(row.gemini_api_key),
    hasClaudeKey: Boolean(row.claude_api_key),
    hasOpenAiKey: Boolean(row.openai_api_key),
    hasGrokKey: Boolean(row.grok_api_key),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /v1/companies/mine — get the current user's company
router.get('/mine', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT c.* FROM companies c JOIN users u ON u.company_id = c.id WHERE u.id = $1',
      [req.user!.id]
    );
    if (!rows[0]) { res.json({ company: null }); return; }
    res.json({ company: toClientCompany(rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/companies/mine/members — list members (company admin only)
router.get('/mine/members', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const { rows: userRows } = await pool.query('SELECT company_id, company_role FROM users WHERE id = $1', [req.user!.id]);
    const u = userRows[0];
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    if (u.company_role !== 'admin') { res.status(403).json({ error: 'Company admin only' }); return; }

    const { rows } = await pool.query(
      'SELECT id, username, role, company_role, uses_company_keys FROM users WHERE company_id = $1 ORDER BY username',
      [u.company_id]
    );
    res.json({
      members: rows.map(r => ({
        id: r.id,
        username: r.username,
        role: r.role,
        companyRole: r.company_role,
        usesCompanyKeys: r.uses_company_keys,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /v1/companies — create company (Admin role only)
router.post('/', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    if (req.user!.role !== 'Admin') { res.status(403).json({ error: 'Admin only' }); return; }
    const { name } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: 'Company name required' }); return; }

    const { rows } = await pool.query(
      'INSERT INTO companies (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );
    await pool.query(
      'UPDATE users SET company_id = $1, company_role = $2, uses_company_keys = false WHERE id = $3',
      [rows[0].id, 'admin', req.user!.id]
    );
    res.status(201).json({ company: toClientCompany(rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /v1/companies/:id — update company settings (company admin)
router.put('/:id', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const companyId = parseInt(req.params.id);
    const { rows: userRows } = await pool.query('SELECT company_id, company_role FROM users WHERE id = $1', [req.user!.id]);
    const u = userRows[0];
    if (u?.company_id !== companyId || u?.company_role !== 'admin') {
      res.status(403).json({ error: 'Company admin only' }); return;
    }

    const {
      name, storage_provider, storage_bucket, storage_region,
      storage_access_key, storage_secret_key, storage_azure_connection,
      gemini_api_key, claude_api_key, openai_api_key, grok_api_key,
    } = req.body;

    const { rows } = await pool.query(`
      UPDATE companies SET
        name                     = COALESCE($1, name),
        storage_provider         = COALESCE($2, storage_provider),
        storage_bucket           = COALESCE($3, storage_bucket),
        storage_region           = COALESCE($4, storage_region),
        storage_access_key       = COALESCE($5, storage_access_key),
        storage_secret_key       = COALESCE($6, storage_secret_key),
        storage_azure_connection = COALESCE($7, storage_azure_connection),
        gemini_api_key           = COALESCE($8, gemini_api_key),
        claude_api_key           = COALESCE($9, claude_api_key),
        openai_api_key           = COALESCE($10, openai_api_key),
        grok_api_key             = COALESCE($11, grok_api_key),
        updated_at               = NOW()
      WHERE id = $12
      RETURNING *
    `, [
      name ?? null, storage_provider ?? null, storage_bucket ?? null, storage_region ?? null,
      storage_access_key ?? null, storage_secret_key ?? null, storage_azure_connection ?? null,
      gemini_api_key ?? null, claude_api_key ?? null, openai_api_key ?? null, grok_api_key ?? null,
      companyId,
    ]);
    res.json({ company: toClientCompany(rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /v1/companies/:id/members — add user to company
router.post('/:id/members', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const companyId = parseInt(req.params.id);
    const { rows: userRows } = await pool.query('SELECT company_id, company_role FROM users WHERE id = $1', [req.user!.id]);
    const u = userRows[0];
    if (u?.company_id !== companyId || u?.company_role !== 'admin') {
      res.status(403).json({ error: 'Company admin only' }); return;
    }

    const { username, company_role = 'member', uses_company_keys = true } = req.body;
    const { rows: targetRows } = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (!targetRows[0]) { res.status(404).json({ error: 'User not found' }); return; }

    await pool.query(
      'UPDATE users SET company_id = $1, company_role = $2, uses_company_keys = $3 WHERE id = $4',
      [companyId, company_role, uses_company_keys, targetRows[0].id]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/companies/:id/members/:userId — update member role / uses_company_keys
router.patch('/:id/members/:userId', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const companyId = parseInt(req.params.id);
    const targetUserId = parseInt(req.params.userId);
    const { rows: userRows } = await pool.query('SELECT company_id, company_role FROM users WHERE id = $1', [req.user!.id]);
    const u = userRows[0];
    if (u?.company_id !== companyId || u?.company_role !== 'admin') {
      res.status(403).json({ error: 'Company admin only' }); return;
    }

    const { company_role, uses_company_keys } = req.body;
    await pool.query(
      `UPDATE users SET
         company_role      = COALESCE($1, company_role),
         uses_company_keys = COALESCE($2, uses_company_keys)
       WHERE id = $3 AND company_id = $4`,
      [company_role ?? null, uses_company_keys ?? null, targetUserId, companyId]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/companies/:id/members/:userId — remove user from company
router.delete('/:id/members/:userId', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const companyId = parseInt(req.params.id);
    const targetUserId = parseInt(req.params.userId);
    const { rows: userRows } = await pool.query('SELECT company_id, company_role FROM users WHERE id = $1', [req.user!.id]);
    const u = userRows[0];
    if (u?.company_id !== companyId || u?.company_role !== 'admin') {
      res.status(403).json({ error: 'Company admin only' }); return;
    }
    if (targetUserId === req.user!.id) { res.status(400).json({ error: 'Cannot remove yourself' }); return; }

    await pool.query(
      'UPDATE users SET company_id = NULL, company_role = $1, uses_company_keys = false WHERE id = $2',
      ['member', targetUserId]
    );
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
