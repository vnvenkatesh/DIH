// ---------------------------------------------------------------------------
// POST /v1/pdf-validator/validate  — step 1: run validation, return report
// POST /v1/pdf-validator/annotate  — step 2: embed highlights + sticky notes
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { PDFDocument, PDFName, PDFArray, PDFString, rgb } from 'pdf-lib';
import pdfParse from 'pdf-parse';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ─── Types ────────────────────────────────────────────────────────────────────

interface TextItem { str: string; x: number; y: number; w: number; h: number; page: number; }

export interface FieldMatch {
  field: string;      // XML leaf tag name
  xmlKey: string;     // full dot-path key
  value: string;
  found: boolean;
  matchType: 'exact' | 'near' | 'missing';
  page: number | null;
  x: number | null; y: number | null; w: number | null; h: number | null;
}

export interface ValidationResult {
  id: string;
  field: string;
  category: string;
  description: string;
  status: 'PASS' | 'FAIL' | 'NA';
  reason: string;
  page: number | null;
  x: number | null; y: number | null; w: number | null; h: number | null;
}

interface TestCase {
  id: string; field: string; category: string;
  description: string; inputData: string; expectedResult: string; priority: string;
}

// ─── PDF Text Extraction with Positions ───────────────────────────────────────

async function extractTextItems(buffer: Buffer): Promise<{ corpus: string; items: TextItem[] }> {
  const items: TextItem[] = [];
  const pageTexts: string[] = [];
  let currentPage = 0;

  await pdfParse(buffer, {
    pagerender: async (pageData: any) => {
      currentPage++;
      const page = currentPage;
      const tc = await pageData.getTextContent();
      for (const item of tc.items as any[]) {
        if (!item.str?.trim()) continue;
        items.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          w: item.width ?? 0,
          h: item.height > 0 ? item.height : 10,
          page,
        });
      }
      const text = (tc.items as any[]).map((i: any) => i.str ?? '').join(' ');
      pageTexts.push(text);
      return text;
    },
  });

  return { corpus: pageTexts.join('\n'), items };
}

// ─── Data Parsers ─────────────────────────────────────────────────────────────

function flattenXmlNode(xml: string, prefix: string, acc: Record<string, string>): void {
  const re = /<([a-zA-Z][a-zA-Z0-9\-_:]*)(?:\s[^>]*)?>([^]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[1];
    const content = m[2];
    const key = prefix ? `${prefix}.${tag}` : tag;
    if (/<[a-zA-Z]/.test(content)) {
      flattenXmlNode(content, key, acc);
    } else {
      const val = content.trim();
      if (val) acc[key] = val;
    }
  }
}

function flattenObject(obj: unknown, prefix: string, acc: Record<string, string>): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj !== 'object') {
    if (prefix) acc[prefix] = String(obj);
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => flattenObject(item, `${prefix}[${i}]`, acc));
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    flattenObject(v, prefix ? `${prefix}.${k}` : k, acc);
  }
}

function flattenData(text: string, ext: string): Record<string, string> {
  const acc: Record<string, string> = {};
  if (ext === '.json') {
    flattenObject(JSON.parse(text), '', acc);
  } else {
    const clean = text
      .replace(/<\?[^?]*\?>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    flattenXmlNode(clean, '', acc);
  }
  return acc;
}

function parseCsvRows(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        i++;
        let field = '';
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
          else if (line[i] === '"') { i++; break; }
          else field += line[i++];
        }
        fields.push(field);
        if (line[i] === ',') i++;
      } else {
        const end = line.indexOf(',', i);
        if (end === -1) { fields.push(line.slice(i).trim()); break; }
        fields.push(line.slice(i, end).trim());
        i = end + 1;
      }
    }
    return fields;
  };

  const headers = parseRow(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
}

// ─── Text Search ──────────────────────────────────────────────────────────────

type SearchResult = { found: boolean; page: number | null; x: number | null; y: number | null; w: number | null; h: number | null };

