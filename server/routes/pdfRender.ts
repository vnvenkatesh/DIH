import { Router, Request, Response } from 'express';
import pool from '../db.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { renderTemplate } from '../lib/templateEngine.js';

const router = Router();

// ── Browser launcher ──────────────────────────────────────────────────────────

async function launchBrowser() {
  const isServerless = !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NOW_REGION
  );

  if (isServerless) {
    console.log('[pdf-render] serverless env — using @sparticuz/chromium');
    const chromiumMod = await import('@sparticuz/chromium');
    const chromium = (chromiumMod as any).default ?? chromiumMod;
    const puppeteerCoreMod = await import('puppeteer-core');
    const puppeteerCore = (puppeteerCoreMod as any).default ?? puppeteerCoreMod;
    const execPath = await chromium.executablePath();
    return puppeteerCore.launch({
      args: [...(chromium.args ?? []), '--disable-gpu', '--no-zygote'],
      defaultViewport: chromium.defaultViewport ?? { width: 1280, height: 720 },
      executablePath: execPath,
      headless: true,
    });
  }

  console.log('[pdf-render] local env — using puppeteer');
  const puppeteerMod = await import('puppeteer');
  const puppeteer = (puppeteerMod as any).default ?? puppeteerMod;
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Load a template + its rules + fields by numeric id or name. */
async function loadTemplateRecord(templateId: string | number, userId: number) {
  const idAsInt = typeof templateId === 'number' ? templateId : parseInt(String(templateId), 10);
  const { rows: tRows } = await pool.query(
    isNaN(idAsInt)
      ? `SELECT * FROM pdf_templates WHERE LOWER(name) = LOWER($1) AND created_by = $2`
      : `SELECT * FROM pdf_templates WHERE id = $1 AND created_by = $2`,
    [isNaN(idAsInt) ? templateId : idAsInt, userId]
  );
  if (!tRows.length) return null;

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

  return { tpl: tRows[0], rRows, fRows };
}

/** Merge data with template defaults; returns merged data or error.
 *  A required field is only "missing" if it is also used as a placeholder
 *  in the HTML (data-placeholder="fieldName").  Fields defined in the schema
 *  but absent from the HTML do not cause failures.
 */
function mergeWithDefaults(
  data: Record<string, any>,
  fRows: any[],
  htmlContent: string
): { merged: Record<string, any>; missing: string[] } {
  // Collect every field name that actually appears in the template HTML
  const usedInHtml = new Set<string>(
    [...htmlContent.matchAll(/\bdata-placeholder="([^"]+)"/g)].map(m => m[1])
  );
  const missing = fRows
    .filter(f => f.is_required && usedInHtml.has(f.field_name) && data[f.field_name] == null)
    .map((f: any) => f.field_name);
  const merged = { ...data };
  for (const f of fRows) {
    if (merged[f.field_name] == null && f.default_value) merged[f.field_name] = f.default_value;
  }
  return { merged, missing };
}

/** Build the Rule objects puppeteer expects from raw DB rows. */
function buildRules(rRows: any[]) {
  return rRows.map((r: any) => ({
    blockId: r.block_id,
    ruleType: r.rule_type as 'condition' | 'loop',
    ruleConfig: typeof r.rule_config === 'string' ? JSON.parse(r.rule_config) : r.rule_config,
  }));
}

/** Extract the <body> content from a full renderTemplate HTML string. */
function extractBody(fullHtml: string): string {
  const match = fullHtml.match(/<body>([\s\S]*)<\/body>/i);
  return match ? match[1] : fullHtml;
}

/** Puppeteer page format string from template page_size column. */
function pageFormat(pageSize?: string): string {
  if (pageSize === 'Letter') return 'Letter';
  if (pageSize === 'Legal') return 'Legal';
  return 'A4';
}

/** CSS margin string from margin_mm column (default 20). */
function marginStr(marginMm?: number): string {
  const mm = marginMm ?? 20;
  return `${mm}mm`;
}

// ── POST /v1/pdf-render — multi-template composition ─────────────────────────
//
//  Body:
//    {
//      "templates": [
//        { "id": 1,              "data": { ... } },
//        { "id": "Cover Letter", "data": { ... } }
//      ],
//      "shared_data": { "companyName": "Acme" }   // merged into every template
//    }
//
//  All rendered HTML bodies are joined with CSS page-breaks → one Puppeteer pass.
//  Page format is taken from the first template; override with ?format=Letter.
//  ?debug=1 returns JSON with per-template rendered HTML instead of a PDF.

