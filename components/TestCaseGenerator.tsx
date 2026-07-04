import React, { useState } from 'react';
import { generateTestCases } from '../services/llmService';
import type { TestCase } from '../types';
import FileUploader from './FileUploader';
import Loader from './Loader';
import TestCaseIcon from './icons/TestCaseIcon';

// ── CSV parser ──────────────────────────────────────────────────────────────
// Handles double-quoted fields with embedded commas and "" escaped quotes.

function parseCsvRow(line: string): string[] {
    const cells: string[] = [];
    let i = 0;
    while (i <= line.length) {
        if (line[i] === '"') {
            i++;
            let cell = '';
            while (i < line.length) {
                if (line[i] === '"' && line[i + 1] === '"') { cell += '"'; i += 2; }
                else if (line[i] === '"') { i++; break; }
                else { cell += line[i++]; }
            }
            cells.push(cell);
            if (line[i] === ',') i++;
        } else {
            const end = line.indexOf(',', i);
            if (end === -1) { cells.push(line.slice(i)); break; }
            cells.push(line.slice(i, end));
            i = end + 1;
        }
    }
    return cells;
}

type ParsedRule = Record<string, string>;

function parseCsv(raw: string): ParsedRule[] {
    const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = parseCsvRow(lines[0]);
    return lines.slice(1).map(line => {
        const cells = parseCsvRow(line);
        return Object.fromEntries(headers.map((h, idx) => [h, cells[idx] ?? '']));
    });
}

const EXPECTED_HEADERS = ['Field Name', 'Rule Type'];

function validateCsv(rules: ParsedRule[]): string | null {
    if (rules.length === 0) return 'No data rows found in the CSV.';
    const keys = Object.keys(rules[0]);
    const missing = EXPECTED_HEADERS.filter(h => !keys.includes(h));
    if (missing.length > 0) return `Missing columns: ${missing.join(', ')}. Upload a CSV exported from the Business Rules Extractor.`;
    return null;
}

// ── Rule serialiser for LLM prompt ─────────────────────────────────────────

function serializeRules(rules: ParsedRule[]): string {
    return rules.map((r, i) => {
        const parts = [
            `Rule ${i + 1}:`,
            `  Field: ${r['Field Name'] || '(unnamed)'}`,
            `  Type: ${r['Rule Type'] || '(unknown)'}`,
        ];
        const src = r['Source Reference'];
        if (src && src !== '—') parts.push(`  Source excerpt: "${src}"`);
        if (r['Condition']) parts.push(`  Condition: ${r['Condition']}`);
        if (r['Action / Formula']) parts.push(`  Action/Formula: ${r['Action / Formula']}`);
        if (r['Error Message']) parts.push(`  Error Message: ${r['Error Message']}`);
        if (r['Dependent Fields']) parts.push(`  Dependent Fields: ${r['Dependent Fields']}`);
        parts.push(`  Priority: ${r['Priority'] || 'Medium'}`);
        return parts.join('\n');
    }).join('\n\n');
}

// ── Colours ──────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
    'Happy Path':  'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    'Mandatory':   'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    'Boundary':    'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    'Conditional': 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    'Format':      'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
    'Calculation': 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
};

const PRIORITY_COLORS: Record<string, string> = {
    High:   'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800',
    Medium: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800',
    Low:    'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600',
};

const RULE_TYPE_CHIP: Record<string, string> = {
    Validation:   'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    Conditional:  'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    Calculation:  'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    Presentation: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
};

const CATEGORIES = ['All', 'Happy Path', 'Mandatory', 'Boundary', 'Conditional', 'Format', 'Calculation'] as const;
type FilterCategory = typeof CATEGORIES[number];

// ── IndexedTestCase ──────────────────────────────────────────────────────────

interface IndexedTestCase extends TestCase { id: string; }

// ── Export helpers ───────────────────────────────────────────────────────────

function downloadBlob(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.visibility = 'hidden';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
}