function searchInItems(items: TextItem[], query: string): SearchResult {
  const notFound: SearchResult = { found: false, page: null, x: null, y: null, w: null, h: null };
  if (!query?.trim()) return notFound;
  const q = query.trim().toLowerCase();

  // 1. Single-item contains
  for (const item of items) {
    if (item.str.toLowerCase().includes(q)) {
      return { found: true, page: item.page, x: item.x, y: item.y, w: Math.max(item.w, 20), h: Math.max(item.h, 8) };
    }
  }

  // 2. Sliding window across adjacent items on same page
  for (let i = 0; i < items.length; i++) {
    let combined = '';
    let j = i;
    while (j < items.length && items[j].page === items[i].page && combined.length < q.length * 4) {
      combined += items[j].str;
      if (combined.toLowerCase().includes(q)) {
        const span = items.slice(i, j + 1);
        return {
          found: true,
          page: items[i].page,
          x: items[i].x,
          y: Math.min(...span.map(it => it.y)),
          w: Math.max(...span.map(it => it.x + it.w)) - items[i].x,
          h: Math.max(...span.map(it => it.h)),
        };
      }
      j++;
    }
  }

  return notFound;
}

// ─── Field Map Builder ────────────────────────────────────────────────────────

function buildFieldMap(flatData: Record<string, string>, items: TextItem[]): FieldMatch[] {
  return Object.entries(flatData).map(([xmlKey, value]): FieldMatch => {
    const field = xmlKey.split('.').pop() ?? xmlKey;
    const exact = searchInItems(items, value);
    if (exact.found) {
      return { field, xmlKey, value, found: true, matchType: 'exact', page: exact.page, x: exact.x, y: exact.y, w: exact.w, h: exact.h };
    }
    // Near-match: rendering added extra $ prefix to currency values
    if (value.startsWith('$')) {
      const near = searchInItems(items, '$' + value);
      if (near.found) {
        return { field, xmlKey, value, found: true, matchType: 'near', page: near.page, x: near.x, y: near.y, w: near.w, h: near.h };
      }
    }
    return { field, xmlKey, value, found: false, matchType: 'missing', page: null, x: null, y: null, w: null, h: null };
  });
}

// ─── Additional Results (field coverage + unexpected bugs) ────────────────────

function buildAdditionalResults(
  fieldMap: FieldMatch[],
  existingResults: ValidationResult[],
): ValidationResult[] {
  // Normalise field names to deduplicate against test-case results
  const covered = new Set<string>();
  for (const r of existingResults) {
    covered.add(r.field.toLowerCase().replace(/[\s\-_\/]/g, ''));
  }

  const additional: ValidationResult[] = [];
  let fcIdx = 1;
  let bfIdx = 1;

  for (const fm of fieldMap) {
    const norm = fm.field.toLowerCase().replace(/[\s\-_\/]/g, '');
    if (covered.has(norm)) continue; // Already validated by a test case

    if (fm.matchType === 'exact') {
      additional.push({
        id: `FC-${String(fcIdx++).padStart(3, '0')}`,
        field: fm.field,
        category: 'Field Coverage',
        description: `Field "${fm.field}" rendered correctly from input data`,
        status: 'PASS',
        reason: `Value "${fm.value}" found in PDF`,
        page: fm.page, x: fm.x, y: fm.y, w: fm.w, h: fm.h,
      });
    } else if (fm.matchType === 'near') {
      additional.push({
        id: `BF-${String(bfIdx++).padStart(3, '0')}`,
        field: fm.field,
        category: 'Bug Finding',
        description: `Rendering artifact detected for "${fm.field}" — not covered by any test case`,
        status: 'FAIL',
        reason: `Rendering issue: PDF contains "${'$' + fm.value}" but input has "${fm.value}" (double dollar sign)`,
        page: fm.page, x: fm.x, y: fm.y, w: fm.w, h: fm.h,
      });
    } else {
      additional.push({
        id: `BF-${String(bfIdx++).padStart(3, '0')}`,
        field: fm.field,
        category: 'Bug Finding',
        description: `Field "${fm.field}" from input data not found in PDF — not covered by any test case`,
        status: 'FAIL',
        reason: `Value "${fm.value}" not found anywhere in PDF`,
        page: null, x: null, y: null, w: null, h: null,
      });
    }
  }

  return additional;
}

