import React, { useState, useCallback } from 'react';
import { MockedXmlBundle, SyntheticDataResult } from '../types';
import { generateSyntheticDataFromXsd } from '../services/llmService';
import { generateMockedXmlsFromTestCases } from '../services/mockedXmlsService';
import ResultsTable from './ResultsTable';
import Loader from './Loader';
import { DocumentTextIcon } from './icons/DocumentTextIcon';
import { XmlFileIcon } from './icons/XmlFileIcon';
import FileUploader from './FileUploader';

// ── CSV parser (RFC-4180) ─────────────────────────────────────────────────────

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

type ParsedRow = Record<string, string>;

function parseCsv(raw: string): ParsedRow[] {
    const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = parseCsvRow(lines[0]);
    return lines.slice(1).map(line => {
        const cells = parseCsvRow(line);
        return Object.fromEntries(headers.map((h, idx) => [h, cells[idx] ?? '']));
    });
}

const TC_CSV_REQUIRED = ['Test Case ID', 'Field / Section', 'Category', 'Test Description', 'Input Data', 'Expected Result'];

function validateTestCasesCsv(rows: ParsedRow[]): string | null {
    if (rows.length === 0) return 'No data rows found in the CSV.';
    const keys = Object.keys(rows[0]);
    const missing = TC_CSV_REQUIRED.filter(h => !keys.includes(h));
    if (missing.length > 0) return `Missing columns: ${missing.join(', ')}. Upload a CSV exported from the Test Case Generator.`;
    return null;
}

function serializeTestCases(rows: ParsedRow[]): string {
    return rows.map(r => [
        `${r['Test Case ID']} | Field: ${r['Field / Section']} | Category: ${r['Category']}`,
        `  Description: ${r['Test Description']}`,
        `  Input Data: ${r['Input Data']}`,
        `  Expected Result: ${r['Expected Result']}`,
        `  Priority: ${r['Priority'] || 'Medium'}`,
    ].join('\n')).join('\n\n');
}

// ── XML field extractor (fallback) ────────────────────────────────────────────

function parseFieldsFromXml(xmlString: string): { field: string; value: string }[] {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlString, 'application/xml');
        const fields: { field: string; value: string }[] = [];
        const traverse = (node: Element) => {
            if (node.children.length === 0) {
                const value = node.textContent?.trim() || '';
                if (value) fields.push({ field: node.localName, value });
            } else {
                Array.from(node.children).forEach(traverse);
            }
        };
        if (doc.documentElement) traverse(doc.documentElement);
        return fields;
    } catch { return []; }
}

// ── Category badge colours ────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
    'Happy Path':  'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    'Mandatory':   'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    'Boundary':    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
    'Conditional': 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
    'Format':      'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    'Calculation': 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
};

// ── Bundle XML card ───────────────────────────────────────────────────────────

