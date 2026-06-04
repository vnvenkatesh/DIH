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

const AccessibilityScorer: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [result, setResult] = useState<AccessibilityResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const extractTextFromPdf = async (f: File): Promise<string> => {
        const arrayBuffer = await f.arrayBuffer();
        const pdf = await (pdfjsLib as any).getDocument({ data: arrayBuffer }).promise;
        const pages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            pages.push(content.items.map((item: any) => item.str).join(' '));
        }
        return pages.join('\n');
    };

    const handleScore = useCallback(async () => {
        if (!file) return;
        setIsLoading(true);
        setError(null);
        setResult(null);
        try {
            const rawText = await extractTextFromPdf(file);
            if (!rawText.trim()) throw new Error('Could not extract text from the PDF. The file may be scanned or image-only.');
            // Truncate to keep the request within proxy timeout limits
            const text = rawText.slice(0, 4000);
            const res = await scoreAccessibility(text, file.name);
            setResult(res);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    }, [file]);

    const handleReset = () => { setFile(null); setResult(null); setError(null); };

    if (isLoading) {
        return (
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-10">
                <Loader />
                <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-4">
                    Analysing document against WCAG 2.1…
                </p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-10 text-center">
                <div className="text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl p-6 max-w-lg mx-auto">
                    <p className="font-bold text-base mb-1">Analysis Failed</p>
                    <p className="text-sm">{error}</p>
                    <button onClick={handleReset} className="mt-4 px-4 py-2 bg-red-500 text-white text-sm font-semibold rounded-lg hover:bg-red-600 transition-colors">
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    if (result) {
        const wcag = result.standards[0];
        const criteria = wcag?.criteria ?? [];
        const passCount = criteria.filter(c => c.status === 'pass').length;
        const failCount = criteria.filter(c => c.status === 'fail').length;
        const warnCount = criteria.filter(c => c.status === 'warning').length;

        return (
            <div className="space-y-5">
                {/* Score overview */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
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
                                    { label: 'Passed',   value: passCount,              cls: 'text-emerald-600 dark:text-emerald-400' },
                                    { label: 'Failed',   value: failCount,              cls: 'text-red-600 dark:text-red-400' },
                                    { label: 'Warnings', value: warnCount,              cls: 'text-amber-600 dark:text-amber-400' },
                                    { label: 'Checked',  value: criteria.length,        cls: 'text-slate-600 dark:text-slate-300' },
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

                {/* Itemised criteria — issues first, then passes */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 space-y-2">
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

                <div className="text-center">
                    <button onClick={handleReset} className="px-5 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                        Check another document
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 md:p-10">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Accessibility Check</h2>
                <p className="mt-2 text-slate-600 dark:text-slate-400 max-w-xl mx-auto">
                    Upload a PDF to receive an itemised WCAG 2.1 compliance report. Each criterion is scored pass, fail, or warning with a specific fix recommendation.
                </p>
                <div className="flex flex-wrap justify-center gap-2 mt-3">
                    {['Level A', 'Level AA', 'WCAG 2.1'].map(s => (
                        <span key={s} className="text-xs px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border border-rose-100 dark:border-rose-800 font-medium">
                            {s}
                        </span>
                    ))}
                </div>
            </div>

            <div className="max-w-xl mx-auto">
                {!file ? (
                    <FileUploader
                        onFileChange={setFile}
                        acceptedFileType=".pdf,application/pdf"
                        fileTypeName="PDF Document"
                        icon={<PdfFileIcon className="w-12 h-12 mb-4 text-slate-400" />}
                    />
                ) : (
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-8 flex flex-col items-center border-2 border-dashed border-rose-400 dark:border-rose-600">
                        <PdfFileIcon className="w-12 h-12 mb-3 text-rose-500 dark:text-rose-400" />
                        <p className="font-semibold text-rose-600 dark:text-rose-400">Ready to analyse</p>
                        <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 text-center truncate w-full px-4">{file.name}</p>
                        <button onClick={() => setFile(null)} className="text-sm text-indigo-500 hover:underline mt-3">
                            Change file
                        </button>
                    </div>
                )}

                {file && (
                    <div className="text-center mt-6">
                        <button
                            onClick={handleScore}
                            className="bg-rose-600 text-white font-bold py-4 px-10 rounded-xl hover:bg-rose-700 focus:outline-none focus:ring-4 focus:ring-rose-300 dark:focus:ring-rose-800 transition-all shadow-lg"
                        >
                            Run Accessibility Check
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AccessibilityScorer;