// ─── Format Pattern Library ───────────────────────────────────────────────────

const FORMAT_PATTERNS: Array<{ test: RegExp; pattern: RegExp; label: string }> = [
  { test: /\$[X\d][\d,]*\.XX|currency|dollar amount/i, pattern: /^\$[\d,]+\.\d{2}$/, label: 'Currency $X,XXX.XX' },
  { test: /positive.*currency|non.?negative.*curr/i,    pattern: /^\$[1-9][\d,]*\.\d{2}$/, label: 'Positive currency' },
  { test: /MM\/DD\/YYYY|date.*MM|format.*date/i,        pattern: /^\d{2}\/\d{2}\/\d{4}$/, label: 'Date MM/DD/YYYY' },
  { test: /YYYY-MM-DD/i,                                pattern: /^\d{4}-\d{2}-\d{2}$/, label: 'Date YYYY-MM-DD' },
  { test: /email.*format|mailto|@.*\./i,                pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, label: 'Email format' },
  { test: /phone|\d{3}-\d{3}-\d{4}/i,                  pattern: /^\d{3}[-.]?\d{3}[-.]?\d{4}$/, label: 'Phone format' },
];

function extractFormatPattern(expectedResult: string): { pattern: RegExp; label: string } | null {
  for (const fp of FORMAT_PATTERNS) {
    if (fp.test.test(expectedResult)) return { pattern: fp.pattern, label: fp.label };
  }
  return null;
}

// ─── Fuzzy Field Lookup ───────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-_\/]/g, '');
}

function lookupField(label: string, flatData: Record<string, string>): { xmlKey: string; value: string } | null {
  const labelNorm = normalize(label);
  // Exact leaf match
  for (const [key, val] of Object.entries(flatData)) {
    if (normalize(key.split('.').pop() ?? '') === labelNorm) return { xmlKey: key, value: val };
  }
  // Partial path match (any segment contains label or vice-versa)
  for (const [key, val] of Object.entries(flatData)) {
    const keyNorm = normalize(key);
    if (keyNorm.includes(labelNorm) || labelNorm.includes(normalize(key.split('.').pop() ?? ''))) {
      return { xmlKey: key, value: val };
    }
  }
  return null;
}

// ─── Conditional Parser ───────────────────────────────────────────────────────

