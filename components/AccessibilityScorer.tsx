import React, { useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { AccessibilityResult, AccessibilityCriterion } from '../types';
import { scoreAccessibility } from '../services/llmService';
import FileUploader from './FileUploader';
import Loader from './Loader';
import { PdfFileIcon } from './icons/PdfFileIcon';

// ── Score Gauge ────────────────────────────────────────────────────────────

const ScoreGauge: React.FC<{ score: number }> = ({ score }) => {
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const dashoffset = circumference * (1 - score / 100);
    const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : score >= 40 ? '#f97316' : '#ef4444';

    return (
        <div className="relative w-36 h-36 flex-shrink-0">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                <circle cx="60" cy="60" r={radius} fill="none" stroke="currentColor" strokeWidth="10"
                    className="text-slate-100 dark:text-slate-700" />
                <circle cx="60" cy="60" r={radius} fill="none"
                    stroke={color} strokeWidth="10"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashoffset}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 0.8s ease' }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-extrabold leading-none" style={{ color }}>{score}</span>
                <span className="text-xs text-slate-400 mt-0.5">/100</span>
            </div>
        </div>
    );
};

// ── Grade Badge ────────────────────────────────────────────────────────────

const gradeStyle: Record<string, string> = {
    A: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700',
    B: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-700',
    C: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700',
    D: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-700',
    F: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700',
};

// ── Criterion Row ──────────────────────────────────────────────────────────

