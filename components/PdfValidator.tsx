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

type StatusFilter = 'ALL' | 'PASS' | 'FAIL' | 'NA';
type Mode = 'deterministic' | 'ai';
type FileSlot = 'pdf' | 'data' | 'rules' | 'testcases';

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

// ─── Multi-File Drop Zone ─────────────────────────────────────────────────────

interface SlotState {
  pdf: File | null;
  data: File | null;
  rules: File | null;
  testcases: File | null;
}

interface MultiDropZoneProps {
  slots: SlotState;
  onSlotChange: (slot: FileSlot, file: File | null) => void;
}

const SLOT_META: Array<{ key: FileSlot; label: string; hint: string; required: boolean }> = [
  { key: 'pdf',       label: 'PDF',           hint: '.pdf',        required: true },
  { key: 'data',      label: 'Input Data',     hint: '.json / .xml', required: true },
  { key: 'testcases', label: 'Test Cases',     hint: '.csv',        required: true },
  { key: 'rules',     label: 'Business Rules', hint: '.csv',        required: false },
];

const SLOT_COLORS: Record<FileSlot, { filled: string; empty: string }> = {
  pdf:       { filled: 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300',     empty: 'border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500' },
  data:      { filled: 'bg-violet-50 dark:bg-violet-900/20 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300', empty: 'border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500' },
  testcases: { filled: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300', empty: 'border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500' },
  rules:     { filled: 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300',   empty: 'border-dashed border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500' },
};

const MultiDropZone: React.FC<MultiDropZoneProps> = ({ slots, onSlotChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const assignFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    // Track remaining available slots to handle multiple CSVs
    const taken: Partial<Record<FileSlot, boolean>> = {};
    for (const [k, v] of Object.entries(slots)) {
      if (v !== null) taken[k as FileSlot] = true;
    }

    for (const file of files) {
      let role = await detectFileRole(file);
      if (!role) continue;
      // If slot is already occupied try the other CSV slot
      if (taken[role]) {
        if (role === 'testcases' && !taken['rules']) role = 'rules';
        else if (role === 'rules' && !taken['testcases']) role = 'testcases';
        else continue; // Both CSV slots taken — skip
      }
      taken[role] = true;
      onSlotChange(role, file);
    }
  }, [slots, onSlotChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    assignFiles(e.dataTransfer.files);
  }, [assignFiles]);

  return (
    <div className="space-y-3">
      {/* Drop target */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors
          ${dragging
            ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
            : 'border-slate-300 dark:border-slate-600 hover:border-indigo-300 dark:hover:border-indigo-600 bg-slate-50/50 dark:bg-slate-800/50'
          }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.json,.xml,.csv"
          className="hidden"
          onChange={e => { if (e.target.files) assignFiles(e.target.files); e.target.value = ''; }}
        />
        <svg className="w-8 h-8 text-slate-300 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <div className="text-center">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Drop files here or click to browse</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">PDF · JSON/XML · CSV (rules &amp; test cases) — auto-detected</p>
        </div>
      </div>

      {/* Slot chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {SLOT_META.map(({ key, label, hint, required }) => {
          const file = slots[key];
          const colors = SLOT_COLORS[key];
          return (
            <div
              key={key}
              className={`relative flex flex-col gap-0.5 px-3 py-2 rounded-lg border text-xs transition-colors ${file ? colors.filled : colors.empty}`}
            >
              <span className="font-semibold leading-none">
                {label}
                {required && !file && <span className="text-red-400 ml-0.5">*</span>}
              </span>
              {file ? (
                <>
                  <span className="truncate opacity-80">{file.name}</span>
                  <button
                    onClick={() => onSlotChange(key, null)}
                    className="absolute top-1 right-1.5 text-slate-400 hover:text-red-500 text-xs leading-none"
                    title="Remove"
                  >✕</button>
                </>
              ) : (
                <span className="opacity-60">{hint}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Status Badge ─────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: 'PASS' | 'FAIL' | 'NA' }> = ({ status }) => {
  const styles = {
    PASS: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
    FAIL: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
    NA:   'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
  };
  const icons = { PASS: '✓', FAIL: '✗', NA: '—' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${styles[status]}`}>
      {icons[status]} {status}
    </span>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const PdfValidator: React.FC = () => {
  const { settings } = useSettings();

  const [slots, setSlots] = useState<SlotState>({ pdf: null, data: null, rules: null, testcases: null });
  const [mode, setMode] = useState<Mode>('deterministic');

  const [loading, setLoading] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [fieldMap, setFieldMap] = useState<FieldMatch[]>([]);
  const [results, setResults] = useState<ValidationResult[]>([]);

  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const provider = settings.llmProvider ?? 'gemini';

  const handleSlotChange = useCallback((slot: FileSlot, file: File | null) => {
    setSlots(prev => ({ ...prev, [slot]: file }));
  }, []);

  // ── Validate ────────────────────────────────────────────────────────────────

  const handleValidate = async () => {
    const { pdf: pdfFile, data: dataFile, testcases: testcasesFile, rules: rulesFile } = slots;
    if (!pdfFile || !dataFile || !testcasesFile) {
      setError('PDF, Input Data, and Test Cases files are required.');
      return;
    }
    setLoading(true); setError(null); setSummary(null); setResults([]); setFieldMap([]);

    try {
      const fd = new FormData();
      fd.append('pdf', pdfFile);
      fd.append('data', dataFile);
      fd.append('testcases', testcasesFile);
      if (rulesFile) fd.append('rules', rulesFile);
      fd.append('mode', mode);
      fd.append('provider', provider);

      // Pass per-user API key so server doesn't need env vars
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
      setFilter('ALL');
    } catch (e: any) {
      setError(e.message ?? 'Validation failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Annotate ────────────────────────────────────────────────────────────────

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

  // ── Filtered results ────────────────────────────────────────────────────────

  const filtered = results.filter(r => {
    if (filter !== 'ALL' && r.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.id.toLowerCase().includes(q) || r.field.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) || r.reason.toLowerCase().includes(q);
    }
    return true;
  });

  const canValidate = !loading && !!slots.pdf && !!slots.data && !!slots.testcases;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* ── Upload Panel ── */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">Upload Files</h3>

        <MultiDropZone slots={slots} onSlotChange={handleSlotChange} />

        {/* Mode toggle + Validate */}
        <div className="flex items-center gap-4 flex-wrap mt-4">
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700 rounded-lg p-1">
            {(['deterministic', 'ai'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  mode === m
                    ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-300 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
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
          <button
            onClick={handleValidate}
            disabled={!canValidate}
            className="ml-auto px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white text-sm font-semibold transition-colors flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Validating…
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
            <div className="flex gap-4 flex-1 flex-wrap">
              {[
                { label: 'Total', value: summary.total, color: 'text-slate-700 dark:text-slate-300' },
                { label: 'Passed', value: summary.passed, color: 'text-green-600 dark:text-green-400' },
                { label: 'Failed', value: summary.failed, color: 'text-red-600 dark:text-red-400' },
                { label: 'N/A', value: summary.na, color: 'text-slate-400 dark:text-slate-500' },
                { label: 'Skipped', value: summary.skipped, color: 'text-amber-500 dark:text-amber-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center min-w-[56px]">
                  <div className={`text-2xl font-bold ${color}`}>{value}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
                </div>
              ))}

              {/* Pass rate bar */}
              {summary.total > 0 && (
                <div className="flex-1 flex items-center gap-2 min-w-[120px]">
                  <div className="flex-1 h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all"
                      style={{ width: `${(summary.passed / summary.total) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    {Math.round((summary.passed / summary.total) * 100)}% pass
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={handleAnnotate}
              disabled={annotating || results.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white text-sm font-semibold transition-colors"
            >
              {annotating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Download Annotated PDF
                </>
              )}
            </button>
          </div>

          {summary.skipped > 0 && (
            <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
              {summary.skipped} test case{summary.skipped > 1 ? 's' : ''} skipped — fields not present in the input data file
            </p>
          )}
        </div>
      )}

      {/* ── Field Coverage ── */}
      {fieldMap.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Field Coverage
              <span className="ml-2 text-xs font-normal text-slate-400">
                {fieldMap.filter(f => f.found).length} / {fieldMap.length} input fields found in PDF
              </span>
            </h3>
          </div>
          <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
            {fieldMap.map(fm => (
              <div
                key={fm.xmlKey}
                title={`${fm.xmlKey} = ${fm.value}`}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs border ${
                  fm.found && fm.matchType === 'exact'
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
                    : fm.found && fm.matchType === 'near'
                    ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300'
                    : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-400'
                }`}
              >
                <span className="flex-shrink-0">{fm.found ? (fm.matchType === 'near' ? '⚠' : '✓') : '✗'}</span>
                <span className="truncate font-medium">{fm.field}</span>
                {fm.page && <span className="ml-auto flex-shrink-0 opacity-60">p{fm.page}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Results Table ── */}
      {results.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          {/* Table toolbar */}
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-3">
            <div className="flex gap-1">
              {(['ALL', 'PASS', 'FAIL', 'NA'] as StatusFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    filter === f
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  {f}
                  {f !== 'ALL' && (
                    <span className="ml-1 opacity-70">
                      ({results.filter(r => r.status === f).length})
                    </span>
                  )}
                </button>
              ))}
            </div>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="ml-auto px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-48"
            />
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-700/50">
                <tr>
                  {['ID', 'Field / Section', 'Category', 'Status', 'Page', 'Reason / Detail'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {filtered.map(r => (
                  <React.Fragment key={r.id}>
                    <tr
                      onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                      className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors ${
                        r.status === 'FAIL' ? 'bg-red-50/30 dark:bg-red-900/10' : ''
                      }`}
                    >
                      <td className="px-4 py-2.5 font-mono font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">{r.id}</td>
                      <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300 max-w-[140px] truncate">{r.field}</td>
                      <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-xs">{r.category}</span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400 text-center">
                        {r.page != null ? `p${r.page}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400 max-w-xs">
                        <span className="line-clamp-1">{r.reason}</span>
                      </td>
                    </tr>

                    {/* Expanded row */}
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
                      No results match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 dark:border-slate-700 text-xs text-slate-400 dark:text-slate-500">
            Showing {filtered.length} of {results.length} — click a row to expand details
          </div>
        </div>
      )}
    </div>
  );
};

export default PdfValidator;