function parseCondition(inputData: string): { condField: string; condValue: string } | null {
  const m = inputData.match(/^([^:(]+):\s*(.+)$/);
  if (!m) return null;
  return { condField: m[1].trim(), condValue: m[2].trim() };
}

function evaluateCondition(condField: string, condValue: string, flatData: Record<string, string>): boolean | null {
  const cfNorm = normalize(condField);
  for (const [key, val] of Object.entries(flatData)) {
    const segments = key.split('.');
    for (const seg of segments) {
      if (normalize(seg) === cfNorm || normalize(key) === cfNorm) {
        return val.toLowerCase().trim() === condValue.toLowerCase().trim();
      }
    }
    // Fuzzy: key path contains all words of condField
    const words = condField.toLowerCase().split(/\s+/);
    const keyLc = key.toLowerCase();
    if (words.every(w => keyLc.includes(w))) {
      return val.toLowerCase().trim() === condValue.toLowerCase().trim();
    }
  }
  return null;
}

// ─── Deterministic Validator ──────────────────────────────────────────────────

function validateDeterministic(
  testCases: TestCase[],
  flatData: Record<string, string>,
  items: TextItem[],
  corpus: string,
): ValidationResult[] {
  return testCases.map((tc): ValidationResult => {
    const base = {
      id: tc.id, field: tc.field, category: tc.category, description: tc.description,
      page: null as number | null, x: null as number | null, y: null as number | null,
      w: null as number | null, h: null as number | null,
    };
    const cat = tc.category.toLowerCase();
    const inputLc = tc.inputData.toLowerCase().trim();
    const expectLc = tc.expectedResult.toLowerCase();

    // Skip form-validation-only cases
    if (
      inputLc.startsWith('user action:') ||
      expectLc.startsWith('error displayed') ||
      inputLc === '(empty)' || inputLc === 'null'
    ) {
      return { ...base, status: 'NA', reason: 'Form validation test — not applicable for PDF rendering' };
    }

    // ── Conditional ──────────────────────────────────────────────────────────
    if (cat === 'conditional') {
      const cond = parseCondition(tc.inputData);
      if (!cond) return { ...base, status: 'NA', reason: 'Condition not parseable' };
      if (cond.condField.toLowerCase().startsWith('user action')) {
        return { ...base, status: 'NA', reason: 'Behavioral condition — not data-driven' };
      }
      const condMet = evaluateCondition(cond.condField, cond.condValue, flatData);
      if (condMet === null) {
        return { ...base, status: 'NA', reason: `Condition field "${cond.condField}" not in input data` };
      }
      if (!condMet) {
        return { ...base, status: 'NA', reason: `Condition not triggered: ${cond.condField} ≠ "${cond.condValue}" in input data` };
      }

      // Condition met — check expected result
      const expectAbsent = /not displayed|not visible|not shown|is not/i.test(tc.expectedResult);
      const quotedPhrases = [...tc.expectedResult.matchAll(/'([^']+)'/g)].map(m => m[1]);
      const checkPhrases = quotedPhrases.length > 0 ? quotedPhrases : [tc.expectedResult.slice(0, 80)];

      for (const phrase of checkPhrases) {
        const inCorpus = corpus.toLowerCase().includes(phrase.toLowerCase());
        if (expectAbsent) {
          return inCorpus
            ? { ...base, status: 'FAIL', reason: `"${phrase}" must NOT appear in PDF but was found` }
            : { ...base, status: 'PASS', reason: `Correctly absent: "${phrase}" not in PDF` };
        } else {
          if (inCorpus) {
            const pos = searchInItems(items, phrase);
            return { ...base, status: 'PASS', reason: `"${phrase}" found in PDF`, page: pos.page, x: pos.x, y: pos.y, w: pos.w, h: pos.h };
          }
        }
      }
      return { ...base, status: 'FAIL', reason: `Expected content not found: "${tc.expectedResult.slice(0, 80)}"` };
    }

    // ── Boundary / Calculation ────────────────────────────────────────────────
    if (cat === 'boundary' || cat === 'calculation') {
      const expectedDate = tc.expectedResult.match(/\d{2}\/\d{2}\/\d{4}/)?.[0];
      if (expectedDate) {
        const found = corpus.includes(expectedDate);
        const pos = found ? searchInItems(items, expectedDate) : { page: null, x: null, y: null, w: null, h: null };
        return { ...base, status: found ? 'PASS' : 'FAIL', reason: found ? `Computed value ${expectedDate} found in PDF` : `Computed value ${expectedDate} not found in PDF`, ...pos };
      }
      return { ...base, status: 'NA', reason: 'Cannot deterministically verify this boundary case without a computed expected value' };
    }

    // ── Happy Path / Format / Mandatory ──────────────────────────────────────
    const fieldLookup = lookupField(tc.field, flatData);
    if (!fieldLookup) {
      return { ...base, status: 'NA', reason: `"${tc.field}" not found in input data — test not applicable for this data file` };
    }

    const { value } = fieldLookup;
    const pos = searchInItems(items, value);

    if (!pos.found) {
      // Check for rendering artifact: double-$ currency prefix
      if (value.startsWith('$')) {
        const nearPos = searchInItems(items, '$' + value);
        if (nearPos.found) {
          return {
            ...base, status: 'FAIL',
            reason: `Rendering issue: PDF contains "${'$' + value}" but input data has "${value}" (double dollar sign)`,
            page: nearPos.page, x: nearPos.x, y: nearPos.y, w: nearPos.w, h: nearPos.h,
          };
        }
      }
      return { ...base, status: 'FAIL', reason: `Value "${value}" not found in PDF` };
    }

    // Value present — format check
    const fmt = extractFormatPattern(tc.expectedResult);
    if (fmt && !fmt.pattern.test(value)) {
      return {
        ...base, status: 'FAIL',
        reason: `Value "${value}" does not match required format: ${fmt.label}`,
        page: pos.page, x: pos.x, y: pos.y, w: pos.w, h: pos.h,
      };
    }

    return {
      ...base, status: 'PASS',
      reason: `Value "${value}" present in PDF${fmt ? ` — ${fmt.label} format confirmed` : ''}`,
      page: pos.page, x: pos.x, y: pos.y, w: pos.w, h: pos.h,
    };
  });
}

// ─── Applicability Pre-filter ─────────────────────────────────────────────────

function isApplicable(tc: TestCase, flatData: Record<string, string>): boolean {
  const inputLc = tc.inputData.toLowerCase().trim();
  const expectLc = tc.expectedResult.toLowerCase().trim();

  if (inputLc.startsWith('user action:') || expectLc.startsWith('error displayed')) return false;
  if (inputLc === '(empty)' || inputLc === 'null') return false;

  const cat = tc.category.toLowerCase();

  if (cat === 'conditional') {
    const cond = parseCondition(tc.inputData);
    if (!cond || cond.condField.toLowerCase().startsWith('user action')) return false;
    return evaluateCondition(cond.condField, cond.condValue, flatData) !== null;
  }

  // boundary, calculation, happy path, format, mandatory — field must exist in data
  return lookupField(tc.field, flatData) !== null;
}

// ─── AI Validator ─────────────────────────────────────────────────────────────

async function validateWithAI(
  testCases: TestCase[],
  flatData: Record<string, string>,
  corpus: string,
  rulesText: string,
  provider: string,
  apiKey?: string,
): Promise<ValidationResult[]> {
  const dataLines = Object.entries(flatData).map(([k, v]) => `  ${k}: ${v}`).join('\n');
  const tcLines = testCases.map(tc =>
    `${tc.id} [${tc.category}] "${tc.field}"\n  Input: ${tc.inputData}\n  Expected: ${tc.expectedResult}`
  ).join('\n\n');

  const prompt = `You are validating a rendered PDF document against test cases. The PDF was generated from the input data below.

PDF TEXT CONTENT (extracted):
---
${corpus.slice(0, 8000)}
---

INPUT DATA (fields used to generate the PDF):
---
${dataLines}
---
${rulesText ? `\nBUSINESS RULES (for context):\n---\n${rulesText.slice(0, 2000)}\n---\n` : ''}
TEST CASES:
---
${tcLines}
---

VALIDATION RULES:
- Status must be "PASS", "FAIL", or "NA"
- "Error displayed" expected results → NA (PDFs don't show form validation errors)
- "User Action:" input conditions → NA (behavioural, not data-driven)
- "(empty)" or "null" inputs → NA unless testing presence/absence in PDF
- Conditional tests: evaluate condition against input data first; if not triggered → NA
- Format tests: find the field value in PDF, verify the format matches expected
- Boundary/calculation: compute expected result and verify it appears in PDF
- Near-miss rendering issues (e.g. "$$1,200.00" in PDF vs "$1,200.00" in data) → FAIL with explanation

Return ONLY a JSON array — no markdown, no explanation:
[{"id":"TC-001","status":"PASS","reason":"one sentence","page":1}]`;

  let rawJson: string;
  if (provider === 'claude') {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('No Claude API key configured. Add one in Settings.');
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await resp.json() as any;
    rawJson = data.content?.[0]?.text ?? '[]';
    rawJson = rawJson.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  } else {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('No Gemini API key configured. Add one in Settings.');
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      },
    );
    const gData = await resp.json() as any;
    rawJson = gData.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
  }

  const parsed = JSON.parse(rawJson) as Array<{ id: string; status: string; reason: string; page?: number }>;
  const byId = new Map(parsed.map(r => [r.id, r]));

  return testCases.map(tc => {
    const r = byId.get(tc.id);
    return {
      id: tc.id, field: tc.field, category: tc.category, description: tc.description,
      status: (r?.status ?? 'NA') as 'PASS' | 'FAIL' | 'NA',
      reason: r?.reason ?? 'Not evaluated by AI',
      page: r?.page ?? null, x: null, y: null, w: null, h: null,
    };
  });
}

