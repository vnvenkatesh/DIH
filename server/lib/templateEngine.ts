/**
 * Template rendering engine.
 * Processes TipTap HTML output — replaces placeholder chips, evaluates
 * conditional blocks, and expands loop regions — then returns filled HTML
 * ready for Puppeteer to render as a PDF.
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

// Resolve a dot-notation path like "address.city" or "items[0].name" from data
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
  switch (config.operator) {
    case 'equals':     return String(actual) === String(expected);
    case 'not_equals': return String(actual) !== String(expected);
    case 'contains':   return String(actual).includes(String(expected));
    case 'not_empty':  return actual != null && actual !== '';
    case 'is_empty':   return actual == null || actual === '';
    case 'gt':         return Number(actual) > Number(expected);
    case 'lt':         return Number(actual) < Number(expected);
    default:           return Boolean(actual);
  }
}

// Replace {{fieldName}} placeholder chips with actual values
function fillPlaceholders(html: string, data: Record<string, any>): string {
  return html.replace(/data-placeholder="([^"]+)"[^>]*>([^<]*)<\/span>/g, (_match, field) => {
    const val = resolvePath(data, field);
    return `>${val != null ? String(val) : ''}</span>`;
  });
}

// Expand loop blocks: clone inner HTML for each array item
function expandLoops(html: string, rules: Rule[], data: Record<string, any>): string {
  rules.filter(r => r.ruleType === 'loop').forEach(rule => {
    const { blockId, ruleConfig } = rule;
    const arrayField = ruleConfig.arrayField ?? '';
    const items: any[] = resolvePath(data, arrayField) ?? [];
    const blockRegex = new RegExp(
      `(<[^>]+data-block-id="${blockId}"[^>]*>)([\\s\\S]*?)(<\\/[a-z]+>)(?=\\s*<[^>]+data-block-id)`,
      'i'
    );
    html = html.replace(blockRegex, (_m, open, inner, close) => {
      return items.map(item => {
        const merged = { ...data, ...item, _item: item };
        return open + fillPlaceholders(inner, merged) + close;
      }).join('');
    });
  });
  return html;
}

// Remove conditional blocks where condition is false
function applyConditions(html: string, rules: Rule[], data: Record<string, any>): string {
  rules.filter(r => r.ruleType === 'condition').forEach(rule => {
    const { blockId, ruleConfig } = rule;
    const show = evaluateCondition(ruleConfig, data);
    if (!show) {
      const blockRegex = new RegExp(
        `<[^>]+data-block-id="${blockId}"[\\s\\S]*?<\\/[^>]+>\\s*`,
        'i'
      );
      html = html.replace(blockRegex, '');
    }
  });
  return html;
}

const BASE_STYLES = `
  body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.5; margin: 2cm; color: #111; }
  h1 { font-size: 20pt; margin-bottom: 0.5em; }
  h2 { font-size: 16pt; margin-bottom: 0.4em; }
  h3 { font-size: 13pt; margin-bottom: 0.3em; }
  p  { margin-bottom: 0.6em; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
  td, th { border: 1px solid #ccc; padding: 6px 10px; }
  th { background: #f4f4f4; font-weight: 600; }
  [data-placeholder] { font-weight: 600; }
  [data-conditional-block], [data-loop-block] { display: block; }
`;

export function renderTemplate(
  htmlContent: string,
  rules: Rule[],
  data: Record<string, any>
): string {
  let html = htmlContent;
  html = expandLoops(html, rules, data);
  html = applyConditions(html, rules, data);
  html = fillPlaceholders(html, data);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${BASE_STYLES}</style>
</head>
<body>${html}</body>
</html>`;
}
