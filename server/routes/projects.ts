import express from 'express';
import multer from 'multer';
import pool from '../db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { uploadFile, getSignedUrl, deleteFile } from '../lib/cloudStorage.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

async function getUserCompany(userId: number) {
  const { rows } = await pool.query('SELECT company_id, company_role FROM users WHERE id = $1', [userId]);
  return rows[0];
}

async function assertProjectAccess(projectId: number, companyId: number) {
  const { rows } = await pool.query('SELECT id FROM projects WHERE id = $1 AND company_id = $2', [projectId, companyId]);
  if (!rows[0]) throw Object.assign(new Error('Project not found'), { status: 404 });
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
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `, [u.company_id]);

    res.json({
      projects: rows.map(r => ({
        id: r.id, name: r.name, description: r.description,
        companyId: r.company_id, createdBy: r.created_by,
        status: r.status, fileCount: r.file_count,
        createdAt: r.created_at, updatedAt: r.updated_at,
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

    const { name, description = '' } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: 'Project name required' }); return; }

    const { rows } = await pool.query(
      'INSERT INTO projects (name, description, company_id, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [name.trim(), description, u.company_id, req.user!.id]
    );
    const r = rows[0];
    res.status(201).json({
      project: {
        id: r.id, name: r.name, description: r.description,
        companyId: r.company_id, createdBy: r.created_by,
        status: r.status, fileCount: 0,
        createdAt: r.created_at, updatedAt: r.updated_at,
      },
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
    await assertProjectAccess(parseInt(req.params.id), u.company_id);

    const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    const r = rows[0];
    res.json({ project: { id: r.id, name: r.name, description: r.description, companyId: r.company_id, createdBy: r.created_by, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at } });
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
    await assertProjectAccess(projectId, u.company_id);

    const { name, description, status } = req.body;
    const { rows } = await pool.query(`
      UPDATE projects SET
        name        = COALESCE($1, name),
        description = COALESCE($2, description),
        status      = COALESCE($3, status),
        updated_at  = NOW()
      WHERE id = $4 RETURNING *
    `, [name ?? null, description ?? null, status ?? null, projectId]);
    const r = rows[0];
    res.json({ project: { id: r.id, name: r.name, description: r.description, companyId: r.company_id, createdBy: r.created_by, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at } });
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
    await assertProjectAccess(projectId, u.company_id);

    const { rows: files } = await pool.query('SELECT storage_key FROM project_files WHERE project_id = $1', [projectId]);
    for (const f of files) {
      try { await deleteFile(u.company_id, f.storage_key); } catch { /* best effort */ }
    }

    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    res.status(204).end();
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// POST /v1/projects/:id/files — upload files to cloud storage
router.post('/:id/files', requireAuth as any, upload.array('files'), async (req: AuthRequest, res) => {
  try {
    const u = await getUserCompany(req.user!.id);
    if (!u?.company_id) { res.status(403).json({ error: 'Not in a company' }); return; }
    const projectId = parseInt(req.params.id);
    await assertProjectAccess(projectId, u.company_id);

    const files = (req.files as Express.Multer.File[]) ?? [];
    const role = req.body.role ?? 'template';
    const savedFiles = [];

    for (const file of files) {
      const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
      const storageKey = await uploadFile(u.company_id, projectId, file.buffer, file.originalname, file.mimetype);
      const { rows } = await pool.query(
        'INSERT INTO project_files (project_id, uploaded_by, name, file_type, role, storage_key, size_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [projectId, req.user!.id, file.originalname, ext, role, storageKey, file.size]
      );
      await pool.query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [projectId]);
      const r = rows[0];
      savedFiles.push({ id: r.id, name: r.name, fileType: r.file_type, role: r.role, sizeBytes: r.size_bytes, archived: r.archived, createdAt: r.created_at });
    }

    res.status(201).json({ files: savedFiles });
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
    await assertProjectAccess(projectId, u.company_id);

    const { rows } = await pool.query(
      'SELECT * FROM project_files WHERE project_id = $1 ORDER BY created_at ASC',
      [projectId]
    );

    const filesWithUrls = await Promise.all(rows.map(async (r) => {
      let signedUrl: string | undefined;
      try { signedUrl = await getSignedUrl(u.company_id, r.storage_key); } catch { /* no storage */ }
      return {
        id: r.id, projectId: r.project_id, uploadedBy: r.uploaded_by,
        name: r.name, fileType: r.file_type, role: r.role,
        storageKey: r.storage_key, signedUrl,
        sizeBytes: r.size_bytes, archived: r.archived, createdAt: r.created_at,
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
    await assertProjectAccess(projectId, u.company_id);

    const { role, archived } = req.body;
    const { rows } = await pool.query(
      `UPDATE project_files SET role = COALESCE($1, role), archived = COALESCE($2, archived)
       WHERE id = $3 AND project_id = $4 RETURNING *`,
      [role ?? null, archived ?? null, req.params.fileId, projectId]
    );
    if (!rows[0]) { res.status(404).json({ error: 'File not found' }); return; }
    const r = rows[0];
    res.json({ file: { id: r.id, name: r.name, fileType: r.file_type, role: r.role, archived: r.archived } });
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
    await assertProjectAccess(projectId, u.company_id);

    const { rows } = await pool.query('SELECT * FROM project_files WHERE id = $1 AND project_id = $2', [req.params.fileId, projectId]);
    if (!rows[0]) { res.status(404).json({ error: 'File not found' }); return; }

    try { await deleteFile(u.company_id, rows[0].storage_key); } catch { /* best effort */ }
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
    await assertProjectAccess(projectId, u.company_id);

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
    await assertProjectAccess(projectId, u.company_id);

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
    await assertProjectAccess(projectId, u.company_id);

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
    await assertProjectAccess(projectId, u.company_id);

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

export default router;
