import React, { useReducer, useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

// ── RDI conversion utilities ───────────────────────────────────────────────
// Supports RDI (Raw Data Interface) print-stream data used across CCM platforms
// including OpenText Exstream, SAP, and others. Two output modes:
//   • Flat XML  — generic, schema-free; every D-record → <FIELD>value</FIELD>
//   • Spool XML — structured SPOOL/FORM/HEADER/PAGE shape for batch RDI files

function rdiIsLikelyContent(text: string): boolean {
    if (!text) return false;
    const bounded = text.length > 2_000_000 ? text.slice(0, 2_000_000) : text;
    const trimmed = bounded.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && (() => { try { JSON.parse(trimmed); return true; } catch { return false; } })()) return false;
    if (/^\s*(<\?xml|<)/.test(trimmed)) return false;
    const dataLines = bounded.match(/^D[A-Z][A-Z0-9_]*\s/gm);
    if ((dataLines?.length ?? 0) < 3) return false;
    if (/^CRDI-CONTROL %%LINES-(?:BEGIN|END)\s+\S+/m.test(bounded)) return true;
    const signals = [
        /^H[^\r\n]+/m.test(bounded),
        /^CCODEPAGE\s+\S+\s+LANGUAGE\s+\S+\s*$/m.test(bounded),
        /^CPAGENAME\s+\S+\s*$/m.test(bounded),
    ].filter(Boolean).length;
    return signals >= 2;
}

