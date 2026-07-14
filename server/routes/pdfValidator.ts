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

// ─── Context Applicability Check ─────────────────────────────────────────────

// Generic structural words that appear in almost every XML schema or document —
// not useful for determining whether a field belongs in a specific document type.
const GENERIC_FIELD_WORDS = new Set([
  // Structural XML field names
  'name', 'date', 'code', 'type', 'text', 'value', 'data', 'info',
  'first', 'last', 'full', 'start', 'time', 'list', 'item', 'root',
  'base', 'main', 'from', 'bool', 'flag', 'mode', 'sort', 'true', 'null',
  // Common business / document words that appear in almost any document type
  'amount', 'total', 'count', 'number', 'detail', 'details', 'status',
  'result', 'reason', 'source', 'target', 'field', 'label', 'title',
  'group', 'class', 'level', 'order', 'price', 'rate', 'note', 'notes',
  'address', 'contact', 'phone', 'email', 'settled', 'settlement',
  'payment', 'record', 'entry', 'index', 'range', 'limit', 'section',
  'description', 'message', 'subject', 'content', 'format', 'output',
  'input', 'state', 'line', 'page', 'size', 'area', 'zone', 'each',
]);

function extractDomainWords(field: string): string[] {
  // Use only the leaf field name — NOT the full xmlKey path.
  // Parent element names (e.g. "ClaimDetails" in "ClaimDetails.settled-amount") inject
  // words like "claim" that appear legitimately in unrelated document sections (e.g.
  // "file a claim" in a welcome letter), producing false-positive context matches.
  const words = field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-\.]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !GENERIC_FIELD_WORDS.has(w));
  return [...new Set(words)];
}

// A missing field is contextually applicable only if at least one specific domain
// word from its leaf name appears in the PDF corpus.
// If no domain words survive the generic filter, the field name is too generic to
// infer context — skip it rather than raising a false positive.
function isContextApplicable(fm: FieldMatch, corpusLc: string): boolean {
  const domainWords = extractDomainWords(fm.field);
  if (domainWords.length === 0) return false; // All words are generic — cannot determine context, skip
  return domainWords.some(w => corpusLc.includes(w));
}

// ─── Additional Results (field coverage + unexpected bugs) ────────────────────

function buildAdditionalResults(
  fieldMap: FieldMatch[],
  existingResults: ValidationResult[],
  corpus: string,
): ValidationResult[] {
  const covered = new Set<string>();
  for (const r of existingResults) {
    covered.add(r.field.toLowerCase().replace(/[\s\-_\/]/g, ''));
  }

  const corpusLc = corpus.toLowerCase();
  const additional: ValidationResult[] = [];
  let fcIdx = 1;
  let bfIdx = 1;

  for (const fm of fieldMap) {
    const norm = fm.field.toLowerCase().replace(/[\s\-_\/]/g, '');
    if (covered.has(norm)) continue; // Already validated by a test case

    if (fm.matchType === 'exact') {
      // Value found in PDF — always a valid field coverage PASS regardless of context
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
      // Near-match means the PDF did render this field (just with a rendering artifact).
      // Context is confirmed — always flag as a bug.
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
      // Value is missing. Only flag as a bug if the field's domain is contextually
      // relevant to this PDF (i.e., at least one domain word from the field name/path
      // appears in the PDF text). Fields from unrelated domains (e.g. a claim
      // adjudicator field in a welcome letter) are silently skipped.
      if (!isContextApplicable(fm, corpusLc)) continue;
      additional.push({
        id: `BF-${String(bfIdx++).padStart(3, '0')}`,
        field: fm.field,
        category: 'Bug Finding',
        description: `Field "${fm.field}" is referenced in this document's context but its value is missing from the PDF`,
        status: 'FAIL',
        reason: `Value "${fm.value}" not found in PDF`,
        page: null, x: null, y: null, w: null, h: null,
      });
    }
  }

  return additional;
}

// ─── Output Issue Detector ────────────────────────────────────────────────────

