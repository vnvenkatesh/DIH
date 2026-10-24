import { Router, Request, Response } from 'express';
import pool from '../db.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { renderTemplate } from '../lib/templateEngine.js';

const router = Router();

// Launch the right browser for the environment.
async function launchBrowser() {
  const isServerless = !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NOW_REGION
  );

  if (isServerless) {
    console.log('[pdf-render] serverless env detected — using @sparticuz/chromium');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const chromium = require('@sparticuz/chromium');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const puppeteerCore = require('puppeteer-core');

    const execPath = await chromium.executablePath();
    console.log('[pdf-render] chromium executablePath:', execPath);

    return puppeteerCore.launch({
      args: [...chromium.args, '--disable-gpu', '--no-zygote'],
      defaultViewport: chromium.defaultViewport,
      executablePath: execPath,
      headless: true,
    });
  }

  console.log('[pdf-render] local env — using puppeteer');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const puppeteer = require('puppeteer');
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

router.post('/:templateId', requireApiKey, async (req: Request, res: Response) => {
  try {
    const userId = req.apiKeyUserId!;
    const { templateId } = req.params;
    const data: Record<string, any> = req.body?.data ?? req.body ?? {};

    // Accept numeric id OR template name (case-insensitive)
    const idAsInt = parseInt(templateId, 10);
    const { rows: tRows } = await pool.query(
      isNaN(idAsInt)
        ? `SELECT * FROM pdf_templates WHERE LOWER(name) = LOWER($1) AND created_by = $2`
        : `SELECT * FROM pdf_templates WHERE id = $1 AND created_by = $2`,
      [isNaN(idAsInt) ? templateId : idAsInt, userId]
    );

    if (!tRows.length) {
      return res.status(404).json({
        error: `Template "${templateId}" not found. Use the numeric id or the exact template name.`,
      });
    }

    const [{ rows: rRows }, { rows: fRows }] = await Promise.all([
      pool.query(
        `SELECT block_id, rule_type, rule_config FROM pdf_template_rules WHERE template_id = $1`,
        [tRows[0].id]
      ),
      pool.query(
        `SELECT field_name, is_required, default_value FROM pdf_template_fields WHERE template_id = $1`,
        [tRows[0].id]
      ),
    ]);

    // Validate required fields
    const missing = fRows.filter(f => f.is_required && data[f.field_name] == null);
    if (missing.length) {
      return res.status(400).json({
        error: 'Missing required fields',
        fields: missing.map((f: any) => f.field_name),
      });
    }

    // Apply defaults
    const mergedData = { ...data };
    for (const f of fRows) {
      if (mergedData[f.field_name] == null && f.default_value) {
        mergedData[f.field_name] = f.default_value;
      }
    }

    const rules = rRows.map((r: any) => ({
      blockId: r.block_id,
      ruleType: r.rule_type as 'condition' | 'loop',
      ruleConfig: r.rule_config,
    }));

    const filledHtml = renderTemplate(tRows[0].html_content, rules, mergedData);

    // Launch browser and render PDF
    let browser: any;
    try {
      browser = await launchBrowser();
    } catch (launchErr: any) {
      console.error('[pdf-render] browser launch failed:', launchErr);
      return res.status(500).json({
        error: 'PDF engine failed to start',
        detail: launchErr.message,
      });
    }

    try {
      const page = await browser.newPage();
      await page.setContent(filledHtml, { waitUntil: 'load' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '2cm', bottom: '2cm', left: '2cm', right: '2cm' },
      });

      const safeName = tRows[0].name.replace(/[^a-z0-9]/gi, '_');
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}.pdf"`,
        'Content-Length': pdfBuffer.length,
      });
      res.send(Buffer.from(pdfBuffer));
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err: any) {
    console.error('[pdf-render] unhandled error:', err);
    res.status(500).json({
      error: 'PDF generation failed',
      detail: err.message ?? String(err),
    });
  }
});

export default router;
