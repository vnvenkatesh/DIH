import express from 'express';
import pool from '../db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { getPresignedUploadUrl, getSignedUrl, deleteFile } from '../lib/cloudStorage.js';

const router = express.Router();

async function getUserCompany(userId: number) {
  const { rows } = await pool.query('SELECT company_id, company_role FROM users WHERE id = $1', [userId]);
  return rows[0];
}

async function assertProjectAccess(projectId: number, companyId: number, userId: number) {
  const { rows } = await pool.query(`
    SELECT p.id FROM projects p
    WHERE p.id = $1 AND p.company_id = $2
      AND (
        p.visibility = 'shared'
        OR p.created_by = $3
        OR EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = p.id AND pm.user_id = $3
        )
      )
  `, [projectId, companyId, userId]);
  if (!rows[0]) throw Object.assign(new Error('Project not found'), { status: 404 });
}

function toProjectRow(r: any) {
  return {
    id: r.id, name: r.name, description: r.description,
    companyId: r.company_id, createdBy: r.created_by,
    status: r.status, visibility: r.visibility ?? 'shared',
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// GET /v1/projects
router.get('/', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.json({ projects: [] }); return; }

    const { rows } = await pool.query(`
      SELECT p.*, COUNT(pf.id)::int AS file_count
      FROM projects p
      LEFT JOIN project_files pf ON pf.project_id = p.id AND pf.archived = false
      WHERE p.company_id = $1
        AND (
          p.visibility = 'shared'
          OR p.created_by = $2
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = $2
          )
        )
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `, [u.company_id, req.user!.id]);

    res.json({
      projects: rows.map(r => ({
        ...toProjectRow(r),
        fileCount: r.file_count,
      })),
    });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// POST /v1/projects
router.post('/', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(400).json({ error: 'Must be in a company to create projects' }); return; }

    const { name, description = '', visibility = 'shared' } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: 'Project name required' }); return; }
    if (!['private', 'shared'].includes(visibility)) { res.status(400).json({ error: 'visibility must be private or shared' }); return; }

    const { rows } = await pool.query(
      'INSERT INTO projects (name, description, company_id, created_by, visibility) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name.trim(), description, u.company_id, req.user!.id, visibility]
    );
    const r = rows[0];
    res.status(201).json({
      project: { ...toProjectRow(r), fileCount: 0 },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/projects/:id
router.get('/:id', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    await assertProjectAccess(parseInt(req.params.id), u.company_id, req.user!.id);

    const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    const r = rows[0];
    res.json({ project: toProjectRow(r) });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// PUT /v1/projects/:id
router.put('/:id', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { name, description, status, visibility } = req.body;
    if (visibility !== undefined && !['private', 'shared'].includes(visibility)) {
      res.status(400).json({ error: 'visibility must be private or shared' }); return;
    }
    const { rows } = await pool.query(`
      UPDATE projects SET
        name        = COALESCE($1, name),
        description = COALESCE($2, description),
        status      = COALESCE($3, status),
        visibility  = COALESCE($4, visibility),
        updated_at  = NOW()
      WHERE id = $5 RETURNING *
    `, [name ?? null, description ?? null, status ?? null, visibility ?? null, projectId]);
    const r = rows[0];
    res.json({ project: toProjectRow(r) });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// DELETE /v1/projects/:id
router.delete('/:id', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { rows: files } = await pool.query('SELECT storage_key FROM project_files WHERE project_id = $1', [projectId]);
    for (const f of files) {
      try { await deleteFile(u.company_id, f.storage_key, req.user!.id); } catch { /* best effort */ }
    }

    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    res.status(204).end();
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// POST /v1/projects/:id/files/presign — get presigned upload URL (no file bytes through server)
router.post('/:id/files/presign', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { fileName, mimeType } = req.body;
    if (!fileName || !mimeType) { res.status(400).json({ error: 'fileName and mimeType required' }); return; }

    const result = await getPresignedUploadUrl(u.company_id, projectId, fileName, mimeType, req.user!.id);
    res.json(result);
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// POST /v1/projects/:id/files/confirm — record a completed direct upload in DB
router.post('/:id/files/confirm', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { storageKey, fileName, mimeType, size = 0, role = 'template' } = req.body;
    if (!storageKey || !fileName) { res.status(400).json({ error: 'storageKey and fileName required' }); return; }

    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const fileType = (() => {
      if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
      if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') return 'docx';
      if (ext === 'xsd') return 'xsd';
      if (ext === 'csv') return 'csv';
      if (ext === 'xml' || ext === 'gd') return ext;
      return 'other';
    })();

    const { rows } = await pool.query(
      'INSERT INTO project_files (project_id, uploaded_by, name, file_type, role, storage_key, size_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [projectId, req.user!.id, fileName, fileType, role, storageKey, size]
    );
    await pool.query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [projectId]);
    const r = rows[0];
    res.status(201).json({ file: { id: r.id, name: r.name, fileType: r.file_type, role: r.role, sizeBytes: r.size_bytes, archived: r.archived, createdAt: r.created_at } });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// GET /v1/projects/:id/files
router.get('/:id/files', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { rows } = await pool.query(
      `SELECT * FROM project_files WHERE project_id = $1 ORDER BY created_at ASC`,
      [projectId]
    );

    const filesWithUrls = await Promise.all(rows.map(async (r) => {
      let signedUrl: string | undefined;
      try { signedUrl = await getSignedUrl(u.company_id, r.storage_key, 3600, req.user!.id); } catch { /* no storage */ }
      return {
        id: r.id, projectId: r.project_id, uploadedBy: r.uploaded_by,
        name: r.name, fileType: r.file_type, role: r.role,
        storageKey: r.storage_key, signedUrl,
        sizeBytes: r.size_bytes, archived: r.archived,
        lifecycleStatus: r.lifecycle_status ?? 'original', createdAt: r.created_at,
      };
    }));

    res.json({ files: filesWithUrls });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// PATCH /v1/projects/:id/files/:fileId — update role or archived status
router.patch('/:id/files/:fileId', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { role, archived, lifecycle_status } = req.body;
    const allowed = ['original', 'rationalized', 'variation', 'finalized'];
    const setClauses: string[] = [
      `role = COALESCE($1, role)`,
      `archived = COALESCE($2, archived)`,
    ];
    const params: any[] = [role ?? null, archived ?? null];
    if (lifecycle_status && allowed.includes(lifecycle_status)) {
      setClauses.push(`lifecycle_status = $${params.length + 1}`);
      params.push(lifecycle_status);
    }
    params.push(req.params.fileId, projectId);
    const { rows } = await pool.query(
      `UPDATE project_files SET ${setClauses.join(', ')} WHERE id = $${params.length - 1} AND project_id = $${params.length} RETURNING *`,
      params
    );
    if (!rows[0]) { res.status(404).json({ error: 'File not found' }); return; }
    const r = rows[0];
    res.json({ file: { id: r.id, name: r.name, fileType: r.file_type, role: r.role, archived: r.archived, lifecycleStatus: r.lifecycle_status ?? 'original' } });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// DELETE /v1/projects/:id/files/:fileId
router.delete('/:id/files/:fileId', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { rows } = await pool.query('SELECT * FROM project_files WHERE id = $1 AND project_id = $2', [req.params.fileId, projectId]);
    if (!rows[0]) { res.status(404).json({ error: 'File not found' }); return; }

    try { await deleteFile(u.company_id, rows[0].storage_key, req.user!.id); } catch { /* best effort */ }
    await pool.query('DELETE FROM project_files WHERE id = $1', [req.params.fileId]);
    res.status(204).end();
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// POST /v1/projects/:id/results — save accelerator result
router.post('/:id/results', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { accelerator, result_data, provider = null, model = null } = req.body;
    if (!accelerator || !result_data) { res.status(400).json({ error: 'accelerator and result_data required' }); return; }

    const { rows } = await pool.query(
      'INSERT INTO project_results (project_id, accelerator, result_data, provider, model, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [projectId, accelerator, JSON.stringify(result_data), provider, model, req.user!.id]
    );
    await pool.query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [projectId]);
    const r = rows[0];
    res.status(201).json({ result: { id: r.id, projectId: r.project_id, accelerator: r.accelerator, resultData: r.result_data, provider: r.provider, model: r.model, createdBy: r.created_by, createdAt: r.created_at } });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// GET /v1/projects/:id/results
router.get('/:id/results', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { rows } = await pool.query(
      'SELECT * FROM project_results WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    res.json({ results: rows.map(r => ({ id: r.id, projectId: r.project_id, accelerator: r.accelerator, resultData: r.result_data, provider: r.provider, model: r.model, createdBy: r.created_by, createdAt: r.created_at })) });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// GET /v1/projects/:id/chat
router.get('/:id/chat', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { rows } = await pool.query(
      'SELECT * FROM project_messages WHERE project_id = $1 ORDER BY created_at ASC LIMIT 100',
      [projectId]
    );
    res.json({ messages: rows.map(r => ({ id: r.id, projectId: r.project_id, userId: r.user_id, role: r.role, content: r.content, createdAt: r.created_at })) });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// POST /v1/projects/:id/chat
router.post('/:id/chat', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { content } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: 'content required' }); return; }

    await pool.query(
      'INSERT INTO project_messages (project_id, user_id, role, content) VALUES ($1,$2,$3,$4)',
      [projectId, req.user!.id, 'user', content]
    );

    const { rows: projRows } = await pool.query('SELECT name, description FROM projects WHERE id = $1', [projectId]);
    const { rows: fileRows } = await pool.query('SELECT name, file_type, role FROM project_files WHERE project_id = $1 AND archived = false', [projectId]);
    const { rows: resultRows } = await pool.query(
      'SELECT accelerator, result_data FROM project_results WHERE project_id = $1 ORDER BY created_at DESC LIMIT 5',
      [projectId]
    );

    const proj = projRows[0];
    const fileList = fileRows.map(f => `- ${f.name} (${f.file_type}, role: ${f.role})`).join('\n');
    const resultSummary = resultRows.map(r => `[${r.accelerator}]: ${JSON.stringify(r.result_data).slice(0, 500)}`).join('\n');
    const systemCtx = `Project: "${proj?.name ?? 'Unknown'}"\n${proj?.description ?? ''}\n\nFiles:\n${fileList || 'None'}\n\nRecent results:\n${resultSummary || 'None'}`;

    const { rows: keyRows } = await pool.query(`
      SELECT u.gemini_api_key, u.uses_company_keys, c.gemini_api_key AS company_gemini_key
      FROM users u LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.id = $1
    `, [req.user!.id]);
    const kr = keyRows[0];
    const apiKey = kr?.gemini_api_key || (kr?.uses_company_keys ? kr?.company_gemini_key : '') || process.env.GEMINI_API_KEY || process.env.API_KEY;

    let assistantReply = 'No LLM API key configured. Please add a Gemini key in Settings.';
    if (apiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemCtx }] },
          contents: [{ role: 'user', parts: [{ text: content }] }],
        }),
      });
      if (upstream.ok) {
        const data = await upstream.json() as any;
        assistantReply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? assistantReply;
      }
    }

    await pool.query(
      'INSERT INTO project_messages (project_id, user_id, role, content) VALUES ($1,$2,$3,$4)',
      [projectId, req.user!.id, 'assistant', assistantReply]
    );

    res.json({ reply: assistantReply });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// DELETE /v1/projects/:id/chat — clear all chat history for a project
router.delete('/:id/chat', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    const projectId = parseInt(req.params.id, 10);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);
    await pool.query('DELETE FROM project_messages WHERE project_id = $1', [projectId]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// ── Project members ───────────────────────────────────────────────────────

// GET /v1/projects/:id/members
router.get('/:id/members', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { rows } = await pool.query(`
      SELECT pm.user_id, u.username, pm.invited_by, pm.created_at
      FROM project_members pm
      JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $1
      ORDER BY pm.created_at ASC
    `, [projectId]);

    res.json({
      members: rows.map(r => ({
        userId: r.user_id, username: r.username,
        invitedBy: r.invited_by, createdAt: r.created_at,
      })),
    });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// POST /v1/projects/:id/members
router.post('/:id/members', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);

    // Only the project creator can invite
    const { rows: projRows } = await pool.query(
      'SELECT created_by FROM projects WHERE id = $1 AND company_id = $2',
      [projectId, u.company_id]
    );
    if (!projRows[0]) { res.status(404).json({ error: 'Project not found' }); return; }
    if (projRows[0].created_by !== req.user!.id) {
      res.status(403).json({ error: 'Only the project creator can invite members' }); return;
    }

    const { username } = req.body;
    if (!username?.trim()) { res.status(400).json({ error: 'username required' }); return; }

    // Look up target user in same company
    const { rows: targetRows } = await pool.query(
      'SELECT id, username FROM users WHERE LOWER(username) = LOWER($1) AND company_id = $2',
      [username.trim(), u.company_id]
    );
    if (!targetRows[0]) { res.status(404).json({ error: 'User not found in your company' }); return; }
    if (targetRows[0].id === req.user!.id) {
      res.status(400).json({ error: 'You are already the project owner' }); return;
    }

    await pool.query(
      'INSERT INTO project_members (project_id, user_id, invited_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [projectId, targetRows[0].id, req.user!.id]
    );

    res.status(201).json({
      member: {
        userId: targetRows[0].id, username: targetRows[0].username,
        invitedBy: req.user!.id, createdAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// DELETE /v1/projects/:id/members/:userId
router.delete('/:id/members/:userId', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);

    const { rows: projRows } = await pool.query(
      'SELECT created_by FROM projects WHERE id = $1 AND company_id = $2',
      [projectId, u.company_id]
    );
    if (!projRows[0]) { res.status(404).json({ error: 'Project not found' }); return; }
    if (projRows[0].created_by !== req.user!.id) {
      res.status(403).json({ error: 'Only the project creator can remove members' }); return;
    }

    await pool.query(
      'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2',
      [projectId, parseInt(req.params.userId)]
    );
    res.status(204).end();
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// ── Final Inventory ───────────────────────────────────────────────────────

// GET /v1/projects/:id/inventory
router.get('/:id/inventory', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { rows } = await pool.query(`
      SELECT fi.*, pf.name AS file_name, pf.file_type
      FROM final_inventory fi
      JOIN project_files pf ON pf.id = fi.file_id
      WHERE fi.project_id = $1
      ORDER BY fi.created_at ASC
    `, [projectId]);

    res.json({ inventory: rows.map(r => ({
      id: r.id, projectId: r.project_id, fileId: r.file_id,
      fileName: r.file_name, fileType: r.file_type,
      groupId: r.group_id, variantCount: r.variant_count,
      variations: r.variations, businessDomain: r.business_domain,
      status: r.status, notes: r.notes,
      createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
    })) });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// POST /v1/projects/:id/inventory
router.post('/:id/inventory', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { fileId, groupId = null, variantCount = 1, variations = [], businessDomain = '' } = req.body;
    if (!fileId || typeof fileId !== 'number') { res.status(400).json({ error: 'fileId (number) required' }); return; }

    // Upsert: if already in inventory just return existing row (idempotent)
    const { rows } = await pool.query(`
      INSERT INTO final_inventory (project_id, file_id, group_id, variant_count, variations, business_domain, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (project_id, file_id) DO UPDATE
        SET group_id = EXCLUDED.group_id,
            variant_count = EXCLUDED.variant_count,
            variations = EXCLUDED.variations,
            updated_at = NOW()
      RETURNING *
    `, [projectId, fileId, groupId, variantCount, JSON.stringify(variations), businessDomain, req.user!.id]);

    // Always ensure lifecycle is finalized (handles backfill for pre-existing rows)
    await pool.query(
      `UPDATE project_files SET lifecycle_status = 'finalized' WHERE id = $1 AND project_id = $2`,
      [fileId, projectId]
    );

    const { rows: pf } = await pool.query('SELECT name, file_type FROM project_files WHERE id = $1', [fileId]);
    const r = rows[0];
    res.status(201).json({ item: {
      id: r.id, projectId: r.project_id, fileId: r.file_id,
      fileName: pf[0]?.name, fileType: pf[0]?.file_type,
      groupId: r.group_id, variantCount: r.variant_count,
      variations: r.variations, businessDomain: r.business_domain,
      status: r.status, notes: r.notes,
      createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
    } });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// PATCH /v1/projects/:id/inventory/:itemId
router.patch('/:id/inventory/:itemId', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { status, businessDomain, notes, variations } = req.body;
    const setClauses: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (status !== undefined)        { setClauses.push(`status = $${idx++}`);          params.push(status); }
    if (businessDomain !== undefined) { setClauses.push(`business_domain = $${idx++}`); params.push(businessDomain); }
    if (notes !== undefined)         { setClauses.push(`notes = $${idx++}`);            params.push(notes); }
    if (variations !== undefined)    { setClauses.push(`variations = $${idx++}`);       params.push(JSON.stringify(variations)); }
    setClauses.push(`updated_at = NOW()`);

    params.push(req.params.itemId, projectId);
    const { rows } = await pool.query(
      `UPDATE final_inventory SET ${setClauses.join(', ')} WHERE id = $${idx++} AND project_id = $${idx++} RETURNING *`,
      params
    );
    if (!rows[0]) { res.status(404).json({ error: 'Inventory item not found' }); return; }
    const r = rows[0];
    res.json({ item: {
      id: r.id, projectId: r.project_id, fileId: r.file_id,
      groupId: r.group_id, variantCount: r.variant_count,
      variations: r.variations, businessDomain: r.business_domain,
      status: r.status, notes: r.notes,
      createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
    } });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// DELETE /v1/projects/:id/inventory/:itemId
router.delete('/:id/inventory/:itemId', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    // Capture file_id before deleting so we can restore lifecycle_status
    const { rows: invRows } = await pool.query(
      'SELECT file_id FROM final_inventory WHERE id = $1 AND project_id = $2',
      [req.params.itemId, projectId]
    );
    await pool.query('DELETE FROM final_inventory WHERE id = $1 AND project_id = $2', [req.params.itemId, projectId]);
    if (invRows[0]?.file_id) {
      await pool.query(
        `UPDATE project_files SET lifecycle_status = 'rationalized' WHERE id = $1`,
        [invRows[0].file_id]
      );
    }
    res.status(204).end();
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// ── Project Documents ──────────────────────────────────────────────────────

// GET /v1/projects/:id/documents
router.get('/:id/documents', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { rows } = await pool.query(
      'SELECT * FROM project_documents WHERE project_id = $1 ORDER BY doc_type',
      [projectId]
    );
    res.json({ documents: rows.map(r => ({ id: r.id, projectId: r.project_id, docType: r.doc_type, content: r.content, version: r.version, createdBy: r.created_by, updatedBy: r.updated_by, createdAt: r.created_at, updatedAt: r.updated_at })) });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// GET /v1/projects/:id/documents/:docType
router.get('/:id/documents/:docType', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { rows } = await pool.query(
      'SELECT * FROM project_documents WHERE project_id = $1 AND doc_type = $2',
      [projectId, req.params.docType]
    );
    if (!rows[0]) { res.json({ document: null }); return; }
    const r = rows[0];
    res.json({ document: { id: r.id, projectId: r.project_id, docType: r.doc_type, content: r.content, version: r.version, createdBy: r.created_by, updatedBy: r.updated_by, createdAt: r.created_at, updatedAt: r.updated_at } });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// PUT /v1/projects/:id/documents/:docType
router.put('/:id/documents/:docType', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const docType = req.params.docType;
    if (!['brd', 'test_cases', 'field_mapping'].includes(docType)) { res.status(400).json({ error: 'docType must be brd, test_cases, or field_mapping' }); return; }
    const { content } = req.body;
    if (content === undefined || content === null) { res.status(400).json({ error: 'content required' }); return; }

    const { rows } = await pool.query(`
      INSERT INTO project_documents (project_id, doc_type, content, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $4)
      ON CONFLICT (project_id, doc_type) DO UPDATE
        SET content = $3, version = project_documents.version + 1, updated_by = $4, updated_at = NOW()
      RETURNING *
    `, [projectId, docType, JSON.stringify(content), req.user!.id]);

    const r = rows[0];
    res.json({ document: { id: r.id, projectId: r.project_id, docType: r.doc_type, content: r.content, version: r.version, createdBy: r.created_by, updatedBy: r.updated_by, createdAt: r.created_at, updatedAt: r.updated_at } });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// ── BRD Generation ────────────────────────────────────────────────────────

async function getGeminiKeyForUser(userId: number): Promise<string> {
  const { rows } = await pool.query(`
    SELECT u.gemini_api_key, u.uses_company_keys, c.gemini_api_key AS company_gemini_key
    FROM users u LEFT JOIN companies c ON u.company_id = c.id WHERE u.id = $1
  `, [userId]);
  const kr = rows[0];
  return kr?.gemini_api_key || (kr?.uses_company_keys ? kr?.company_gemini_key : '') || process.env.GEMINI_API_KEY || process.env.API_KEY || '';
}

async function extractTextFromBuffer(buffer: Buffer, fileName: string): Promise<string> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  try {
    if (ext === 'pdf') {
      const pdfParse = (await import('pdf-parse')).default;
      const result = await pdfParse(buffer);
      return result.text ?? '';
    }
    if (ext === 'docx') {
      const mammoth = (await import('mammoth')).default;
      const result = await mammoth.extractRawText({ buffer });
      return result.value ?? '';
    }
  } catch { /* ignore extraction errors */ }
  return '';
}

// POST /v1/projects/:id/documents/brd/generate
router.post('/:id/documents/brd/generate', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { rows: invRows } = await pool.query(`
      SELECT fi.*, pf.name, pf.file_type, pf.storage_key
      FROM final_inventory fi JOIN project_files pf ON pf.id = fi.file_id
      WHERE fi.project_id = $1
    `, [projectId]);

    if (!invRows.length) { res.status(400).json({ error: 'No templates in Final Inventory. Add templates first.' }); return; }

    const apiKey = await getGeminiKeyForUser(req.user!.id);
    if (!apiKey) { res.status(400).json({ error: 'No Gemini API key configured. Add one in Settings.' }); return; }

    // Extract text from each file
    const templateSections: string[] = [];
    for (const item of invRows) {
      let text = '';
      try {
        const signedUrl = await getSignedUrl(u.company_id, item.storage_key, 3600, req.user!.id);
        const resp = await fetch(signedUrl);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          text = await extractTextFromBuffer(buf, item.name);
        }
      } catch { /* skip on error */ }
      const variations = Array.isArray(item.variations) && item.variations.length
        ? JSON.stringify(item.variations)
        : 'None documented';
      templateSections.push(
        `Template: ${item.name}\nBusiness Domain: ${item.business_domain || 'Unspecified'}\nGroup: ${item.group_id ?? 'N/A'}\nVariants: ${item.variant_count}\nVariations: ${variations}\nContent:\n${text.slice(0, 3000)}`
      );
    }

    const prompt = `You are a senior business analyst creating a Business Requirements Document for a CCM implementation project.
The project has ${invRows.length} template(s) in its final implementation inventory.

${templateSections.join('\n\n---\n\n')}

Extract structured business rules from these templates. Then compile them into a BRD.

Return ONLY valid JSON matching this schema exactly:
{
  "title": "Business Requirements Document",
  "version": "1.0",
  "sections": {
    "executiveSummary": "string",
    "scope": "string",
    "templatesOverview": [{"name": "string", "domain": "string", "variants": 0, "purpose": "string"}],
    "businessRules": [
      {
        "templateName": "string",
        "rules": [
          {
            "ruleName": "string",
            "ruleType": "Validation|Conditional|Calculation|Presentation",
            "condition": "string",
            "action": "string",
            "priority": "High|Medium|Low"
          }
        ]
      }
    ],
    "commonRequirements": "string",
    "implementationNotes": "string",
    "assumptions": "string"
  }
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    if (!upstream.ok) {
      const errData = await upstream.json().catch(() => ({})) as any;
      res.status(502).json({ error: `Gemini error: ${errData?.error?.message ?? upstream.statusText}` }); return;
    }

    const data = await upstream.json() as any;
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    let content: any;
    try { content = JSON.parse(rawText); } catch { content = { title: 'BRD', raw: rawText }; }

    const { rows: savedRows } = await pool.query(`
      INSERT INTO project_documents (project_id, doc_type, content, created_by, updated_by)
      VALUES ($1, 'brd', $2, $3, $3)
      ON CONFLICT (project_id, doc_type) DO UPDATE
        SET content = $2, version = project_documents.version + 1, updated_by = $3, updated_at = NOW()
      RETURNING *
    `, [projectId, JSON.stringify(content), req.user!.id]);

    const r = savedRows[0];
    res.json({ document: { id: r.id, projectId: r.project_id, docType: r.doc_type, content: r.content, version: r.version, createdBy: r.created_by, updatedBy: r.updated_by, createdAt: r.created_at, updatedAt: r.updated_at } });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// POST /v1/projects/:id/documents/test-cases/generate
router.post('/:id/documents/test-cases/generate', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { rows: invRows } = await pool.query(`
      SELECT fi.*, pf.name, pf.file_type, pf.storage_key
      FROM final_inventory fi JOIN project_files pf ON pf.id = fi.file_id
      WHERE fi.project_id = $1
    `, [projectId]);

    if (!invRows.length) { res.status(400).json({ error: 'No templates in Final Inventory. Add templates first.' }); return; }

    const apiKey = await getGeminiKeyForUser(req.user!.id);
    if (!apiKey) { res.status(400).json({ error: 'No Gemini API key configured. Add one in Settings.' }); return; }

    const templateSections: string[] = [];
    for (const item of invRows) {
      let text = '';
      try {
        const signedUrl = await getSignedUrl(u.company_id, item.storage_key, 3600, req.user!.id);
        const resp = await fetch(signedUrl);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          text = await extractTextFromBuffer(buf, item.name);
        }
      } catch { /* skip */ }
      const variations = Array.isArray(item.variations) && item.variations.length
        ? JSON.stringify(item.variations)
        : 'None documented';
      templateSections.push(
        `Template: ${item.name}\nDomain: ${item.business_domain || 'Unspecified'}\nVariations: ${variations}\nContent:\n${text.slice(0, 2500)}`
      );
    }

    // Check if BRD already has businessRules to seed test cases from
    const { rows: brdRows } = await pool.query(
      `SELECT content FROM project_documents WHERE project_id = $1 AND doc_type = 'brd' LIMIT 1`,
      [projectId]
    );
    const brdBusinessRules = brdRows[0]?.content?.sections?.businessRules;
    const brdRulesSection = brdBusinessRules?.length
      ? `\n\nExisting Business Rules from BRD:\n${JSON.stringify(brdBusinessRules, null, 2)}\n\nUse these business rules as the primary source for generating test cases.\n`
      : '';

    const prompt = `Generate a comprehensive Test Case Tracker for a CCM implementation project with ${invRows.length} template(s).
${brdRulesSection}
For each template, generate test cases covering all these categories:
- Happy Path: standard valid input scenarios
- Mandatory: missing required field scenarios
- Boundary: min/max/edge values for numeric and date fields
- Conditional: if/then business rule scenarios
- Format: invalid format inputs
- Calculation: computed field and formula validation

Templates:
${templateSections.join('\n\n---\n\n')}

Return ONLY valid JSON matching this schema exactly:
{
  "title": "string",
  "version": "string",
  "templates": [
    {
      "templateName": "string",
      "testCases": [
        {
          "id": "string",
          "category": "Happy Path|Mandatory|Boundary|Conditional|Format|Calculation",
          "description": "string",
          "inputData": "string",
          "expectedResult": "string",
          "priority": "High|Medium|Low",
          "preconditions": "string",
          "testSteps": "string"
        }
      ]
    }
  ]
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    if (!upstream.ok) {
      const errData = await upstream.json().catch(() => ({})) as any;
      res.status(502).json({ error: `Gemini error: ${errData?.error?.message ?? upstream.statusText}` }); return;
    }

    const data = await upstream.json() as any;
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    let content: any;
    try { content = JSON.parse(rawText); } catch { content = { title: 'Test Cases', raw: rawText }; }

    const { rows: savedRows } = await pool.query(`
      INSERT INTO project_documents (project_id, doc_type, content, created_by, updated_by)
      VALUES ($1, 'test_cases', $2, $3, $3)
      ON CONFLICT (project_id, doc_type) DO UPDATE
        SET content = $2, version = project_documents.version + 1, updated_by = $3, updated_at = NOW()
      RETURNING *
    `, [projectId, JSON.stringify(content), req.user!.id]);

    const r = savedRows[0];
    res.json({ document: { id: r.id, projectId: r.project_id, docType: r.doc_type, content: r.content, version: r.version, createdBy: r.created_by, updatedBy: r.updated_by, createdAt: r.created_at, updatedAt: r.updated_at } });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// POST /v1/projects/:id/documents/field-mapping/generate
router.post('/:id/documents/field-mapping/generate', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { rows: invRows } = await pool.query(`
      SELECT fi.*, pf.name, pf.file_type, pf.storage_key
      FROM final_inventory fi JOIN project_files pf ON pf.id = fi.file_id
      WHERE fi.project_id = $1
    `, [projectId]);

    if (!invRows.length) { res.status(400).json({ error: 'No templates in Final Inventory. Add templates first.' }); return; }

    const apiKey = await getGeminiKeyForUser(req.user!.id);
    if (!apiKey) { res.status(400).json({ error: 'No Gemini API key configured. Add one in Settings.' }); return; }

    const templateSections: string[] = [];
    for (const item of invRows) {
      let text = '';
      try {
        const signedUrl = await getSignedUrl(u.company_id, item.storage_key, 3600, req.user!.id);
        const resp = await fetch(signedUrl);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          text = await extractTextFromBuffer(buf, item.name);
        }
      } catch { /* skip */ }
      templateSections.push(
        `Template: ${item.name}\nDomain: ${item.business_domain || 'Unspecified'}\nContent:\n${text.slice(0, 2500)}`
      );
    }

    const prompt = `You are a data mapping specialist analyzing CCM templates to identify all unique variable fields.
The project has ${invRows.length} template(s) in its final inventory.

${templateSections.join('\n\n---\n\n')}

Extract ALL unique data fields/variables across these templates. For each field:
- Identify its data type (text, date, currency, number, boolean, address, list)
- List which templates use it
- Note any conditional logic or business rules
- Provide a sample/example value
- Suggest an XSD XPath if inferable from the field name and context

Return ONLY valid JSON matching this schema exactly:
{
  "summary": "string (overview of the field mapping analysis)",
  "totalFields": 0,
  "fields": [
    {
      "fieldName": "string (technical identifier, camelCase)",
      "displayName": "string (human-readable label)",
      "dataType": "text|date|currency|number|boolean|address|list",
      "templates": ["string"],
      "sampleValue": "string",
      "isConditional": false,
      "conditionalLogic": "string (empty if not conditional)",
      "xsdPath": "string (suggested XPath or empty)"
    }
  ]
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    if (!upstream.ok) {
      const errData = await upstream.json().catch(() => ({})) as any;
      res.status(502).json({ error: `Gemini error: ${errData?.error?.message ?? upstream.statusText}` }); return;
    }

    const data = await upstream.json() as any;
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    let content: any;
    try { content = JSON.parse(rawText); } catch { content = { summary: 'Field mapping analysis', fields: [], raw: rawText }; }

    const { rows: savedRows } = await pool.query(`
      INSERT INTO project_documents (project_id, doc_type, content, created_by, updated_by)
      VALUES ($1, 'field_mapping', $2, $3, $3)
      ON CONFLICT (project_id, doc_type) DO UPDATE
        SET content = $2, version = project_documents.version + 1, updated_by = $3, updated_at = NOW()
      RETURNING *
    `, [projectId, JSON.stringify(content), req.user!.id]);

    const r = savedRows[0];
    res.json({ document: { id: r.id, projectId: r.project_id, docType: r.doc_type, content: r.content, version: r.version, createdBy: r.created_by, updatedBy: r.updated_by, createdAt: r.created_at, updatedAt: r.updated_at } });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// ── Rationalise (server-side: exact or semantic clustering) ───────────────────

// POST /v1/projects/:id/rationalise
router.post('/:id/rationalise', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id, req.user!.id);

    const { mode = 'semantic', threshold = 75 } = req.body;
    if (!['exact', 'semantic'].includes(mode)) {
      res.status(400).json({ error: 'mode must be exact or semantic' }); return;
    }

    // Fetch only original+rationalized files (exclude variations and finalized)
    const { rows: fileRows } = await pool.query(
      `SELECT id, name, file_type, storage_key, lifecycle_status FROM project_files
       WHERE project_id = $1 AND archived = false
         AND COALESCE(lifecycle_status, 'original') IN ('original', 'rationalized')
       ORDER BY name`,
      [projectId]
    );
    if (fileRows.length < 2) {
      res.status(400).json({ error: 'Upload at least 2 files to rationalise' }); return;
    }

    // Extract text from each file
    const docs: { id: number; name: string; fileType: string; text: string }[] = [];
    const skipped: string[] = [];
    for (const f of fileRows) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      if (!['pdf', 'docx', 'doc'].includes(ext) && !['pdf', 'docx'].includes(f.file_type)) {
        skipped.push(f.name); continue;
      }
      let text = '';
      try {
        const signedUrl = await getSignedUrl(u.company_id, f.storage_key, 3600, req.user!.id);
        const resp = await fetch(signedUrl);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          text = (await extractTextFromBuffer(buf, f.name)).slice(0, 10000);
        }
      } catch { /* skip */ }
      if (text.trim()) docs.push({ id: f.id, name: f.name, fileType: f.file_type, text });
      else skipped.push(f.name);
    }
    if (docs.length < 2) {
      res.status(400).json({ error: 'Could not extract text from enough files. Ensure templates are PDFs or DOCX.' }); return;
    }

    let groups: any[];

    if (mode === 'exact') {
      const { createHash } = await import('crypto');
      const hashMap = new Map<string, typeof docs>();
      for (const doc of docs) {
        const normalized = doc.text.toLowerCase().replace(/\s+/g, ' ').trim();
        const hash = createHash('sha256').update(normalized).digest('hex');
        if (!hashMap.has(hash)) hashMap.set(hash, []);
        hashMap.get(hash)!.push(doc);
      }
      groups = Array.from(hashMap.values()).map((g, idx) => ({
        id: idx,
        similarity: g.length > 1 ? 1.0 : 0,
        isUnique: g.length === 1,
        documents: g.map(d => ({ fileId: d.id, fileName: d.name, fileType: d.fileType })),
      }));
    } else {
      // Semantic: word-hash 768-dim embeddings + agglomerative clustering
      // Mirrors the /v1/cluster accelerator exactly — no API key required.

      function wordHashEmbed(text: string): number[] {
        const vec = new Array<number>(768).fill(0);
        const words = text.toLowerCase().match(/\w+/g);
        if (!words) return vec;
        for (const w of words) {
          let h = 0;
          for (let k = 0; k < w.length; k++) { h = ((h << 5) - h) + w.charCodeAt(k); h |= 0; }
          vec[Math.abs(h) % 768] += 1;
        }
        const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
        return mag > 0 ? vec.map(v => v / mag) : vec;
      }

      // L2-normalised vectors: cosine = dot product
      function dotCosine(a: number[], b: number[]): number {
        let d = 0; for (let k = 0; k < a.length; k++) d += a[k] * b[k]; return d;
      }

      const thresh = (threshold as number) / 100;
      const embeddings = docs.map(d => wordHashEmbed(d.text));
      const embMap = new Map<typeof docs[0], number[]>();
      docs.forEach((d, i) => embMap.set(d, embeddings[i]));

      // Pre-compute ALL pairwise similarities, sorted descending
      const pairs: { i: number; j: number; sim: number }[] = [];
      for (let i = 0; i < docs.length; i++)
        for (let j = i + 1; j < docs.length; j++)
          pairs.push({ i, j, sim: dotCosine(embeddings[i], embeddings[j]) });
      pairs.sort((a, b) => b.sim - a.sim);

      // Greedy agglomerative merge (same as cluster.ts)
      const clusters: (typeof docs)[] = docs.map(d => [d]);
      const merged = new Array<boolean>(docs.length).fill(false);
      const finalClusters: (typeof docs)[] = [];

      for (const { i, j, sim } of pairs) {
        if (sim < thresh) break;
        if (!merged[i] && !merged[j]) {
          merged[i] = true; merged[j] = true;
          finalClusters.push([...clusters[i], ...clusters[j]]);
        } else if (merged[i] && !merged[j]) {
          const idx = finalClusters.findIndex(c => c.includes(clusters[i][0]));
          if (idx !== -1) { finalClusters[idx].push(...clusters[j]); merged[j] = true; }
        } else if (!merged[i] && merged[j]) {
          const idx = finalClusters.findIndex(c => c.includes(clusters[j][0]));
          if (idx !== -1) { finalClusters[idx].push(...clusters[i]); merged[i] = true; }
        }
      }

      let id = 0;
      groups = [];

      // Similar groups (2+ docs) with average similarity
      for (const bucket of finalClusters) {
        const firstEmb = embMap.get(bucket[0])!;
        const avgSim = bucket.slice(1).reduce((s, d) => s + dotCosine(firstEmb, embMap.get(d)!), 0) / (bucket.length - 1);
        groups.push({
          id: id++,
          similarity: Math.round(avgSim * 100),
          isUnique: false,
          documents: bucket.map(d => ({ fileId: d.id, fileName: d.name, fileType: d.fileType })),
        });
      }

      // Singleton (unique) docs — not merged with anyone
      for (let i = 0; i < docs.length; i++) {
        if (!merged[i]) {
          groups.push({
            id: id++, similarity: 0, isUnique: true,
            documents: [{ fileId: docs[i].id, fileName: docs[i].name, fileType: docs[i].fileType }],
          });
        }
      }
    }

    // Mark all participating docs as 'rationalized' (only promote, never demote)
    const participatingIds = docs.map(d => d.id);
    if (participatingIds.length > 0) {
      await pool.query(
        `UPDATE project_files SET lifecycle_status = 'rationalized'
         WHERE id = ANY($1) AND COALESCE(lifecycle_status, 'original') = 'original'`,
        [participatingIds]
      );
    }

    // Save result for project history
    await pool.query(
      'INSERT INTO project_results (project_id, accelerator, result_data, created_by) VALUES ($1, $2, $3, $4)',
      [projectId, 'cluster', JSON.stringify({ mode, threshold, groups }), req.user!.id]
    );

    res.json({ mode, threshold, groups, skipped });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

export default router;