// ─── PDF Annotator (pdf-lib) ──────────────────────────────────────────────────

async function buildAnnotatedPdf(
  pdfBytes: Buffer,
  fieldMap: FieldMatch[],
  results: ValidationResult[],
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();

  // Determine worst status per field name
  const fieldStatus = new Map<string, 'PASS' | 'FAIL' | 'NA'>();
  for (const r of results) {
    const prev = fieldStatus.get(r.field);
    if (!prev || r.status === 'FAIL' || (r.status === 'PASS' && prev === 'NA')) {
      fieldStatus.set(r.field, r.status);
    }
  }

  const resultsByField = new Map<string, ValidationResult[]>();
  for (const r of results) {
    if (!resultsByField.has(r.field)) resultsByField.set(r.field, []);
    resultsByField.get(r.field)!.push(r);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function addAnnotToPage(pageIdx: number, annotDict: Record<string, any>): void {
    if (pageIdx < 0 || pageIdx >= pages.length) return;
    const page = pages[pageIdx];
    const ref = pdfDoc.context.register(pdfDoc.context.obj(annotDict));
    const existing = page.node.get(PDFName.of('Annots'));
    if (existing instanceof PDFArray) {
      existing.push(ref);
    } else {
      page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([ref]));
    }
  }

  // Annotate matched fields
  for (const fm of fieldMap) {
    if (!fm.found || fm.page == null || fm.x == null || fm.y == null) continue;
    const pageIdx = fm.page - 1;
    const page = pages[pageIdx];
    if (!page) continue;

    const status = fieldStatus.get(fm.field) ?? 'NA';
    const fillColor = status === 'PASS' ? rgb(0, 0.75, 0.2) : status === 'FAIL' ? rgb(0.9, 0.1, 0.1) : rgb(0.5, 0.5, 0.5);
    const noteColor = status === 'PASS' ? [0, 0.6, 0] : status === 'FAIL' ? [0.8, 0, 0] : [0.4, 0.4, 0.4];
    const w = Math.max(fm.w ?? 50, 20);
    const h = Math.max(fm.h ?? 10, 8);

    // Coloured rectangle over the matched text
    page.drawRectangle({ x: fm.x, y: fm.y, width: w, height: h, color: fillColor, opacity: 0.2, borderWidth: 1, borderColor: fillColor, borderOpacity: 0.6 });

    // Sticky-note annotation with test case results
    const relatedResults = resultsByField.get(fm.field) ?? [];
    const noteLines = relatedResults.length > 0
      ? relatedResults.map(r => `[${r.status}] ${r.id}: ${r.reason}`).join('\n')
      : `${fm.field} = ${fm.value} (${fm.matchType === 'near' ? 'near-match — rendering issue' : 'matched'})`;

    addAnnotToPage(pageIdx, {
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Text'),
      Rect: pdfDoc.context.obj([fm.x + w + 2, fm.y + h, fm.x + w + 18, fm.y + h + 16]),
      Contents: PDFString.of(noteLines),
      Name: PDFName.of('Comment'),
      Open: false,
      C: pdfDoc.context.obj(noteColor),
    });
  }

  // Unlocated FAIL results → margin sticky note on page 1
  const unlocated = results.filter(r => r.status === 'FAIL' && r.page == null);
  if (unlocated.length > 0) {
    const noteText = unlocated.map(r => `[FAIL] ${r.id} (${r.field}): ${r.reason}`).join('\n');
    addAnnotToPage(0, {
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Text'),
      Rect: pdfDoc.context.obj([8, 8, 24, 24]),
      Contents: PDFString.of(`Unlocated failures:\n${noteText}`),
      Name: PDFName.of('Note'),
      Open: false,
      C: pdfDoc.context.obj([0.8, 0, 0]),
    });
  }

  return Buffer.from(await pdfDoc.save());
}

