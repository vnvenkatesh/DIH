import express, { Response } from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { randomUUID } from 'crypto';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import pool from '../db.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);

// ─────────── Types ───────────

interface MappingRow {
  fieldLabel: string;
  xsdPath: string;
  sampleValue: string;
  domain: string;
  fieldName: string;
  isDate: boolean;
}

interface GdInstruction {
  id: number;
  description: string;
  rootNode: string;
  rootguid: string;
  nodeName: string;
  nodeGuid: string;
}

interface ResolvedNode {
  domain: string;
  domainGuid: string;
  nodeName: string;
  nodeGuid: string;
}

interface DetectedVariable {
  fillPointId: number;
  row: MappingRow;
  searchText: string;
  detectionMethod: 'placeholder' | 'sampleValue';
  resolved?: ResolvedNode;
}

// ─────────── CSV Parser ───────────

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      fields.push(field); field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

function parseMappingCsv(text: string): MappingRow[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];
  const rows: MappingRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvRow(line);
    if (cols.length < 3) continue;
    const fieldLabel = cols[0]?.trim() ?? '';
    const xsdPath = cols[1]?.trim() ?? '';
    const sampleValue = cols[2]?.trim() ?? '';
    if (!fieldLabel || !xsdPath || xsdPath.toLowerCase() === 'path not found') continue;
    rows.push({
      fieldLabel,
      xsdPath,
      sampleValue,
      domain: deriveDomain(xsdPath),
      fieldName: deriveFieldName(xsdPath),
      isDate: false,
    });
  }
  return rows;
}

// ─────────── Path Derivation ───────────

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function deriveDomain(xsdPath: string): string {
  const parts = xsdPath.split('/').filter(Boolean);
  return parts.length >= 2 ? toPascalCase(parts[1]) : 'Unknown';
}

function deriveFieldName(xsdPath: string): string {
  const parts = xsdPath.split('/').filter(Boolean);
  const remaining = parts.slice(2); // skip 'root' and domain
  if (remaining.length === 0) return 'Value';
  return remaining.map(toPascalCase).join('');
}

// ─────────── XSD Date Detection ───────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectDateFields(xsdText: string, rows: MappingRow[]): void {
  for (const row of rows) {
    const leafName = row.xsdPath.split('/').pop() ?? '';
    const re = new RegExp(`name=["']${escapeRegex(leafName)}["'][^>]*type=["']xs:date["']`);
    row.isDate = re.test(xsdText);
  }
}

// ─────────── Variable Detection ───────────

function detectVariables(
  rawText: string,
  rows: MappingRow[]
): { detected: DetectedVariable[]; skipped: string[] } {
  const detected: DetectedVariable[] = [];
  const skipped: string[] = [];
  let fillPointId = 1;

  for (const row of rows) {
    let searchText: string | null = null;
    let detectionMethod: 'placeholder' | 'sampleValue' = 'sampleValue';

    // Angle-bracket placeholder pattern: <something>
    const placeholderMatch = row.fieldLabel.match(/^<(.+)>$/);
    if (placeholderMatch && rawText.includes(row.fieldLabel)) {
      searchText = row.fieldLabel;
      detectionMethod = 'placeholder';
    }

    // Fallback: sample value
    if (!searchText && row.sampleValue && rawText.includes(row.sampleValue)) {
      searchText = row.sampleValue;
      detectionMethod = 'sampleValue';
    }

    if (searchText) {
      detected.push({ fillPointId: fillPointId++, row, searchText, detectionMethod });
    } else {
      skipped.push(row.fieldLabel);
    }
  }
  return { detected, skipped };
}

// ─────────── HTML Variable Substitution ───────────

function applySubstitutionsToHtml(html: string, variables: DetectedVariable[]): string {
  let result = html;
  for (const v of variables) {
    const marker = `%[${v.fillPointId}]`;
    if (v.detectionMethod === 'placeholder') {
      // Angle-bracket placeholders are HTML-encoded by mammoth
      const encoded = v.searchText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      result = result.split(encoded).join(marker);
    } else {
      result = result.split(v.searchText).join(marker);
    }
  }
  return result;
}

// ─────────── HTML Preprocessing ───────────

