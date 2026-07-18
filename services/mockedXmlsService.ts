// Accelerator-specific service for "Synthetic Data Generation" mocked XML bundles.
// Intentionally self-contained per CLAUDE.md shared-code rules.

import { MockedXmlsResult } from '../types';
import { SETTINGS_STORAGE_KEY } from '../contexts/SettingsContext';

const AUTH_KEY = 'dih_auth';

function getToken(): string {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || '{}').token || ''; }
    catch { return ''; }
}

function getProvider(): 'claude' | 'gemini' {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
        if (s.llmProvider === 'claude') return 'claude';
        return 'gemini';
    } catch {
        return 'gemini';
    }
}

function getGeminiModel(): string {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
        return s.geminiModel || 'gemini-2.5-flash';
    } catch { return 'gemini-2.5-flash'; }
}

function getClaudeModel(): string {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
        return s.claudeModel || 'claude-haiku-4-5-20251001';
    } catch { return 'claude-haiku-4-5-20251001'; }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const MOCKED_XMLS_PROMPT = `
You are an expert XML data architect and QA engineer.
Given an XSD schema and a list of test cases, generate a minimal set of mocked XML documents that together cover ALL listed test cases. Every XML must strictly conform to the XSD.

Grouping strategy:
1. Happy-path tests for different fields may share one XML — set each field value to its valid input.
2. Conditional TRUE-branch and FALSE-branch tests must each have their own XML (field values differ between them).
3. Boundary/edge-case tests need separate XMLs when field values conflict with other groups.
4. Format tests (correct vs incorrect formatting) need separate XMLs when the format itself differs.
5. Aim for 3–8 XML bundles total; never create one bundle per test case unless truly unavoidable.
6. Every test case ID must appear in exactly one bundle's testCaseIds array — no test case left uncovered.

For each bundle populate XML fields with values that satisfy the "Input Data" of the assigned test cases.

Return ONLY a JSON object (no markdown, no explanation) with a single key "xmlBundles". Each entry must have:
- "testCaseIds": array of test case ID strings (e.g. ["TC-001", "TC-013"])
- "description": one concise sentence describing the scenario this XML covers
- "xmlContent": complete, valid, well-formed XML string conforming to the XSD
`;

// ── Helpers (private copies — not imported from shared services) ───────────────

async function callGemini(model: string, contents: object[], generationConfig: object): Promise<any> {
    const resp = await fetch('/v1/llm/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ model, contents, generationConfig, accelerator: 'Synthetic Data Generator' }),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as any)?.error?.message || (err as any)?.error || `Gemini API error ${resp.status}: ${resp.statusText}`);
    }
    return resp.json();
}

function extractGeminiJsonText(result: any): string {
    const parts: any[] = result?.candidates?.[0]?.content?.parts ?? [];
    const finalParts = parts.filter((p: any) => p.text !== undefined && !p.thought);
    const text = (finalParts.length > 0 ? finalParts.map((p: any) => p.text).join('') : '').trim();
    if (!text) throw new Error('Gemini returned an empty response. Please try again.');
    return text;
}

async function callClaude(payload: { model: string; max_tokens: number; messages: any[] }): Promise<any> {
    const resp = await fetch('/v1/llm/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ ...payload, accelerator: 'Synthetic Data Generator' }),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as any)?.error?.message || (err as any)?.error || `Claude API error: ${resp.status}`);
    }
    return resp.json();
}

function extractClaudeText(response: any): string {
    const block = response?.content?.[0];
    if (!block || block.type !== 'text') throw new Error('Unexpected Claude response format.');
    return block.text.trim();
}

// Repair invalid JSON escape sequences produced when LLM embeds XML in strings.
// Valid JSON escape chars after \: " \ / b f n r t u
// Anything else (e.g. \k, \s) becomes \\k — a literal backslash + character.
function repairEscapes(raw: string): string {
    return raw.replace(/\\([^"\\/bfnrtu0-9])/g, '\\\\$1');
}

function safeParseJson(text: string): any {
    // 1. Direct parse
    try { return JSON.parse(text); } catch {}
    // 2. Strip markdown fences
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
        try { return JSON.parse(fenced[1].trim()); } catch {}
        try { return JSON.parse(repairEscapes(fenced[1].trim())); } catch {}
    }
    // 3. Extract outermost JSON object
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('No JSON object found in LLM response.');
    const slice = text.slice(start, end + 1);
    try { return JSON.parse(slice); } catch {}
    // 4. Repair escape sequences then parse
    return JSON.parse(repairEscapes(slice));
}

// ── Provider implementations ─────────────────────────────────────────────────

const BUNDLE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        xmlBundles: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    testCaseIds: { type: 'ARRAY', items: { type: 'STRING' } },
                    description: { type: 'STRING' },
                    xmlContent: { type: 'STRING' },
                },
                required: ['testCaseIds', 'description', 'xmlContent'],
            },
        },
    },
    required: ['xmlBundles'],
};

async function viaGemini(xsdContent: string, testCasesText: string): Promise<MockedXmlsResult> {
    const result = await callGemini(
        getGeminiModel(),
        [{
            parts: [
                { text: MOCKED_XMLS_PROMPT },
                { text: `\n\n--- XML SCHEMA (XSD) ---\n\n${xsdContent}` },
                { text: `\n\n--- TEST CASES ---\n\n${testCasesText}` },
            ],
        }],
        { responseMimeType: 'application/json', responseSchema: BUNDLE_SCHEMA }
    );
    return safeParseJson(extractGeminiJsonText(result)) as MockedXmlsResult;
}

async function viaClaude(xsdContent: string, testCasesText: string): Promise<MockedXmlsResult> {
    const result = await callClaude({
        model: getClaudeModel(),
        max_tokens: 16000,
        messages: [{
            role: 'user',
            content: `${MOCKED_XMLS_PROMPT}\n\n--- XML SCHEMA (XSD) ---\n\n${xsdContent}\n\n--- TEST CASES ---\n\n${testCasesText}`,
        }],
    });
    return safeParseJson(extractClaudeText(result)) as MockedXmlsResult;
}

// ── Public API ────────────────────────────────────────────────────────────────

export const generateMockedXmlsFromTestCases = (
    xsdContent: string,
    testCasesText: string
): Promise<MockedXmlsResult> => {
    const p = getProvider();
    if (p === 'claude') return viaClaude(xsdContent, testCasesText);
    return viaGemini(xsdContent, testCasesText);
};