function rdiXmlEsc(v: string): string { return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function rdiAttrEsc(v: string): string { return rdiXmlEsc(v).replace(/"/g, '&quot;'); }
function rdiSanitizeTag(n: string): string { const c = n.replace(/[^A-Za-z0-9_.-]/g, '_'); return /^[A-Za-z_]/.test(c) ? c : `_${c}`; }

type RdiFlatNode =
    | { kind: 'field'; name: string; value: string }
    | { kind: 'block'; name: string; args: string[]; fields: RdiFlatNode[] }
    | { kind: 'raw'; tag: string; content: string };

function rdiConvertToFlatXml(raw: string): { xml: string; warnings: string[] } {
    const withoutBom = raw.replace(/^﻿/, '');
    const lines = withoutBom.split(/\r*\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const topLevel: RdiFlatNode[] = [];
    const blockStack: { kind: 'block'; name: string; args: string[]; fields: RdiFlatNode[] }[] = [];
    const warnings: string[] = [];
    const current = (): RdiFlatNode[] => blockStack.length > 0 ? blockStack[blockStack.length - 1].fields : topLevel;
    const closeBlock = (endName: string) => {
        const frame = blockStack.pop();
        if (!frame) { warnings.push(`%%LINES-END '${endName}' has no matching BEGIN; ignoring.`); return; }
        if (frame.name !== endName) warnings.push(`Block end '${endName}' mismatches begin '${frame.name}'; using begin name.`);
        if (frame.fields.length > 0) current().push(frame);
    };
    for (const line of lines) {
        if (!line) continue;
        const t = line[0];
        if (t === 'H') { current().push({ kind: 'raw', tag: 'rdiHeaderRecord', content: line.trimEnd() }); continue; }
        if (t === 'S') { current().push({ kind: 'raw', tag: 'rdiPrintMaskRecord', content: line.trimEnd() }); continue; }
        if (t === 'C') {
            const bm = /^CRDI-CONTROL %%LINES-BEGIN\s+(\S+)(.*)$/.exec(line);
            if (bm) { blockStack.push({ kind: 'block', name: bm[1], args: bm[2].trim().split(/\s+/).filter(Boolean), fields: [] }); continue; }
            const em = /^CRDI-CONTROL %%LINES-END\s+(\S+)/.exec(line);
            if (em) { closeBlock(em[1]); continue; }
            const cm = /^CCODEPAGE\s+(\S+)\s+LANGUAGE\s+(\S+)/.exec(line);
            if (cm) { current().push({ kind: 'field', name: 'RDI_CODEPAGE', value: cm[1] }, { kind: 'field', name: 'RDI_LANGUAGE', value: cm[2] }); continue; }
            const pm = /^CPAGENAME\s+(\S+)/.exec(line);
            if (pm) { current().push({ kind: 'field', name: 'RDI_PAGENAME', value: pm[1] }); continue; }
            current().push({ kind: 'raw', tag: 'unrecognizedControlRecord', content: line }); continue;
        }
        if (t === 'D') {
            const dm = /^D([A-Z][A-Z0-9_]*)\s(.*)$/.exec(line);
            if (dm) current().push({ kind: 'field', name: dm[1], value: dm[2].trim() });
            else current().push({ kind: 'raw', tag: 'unrecognizedDataRecord', content: line });
            continue;
        }
        current().push({ kind: 'raw', tag: 'unrecognizedRecord', content: line });
    }
    while (blockStack.length > 0) {
        const f = blockStack[blockStack.length - 1];
        warnings.push(`Block '${f.name}' not closed before EOF; emitting collected fields.`);
        closeBlock(f.name);
    }
    function ser(node: RdiFlatNode, ind: string): string {
        if (node.kind === 'field') return `${ind}<${rdiSanitizeTag(node.name)}>${rdiXmlEsc(node.value)}</${rdiSanitizeTag(node.name)}>`;
        if (node.kind === 'raw') return `${ind}<${rdiSanitizeTag(node.tag)}>${rdiXmlEsc(node.content)}</${rdiSanitizeTag(node.tag)}>`;
        const tag = rdiSanitizeTag(node.name);
        const attrs = node.args.length > 0 ? ` args="${rdiAttrEsc(node.args.join(' '))}"` : '';
        if (node.fields.length === 0) return `${ind}<${tag}${attrs} />`;
        return `${ind}<${tag}${attrs}>\n${node.fields.map(c => ser(c, `${ind}  `)).join('\n')}\n${ind}</${tag}>`;
    }
    const body = topLevel.map(n => ser(n, '  ')).join('\n');
    const xml = body ? `<?xml version="1.0" encoding="UTF-8"?>\n<rdiDocument>\n${body}\n</rdiDocument>\n`
                     : `<?xml version="1.0" encoding="UTF-8"?>\n<rdiDocument />\n`;
    return { xml, warnings };
}

function rdiConvertToSpoolXml(raw: string): string {
    type Leaf = { kind: 'leaf'; tag: string; attrs?: Record<string, string>; text: string };
    type Container = { kind: 'container'; tag: string; attrs?: Record<string, string>; children: SpoolN[] };
    type SpoolN = Leaf | Container;
    const HBOUNDS: [string, number, number][] = [
        ['RDI_VERSION', 1, 7], ['CLIENT', 7, 10], ['DOCUMENT_NUMBER', 10, 20],
        ['LANGUAGE', 20, 21], ['FORM_NAME', 21, 37], ['DEVICE_TYPE', 37, 44],
        ['HOST_NAME', 44, 109], ['BATCH_MODE', 109, 110],
    ];
    const FORM_NAME_IDX = HBOUNDS.findIndex(([t]) => t === 'FORM_NAME');
    function renderAttrs(attrs?: Record<string, string>) {
        if (!attrs) return '';
        return Object.entries(attrs).map(([k, v]) => ` ${k}="${rdiAttrEsc(v)}"`).join('');
    }
    function renderN(n: SpoolN): string {
        const a = renderAttrs(n.attrs);
        if (n.kind === 'leaf') return n.text === '' ? `<${n.tag}${a}/>` : `<${n.tag}${a}>${rdiXmlEsc(n.text)}</${n.tag}>`;
        if ((n as Container).children.length === 0) return `<${n.tag}${a}/>`;
        return `<${n.tag}${a}>\n${(n as Container).children.map(renderN).join('\n')}\n</${n.tag}>`;
    }
    const spoolChildren: SpoolN[] = [];
    let form: Container | null = null;
    let page: Container | null = null;
    let block: { name: string; fields: Leaf[] } | null = null;
    const closeBlock = () => {
        if (block && page) {
            page.children.push(block.fields.length === 0
                ? { kind: 'leaf', tag: block.name, text: '' }
                : { kind: 'container', tag: block.name, children: block.fields });
        }
        block = null;
    };
    const closeForm = () => { closeBlock(); if (form) spoolChildren.push(form); form = null; page = null; };
    for (const rawLine of raw.replace(/^﻿/, '').split('\n')) {
        const line = rawLine.replace(/\r+$/, '');
        if (!line) continue;
        if (line.startsWith('H')) {
            closeForm();
            const [, s, e] = HBOUNDS[FORM_NAME_IDX];
            form = { kind: 'container', tag: 'FORM', attrs: { NAME: line.slice(s, e).trim() }, children: [] };
            const hChildren: SpoolN[] = HBOUNDS.map(([tag, st, en]) => ({ kind: 'leaf', tag, text: line.slice(st, en).trim() } as Leaf));
            hChildren.push({ kind: 'leaf', tag: 'ITCPO_RAW', text: line.slice(110) });
            form.children.push({ kind: 'container', tag: 'HEADER', children: hChildren });
            continue;
        }
        if (!form) continue;
        if (line.startsWith('S')) { form.children.push({ kind: 'leaf', tag: 'SORT', text: line.slice(1).trim() }); continue; }
        if (line.startsWith('CRDI-CONTROL %%LINES-BEGIN')) { const m = /^CRDI-CONTROL %%LINES-BEGIN\s+(\S+)/.exec(line); block = { name: m ? m[1] : 'UNKNOWN', fields: [] }; continue; }
        if (line.startsWith('CRDI-CONTROL %%LINES-END')) { closeBlock(); continue; }
        if (line.startsWith('CCODEPAGE')) { const m = /^CCODEPAGE\s+(\S+)\s+LANGUAGE\s+(\S+)/.exec(line); if (m) form.children.push({ kind: 'leaf', tag: 'CODEPAGE', attrs: { lang: m[2] }, text: m[1] }); continue; }
        if (line.startsWith('CPAGENAME')) { const m = /^CPAGENAME\s+(\S+)/.exec(line); const pg: Container = { kind: 'container', tag: 'PAGE', attrs: { name: m ? m[1] : '' }, children: [] }; form.children.push(pg); page = pg; continue; }
        if (line.startsWith('D') && block) { const m = /^(\S+)\s(.*)$/.exec(line.slice(1)); if (m) block.fields.push({ kind: 'leaf', tag: m[1], text: m[2] }); continue; }
    }
    closeForm();
    return `<?xml version="1.0" encoding="UTF-8"?>${renderN({ kind: 'container', tag: 'SPOOL', children: spoolChildren })}`;
}

// ── Content block extraction ───────────────────────────────────────────────
type ContentBlock = { mimeType: string; data: string; encoding: 'base64' | 'text'; label?: string };

function findContentBlocks(json: unknown, depth = 0): ContentBlock[] {
    if (depth > 12 || !json || typeof json !== 'object') return [];
    if (Array.isArray(json)) return json.flatMap(item => findContentBlocks(item, depth + 1));
    const obj = json as Record<string, unknown>;
    if (typeof obj.mimeType === 'string' && obj.mimeType.length > 0) {
        const raw = obj.data ?? obj.content ?? obj.body ?? obj.value ?? '';
        if (typeof raw === 'string' && raw.length > 0) {
            const isBase64 = obj.encoding === 'base64' || obj.transferEncoding === 'base64'
                || obj.contentEncoding === 'base64' || raw.startsWith('JVBERi0');
            const label = [obj.name, obj.fileName, obj.filename].find(v => typeof v === 'string') as string | undefined;
            return [{ mimeType: obj.mimeType, data: raw, encoding: isBase64 ? 'base64' : 'text', label }];
        }
    }
    // Only skip data/content/body/value when they are strings (leaf payloads already captured above).
    // When they are objects or arrays they must be walked — e.g. "data": [{...}] or "content": {...}
    return Object.entries(obj)
        .filter(([k, v]) => !(['data', 'content', 'body', 'value'].includes(k) && typeof v === 'string'))
        .flatMap(([, v]) => findContentBlocks(v, depth + 1));
}

function mimeToExt(mimeType: string): string {
    const map: Record<string, string> = {
        'application/pdf': '.pdf', 'application/json': '.json', 'application/xml': '.xml',
        'text/plain': '.txt', 'text/html': '.html', 'text/xml': '.xml',
        'application/zip': '.zip', 'application/x-exstream.messagefile': '.msg',
    };
    return map[mimeType] ?? ('.' + (mimeType.split('/')[1]?.split('+')[0]?.split('.').pop() ?? 'bin'));
}

function downloadBlock(block: ContentBlock, filename: string) {
    let blob: Blob;
    if (block.encoding === 'base64') {
        try {
            const binary = atob(block.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            blob = new Blob([bytes], { type: block.mimeType });
        } catch { blob = new Blob([block.data], { type: block.mimeType }); }
    } else {
        blob = new Blob([block.data], { type: block.mimeType });
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── Types ──────────────────────────────────────────────────────────────────
const PROFILES_STORAGE_KEY = 'dih_fetchdoc_profiles';

type UiEntry = { id: string; enabled: boolean; key: string; value: string };
type AuthMode = 'none' | 'bearer' | 'basic';
type BodyMode = 'none' | 'json' | 'raw' | 'form-urlencoded';
type HttpMethod = 'GET' | 'POST';
type RequestTab = 'params' | 'auth' | 'headers' | 'body';

type State = {
    url: string;
    method: HttpMethod;
    activeTab: RequestTab;
    query: UiEntry[];
    headers: UiEntry[];
    formEntries: UiEntry[];
    authMode: AuthMode;
    bearerToken: string;
    basicUsername: string;
    basicPassword: string;
    bodyMode: BodyMode;
    jsonBody: string;
    rawBody: string;
    rawContentType: string;
    validationError?: string;
    rdiDismissedFor?: string;
    rdiConversionWarnings?: string[];
};

type SavedProfile = {
    id: string;
    name: string;
    savedAt: string;
    method: HttpMethod;
    url: string;
    query: UiEntry[];
    headers: UiEntry[];
    formEntries: UiEntry[];
    authMode: AuthMode;
    bearerToken: string;
    basicUsername: string;
    basicPassword: string;
    bodyMode: BodyMode;
    jsonBody: string;
    rawBody: string;
    rawContentType: string;
};

type Action =
    | { type: 'set-url'; value: string }
    | { type: 'set-method'; value: HttpMethod }
    | { type: 'set-tab'; value: RequestTab }
    | { type: 'set-auth-mode'; value: AuthMode }
    | { type: 'set-body-mode'; value: BodyMode }
    | { type: 'set-bearer-token'; value: string }
    | { type: 'set-basic-username'; value: string }
    | { type: 'set-basic-password'; value: string }
    | { type: 'set-json-body'; value: string }
    | { type: 'set-raw-body'; value: string }
    | { type: 'set-raw-content-type'; value: string }
    | { type: 'set-validation-error'; value?: string }
    | { type: 'entry-update'; collection: 'query' | 'headers' | 'formEntries'; id: string; patch: Partial<UiEntry> }
    | { type: 'entry-add'; collection: 'query' | 'headers' | 'formEntries' }
    | { type: 'entry-remove'; collection: 'query' | 'headers' | 'formEntries'; id: string }
    | { type: 'apply-rdi-flat' }
    | { type: 'apply-rdi-spool' }
    | { type: 'dismiss-rdi-prompt' }
    | { type: 'load-profile'; profile: SavedProfile }
    | { type: 'reset' };

function newEntry(enabled = false): UiEntry {
    return { id: crypto.randomUUID(), enabled, key: '', value: '' };
}

const initialState: State = {
    url: '',
    method: 'GET',
    activeTab: 'params',
    query: [newEntry()],
    headers: [newEntry()],
    formEntries: [newEntry(true)],
    authMode: 'none',
    bearerToken: '',
    basicUsername: '',
    basicPassword: '',
    bodyMode: 'none',
    jsonBody: '{\n  \n}',
    rawBody: '',
    rawContentType: 'text/plain',
};

function reducer(state: State, action: Action): State {
    switch (action.type) {
        case 'set-url': return { ...state, url: action.value };
        case 'set-method': return { ...state, method: action.value };
        case 'set-tab': return { ...state, activeTab: action.value };
        case 'set-auth-mode': return { ...state, authMode: action.value };
        case 'set-body-mode': return { ...state, bodyMode: action.value };
        case 'set-bearer-token': return { ...state, bearerToken: action.value };
        case 'set-basic-username': return { ...state, basicUsername: action.value };
        case 'set-basic-password': return { ...state, basicPassword: action.value };
        case 'set-json-body': return { ...state, jsonBody: action.value };
        case 'set-raw-body': return { ...state, rawBody: action.value };
        case 'set-raw-content-type': return { ...state, rawContentType: action.value };
        case 'set-validation-error': return { ...state, validationError: action.value };
        case 'entry-update': return {
            ...state,
            [action.collection]: (state[action.collection] as UiEntry[]).map(e =>
                e.id === action.id ? { ...e, ...action.patch } : e
            ),
        };
        case 'entry-add': return {
            ...state,
            [action.collection]: [...(state[action.collection] as UiEntry[]), newEntry(true)],
        };
        case 'entry-remove': {
            const filtered = (state[action.collection] as UiEntry[]).filter(e => e.id !== action.id);
            return {
                ...state,
                [action.collection]: filtered.length > 0 ? filtered : [newEntry()],
            };
        }
        case 'apply-rdi-flat': {
            const { xml, warnings } = rdiConvertToFlatXml(state.rawBody);
            return { ...state, rawBody: xml, rawContentType: state.rawContentType === 'text/plain' ? 'application/xml' : state.rawContentType, rdiDismissedFor: xml, rdiConversionWarnings: warnings };
        }
        case 'apply-rdi-spool': {
            const xml = rdiConvertToSpoolXml(state.rawBody);
            return { ...state, rawBody: xml, rawContentType: state.rawContentType === 'text/plain' ? 'application/xml' : state.rawContentType, rdiDismissedFor: xml, rdiConversionWarnings: [] };
        }
        case 'dismiss-rdi-prompt':
            return { ...state, rdiDismissedFor: state.rawBody };
        case 'load-profile': {
            const p = action.profile;
            return {
                ...state,
                method: p.method,
                url: p.url,
                query: p.query.length > 0 ? p.query : [newEntry()],
                headers: p.headers.length > 0 ? p.headers : [newEntry()],
                formEntries: (p.formEntries?.length ?? 0) > 0 ? p.formEntries : [newEntry(true)],
                authMode: p.authMode,
                bearerToken: p.bearerToken,
                basicUsername: p.basicUsername,
                basicPassword: p.basicPassword,
                bodyMode: p.bodyMode,
                jsonBody: p.jsonBody,
                rawBody: p.rawBody,
                rawContentType: p.rawContentType,
                rdiDismissedFor: undefined,
                rdiConversionWarnings: undefined,
                validationError: undefined,
            };
        }
        case 'reset': return { ...initialState };
        default: return state;
    }
}

// ── Response state ─────────────────────────────────────────────────────────
type ResponseState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'success'; httpStatus: number; httpStatusText: string; contentType: string; body: string; bodyEncoding: 'text' | 'base64'; elapsed: number; size: number; headers: Record<string, string> }
    | { status: 'error'; message: string };

// ── Helpers ────────────────────────────────────────────────────────────────
function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatElapsed(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}

function statusBadgeClass(status: number): string {
    if (status >= 200 && status < 300) return 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300';
    if (status >= 300 && status < 400) return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300';
    if (status >= 400 && status < 500) return 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300';
    if (status >= 500) return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300';
    return 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300';
}

function prettyJson(text: string): string {
    try { return JSON.stringify(JSON.parse(text), null, 2); }
    catch { return text; }
}

// ── KeyValueEditor ─────────────────────────────────────────────────────────
const KeyValueEditor: React.FC<{
    entries: UiEntry[];
    keyPlaceholder: string;
    valuePlaceholder: string;
    onAdd: () => void;
    onRemove: (id: string) => void;
    onUpdate: (id: string, patch: Partial<UiEntry>) => void;
}> = ({ entries, keyPlaceholder, valuePlaceholder, onAdd, onRemove, onUpdate }) => (
    <div className="space-y-1.5">
        {entries.map(entry => (
            <div key={entry.id} className="flex items-center gap-1.5">
                <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={e => onUpdate(entry.id, { enabled: e.target.checked })}
                    className="flex-shrink-0 accent-indigo-500"
                    title="Enable this row"
                />
                <input
                    value={entry.key}
                    onChange={e => onUpdate(entry.id, { key: e.target.value })}
                    placeholder={keyPlaceholder}
                    className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono placeholder-slate-400 focus:outline-none focus:border-indigo-400"
                    spellCheck={false}
                />
                <input
                    value={entry.value}
                    onChange={e => onUpdate(entry.id, { value: e.target.value })}
                    placeholder={valuePlaceholder}
                    className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono placeholder-slate-400 focus:outline-none focus:border-indigo-400"
                    spellCheck={false}
                />
                <button
                    type="button"
                    onClick={() => onRemove(entry.id)}
                    className="flex-shrink-0 text-slate-400 hover:text-red-500 transition-colors p-0.5"
                    title="Remove row"
                >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        ))}
        <button type="button" onClick={onAdd} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium">
            + Add row
        </button>
    </div>
);

// ── Main Component ─────────────────────────────────────────────────────────
const FetchDoc: React.FC = () => {
    const { token } = useAuth();
    const [state, dispatch] = useReducer(reducer, initialState);
    const [response, setResponse] = useState<ResponseState>({ status: 'idle' });
    const [isLoading, setIsLoading] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [copied, setCopied] = useState(false);
    const [showHeaders, setShowHeaders] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const timerRef = useRef<number | null>(null);
    const pdfObjectUrlRef = useRef<string | null>(null);
    const pdfBlockUrlRef = useRef<string | null>(null);

    // Profiles state
    const [profiles, setProfiles] = useState<SavedProfile[]>(() => {
        try { return JSON.parse(localStorage.getItem(PROFILES_STORAGE_KEY) || '[]') as SavedProfile[]; }
        catch { return []; }
    });
    const [showProfiles, setShowProfiles] = useState(false);
    const [saveName, setSaveName] = useState('');
    const [loadedProfileId, setLoadedProfileId] = useState<string | null>(null);
    const profilesRef = useRef<HTMLDivElement>(null);

    const persistProfiles = useCallback((updated: SavedProfile[]) => {
        setProfiles(updated);
        try { localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(updated)); } catch { }
    }, []);

    const currentProfileSnapshot = useCallback((): Omit<SavedProfile, 'id' | 'name' | 'savedAt'> => ({
        method: state.method,
        url: state.url,
        query: state.query,
        headers: state.headers,
        formEntries: state.formEntries,
        authMode: state.authMode,
        bearerToken: state.bearerToken,
        basicUsername: state.basicUsername,
        basicPassword: state.basicPassword,
        bodyMode: state.bodyMode,
        jsonBody: state.jsonBody,
        rawBody: state.rawBody,
        rawContentType: state.rawContentType,
    }), [state]);

    const saveProfile = useCallback(() => {
        if (!state.url) return;
        const name = saveName.trim() || `${state.method} ${state.url.slice(0, 50)}`;
        const newProfile: SavedProfile = {
            id: crypto.randomUUID(),
            name,
            savedAt: new Date().toISOString(),
            ...currentProfileSnapshot(),
        };
        persistProfiles([newProfile, ...profiles]);
        setSaveName('');
        setLoadedProfileId(newProfile.id);
    }, [state.url, saveName, profiles, persistProfiles, currentProfileSnapshot]);

    const updateProfile = useCallback((id: string) => {
        const existing = profiles.find(p => p.id === id);
        if (!existing) return;
        persistProfiles(profiles.map(p =>
            p.id === id ? { ...existing, savedAt: new Date().toISOString(), ...currentProfileSnapshot() } : p
        ));
    }, [profiles, persistProfiles, currentProfileSnapshot]);

    const deleteProfile = useCallback((id: string) => {
        persistProfiles(profiles.filter(p => p.id !== id));
        if (loadedProfileId === id) setLoadedProfileId(null);
    }, [profiles, persistProfiles, loadedProfileId]);

    // Close profiles popover on outside click
    useEffect(() => {
        if (!showProfiles) return;
        const handleClick = (e: MouseEvent) => {
            if (profilesRef.current && !profilesRef.current.contains(e.target as Node)) {
                setShowProfiles(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showProfiles]);

    useEffect(() => {
        return () => {
            if (pdfObjectUrlRef.current) URL.revokeObjectURL(pdfObjectUrlRef.current);
            if (pdfBlockUrlRef.current) URL.revokeObjectURL(pdfBlockUrlRef.current);
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    const handleSend = useCallback(async () => {
        const url = state.url.trim();
        if (!url) { dispatch({ type: 'set-validation-error', value: 'URL is required.' }); return; }
        try { new URL(url); }
        catch { dispatch({ type: 'set-validation-error', value: 'Enter a valid URL (must start with http:// or https://).' }); return; }
        dispatch({ type: 'set-validation-error', value: undefined });

        if (abortRef.current) abortRef.current.abort();
        if (timerRef.current) clearInterval(timerRef.current);
        if (pdfObjectUrlRef.current) { URL.revokeObjectURL(pdfObjectUrlRef.current); pdfObjectUrlRef.current = null; }

        const controller = new AbortController();
        abortRef.current = controller;
        const startMs = Date.now();
        setIsLoading(true);
        setElapsed(0);
        setResponse({ status: 'loading' });
        setCopied(false);

        timerRef.current = window.setInterval(() => setElapsed(Date.now() - startMs), 100);

        const payload = {
            method: state.method,
            url,
            query: state.query.map(({ enabled, key, value }) => ({ enabled, key, value })),
            headers: state.headers.map(({ enabled, key, value }) => ({ enabled, key, value })),
            auth: state.authMode === 'bearer'
                ? { type: 'bearer', token: state.bearerToken }
                : state.authMode === 'basic'
                ? { type: 'basic', username: state.basicUsername, password: state.basicPassword }
                : { type: 'none' },
            body: state.bodyMode === 'json'
                ? { mode: 'json', value: state.jsonBody }
                : state.bodyMode === 'raw'
                ? { mode: 'raw', value: state.rawBody, contentType: state.rawContentType }
                : state.bodyMode === 'form-urlencoded'
                ? { mode: 'form-urlencoded', entries: state.formEntries.map(({ enabled, key, value }) => ({ enabled, key, value })) }
                : { mode: 'none' },
        };

        try {
            const res = await fetch('/v1/fetch-doc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });

            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Server error' }));
                setResponse({ status: 'error', message: err.error ?? `Server error: ${res.status}` });
                return;
            }

            const data = await res.json();
            setResponse({
                status: 'success',
                httpStatus: data.httpStatus,
                httpStatusText: data.httpStatusText,
                contentType: data.contentType ?? '',
                body: data.body ?? '',
                bodyEncoding: data.bodyEncoding ?? 'text',
                elapsed: data.elapsed ?? 0,
                size: data.size ?? 0,
                headers: data.headers ?? {},
            });
        } catch (err: any) {
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            if (err.name === 'AbortError') { setResponse({ status: 'idle' }); }
            else { setResponse({ status: 'error', message: err.message ?? 'Request failed.' }); }
        } finally {
            setIsLoading(false);
            abortRef.current = null;
        }
    }, [state, token]);

    const handleCancel = () => {
        if (abortRef.current) abortRef.current.abort();
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setIsLoading(false);
        setResponse({ status: 'idle' });
    };

    const handleReset = useCallback(() => {
        if (abortRef.current) abortRef.current.abort();
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (pdfObjectUrlRef.current) { URL.revokeObjectURL(pdfObjectUrlRef.current); pdfObjectUrlRef.current = null; }
        dispatch({ type: 'reset' });
        setResponse({ status: 'idle' });
        setIsLoading(false);
        setElapsed(0);
        setCopied(false);
        setShowHeaders(false);
        setLoadedProfileId(null);
        setSaveName('');
    }, []);

    const handleCopy = async () => {
        if (response.status !== 'success') return;
        try {
            await navigator.clipboard.writeText(response.bodyEncoding === 'text' ? response.body : '(binary)');
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* ignore */ }
    };

    const pdfSrc = React.useMemo(() => {
        if (response.status !== 'success') return null;
        if (pdfObjectUrlRef.current) URL.revokeObjectURL(pdfObjectUrlRef.current);

        let bytes: Uint8Array | null = null;

        // Case 1: server identified binary PDF (Content-Type: application/pdf, base64-encoded body)
        if (response.contentType.includes('application/pdf') && response.bodyEncoding === 'base64') {
            try {
                const binary = atob(response.body);
                bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            } catch { /* invalid base64 */ }
        }

        // Case 2: body is a raw base64 string returned as text (Content-Type may be text/plain etc.)
        // Detect by checking if the trimmed body starts with the base64 encoding of "%PDF-"
        if (!bytes && response.bodyEncoding === 'text') {
            const trimmed = response.body.trim();
            if (trimmed.startsWith('JVBERi0')) {
                try {
                    const binary = atob(trimmed);
                    if (binary.startsWith('%PDF-')) {
                        bytes = new Uint8Array(binary.length);
                        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    }
                } catch { /* not valid base64 */ }
            }
        }

        // Case 3: binary body (base64 encoded) whose content type wasn't recognised as PDF
        // but the decoded bytes start with the PDF magic bytes
        if (!bytes && response.bodyEncoding === 'base64') {
            try {
                const binary = atob(response.body);
                if (binary.startsWith('%PDF-')) {
                    bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                }
            } catch { /* invalid base64 */ }
        }

        if (!bytes) return null;
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        pdfObjectUrlRef.current = url;
        return url;
    }, [response]);

    // Extract structured content blocks from JSON (or JSON-like text) responses
    const contentBlocks = React.useMemo((): ContentBlock[] | null => {
        if (response.status !== 'success' || response.bodyEncoding !== 'text') return null;
        const trimmed = response.body.trimStart();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
        try {
            const parsed = JSON.parse(response.body);
            const blocks = findContentBlocks(parsed);
            return blocks.length > 0 ? blocks : null;
        } catch { return null; }
    }, [response]);

    // Create object URL for the PDF content block (if any)
    const pdfBlockSrc = React.useMemo((): string | null => {
        if (pdfBlockUrlRef.current) { URL.revokeObjectURL(pdfBlockUrlRef.current); pdfBlockUrlRef.current = null; }
        if (!contentBlocks) return null;
        const pdfBlock = contentBlocks.find(b => b.mimeType === 'application/pdf');
        if (!pdfBlock) return null;
        try {
            let bytes: Uint8Array;
            if (pdfBlock.encoding === 'base64') {
                const binary = atob(pdfBlock.data);
                bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            } else {
                bytes = new TextEncoder().encode(pdfBlock.data);
            }
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
            pdfBlockUrlRef.current = url;
            return url;
        } catch { return null; }
    }, [contentBlocks]);

    const showRdiBanner = React.useMemo(() => {
        if (state.bodyMode !== 'raw') return false;
        if (state.rawBody === state.rdiDismissedFor) return false;
        return rdiIsLikelyContent(state.rawBody);
    }, [state.bodyMode, state.rawBody, state.rdiDismissedFor]);

    const tabs: { id: RequestTab; label: string }[] = [
        { id: 'params', label: 'Params' },
        { id: 'auth', label: 'Auth' },
        { id: 'headers', label: 'Headers' },
        { id: 'body', label: 'Body' },
    ];

    const bodyModes: { value: BodyMode; label: string }[] = [
        { value: 'none', label: 'None' },
        { value: 'json', label: 'JSON' },
        { value: 'raw', label: 'Raw text' },
        { value: 'form-urlencoded', label: 'Form URL-encoded' },
    ];

    const inputCls = 'w-full px-3 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono placeholder-slate-400 focus:outline-none focus:border-indigo-400';
    const labelCls = 'block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1';
    const selectCls = 'px-2.5 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-400';

    return (
        <div className="max-w-6xl mx-auto space-y-4">
            {/* URL Bar */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <div className="flex gap-2 items-center">
                    <div className="flex gap-1 flex-shrink-0">
                        {(['GET', 'POST'] as HttpMethod[]).map(m => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => dispatch({ type: 'set-method', value: m })}
                                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
                                    state.method === m
                                        ? m === 'GET'
                                            ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 ring-1 ring-green-300 dark:ring-green-700'
                                            : 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 ring-1 ring-orange-300 dark:ring-orange-700'
                                        : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                                }`}
                            >
                                {m}
                            </button>
                        ))}
                    </div>

                    <input
                        type="url"
                        value={state.url}
                        onChange={e => dispatch({ type: 'set-url', value: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter' && !isLoading) void handleSend(); }}
                        placeholder="https://api.example.com/v1/resource"
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono placeholder-slate-400 focus:outline-none focus:border-indigo-400"
                        spellCheck={false}
                        autoComplete="off"
                    />

                    {/* Profiles popover */}
                    <div className="relative flex-shrink-0" ref={profilesRef}>
                        <button
                            type="button"
                            onClick={() => setShowProfiles(v => !v)}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 1 1 0-4h14a2 2 0 1 1 0 4M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
                            </svg>
                            Profiles
                            {profiles.length > 0 && (
                                <span className="text-xs text-indigo-600 dark:text-indigo-400 font-bold">({profiles.length})</span>
                            )}
                        </button>
                        {showProfiles && (
                            <div className="absolute right-0 top-full mt-1.5 w-80 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl z-30 p-3 flex flex-col gap-2.5">
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Saved Profiles</p>
                                {profiles.length === 0 ? (
                                    <p className="text-xs text-slate-400 dark:text-slate-500 italic py-1">No saved profiles yet.</p>
                                ) : (
                                    <div className="max-h-52 overflow-y-auto flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
                                        {profiles.map(p => {
                                            const isLoaded = loadedProfileId === p.id;
                                            return (
                                                <div key={p.id} className={`flex items-center gap-2 py-1.5 ${isLoaded ? 'bg-indigo-50 dark:bg-indigo-900/20 -mx-1 px-1 rounded' : ''}`}>
                                                    <span className={`flex-shrink-0 text-xs font-bold px-1.5 py-0.5 rounded ${p.method === 'GET' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'}`}>
                                                        {p.method}
                                                    </span>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs text-slate-700 dark:text-slate-300 truncate font-medium" title={p.name}>
                                                            {isLoaded && <span className="text-indigo-500 dark:text-indigo-400 mr-1">●</span>}
                                                            {p.name}
                                                        </p>
                                                        <p className="text-xs text-slate-400 dark:text-slate-500 truncate font-mono" title={p.url}>{p.url}</p>
                                                    </div>
                                                    {isLoaded ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => { updateProfile(p.id); setShowProfiles(false); }}
                                                            className="flex-shrink-0 text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
                                                            title="Overwrite this profile with current form settings"
                                                        >
                                                            Update
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => { dispatch({ type: 'load-profile', profile: p }); setLoadedProfileId(p.id); setShowProfiles(false); setResponse({ status: 'idle' }); setShowHeaders(false); }}
                                                            className="flex-shrink-0 text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                                                        >
                                                            Load
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => deleteProfile(p.id)}
                                                        className="flex-shrink-0 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                                                        title="Delete profile"
                                                    >
                                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {loadedProfileId && (
                                    <div className="border-t border-slate-200 dark:border-slate-700 pt-2">
                                        <button
                                            type="button"
                                            onClick={() => { updateProfile(loadedProfileId); setShowProfiles(false); }}
                                            disabled={!state.url}
                                            className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded transition-colors"
                                        >
                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                                            </svg>
                                            Update "{profiles.find(p => p.id === loadedProfileId)?.name ?? 'Profile'}"
                                        </button>
                                    </div>
                                )}
                                <div className="border-t border-slate-200 dark:border-slate-700 pt-2 flex gap-1.5 items-center">
                                    <input
                                        value={saveName}
                                        onChange={e => setSaveName(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') saveProfile(); }}
                                        placeholder="Profile name (optional)"
                                        className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-indigo-400"
                                    />
                                    <button
                                        type="button"
                                        onClick={saveProfile}
                                        disabled={!state.url}
                                        className="flex-shrink-0 px-2.5 py-1 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded transition-colors"
                                    >
                                        Save New
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {isLoading ? (
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-colors"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Cancel
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={() => void handleSend()}
                                className="flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
                            >
                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" />
                                </svg>
                                Send
                            </button>
                            <button
                                type="button"
                                onClick={handleReset}
                                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold rounded-lg transition-colors border border-slate-300 dark:border-slate-600"
                                title="Reset form and clear response"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                                </svg>
                                Clear
                            </button>
                        </>
                    )}
                </div>
                {state.validationError && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">{state.validationError}</p>
                )}
            </div>

            {/* Workspace — fills remaining window height with 40px bottom gap */}
            <div className="flex gap-4 flex-col lg:flex-row" style={{ height: 'calc(100vh - 220px)', minHeight: '480px' }}>
                {/* Left: Request Builder */}
                <div className="lg:w-80 xl:w-96 flex-shrink-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
                    <div className="flex border-b border-slate-200 dark:border-slate-700 px-1">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => dispatch({ type: 'set-tab', value: tab.id })}
                                className={`px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                                    state.activeTab === tab.id
                                        ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="p-4 flex-1 overflow-y-auto">
                        {state.activeTab === 'params' && (
                            <div>
                                <p className={labelCls}>Query Parameters</p>
                                <KeyValueEditor
                                    entries={state.query}
                                    keyPlaceholder="Key"
                                    valuePlaceholder="Value"
                                    onAdd={() => dispatch({ type: 'entry-add', collection: 'query' })}
                                    onRemove={id => dispatch({ type: 'entry-remove', collection: 'query', id })}
                                    onUpdate={(id, patch) => dispatch({ type: 'entry-update', collection: 'query', id, patch })}
                                />
                            </div>
                        )}

                        {state.activeTab === 'auth' && (
                            <div className="space-y-3">
                                <div>
                                    <label className={labelCls}>Auth Type</label>
                                    <select
                                        value={state.authMode}
                                        onChange={e => dispatch({ type: 'set-auth-mode', value: e.target.value as AuthMode })}
                                        className={selectCls + ' w-full'}
                                    >
                                        <option value="none">None</option>
                                        <option value="bearer">Bearer Token</option>
                                        <option value="basic">Basic Auth</option>
                                    </select>
                                </div>
                                {state.authMode === 'bearer' && (
                                    <div>
                                        <label className={labelCls}>Token</label>
                                        <input
                                            type="password"
                                            value={state.bearerToken}
                                            onChange={e => dispatch({ type: 'set-bearer-token', value: e.target.value })}
                                            placeholder="Bearer token"
                                            className={inputCls}
                                            autoComplete="off"
                                        />
                                    </div>
                                )}
                                {state.authMode === 'basic' && (
                                    <div className="space-y-2">
                                        <div>
                                            <label className={labelCls}>Username</label>
                                            <input
                                                value={state.basicUsername}
                                                onChange={e => dispatch({ type: 'set-basic-username', value: e.target.value })}
                                                placeholder="username"
                                                className={inputCls}
                                                autoComplete="off"
                                            />
                                        </div>
                                        <div>
                                            <label className={labelCls}>Password</label>
                                            <input
                                                type="password"
                                                value={state.basicPassword}
                                                onChange={e => dispatch({ type: 'set-basic-password', value: e.target.value })}
                                                placeholder="password"
                                                className={inputCls}
                                                autoComplete="off"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {state.activeTab === 'headers' && (
                            <div>
                                <p className={labelCls}>Request Headers</p>
                                <KeyValueEditor
                                    entries={state.headers}
                                    keyPlaceholder="Header name"
                                    valuePlaceholder="Value"
                                    onAdd={() => dispatch({ type: 'entry-add', collection: 'headers' })}
                                    onRemove={id => dispatch({ type: 'entry-remove', collection: 'headers', id })}
                                    onUpdate={(id, patch) => dispatch({ type: 'entry-update', collection: 'headers', id, patch })}
                                />
                            </div>
                        )}

                        {state.activeTab === 'body' && (
                            <div className="space-y-3">
                                <div>
                                    <label className={labelCls}>Body Mode</label>
                                    <select
                                        value={state.bodyMode}
                                        onChange={e => dispatch({ type: 'set-body-mode', value: e.target.value as BodyMode })}
                                        className={selectCls + ' w-full'}
                                    >
                                        {bodyModes.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                    </select>
                                </div>
                                {state.method === 'GET' && state.bodyMode !== 'none' && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400">GET requests do not send a body. Switch to POST.</p>
                                )}
                                {state.bodyMode === 'json' && (
                                    <textarea
                                        rows={12}
                                        value={state.jsonBody}
                                        onChange={e => dispatch({ type: 'set-json-body', value: e.target.value })}
                                        className="w-full px-3 py-2 text-xs font-mono rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-400 resize-y"
                                        spellCheck={false}
                                    />
                                )}
                                {state.bodyMode === 'raw' && (
                                    <div className="space-y-2">
                                        <div>
                                            <label className={labelCls}>Content Type</label>
                                            <input
                                                value={state.rawContentType}
                                                onChange={e => dispatch({ type: 'set-raw-content-type', value: e.target.value })}
                                                className={inputCls}
                                                spellCheck={false}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between mb-1">
                                            <label className={labelCls}>Body</label>
                                            <span className="text-xs text-slate-400 dark:text-slate-500">RDI data is auto-detected</span>
                                        </div>
                                        <textarea
                                            rows={10}
                                            value={state.rawBody}
                                            onChange={e => dispatch({ type: 'set-raw-body', value: e.target.value })}
                                            className="w-full px-3 py-2 text-xs font-mono rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-400 resize-y"
                                            spellCheck={false}
                                        />
                                        {showRdiBanner && (
                                            <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3">
                                                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">
                                                    RDI print-stream data detected
                                                </p>
                                                <p className="text-xs text-amber-600 dark:text-amber-300 mb-3">
                                                    Used by OpenText Exstream, SAP, and other CCM platforms. Convert to Flat XML before sending?
                                                </p>
                                                <div className="flex gap-2 flex-wrap">
                                                    <button
                                                        type="button"
                                                        onClick={() => dispatch({ type: 'apply-rdi-spool' })}
                                                        className="px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md transition-colors"
                                                    >
                                                        Convert to Flat XML
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => dispatch({ type: 'dismiss-rdi-prompt' })}
                                                        className="px-3 py-1.5 text-xs font-semibold bg-white dark:bg-slate-700 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-600 rounded-md hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors"
                                                    >
                                                        Dismiss
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        {!showRdiBanner && state.rdiConversionWarnings && state.rdiConversionWarnings.length > 0 && (
                                            <p className="text-xs text-amber-600 dark:text-amber-400">
                                                RDI conversion completed with {state.rdiConversionWarnings.length} warning{state.rdiConversionWarnings.length === 1 ? '' : 's'}: {state.rdiConversionWarnings.join(' ')}
                                            </p>
                                        )}
                                    </div>
                                )}
                                {state.bodyMode === 'form-urlencoded' && (
                                    <KeyValueEditor
                                        entries={state.formEntries}
                                        keyPlaceholder="Field name"
                                        valuePlaceholder="Value"
                                        onAdd={() => dispatch({ type: 'entry-add', collection: 'formEntries' })}
                                        onRemove={id => dispatch({ type: 'entry-remove', collection: 'formEntries', id })}
                                        onUpdate={(id, patch) => dispatch({ type: 'entry-update', collection: 'formEntries', id, patch })}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Response Pane */}
                <div className="flex-1 min-w-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
                    {/* Response toolbar */}
                    <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 flex-wrap">
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Response</span>
                        {response.status === 'success' && (
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${statusBadgeClass(response.httpStatus)}`}>
                                    {response.httpStatus} {response.httpStatusText}
                                </span>
                                {response.contentType && (
                                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">{response.contentType.split(';')[0]}</span>
                                )}
                                <span className="text-xs text-slate-400">{formatSize(response.size)}</span>
                                <span className="text-xs text-slate-400">{formatElapsed(response.elapsed)}</span>
                                <button
                                    type="button"
                                    onClick={() => setShowHeaders(h => !h)}
                                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                                >
                                    {showHeaders ? 'Hide headers' : 'Headers'}
                                </button>
                                {response.bodyEncoding === 'text' && (
                                    <button
                                        type="button"
                                        onClick={() => void handleCopy()}
                                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                                    >
                                        {copied ? 'Copied!' : 'Copy'}
                                    </button>
                                )}
                            </div>
                        )}
                        {response.status === 'loading' && (
                            <div className="flex items-center gap-2">
                                <svg className="w-3.5 h-3.5 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                                </svg>
                                <span className="text-xs text-slate-500 dark:text-slate-400">{formatElapsed(elapsed)}</span>
                            </div>
                        )}
                    </div>

                    {/* Response headers table */}
                    {response.status === 'success' && showHeaders && (
                        <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 max-h-40 overflow-y-auto">
                            <table className="w-full text-xs font-mono">
                                <tbody>
                                    {Object.entries(response.headers).map(([k, v]) => (
                                        <tr key={k} className="align-top">
                                            <td className="pr-3 text-slate-500 dark:text-slate-400 whitespace-nowrap py-0.5">{k}</td>
                                            <td className="text-slate-700 dark:text-slate-300 break-all py-0.5">{v}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Response body */}
                    <div className="flex-1 overflow-auto">
                        {response.status === 'idle' && (
                            <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500" style={{ minHeight: '200px' }}>
                                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
                                </svg>
                                <p className="text-sm">Send a request to see the response</p>
                            </div>
                        )}

                        {response.status === 'loading' && (
                            <div className="h-full flex items-center justify-center" style={{ minHeight: '200px' }}>
                                <div className="flex flex-col items-center gap-3 text-slate-400">
                                    <svg className="w-8 h-8 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                                    </svg>
                                    <p className="text-sm">Sending request…</p>
                                </div>
                            </div>
                        )}

                        {response.status === 'error' && (
                            <div className="p-4">
                                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
                                    <p className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">Request Failed</p>
                                    <p className="text-sm text-red-600 dark:text-red-300">{response.message}</p>
                                </div>
                            </div>
                        )}

                        {response.status === 'success' && (() => {
                            const ct = response.contentType.toLowerCase();

                            // ── Multi-block JSON response ──────────────────────────────
                            if (contentBlocks && contentBlocks.length > 0) {
                                const pdfBlock = contentBlocks.find(b => b.mimeType === 'application/pdf');
                                const otherBlocks = contentBlocks.filter(b => b.mimeType !== 'application/pdf');
                                return (
                                    <div className="flex flex-col h-full min-h-0">
                                        {/* Download tiles for non-PDF blocks */}
                                        {otherBlocks.length > 0 && (
                                            <div className="flex-shrink-0 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 flex flex-wrap gap-2">
                                                <span className="w-full text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Content Blocks</span>
                                                {otherBlocks.map((block, i) => {
                                                    const ext = mimeToExt(block.mimeType);
                                                    const filename = block.label ?? `content-block-${i + 1}${ext}`;
                                                    return (
                                                        <button
                                                            key={i}
                                                            type="button"
                                                            onClick={() => downloadBlock(block, filename)}
                                                            className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700 text-left transition-colors"
                                                        >
                                                            <svg className="w-5 h-5 text-indigo-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                                            </svg>
                                                            <div>
                                                                <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{filename}</p>
                                                                <p className="text-xs text-slate-400 dark:text-slate-500">{block.mimeType}{block.encoding === 'base64' ? ' · base64 decoded' : ''}</p>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                                {/* PDF download tile when PDF is also present */}
                                                {pdfBlock && pdfBlockSrc && (
                                                    <a
                                                        href={pdfBlockSrc}
                                                        download="response.pdf"
                                                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700 text-left transition-colors"
                                                    >
                                                        <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                                                        </svg>
                                                        <div>
                                                            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">response.pdf</p>
                                                            <p className="text-xs text-slate-400 dark:text-slate-500">application/pdf · Download</p>
                                                        </div>
                                                    </a>
                                                )}
                                            </div>
                                        )}
                                        {/* PDF viewer */}
                                        {pdfBlock && pdfBlockSrc ? (
                                            <div className="flex-1 flex flex-col p-3 min-h-0">
                                                <div className="flex gap-3 mb-2 flex-shrink-0">
                                                    <a href={pdfBlockSrc} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Open in new tab ↗</a>
                                                    <a href={pdfBlockSrc} download="response.pdf" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Download PDF ↓</a>
                                                </div>
                                                <iframe src={pdfBlockSrc} title="PDF response" className="flex-1 w-full rounded border border-slate-200 dark:border-slate-700" style={{ minHeight: '400px' }} />
                                            </div>
                                        ) : !pdfBlock && otherBlocks.length === 0 ? (
                                            <pre className="p-4 text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
                                                {prettyJson(response.body)}
                                            </pre>
                                        ) : null}
                                    </div>
                                );
                            }

                            // ── Single binary/PDF response ─────────────────────────────
                            if (ct.includes('application/pdf') && pdfSrc) {
                                return (
                                    <div className="flex flex-col gap-2 p-3 h-full">
                                        <div className="flex gap-3">
                                            <a href={pdfSrc} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Open in new tab ↗</a>
                                            <a href={pdfSrc} download="response.pdf" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Download PDF ↓</a>
                                        </div>
                                        <iframe src={pdfSrc} title="PDF response" className="flex-1 w-full rounded border border-slate-200 dark:border-slate-700" style={{ minHeight: '400px' }} />
                                    </div>
                                );
                            }
                            if (response.bodyEncoding === 'base64') {
                                return (
                                    <div className="p-4">
                                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-3">
                                            <p className="text-sm text-slate-600 dark:text-slate-300">Binary response ({formatSize(response.size)})</p>
                                            <a href={`data:${response.contentType};base64,${response.body}`} download="response-body" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline font-medium">↓ Download response</a>
                                        </div>
                                    </div>
                                );
                            }
                            const displayBody = ct.includes('application/json') || ct.includes('+json')
                                ? prettyJson(response.body)
                                : response.body;
                            return (
                                <pre className="p-4 text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
                                    {displayBody}
                                </pre>
                            );
                        })()}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FetchDoc;
