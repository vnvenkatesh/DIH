
import React, { useState, useCallback, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { diffArrays, diffWordsWithSpace } from 'diff';
import FileUploader from './FileUploader';
import { PdfFileIcon } from './icons/PdfFileIcon';
import { ArrowsRightLeftIcon } from './icons/ArrowsRightLeftIcon';

// ── Type aliases ──────────────────────────────────────────────────────────
type PdfTextItem = Extract<
  Awaited<ReturnType<pdfjsLib.PDFPageProxy['getTextContent']>>['items'][number],
  { str: string }
>;

// ── Interfaces ────────────────────────────────────────────────────────────
interface TextItem { str: string; x: number; y: number; w: number; h: number; }
interface BBox { left: number; top: number; width: number; height: number; }

interface DiffHighlight {
  type: 'added' | 'removed' | 'modified';
  bbox: BBox;
  leftText: string;
  rightText: string;
}

interface PageResult {
  pageNum: number;
  leftHighlights: DiffHighlight[];
  rightHighlights: DiffHighlight[];
  changeCount: number;
}

interface Summary {
  totalAdded: number;
  totalRemoved: number;
  totalModified: number;
  pagesWithDiffs: number;
  totalPages: number;
}

interface TooltipState { content: React.ReactNode; x: number; y: number; }

// ── Constants ─────────────────────────────────────────────────────────────
const SCALE = 1.5;
const EMPTY_BBOX: BBox = { left: 0, top: 0, width: 0, height: 0 };
const HIGHLIGHT_CONFIG = {
  added:    { bg: 'rgba(59,130,246,0.22)',  border: '2px solid rgba(59,130,246,0.85)',  label: 'Added',    dotColor: '#3b82f6' },
  removed:  { bg: 'rgba(239,68,68,0.22)',   border: '2px solid rgba(239,68,68,0.85)',   label: 'Removed',  dotColor: '#ef4444' },
  modified: { bg: 'rgba(249,115,22,0.22)',  border: '2px solid rgba(249,115,22,0.85)', label: 'Modified', dotColor: '#f97316' },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────
const multiplyMatrices = (m1: number[], m2: number[]): number[] => [
  m1[0]*m2[0] + m1[2]*m2[1], m1[1]*m2[0] + m1[3]*m2[1],
  m1[0]*m2[2] + m1[2]*m2[3], m1[1]*m2[2] + m1[3]*m2[3],
  m1[0]*m2[4] + m1[2]*m2[5] + m1[4], m1[1]*m2[4] + m1[3]*m2[5] + m1[5],
];

const getBbox = (items: TextItem[]): BBox => {
  if (!items.length) return EMPTY_BBOX;
  const x1 = Math.min(...items.map(i => i.x));
  const y1 = Math.min(...items.map(i => i.y - i.h));
  const x2 = Math.max(...items.map(i => i.x + i.w));
  const y2 = Math.max(...items.map(i => i.y));
  return { left: x1, top: y1, width: Math.max(4, x2 - x1), height: Math.max(4, y2 - y1) };
};

const parseExclusions = (raw: string): string[] =>
  raw.split(/[\n,]/).map(s => s.trim()).filter(s => s.length > 0);

const applyExclusions = (text: string, exclusions: string[]): string => {
  let result = text;
  for (const ex of exclusions) {
    result = result.replace(new RegExp(ex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
  }
  return result.trim();
};

const groupIntoParagraphs = (items: TextItem[]): TextItem[][] => {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => Math.abs(a.y - b.y) > 5 ? b.y - a.y : a.x - b.x);
  const paras: TextItem[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = paras[paras.length - 1].at(-1)!;
    if (Math.abs(sorted[i].y - prev.y) > prev.h * 1.2) {
      paras.push([sorted[i]]);
    } else {
      paras[paras.length - 1].push(sorted[i]);
    }
  }
  return paras.map(p => p.sort((a, b) => a.x - b.x));
};

// ── Sub-components ────────────────────────────────────────────────────────
const FilePlaceholder: React.FC<{ file: File; label: string; onClear: () => void }> = ({ file, label, onClear }) => (
  <div className="w-full p-8 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg flex flex-col justify-center items-center">
    <PdfFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />
    <p className="font-semibold text-green-600 dark:text-green-400">{label} Ready:</p>
    <p className="text-sm text-slate-700 dark:text-slate-300 truncate w-full px-4 text-center">{file.name}</p>
    <button onClick={onClear} className="text-xs text-indigo-500 hover:underline mt-2">Change File</button>
  </div>
);

const StatCard: React.FC<{ value: number; label: string; colorClass: string }> = ({ value, label, colorClass }) => (
  <div className="bg-white dark:bg-slate-800 rounded-lg p-3 text-center border border-slate-200 dark:border-slate-600">
    <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</div>
  </div>
);

const PdfPageCanvas: React.FC<{ doc: pdfjsLib.PDFDocumentProxy; pageNum: number }> = ({ doc, pageNum }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<pdfjsLib.RenderTask | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || pageNum < 1 || pageNum > doc.numPages) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let cancelled = false;

    doc.getPage(pageNum).then(page => {
      if (cancelled) return;
      const vp = page.getViewport({ scale: SCALE });
      canvas.width = vp.width;
      canvas.height = vp.height;
      const task = page.render({ canvasContext: ctx, viewport: vp } as any);
      taskRef.current = task;
      task.promise.catch(e => { if (e?.name !== 'AbortException') console.error(e); });
    }).catch(console.error);

    return () => {
      cancelled = true;
      taskRef.current?.cancel();
    };
  }, [doc, pageNum]);

  return <canvas ref={canvasRef} className="block w-full" />;
};