const statusConfig = {
    pass:           { icon: '✓', cls: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20', label: 'Pass' },
    fail:           { icon: '✗', cls: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',     label: 'Fail' },
    warning:        { icon: '⚠', cls: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20', label: 'Warn' },
    'not-applicable': { icon: '—', cls: 'text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800', label: 'N/A' },
};

const severityBadge: Record<string, string> = {
    critical: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    major:    'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    minor:    'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
};

const CriterionRow: React.FC<{ c: AccessibilityCriterion }> = ({ c }) => {
    const [expanded, setExpanded] = useState(false);
    const cfg = statusConfig[c.status] ?? statusConfig['not-applicable'];
    const hasDetail = c.issue || c.recommendation;

    return (
        <div className="border border-slate-100 dark:border-slate-700 rounded-lg overflow-hidden">
            <button
                onClick={() => hasDetail && setExpanded(v => !v)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left ${hasDetail ? 'hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer' : 'cursor-default'} transition-colors`}
            >
                <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${cfg.cls}`}>
                    {cfg.icon}
                </span>
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{c.id}</span>
                        {c.level && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium">
                                Level {c.level}
                            </span>
                        )}
                        {c.severity && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${severityBadge[c.severity]}`}>
                                {c.severity}
                            </span>
                        )}
                    </div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 mt-0.5 leading-snug">{c.name}</p>
                </div>
                {hasDetail && (
                    <svg className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                )}
            </button>

            {expanded && hasDetail && (
                <div className="px-4 pb-3 space-y-2 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
                    {c.issue && (
                        <div className="pt-2">
                            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Issue</p>
                            <p className="text-sm text-slate-700 dark:text-slate-300">{c.issue}</p>
                        </div>
                    )}
                    {c.recommendation && (
                        <div>
                            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-1">Recommendation</p>
                            <p className="text-sm text-slate-700 dark:text-slate-300">{c.recommendation}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ── Standard Score Bar ─────────────────────────────────────────────────────

const ScoreBar: React.FC<{ score: number }> = ({ score }) => {
    const color = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : score >= 40 ? 'bg-orange-500' : 'bg-red-500';
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
            </div>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 w-8 text-right">{score}</span>
        </div>
    );
};

// ── Main Component ─────────────────────────────────────────────────────────

interface PdfMeta {
    name: string;
    sizeKb: number;
    pages: number;
    analyzedChars: number;
}

function formatSize(bytes: number): string {
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
}

const AccessibilityScorer: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [result, setResult] = useState<AccessibilityResult | null>(null);
    const [pdfMeta, setPdfMeta] = useState<PdfMeta | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const extractTextFromPdf = async (f: File): Promise<{ text: string; pages: number }> => {
        const arrayBuffer = await f.arrayBuffer();
        const pdf = await (pdfjsLib as any).getDocument({ data: arrayBuffer }).promise;
        const pageTexts: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            pageTexts.push(content.items.map((item: any) => item.str).join(' '));
        }
        return { text: pageTexts.join('\n'), pages: pdf.numPages };
    };

    const handleScore = useCallback(async () => {
        if (!file) return;
        setIsLoading(true);
        setError(null);
        setResult(null);
        setPdfMeta(null);
        try {
            const { text: rawText, pages } = await extractTextFromPdf(file);
            if (!rawText.trim()) throw new Error('Could not extract text from the PDF. The file may be scanned or image-only.');
            const text = rawText.slice(0, 4000);
            setPdfMeta({ name: file.name, sizeKb: file.size, pages, analyzedChars: text.length });
            const res = await scoreAccessibility(text, file.name);
            setResult(res);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    }, [file]);

    const handleReset = () => { setFile(null); setResult(null); setError(null); setPdfMeta(null); };

    const wcag = result?.standards[0];
    const criteria = wcag?.criteria ?? [];
    const passCount = criteria.filter(c => c.status === 'pass').length;
    const failCount = criteria.filter(c => c.status === 'fail').length;
    const warnCount = criteria.filter(c => c.status === 'warning').length;

    return (
        <div className="max-w-6xl mx-auto space-y-4">
            {/* Upload panel */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                    <div>
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Upload Document</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Upload a PDF to receive an itemised WCAG 2.1 compliance report scored pass, fail, or warning with fix recommendations.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {['Level A', 'Level AA', 'WCAG 2.1'].map(s => (
                            <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border border-rose-100 dark:border-rose-800 font-medium">
                                {s}
                            </span>
                        ))}
                    </div>
                </div>
                {!file ? (
                    <FileUploader
                        onFileChange={f => { setFile(f); setResult(null); setError(null); setPdfMeta(null); }}
                        acceptedFileType=".pdf,application/pdf"
                        fileTypeName="PDF Document"
                        icon={<PdfFileIcon className="w-12 h-12 mb-4 text-slate-400" />}
                    />
                ) : (
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-5 flex items-center gap-4 border-2 border-dashed border-rose-400 dark:border-rose-600">
                        <PdfFileIcon className="w-10 h-10 flex-shrink-0 text-rose-500 dark:text-rose-400" />
                        <div className="flex-1 min-w-0">
                            <p className="font-semibold text-rose-600 dark:text-rose-400 text-sm">Ready to analyse</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{file.name}</p>
                        </div>
                        <button onClick={handleReset} className="flex-shrink-0 text-xs text-indigo-500 hover:underline">
                            Change file
                        </button>
                    </div>
                )}
                {file && !isLoading && (
                    <div className="mt-4 flex items-center gap-3">
                        <button
                            onClick={handleScore}
                            disabled={isLoading}
                            className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
                        >
                            Run Accessibility Check
                        </button>
                        {result && (
                            <button onClick={handleReset} className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                                Check another document
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Error */}
            {error && (
                <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
                    <span className="font-semibold">Analysis failed: </span>{error}
                </div>
            )}

            {/* Loading */}
            {isLoading && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-10 shadow-sm">
                    <Loader />
                    <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-4">
                        Analysing document against WCAG 2.1…
                    </p>
                </div>
            )}

            {/* Results */}
            {result && (
                <>
                    {/* Document info strip */}
                    {pdfMeta && (
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 px-5 py-3 shadow-sm flex flex-wrap items-center gap-x-6 gap-y-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <svg className="w-4 h-4 text-rose-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                                </svg>
                                <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate max-w-xs" title={pdfMeta.name}>
                                    {pdfMeta.name}
                                </span>
                            </div>
                            {[
                                { label: 'Size',     value: formatSize(pdfMeta.sizeKb) },
                                { label: 'Pages',    value: pdfMeta.pages.toString() },
                                { label: 'Analysed', value: `${pdfMeta.analyzedChars.toLocaleString()} chars` },
                            ].map(({ label, value }) => (
                                <div key={label} className="flex items-center gap-1.5 text-sm">
                                    <span className="text-slate-400 dark:text-slate-500">{label}:</span>
                                    <span className="font-medium text-slate-700 dark:text-slate-300">{value}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Score overview */}
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
                        <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start">
                            <ScoreGauge score={result.overallScore} />
                            <div className="flex-1 min-w-0 text-center sm:text-left">
                                <div className="flex flex-wrap items-center gap-3 justify-center sm:justify-start mb-2">
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">WCAG 2.1 Report</h3>
                                    <span className={`text-2xl font-extrabold w-10 h-10 rounded-xl flex items-center justify-center border-2 ${gradeStyle[result.grade]}`}>
                                        {result.grade}
                                    </span>
                                </div>
                                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">{result.summary}</p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {[
                                        { label: 'Passed',   value: passCount,       cls: 'text-emerald-600 dark:text-emerald-400' },
                                        { label: 'Failed',   value: failCount,       cls: 'text-red-600 dark:text-red-400' },
                                        { label: 'Warnings', value: warnCount,       cls: 'text-amber-600 dark:text-amber-400' },
                                        { label: 'Checked',  value: criteria.length, cls: 'text-slate-600 dark:text-slate-300' },
                                    ].map(({ label, value, cls }) => (
                                        <div key={label} className="bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2 text-center">
                                            <p className={`text-2xl font-extrabold ${cls}`}>{value}</p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Itemised criteria */}
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm space-y-2">
                        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                            WCAG 2.1 Criteria — {criteria.length} checked
                        </h4>
                        {[...criteria]
                            .sort((a, b) => {
                                const order = { fail: 0, warning: 1, pass: 2, 'not-applicable': 3 };
                                return (order[a.status] ?? 4) - (order[b.status] ?? 4);
                            })
                            .map((c, i) => <CriterionRow key={`${c.id}-${i}`} c={c} />)
                        }
                    </div>
                </>
            )}
        </div>
    );
};

export default AccessibilityScorer;
