import { Router } from 'express';
import puppeteer from 'puppeteer';
import pool from '../db.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { renderTemplate } from '../lib/templateEngine.js';

const router = Router();

router.post('/:templateId', requireApiKey, async (req, res) => {
  const userId = req.apiKeyUserId!;
  const { templateId } = req.params;
  const data: Record<string, any> = req.body?.data ?? req.body ?? {};

  // Load template (owned by the API key's user)
  const { rows: tRows } = await pool.query(
    `SELECT * FROM pdf_templates WHERE id = $1 AND created_by = $2`,
    [templateId, userId]
  );
  if (!tRows.length) return res.status(404).json({ error: 'Template not found' });

  const { rows: rRows } = await pool.query(
    `SELECT block_id, rule_type, rule_config FROM pdf_template_rules WHERE template_id = $1`,
    [templateId]
  );

  // Validate required fields
  const { rows: fRows } = await pool.query(
    `SELECT field_name, is_required, default_value FROM pdf_template_fields WHERE template_id = $1`,
    [templateId]
  );
  const missing = fRows.filter(f => f.is_required && data[f.field_name] == null);
  if (missing.length) {
    return res.status(400).json({
      error: 'Missing required fields',
      fields: missing.map(f => f.field_name),
    });
  }

  // Apply defaults for optional fields not provided
  const mergedData = { ...data };
  for (const f of fRows) {
    if (mergedData[f.field_name] == null && f.default_value) {
      mergedData[f.field_name] = f.default_value;
    }
  }

  const rules = rRows.map(r => ({
    blockId: r.block_id,
    ruleType: r.rule_type as 'condition' | 'loop',
    ruleConfig: r.rule_config,
  }));

  const filledHtml = renderTemplate(tRows[0].html_content, rules, mergedData);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(filledHtml, { waitUntil: 'load' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '2cm', bottom: '2cm', left: '2cm', right: '2cm' },
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${tRows[0].name.replace(/[^a-z0-9]/gi, '_')}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(Buffer.from(pdfBuffer));
  } finally {
    await browser.close();
  }
});

export default router;