const PageViewer: React.FC<{
  doc: pdfjsLib.PDFDocumentProxy | null;
  pageNum: number;
  highlights: DiffHighlight[];
  onHover: (e: React.MouseEvent, h: DiffHighlight) => void;
  onLeave: () => void;
}> = ({ doc, pageNum, highlights, onHover, onLeave }) => {
  if (!doc || pageNum > doc.numPages) {
    return (
      <div className="flex items-center justify-center h-48 bg-slate-100 dark:bg-slate-800 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600">
        <p className="text-slate-400 text-sm">No page {pageNum} in this document</p>
      </div>
    );
  }

  return (
    <div className="relative shadow-md rounded-sm overflow-hidden">
      <PdfPageCanvas doc={doc} pageNum={pageNum} />
      <div className="absolute inset-0 pointer-events-none">
        {highlights.map((h, i) => {
          if (!h.bbox.width || !h.bbox.height) return null;
          const cfg = HIGHLIGHT_CONFIG[h.type];
          return (
            <div
              key={i}
              className="absolute pointer-events-auto cursor-pointer transition-opacity hover:opacity-80"
              style={{
                left: h.bbox.left, top: h.bbox.top,
                width: h.bbox.width, height: h.bbox.height,
                background: cfg.bg, border: cfg.border, borderRadius: 2,
              }}
              onMouseEnter={e => onHover(e, h)}
              onMouseLeave={onLeave}
            />
          );
        })}
      </div>
    </div>
  );
};

const DiffTooltip: React.FC<{ x: number; y: number; content: React.ReactNode }> = ({ x, y, content }) => (
  <div
    className="fixed z-50 max-w-sm p-3 text-xs bg-slate-900 text-white rounded-lg shadow-2xl pointer-events-none border border-slate-700"
    style={{ left: x, top: y, transform: 'translate(-50%, calc(-100% - 10px))' }}
  >
    {content}
    <div className="absolute left-1/2 -translate-x-1/2 bottom-[-5px] w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-slate-900" />
  </div>
);

