import React, { useState } from 'react';
import FileUploader from './FileUploader';
import * as llmService from '../services/llmService';
import { TemplateAnalysisResult, RegulationCheck } from '../types';

async function extractTextFromPdf(file: File): Promise<string> {
    const pdfjsLib = (window as any).pdfjsLib;
    if (!pdfjsLib) throw new Error('PDF.js not loaded');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(' ') + '\n';
    }
    return text;
}

async function extractTextFromDocx(file: File): Promise<string> {
    const mammoth = (window as any).mammoth;
    if (mammoth) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        return result.value;
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target?.result as string || '');
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

async function extractText(file: File): Promise<string> {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return extractTextFromPdf(file);
    return extractTextFromDocx(file);
}

function gradeColor(grade: string) {
    if (grade === 'A') return 'text-green-600 dark:text-green-400';
    if (grade === 'B') return 'text-blue-600 dark:text-blue-400';
    if (grade === 'C') return 'text-amber-600 dark:text-amber-400';
    if (grade === 'D') return 'text-orange-600 dark:text-orange-400';
    return 'text-red-600 dark:text-red-400';
}

function ScoreBar({ score }: { score: number }) {
    const color = score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-amber-400' : score >= 40 ? 'bg-orange-500' : 'bg-red-500';
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
            </div>
            <span className="text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300 w-8 text-right">{score}</span>
        </div>
    );
}