function preprocessHtml(html: string): string {
  // Ensure empty paragraphs produce visible blank lines in RTF.
  // GhostDraft collapses paragraphs with no content, so inject a
  // non-breaking space (&#160;) so the paragraph has renderable content.
  return html
    .replace(/<p>\s*<\/p>/g, '<p>&#160;</p>')
    .replace(/<p>\s*<br\s*\/?>\s*<\/p>/g, '<p>&#160;</p>');
}

// ─────────── HTML → RTF ───────────

// Embed a base64 image (from mammoth's HTML output) as an RTF \pict block.
function imageToRtf(tagContent: string): string {
  const srcMatch = tagContent.match(/src="([^"]+)"/);
  if (!srcMatch) return '';

  const src = srcMatch[1];
  if (!src.startsWith('data:')) return '';

  const semiIdx = src.indexOf(';');
  const commaIdx = src.indexOf(',');
  if (semiIdx < 0 || commaIdx < 0 || src.slice(semiIdx + 1, commaIdx) !== 'base64') return '';

  const mimeType = src.slice(5, semiIdx);
  let picType: string;
  if (mimeType === 'image/png') picType = '\\pngblip';
  else if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') picType = '\\jpegblip';
  else return ''; // unsupported type

  const binary = Buffer.from(src.slice(commaIdx + 1), 'base64');
  const hexData = binary.toString('hex');

  let width = 0, height = 0;

  if (mimeType === 'image/png' && binary.length >= 24) {
    // PNG IHDR: 8-byte signature + 4-byte length + 4-byte 'IHDR' + width (4) + height (4)
    width = binary.readUInt32BE(16);
    height = binary.readUInt32BE(20);
  } else if (binary.length > 10) {
    // JPEG: scan for SOF0/SOF1/SOF2 marker (FF C0–C3, C5–C7)
    let i = 2; // skip SOI marker (FF D8)
    while (i + 3 < binary.length && i < 65536) {
      if (binary[i] !== 0xFF) break;
      const marker = binary[i + 1];
      if (marker === 0xD9) break; // EOI
      const segLen = binary.readUInt16BE(i + 2);
      if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7)) {
        height = binary.readUInt16BE(i + 5);
        width = binary.readUInt16BE(i + 7);
        break;
      }
      i += 2 + segLen;
    }
  }

  // Fallback: try style attribute (mammoth may include pt dimensions)
  if (width === 0) {
    const styleMatch = tagContent.match(/style="([^"]+)"/);
    if (styleMatch) {
      const wm = styleMatch[1].match(/width:\s*([\d.]+)pt/);
      const hm = styleMatch[1].match(/height:\s*([\d.]+)pt/);
      if (wm) width = Math.round(parseFloat(wm[1]) * 96 / 72);
      if (hm) height = Math.round(parseFloat(hm[1]) * 96 / 72);
    }
    if (width === 0) { width = 200; height = 60; }
  }

  // Dimensions: px → twips (96 dpi = 1440 twips/inch → 15 twips/px)
  const wTwips = width * 15;
  const hTwips = height * 15;

  return `{\\pict${picType}\\picw${width}\\pich${height}\\picwgoal${wTwips}\\pichgoal${hTwips}\n${hexData}\n}`;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function escapeRtfText(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '{') out += '\\{';
    else if (ch === '}') out += '\\}';
    else if (ch === '\n') out += '\\line\n';  // retain line breaks
    else if (ch === '\r') out += '';           // skip lone CR
    else if (code > 127) out += `\\u${code}?`;
    else out += ch;
  }
  return out;
}

interface HtmlToken {
  type: 'tag' | 'text';
  content: string;
}

function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const regex = /(<[^>]+>)|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    if (m[1]) tokens.push({ type: 'tag', content: m[1] });
    else if (m[2] && m[2].trim()) tokens.push({ type: 'text', content: m[2] });
  }
  return tokens;
}

