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
  const operator = config.operator ?? 'equals'; // RuleEditor default is 'equals'; guard missing saves
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
 * Find a <div data-block-id="blockId"> using brace-depth counting.
 * Handles nested divs correctly regardless of depth.
 */
function findBlock(
  html: string,
  blockId: string
): { start: number; end: number; inner: string } | null {
  const openPattern = new RegExp(`<div[^>]*\\bdata-block-id="${escapeRegex(blockId)}"[^>]*>`, 'i');
  const match = openPattern.exec(html);
  if (!match) {
    console.warn(`[templateEngine] findBlock: no match for blockId="${blockId}"`);
    return null;
  }

  const openStart = match.index;
  let pos = openStart + match[0].length;
  let depth = 1;

  while (pos < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', pos);
    const nextClose = html.indexOf('</div>', pos);
    if (nextClose === -1) break;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 4;
    } else {
      depth--;
      if (depth === 0) {
        const end = nextClose + 6;
        return { start: openStart, end, inner: html.slice(openStart + match[0].length, nextClose) };
      }
      pos = nextClose + 6;
    }
  }

  console.warn(`[templateEngine] findBlock: depth never reached 0 for blockId="${blockId}"`);
  return null;
}

/**
 * The WYSIWYG editor prepends a visual header div (contenteditable="false") inside each block.
 * Also wraps content in a padding div. Strip both so only real content reaches Puppeteer.
 */
function stripBlockHeader(inner: string): string {
  // Remove the visual header: first inner div with contenteditable="false"
  return inner.replace(/^\s*<div[^>]*\bcontenteditable="false"[^>]*>[\s\S]*?<\/div>\s*/i, '');
}

/** Replace placeholder chip spans with resolved data values (removes chip styling too) */
function fillPlaceholders(html: string, data: Record<string, any>): string {
  return html.replace(
    /<span[^>]*\bdata-placeholder="([^"]+)"[^>]*>[^<]*<\/span>/gi,
    (_match, field) => {
      const val = resolvePath(data, field);
      return val != null ? String(val) : '';
    }
  );
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
    const expanded = items.map(item =>
      fillPlaceholders(innerContent, { ...data, ...item, _item: item })
    ).join('');
    html = html.slice(0, block.start) + expanded + html.slice(block.end);
  }
  return html;
}

/** Unwrap all remaining data-block-id divs: strip wrapper + visual header, keep content */
function unwrapBlocks(html: string): string {
  while (/\bdata-block-id="/.test(html)) {
    const match = /<div[^>]*\bdata-block-id="([^"]*)"[^>]*>/.exec(html);
    if (!match) break;
    const block = findBlock(html, match[1]);
    if (!block) break; // safety — avoid infinite loop on malformed HTML
    html = html.slice(0, block.start) + stripBlockHeader(block.inner) + html.slice(block.end);
  }
  return html;
}

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

export function renderTemplate(
  htmlContent: string,
  rules: Rule[],
  data: Record<string, any>,
  debug = false
): string | { html: string; steps: Record<string, any> } {
  // Log what blocks exist in the HTML vs what rules reference
  const htmlBlockIds = [...htmlContent.matchAll(/\bdata-block-id="([^"]+)"/g)].map(m => m[1]);
  const ruleBlockIds = rules.map(r => r.blockId);
  console.log(`[templateEngine] htmlBlockIds=${JSON.stringify(htmlBlockIds)} ruleBlockIds=${JSON.stringify(ruleBlockIds)}`);

  let html = htmlContent;
  html = expandLoops(html, rules, data);
  html = applyConditions(html, rules, data);
  html = fillPlaceholders(html, data);
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
