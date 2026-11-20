/**
 * Template rendering engine.
 * Replaces placeholder chips, evaluates conditional blocks, expands loops,
 * then strips all editor markup before handing clean HTML to Puppeteer.
 */

interface RuleConfig {
  field?: string;
  operator?: string;
  value?: string | number | boolean;
  arrayField?: string;
}

interface Rule {
  blockId: string;
  ruleType: 'condition' | 'loop';
  ruleConfig: RuleConfig;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolvePath(data: Record<string, any>, path: string): any {
  return path.split('.').reduce((obj, key) => {
    if (obj == null) return undefined;
    const arrMatch = key.match(/^(\w+)\[(\d+)\]$/);
    if (arrMatch) return obj[arrMatch[1]]?.[parseInt(arrMatch[2], 10)];
    return obj[key];
  }, data);
}

function evaluateCondition(config: RuleConfig, data: Record<string, any>): boolean {
  if (!config.field) return true;
  const actual = resolvePath(data, config.field);
  const expected = config.value;
  const operator = config.operator ?? 'equals';
  switch (operator) {
    case 'equals':     return String(actual ?? '') === String(expected ?? '');
    case 'not_equals': return String(actual ?? '') !== String(expected ?? '');
    case 'contains':   return String(actual ?? '').includes(String(expected ?? ''));
    case 'not_empty':  return actual != null && actual !== '';
    case 'is_empty':   return actual == null || actual === '';
    case 'gt':         return Number(actual) > Number(expected);
    case 'lt':         return Number(actual) < Number(expected);
    default:           return Boolean(actual);
  }
}

/**
 * Find an element with data-block-id="blockId" using depth counting.
 * Supports any tag name: <p>, <td>, <tr>, <div>, <h1>–<h6>, <li>, etc.
 */
function findBlock(
  html: string,
  blockId: string
): { start: number; end: number; inner: string; tagName: string; openTagHtml: string } | null {
  const openPattern = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)[^>]*\\bdata-block-id="${escapeRegex(blockId)}"[^>]*>`, 'i');
  const match = openPattern.exec(html);
  if (!match) {
    console.warn(`[templateEngine] findBlock: no match for blockId="${blockId}"`);
    return null;
  }

  const tagName = match[1].toLowerCase();
  const openTag = `<${tagName}`;
  const closeTag = `</${tagName}>`;
  const htmlLower = html.toLowerCase();

  const openStart = match.index;
  let pos = openStart + match[0].length;
  let depth = 1;

  while (pos < html.length && depth > 0) {
    const nextOpen = htmlLower.indexOf(openTag, pos);
    const nextClose = htmlLower.indexOf(closeTag, pos);
    if (nextClose === -1) break;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + openTag.length;
    } else {
      depth--;
      if (depth === 0) {
        const end = nextClose + closeTag.length;
        return { start: openStart, end, inner: html.slice(openStart + match[0].length, nextClose), tagName, openTagHtml: match[0] };
      }
      pos = nextClose + closeTag.length;
    }
  }

  console.warn(`[templateEngine] findBlock: depth never reached 0 for blockId="${blockId}" tag="${tagName}"`);
  return null;
}

/**
 * Strip the visual rule-block header div (contenteditable="false") that the WYSIWYG editor
 * injects. For non-div targets (p, td, tr, etc.) this regex won't match, leaving content intact.
 */
function stripBlockHeader(inner: string): string {
  return inner.replace(/^\s*<div[^>]*\bcontenteditable="false"[^>]*>[\s\S]*?<\/div>\s*/i, '');
}

/** Replace placeholder chip spans with resolved data values */
function fillPlaceholders(html: string, data: Record<string, any>): string {
  return html.replace(
    /<span[^>]*\bdata-placeholder="([^"]+)"[^>]*>[^<]*<\/span>/gi,
    (_match, field) => {
      const val = resolvePath(data, field);
      return val != null ? String(val) : '';
    }
  );
}

/** Strip editor-only rule-badge superscripts so they don't appear in the output PDF */
function stripRuleBadges(html: string): string {
  return html.replace(/<sup[^>]*\bdata-rule-badge="[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, '');
}

/** Remove blocks where the condition evaluates to false */
function applyConditions(html: string, rules: Rule[], data: Record<string, any>): string {
  for (const rule of rules.filter(r => r.ruleType === 'condition')) {
    const show = evaluateCondition(rule.ruleConfig, data);
    console.log(
      `[templateEngine] condition blockId="${rule.blockId}" ` +
      `field="${rule.ruleConfig.field}" op="${rule.ruleConfig.operator}" ` +
      `expected="${rule.ruleConfig.value}" actual="${resolvePath(data, rule.ruleConfig.field ?? '')}" ` +
      `→ show=${show}`
    );
    if (!show) {
      const block = findBlock(html, rule.blockId);
      if (block) {
        console.log(`[templateEngine] removing block "${rule.blockId}" (start=${block.start} end=${block.end})`);
        html = html.slice(0, block.start) + html.slice(block.end);
      } else {
        console.warn(`[templateEngine] block "${rule.blockId}" not found in HTML — cannot hide`);
      }
    }
  }
  return html;
}

/** Repeat block content for each item in an array field */
function expandLoops(html: string, rules: Rule[], data: Record<string, any>): string {
  for (const rule of rules.filter(r => r.ruleType === 'loop')) {
    const items: any[] = resolvePath(data, rule.ruleConfig.arrayField ?? '') ?? [];
    console.log(`[templateEngine] loop blockId="${rule.blockId}" items=${items.length}`);
    const block = findBlock(html, rule.blockId);
    if (!block) continue;
    const innerContent = stripBlockHeader(block.inner);
    // Build a clean opening tag without the data-block-id so repeated rows don't trigger further processing
    const cleanOpenTag = block.openTagHtml.replace(/\s*data-block-id="[^"]*"/, '');
    const closeTag = `</${block.tagName}>`;
    const expanded = items.map(item =>
      cleanOpenTag + fillPlaceholders(innerContent, { ...data, ...item, _item: item }) + closeTag
    ).join('');
    html = html.slice(0, block.start) + expanded + html.slice(block.end);
  }
  return html;
}

/** Unwrap all remaining data-block-id elements: strip wrapper + header, keep inner content */
function unwrapBlocks(html: string): string {
  while (/\bdata-block-id="/.test(html)) {
    const match = /<([a-zA-Z][a-zA-Z0-9]*)[^>]*\bdata-block-id="([^"]*)"[^>]*>/.exec(html);
    if (!match) break;
    const blockId = match[2];
    const block = findBlock(html, blockId);
    if (!block) break; // safety — avoid infinite loop on malformed HTML
    html = html.slice(0, block.start) + stripBlockHeader(block.inner) + html.slice(block.end);
  }
  return html;
}

// Matches the editor's font-size (14px) and tight paragraph spacing so the PDF
// looks like the WYSIWYG preview.
const BASE_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #111; margin: 0; padding: 0; }
  h1 { font-size: 22px; font-weight: 700; margin: 0.5em 0 0.3em; }
  h2 { font-size: 18px; font-weight: 700; margin: 0.4em 0 0.25em; }
  h3 { font-size: 15px; font-weight: 600; margin: 0.3em 0 0.2em; }
  p  { margin: 0 0 0.35em 0; }
  ul, ol { margin: 0 0 0.35em 1.5em; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 0.75em; }
  td, th { border: 1px solid #ccc; padding: 4px 8px; vertical-align: top; }
  th { background: #f4f4f4; font-weight: 600; }
  img { max-width: 100%; height: auto; }
`;

export function renderTemplate(
  htmlContent: string,
  rules: Rule[],
  data: Record<string, any>,
  debug = false
): string | { html: string; steps: Record<string, any> } {
  const htmlBlockIds = [...htmlContent.matchAll(/\bdata-block-id="([^"]+)"/g)].map(m => m[1]);
  const ruleBlockIds = rules.map(r => r.blockId);
  console.log(`[templateEngine] htmlBlockIds=${JSON.stringify(htmlBlockIds)} ruleBlockIds=${JSON.stringify(ruleBlockIds)}`);

  let html = htmlContent;
  html = expandLoops(html, rules, data);
  html = applyConditions(html, rules, data);
  html = fillPlaceholders(html, data);
  html = stripRuleBadges(html);   // remove editor-only badge <sup> elements
  html = unwrapBlocks(html);

  const finalHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${BASE_STYLES}</style>
</head>
<body>${html}</body>
</html>`;

  if (debug) {
    return {
      html: finalHtml,
      steps: {
        htmlBlockIds,
        ruleBlockIds,
        rules,
        data,
      },
    };
  }

  return finalHtml;
}
