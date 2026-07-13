import React, { useState, useRef, useCallback } from 'react';
import LLMWarning from './LLMWarning';
import { useSettings } from '../contexts/SettingsContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FieldMatch {
  field: string; xmlKey: string; value: string; found: boolean; matchType: string;
  page: number | null; x: number | null; y: number | null; w: number | null; h: number | null;
}

interface ValidationResult {
  id: string; field: string; category: string; description: string;
  status: 'PASS' | 'FAIL' | 'NA'; reason: string; page: number | null;
  x: number | null; y: number | null; w: number | null; h: number | null;
}

interface Summary { total: number; passed: number; failed: number; na: number; skipped: number; }
interface ValidateResponse { summary: Summary; fieldMap: FieldMatch[]; results: ValidationResult[]; }

type Mode = 'deterministic' | 'ai';
type FileSlot = 'pdf' | 'data' | 'rules' | 'testcases';

interface SlotState { pdf: File | null; data: File | null; rules: File | null; testcases: File | null; }

interface ColFilters {
  id: string;       // 'ALL' | 'TC-' | 'FC-' | 'BF-' | 'OID-'
  field: string;
  category: string; // 'ALL' | specific category
  status: string;   // 'ALL' | 'PASS' | 'FAIL' | 'NA'
  page: string;     // '' | 'p1' | 'p2' ...
}

const EMPTY_FILTERS: ColFilters = { id: 'ALL', field: '', category: 'ALL', status: 'ALL', page: '' };

// ─── File Auto-Detection ──────────────────────────────────────────────────────

async function detectFileRole(file: File): Promise<FileSlot | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'json' || ext === 'xml') return 'data';
  if (ext === 'csv') {
    const nameLc = file.name.toLowerCase();
    if (/test|tc[-_ ]|testcase/.test(nameLc)) return 'testcases';
    try {
      const text = await file.slice(0, 512).text();
      const firstLine = text.split('\n')[0] ?? '';
      if (/Test Case ID|TC-\d|Category.*Description/i.test(firstLine)) return 'testcases';
    } catch { /* ignore */ }
    return 'rules';
  }
  return null;
}

// ─── Slot metadata ────────────────────────────────────────────────────────────

const SLOT_META: Array<{ key: FileSlot; label: string; accept: string; hint: string; required: boolean }> = [
  { key: 'pdf',       label: 'PDF to Validate', accept: '.pdf',       hint: '.pdf',         required: true },
  { key: 'data',      label: 'Input Data',       accept: '.json,.xml', hint: '.json / .xml', required: true },
  { key: 'testcases', label: 'Test Cases',       accept: '.csv',       hint: '.csv',         required: true },
  { key: 'rules',     label: 'Business Rules',   accept: '.csv',       hint: '.csv',         required: false },
];