// ── Main component ────────────────────────────────────────────────────────
const PdfVisualCompare: React.FC = () => {
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [pdfDocA, setPdfDocA] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfDocB, setPdfDocB] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [exclusionInput, setExclusionInput] = useState('');
  const [showExclusions, setShowExclusions] = useState(false);
  const [pageResults, setPageResults] = useState<PageResult[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [showDiffsOnly, setShowDiffsOnly] = useState(false);

  useEffect(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.min.mjs`;
  }, []);

  const loadPdf = async (file: File): Promise<pdfjsLib.PDFDocumentProxy> => {
    const buf = await file.arrayBuffer();
    return pdfjsLib.getDocument({ data: buf }).promise;
  };

  const extractTextItems = async (
    doc: pdfjsLib.PDFDocumentProxy,
    pageNum: number,
  ): Promise<TextItem[]> => {
    if (pageNum < 1 || pageNum > doc.numPages) return [];
    try {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const vp = page.getViewport({ scale: SCALE });
      return content.items
        .filter((item): item is PdfTextItem => 'str' in item && item.str.trim().length > 0)
        .map(item => {
          const tx = item.transform
            ? multiplyMatrices(vp.transform, item.transform)
            : vp.transform;
          const fontH = Math.sqrt(tx[2] ** 2 + tx[3] ** 2);
          return { str: item.str, x: tx[4], y: tx[5], w: item.width ?? 0, h: item.height || fontH || 10 };
        });
    } catch (e) {
      console.error(`Error extracting text from page ${pageNum}`, e);
      return [];
    }
  };

  const buildTooltipContent = (h: DiffHighlight): React.ReactNode => {
    if (h.type === 'removed') {
      return (
        <div>
          <span className="font-bold text-red-300 block mb-1.5">Removed</span>
          <span className="text-slate-200 whitespace-pre-wrap leading-relaxed">{h.leftText}</span>
        </div>
      );
    }
    if (h.type === 'added') {
      return (
        <div>
          <span className="font-bold text-blue-300 block mb-1.5">Added</span>
          <span className="text-slate-200 whitespace-pre-wrap leading-relaxed">{h.rightText}</span>
        </div>
      );
    }
    return (
      <div>
        <span className="font-bold text-orange-300 block mb-1.5">Modified</span>
        <div className="font-mono whitespace-pre-wrap break-words leading-relaxed">
          {diffWordsWithSpace(h.leftText, h.rightText).map((part, i) => (
            <span
              key={i}
              className={
                part.added
                  ? 'bg-blue-800/70 text-blue-200'
                  : part.removed
                    ? 'bg-red-800/70 text-red-200 line-through'
                    : 'text-slate-200'
              }
            >
              {part.value}
            </span>
          ))}
        </div>
      </div>
    );
  };

  const handleCompare = useCallback(async () => {
    if (!fileA || !fileB) return;

    setIsLoading(true);
    setError(null);
    setPageResults(null);
    setSummary(null);

    try {
      setLoadingMessage('Loading PDFs…');
      const [docA, docB] = await Promise.all([
        pdfDocA ?? loadPdf(fileA),
        pdfDocB ?? loadPdf(fileB),
      ]);
      if (!pdfDocA) setPdfDocA(docA);
      if (!pdfDocB) setPdfDocB(docB);

      const exclusions = parseExclusions(exclusionInput);
      const numPages = Math.max(docA.numPages, docB.numPages);
      const results: PageResult[] = [];
      let totalAdded = 0, totalRemoved = 0, totalModified = 0, pagesWithDiffs = 0;

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        setLoadingMessage(`Comparing page ${pageNum} of ${numPages}…`);

        const rawA = await extractTextItems(docA, pageNum);
        const rawB = await extractTextItems(docB, pageNum);

        // Filter items that become empty after exclusion
        const filteredA = rawA.filter(item => applyExclusions(item.str, exclusions).length > 0);
        const filteredB = rawB.filter(item => applyExclusions(item.str, exclusions).length > 0);

        const parasA = groupIntoParagraphs(filteredA);
        const parasB = groupIntoParagraphs(filteredB);

        const textA = parasA.map(p =>
          applyExclusions(p.map(i => i.str).join(' '), exclusions),
        ).filter(t => t.length > 0);
        const textB = parasB.map(p =>
          applyExclusions(p.map(i => i.str).join(' '), exclusions),
        ).filter(t => t.length > 0);

        const rawDiff = diffArrays(textA, textB);

        // Merge adjacent removed+added into "modified" blocks
        type MergedPart =
          | { type: 'unchanged'; values: string[] }
          | { type: 'removed';   values: string[] }
          | { type: 'added';     values: string[] }
          | { type: 'modified';  removed: string[]; added: string[] };

        const merged: MergedPart[] = [];
        let di = 0;
        while (di < rawDiff.length) {
          const curr = rawDiff[di];
          const next = di + 1 < rawDiff.length ? rawDiff[di + 1] : null;
          if (curr.removed && next?.added) {
            merged.push({ type: 'modified', removed: curr.value, added: next.value });
            di += 2;
          } else if (curr.removed) {
            merged.push({ type: 'removed', values: curr.value });
            di++;
          } else if (curr.added) {
            merged.push({ type: 'added', values: curr.value });
            di++;
          } else {
            merged.push({ type: 'unchanged', values: curr.value });
            di++;
          }
        }

        const leftHighlights: DiffHighlight[] = [];
        const rightHighlights: DiffHighlight[] = [];
        let idxA = 0, idxB = 0, pageChanges = 0;

        for (const part of merged) {
          if (part.type === 'unchanged') {
            idxA += part.values.length;
            idxB += part.values.length;
          } else if (part.type === 'modified') {
            const leftItems = parasA.slice(idxA, idxA + part.removed.length).flat();
            const rightItems = parasB.slice(idxB, idxB + part.added.length).flat();
            const leftText = part.removed.join(' ');
            const rightText = part.added.join(' ');
            leftHighlights.push({ type: 'modified', bbox: getBbox(leftItems), leftText, rightText });
            rightHighlights.push({ type: 'modified', bbox: getBbox(rightItems), leftText, rightText });
            totalModified++;
            pageChanges++;
            idxA += part.removed.length;
            idxB += part.added.length;
          } else if (part.type === 'removed') {
            for (const txt of part.values) {
              const items = parasA[idxA] ?? [];
              leftHighlights.push({ type: 'removed', bbox: getBbox(items), leftText: txt, rightText: '' });
              totalRemoved++;
              pageChanges++;
              idxA++;
            }
          } else if (part.type === 'added') {
            for (const txt of part.values) {
              const items = parasB[idxB] ?? [];
              rightHighlights.push({ type: 'added', bbox: getBbox(items), leftText: '', rightText: txt });
              totalAdded++;
              pageChanges++;
              idxB++;
            }
          }
        }

        if (pageChanges > 0) pagesWithDiffs++;
        results.push({ pageNum, leftHighlights, rightHighlights, changeCount: pageChanges });
      }

      setPageResults(results);
      setSummary({ totalAdded, totalRemoved, totalModified, pagesWithDiffs, totalPages: numPages });
    } catch (e) {
      console.error(e);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  }, [fileA, fileB, pdfDocA, pdfDocB, exclusionInput]);

  const handleReset = () => {
    setFileA(null); setFileB(null);
    setPdfDocA(null); setPdfDocB(null);
    setPageResults(null); setSummary(null);
    setError(null); setExclusionInput('');
    setShowDiffsOnly(false);
  };

  const handleHover = (e: React.MouseEvent, h: DiffHighlight) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setTooltip({
      content: buildTooltipContent(h),
      x: rect.left + rect.width / 2,
      y: rect.top + window.scrollY,
    });
  };

  const activeParsedExclusions = parseExclusions(exclusionInput);
  const displayedPages = showDiffsOnly
    ? (pageResults ?? []).filter(p => p.changeCount > 0)
    : (pageResults ?? []);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 md:p-10">

      {/* ── Header ── */}
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center justify-center gap-3">
          <ArrowsRightLeftIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          PDF Visual Diff
        </h2>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          Compare two PDFs side-by-side with visual difference highlighting. No AI required.
        </p>
      </div>

      {/* ── File upload ── */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {fileA
          ? <FilePlaceholder file={fileA} label="PDF A (Left)" onClear={() => { setFileA(null); setPdfDocA(null); setPageResults(null); }} />
          : <FileUploader onFileChange={setFileA} acceptedFileType="application/pdf" fileTypeName="PDF A" icon={<PdfFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />} />
        }
        {fileB
          ? <FilePlaceholder file={fileB} label="PDF B (Right)" onClear={() => { setFileB(null); setPdfDocB(null); setPageResults(null); }} />
          : <FileUploader onFileChange={setFileB} acceptedFileType="application/pdf" fileTypeName="PDF B" icon={<PdfFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />} />
        }
      </div>

      {/* ── Exclusion strings panel ── */}
      <div className="mb-6 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowExclusions(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
            </svg>
            Exclusion Strings
            {activeParsedExclusions.length > 0 && (
              <span className="bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-xs px-2 py-0.5 rounded-full">
                {activeParsedExclusions.length} active
              </span>
            )}
          </span>
          <svg
            className={`w-4 h-4 transition-transform ${showExclusions ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showExclusions && (
          <div className="px-4 py-4 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
              Strings entered here are stripped from both PDFs before comparison (comma or newline separated).
              Useful for timestamps, page numbers, version IDs, or boilerplate footers.
            </p>
            <textarea
              value={exclusionInput}
              onChange={e => setExclusionInput(e.target.value)}
              placeholder="e.g. Page 1 of 10, Generated on, Document ID"
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
            {activeParsedExclusions.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {activeParsedExclusions.map((ex, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-600"
                  >
                    <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                    {ex}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="flex items-center justify-center gap-4 mb-8">
        <button
          onClick={handleCompare}
          disabled={!fileA || !fileB || isLoading}
          className="bg-indigo-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-300 dark:focus:ring-indigo-800 transition-all duration-200 transform hover:scale-105 inline-flex items-center gap-2 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed disabled:scale-100"
        >
          <ArrowsRightLeftIcon className="w-5 h-5" />
          {pageResults ? 'Re-Compare' : 'Compare Documents'}
        </button>
        <button
          onClick={handleReset}
          disabled={!fileA && !fileB}
          className="bg-slate-200 text-slate-700 font-bold py-3 px-8 rounded-lg hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500 focus:outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reset
        </button>
      </div>

      {/* ── Loading ── */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center p-10">
          <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-indigo-500" />
          <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">{loadingMessage}</p>
          <p className="text-sm text-slate-500 dark:text-slate-500">This may take a moment for large documents.</p>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="text-center text-red-500 bg-red-100 dark:bg-red-900/20 p-4 rounded-lg mb-6">
          <p className="font-bold">Error</p>
          <p>{error}</p>
        </div>
      )}

      {/* ── Summary ── */}
      {summary && !isLoading && (
        <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-600">
          <h3 className="font-bold text-slate-900 dark:text-white mb-3">Comparison Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <StatCard value={summary.totalPages}     label="Total Pages"       colorClass="text-slate-700 dark:text-slate-200" />
            <StatCard value={summary.pagesWithDiffs} label="Pages with Diffs"  colorClass="text-indigo-600 dark:text-indigo-400" />
            <StatCard value={summary.totalAdded}     label="Added"             colorClass="text-blue-600 dark:text-blue-400" />
            <StatCard value={summary.totalRemoved}   label="Removed"           colorClass="text-red-600 dark:text-red-400" />
            <StatCard value={summary.totalModified}  label="Modified"          colorClass="text-orange-600 dark:text-orange-400" />
          </div>
          <div className="flex flex-wrap items-center gap-5">
            {/* Legend */}
            {(['added', 'removed', 'modified'] as const).map(type => (
              <div key={type} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: HIGHLIGHT_CONFIG[type].dotColor }} />
                <span>{HIGHLIGHT_CONFIG[type].label}</span>
              </div>
            ))}
            {/* Diffs-only toggle */}
            <label className="ml-auto flex items-center gap-2 cursor-pointer select-none text-xs text-slate-600 dark:text-slate-400">
              <span>Differences only</span>
              <button
                role="switch"
                aria-checked={showDiffsOnly}
                onClick={() => setShowDiffsOnly(v => !v)}
                className={`relative inline-flex w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${showDiffsOnly ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${showDiffsOnly ? 'translate-x-5' : ''}`} />
              </button>
            </label>
          </div>
        </div>
      )}

      {/* ── No differences ── */}
      {!isLoading && pageResults && summary && summary.pagesWithDiffs === 0 && (
        <div className="text-center text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 p-4 rounded-lg mb-6">
          No differences found between the two documents.
        </div>
      )}

      {/* ── Page-by-page comparison ── */}
      {!isLoading && pageResults && pdfDocA && pdfDocB && (
        <div className="space-y-6">
          {displayedPages.map(result => (
            <div
              key={result.pageNum}
              className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden"
            >
              {/* Page header */}
              <div className="flex items-center justify-between px-4 py-2 bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                <span className="font-semibold text-sm text-slate-700 dark:text-slate-300">
                  Page {result.pageNum}
                </span>
                {result.changeCount > 0 ? (
                  <span className="text-xs bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 px-2.5 py-0.5 rounded-full font-medium">
                    {result.changeCount} change{result.changeCount !== 1 ? 's' : ''}
                  </span>
                ) : (
                  <span className="text-xs text-green-600 dark:text-green-400 font-medium">Identical</span>
                )}
              </div>
              {/* File name labels */}
              <div className="grid grid-cols-2 border-b border-slate-200 dark:border-slate-600">
                <div className="px-4 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 border-r border-slate-200 dark:border-slate-600 truncate" title={fileA?.name}>
                  {fileA?.name}
                </div>
                <div className="px-4 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 truncate" title={fileB?.name}>
                  {fileB?.name}
                </div>
              </div>
              {/* Side-by-side pages */}
              <div className="grid grid-cols-2">
                <div className="border-r border-slate-200 dark:border-slate-600 p-3 bg-slate-100 dark:bg-slate-900">
                  <PageViewer
                    doc={pdfDocA}
                    pageNum={result.pageNum}
                    highlights={result.leftHighlights}
                    onHover={handleHover}
                    onLeave={() => setTooltip(null)}
                  />
                </div>
                <div className="p-3 bg-slate-100 dark:bg-slate-900">
                  <PageViewer
                    doc={pdfDocB}
                    pageNum={result.pageNum}
                    highlights={result.rightHighlights}
                    onHover={handleHover}
                    onLeave={() => setTooltip(null)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tooltip ── */}
      {tooltip && <DiffTooltip x={tooltip.x} y={tooltip.y} content={tooltip.content} />}
    </div>
  );
};

export default PdfVisualCompare;