// Pattern-based checks — always run regardless of mode.
function detectOutputIssues(corpus: string, items: TextItem[]): ValidationResult[] {
  const issues: ValidationResult[] = [];
  const seen = new Set<string>();

  const check = (
    pattern: RegExp,
    field: string,
    describe: (m: string) => string,
    explain: (m: string) => string,
  ) => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(corpus)) !== null) {
      const raw = match[0];
      const key = `${field}:${raw.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const loc = searchInItems(items, raw.trim());
      issues.push({
        id: '',  // renumbered after merge
        field,
        category: 'Output Issue',
        description: describe(raw),
        status: 'FAIL',
        reason: explain(raw),
        page: loc.page, x: loc.x, y: loc.y, w: loc.w, h: loc.h,
      });
    }
  };

  // Double dollar sign — variable substitution artifact ($$1,200.00)
  check(
    /\$\$[\d,]+(?:\.\d{2})?/g,
    'Double Dollar Sign',
    m => `Currency rendered with double $ sign: "${m}"`,
    m => `"${m}" appears in PDF — the $ currency symbol was doubled during variable substitution`,
  );

  // Repeated consecutive words (3+ char words, case-insensitive)
  check(
    /\b([A-Za-z]{3,})\s+\1\b/gi,
    'Repeated Word',
    m => `Word repeated consecutively: "${m.trim()}"`,
    m => `"${m.trim().split(/\s+/)[0]}" appears twice in a row — possible copy-paste or merge artifact`,
  );

  // Unresolved template placeholders left in the output
  check(
    /\{[A-Z][A-Z0-9_]{1,}\}|\[\[[A-Za-z][A-Za-z0-9_\s]{1,}\]\]/g,
    'Unresolved Placeholder',
    m => `Unresolved placeholder in PDF: "${m}"`,
    m => `"${m}" was not substituted — the template variable may be missing from the input data`,
  );

  // Double punctuation (e.g. ".." or ",," or "!!" that aren't ellipsis "...")
  check(
    /(?<!\.)\.\.(?!\.)|\,\,|!!|\?\?/g,
    'Double Punctuation',
    m => `Double punctuation mark: "${m}"`,
    m => `"${m}" appears in PDF — likely a formatting or concatenation error`,
  );

  return issues;
}

// AI document quality analysis — tone, completeness, missing blocks, suggestions.
interface DocumentAnalysis {
  tone: string;
  toneNotes: string;
  completeness: number;
  completenessNotes: string;
  missingBlocks: string[];
  suggestions: string[];
  overallQuality: 'Good' | 'Acceptable' | 'Needs Review';
}

async function analyzeDocumentQuality(
  corpus: string,
  provider: string,
  apiKey?: string,
): Promise<DocumentAnalysis | null> {
  const prompt = `You are a document quality analyst reviewing a rendered PDF from a Customer Communication Management (CCM) system.

PDF TEXT:
---
${corpus.slice(0, 8000)}
---

Analyze this document and return a single JSON object with these keys:
- "tone": one short phrase describing the overall tone (e.g. "Formal and professional", "Friendly and conversational", "Legal and technical")
- "toneNotes": 1-2 sentences on whether the tone is appropriate for the apparent document type and any inconsistencies
- "completeness": integer 0-100 — how structurally complete the document appears for its type (100 = all expected sections present)
- "completenessNotes": one sentence explaining the completeness score
- "missingBlocks": array of strings listing key sections or information blocks that appear absent (e.g. "Contact information", "Signature block", "Disclaimer", "Effective date", "Grievance procedure"). Empty array if nothing is clearly missing.
- "suggestions": array of up to 5 specific, actionable improvement suggestions for wording, structure, or clarity. Empty array if none.
- "overallQuality": exactly one of "Good", "Acceptable", or "Needs Review"

Return ONLY valid JSON — no markdown fences, no explanation:
{"tone":"...","toneNotes":"...","completeness":85,"completenessNotes":"...","missingBlocks":[],"suggestions":[],"overallQuality":"Good"}`;

  try {
    let rawJson: string;
    if (provider === 'claude') {
      const key = apiKey || process.env.ANTHROPIC_API_KEY;
      if (!key) return null;
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await resp.json() as any;
      rawJson = (data.content?.[0]?.text ?? '{}').replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    } else {
      const key = apiKey || process.env.GEMINI_API_KEY;
      if (!key) return null;
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
      rawJson = gData.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    }
    const parsed = JSON.parse(rawJson) as DocumentAnalysis;
    return parsed;
  } catch {
    return null;
  }
}

// AI-powered proofreading — runs in AI mode only, catches spelling/grammar/style issues.
async function detectOutputIssuesWithAI(
  corpus: string,
  provider: string,
  apiKey?: string,
): Promise<Array<{ field: string; description: string; excerpt: string; reason: string }>> {
  const prompt = `You are a document quality reviewer. Check this PDF text for output quality issues.

PDF TEXT:
---
${corpus.slice(0, 6000)}
---

Find ONLY high-confidence issues in these categories:
- Spelling mistakes (genuine typos — NOT proper nouns, brand names, or technical terms)
- Grammar errors (missing words, wrong tense, broken sentence structure, subject-verb disagreement)
- Punctuation errors (missing full stops, double punctuation not caught by pattern scanning)
- Formatting artifacts (garbled text, broken mid-word line breaks, visible template syntax not substituted)

DO NOT flag:
- Proper nouns, names, company names, product names, or place names
- Numbers, dates, currency amounts, reference codes, or IDs
- Industry-specific abbreviations or technical terms
- Content that reads naturally in context

Return a JSON array — empty array [] if nothing found:
[{"field":"Spelling Mistake","description":"one-line label","excerpt":"exact text from PDF (max 80 chars)","reason":"why this is wrong"}]`;

  try {
    let rawJson: string;
    if (provider === 'claude') {
      const key = apiKey || process.env.ANTHROPIC_API_KEY;
      if (!key) return [];
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await resp.json() as any;
      rawJson = (data.content?.[0]?.text ?? '[]').replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    } else {
      const key = apiKey || process.env.GEMINI_API_KEY;
      if (!key) return [];
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
    return JSON.parse(rawJson) as Array<{ field: string; description: string; excerpt: string; reason: string }>;
  } catch {
    return [];
  }
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

    // Sticky-note annotation — rich context
    const relatedResults = resultsByField.get(fm.field) ?? [];
    const matchDesc = fm.matchType === 'exact'
      ? 'Exact match found in PDF'
      : fm.matchType === 'near'
      ? 'Near-match: rendering artifact (double $ prefix detected)'
      : 'Value not found anywhere in PDF';

    const header = [
      `Field: ${fm.field}`,
      `Data value: ${fm.value}`,
      `XML path: ${fm.xmlKey}`,
      `PDF match: ${matchDesc}`,
      fm.page != null ? `Location: Page ${fm.page}` : '',
    ].filter(Boolean).join('\n');

    const tcSection = relatedResults.length > 0
      ? '\n\n--- Validation Results ---\n' + relatedResults.map(r =>
          `[${r.status}] ${r.id} (${r.category})\n  ${r.description}\n  Outcome: ${r.reason}`
        ).join('\n\n')
      : '\n\nNo test cases cover this field.\nField coverage check only.';

    const noteLines = header + tcSection;

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

  // Annotate located OID output issues with purple highlights + sticky notes
  const purple = rgb(0.5, 0.1, 0.8);
  const oidResults = results.filter(r => r.id.startsWith('OID-'));
  for (const oid of oidResults) {
    if (oid.page == null || oid.x == null || oid.y == null) continue;
    const pageIdx = oid.page - 1;
    const page = pages[pageIdx];
    if (!page) continue;

    const w = Math.max(oid.w ?? 60, 20);
    const h = Math.max(oid.h ?? 10, 8);

    page.drawRectangle({
      x: oid.x, y: oid.y, width: w, height: h,
      color: purple, opacity: 0.15,
      borderWidth: 1.5, borderColor: purple, borderOpacity: 0.8,
    });

    const noteText = [
      `${oid.id} — Output Issue`,
      `Type: ${oid.field}`,
      `Issue: ${oid.description}`,
      `Detail: ${oid.reason}`,
      `Location: Page ${oid.page}`,
    ].join('\n');

    addAnnotToPage(pageIdx, {
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Text'),
      Rect: pdfDoc.context.obj([oid.x + w + 2, oid.y + h, oid.x + w + 18, oid.y + h + 16]),
      Contents: PDFString.of(noteText),
      Name: PDFName.of('Comment'),
      Open: false,
      C: pdfDoc.context.obj([0.5, 0.1, 0.8]),
    });
  }

  // Unlocated validation FAIL results (TC-*, BF-*, FC-*) → red margin note on page 1
  const unlocated = results.filter(r => r.status === 'FAIL' && r.page == null && !r.id.startsWith('OID-'));
  if (unlocated.length > 0) {
    const noteText = `Unlocated Validation Failures (${unlocated.length})\nThese fields failed validation but could not be pinpointed in the PDF.\n\n`
      + unlocated.map(r =>
          `[FAIL] ${r.id} · ${r.category}\nField: ${r.field}\n${r.description}\nReason: ${r.reason}`
        ).join('\n\n');
    addAnnotToPage(0, {
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Text'),
      Rect: pdfDoc.context.obj([8, 8, 24, 24]),
      Contents: PDFString.of(noteText),
      Name: PDFName.of('Note'),
      Open: false,
      C: pdfDoc.context.obj([0.8, 0, 0]),
    });
  }

  // Unlocated OID output issues → separate purple margin note on page 1
  const unlocatedOid = oidResults.filter(r => r.page == null);
  if (unlocatedOid.length > 0) {
    const noteText = `Unlocated Output Issues (${unlocatedOid.length})\nThese output quality issues could not be pinpointed to a specific location.\n\n`
      + unlocatedOid.map(r =>
          `[${r.id}] ${r.field}\n${r.description}\nDetail: ${r.reason}`
        ).join('\n\n');
    addAnnotToPage(0, {
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Text'),
      Rect: pdfDoc.context.obj([8, 32, 24, 48]),
      Contents: PDFString.of(noteText),
      Name: PDFName.of('Note'),
      Open: false,
      C: pdfDoc.context.obj([0.5, 0.1, 0.8]),
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

    const additionalResults = buildAdditionalResults(fieldMap, tcResults, corpus);

    // Output quality issues + document analysis — pattern always; AI calls run in parallel
    const patternIssues = detectOutputIssues(corpus, items);
    const [aiRaw, documentAnalysis] = mode === 'ai'
      ? await Promise.all([
          detectOutputIssuesWithAI(corpus, provider, apiKey),
          analyzeDocumentQuality(corpus, provider, apiKey),
        ])
      : [[], null];

    const aiIssues: ValidationResult[] = (aiRaw as Array<{ field: string; description: string; excerpt: string; reason: string }>).map(p => {
      const loc = searchInItems(items, p.excerpt);
      return {
        id: '', field: p.field, category: 'Output Issue',
        description: p.description, status: 'FAIL', reason: p.reason,
        page: loc.page, x: loc.x, y: loc.y, w: loc.w, h: loc.h,
      };
    });
    const outputIssues = [...patternIssues, ...aiIssues].map((r, i) => ({
      ...r, id: `OID-${String(i + 1).padStart(3, '0')}`,
    }));

    const results = [...tcResults, ...additionalResults, ...outputIssues];

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const summary = {
      total: results.length,
      passed,
      failed,
      na: results.filter(r => r.status === 'NA').length,
      skipped,
    };

    res.json({ summary, fieldMap, results, documentAnalysis });
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