router.post('/', requireApiKey, async (req: Request, res: Response) => {
  try {
    const userId = req.apiKeyUserId!;
    const { templates: templateList, shared_data: sharedData = {} } = req.body ?? {};

    if (!Array.isArray(templateList) || templateList.length === 0) {
      return res.status(400).json({
        error: 'Body must include "templates": [{ id, data? }, …]',
      });
    }

    const debugMode = req.query.debug === '1';
    const formatOverride = req.query.format as string | undefined;

    const renderedBodies: string[] = [];
    const debugPages: any[] = [];
    let firstPageSize: string | undefined;
    let firstMarginMm: number | undefined;
    const errors: { index: number; id: string | number; error: string }[] = [];

    for (let i = 0; i < templateList.length; i++) {
      const entry = templateList[i];
      const templateId = entry?.id;
      if (templateId == null) {
        errors.push({ index: i, id: templateId, error: 'Missing "id"' });
        continue;
      }

      const rec = await loadTemplateRecord(templateId, userId);
      if (!rec) {
        errors.push({ index: i, id: templateId, error: `Template "${templateId}" not found` });
        continue;
      }

      const { tpl, rRows, fRows } = rec;
      if (i === 0) { firstPageSize = tpl.page_size; firstMarginMm = tpl.margin_mm; }

      const rawData = { ...sharedData, ...(entry.data ?? {}) };
      const { merged, missing } = mergeWithDefaults(rawData, fRows, tpl.html_content ?? '');
      if (missing.length) {
        errors.push({ index: i, id: templateId, error: `Missing required fields: ${missing.join(', ')}` });
        continue;
      }

      const rules = buildRules(rRows);
      const rendered = renderTemplate(tpl.html_content, rules, merged, debugMode);

      if (debugMode) {
        debugPages.push({ index: i, id: templateId, name: tpl.name, ...(rendered as object) });
      } else {
        renderedBodies.push(extractBody(rendered as string));
      }
    }

    if (errors.length && renderedBodies.length === 0 && !debugMode) {
      return res.status(400).json({ error: 'All templates failed to render', details: errors });
    }

    if (debugMode) {
      return res.json({ pages: debugPages, errors });
    }

    // Compose: join bodies with page-break divs
    const pageBreak = '<div style="page-break-after:always;break-after:page;"></div>';
    const composedBody = renderedBodies.join(pageBreak);

    const BASE_STYLES = `
      body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.5; color: #111; }
      h1 { font-size: 20pt; margin-bottom: 0.5em; }
      h2 { font-size: 16pt; margin-bottom: 0.4em; }
      h3 { font-size: 13pt; margin-bottom: 0.3em; }
      p  { margin-bottom: 0.6em; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
      td, th { border: 1px solid #ccc; padding: 6px 10px; }
      th { background: #f4f4f4; font-weight: 600; }
    `;
    const finalHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_STYLES}</style></head><body>${composedBody}</body></html>`;

    const format = formatOverride ?? pageFormat(firstPageSize);
    const margin = marginStr(firstMarginMm);

    let browser: any;
    try {
      browser = await launchBrowser();
    } catch (launchErr: any) {
      return res.status(500).json({ error: 'PDF engine failed to start', detail: launchErr.message });
    }

    try {
      const page = await browser.newPage();
      await page.setContent(finalHtml, { waitUntil: 'load' });
      const pdfBuffer = await page.pdf({
        format,
        printBackground: true,
        margin: { top: margin, bottom: margin, left: margin, right: margin },
      });

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="composed.pdf"',
        'Content-Length': pdfBuffer.length,
        ...(errors.length ? { 'X-Skipped-Templates': errors.length.toString() } : {}),
      });
      res.send(Buffer.from(pdfBuffer));
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err: any) {
    console.error('[pdf-render] multi-template error:', err);
    res.status(500).json({ error: 'PDF generation failed', detail: err.message ?? String(err) });
  }
});

// ── POST /v1/pdf-render/:templateId — single template (unchanged behaviour) ───

router.post('/:templateId', requireApiKey, async (req: Request, res: Response) => {
  try {
    const userId = req.apiKeyUserId!;
    const { templateId } = req.params;
    const data: Record<string, any> = req.body?.data ?? req.body ?? {};

    const rec = await loadTemplateRecord(templateId, userId);
    if (!rec) {
      return res.status(404).json({
        error: `Template "${templateId}" not found. Use the numeric id or the exact template name.`,
      });
    }

    const { tpl, rRows, fRows } = rec;
    const { merged, missing } = mergeWithDefaults(data, fRows, tpl.html_content ?? '');
    if (missing.length) {
      return res.status(400).json({ error: 'Missing required fields', fields: missing });
    }

    const rules = buildRules(rRows);
    const debugMode = req.query.debug === '1';
    const rendered = renderTemplate(tpl.html_content, rules, merged, debugMode);

    if (debugMode) return res.json(rendered);

    const filledHtml = rendered as string;

    let browser: any;
    try {
      browser = await launchBrowser();
    } catch (launchErr: any) {
      return res.status(500).json({ error: 'PDF engine failed to start', detail: launchErr.message });
    }

    try {
      const page = await browser.newPage();
      await page.setContent(filledHtml, { waitUntil: 'load' });
      const pdfBuffer = await page.pdf({
        format: pageFormat(tpl.page_size),
        printBackground: true,
        margin: { top: marginStr(tpl.margin_mm), bottom: marginStr(tpl.margin_mm), left: marginStr(tpl.margin_mm), right: marginStr(tpl.margin_mm) },
      });

      const safeName = tpl.name.replace(/[^a-z0-9]/gi, '_');
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
    res.status(500).json({ error: 'PDF generation failed', detail: err.message ?? String(err) });
  }
});

export default router;