function parseTag(tagStr: string): { tagName: string; isClosing: boolean; isSelfClosing: boolean } {
  const isSelfClosing = tagStr.endsWith('/>');
  const inner = tagStr.slice(1, isSelfClosing ? -2 : -1).trim();
  const isClosing = inner.startsWith('/');
  const content = inner.replace(/^\//, '').trim();
  const spaceIdx = content.search(/[\s/>]/);
  const tagName = (spaceIdx === -1 ? content : content.slice(0, spaceIdx)).toLowerCase();
  return { tagName, isClosing, isSelfClosing };
}

function htmlToRtf(html: string): string {
  const tokens = tokenizeHtml(html);
  const parts: string[] = [];

  const header = [
    '{\\rtf1 \\adeflang1025\\uc1\\deflang1033 ',
    '{\\fonttbl{\\f0 Times New Roman;}{\\f1 Symbol;}{\\f2 Arial;}{\\f3 Calibri;}}',
    '{\\colortbl;\\red0\\green0\\blue0;\\red0\\green112\\blue192;}',
    '\\f3\\fs22\n',
  ].join('');
  parts.push(header);

  let inTable = false;
  let cellCount = 0;

  for (const tok of tokens) {
    if (tok.type === 'text') {
      const text = decodeHtmlEntities(tok.content);
      parts.push(escapeRtfText(text));
      continue;
    }

    const { tagName, isClosing, isSelfClosing } = parseTag(tok.content);

    if (tagName === 'br') {
      parts.push('\\line\n');
      continue;
    }

    if (isSelfClosing) {
      if (tagName === 'img') {
        const rtfImg = imageToRtf(tok.content);
        if (rtfImg) parts.push(rtfImg);
      }
      // other self-closing tags (hr, input, meta…) are ignored
      continue;
    }

    if (isClosing) {
      switch (tagName) {
        case 'p': case 'div': case 'h1': case 'h2': case 'h3':
        case 'h4': case 'h5': case 'h6':
          parts.push('\\par\n');
          break;
        case 'strong': case 'b': parts.push('\\b0 '); break;
        case 'em': case 'i': parts.push('\\i0 '); break;
        case 'u': parts.push('\\ulnone '); break;
        case 'li': parts.push('\\par\n'); break;
        case 'a': parts.push('\\cf0\\ulnone }'); break;
        case 'td': case 'th':
          parts.push(cellCount < 4 ? '\\tab ' : '\\par\n');
          cellCount++;
          break;
        case 'tr':
          parts.push('\\par\n');
          cellCount = 0;
          break;
        case 'table':
          inTable = false;
          break;
      }
      continue;
    }

    // Opening tag
    switch (tagName) {
      case 'p': case 'div':
        parts.push('\\pard\\plain\\f3\\fs22 ');
        break;
      case 'h1': case 'h2':
        parts.push('\\pard\\plain\\f3\\fs28\\b ');
        break;
      case 'h3': case 'h4':
        parts.push('\\pard\\plain\\f3\\fs24\\b ');
        break;
      case 'h5': case 'h6':
        parts.push('\\pard\\plain\\f3\\fs22\\b ');
        break;
      case 'strong': case 'b': parts.push('\\b '); break;
      case 'em': case 'i': parts.push('\\i '); break;
      case 'u': parts.push('\\ul '); break;
      case 'li': parts.push('\\pard\\plain\\f3\\fs22  \\bullet  '); break;
      case 'table':
        inTable = true;
        cellCount = 0;
        break;
      case 'tr':
        parts.push('\\pard\\plain\\f3\\fs22 ');
        cellCount = 0;
        break;
      case 'a':
        parts.push('{\\cf2\\ul ');
        break;
    }
    // suppress unused warning
    void inTable;
  }

  parts.push('}');
  return parts.join('');
}

// ─────────── Sample XML Builder ───────────

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSampleXml(rows: MappingRow[]): string {
  const tree: Record<string, unknown> = {};

  for (const row of rows) {
    const parts = row.xsdPath.split('/').filter(Boolean);
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (typeof node[part] !== 'object' || node[part] === null) {
        node[part] = {};
      }
      node = node[part] as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1];
    if (node[leaf] === undefined) {
      node[leaf] = row.sampleValue;
    }
  }

  function serialize(obj: Record<string, unknown>, indent = ''): string {
    return Object.entries(obj)
      .map(([key, val]) => {
        if (typeof val === 'string') {
          return `${indent}<${key}>${xmlEscape(val)}</${key}>`;
        }
        if (typeof val === 'object' && val !== null) {
          return `${indent}<${key}>\n${serialize(val as Record<string, unknown>, indent + '  ')}\n${indent}</${key}>`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return `<?xml version="1.0" encoding="utf-8"?>\n${serialize(tree)}`;
}

// ─────────── GD XML Assembler ───────────

const ANNOTATION_STYLE_MAP = `      <annotationStyleMap libraryid="64d5b3c3-056a-4f4e-b063-35f84e13f3ec" xmlns="http://schemas.korbitec.com/GhostDraft/MarkupModel/1.0">
        <style name="Base" link="5861d72c-0f90-41ef-91f7-e6dde7aaa479" />
        <style name="Header" link="4c707a58-d12f-41f7-a4ac-067b0d711459" />
        <style name="Text" link="ad0e39df-76bf-4c35-88e9-c78c8301d418" />
        <style name="Numbered Paragraph" link="a4ddaff6-4227-4cd0-8853-39f1fe357a44" />
        <style name="Deviation" link="ad400cf5-d19f-4f5c-917a-567bb346ec6c" />
        <style name="Mandatory Data" link="d734846a-5b4f-4c73-9bdf-c144a7a834cf" />
        <style name="Markup" link="f047ba57-bc79-447d-ab26-a63d4aa35993" />
        <style name="Query" link="e507a731-9fd5-45cc-afca-1e550a85cae6" />
        <style name="Spec" link="9fc45df1-c6a9-4d88-a2db-5e4f7dbb82d8" />
        <style name="TO DO" link="8c8dfcf9-072a-4d5a-b065-aa3dbe7406ed" />
        <style name="Bulleted Paragraph" link="d1849d41-d7df-4683-970d-b7eb9330d96c" />
        <style name="Emphasis" link="30d6d26d-bb94-435f-bc87-435b4c4f62e4" />
        <style name="Author" link="506508d3-d512-490f-b40e-cca26bca9822" />
      </annotationStyleMap>`;

const EXPLANATION_RTF = `{\\rtf1 \\adeflang1025\\uc1\\deflang1033 {\\fonttbl{\\f0 Times New Roman;}{\\f1 Symbol;}{\\f2 Arial;}{\\f3 Calibri;}}\\f3\\fs22 }`;

function buildGdXml(docName: string, rtfContent: string, variables: DetectedVariable[]): string {
  // Collect unique domain GUIDs — prefer resolved (from .gd), else generate fresh
  const domainGuids = new Map<string, string>();
  const fieldGuids = new Map<string, string>();

  for (const v of variables) {
    const domain = v.resolved?.domain ?? v.row.domain;
    const nodeName = v.resolved?.nodeName ?? v.row.fieldName;

    if (!domainGuids.has(domain)) {
      domainGuids.set(domain, v.resolved?.domainGuid ?? randomUUID());
    }
    const fk = `${domain}.${nodeName}`;
    if (!fieldGuids.has(fk)) {
      fieldGuids.set(fk, v.resolved?.nodeGuid ?? randomUUID());
    }
  }

  const instructions = variables.map(v => {
    const domain = v.resolved?.domain ?? v.row.domain;
    const nodeName = v.resolved?.nodeName ?? v.row.fieldName;
    const domainGuid = domainGuids.get(domain)!;
    const fieldGuid = fieldGuids.get(`${domain}.${nodeName}`)!;
    const { isDate, xsdPath } = v.row;
    const leafElement = xsdPath.split('/').pop() ?? '';

    const description = isDate
      ? `DateToString([Policy.${domain.toLowerCase()}.${leafElement}],"mm/dd/yyyy")`
      : `${nodeName} of ${domain}`;

    return `          <instruction xsi:type="fillPointType" ID="${v.fillPointId}" descriptionSource="ParsedUserText">
            <description>${xmlEscape(description)}</description>
            <path conceptLibrary="Model Library">
              <rootNode>${xmlEscape(domain)}</rootNode>
              <rootguid>${domainGuid}</rootguid>
              <pathNodes>
                <node name="${xmlEscape(nodeName)}" guid="${fieldGuid}" />
              </pathNodes>
            </path>
            <adornmentPath conceptLibrary="" />
          </instruction>`;
  }).join('\n');

  const domainModels = Array.from(domainGuids.entries())
    .map(([domain, guid]) =>
      `        <domainmodel conceptlibrary="Model Library" major="0" minor="0" domainmodel="${xmlEscape(domain)}" domainmodelguid="${guid}" />`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<Content Name="GhostDraftDocument" Version="1.0" ApplicationVersion="GhostDraft 5.3.55828.0" CompatibleVersion="GhostDraft 3.3">
  <document xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://schemas.korbitec.com/GhostDraft/Document/1.0">
    <properties>
      <system xmlns="http://schemas.korbitec.com/GhostDraft/DocumentProperties/1.0">
        <property name="Title" type="string">
          <value>${xmlEscape(docName)}</value>
        </property>
        <property name="Author" type="string">
          <value>DIH GhostDraft Generator</value>
        </property>
      </system>
      <custom xmlns="http://schemas.korbitec.com/GhostDraft/DocumentProperties/1.0" />
    </properties>
    <content>
      <rtf>${rtfContent}</rtf>
      <bookmarks />
    </content>
    <library xsi:nil="true" />
    <markup>
      <markup ID="0" descriptionSource="ParsedUserText" xmlns="http://schemas.korbitec.com/GhostDraft/MarkupModel/1.0">
        <explanation>${EXPLANATION_RTF}</explanation>
        <instructions>
${instructions}
        </instructions>
      </markup>
${ANNOTATION_STYLE_MAP}
      <domainmodels xmlns="http://schemas.korbitec.com/GhostDraft/MarkupModel/1.0">
${domainModels}
      </domainmodels>
    </markup>
    <scenarios default="Scenario">
      <scenario defaultListCount="2" defaultTestValue="true" locked="false" name="Default" />
    </scenarios>
    <stylelibrary name="" />
    <trimlastparagraphmarker>false</trimlastparagraphmarker>
    <documenttype>Document</documenttype>
  </document>
</Content>`;
}

// ─────────── GD Reference Parser ───────────

function parseGdFile(gdText: string): GdInstruction[] {
  const instructions: GdInstruction[] = [];

  // Match each <instruction xsi:type="fillPointType" ID="N" ...>...</instruction> block
  const instructionRegex = /<instruction\b[^>]*\bID="(\d+)"[^>]*>([\s\S]*?)<\/instruction>/g;
  let m: RegExpExecArray | null;

  while ((m = instructionRegex.exec(gdText)) !== null) {
    const id = parseInt(m[1], 10);
    const block = m[2];

    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);
    const rootNodeMatch = block.match(/<rootNode>([\s\S]*?)<\/rootNode>/);
    const rootguidMatch = block.match(/<rootguid>([\s\S]*?)<\/rootguid>/);
    // Attribute order may vary — match name and guid independently
    const nameAttrMatch = block.match(/<node\b[^>]*\bname="([^"]+)"/);
    const guidAttrMatch = block.match(/<node\b[^>]*\bguid="([^"]+)"/);

    if (!rootNodeMatch || !rootguidMatch || !nameAttrMatch || !guidAttrMatch) continue;

    instructions.push({
      id,
      description: descMatch?.[1]?.trim() ?? '',
      rootNode: rootNodeMatch[1].trim(),
      rootguid: rootguidMatch[1].trim(),
      nodeName: nameAttrMatch[1],
      nodeGuid: guidAttrMatch[1],
    });
  }

  return instructions;
}

// ─────────── GD Instruction Matching ───────────

// Derive which GD domain a given XSD path segment likely belongs to
function gdDomainHint(xsdPath: string): string | null {
  const seg = (xsdPath.split('/').filter(Boolean)[1] ?? '').toLowerCase();
  if (seg === 'contact') return 'Person';
  if (seg === 'claim') return 'Claim';
  if (seg === 'policy' || seg === 'support') return 'Company';
  return null;
}

function heuristicMatch(row: MappingRow, instructions: GdInstruction[]): GdInstruction | null {
  const parts = row.xsdPath.split('/').filter(Boolean);
  const domainHint = gdDomainHint(row.xsdPath);

  // Path segments after 'root' and the XSD-domain segment
  const segments = parts.slice(2);

  // Candidate node names: all suffixes of path segments, shortest (leaf) first
  const candidates: string[] = [];
  for (let i = segments.length - 1; i >= 0; i--) {
    candidates.push(segments.slice(i).map(toPascalCase).join(''));
  }

  // Also try the cleaned-up field label as a candidate
  const cleanedLabel = row.fieldLabel
    .replace(/[<>\[\]{}()]/g, '')
    .trim()
    .split(/\s+/)
    .map(toPascalCase)
    .join('');
  if (cleanedLabel && !candidates.includes(cleanedLabel)) candidates.push(cleanedLabel);

  const domainFiltered = domainHint ? instructions.filter(i => i.rootNode === domainHint) : [];

  for (const candidate of candidates) {
    const lc = candidate.toLowerCase();
    // Domain-filtered first (more specific)
    const inDomain = domainFiltered.find(i => i.nodeName.toLowerCase() === lc);
    if (inDomain) return inDomain;
    // Global fallback
    const global = instructions.find(i => i.nodeName.toLowerCase() === lc);
    if (global) return global;
  }

  return null;
}

// ─────────── LLM Core ───────────

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const CLAUDE_API  = 'https://api.anthropic.com/v1/messages';
const OPENAI_API  = 'https://api.openai.com/v1/chat/completions';

async function callLLMRaw(
  provider: string,
  userId: number,
  prompt: string
): Promise<string> {
  if (provider === 'gemini') {
    const { rows } = await pool.query('SELECT gemini_api_key FROM users WHERE id=$1', [userId]);
    const apiKey = rows[0]?.gemini_api_key || process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) throw new Error('Gemini API key not configured');

    const url = `${GEMINI_BASE}/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    });
    const data = await res.json() as any;
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  if (provider === 'claude') {
    const { rows } = await pool.query('SELECT claude_api_key FROM users WHERE id=$1', [userId]);
    const apiKey = rows[0]?.claude_api_key || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Claude API key not configured');

    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json() as any;
    return data?.content?.[0]?.text ?? '';
  }

  if (provider === 'openai') {
    const { rows } = await pool.query('SELECT openai_api_key FROM users WHERE id=$1', [userId]);
    const apiKey = rows[0]?.openai_api_key || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key not configured');

    const res = await fetch(OPENAI_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0,
        messages: [
          { role: 'system', content: 'Return only valid JSON when asked to analyze document fields.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    const data = await res.json() as any;
    return data?.choices?.[0]?.message?.content ?? '';
  }

  throw new Error(`Unknown provider: ${provider}`);
}

// ─────────── LLM Variable Detection ───────────

function buildDetectionPrompt(docText: string, rows: MappingRow[]): string {
  const truncated = docText.length > 5000 ? docText.slice(0, 5000) + '\n...[truncated]' : docText;
  const csvLines = rows.map(r => `"${r.fieldLabel}","${r.xsdPath}","${r.sampleValue}"`).join('\n');
  return `You are analyzing a document template to identify data field positions.

DOCUMENT TEXT:
---
${truncated}
---

FIELD MAPPING CSV (Field Label, XSD Path, Sample Value):
${csvLines}

For each field, find the EXACT text substring in the document that should be replaced by a variable.
Rules:
- If the field has a bracketed placeholder like <claimNumber>, [FieldName], or {{variable}}, return that exact placeholder text.
- Otherwise, search for the sample value verbatim in the document and return it if found.
- If descriptive labels appear in parentheses in the Field Label (e.g., "Check Mail Date (10/18/2025)"), the text to find is the part in parentheses: "10/18/2025".
- If the field cannot be found in the document, return null for foundText.
- Return the shortest unique match.

Return ONLY valid JSON, no markdown:
{"variables":[{"fieldLabel":"<exact field label from CSV>","foundText":"<exact substring from document or null>"}]}`;
}

interface LLMVariableResult { fieldLabel: string; foundText: string | null }

function parseLLMResponse(raw: string): LLMVariableResult[] {
  try {
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(clean);
    const arr = parsed.variables ?? parsed;
    if (!Array.isArray(arr)) return [];
    return arr.filter((v: any) => typeof v.fieldLabel === 'string');
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const p = JSON.parse(match[0]);
        return Array.isArray(p.variables) ? p.variables : [];
      } catch { return []; }
    }
    return [];
  }
}

async function callLLMForDetection(
  provider: string,
  userId: number,
  prompt: string
): Promise<LLMVariableResult[]> {
  const raw = await callLLMRaw(provider, userId, prompt);
  return parseLLMResponse(raw);
}

function mergeDetections(
  stringMatched: DetectedVariable[],
  llmResults: LLMVariableResult[],
  allRows: MappingRow[],
  nextId: number
): DetectedVariable[] {
  const matchedLabels = new Set(stringMatched.map(v => v.row.fieldLabel));
  const extra: DetectedVariable[] = [];

  for (const llm of llmResults) {
    if (matchedLabels.has(llm.fieldLabel)) continue;
    if (!llm.foundText) continue;

    const row = allRows.find(r => r.fieldLabel === llm.fieldLabel);
    if (!row) continue;

    extra.push({
      fillPointId: nextId++,
      row,
      searchText: llm.foundText,
      detectionMethod: 'sampleValue',
    });
  }

  return extra;
}

// ─────────── LLM Instruction Matching ───────────

interface InstructionMatchResult { fieldLabel: string; instructionId: number }

function parseInstructionMatchResponse(raw: string): InstructionMatchResult[] {
  try {
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(clean);
    const arr: any[] = parsed.matches ?? parsed;
    if (!Array.isArray(arr)) return [];
    return arr.filter(x => typeof x.fieldLabel === 'string' && typeof x.instructionId === 'number');
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const p = JSON.parse(match[0]);
        return Array.isArray(p.matches)
          ? p.matches.filter((x: any) => typeof x.fieldLabel === 'string' && typeof x.instructionId === 'number')
          : [];
      } catch { return []; }
    }
    return [];
  }
}

async function llmMatchInstructions(
  rows: MappingRow[],
  instructions: GdInstruction[],
  provider: string,
  userId: number
): Promise<Map<string, GdInstruction>> {
  const instrList = instructions.map(i =>
    `ID=${i.id}, rootNode="${i.rootNode}", nodeName="${i.nodeName}"`
  ).join('\n');

  const fieldList = rows.map(r =>
    `fieldLabel="${r.fieldLabel}", xsdPath="${r.xsdPath}", sampleValue="${r.sampleValue}"`
  ).join('\n');

  const prompt = `Match each data field to the best GhostDraft Model Library instruction by semantic similarity.

Fields:
${fieldList}

Instructions:
${instrList}

Rules:
- Match based on what the field conceptually represents, considering the XSD path segments and the instruction nodeName.
- Example: xsdPath="/root/claim/adjudicator/name", fieldLabel="<claim adjustor name>" → best match is the instruction with nodeName "ClaimAdjudicator" (the adjudicator of the claim).
- Do NOT match date fields to non-date instructions or vice versa.

Return ONLY valid JSON: {"matches":[{"fieldLabel":"<exact label>","instructionId":<number>},...]}
Omit fields that have no good match.`;

  const raw = await callLLMRaw(provider, userId, prompt);
  const results = parseInstructionMatchResponse(raw);

  const idMap = new Map(instructions.map(i => [i.id, i]));
  const out = new Map<string, GdInstruction>();
  for (const r of results) {
    const instr = idMap.get(r.instructionId);
    if (instr) out.set(r.fieldLabel, instr);
  }
  return out;
}

async function assignResolvedNodes(
  detected: DetectedVariable[],
  instructions: GdInstruction[],
  provider: string,
  userId: number
): Promise<void> {
  if (instructions.length === 0) return;

  const unmatched: DetectedVariable[] = [];

  for (const v of detected) {
    const instr = heuristicMatch(v.row, instructions);
    if (instr) {
      v.resolved = {
        domain: instr.rootNode,
        domainGuid: instr.rootguid,
        nodeName: instr.nodeName,
        nodeGuid: instr.nodeGuid,
      };
    } else {
      unmatched.push(v);
    }
  }

  if (unmatched.length > 0) {
    try {
      const llmMap = await llmMatchInstructions(
        unmatched.map(v => v.row),
        instructions,
        provider,
        userId
      );
      for (const v of unmatched) {
        const instr = llmMap.get(v.row.fieldLabel);
        if (instr) {
          v.resolved = {
            domain: instr.rootNode,
            domainGuid: instr.rootguid,
            nodeName: instr.nodeName,
            nodeGuid: instr.nodeGuid,
          };
        }
      }
    } catch (err) {
      console.warn('[ghostDraftGenerator] LLM instruction matching failed:', err);
    }
  }
}

// ─────────── Route Handler ───────────

router.post(
  '/',
  upload.fields([
    { name: 'docx', maxCount: 1 },
    { name: 'csv',  maxCount: 1 },
    { name: 'xsd',  maxCount: 1 },
    { name: 'gd',   maxCount: 1 }, // optional .gd reference
  ]),
  async (req: AuthRequest, res: Response) => {
    try {
      const files = req.files as Record<string, Express.Multer.File[]>;
      const docxFile = files?.docx?.[0];
      const csvFile  = files?.csv?.[0];
      const xsdFile  = files?.xsd?.[0];
      const gdRefFile = files?.gd?.[0]; // optional

      if (!docxFile || !csvFile || !xsdFile) {
        return res.status(400).json({ error: 'Missing required files: docx, csv, xsd' });
      }

      const provider: string = (req.body?.provider as string) || 'gemini';
      const userId = req.user!.id;

      const csvText = csvFile.buffer.toString('utf-8');
      const xsdText = xsdFile.buffer.toString('utf-8');

      const rows = parseMappingCsv(csvText);
      if (rows.length === 0) {
        return res.status(400).json({ error: 'No valid rows found in CSV — all XSD paths may be "path not found".' });
      }

      detectDateFields(xsdText, rows);

      const [htmlResult, rawResult] = await Promise.all([
        mammoth.convertToHtml({ buffer: docxFile.buffer }),
        mammoth.extractRawText({ buffer: docxFile.buffer }),
      ]);

      // Stage 1: fast string matching
      const { detected: stringDetected, skipped: stringSkipped } = detectVariables(rawResult.value, rows);

      // Stage 2: LLM for any fields still undetected
      let allDetected = stringDetected;
      let skipped = stringSkipped;

      if (skipped.length > 0) {
        try {
          const undetectedRows = rows.filter(r => skipped.includes(r.fieldLabel));
          const prompt = buildDetectionPrompt(rawResult.value, undetectedRows);
          const llmResults = await callLLMForDetection(provider, userId, prompt);

          const nextId = (stringDetected[stringDetected.length - 1]?.fillPointId ?? 0) + 1;
          const llmDetected = mergeDetections(stringDetected, llmResults, rows, nextId);
          allDetected = [...stringDetected, ...llmDetected];

          const llmFoundLabels = new Set(llmDetected.map(v => v.row.fieldLabel));
          skipped = skipped.filter(label => !llmFoundLabels.has(label));
        } catch (llmErr) {
          console.warn('[ghostDraftGenerator] LLM detection failed:', llmErr);
        }
      }

      // Stage 3: resolve GhostDraft instructions from .gd reference (heuristic + LLM fallback)
      if (gdRefFile) {
        try {
          const gdText = gdRefFile.buffer.toString('utf-8');
          const gdInstructions = parseGdFile(gdText);
          if (gdInstructions.length > 0) {
            await assignResolvedNodes(allDetected, gdInstructions, provider, userId);
          }
        } catch (gdErr) {
          console.warn('[ghostDraftGenerator] .gd reference parsing failed:', gdErr);
        }
      }

      const substitutedHtml = applySubstitutionsToHtml(preprocessHtml(htmlResult.value), allDetected);
      const rtfContent = htmlToRtf(substitutedHtml);

      const docName = docxFile.originalname.replace(/\.docx$/i, '');
      const gdContent = buildGdXml(docName, rtfContent, allDetected);
      const sampleXml = buildSampleXml(rows);

      const variableMap = allDetected.map(v => ({
        fillPointId: v.fillPointId,
        fieldLabel: v.row.fieldLabel,
        domain: v.resolved?.domain ?? v.row.domain,
        fieldName: v.resolved?.nodeName ?? v.row.fieldName,
        xsdPath: v.row.xsdPath,
        sampleValue: v.row.sampleValue,
        detectionMethod: v.detectionMethod,
        isDate: v.row.isDate,
        gdMatched: !!v.resolved,
      }));

      return res.json({ gdContent, sampleXml, variableMap, skipped });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Internal server error';
      console.error('[ghostDraftGenerator]', err);
      return res.status(500).json({ error: msg });
    }
  }
);

export default router;