function regulationStatusBadge(status: RegulationCheck['status']) {
    const map: Record<string, string> = {
        compliant:        'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
        partial:          'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
        'non-compliant':  'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
        'not-applicable': 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
    };
    const label: Record<string, string> = { compliant: 'Compliant', partial: 'Partial', 'non-compliant': 'Non-Compliant', 'not-applicable': 'N/A' };
    return (
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${map[status] ?? map['not-applicable']}`}>
            {label[status] ?? status}
        </span>
    );
}

function SentimentBadge({ s }: { s: string }) {
    if (s === 'positive') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">Positive</span>;
    if (s === 'negative') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">Negative</span>;
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Neutral</span>;
}

interface FileStatus { file: File; status: 'pending' | 'processing' | 'done' | 'error'; error?: string; }
type TabId = 'overview' | 'completeness' | 'regulations' | 'sentiment';

const ResultCard: React.FC<{ result: TemplateAnalysisResult }> = ({ result }) => {
    const [tab, setTab] = useState<TabId>('overview');
    const tabs: { id: TabId; label: string }[] = [
        { id: 'overview', label: 'Overview' },
        { id: 'completeness', label: 'Completeness' },
        { id: 'regulations', label: `Regulations (${result.regulations.length})` },
        { id: 'sentiment', label: 'Sentiment' },
    ];

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate" title={result.documentName}>{result.documentName}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{result.documentType} · {result.industry}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-center">
                        <div className={`text-3xl font-black ${gradeColor(result.grade)}`}>{result.grade}</div>
                        <div className="text-xs text-slate-400 mt-0.5">Grade</div>
                    </div>
                    <div className="text-center">
                        <div className="text-3xl font-black text-slate-700 dark:text-slate-200 tabular-nums">{result.overallScore}</div>
                        <div className="text-xs text-slate-400 mt-0.5">Score</div>
                    </div>
                </div>
            </div>

            <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                <div><span className="text-slate-400 font-medium">Purpose: </span><span className="text-slate-700 dark:text-slate-300">{result.purpose}</span></div>
                <div><span className="text-slate-400 font-medium">Audience: </span><span className="text-slate-700 dark:text-slate-300">{result.targetAudience}</span></div>
                <div><span className="text-slate-400 font-medium">Channel: </span><span className="text-slate-700 dark:text-slate-300">{result.channel}</span></div>
                {result.criticalIssues.length > 0 && (
                    <div className="col-span-2 flex items-center gap-1.5 text-red-600 dark:text-red-400 font-semibold">
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" clipRule="evenodd" /></svg>
                        {result.criticalIssues.length} critical issue{result.criticalIssues.length > 1 ? 's' : ''} found
                    </div>
                )}
            </div>

            <div className="flex gap-0 border-b border-slate-200 dark:border-slate-700 px-2">
                {tabs.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                        className={`px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${tab === t.id ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="p-5">
                {tab === 'overview' && (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{result.summary}</p>
                        {result.criticalIssues.length > 0 && (
                            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3">
                                <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-2 uppercase tracking-wide">Critical Issues</p>
                                <ul className="space-y-1">
                                    {result.criticalIssues.map((issue, i) => (
                                        <li key={i} className="text-xs text-red-700 dark:text-red-300 flex gap-2"><span className="mt-0.5 flex-shrink-0">•</span>{issue}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <div>
                            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Key Findings</p>
                            <ul className="space-y-1.5">
                                {result.keyFindings.map((f, i) => (
                                    <li key={i} className="text-sm text-slate-600 dark:text-slate-300 flex gap-2"><span className="mt-0.5 text-indigo-400 flex-shrink-0">→</span>{f}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}
                {tab === 'completeness' && (
                    <div className="space-y-4">
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Completeness Score</p>
                                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{result.completeness.score}/100</span>
                            </div>
                            <ScoreBar score={result.completeness.score} />
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide mb-2">Present ({result.completeness.presentElements.length})</p>
                                <ul className="space-y-1">
                                    {result.completeness.presentElements.map((el, i) => (
                                        <li key={i} className="text-xs text-slate-600 dark:text-slate-300 flex gap-1.5 items-start"><span className="text-green-500 flex-shrink-0 mt-0.5">✓</span>{el}</li>
                                    ))}
                                </ul>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2">Missing ({result.completeness.missingElements.length})</p>
                                <ul className="space-y-1">
                                    {result.completeness.missingElements.length === 0
                                        ? <li className="text-xs text-slate-400">None identified</li>
                                        : result.completeness.missingElements.map((el, i) => (
                                            <li key={i} className="text-xs text-slate-600 dark:text-slate-300 flex gap-1.5 items-start"><span className="text-red-400 flex-shrink-0 mt-0.5">✗</span>{el}</li>
                                        ))}
                                </ul>
                            </div>
                        </div>
                        {result.completeness.recommendations.length > 0 && (
                            <div>
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Recommendations</p>
                                <ul className="space-y-1">
                                    {result.completeness.recommendations.map((r, i) => (
                                        <li key={i} className="text-xs text-slate-600 dark:text-slate-300 flex gap-1.5"><span className="text-amber-400 flex-shrink-0 mt-0.5">→</span>{r}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
                {tab === 'regulations' && (
                    <div className="space-y-3">
                        {result.regulations.map((reg, i) => (
                            <div key={i} className="border border-slate-200 dark:border-slate-600 rounded-lg p-3">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{reg.name}</span>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        {regulationStatusBadge(reg.status)}
                                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">{reg.accuracyScore}%</span>
                                    </div>
                                </div>
                                <ScoreBar score={reg.accuracyScore} />
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{reg.findings}</p>
                                {reg.recommendation && reg.status !== 'compliant' && (
                                    <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1.5 flex gap-1.5"><span className="flex-shrink-0">→</span>{reg.recommendation}</p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                {tab === 'sentiment' && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Overall Sentiment</span>
                            <SentimentBadge s={result.sentiment.overall} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Tone</p>
                                <p className="text-sm text-slate-700 dark:text-slate-300">{result.sentiment.tone}</p>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Complexity</p>
                                <p className="text-sm text-slate-700 dark:text-slate-300 capitalize">{result.sentiment.complexity}</p>
                            </div>
                        </div>
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Readability Score</p>
                                <span className="text-xs text-slate-500 dark:text-slate-400">{result.sentiment.readabilityGrade}</span>
                            </div>
                            <ScoreBar score={result.sentiment.readabilityScore} />
                        </div>
                        {result.sentiment.keyEmotions.length > 0 && (
                            <div>
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Key Emotions Conveyed</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {result.sentiment.keyEmotions.map((e, i) => (
                                        <span key={i} className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">{e}</span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const TemplateAnalyser: React.FC = () => {
    const [files, setFiles] = useState<File[]>([]);
    const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
    const [results, setResults] = useState<TemplateAnalysisResult[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState('');

    const handleFilesChange = (newFiles: File[]) => {
        setFiles(newFiles);
        setFileStatuses(newFiles.map(f => ({ file: f, status: 'pending' as const })));
        setResults([]);
        setError('');
    };

    const handleProcess = async () => {
        if (files.length === 0) return;
        setIsProcessing(true);
        setError('');
        setResults([]);
        const newResults: TemplateAnalysisResult[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setFileStatuses(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'processing' as const } : s));
            try {
                const text = await extractText(file);
                const result = await llmService.analyseTemplate(text, file.name);
                newResults.push(result);
                setFileStatuses(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'done' as const } : s));
                setResults([...newResults]);
            } catch (e: any) {
                setFileStatuses(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'error' as const, error: e.message } : s));
            }
        }
        setIsProcessing(false);
    };

    const handleExportCsv = () => {
        const rows = [
            ['Document Name', 'Type', 'Industry', 'Purpose', 'Channel', 'Overall Score', 'Grade',
             'Completeness Score', 'Sentiment', 'Tone', 'Readability Score', 'Readability Grade',
             'Critical Issues', 'Key Findings'].join(','),
            ...results.map(r => [
                `"${r.documentName}"`, `"${r.documentType}"`, `"${r.industry}"`,
                `"${r.purpose}"`, `"${r.channel}"`, r.overallScore, r.grade,
                r.completeness.score, `"${r.sentiment.overall}"`, `"${r.sentiment.tone}"`,
                r.sentiment.readabilityScore, `"${r.sentiment.readabilityGrade}"`,
                `"${r.criticalIssues.join('; ')}"`, `"${r.keyFindings.join('; ')}"`,
            ].join(',')),
        ];
        const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'template-analysis.csv'; a.click();
        URL.revokeObjectURL(url);
    };

    const StatusIcon = ({ s }: { s: FileStatus['status'] }) => {
        if (s === 'processing') return <svg className="w-4 h-4 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>;
        if (s === 'done') return <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd"/></svg>;
        if (s === 'error') return <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/></svg>;
        return <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><circle cx="12" cy="12" r="9"/></svg>;
    };

    return (
        <div className="space-y-6 max-w-4xl">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Upload Documents</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                    Upload one or more PDFs or Word documents. Each document is analysed independently for type, industry, completeness, regulatory compliance, and sentiment.
                </p>
                <FileUploader
                    onFilesChange={handleFilesChange}
                    accept=".pdf,.doc,.docx"
                    label="Drop PDFs or Word documents here"
                    multiple={true}
                />
                {files.length > 0 && (
                    <div className="mt-3 space-y-1">
                        {fileStatuses.map((fs, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 px-1">
                                <StatusIcon s={fs.status} />
                                <span className="flex-1 truncate">{fs.file.name}</span>
                                {fs.status === 'error' && <span className="text-red-500 text-xs">{fs.error}</span>}
                            </div>
                        ))}
                    </div>
                )}
                <div className="mt-4 flex items-center gap-3">
                    <button
                        onClick={handleProcess}
                        disabled={files.length === 0 || isProcessing}
                        className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
                    >
                        {isProcessing && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
                        {isProcessing ? 'Analysing…' : `Analyse ${files.length > 0 ? `${files.length} Document${files.length > 1 ? 's' : ''}` : 'Documents'}`}
                    </button>
                    {results.length > 0 && (
                        <button onClick={handleExportCsv} className="px-4 py-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                            Export CSV
                        </button>
                    )}
                </div>
            </div>

            {error && (
                <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">{error}</div>
            )}

            {results.length > 0 && (
                <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        Analysis Results <span className="text-slate-400 font-normal">({results.length} document{results.length > 1 ? 's' : ''})</span>
                    </h3>
                    {results.map((result, i) => <ResultCard key={i} result={result} />)}
                </div>
            )}
        </div>
    );
};

export default TemplateAnalyser;