// ─── Route: POST /validate ────────────────────────────────────────────────────

const validateUpload = upload.fields([
  { name: 'pdf', maxCount: 1 },
  { name: 'data', maxCount: 1 },
  { name: 'rules', maxCount: 1 },
  { name: 'testcases', maxCount: 1 },
]);

router.post('/validate', validateUpload, async (req: Request, res: Response) => {
  try {
    const files = req.files as Record<string, Express.Multer.File[]>;
    const pdfFile = files['pdf']?.[0];
    const dataFile = files['data']?.[0];
    const testcasesFile = files['testcases']?.[0];
    const rulesFile = files['rules']?.[0];
    const { mode = 'deterministic', provider = 'gemini', apiKey } = req.body;

    if (!pdfFile || !dataFile || !testcasesFile) {
      res.status(400).json({ error: 'pdf, data, and testcases files are required' });
      return;
    }

    const { corpus, items } = await extractTextItems(pdfFile.buffer);
    const ext = path.extname(dataFile.originalname).toLowerCase();
    const flatData = flattenData(dataFile.buffer.toString('utf8'), ext);
    const tcRows = parseCsvRows(testcasesFile.buffer.toString('utf8'));
    const testCases: TestCase[] = tcRows
      .map(r => ({
        id: r['Test Case ID'] ?? '',
        field: r['Field / Section'] ?? '',
        category: r['Category'] ?? '',
        description: r['Test Description'] ?? '',
        inputData: r['Input Data'] ?? '',
        expectedResult: r['Expected Result'] ?? '',
        priority: r['Priority'] ?? '',
      }))
      .filter(tc => tc.id);

    const fieldMap = buildFieldMap(flatData, items);
    const rulesText = rulesFile ? rulesFile.buffer.toString('utf8') : '';

    const applicable = testCases.filter(tc => isApplicable(tc, flatData));
    const skipped = testCases.length - applicable.length;

    let tcResults: ValidationResult[];
    if (mode === 'ai') {
      tcResults = await validateWithAI(applicable, flatData, corpus, rulesText, provider, apiKey);
    } else {
      tcResults = validateDeterministic(applicable, flatData, items, corpus);
    }

    const additionalResults = buildAdditionalResults(fieldMap, tcResults);
    const results = [...tcResults, ...additionalResults];

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const summary = {
      total: results.length,
      passed,
      failed,
      na: results.filter(r => r.status === 'NA').length,
      skipped,
    };

    res.json({ summary, fieldMap, results });
  } catch (err: any) {
    console.error('[pdf-validator] validate error', err);
    res.status(500).json({ error: err.message ?? 'Validation failed' });
  }
});

// ─── Route: POST /annotate ────────────────────────────────────────────────────

router.post('/annotate', upload.single('pdf'), async (req: Request, res: Response) => {
  try {
    const pdfFile = req.file;
    if (!pdfFile) { res.status(400).json({ error: 'pdf file required' }); return; }

    const fieldMap: FieldMatch[] = JSON.parse(req.body.fieldMap ?? '[]');
    const results: ValidationResult[] = JSON.parse(req.body.results ?? '[]');

    const annotated = await buildAnnotatedPdf(pdfFile.buffer, fieldMap, results);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'attachment; filename="validated-annotated.pdf"');
    res.send(annotated);
  } catch (err: any) {
    console.error('[pdf-validator] annotate error', err);
    res.status(500).json({ error: err.message ?? 'Annotation failed' });
  }
});

export default router;
