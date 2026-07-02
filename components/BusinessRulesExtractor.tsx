import React, { useState, useCallback } from 'react';
import * as mammoth from 'mammoth';
import { BusinessRule, BusinessRulesResult } from '../types';
import { extractBusinessRules } from '../services/llmService';
import FileUploader from './FileUploader';
import Loader from './Loader';

type RuleTypeFilter = 'All' | 'Validation' | 'Conditional' | 'Calculation' | 'Workflow';

const RULE_TYPE_COLORS: Record<string, string> = {
    Validation:  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    Conditional: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    Calculation: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    Workflow:    'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
};

const PRIORITY_COLORS: Record<string, string> = {
    High:   'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800',
    Medium: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800',
    Low:    'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600',
};

function htmlToText(html: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const lines: string[] = [];

    function walk(el: Element): void {
        const tag = el.tagName.toLowerCase();
        if (tag === 'table') {
            const rows = Array.from(el.querySelectorAll('tr'));
            for (const row of rows) {
                const cells = Array.from(row.querySelectorAll('td, th')).map(c => c.textContent?.trim() ?? '');
                if (cells.some(c => c)) lines.push(cells.join(' | '));
            }
            lines.push('');
            return;
        }
        if (['div', 'section', 'ul', 'ol', 'body'].includes(tag)) {
            for (const child of el.children) walk(child);
            return;
        }
        const text = el.textContent?.trim();
        if (text) lines.push(text);
    }

    walk(doc.body);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function extractDocxText(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    return htmlToText(result.value);
}

function downloadBlob(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function rulesToCsv(rules: BusinessRule[]): string {
    const header = ['Field Name', 'Rule Type', 'Condition', 'Action / Formula', 'Error Message', 'Dependent Fields', 'Priority'];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = rules.map(r => [
        r.fieldName, r.ruleType, r.condition, r.actionFormula,
        r.errorMessage, r.dependentFields, r.priority,
    ].map(escape).join(','));
    return [header.map(escape).join(','), ...rows].join('\n');
}

const FILTERS: RuleTypeFilter[] = ['All', 'Validation', 'Conditional', 'Calculation', 'Workflow'];

const BusinessRulesExtractor: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<BusinessRulesResult | null>(null);
    const [activeFilter, setActiveFilter] = useState<RuleTypeFilter>('All');

    const handleFileSelect = useCallback((f: File | null) => {
        if (f) {
            setFile(f);
            setResult(null);
            setError('');
            setActiveFilter('All');
        }
    }, []);

    const handleExtract = async () => {
        if (!file) return;
        setLoading(true);
        setError('');
        setResult(null);
        try {
            const text = await extractDocxText(file);
            if (!text.trim()) throw new Error('Could not extract text from the document. Ensure it is a valid DOCX file.');
            const data = await extractBusinessRules(text);
            setResult(data);
        } catch (err: any) {
            setError(err?.message ?? 'An unexpected error occurred.');
        } finally {
            setLoading(false);
        }
    };

    const visibleRules = result
        ? (activeFilter === 'All' ? result.rules : result.rules.filter(r => r.ruleType === activeFilter))
        : [];

    const countByType = (type: string) => result?.rules.filter(r => r.ruleType === type).length ?? 0;

    const baseName = file?.name.replace(/\.docx$/i, '') ?? 'business-rules';

    return (
        <div className="space-y-6">
            {/* Upload */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Upload Requirements Document</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                    Upload a DOCX file containing form specifications, BRDs, or requirements documents. All four rule types will be extracted automatically.
                </p>
                {!file ? (
                    <FileUploader
                        onFileChange={handleFileSelect}
                        acceptedFileType=".docx"
                        fileTypeName="DOCX Document"
                        icon={
                            <svg className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                            </svg>
                        }
                    />
                ) : (
                    <div className="flex items-center gap-3">
                        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 truncate">
                            <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                            </svg>
                            <span className="truncate">{file.name}</span>
                        </div>
                        <button onClick={() => { setFile(null); setResult(null); setError(''); }} className="text-xs text-indigo-500 hover:underline flex-shrink-0">Change</button>
                        <button
                            onClick={handleExtract}
                            disabled={loading}
                            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex-shrink-0"
                        >
                            {loading ? 'Extracting…' : 'Extract Rules'}
                        </button>
                    </div>
                )}
            </div>

            {loading && (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                    <Loader />
                    <p className="text-sm text-slate-500 dark:text-slate-400">Analysing document and extracting business rules…</p>
                </div>
            )}

            {error && (
                <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
                    {error}
                </div>
            )}

            {result && !loading && (
                <div className="space-y-5">
                    {/* Summary stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {[
                            { label: 'Total Rules', value: result.rules.length, color: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' },
                            { label: 'Validation', value: countByType('Validation'), color: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' },
                            { label: 'Conditional', value: countByType('Conditional'), color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' },
                            { label: 'Calculation', value: countByType('Calculation'), color: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300' },
                            { label: 'Workflow', value: countByType('Workflow'), color: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300' },
                        ].map(({ label, value, color }) => (
                            <div key={label} className={`rounded-xl p-4 text-center ${color}`}>
                                <div className="text-2xl font-bold">{value}</div>
                                <div className="text-xs font-medium mt-0.5 opacity-80">{label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Filter + Export bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex gap-1 flex-wrap">
                            {FILTERS.map(f => (
                                <button
                                    key={f}
                                    onClick={() => setActiveFilter(f)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                        activeFilter === f
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400'
                                    }`}
                                >
                                    {f}{f !== 'All' ? ` (${countByType(f)})` : ` (${result.rules.length})`}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => downloadBlob(rulesToCsv(result.rules), `${baseName}.csv`, 'text/csv')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                                CSV
                            </button>
                            <button
                                onClick={() => downloadBlob(JSON.stringify(result.rules, null, 2), `${baseName}.json`, 'application/json')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                                JSON
                            </button>
                        </div>
                    </div>

                    {/* Rules table */}
                    {visibleRules.length === 0 ? (
                        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">
                            No {activeFilter !== 'All' ? activeFilter.toLowerCase() : ''} rules found in this document.
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                            <table className="w-full text-sm min-w-[900px]">
                                <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                                    <tr>
                                        {['Field Name', 'Rule Type', 'Condition', 'Action / Formula', 'Error Message', 'Dependent Fields', 'Priority'].map(h => (
                                            <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                    {visibleRules.map((rule, i) => (
                                        <tr key={i} className="bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors align-top">
                                            <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                                {rule.fieldName}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${RULE_TYPE_COLORS[rule.ruleType] ?? ''}`}>
                                                    {rule.ruleType}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300 max-w-xs">
                                                {rule.condition || <span className="text-slate-300 dark:text-slate-600">—</span>}
                                            </td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300 max-w-xs">
                                                {rule.actionFormula || <span className="text-slate-300 dark:text-slate-600">—</span>}
                                            </td>
                                            <td className="px-4 py-3 text-slate-500 dark:text-slate-400 max-w-xs italic text-xs">
                                                {rule.errorMessage || <span className="text-slate-300 dark:text-slate-600 not-italic">—</span>}
                                            </td>
                                            <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                                                {rule.dependentFields || <span className="text-slate-300 dark:text-slate-600">—</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${PRIORITY_COLORS[rule.priority] ?? ''}`}>
                                                    {rule.priority}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default BusinessRulesExtractor;
