import { Router } from 'express';
import multer from 'multer';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';
import { hash } from 'bcryptjs';
import mammoth from 'mammoth';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { renderTemplate } from '../lib/templateEngine.js';

// ── AES-256-GCM encryption for API key storage ────────────────────────────────
function getEncKey(): Buffer {
  const secret = process.env.JWT_SECRET ?? 'fallback-insecure-secret';
  return scryptSync(secret, 'dih-api-key-salt', 32);
}

function encryptKey(raw: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncKey(), iv);
  const enc = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptKey(stored: string): string {
  const buf = Buffer.from(stored, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', getEncKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── Helper: extract {{field}}, <field>, [field] placeholders from HTML ────────
function extractPlaceholders(html: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\{\{([\w.[\]]+)\}\}/g,
    /<([\w.]+)>/g,
    /\[([\w.]+)\]/g,
    /data-placeholder="([\w.[\]]+)"/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (m[1] && !m[1].startsWith('/') && m[1].length < 100) found.add(m[1]);
    }
  }
  return [...found];
}

// Normalize all placeholder variants to {{field}} and wrap as chip spans
function normalizePlaceholders(html: string): string {
  // <field> → {{field}} first (avoid collision with HTML tags — only word chars)
  html = html.replace(/<([\w][\w.]*[\w])>/g, '{{$1}}');
  // [field] → {{field}}
  html = html.replace(/\[([\w][\w.]*[\w])\]/g, '{{$1}}');
  // Wrap {{field}} as a chip span with data attribute for the engine
  html = html.replace(/\{\{([\w.[\]]+)\}\}/g, (_, field) =>
    `<span data-placeholder="${field}" class="pdf-placeholder" contenteditable="false">{{${field}}}</span>`
  );
  return html;
}

// ── List templates ────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { rows } = await pool.query(
    `SELECT id, name, description, original_format, page_size, margin_mm, created_at, updated_at
     FROM pdf_templates WHERE created_by = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  res.json({ templates: rows });
});

// ── API Keys — MUST be before /:id to avoid wildcard capture ─────────────────
async function listApiKeys(req: any, res: any) {
  const userId = req.user.id;
  const { rows } = await pool.query(
    `SELECT id, name, key_prefix, last_used_at, created_at FROM pdf_api_keys WHERE user_id = $1 AND revoked = FALSE ORDER BY created_at DESC`,
    [userId]
  );
  res.json({ keys: rows });
}
router.get('/api-keys', requireAuth, listApiKeys);
router.get('/api-keys/list', requireAuth, listApiKeys);

router.post('/api-keys', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const rawKey = 'dih_' + randomBytes(24).toString('base64url');
  const prefix = rawKey.slice(0, 12);
  const keyHash = await hash(rawKey, 10);
  const keyEncrypted = encryptKey(rawKey);

  const { rows } = await pool.query(
    `INSERT INTO pdf_api_keys (user_id, name, key_hash, key_prefix, key_encrypted) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, key_prefix, created_at`,
    [userId, name, keyHash, prefix, keyEncrypted]
  );
  res.status(201).json({ key: { ...rows[0], raw_key: rawKey } });
});

router.delete('/api-keys/:id', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { rowCount } = await pool.query(
    `UPDATE pdf_api_keys SET revoked = TRUE WHERE id = $1 AND user_id = $2 AND revoked = FALSE`,
    [req.params.id, userId]
  );
  if (!rowCount) return res.status(404).json({ error: 'Key not found' });
  res.status(204).send();
});

router.get('/api-keys/:id/reveal', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { rows } = await pool.query(
    `SELECT key_encrypted FROM pdf_api_keys WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Key not found' });
  if (!rows[0].key_encrypted) return res.status(404).json({ error: 'Key was created before encrypted storage was added. Please revoke and recreate it.' });
  try {
    const raw = decryptKey(rows[0].key_encrypted);
    res.json({ raw_key: raw });
  } catch {
    res.status(500).json({ error: 'Failed to decrypt key.' });
  }
});

