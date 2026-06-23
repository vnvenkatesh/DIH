
import React, { useState, useCallback, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { diffArrays } from 'diff';
import FileUploader from './FileUploader';
import { PdfFileIcon } from './icons/PdfFileIcon';
import { ArrowsRightLeftIcon } from './icons/ArrowsRightLeftIcon';

// ── Type aliases ──────────────────────────────────────────────────────────────
type PdfTextItem = Extract<
  Awaited<ReturnType<pdfjsLib.PDFPageProxy['getTextContent']>>['items'][number],
  { str: string }
>;

// ── Interfaces ────────────────────────────────────────────────────────────────
interface Word {
  text: string;
  x: number; y: number; w: number; h: number;
  lineY: number;
  fontName: string;
  fontSize: number; // in pt
  bold: boolean;
  italic: boolean;
}

interface BBox { left: number; top: number; width: number; height: number; }

interface DiffHighlight {
  type: 'added' | 'removed' | 'style' | 'visual';
  bbox: BBox;
  text: string;
  styleReason?: string;
  navId: string; // unique id for navigation scrolling
}

// aPage / bPage = null means that page is missing on that side
interface PagePairing { aPage: number | null; bPage: number | null; }

interface PageResult {
  pairing: PagePairing;
  leftHighlights: DiffHighlight[];
  rightHighlights: DiffHighlight[];
  changeCount: number;
}

interface Summary {
  aPagesTotal: number;
  bPagesTotal: number;
  pairsMatched: number;
  missedInB: number[];
  extraInB: number[];
  totalAdded: number;
  totalRemoved: number;
  totalStyle: number;
  totalVisual: number;
}

interface TooltipState { content: React.ReactNode; x: number; y: number; }

// ── Constants ─────────────────────────────────────────────────────────────────
const SCALE = 1.5;
const MATCH_THRESHOLD = 0.25; // min Jaccard score to pair pages
const EMPTY_BBOX: BBox = { left: 0, top: 0, width: 0, height: 0 };

const HIGHLIGHT_CONFIG = {
  added:   { bg: 'rgba(59,130,246,0.25)',  border: '2px solid rgba(59,130,246,0.9)',  label: 'Added',         dot: '#3b82f6' },
  removed: { bg: 'rgba(239,68,68,0.25)',   border: '2px solid rgba(239,68,68,0.9)',   label: 'Removed',       dot: '#ef4444' },
  style:   { bg: 'rgba(234,179,8,0.25)',   border: '2px solid rgba(234,179,8,0.9)',   label: 'Style Changed', dot: '#eab308' },
  visual:  { bg: 'rgba(168,85,247,0.25)',  border: '2px solid rgba(168,85,247,0.9)',  label: 'Visual Diff',   dot: '#a855f7' },
} as const;

// ── Pure helpers ──────────────────────────────────────────────────────────────
const multiplyMatrices = (m1: number[], m2: number[]): number[] => [
  m1[0]*m2[0]+m1[2]*m2[1], m1[1]*m2[0]+m1[3]*m2[1],
  m1[0]*m2[2]+m1[2]*m2[3], m1[1]*m2[2]+m1[3]*m2[3],
  m1[0]*m2[4]+m1[2]*m2[5]+m1[4], m1[1]*m2[4]+m1[3]*m2[5]+m1[5],
];

const wordBbox = (w: Word): BBox => ({
  left: Math.round(w.x), top: Math.round(w.y),
  width: Math.max(Math.round(w.w), 4),
  height: Math.max(Math.round(w.h), 6),
});

const parseExclusions = (raw: string): string[] =>
  raw.split(/[\n,]/).map(s => s.trim()).filter(Boolean);

const applyExclusion = (text: string, exclusions: string[]): string => {
  let r = text;
  for (const ex of exclusions)
    r = r.replace(new RegExp(ex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
  return r.trim();
};

// ── Word bag for Jaccard similarity ──────────────────────────────────────────
const wordBagOf = (words: Word[]): Map<string, number> => {
  const bag = new Map<string, number>();
  for (const w of words) {
    const k = w.text.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (k) bag.set(k, (bag.get(k) ?? 0) + 1);
  }
  return bag;
};

const jaccard = (a: Map<string, number>, b: Map<string, number>): number => {
  let inter = 0, union = 0;
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const av = a.get(k) ?? 0, bv = b.get(k) ?? 0;
    inter += Math.min(av, bv); union += Math.max(av, bv);
  }
  return union === 0 ? 1 : inter / union;
};

// ── Page alignment via DP ─────────────────────────────────────────────────────
const matchPages = (
  wordsPerPageA: Word[][], wordsPerPageB: Word[][]
): PagePairing[] => {
  const m = wordsPerPageA.length, n = wordsPerPageB.length;
  if (m === 0 && n === 0) return [];

  const bagsA = wordsPerPageA.map(wordBagOf);
  const bagsB = wordsPerPageB.map(wordBagOf);

  // sim[i][j] for 1-based indices (0 = sentinel)
  const sim = (i: number, j: number) =>
    i > 0 && j > 0 ? jaccard(bagsA[i-1], bagsB[j-1]) : 0;

  const dp = Array.from({length: m+1}, () => new Array(n+1).fill(0));
  // choice: 1=match, 2=skip A (missing in B), 3=skip B (extra in B)
  const ch = Array.from({length: m+1}, () => new Array(n+1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const s = sim(i, j);
      const matchVal = s >= MATCH_THRESHOLD ? dp[i-1][j-1] + s : -Infinity;
      const skipA = dp[i-1][j];
      const skipB = dp[i][j-1];
      if (matchVal >= skipA && matchVal >= skipB) {
        dp[i][j] = matchVal; ch[i][j] = 1;
      } else if (skipA >= skipB) {
        dp[i][j] = skipA; ch[i][j] = 2;
      } else {
        dp[i][j] = skipB; ch[i][j] = 3;
      }
    }
  }

  const pairs: PagePairing[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ch[i][j] === 1) {
      pairs.unshift({ aPage: i, bPage: j }); i--; j--;
    } else if (i > 0 && (j === 0 || ch[i][j] === 2)) {
      pairs.unshift({ aPage: i, bPage: null }); i--;
    } else {
      pairs.unshift({ aPage: null, bPage: j }); j--;
    }
  }
  return pairs;
};

// ── Word extraction from a PDF page ──────────────────────────────────────────
const extractPageWords = async (
  doc: pdfjsLib.PDFDocumentProxy, pageNum: number
): Promise<Word[]> => {
  if (pageNum < 1 || pageNum > doc.numPages) return [];
  try {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const vp = page.getViewport({ scale: SCALE });
    const words: Word[] = [];

    for (const raw of content.items) {
      if (!('str' in raw) || !raw.str.trim()) continue;
      const item = raw as PdfTextItem;
      const tx = multiplyMatrices(vp.transform, item.transform);
      const fontH = Math.sqrt(tx[2]**2 + tx[3]**2); // canvas px
      const itemX = tx[4], itemY = tx[5]; // itemY = baseline in canvas px
      const fontName = (item as any).fontName ?? '';
      const bold = /bold|black|heavy|demi/i.test(fontName);
      const italic = /italic|oblique/i.test(fontName);
      // fontSize in points: fontH / SCALE / (96/72) = fontH * 0.5
      const fontSize = Math.round(fontH * 0.5 * 10) / 10;
      // Use char-width estimate for canvas pixel width (item.width is PDF units)
      const charW = fontH * 0.58;

      // Split item text into individual word tokens
      const tokenRe = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(item.str)) !== null) {
        const token = m[0];
        const charOffset = m.index;
        const xCanvas = itemX + charOffset * charW;
        const wCanvas = Math.max(token.length * charW, 4);
        // lineY: snap baseline to 3px grid for grouping same-line words
        const lineY = Math.round(itemY / 3) * 3;
        words.push({
          text: token,
          x: xCanvas,
          y: itemY - fontH, // top of glyph in canvas px
          w: wCanvas,
          h: fontH,
          lineY,
          fontName, fontSize, bold, italic,
        });
      }
    }
    // Reading order: top-to-bottom, left-to-right
    return words.sort((a, b) => a.lineY !== b.lineY ? a.lineY - b.lineY : a.x - b.x);
  } catch {
    return [];
  }
};