function toCsv(cases: IndexedTestCase[]): string {
    // safe() coerces any runtime value (including arrays returned by some LLMs) to a string
    const safe = (v: unknown): string =>
        v == null ? '' : Array.isArray(v) ? (v as unknown[]).map(String).join(' → ') : String(v);
    const esc = (v: unknown) => `"${safe(v).replace(/"/g, '""').replace(/\n/g, ' → ')}"`;
    const header = ['Test Case ID', 'Field / Section', 'Category', 'Test Description', 'Input Data', 'Expected Result', 'Priority', 'Preconditions', 'Test Steps'];
    const rows = cases.map(tc => [
        tc.id, tc.fieldSection, tc.category, tc.testDescription,
        tc.inputData, tc.expectedResult, tc.priority, tc.preconditions, tc.testSteps,
    ].map(esc).join(','));
    return [header.map(esc).join(','), ...rows].join('\n');
}

// ── Component ────────────────────────────────────────────────────────────────

const TestCaseGenerator: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [rules, setRules] = useState<ParsedRule[]>([]);
    const [parseError, setParseError] = useState('');
    const [hints, setHints] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [cases, setCases] = useState<IndexedTestCase[]>([]);
    const [activeFilter, setActiveFilter] = useState<FilterCategory>('All');

    const handleFileChange = async (f: File | null) => {
        setFile(f);
        setCases([]);
        setError('');
        setParseError('');
        setRules([]);
        setActiveFilter('All');
        if (!f) return;
        try {
            const text = await f.text();
            const parsed = parseCsv(text);
            const validationError = validateCsv(parsed);
            if (validationError) { setParseError(validationError); return; }
            setRules(parsed);
        } catch {
            setParseError('Failed to read the CSV file. Make sure it is a valid UTF-8 text file.');
        }
    };

    const handleGenerate = async () => {
        if (!rules.length) return;
        setLoading(true);
        setError('');
        setCases([]);
        setActiveFilter('All');
        try {
            const rulesText = serializeRules(rules);
            const hintsText = hints.trim() || 'None provided.';
            const combined = `--- BUSINESS RULES ---\n\n${rulesText}\n\n--- ADDITIONAL HINTS / TESTING CONTEXT ---\n\n${hintsText}`;
            const result = await generateTestCases(combined);
            const indexed: IndexedTestCase[] = result.testCases.map((tc, i) => ({
                ...tc,
                id: `TC-${String(i + 1).padStart(3, '0')}`,
            }));
            setCases(indexed);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to generate test cases. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const countFor = (cat: string) => cases.filter(tc => tc.category === cat).length;
    const visible = activeFilter === 'All' ? cases : cases.filter(tc => tc.category === activeFilter);
    const baseName = file?.name.replace(/\.csv$/i, '') ?? 'test-cases';

    const ruleTypeSummary = (() => {
        const counts: Record<string, number> = {};
        rules.forEach(r => { const t = r['Rule Type'] || 'Unknown'; counts[t] = (counts[t] || 0) + 1; });
        return Object.entries(counts);
    })();

    return (
        <div className="space-y-6">

            {/* ── Upload ── */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Upload Business Rules CSV</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                    Export a CSV from the Business Rules Extractor and upload it here. Rules are parsed instantly — no upload to any server.
                </p>

                {!file ? (
                    <FileUploader
                        onFileChange={handleFileChange}
                        acceptedFileType=".csv"
                        fileTypeName="CSV File"
                        icon={
                            <svg className="w-12 h-12 mb-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                            </svg>
                        }
                    />
                ) : (
                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 min-w-0">
                                <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                </svg>
                                <span className="truncate font-medium">{file.name}</span>
                            </div>
                            <button
                                onClick={() => { setFile(null); setRules([]); setParseError(''); setCases([]); setError(''); }}
                                className="text-xs text-indigo-500 hover:underline flex-shrink-0"
                            >
                                Change
                            </button>
                        </div>

                        {parseError ? (
                            <p className="text-xs text-red-600 dark:text-red-400">{parseError}</p>
                        ) : rules.length > 0 && (
                            <div className="flex flex-wrap items-center gap-3">
                                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    {rules.length} rule{rules.length !== 1 ? 's' : ''} loaded
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                    {ruleTypeSummary.map(([type, count]) => (
                                        <span
                                            key={type}
                                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${RULE_TYPE_CHIP[type] ?? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
                                        >
                                            {type} ({count})
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── Hints ── */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Additional Testing Context</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Optional — add domain constraints, boundary values, or edge cases to generate extra test cases beyond the rules.
                        </p>
                    </div>
                    <span className="flex-shrink-0 text-xs text-slate-400 dark:text-slate-500 mt-0.5">Optional</span>
                </div>
                <textarea
                    value={hints}
                    onChange={e => setHints(e.target.value)}
                    rows={4}
                    placeholder={`Examples:\n• State values are only NY, NJ, DC\n• Claim amount must not exceed $50,000\n• Dates must fall within the current calendar year\n• Email must use a company domain`}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
            </div>

            {/* ── Generate button ── */}
            <button
                onClick={handleGenerate}
                disabled={rules.length === 0 || loading}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
            >
                {loading ? 'Generating…' : `Generate Test Suite${rules.length > 0 ? ` from ${rules.length} rules` : ''}`}
            </button>

            {/* ── Loading ── */}
            {loading && (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                    <Loader />
                    <p className="text-sm text-slate-500 dark:text-slate-400">Generating test cases from business rules…</p>
                </div>
            )}

            {/* ── Error ── */}
            {error && (
                <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
                    {error}
                </div>
            )}

            {/* ── Results ── */}
            {cases.length > 0 && !loading && (
                <div className="space-y-5">

                    {/* Summary stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
                        {[
                            { label: 'Total Tests',  value: cases.length,           color: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' },
                            { label: 'Happy Path',   value: countFor('Happy Path'),  color: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' },
                            { label: 'Mandatory',    value: countFor('Mandatory'),   color: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' },
                            { label: 'Boundary',     value: countFor('Boundary'),    color: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300' },
                            { label: 'Conditional',  value: countFor('Conditional'), color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' },
                            { label: 'Format',       value: countFor('Format'),      color: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300' },
                            { label: 'Calculation',  value: countFor('Calculation'), color: 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300' },
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
                            {CATEGORIES.map(cat => {
                                const cnt = cat === 'All' ? cases.length : countFor(cat);
                                return (
                                    <button
                                        key={cat}
                                        onClick={() => setActiveFilter(cat)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                            activeFilter === cat
                                                ? 'bg-indigo-600 text-white'
                                                : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400'
                                        }`}
                                    >
                                        {cat} ({cnt})
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => downloadBlob(toCsv(cases), `${baseName}-test-cases.csv`, 'text/csv')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                                CSV
                            </button>
                            <button
                                onClick={() => downloadBlob(JSON.stringify({ testCases: cases }, null, 2), `${baseName}-test-cases.json`, 'application/json')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                                JSON
                            </button>
                        </div>
                    </div>

                    {/* Table */}
                    {visible.length === 0 ? (
                        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">
                            No {activeFilter !== 'All' ? activeFilter.toLowerCase() : ''} test cases found.
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                            <table className="w-full text-sm min-w-[1300px]">
                                <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                                    <tr>
                                        {['ID', 'Field / Section', 'Category', 'Test Description', 'Input Data', 'Expected Result', 'Priority', 'Preconditions'].map(h => (
                                            <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                    {visible.map(tc => (
                                        <tr key={tc.id} className="bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors align-top">
                                            <td className="px-4 py-3 font-mono text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">{tc.id}</td>
                                            <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap max-w-[160px]">
                                                <span className="block truncate" title={tc.fieldSection}>{tc.fieldSection}</span>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${CATEGORY_COLORS[tc.category] ?? 'bg-slate-100 text-slate-700'}`}>
                                                    {tc.category}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-slate-700 dark:text-slate-300 max-w-[220px]">
                                                <span className="line-clamp-2" title={tc.testDescription}>{tc.testDescription}</span>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400 max-w-[140px]">
                                                <span className="line-clamp-2" title={tc.inputData}>{tc.inputData}</span>
                                            </td>
                                            <td className="px-4 py-3 text-slate-700 dark:text-slate-300 max-w-[200px]">
                                                <span className="line-clamp-2" title={tc.expectedResult}>{tc.expectedResult}</span>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${PRIORITY_COLORS[tc.priority] ?? ''}`}>
                                                    {tc.priority}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 max-w-[150px]">
                                                <span className="line-clamp-2" title={tc.preconditions}>{tc.preconditions}</span>
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

export default TestCaseGenerator;