// ── Preview — render template HTML using the template engine (JWT, no PDF) ────
router.post('/preview', requireAuth, async (req, res) => {
  const { html_content, rules = [], sample_data = {} } = req.body;
  if (!html_content) return res.status(400).json({ error: 'html_content required' });

  try {
    const mappedRules = (rules as any[]).map((r: any) => ({
      blockId: r.block_id,
      ruleType: r.rule_type as 'condition' | 'loop',
      ruleConfig: typeof r.rule_config === 'string' ? JSON.parse(r.rule_config) : (r.rule_config ?? {}),
    }));
    const rendered = renderTemplate(html_content, mappedRules, sample_data, false);
    const pageHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:Arial,sans-serif;margin:40px;color:#222;line-height:1.6}
      .pdf-placeholder{background:#dbeafe;color:#1e40af;border-radius:3px;padding:0 3px;font-size:.85em}
      [data-block-id]{border-left:3px solid #e5e7eb;padding-left:8px}
    </style></head><body>${rendered}</body></html>`;
    res.json({ html: pageHtml });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? 'Render failed' });
  }
});

// ── Get single template with fields + rules ───────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { rows } = await pool.query(
    `SELECT * FROM pdf_templates WHERE id = $1 AND created_by = $2`,
    [req.params.id, userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Template not found' });

  const [fieldsRes, rulesRes] = await Promise.all([
    pool.query(`SELECT * FROM pdf_template_fields WHERE template_id = $1 ORDER BY sort_order`, [req.params.id]),
    pool.query(`SELECT * FROM pdf_template_rules  WHERE template_id = $1`, [req.params.id]),
  ]);

  res.json({ template: rows[0], fields: fieldsRes.rows, rules: rulesRes.rows });
});

// ── Upload DOCX and convert to HTML ──────────────────────────────────────────
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let html = '';
  const ext = req.file.originalname.split('.').pop()?.toLowerCase();

  if (ext === 'docx' || ext === 'doc') {
    const result = await mammoth.convertToHtml({ buffer: req.file.buffer });
    html = normalizePlaceholders(result.value);
  } else if (ext === 'html' || ext === 'htm') {
    html = normalizePlaceholders(req.file.buffer.toString('utf-8'));
  } else {
    return res.status(400).json({ error: 'Unsupported file type. Upload DOCX or HTML.' });
  }

  const placeholders = extractPlaceholders(html);
  res.json({ html, placeholders, originalFormat: ext });
});

// ── Extract schema from HTML (re-scan) ───────────────────────────────────────
router.post('/:id/extract-schema', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { rows } = await pool.query(
    `SELECT html_content FROM pdf_templates WHERE id = $1 AND created_by = $2`,
    [req.params.id, userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Template not found' });
  const placeholders = extractPlaceholders(rows[0].html_content);
  res.json({ placeholders });
});

// ── Duplicate template ────────────────────────────────────────────────────────
router.post('/:id/duplicate', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { rows: src } = await pool.query(
    `SELECT * FROM pdf_templates WHERE id = $1 AND created_by = $2`,
    [req.params.id, userId]
  );
  if (!src.length) return res.status(404).json({ error: 'Template not found' });
  const tpl = src[0];

  const [fieldsRes, rulesRes] = await Promise.all([
    pool.query(`SELECT * FROM pdf_template_fields WHERE template_id = $1 ORDER BY sort_order`, [req.params.id]),
    pool.query(`SELECT * FROM pdf_template_rules  WHERE template_id = $1`, [req.params.id]),
  ]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: newTpl } = await client.query(
      `INSERT INTO pdf_templates (name, description, html_content, original_format, page_size, margin_mm, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [`${tpl.name} (copy)`, tpl.description, tpl.html_content, tpl.original_format, tpl.page_size ?? 'A4', tpl.margin_mm ?? 20, userId]
    );
    const newId = newTpl[0].id;
    for (let i = 0; i < fieldsRes.rows.length; i++) {
      const f = fieldsRes.rows[i];
      await client.query(
        `INSERT INTO pdf_template_fields (template_id, field_name, field_type, is_required, default_value, description, parent_field, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [newId, f.field_name, f.field_type, f.is_required, f.default_value, f.description, f.parent_field, i]
      );
    }
    for (const r of rulesRes.rows) {
      await client.query(
        `INSERT INTO pdf_template_rules (template_id, block_id, rule_type, rule_config) VALUES ($1,$2,$3,$4)`,
        [newId, r.block_id, r.rule_type, JSON.stringify(r.rule_config)]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ template: newTpl[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ── Create template ───────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { name, description, html_content, original_format, page_size, margin_mm, fields, rules } = req.body;
  if (!name || !html_content) return res.status(400).json({ error: 'name and html_content required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO pdf_templates (name, description, html_content, original_format, page_size, margin_mm, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, description ?? '', html_content, original_format ?? 'docx', page_size ?? 'A4', margin_mm ?? 20, userId]
    );
    const templateId = rows[0].id;

    if (fields?.length) {
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        await client.query(
          `INSERT INTO pdf_template_fields (template_id, field_name, field_type, is_required, default_value, description, parent_field, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [templateId, f.field_name, f.field_type ?? 'string', f.is_required ?? false,
           f.default_value ?? '', f.description ?? '', f.parent_field ?? null, i]
        );
      }
    }

    if (rules?.length) {
      for (const r of rules) {
        await client.query(
          `INSERT INTO pdf_template_rules (template_id, block_id, rule_type, rule_config)
           VALUES ($1,$2,$3,$4)`,
          [templateId, r.block_id, r.rule_type, JSON.stringify(r.rule_config)]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ template: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ── Update template ───────────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { name, description, html_content, page_size, margin_mm, fields, rules } = req.body;

  const { rows: existing } = await pool.query(
    `SELECT id FROM pdf_templates WHERE id = $1 AND created_by = $2`,
    [req.params.id, userId]
  );
  if (!existing.length) return res.status(404).json({ error: 'Template not found' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE pdf_templates SET name=$1, description=$2, html_content=$3, page_size=$4, margin_mm=$5, updated_at=NOW()
       WHERE id=$6`,
      [name, description ?? '', html_content, page_size ?? 'A4', margin_mm ?? 20, req.params.id]
    );

    // Replace fields
    await client.query(`DELETE FROM pdf_template_fields WHERE template_id = $1`, [req.params.id]);
    if (fields?.length) {
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        await client.query(
          `INSERT INTO pdf_template_fields (template_id, field_name, field_type, is_required, default_value, description, parent_field, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [req.params.id, f.field_name, f.field_type ?? 'string', f.is_required ?? false,
           f.default_value ?? '', f.description ?? '', f.parent_field ?? null, i]
        );
      }
    }

    // Replace rules
    await client.query(`DELETE FROM pdf_template_rules WHERE template_id = $1`, [req.params.id]);
    if (rules?.length) {
      for (const r of rules) {
        await client.query(
          `INSERT INTO pdf_template_rules (template_id, block_id, rule_type, rule_config)
           VALUES ($1,$2,$3,$4)`,
          [req.params.id, r.block_id, r.rule_type, JSON.stringify(r.rule_config)]
        );
      }
    }

    await client.query('COMMIT');
    const { rows } = await pool.query(`SELECT * FROM pdf_templates WHERE id = $1`, [req.params.id]);
    res.json({ template: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ── Delete template ───────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const { rowCount } = await pool.query(
    `DELETE FROM pdf_templates WHERE id = $1 AND created_by = $2`,
    [req.params.id, userId]
  );
  if (!rowCount) return res.status(404).json({ error: 'Template not found' });
  res.status(204).send();
});

export default router;
