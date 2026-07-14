import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
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
interface DocumentAnalysis {
  tone: string; toneNotes: string; completeness: number;
  completenessNotes: string; missingBlocks: string[];
  suggestions: string[]; overallQuality: 'Good' | 'Acceptable' | 'Needs Review';
}
interface ValidateResponse { summary: Summary; fieldMap: FieldMatch[]; results: ValidationResult[]; documentAnalysis?: DocumentAnalysis; }

type Mode = 'deterministic' | 'ai';
type FileSlot = 'pdf' | 'data' | 'rules' | 'testcases';

interface SlotState { pdf: File | null; data: File | null; rules: File | null; testcases: File | null; }

interface ColFilters {
  id: string; field: string; category: string; status: string; page: string;
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

const StatusBadge: React.FC<{ status: 'PASS' | 'FAIL' | 'NA' | 'ACCEPTED' }> = ({ status }) => {
  const styles = {
    PASS:     'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
    FAIL:     'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
    NA:       'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
    ACCEPTED: 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 line-through',
  };
  const icons = { PASS: '✓', FAIL: '✗', NA: '—', ACCEPTED: '✓' };
  return <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-semibold ${styles[status]}`}>{icons[status]} {status}</span>;
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

// ─── PDF Viewer Panel ─────────────────────────────────────────────────────────

interface PdfViewerPanelProps {
  file: File;
  fieldMap: FieldMatch[];
  results: ValidationResult[];
  acceptedIds: Set<string>;
  currentPage: number;
  onPageChange: (p: number) => void;
}

const PdfViewerPanel: React.FC<PdfViewerPanelProps> = ({ file, fieldMap, results, acceptedIds, currentPage, onPageChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [totalPages, setTotalPages] = useState(0);
  const renderTaskRef = useRef<any>(null);

  useEffect(() => {
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.min.mjs';
  }, []);

  useEffect(() => {
    let cancelled = false;
    file.arrayBuffer().then(buf => {
      (pdfjsLib as any).getDocument({ data: buf }).promise.then((doc: any) => {
        if (!cancelled) { setPdfDoc(doc); setTotalPages(doc.numPages); }
      });
    });
    return () => { cancelled = true; };
  }, [file]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !containerRef.current) return;

    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel(); } catch {}
      renderTaskRef.current = null;
    }

    let isCancelled = false;

    const doRender = async () => {
      const page = await pdfDoc.getPage(currentPage);
      if (isCancelled) return;

      const containerW = (containerRef.current?.clientWidth ?? 800) - 32;
      const unscaled = page.getViewport({ scale: 1 });
      const scale = Math.max(0.8, Math.min(2.5, containerW / unscaled.width));
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d')!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const task = page.render({ canvasContext: ctx, viewport } as any);
      renderTaskRef.current = task;

      try { await task.promise; }
      catch (e: any) { if (e?.name === 'RenderingCancelledException' || isCancelled) return; }

      if (isCancelled) return;

      const pageHeightPdf = unscaled.height;

      // Build worst status per field (excluding accepted)
      const fieldWorst = new Map<string, 'PASS' | 'FAIL' | 'NA'>();
      const severityOf = (s: string) => s === 'FAIL' ? 2 : s === 'NA' ? 1 : 0;
      for (const r of results) {
        if (acceptedIds.has(r.id)) continue;
        const cur = fieldWorst.get(r.field);
        if (!cur || severityOf(r.status) > severityOf(cur)) fieldWorst.set(r.field, r.status);
      }

      ctx.save();

      // FieldMap highlights (TC / FC / BF)
      for (const fm of fieldMap) {
        if (fm.page !== currentPage || fm.x == null || fm.y == null || fm.w == null || fm.h == null) continue;
        const status = fieldWorst.get(fm.field) ?? (fm.found ? 'PASS' : 'FAIL');
        const fh = Math.max(fm.h || 10, 8);
        const cx = fm.x * scale;
        const cy = (pageHeightPdf - fm.y - fh) * scale;
        const cw = fm.w * scale;
        const ch = fh * scale;

        ctx.fillStyle = status === 'PASS' ? 'rgba(34,197,94,0.22)' : status === 'FAIL' ? 'rgba(239,68,68,0.28)' : 'rgba(148,163,184,0.18)';
        ctx.fillRect(cx, cy, cw, ch);
        ctx.strokeStyle = status === 'PASS' ? 'rgba(34,197,94,0.7)' : status === 'FAIL' ? 'rgba(239,68,68,0.75)' : 'rgba(148,163,184,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx, cy, cw, ch);
      }

      // OID highlights (purple)
      for (const r of results) {
        if (!r.id.startsWith('OID-') || acceptedIds.has(r.id)) continue;
        if (r.page !== currentPage || r.x == null || r.y == null || r.w == null || r.h == null) continue;
        const fh = Math.max(r.h || 10, 8);
        const cx = r.x * scale;
        const cy = (pageHeightPdf - r.y - fh) * scale;
        const cw = r.w * scale;
        const ch = fh * scale;

        ctx.fillStyle = 'rgba(167,139,250,0.28)';
        ctx.fillRect(cx, cy, cw, ch);
        ctx.strokeStyle = 'rgba(139,92,246,0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx, cy, cw, ch);
      }

      ctx.restore();
    };

    doRender();
    return () => { isCancelled = true; };
  }, [pdfDoc, currentPage, fieldMap, results, acceptedIds]);

  return (
    <div className="flex flex-col h-full bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div ref={containerRef} className="flex-1 overflow-auto flex justify-center p-4 bg-slate-200 dark:bg-slate-800/80">
        {pdfDoc
          ? <canvas ref={canvasRef} className="shadow-xl rounded" />
          : <div className="flex items-center justify-center text-slate-400 text-sm">Loading PDF…</div>
        }
      </div>
      <div className="flex items-center justify-center gap-3 px-4 py-2 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
        <button onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage <= 1}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 transition-colors">
          <svg className="w-4 h-4 text-slate-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs text-slate-600 dark:text-slate-400 min-w-[90px] text-center font-medium">
          Page {currentPage} / {totalPages || '…'}
        </span>
        <button onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 transition-colors">
          <svg className="w-4 h-4 text-slate-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {/* Color key */}
        <div className="ml-4 flex items-center gap-2.5 text-xs text-slate-400 border-l border-slate-200 dark:border-slate-600 pl-4">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-400/60 border border-green-500/70"></span>Pass</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-400/60 border border-red-500/70"></span>Fail</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-purple-400/60 border border-purple-500/70"></span>OID</span>
        </div>
      </div>
    </div>
  );
};

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
  const [docAnalysis, setDocAnalysis] = useState<DocumentAnalysis | null>(null);

  const [colFilters, setColFilters] = useState<ColFilters>(EMPTY_FILTERS);
  const [globalSearch, setGlobalSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // New state
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [viewerPage, setViewerPage] = useState(1);
  const [runDocAnalysis, setRunDocAnalysis] = useState(true);

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
    setLoading(true); setError(null); setSummary(null); setResults([]); setFieldMap([]); setDocAnalysis(null);
    setColFilters(EMPTY_FILTERS); setGlobalSearch(''); setViewerPage(1);

    try {
      const fd = new FormData();
      fd.append('pdf', pdfFile);
      fd.append('data', dataFile);
      fd.append('testcases', testcasesFile);
      if (rulesFile) fd.append('rules', rulesFile);
      fd.append('mode', mode);
      fd.append('provider', provider);
      fd.append('includeDocAnalysis', (mode === 'ai' && runDocAnalysis).toString());
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
      setDocAnalysis(data.documentAnalysis ?? null);
    } catch (e: any) {
      setError(e.message ?? 'Validation failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Reset helpers ────────────────────────────────────────────────────────

  const clearResults = (clearAccepted = false) => {
    setSummary(null); setFieldMap([]); setResults([]); setDocAnalysis(null);
    setError(null); setColFilters(EMPTY_FILTERS); setGlobalSearch(''); setExpandedId(null); setViewerPage(1);
    if (clearAccepted) setAcceptedIds(new Set());
  };

  const handleResetPdfInput = () => {
    setSlots(prev => ({ ...prev, pdf: null, data: null }));
    clearResults(false); // keep accepted IDs — same test suite may be reused
  };

  const handleResetAll = () => {
    setSlots({ pdf: null, data: null, rules: null, testcases: null });
    clearResults(true);
  };

  // ── Mark as accepted ─────────────────────────────────────────────────────

  const toggleAccepted = useCallback((id: string) => {
    setAcceptedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

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

  // ── Download Issues CSV ───────────────────────────────────────────────────

  const downloadIssuesCsv = () => {
    const header = ['ID', 'Field', 'Category', 'Status', 'Description', 'Reason', 'Page'];
    const rows = filtered.map(r => [
      r.id,
      `"${r.field.replace(/"/g, '""')}"`,
      `"${r.category.replace(/"/g, '""')}"`,
      acceptedIds.has(r.id) ? 'ACCEPTED' : r.status,
      `"${r.description.replace(/"/g, '""')}"`,
      `"${r.reason.replace(/"/g, '""')}"`,
      r.page != null ? `p${r.page}` : '',
    ]);
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'validation-issues.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const uniqueCategories = [...new Set(results.map(r => r.category))].sort();
  const uniquePages = (Array.from(new Set(results.filter(r => r.page != null).map(r => `p${r.page}`))) as string[])
    .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));

  const filtered = results.filter(r => {
    if (colFilters.id !== 'ALL' && !r.id.startsWith(colFilters.id)) return false;
    if (colFilters.field && !r.field.toLowerCase().includes(colFilters.field.toLowerCase())) return false;
    if (colFilters.category !== 'ALL' && r.category !== colFilters.category) return false;
    if (colFilters.status !== 'ALL') {
      if (colFilters.status === 'ACCEPTED') { if (!acceptedIds.has(r.id)) return false; }
      else if (r.status !== colFilters.status) return false;
    }
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

  // Effective pass rate excludes accepted items
  const effectiveResults = results.filter(r => !acceptedIds.has(r.id));
  const effectivePassed = effectiveResults.filter(r => r.status === 'PASS').length;
  const effectiveFailed = effectiveResults.filter(r => r.status === 'FAIL').length;
  const decisive = effectivePassed + effectiveFailed;
  const passRate = decisive > 0 ? Math.round((effectivePassed / decisive) * 100) : 0;
  const canValidate = !loading && !!slots.pdf && !!slots.data && !!slots.testcases;
  const hasResults = summary !== null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={`${hasResults ? 'max-w-full' : 'max-w-6xl'} mx-auto space-y-4`}>

      {/* ── Upload Panel ── */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
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
          {mode === 'ai' && (
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
              <div
                onClick={() => setRunDocAnalysis(v => !v)}
                className={`relative inline-flex h-4 w-7 flex-shrink-0 rounded-full border-2 transition-colors cursor-pointer ${
                  runDocAnalysis ? 'bg-indigo-500 border-indigo-500' : 'bg-slate-200 dark:bg-slate-600 border-slate-200 dark:border-slate-600'
                }`}
              >
                <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${runDocAnalysis ? 'translate-x-3' : 'translate-x-0'}`} />
              </div>
              Document Analysis
            </label>
          )}

          {(slots.pdf || slots.data || slots.rules || slots.testcases) && (
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={handleResetPdfInput} disabled={loading || annotating}
                title="Clear PDF and input data — keeps test cases and business rules"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                Reset PDF &amp; Input
              </button>
              <button onClick={handleResetAll} disabled={loading || annotating}
                title="Clear all files and results"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800/60 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Reset All
              </button>
              <div className="w-px h-5 bg-slate-200 dark:bg-slate-600" />
            </div>
          )}

          <button onClick={handleValidate} disabled={!canValidate}
            className={`${!(slots.pdf || slots.data || slots.rules || slots.testcases) ? 'ml-auto' : ''} px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white text-sm font-semibold transition-colors flex items-center gap-2`}
          >
            {loading ? (
              <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>Validating…</>
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

      {/* ── Document Analysis (full width, above split) ── */}
      {docAnalysis && (() => {
        const qualityColor = docAnalysis.overallQuality === 'Good'
          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800'
          : docAnalysis.overallQuality === 'Acceptable'
          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
          : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
        const completenessColor = docAnalysis.completeness >= 80 ? 'bg-green-500'
          : docAnalysis.completeness >= 60 ? 'bg-amber-500' : 'bg-red-500';
        return (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center gap-3">
              <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Document Analysis</span>
              <span className={`ml-auto text-xs font-bold px-2.5 py-0.5 rounded-full border ${qualityColor}`}>
                {docAnalysis.overallQuality}
              </span>
            </div>
            <div className="p-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div>
                <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Tone</p>
                <span className="inline-block px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs font-semibold mb-2">{docAnalysis.tone}</span>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{docAnalysis.toneNotes}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Completeness — {docAnalysis.completeness}%</p>
                <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
                  <div className={`h-full rounded-full transition-all ${completenessColor}`} style={{ width: `${docAnalysis.completeness}%` }} />
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{docAnalysis.completenessNotes}</p>
              </div>
              {docAnalysis.missingBlocks.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Missing Blocks</p>
                  <ul className="space-y-1">
                    {docAnalysis.missingBlocks.map((b, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        <svg className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                        </svg>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {docAnalysis.suggestions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Suggestions</p>
                  <ul className="space-y-1">
                    {docAnalysis.suggestions.map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        <svg className="w-3 h-3 text-indigo-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
                        </svg>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Split Layout: PDF Viewer (70%) + Summary+Results (30%) ── */}
      {hasResults && (
        <div className="flex gap-4" style={{ height: 'calc(100vh - 260px)', minHeight: '580px' }}>

          {/* ── Left: PDF Viewer (70%) ── */}
          <div className="flex-[7] min-w-0">
            {slots.pdf
              ? <PdfViewerPanel
                  file={slots.pdf}
                  fieldMap={fieldMap}
                  results={results}
                  acceptedIds={acceptedIds}
                  currentPage={viewerPage}
                  onPageChange={setViewerPage}
                />
              : <div className="flex flex-col items-center justify-center h-full rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-400 gap-2">
                  <svg className="w-10 h-10 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <span className="text-sm">No PDF loaded</span>
                </div>
            }
          </div>

          {/* ── Right: Summary + Results (30%) ── */}
          <div className="flex-[3] min-w-0 flex flex-col gap-3 min-h-0">

            {/* Summary card */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm flex-shrink-0">
              <div className="flex flex-wrap gap-3 items-end mb-3">
                {summary && [
                  { label: 'Total',   value: summary.total,   color: 'text-slate-700 dark:text-slate-300' },
                  { label: 'Passed',  value: summary.passed,  color: 'text-green-600 dark:text-green-400' },
                  { label: 'Failed',  value: summary.failed,  color: 'text-red-600 dark:text-red-400' },
                  { label: 'N/A',     value: summary.na,      color: 'text-slate-400 dark:text-slate-500' },
                  { label: 'Accepted',value: acceptedIds.size, color: 'text-slate-400 dark:text-slate-500' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="text-center min-w-[44px]">
                    <div className={`text-xl font-bold ${color}`}>{value}</div>
                    <div className="text-xs text-slate-400">{label}</div>
                  </div>
                ))}
              </div>

              {decisive > 0 && (
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${passRate}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">{passRate}% pass</span>
                </div>
              )}

              {acceptedIds.size > 0 && (
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">{acceptedIds.size} accepted — excluded from pass rate</p>
              )}

              <div className="flex flex-col gap-2">
                <button onClick={handleAnnotate} disabled={annotating || results.length === 0}
                  className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white text-xs font-semibold transition-colors"
                >
                  {annotating
                    ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Generating…</>
                    : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>Download Annotated PDF</>
                  }
                </button>
                <button onClick={downloadIssuesCsv} disabled={results.length === 0}
                  className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-600 dark:text-slate-300 text-xs font-medium transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Download Issues CSV
                </button>
              </div>
            </div>

            {/* Results list */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden">

              {/* Toolbar */}
              <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{filtered.length}/{results.length}</span>
                {hasActiveFilters && (
                  <button onClick={() => { setColFilters(EMPTY_FILTERS); setGlobalSearch(''); }}
                    className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300">
                    Clear ×
                  </button>
                )}
                <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)}
                  placeholder="Search…"
                  className="ml-auto px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-32"
                />
              </div>

              {/* Filter row */}
              <div className="px-2 py-1.5 border-b border-slate-100 dark:border-slate-700 flex gap-1.5 flex-shrink-0">
                <select value={colFilters.id} onChange={e => setCol('id', e.target.value)} className={filterInputCls}>
                  <option value="ALL">All IDs</option>
                  <option value="TC-">TC-*</option>
                  <option value="FC-">FC-*</option>
                  <option value="BF-">BF-*</option>
                  <option value="OID-">OID-*</option>
                </select>
                <select value={colFilters.status} onChange={e => setCol('status', e.target.value)} className={filterInputCls}>
                  <option value="ALL">All Status</option>
                  <option value="PASS">PASS</option>
                  <option value="FAIL">FAIL</option>
                  <option value="NA">NA</option>
                  <option value="ACCEPTED">Accepted</option>
                </select>
                <select value={colFilters.page} onChange={e => setCol('page', e.target.value)} className={filterInputCls}>
                  <option value="">All Pages</option>
                  {uniquePages.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              {/* Scrollable result rows */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
                {filtered.length === 0 && (
                  <div className="py-8 text-center text-slate-400 dark:text-slate-500 text-xs">No results match filters.</div>
                )}
                {filtered.map(r => {
                  const isAccepted = acceptedIds.has(r.id);
                  const isExpanded = expandedId === r.id;
                  return (
                    <div key={r.id}
                      className={`px-3 py-2 transition-colors ${isAccepted ? 'opacity-50' : ''} ${isExpanded ? 'bg-slate-50 dark:bg-slate-700/30' : 'hover:bg-slate-50/70 dark:hover:bg-slate-700/20'}`}
                    >
                      {/* Row header */}
                      <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : r.id)}>
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">{r.id}</span>
                        <StatusBadge status={isAccepted ? 'ACCEPTED' : r.status} />
                        {r.page != null && (
                          <button
                            onClick={e => { e.stopPropagation(); setViewerPage(r.page!); }}
                            title={`Jump to page ${r.page}`}
                            className="ml-auto flex-shrink-0 flex items-center gap-0.5 text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium px-1 py-0.5 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                          >
                            p{r.page}
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                            </svg>
                          </button>
                        )}
                        {r.page == null && <div className="ml-auto" />}
                      </div>

                      {/* Field name */}
                      <p className="text-xs text-slate-600 dark:text-slate-300 truncate mt-0.5 cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : r.id)}>
                        {r.field}
                      </p>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 space-y-1 bg-slate-100/50 dark:bg-slate-800/50 rounded p-2">
                          <p><span className="font-semibold text-slate-600 dark:text-slate-300">Category:</span> {r.category}</p>
                          <p><span className="font-semibold text-slate-600 dark:text-slate-300">Description:</span> {r.description}</p>
                          <p><span className="font-semibold text-slate-600 dark:text-slate-300">Reason:</span> {r.reason}</p>
                        </div>
                      )}

                      {/* Accept button */}
                      <div className="flex items-center gap-2 mt-1.5">
                        <button
                          onClick={() => toggleAccepted(r.id)}
                          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                            isAccepted
                              ? 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                              : 'border-green-200 dark:border-green-800/60 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20'
                          }`}
                        >
                          {isAccepted ? 'Undo Accept' : 'Mark Accepted'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Legend footer */}
              <div className="px-3 py-1.5 border-t border-slate-100 dark:border-slate-700 flex items-center gap-2.5 flex-wrap text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300 inline-block"></span>TC-*</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-teal-400 inline-block"></span>FC-*</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block"></span>BF-*</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block"></span>OID-*</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PdfValidator;