// ── Off-screen page render ────────────────────────────────────────────────────
const renderPageToCanvas = async (
  doc: pdfjsLib.PDFDocumentProxy, pageNum: number
): Promise<HTMLCanvasElement> => {
  const page = await doc.getPage(pageNum);
  const vp = page.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width; canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp } as any).promise;
  return canvas;
};

// ── Color sampling from canvas ────────────────────────────────────────────────
const sampleWordColor = (canvas: HTMLCanvasElement, word: Word): string => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return '#000000';
  const x = Math.max(0, Math.floor(word.x));
  const y = Math.max(0, Math.floor(word.y));
  const w = Math.min(canvas.width - x, Math.max(1, Math.ceil(word.w)));
  const h = Math.min(canvas.height - y, Math.max(1, Math.ceil(word.h)));
  if (w <= 0 || h <= 0) return '#000000';
  const data = ctx.getImageData(x, y, w, h).data;
  const counts = new Map<string, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] < 128) continue;
    if (data[i] > 220 && data[i+1] > 220 && data[i+2] > 220) continue; // near-white
    const hex = `#${data[i].toString(16).padStart(2,'0')}${data[i+1].toString(16).padStart(2,'0')}${data[i+2].toString(16).padStart(2,'0')}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  if (!counts.size) return '#000000';
  let best = '#000000', bestN = 0;
  for (const [c, n] of counts) if (n > bestN) { bestN = n; best = c; }
  return best;
};

// ── Pixel diff (Precision mode, non-text regions only) ────────────────────────
const findPixelDiffRegions = (
  cA: HTMLCanvasElement, cB: HTMLCanvasElement, wordsA: Word[], wordsB: Word[]
): BBox[] => {
  const w = Math.min(cA.width, cB.width), h = Math.min(cA.height, cB.height);
  if (!w || !h) return [];
  const dA = cA.getContext('2d')!.getImageData(0,0,w,h).data;
  const dB = cB.getContext('2d')!.getImageData(0,0,w,h).data;
  const BLOCK = 16, COLOR_THRESH = 80, BLOCK_THRESH = 0.20;
  const MIN_SIGNIFICANT = 8, MIN_W = 30, MIN_H = 15, TEXT_PAD = 12;
  const cols = Math.ceil(w/BLOCK), rows = Math.ceil(h/BLOCK);

  const textMask = new Uint8Array(rows*cols);
  for (const word of [...wordsA, ...wordsB]) {
    const fh = word.h > 0 ? word.h : 12;
    const mw = Math.max(word.w, word.text.length * fh * 0.65, fh*0.5);
    const r0 = Math.max(0, Math.floor((word.y - TEXT_PAD) / BLOCK));
    const r1 = Math.min(rows-1, Math.ceil((word.y + fh + TEXT_PAD) / BLOCK));
    const c0 = Math.max(0, Math.floor((word.x - TEXT_PAD) / BLOCK));
    const c1 = Math.min(cols-1, Math.ceil((word.x + mw + TEXT_PAD) / BLOCK));
    for (let r=r0;r<=r1;r++) for (let c=c0;c<=c1;c++) textMask[r*cols+c]=1;
  }

  const diffBlocks = new Set<number>();
  for (let r=0;r<rows;r++) {
    for (let c=0;c<cols;c++) {
      if (textMask[r*cols+c]) continue;
      let diffPx=0, sig=0;
      for (let dy=0;dy<BLOCK&&r*BLOCK+dy<h;dy++) {
        for (let dx=0;dx<BLOCK&&c*BLOCK+dx<w;dx++) {
          const i=((r*BLOCK+dy)*w+(c*BLOCK+dx))*4;
          if (dA[i]>240&&dA[i+1]>240&&dA[i+2]>240&&dB[i]>240&&dB[i+1]>240&&dB[i+2]>240) continue;
          sig++;
          if (Math.abs(dA[i]-dB[i])+Math.abs(dA[i+1]-dB[i+1])+Math.abs(dA[i+2]-dB[i+2])>COLOR_THRESH) diffPx++;
        }
      }
      if (sig>=MIN_SIGNIFICANT && diffPx/sig>BLOCK_THRESH) diffBlocks.add(r*cols+c);
    }
  }

  const visited = new Set<number>(); const regions: BBox[] = [];
  for (const blk of diffBlocks) {
    if (visited.has(blk)) continue;
    const queue=[blk]; visited.add(blk);
    let minR=Math.floor(blk/cols),maxR=minR,minC=blk%cols,maxC=minC;
    while (queue.length) {
      const cur=queue.shift()!;
      const cr=Math.floor(cur/cols),cc=cur%cols;
      for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]] as [number,number][]) {
        const nr=cr+dr,nc=cc+dc;
        if (nr>=0&&nr<rows&&nc>=0&&nc<cols) {
          const nb=nr*cols+nc;
          if (diffBlocks.has(nb)&&!visited.has(nb)) {
            visited.add(nb);queue.push(nb);
            minR=Math.min(minR,nr);maxR=Math.max(maxR,nr);
            minC=Math.min(minC,nc);maxC=Math.max(maxC,nc);
          }
        }
      }
    }
    const rw=(maxC-minC+1)*BLOCK,rh=(maxR-minR+1)*BLOCK;
    if (rw>=MIN_W&&rh>=MIN_H) regions.push({left:minC*BLOCK,top:minR*BLOCK,width:rw,height:rh});
  }
  return regions;
};

const bboxOverlaps = (a: BBox, b: BBox): boolean =>
  a.left < b.left+b.width && a.left+a.width > b.left &&
  a.top  < b.top+b.height  && a.top+a.height  > b.top;

// ── Word-level diff for a matched page pair ───────────────────────────────────
const diffWords = (
  wordsA: Word[], wordsB: Word[],
  canvasA: HTMLCanvasElement | null, canvasB: HTMLCanvasElement | null,
  mode: 'simple' | 'precise',
  exclusions: string[],
  pageTag: string,
): { left: DiffHighlight[]; right: DiffHighlight[] } => {
  const left: DiffHighlight[] = [], right: DiffHighlight[] = [];

  const filt = (ws: Word[]) =>
    ws.filter(w => applyExclusion(w.text, exclusions).length > 0);
  const wA = filt(wordsA), wB = filt(wordsB);

  const normSimple = (s: string) => s.replace(/\s+/g,' ').trim();
  const rawDiff = diffArrays(
    wA.map(w => w.text), wB.map(w => w.text),
    { comparator: mode === 'simple'
        ? (a: string, b: string) => normSimple(a) === normSimple(b)
        : (a: string, b: string) => a === b },
  );

  let iA = 0, iB = 0, navSeq = 0;
  const nav = () => `${pageTag}-${navSeq++}`;

  for (const part of rawDiff) {
    if (!part.added && !part.removed) {
      // Unchanged text — check style
      for (let k = 0; k < part.value.length; k++) {
        const wObjA = wA[iA+k], wObjB = wB[iB+k];
        if (!wObjA || !wObjB) continue;
        const reasons: string[] = [];

        // Color (both modes)
        if (canvasA && canvasB) {
          const colA = sampleWordColor(canvasA, wObjA);
          const colB = sampleWordColor(canvasB, wObjB);
          if (colA !== colB) reasons.push(`Color: ${colA} → ${colB}`);
        }

        // Font/style (Precision only)
        if (mode === 'precise') {
          if (wObjA.fontName && wObjB.fontName && wObjA.fontName !== wObjB.fontName)
            reasons.push(`Font: ${wObjA.fontName} → ${wObjB.fontName}`);
          if (Math.abs(wObjA.fontSize - wObjB.fontSize) > 0.5)
            reasons.push(`Size: ${wObjA.fontSize.toFixed(1)}pt → ${wObjB.fontSize.toFixed(1)}pt`);
          if (wObjA.bold !== wObjB.bold) reasons.push(wObjB.bold ? 'Bold added' : 'Bold removed');
          if (wObjA.italic !== wObjB.italic) reasons.push(wObjB.italic ? 'Italic added' : 'Italic removed');
        }

        if (reasons.length) {
          const id = nav();
          const reason = reasons.join(' · ');
          left.push({ type:'style', bbox:wordBbox(wObjA), text:wObjA.text, styleReason:reason, navId:`L-${id}` });
          right.push({ type:'style', bbox:wordBbox(wObjB), text:wObjB.text, styleReason:reason, navId:`R-${id}` });
        }
      }
      iA += part.value.length; iB += part.value.length;
    } else if (part.removed) {
      for (let k = 0; k < part.value.length; k++) {
        const w = wA[iA+k];
        if (w) left.push({ type:'removed', bbox:wordBbox(w), text:w.text, navId:`L-${nav()}` });
      }
      iA += part.value.length;
    } else {
      for (let k = 0; k < part.value.length; k++) {
        const w = wB[iB+k];
        if (w) right.push({ type:'added', bbox:wordBbox(w), text:w.text, navId:`R-${nav()}` });
      }
      iB += part.value.length;
    }
  }
  return { left, right };
};

// ── Sub-components ────────────────────────────────────────────────────────────
const FilePlaceholder: React.FC<{ file: File; label: string; onClear: () => void }> = ({ file, label, onClear }) => (
  <div className="w-full p-8 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg flex flex-col justify-center items-center">
    <PdfFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />
    <p className="font-semibold text-green-600 dark:text-green-400">{label} Ready:</p>
    <p className="text-sm text-slate-700 dark:text-slate-300 truncate w-full px-4 text-center">{file.name}</p>
    <button onClick={onClear} className="text-xs text-indigo-500 hover:underline mt-2">Change File</button>
  </div>
);

const StatCard: React.FC<{ value: number | string; label: string; colorClass: string }> = ({ value, label, colorClass }) => (
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
    let cancelled = false;
    doc.getPage(pageNum).then(page => {
      if (cancelled) return;
      const vp = page.getViewport({ scale: SCALE });
      canvas.width = vp.width; canvas.height = vp.height;
      const task = page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp } as any);
      taskRef.current = task;
      task.promise.catch(e => { if (e?.name !== 'AbortException') console.error(e); });
    }).catch(console.error);
    return () => { cancelled = true; taskRef.current?.cancel(); };
  }, [doc, pageNum]);
  return <canvas ref={canvasRef} className="block" />;
};

const MissingPagePlaceholder: React.FC<{ pageNum: number | null; side: 'A' | 'B' }> = ({ pageNum, side }) => (
  <div className="flex flex-col items-center justify-center min-h-64 bg-slate-100 dark:bg-slate-850 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-sm text-center p-6">
    <svg className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
    {pageNum
      ? <p className="text-sm font-medium text-slate-400 dark:text-slate-500">Page {pageNum} — not present in File {side}</p>
      : <p className="text-sm font-medium text-slate-400 dark:text-slate-500">No corresponding page in File {side}</p>}
  </div>
);

const PageViewer: React.FC<{
  doc: pdfjsLib.PDFDocumentProxy | null;
  pageNum: number | null;
  missingSide: 'A' | 'B';
  highlights: DiffHighlight[];
  onHover: (e: React.MouseEvent, h: DiffHighlight) => void;
  onLeave: () => void;
  activeNavId: string | null;
}> = ({ doc, pageNum, missingSide, highlights, onHover, onLeave, activeNavId }) => {
  if (!doc || pageNum === null) {
    return <MissingPagePlaceholder pageNum={pageNum} side={missingSide} />;
  }
  return (
    <div className="relative shadow-md rounded-sm">
      <PdfPageCanvas doc={doc} pageNum={pageNum} />
      <div className="absolute inset-0 pointer-events-none">
        {highlights.map((h, i) => {
          if (!h.bbox.width || !h.bbox.height) return null;
          const cfg = HIGHLIGHT_CONFIG[h.type];
          const isActive = h.navId === activeNavId;
          return (
            <div
              key={i}
              id={`nav-${h.navId}`}
              className="absolute pointer-events-auto cursor-pointer"
              style={{
                left: h.bbox.left, top: h.bbox.top,
                width: h.bbox.width, height: h.bbox.height,
                background: cfg.bg,
                border: isActive ? `3px solid ${cfg.dot}` : cfg.border,
                borderRadius: 2,
                boxShadow: isActive ? `0 0 0 2px ${cfg.dot}55` : undefined,
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
    className="fixed z-50 max-w-xs p-3 text-xs bg-slate-900 text-white rounded-lg shadow-2xl pointer-events-none border border-slate-700"
    style={{ left: x, top: y, transform: 'translate(-50%, calc(-100% - 10px))' }}
  >
    {content}
    <div className="absolute left-1/2 -translate-x-1/2 bottom-[-5px] w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-slate-900" />
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────
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
  const [diffMode, setDiffMode] = useState<'simple' | 'precise'>('simple');
  // Navigation state
  const [navList, setNavList] = useState<string[]>([]); // ordered navIds
  const [navIndex, setNavIndex] = useState(0);
  const [activeNavId, setActiveNavId] = useState<string | null>(null);

  useEffect(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.min.mjs';
  }, []);

  const loadPdf = async (file: File) => {
    const buf = await file.arrayBuffer();
    return pdfjsLib.getDocument({ data: buf }).promise;
  };

  const navigate = useCallback((direction: 1 | -1) => {
    if (!navList.length) return;
    const next = (navIndex + direction + navList.length) % navList.length;
    setNavIndex(next);
    const id = navList[next];
    setActiveNavId(id);
    // Scroll both sides: left (L-) and right (R-) share the same seq number
    const seq = id.slice(2); // strip "L-" or "R-"
    for (const prefix of ['L-', 'R-']) {
      document.getElementById(`nav-${prefix}${seq}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [navList, navIndex]);

  const handleCompare = useCallback(async () => {
    if (!fileA || !fileB) return;
    setIsLoading(true); setError(null);
    setPageResults(null); setSummary(null);
    setNavList([]); setNavIndex(0); setActiveNavId(null);

    try {
      setLoadingMessage('Loading PDFs…');
      const [docA, docB] = await Promise.all([
        pdfDocA ?? loadPdf(fileA),
        pdfDocB ?? loadPdf(fileB),
      ]);
      if (!pdfDocA) setPdfDocA(docA);
      if (!pdfDocB) setPdfDocB(docB);

      const exclusions = parseExclusions(exclusionInput);
      const numA = docA.numPages, numB = docB.numPages;

      // Step 1: Extract words from every page
      setLoadingMessage('Extracting text from all pages…');
      const [allWordsA, allWordsB] = await Promise.all([
        Promise.all(Array.from({length: numA}, (_, i) => extractPageWords(docA, i+1))),
        Promise.all(Array.from({length: numB}, (_, i) => extractPageWords(docB, i+1))),
      ]);

      // Step 2: Match pages
      setLoadingMessage('Matching pages…');
      const pairings = matchPages(allWordsA, allWordsB);

      // Step 3: Diff each matched pair
      const results: PageResult[] = [];
      let totAdded=0, totRemoved=0, totStyle=0, totVisual=0;
      const allNavIds: string[] = [];
      const missedInB: number[] = [], extraInB: number[] = [];

      for (let pi = 0; pi < pairings.length; pi++) {
        const pair = pairings[pi];
        const { aPage, bPage } = pair;

        if (aPage === null) { extraInB.push(bPage!); results.push({ pairing: pair, leftHighlights:[], rightHighlights:[], changeCount:0 }); continue; }
        if (bPage === null) { missedInB.push(aPage!); results.push({ pairing: pair, leftHighlights:[], rightHighlights:[], changeCount:0 }); continue; }

        setLoadingMessage(`Comparing page A:${aPage} ↔ B:${bPage}…`);

        const wA = allWordsA[aPage-1];
        const wB = allWordsB[bPage-1];
        const pageTag = `p${pi}`;

        // Render canvases (needed for color sampling + pixel diff)
        let canvasA: HTMLCanvasElement | null = null;
        let canvasB: HTMLCanvasElement | null = null;
        try {
          [canvasA, canvasB] = await Promise.all([
            renderPageToCanvas(docA, aPage),
            renderPageToCanvas(docB, bPage),
          ]);
        } catch { /* continue without canvas-based checks */ }

        // Word-level diff
        const { left, right } = diffWords(wA, wB, canvasA, canvasB, diffMode, exclusions, pageTag);

        // Pixel diff (Precision only)
        let pixelHighlights: DiffHighlight[] = [];
        if (diffMode === 'precise' && canvasA && canvasB) {
          const regions = findPixelDiffRegions(canvasA, canvasB, wA, wB);
          const existingBboxes = [...left, ...right].map(h => h.bbox);
          let pSeq = 0;
          for (const region of regions) {
            if (existingBboxes.some(b => bboxOverlaps(b, region))) continue;
            const id = `${pageTag}-px${pSeq++}`;
            pixelHighlights.push({ type:'visual', bbox:region, text:'', navId:`L-${id}` });
            pixelHighlights.push({ type:'visual', bbox:region, text:'', navId:`R-${id}` });
          }
        }

        const leftH = [...left, ...pixelHighlights.filter(h => h.navId.startsWith('L-'))];
        const rightH = [...right, ...pixelHighlights.filter(h => h.navId.startsWith('R-'))];

        // Count
        const added   = right.filter(h => h.type==='added').length;
        const removed = left.filter(h => h.type==='removed').length;
        const style   = left.filter(h => h.type==='style').length;
        const visual  = leftH.filter(h => h.type==='visual').length;
        totAdded+=added; totRemoved+=removed; totStyle+=style; totVisual+=visual;

        // Build nav list from left highlights (L- prefix) sorted by Y
        const pageNavIds = leftH
          .filter(h => h.navId.startsWith('L-'))
          .sort((a,b) => a.bbox.top - b.bbox.top)
          .map(h => h.navId);
        allNavIds.push(...pageNavIds);

        results.push({ pairing: pair, leftHighlights:leftH, rightHighlights:rightH, changeCount:added+removed+style+visual });
      }

      setPageResults(results);
      setNavList(allNavIds);
      setSummary({
        aPagesTotal: numA, bPagesTotal: numB,
        pairsMatched: pairings.filter(p => p.aPage && p.bPage).length,
        missedInB, extraInB,
        totalAdded: totAdded, totalRemoved: totRemoved,
        totalStyle: totStyle, totalVisual: totVisual,
      });
    } catch (e) {
      console.error(e);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false); setLoadingMessage('');
    }
  }, [fileA, fileB, pdfDocA, pdfDocB, exclusionInput, diffMode]);

  const handleReset = () => {
    setFileA(null); setFileB(null);
    setPdfDocA(null); setPdfDocB(null);
    setPageResults(null); setSummary(null);
    setError(null); setExclusionInput('');
    setNavList([]); setNavIndex(0); setActiveNavId(null);
  };

  const handleHover = (e: React.MouseEvent, h: DiffHighlight) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const cfg = HIGHLIGHT_CONFIG[h.type];
    let content: React.ReactNode;
    if (h.type === 'removed') content = <div><span className="font-bold text-red-300 block mb-1">Removed</span><span className="font-mono">{h.text}</span></div>;
    else if (h.type === 'added') content = <div><span className="font-bold text-blue-300 block mb-1">Added</span><span className="font-mono">{h.text}</span></div>;
    else if (h.type === 'style') content = <div><span className="font-bold text-yellow-300 block mb-1">Style Changed</span><span className="text-slate-300 font-mono">{h.styleReason}</span></div>;
    else content = <div><span className="font-bold text-purple-300 block mb-1">Visual Difference</span><span className="text-slate-400 text-xs">Image, colour fill or border change.</span></div>;
    setTooltip({ content, x: rect.left + rect.width/2, y: rect.top });
  };

  const activeParsedExclusions = parseExclusions(exclusionInput);
  const totalDiffs = (summary?.totalAdded ?? 0) + (summary?.totalRemoved ?? 0) + (summary?.totalStyle ?? 0) + (summary?.totalVisual ?? 0);
  const hasDiffs = totalDiffs > 0 || (summary?.missedInB.length ?? 0) > 0 || (summary?.extraInB.length ?? 0) > 0;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 md:p-10">

      {/* ── Header ── */}
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center justify-center gap-3">
          <ArrowsRightLeftIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          PDF Visual Compare
        </h2>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          Word-level side-by-side diff with smart page matching — no AI required.
        </p>
      </div>

      {/* ── File upload ── */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {fileA
          ? <FilePlaceholder file={fileA} label="Original PDF" onClear={() => { setFileA(null); setPdfDocA(null); setPageResults(null); }} />
          : <FileUploader onFileChange={setFileA} acceptedFileType="application/pdf" fileTypeName="Original PDF" icon={<PdfFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />} />}
        {fileB
          ? <FilePlaceholder file={fileB} label="Revised PDF" onClear={() => { setFileB(null); setPdfDocB(null); setPageResults(null); }} />
          : <FileUploader onFileChange={setFileB} acceptedFileType="application/pdf" fileTypeName="Revised PDF" icon={<PdfFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />} />}
      </div>

      {/* ── Exclusion strings ── */}
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
          <svg className={`w-4 h-4 transition-transform ${showExclusions ? 'rotate-180':''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showExclusions && (
          <div className="px-4 py-4 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
              Words/phrases stripped from both PDFs before comparison (comma or newline separated).
            </p>
            <textarea
              value={exclusionInput}
              onChange={e => setExclusionInput(e.target.value)}
              placeholder="e.g. Page 1 of 10, Generated on, Document ID"
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
          </div>
        )}
      </div>

      {/* ── Mode selector ── */}
      <div className="flex flex-col items-center gap-2 mb-6">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500 dark:text-slate-400 font-medium">Depth:</span>
          {(['simple','precise'] as const).map(mode => (
            <button key={mode} onClick={() => setDiffMode(mode)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors capitalize ${
                diffMode===mode ? 'bg-indigo-600 text-white shadow' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
              }`}>{mode}</button>
          ))}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {diffMode==='simple' ? 'Word-level text diff + colour changes' : 'Superset of Simple + font/size/bold/italic + visual image diff'}
        </p>
      </div>

      {/* ── Actions ── */}
      <div className="flex items-center justify-center gap-4 mb-8">
        <button onClick={handleCompare} disabled={!fileA||!fileB||isLoading}
          className="bg-indigo-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-300 dark:focus:ring-indigo-800 transition-all transform hover:scale-105 inline-flex items-center gap-2 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed disabled:scale-100">
          <ArrowsRightLeftIcon className="w-5 h-5" />
          {pageResults ? 'Re-Compare' : 'Compare Documents'}
        </button>
        <button onClick={handleReset} disabled={!fileA&&!fileB}
          className="bg-slate-200 text-slate-700 font-bold py-3 px-8 rounded-lg hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
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
          <p className="font-bold">Error</p><p>{error}</p>
        </div>
      )}

      {/* ── Summary ── */}
      {summary && !isLoading && (
        <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-600">
          <h3 className="font-bold text-slate-900 dark:text-white mb-3">Comparison Summary</h3>

          {/* Page counts */}
          <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400 mb-4">
            <span>File A: <strong>{summary.aPagesTotal}</strong> pages</span>
            <span>File B: <strong>{summary.bPagesTotal}</strong> pages</span>
            <span>Matched: <strong>{summary.pairsMatched}</strong> pairs</span>
            {summary.missedInB.length > 0 && (
              <span className="text-orange-600 dark:text-orange-400 font-medium">
                Pages missed in B: {summary.missedInB.join(', ')}
              </span>
            )}
            {summary.extraInB.length > 0 && (
              <span className="text-blue-600 dark:text-blue-400 font-medium">
                Extra pages in B: {summary.extraInB.join(', ')}
              </span>
            )}
          </div>

          {/* Diff counts */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatCard value={summary.totalAdded}   label="Words Added"   colorClass="text-blue-600 dark:text-blue-400" />
            <StatCard value={summary.totalRemoved} label="Words Removed" colorClass="text-red-600 dark:text-red-400" />
            <StatCard value={summary.totalStyle}   label="Style Changes" colorClass="text-yellow-600 dark:text-yellow-400" />
            {diffMode==='precise' && <StatCard value={summary.totalVisual} label="Visual Diffs" colorClass="text-purple-600 dark:text-purple-400" />}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4">
            {(['removed','added','style',...(diffMode==='precise'?['visual']:[])] as const).map(type => (
              <div key={type} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: HIGHLIGHT_CONFIG[type as keyof typeof HIGHLIGHT_CONFIG].dot }} />
                <span>{HIGHLIGHT_CONFIG[type as keyof typeof HIGHLIGHT_CONFIG].label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── No differences ── */}
      {!isLoading && pageResults && !hasDiffs && (
        <div className="text-center text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 p-4 rounded-lg mb-6">
          No differences found between the two documents.
        </div>
      )}

      {/* ── Page comparison + navigation ── */}
      {!isLoading && pageResults && (pdfDocA || pdfDocB) && (
        <div className="relative">
          {/* Navigation arrows — sticky, top-right */}
          {navList.length > 0 && (
            <div className="sticky top-4 z-20 flex justify-end mb-3 pointer-events-none">
              <div className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-full px-3 py-1.5 shadow-lg pointer-events-auto">
                <button
                  onClick={() => navigate(-1)}
                  title="Previous difference"
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                  </svg>
                </button>
                <span className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-300 min-w-[3rem] text-center">
                  {navList.length > 0 ? `${navIndex+1} / ${navList.length}` : '—'}
                </span>
                <button
                  onClick={() => navigate(1)}
                  title="Next difference"
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Page pairs */}
          <div className="space-y-6">
            {pageResults.map((result, pi) => {
              const { aPage, bPage } = result.pairing;
              return (
                <div key={pi} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                  {/* Page header */}
                  <div className="flex items-center justify-between px-4 py-2 bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                    <span className="font-semibold text-sm text-slate-700 dark:text-slate-300">
                      {aPage && bPage ? `Page A:${aPage} ↔ B:${bPage}`
                        : aPage ? `Page A:${aPage} — missing in B`
                        : `Page B:${bPage} — not in A`}
                    </span>
                    {result.changeCount > 0
                      ? <span className="text-xs bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 px-2.5 py-0.5 rounded-full font-medium">{result.changeCount} change{result.changeCount!==1?'s':''}</span>
                      : (aPage && bPage && <span className="text-xs text-green-600 dark:text-green-400 font-medium">Identical</span>)
                    }
                  </div>

                  {/* File labels */}
                  <div className="grid grid-cols-2 border-b border-slate-200 dark:border-slate-600">
                    <div className="px-4 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 border-r border-slate-200 dark:border-slate-600 truncate" title={fileA?.name}>{fileA?.name}</div>
                    <div className="px-4 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 truncate" title={fileB?.name}>{fileB?.name}</div>
                  </div>

                  {/* Side-by-side pages */}
                  <div className="grid grid-cols-2">
                    <div className="border-r border-slate-200 dark:border-slate-600 p-3 bg-slate-100 dark:bg-slate-900 overflow-auto">
                      <PageViewer
                        doc={pdfDocA}
                        pageNum={aPage}
                        missingSide="A"
                        highlights={result.leftHighlights}
                        onHover={handleHover}
                        onLeave={() => setTooltip(null)}
                        activeNavId={activeNavId}
                      />
                    </div>
                    <div className="p-3 bg-slate-100 dark:bg-slate-900 overflow-auto">
                      <PageViewer
                        doc={pdfDocB}
                        pageNum={bPage}
                        missingSide="B"
                        highlights={result.rightHighlights}
                        onHover={handleHover}
                        onLeave={() => setTooltip(null)}
                        activeNavId={activeNavId}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Tooltip ── */}
      {tooltip && <DiffTooltip x={tooltip.x} y={tooltip.y} content={tooltip.content} />}
    </div>
  );
};

export default PdfVisualCompare;