const BundleCard: React.FC<{
    bundle: MockedXmlBundle;
    index: number;
    total: number;
    testCaseRows: ParsedRow[];
}> = ({ bundle, index, total, testCaseRows }) => {
    const [expanded, setExpanded] = useState(true);

    const categoryOf = (id: string) => testCaseRows.find(r => r['Test Case ID'] === id)?.['Category'] ?? '';

    const handleDownload = () => {
        const blob = new Blob([bundle.xmlContent], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `xml-bundle-${index + 1}.xml`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <div className="bg-slate-50 dark:bg-slate-700/50 px-5 py-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                        Bundle {index + 1} of {total}
                    </span>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 mt-1 mb-3">{bundle.description}</p>
                    <div className="flex flex-wrap gap-1.5">
                        {bundle.testCaseIds.map(id => {
                            const cat = categoryOf(id);
                            const cls = CATEGORY_COLORS[cat] ?? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300';
                            return (
                                <span key={id} title={cat || id} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
                                    {id}
                                </span>
                            );
                        })}
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button onClick={handleDownload} className="text-xs bg-indigo-600 text-white font-medium py-1.5 px-3 rounded-lg hover:bg-indigo-700 transition-colors">
                        Download XML
                    </button>
                    <button
                        onClick={() => setExpanded(v => !v)}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-medium py-1.5 px-3 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                    >
                        {expanded ? 'Collapse' : 'Expand'}
                    </button>
                </div>
            </div>
            {expanded && (
                <pre className="w-full max-h-72 overflow-auto bg-slate-900 dark:bg-slate-950 p-4 text-xs font-mono text-green-300 leading-relaxed scrollbar-thin">
                    {bundle.xmlContent}
                </pre>
            )}
        </div>
    );
};

// ── Main component ────────────────────────────────────────────────────────────

const SyntheticDataGenerator: React.FC = () => {
    const [xsdFile, setXsdFile] = useState<File | null>(null);
    const [testCasesCsvFile, setTestCasesCsvFile] = useState<File | null>(null);

    const [extractedData, setExtractedData] = useState<{ field: string; value: string }[] | null>(null);
    const [generatedXml, setGeneratedXml] = useState<string | null>(null);
    const [xmlBundles, setXmlBundles] = useState<MockedXmlBundle[] | null>(null);
    const [testCaseRows, setTestCaseRows] = useState<ParsedRow[]>([]);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fileToString = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsText(file);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
        });

    const handleProcess = useCallback(async () => {
        if (!xsdFile) { setError('Please select an XSD file.'); return; }

        setIsLoading(true);
        setError(null);
        setExtractedData(null);
        setGeneratedXml(null);
        setXmlBundles(null);
        setTestCaseRows([]);

        try {
            const xsdContent = await fileToString(xsdFile);

            if (testCasesCsvFile) {
                const csvRaw = await fileToString(testCasesCsvFile);
                const rows = parseCsv(csvRaw);
                const validationError = validateTestCasesCsv(rows);
                if (validationError) { setError(validationError); return; }

                const testCasesText = serializeTestCases(rows);
                const result = await generateMockedXmlsFromTestCases(xsdContent, testCasesText);
                setTestCaseRows(rows);
                setXmlBundles(result.xmlBundles);
            } else {
                const result: SyntheticDataResult = await generateSyntheticDataFromXsd(xsdContent);
                let fields = Array.isArray(result.fields) ? result.fields : [];
                if (fields.length === 0 && result.generatedXml) fields = parseFieldsFromXml(result.generatedXml);
                setExtractedData(fields);
                setGeneratedXml(result.generatedXml || null);
            }
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    }, [xsdFile, testCasesCsvFile]);

    const handleReset = () => {
        setXsdFile(null);
        setTestCasesCsvFile(null);
        setExtractedData(null);
        setGeneratedXml(null);
        setXmlBundles(null);
        setTestCaseRows([]);
        setError(null);
        setIsLoading(false);
    };

    const handleDownloadXml = () => {
        if (!generatedXml) return;
        const blob = new Blob([generatedXml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'synthetic_data.xml';
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleDownloadCsv = () => {
        if (!extractedData) return;
        const rows = [
            'Field,Synthetic Value',
            ...extractedData.map(r => `"${r.field.replace(/"/g, '""')}","${r.value.replace(/"/g, '""')}"`)
        ];
        const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'synthetic_data.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    const hasResults = extractedData !== null || xmlBundles !== null;
    const isBundleMode = !!testCasesCsvFile;
    const coveredCount = xmlBundles ? new Set(xmlBundles.flatMap(b => b.testCaseIds)).size : 0;

    const resultHeaders = [
        { key: 'field', label: 'Field / Element', className: 'w-1/2' },
        { key: 'value', label: 'Generated Synthetic Value' },
    ];

    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 md:p-10 transition-all duration-300">
            <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center justify-center gap-3">
                    <DocumentTextIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                    Synthetic Data Generation
                </h2>
                <p className="mt-2 text-slate-600 dark:text-slate-400">
                    Upload an XSD schema to generate synthetic XML data. Optionally add a test cases CSV to generate grouped XML bundles covering each test case.
                </p>
            </div>

            {/* ── Upload section ── */}
            {!hasResults && !isLoading && (
                <div className="max-w-2xl mx-auto space-y-6">
                    {/* Step 1: XSD */}
                    <div>
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                            1. Upload XML Schema (XSD) <span className="text-red-500">*</span>
                        </h3>
                        {!xsdFile ? (
                            <FileUploader
                                onFileChange={setXsdFile}
                                acceptedFileType='.xsd'
                                fileTypeName='XSD Schema'
                                icon={<XmlFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />}
                            />
                        ) : (
                            <div className="bg-slate-100 dark:bg-slate-700 p-6 rounded-lg flex flex-col items-center border-2 border-dashed border-green-500">
                                <XmlFileIcon className="w-10 h-10 mb-2 text-green-600 dark:text-green-400" />
                                <p className="font-semibold text-green-600 dark:text-green-400">XSD Ready</p>
                                <p className="text-sm truncate w-full px-4 text-center mt-1 text-slate-600 dark:text-slate-300">{xsdFile.name}</p>
                                <button onClick={() => setXsdFile(null)} className="text-sm text-indigo-500 hover:underline mt-3">Change File</button>
                            </div>
                        )}
                    </div>

                    {/* Step 2: Test Cases CSV (optional) */}
                    <div>
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            2. Upload Test Cases CSV{' '}
                            <span className="text-slate-400 font-normal">(optional — from Test Case Generator)</span>
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                            When provided, generates grouped XML bundles — one per scenario — each tagged with the test case IDs it covers.
                        </p>
                        {!testCasesCsvFile ? (
                            <FileUploader
                                onFileChange={setTestCasesCsvFile}
                                acceptedFileType='.csv'
                                fileTypeName='Test Cases CSV'
                                icon={<DocumentTextIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />}
                            />
                        ) : (
                            <div className="bg-slate-100 dark:bg-slate-700 p-6 rounded-lg flex flex-col items-center border-2 border-dashed border-indigo-400">
                                <DocumentTextIcon className="w-10 h-10 mb-2 text-indigo-500 dark:text-indigo-400" />
                                <p className="font-semibold text-indigo-600 dark:text-indigo-400">Test Cases CSV Ready</p>
                                <p className="text-sm truncate w-full px-4 text-center mt-1 text-slate-600 dark:text-slate-300">{testCasesCsvFile.name}</p>
                                <button onClick={() => setTestCasesCsvFile(null)} className="text-sm text-indigo-500 hover:underline mt-3">Remove</button>
                            </div>
                        )}
                    </div>

                    {xsdFile && (
                        <div className="text-center pt-2">
                            <button
                                onClick={handleProcess}
                                className="bg-indigo-600 text-white font-bold py-4 px-10 rounded-xl hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-300 dark:focus:ring-indigo-800 transition-all duration-300 transform hover:scale-105 shadow-lg"
                            >
                                {isBundleMode ? 'Generate XML Bundles' : 'Generate Synthetic XML'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {isLoading && <Loader />}

            {error && (
                <div className="text-center text-red-500 dark:text-red-400 bg-red-100 dark:bg-red-900/20 p-4 rounded-lg">
                    <p className="font-bold">An Error Occurred</p>
                    <p>{error}</p>
                    <button onClick={handleReset} className="mt-4 bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 transition-colors">
                        Try Again
                    </button>
                </div>
            )}

            {/* ── Bundle mode results ── */}
            {xmlBundles && xmlBundles.length > 0 && (
                <div>
                    <div className="mb-5 bg-slate-100 dark:bg-slate-700 p-4 rounded-lg flex flex-col md:flex-row justify-between items-center gap-4">
                        <div>
                            <h3 className="font-bold text-lg text-slate-800 dark:text-white">Generation Summary</h3>
                            <p className="text-slate-600 dark:text-slate-300 text-sm">
                                Generated{' '}
                                <span className="font-bold text-indigo-600 dark:text-indigo-400">{xmlBundles.length}</span>{' '}
                                XML bundle{xmlBundles.length !== 1 ? 's' : ''} covering{' '}
                                <span className="font-bold text-indigo-600 dark:text-indigo-400">{coveredCount}</span>{' '}
                                test case{coveredCount !== 1 ? 's' : ''}
                            </p>
                        </div>
                        <button onClick={handleReset} className="bg-slate-200 text-slate-700 font-semibold py-2 px-4 rounded-lg hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500 transition-colors text-sm">
                            Reset / Start Over
                        </button>
                    </div>

                    {/* Badge legend */}
                    <div className="mb-4 flex flex-wrap gap-2 items-center">
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Category colours:</span>
                        {Object.entries(CATEGORY_COLORS).map(([cat, cls]) => (
                            <span key={cat} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{cat}</span>
                        ))}
                    </div>

                    <div className="space-y-4">
                        {xmlBundles.map((bundle, idx) => (
                            <BundleCard key={idx} bundle={bundle} index={idx} total={xmlBundles.length} testCaseRows={testCaseRows} />
                        ))}
                    </div>

                    <div className="text-center mt-8">
                        <button onClick={handleReset} className="bg-slate-200 text-slate-700 font-bold py-3 px-6 rounded-lg hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500 transition-all duration-300">
                            Reset / Start Over
                        </button>
                    </div>
                </div>
            )}

            {/* ── Single XML mode results ── */}
            {extractedData && extractedData.length > 0 && (
                <div>
                    <div className="mb-6 bg-slate-100 dark:bg-slate-700 p-4 rounded-lg flex flex-col md:flex-row justify-between items-center gap-4">
                        <div>
                            <h3 className="font-bold text-lg text-slate-800 dark:text-white">Generation Summary</h3>
                            <p className="text-slate-600 dark:text-slate-300 text-sm">
                                Generated synthetic data for{' '}
                                <span className="font-bold text-indigo-600 dark:text-indigo-400">{extractedData.length}</span>{' '}
                                elements/attributes from the schema.
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleDownloadCsv} className="bg-white dark:bg-slate-800 text-slate-700 dark:text-white border border-slate-300 dark:border-slate-600 font-medium py-2 px-4 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm">
                                Download CSV
                            </button>
                            {generatedXml && (
                                <button onClick={handleDownloadXml} className="bg-indigo-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-indigo-700 transition-colors text-sm">
                                    Download XML
                                </button>
                            )}
                        </div>
                    </div>

                    <ResultsTable data={extractedData} headers={resultHeaders} title="Extraction Results" />

                    {generatedXml && (
                        <div className="mt-6">
                            <h3 className="text-lg font-bold mb-2 text-slate-900 dark:text-white">Generated XML Preview</h3>
                            <pre className="w-full h-64 overflow-auto bg-slate-50 dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-300 scrollbar-thin">
                                {generatedXml}
                            </pre>
                        </div>
                    )}

                    <div className="text-center mt-8">
                        <button onClick={handleReset} className="bg-slate-200 text-slate-700 font-bold py-3 px-6 rounded-lg hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500 transition-all duration-300">
                            Reset / Start Over
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SyntheticDataGenerator;