const SLOT_COLORS: Record<FileSlot, { filled: string; empty: string }> = {
  pdf:       { filled: 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300',         empty: 'border-slate-200 dark:border-slate-600 text-slate-400 hover:border-blue-300 dark:hover:border-blue-700' },
  data:      { filled: 'bg-violet-50 dark:bg-violet-900/20 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300', empty: 'border-slate-200 dark:border-slate-600 text-slate-400 hover:border-violet-300 dark:hover:border-violet-700' },
  testcases: { filled: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300', empty: 'border-slate-200 dark:border-slate-600 text-slate-400 hover:border-indigo-300 dark:hover:border-indigo-700' },
  rules:     { filled: 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300',       empty: 'border-dashed border-slate-200 dark:border-slate-600 text-slate-400 hover:border-slate-400' },
};

// ─── Multi-File Drop Zone ─────────────────────────────────────────────────────

interface MultiDropZoneProps { slots: SlotState; onSlotChange: (slot: FileSlot, file: File | null) => void; }

const MultiDropZone: React.FC<MultiDropZoneProps> = ({ slots, onSlotChange }) => {
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const slotRefs = useRef<Partial<Record<FileSlot, HTMLInputElement | null>>>({});
  const [dragging, setDragging] = useState(false);

  const assignFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const taken: Partial<Record<FileSlot, boolean>> = {};
    for (const [k, v] of Object.entries(slots)) if (v !== null) taken[k as FileSlot] = true;
    for (const file of files) {
      let role = await detectFileRole(file);
      if (!role) continue;
      if (taken[role]) {
        if (role === 'testcases' && !taken['rules']) role = 'rules';
        else if (role === 'rules' && !taken['testcases']) role = 'testcases';
        else continue;
      }
      taken[role] = true;
      onSlotChange(role, file);
    }
  }, [slots, onSlotChange]);

  return (
    <div className="space-y-3">
      <div
        onClick={() => bulkInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); assignFiles(e.dataTransfer.files); }}
        className={`flex items-center justify-center gap-3 px-4 py-4 rounded-xl border-2 border-dashed cursor-pointer transition-colors
          ${dragging ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20' : 'border-slate-300 dark:border-slate-600 hover:border-indigo-300 dark:hover:border-indigo-600 bg-slate-50/50 dark:bg-slate-800/50'}`}
      >
        <input ref={bulkInputRef} type="file" multiple accept=".pdf,.json,.xml,.csv" className="hidden"
          onChange={e => { if (e.target.files) assignFiles(e.target.files); e.target.value = ''; }} />
        <svg className="w-7 h-7 flex-shrink-0 text-slate-300 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <div>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Drop all files here — auto-detected</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">PDF · JSON/XML · Test Cases CSV · Business Rules CSV</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {SLOT_META.map(({ key, label, accept, hint, required }) => {
          const file = slots[key];
          const colors = SLOT_COLORS[key];
          return (
            <div key={key} className="relative">
              <input type="file" accept={accept} className="hidden"
                ref={el => { slotRefs.current[key] = el; }}
                onChange={e => { const f = e.target.files?.[0]; if (f) onSlotChange(key, f); e.target.value = ''; }}
              />
              <div onClick={() => slotRefs.current[key]?.click()}
                className={`flex flex-col gap-0.5 px-3 py-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${file ? colors.filled : colors.empty}`}
              >
                <span className="font-semibold leading-none">
                  {label}{required && !file && <span className="text-red-400 ml-0.5">*</span>}
                </span>
                {file
                  ? <span className="truncate opacity-80 pr-4" title={file.name}>{file.name}</span>
                  : <span className="opacity-60">{hint} — click to browse</span>
                }
              </div>
              {file && (
                <button onClick={e => { e.stopPropagation(); onSlotChange(key, null); }}
                  className="absolute top-1.5 right-1.5 text-slate-400 hover:text-red-500 text-xs leading-none" title="Remove"
                >✕</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Badges ───────────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: 'PASS' | 'FAIL' | 'NA' }> = ({ status }) => {
  const styles = {
    PASS: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
    FAIL: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
    NA:   'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
  };
  const icons = { PASS: '✓', FAIL: '✗', NA: '—' };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${styles[status]}`}>{icons[status]} {status}</span>;
};

const CategoryBadge: React.FC<{ category: string }> = ({ category }) => {
  const styles: Record<string, string> = {
    'Field Coverage': 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300',
    'Bug Finding':    'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  };
  const style = styles[category] ?? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400';
  return <span className={`px-2 py-0.5 rounded-full text-xs ${style}`}>{category}</span>;
};

// ─── Filter input helpers ─────────────────────────────────────────────────────

const filterInputCls = 'w-full text-xs rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400';

// ─── Main Component ───────────────────────────────────────────────────────────

const PdfValidator: React.FC = () => {
  const { settings } = useSettings();

  const [slots, setSlots] = useState<SlotState>({ pdf: null, data: null, rules: null, testcases: null });
  const [mode, setMode] = useState<Mode>('ai');

  const [loading, setLoading] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [fieldMap, setFieldMap] = useState<FieldMatch[]>([]);
  const [results, setResults] = useState<ValidationResult[]>([]);

  const [colFilters, setColFilters] = useState<ColFilters>(EMPTY_FILTERS);
  const [globalSearch, setGlobalSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const provider = settings.llmProvider ?? 'gemini';

  const handleSlotChange = useCallback((slot: FileSlot, file: File | null) => {
    setSlots(prev => ({ ...prev, [slot]: file }));
  }, []);

  const setCol = useCallback(<K extends keyof ColFilters>(key: K, val: ColFilters[K]) => {
    setColFilters(prev => ({ ...prev, [key]: val }));
  }, []);

  const hasActiveFilters = colFilters.id !== 'ALL' || colFilters.field || colFilters.category !== 'ALL' ||
    colFilters.status !== 'ALL' || colFilters.page || globalSearch;

  // ── Validate ──────────────────────────────────────────────────────────────

  const handleValidate = async () => {
    const { pdf: pdfFile, data: dataFile, testcases: testcasesFile, rules: rulesFile } = slots;
    if (!pdfFile || !dataFile || !testcasesFile) {
      setError('PDF, Input Data, and Test Cases files are required.');
      return;
    }
    setLoading(true); setError(null); setSummary(null); setResults([]); setFieldMap([]);
    setColFilters(EMPTY_FILTERS); setGlobalSearch('');

    try {
      const fd = new FormData();
      fd.append('pdf', pdfFile);
      fd.append('data', dataFile);
      fd.append('testcases', testcasesFile);
      if (rulesFile) fd.append('rules', rulesFile);
      fd.append('mode', mode);
      fd.append('provider', provider);
      const apiKey = provider === 'claude' ? settings.claudeApiKey : settings.geminiApiKey;
      if (apiKey) fd.append('apiKey', apiKey);

      const resp = await fetch('/v1/pdf-validator/validate', { method: 'POST', body: fd });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error((err as any).error ?? resp.statusText);
      }
      const data: ValidateResponse = await resp.json();
      setSummary(data.summary);
      setFieldMap(data.fieldMap);
      setResults(data.results);
    } catch (e: any) {
      setError(e.message ?? 'Validation failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Annotate ──────────────────────────────────────────────────────────────

  const handleAnnotate = async () => {
    const pdfFile = slots.pdf;
    if (!pdfFile || results.length === 0) return;
    setAnnotating(true);
    try {
      const fd = new FormData();
      fd.append('pdf', pdfFile);
      fd.append('fieldMap', JSON.stringify(fieldMap));
      fd.append('results', JSON.stringify(results));

      const resp = await fetch('/v1/pdf-validator/annotate', { method: 'POST', body: fd });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error ?? resp.statusText);

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'validated-annotated.pdf'; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message ?? 'Annotation failed');
    } finally {
      setAnnotating(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const uniqueCategories = [...new Set(results.map(r => r.category))].sort();
  const uniquePages = (Array.from(new Set(results.filter(r => r.page != null).map(r => `p${r.page}`))) as string[])
    .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));

  const filtered = results.filter(r => {
    if (colFilters.id !== 'ALL' && !r.id.startsWith(colFilters.id)) return false;
    if (colFilters.field && !r.field.toLowerCase().includes(colFilters.field.toLowerCase())) return false;
    if (colFilters.category !== 'ALL' && r.category !== colFilters.category) return false;
    if (colFilters.status !== 'ALL' && r.status !== colFilters.status) return false;
    if (colFilters.page) {
      const rPage = r.page != null ? `p${r.page}` : '';
      if (rPage !== colFilters.page) return false;
    }
    if (globalSearch) {
      const q = globalSearch.toLowerCase();
      return r.id.toLowerCase().includes(q) || r.field.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q);
    }
    return true;
  });

  const decisive = summary ? summary.passed + summary.failed : 0;
  const passRate = decisive > 0 ? Math.round((summary!.passed / decisive) * 100) : 0;
  const canValidate = !loading && !!slots.pdf && !!slots.data && !!slots.testcases;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* ── Upload Panel ── */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">Upload Files</h3>
        <MultiDropZone slots={slots} onSlotChange={handleSlotChange} />

        <div className="flex items-center gap-4 flex-wrap mt-4">
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700 rounded-lg p-1">
            {(['deterministic', 'ai'] as Mode[]).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  mode === m ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {m === 'deterministic' ? 'Deterministic' : 'AI-Assisted'}
              </button>
            ))}
          </div>
          {mode === 'ai' && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Provider: <span className="font-medium text-indigo-500">{provider}</span>
            </span>
          )}
          <button onClick={handleValidate} disabled={!canValidate}
            className="ml-auto px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white text-sm font-semibold transition-colors flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>Validating…
              </>
            ) : 'Validate'}
          </button>
        </div>
        {mode === 'ai' && <LLMWarning onGoToSettings={() => {}} />}
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* ── Summary ── */}
      {summary && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex gap-5 flex-1 flex-wrap items-end">
              {[
                { label: 'Total Run', value: summary.total,   color: 'text-slate-700 dark:text-slate-300' },
                { label: 'Passed',    value: summary.passed,  color: 'text-green-600 dark:text-green-400' },
                { label: 'Failed',    value: summary.failed,  color: 'text-red-600 dark:text-red-400' },
                { label: 'N/A',       value: summary.na,      color: 'text-slate-400 dark:text-slate-500' },
                { label: 'Skipped',   value: summary.skipped, color: 'text-amber-500 dark:text-amber-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center min-w-[52px]">
                  <div className={`text-2xl font-bold ${color}`}>{value}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
                </div>
              ))}
              {decisive > 0 && (
                <div className="flex-1 flex items-center gap-2 min-w-[120px]">
                  <div className="flex-1 h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${passRate}%` }} />
                  </div>
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">{passRate}% pass</span>
                </div>
              )}
            </div>

            <button onClick={handleAnnotate} disabled={annotating || results.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white text-sm font-semibold transition-colors"
            >
              {annotating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>Generating…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>Download Annotated PDF
                </>
              )}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400 dark:text-slate-500">
            {summary.skipped > 0 && <span>{summary.skipped} test case{summary.skipped > 1 ? 's' : ''} skipped — field not in input data</span>}
            {decisive > 0 && summary.na > 0 && <span>Pass rate excludes {summary.na} N/A result{summary.na > 1 ? 's' : ''}</span>}
          </div>
        </div>
      )}

      {/* ── Results Table ── */}
      {results.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">

          {/* Toolbar */}
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {filtered.length} / {results.length} results
            </span>
            {hasActiveFilters && (
              <button
                onClick={() => { setColFilters(EMPTY_FILTERS); setGlobalSearch(''); }}
                className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-0.5"
              >
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/></svg>
                Clear filters
              </button>
            )}
            <input
              value={globalSearch} onChange={e => setGlobalSearch(e.target.value)}
              placeholder="Search all columns…"
              className="ml-auto px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-52"
            />
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                {/* Column headers */}
                <tr className="bg-slate-50 dark:bg-slate-700/50">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">ID</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">Field / Section</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">Category</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">Page</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">Reason / Detail</th>
                </tr>

                {/* Column filter row */}
                <tr className="bg-slate-50/70 dark:bg-slate-700/30 border-t border-b border-slate-200 dark:border-slate-700">
                  {/* ID filter — prefix select */}
                  <td className="px-2 py-1.5">
                    <select value={colFilters.id} onChange={e => setCol('id', e.target.value)} className={filterInputCls}>
                      <option value="ALL">All</option>
                      <option value="TC-">TC-*</option>
                      <option value="FC-">FC-*</option>
                      <option value="BF-">BF-*</option>
                      <option value="OID-">OID-*</option>
                    </select>
                  </td>
                  {/* Field filter */}
                  <td className="px-2 py-1.5">
                    <input value={colFilters.field} onChange={e => setCol('field', e.target.value)}
                      placeholder="Filter…" className={filterInputCls} />
                  </td>
                  {/* Category filter */}
                  <td className="px-2 py-1.5">
                    <select value={colFilters.category} onChange={e => setCol('category', e.target.value)} className={filterInputCls}>
                      <option value="ALL">All</option>
                      {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  {/* Status filter */}
                  <td className="px-2 py-1.5">
                    <select value={colFilters.status} onChange={e => setCol('status', e.target.value)} className={filterInputCls}>
                      <option value="ALL">All</option>
                      <option value="PASS">PASS</option>
                      <option value="FAIL">FAIL</option>
                      <option value="NA">NA</option>
                    </select>
                  </td>
                  {/* Page filter */}
                  <td className="px-2 py-1.5">
                    <select value={colFilters.page} onChange={e => setCol('page', e.target.value)} className={filterInputCls}>
                      <option value="">All</option>
                      {uniquePages.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  {/* Reason — no per-column filter (use global search) */}
                  <td className="px-2 py-1.5 text-xs text-slate-400 dark:text-slate-600 italic">use search ↑</td>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {filtered.map(r => (
                  <React.Fragment key={r.id}>
                    <tr
                      onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                      className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors ${r.status === 'FAIL' ? 'bg-red-50/30 dark:bg-red-900/10' : ''}`}
                    >
                      <td className="px-4 py-2.5 font-mono font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">{r.id}</td>
                      <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300 max-w-[140px] truncate">{r.field}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap"><CategoryBadge category={r.category} /></td>
                      <td className="px-4 py-2.5 whitespace-nowrap"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400 text-center whitespace-nowrap">{r.page != null ? `p${r.page}` : '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400 max-w-xs">
                        <span className="line-clamp-1">{r.reason}</span>
                      </td>
                    </tr>
                    {expandedId === r.id && (
                      <tr className="bg-slate-50/80 dark:bg-slate-800/80">
                        <td colSpan={6} className="px-6 py-3">
                          <div className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
                            <div><span className="font-semibold text-slate-700 dark:text-slate-300">Description:</span> {r.description}</div>
                            <div><span className="font-semibold text-slate-700 dark:text-slate-300">Reason:</span> {r.reason}</div>
                            {r.page != null && (
                              <div><span className="font-semibold text-slate-700 dark:text-slate-300">Location:</span> Page {r.page}
                                {r.x != null && ` — x:${Math.round(r.x)} y:${Math.round(r.y!)} w:${Math.round(r.w!)} h:${Math.round(r.h!)}`}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500 text-sm">
                      No results match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
            <span>Click a row to expand details</span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-slate-300"></span>TC-* Test Cases</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-teal-400"></span>FC-* Field Coverage</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-orange-400"></span>BF-* Bug Findings</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-purple-400"></span>OID-* Output Issues</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PdfValidator;
