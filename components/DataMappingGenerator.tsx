
import React, { useState, useCallback } from 'react';
import * as mammoth from 'mammoth';
import { DataMapping, DataMappingResult, ConsolidatedDataMapping } from '../types';
import { generateDataMap } from '../services/llmService';
import FileUploader from './FileUploader';
import Loader from './Loader';
import { WordFileIcon } from './icons/WordFileIcon';
import { XmlFileIcon } from './icons/XmlFileIcon';

// ── Types ────────────────────────────────────────────────────────────────────

interface FileProgress {
  name: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  fieldCount: number;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fileToString(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  if (file.name.toLowerCase().endsWith('.docx')) {
    try {
      // Use HTML conversion so table structure (rows/cells) is preserved for the LLM
      const result = await mammoth.convertToHtml({ arrayBuffer });
      return result.value;
    } catch {
      // fall through to text read
    }
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsText(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
}

// Normalise a field name to a stable lookup key.
// Strips case, punctuation, and extra whitespace so that "Customer Name",
// "customer_name", and "CustomerName" all collapse to the same key.
function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_\-]/g, ' ')       // underscores / hyphens → space
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase → words
    .replace(/[^a-z0-9 ]/g, '')   // drop remaining punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

// Return the most-frequently-occurring value in an array, or the first if tied.
function mostCommon(values: string[]): string {
  const freq = new Map<string, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? values[0];
}

function consolidateMappings(all: DataMapping[]): ConsolidatedDataMapping[] {
  // Key by NORMALISED FIELD NAME, not by xsdPath.
  // Gemini is non-deterministic: the same field in two documents can produce
  // slightly different XSD paths ("Customer/Name" vs "Customer/PersonalInfo/Name").
  // Keying by field name gives a stable identity; we pick the most-common path.
  type Entry = {
    field: string;
    xsdPaths: string[];
    sampleValues: string[];
    templates: Set<string>;
  };
  const byField = new Map<string, Entry>();

  for (const m of all) {
    const fieldName = m.field?.trim();
    if (!fieldName) continue;

    const key        = normalizeKey(fieldName);
    const xsdPath    = m.xsdPath?.trim()    || '';
    const sample     = m.sampleValue?.trim() || '';

    if (!byField.has(key)) {
      byField.set(key, { field: fieldName, xsdPaths: [], sampleValues: [], templates: new Set() });
    }

    const entry = byField.get(key)!;
    if (m.templateName) entry.templates.add(m.templateName);
    if (xsdPath) entry.xsdPaths.push(xsdPath);
    if (sample)  entry.sampleValues.push(sample);
  }

  return Array.from(byField.values())
    .map(({ field, xsdPaths, sampleValues, templates }) => ({
      field,
      xsdPath:      xsdPaths.length    ? mostCommon(xsdPaths)    : 'path not found',
      sampleValue:  sampleValues.length ? mostCommon(sampleValues) : '',
      templateCount: templates.size,
      templates: Array.from(templates).sort(),
    }))
    .sort((a, b) => b.templateCount - a.templateCount || a.field.localeCompare(b.field));
}

function formatXml(xml: string): string {
  const PADDING = '  ';
  let pad = 0;
  return xml
    .replace(/(>)\s*(<)(\/*)/g, '$1\r\n$2$3')
    .split('\r\n')
    .map(node => {
      let indent = 0;
      if (node.match(/.+<\/\w[^>]*>$/)) indent = 0;
      else if (node.match(/^<\/\w/)) { if (pad !== 0) pad -= 1; }
      else if (node.match(/^<\w[^>]*[^\/]>.*$/)) indent = 1;
      const padding = PADDING.repeat(pad);
      pad += indent;
      return padding + node;
    })
    .join('\r\n');
}

// ── Sub-components ────────────────────────────────────────────────────────────

const StatusIcon: React.FC<{ status: FileProgress['status'] }> = ({ status }) => {
  if (status === 'done') return (
    <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
    </svg>
  );
  if (status === 'error') return (
    <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
    </svg>
  );
  if (status === 'processing') return (
    <svg className="w-4 h-4 text-indigo-500 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
  return <div className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0" />;
};

const TemplatesBadge: React.FC<{ mapping: ConsolidatedDataMapping; total: number }> = ({ mapping, total }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex justify-center">
      {/* Invisible overlay to close on outside click */}
      {open && (
        <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
      )}
      <button
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold transition-colors ${
          mapping.templateCount === total
            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
            : mapping.templateCount > 1
            ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
        }`}
      >
        {mapping.templateCount} / {total}
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 top-7 right-0 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-xl p-2">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 px-1">
            Appears in {mapping.templateCount} of {total} template{total !== 1 ? 's' : ''}:
          </p>
          <ul className="space-y-0.5 max-h-40 overflow-y-auto">
            {mapping.templates.map(t => (
              <li key={t} className="text-xs text-slate-700 dark:text-slate-300 px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-700 break-words" title={t}>
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const DataMappingGenerator: React.FC = () => {
  const [docxFiles, setDocxFiles] = useState<File[]>([]);
  const [xsdFile, setXsdFile] = useState<File | null>(null);
  const [fileProgress, setFileProgress] = useState<FileProgress[]>([]);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [consolidated, setConsolidated] = useState<ConsolidatedDataMapping[] | null>(null);
  const [generatedXml, setGeneratedXml] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDocxFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected: File[] = Array.from(e.target.files ?? []);
    setDocxFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      return [...prev, ...selected.filter(f => !existing.has(f.name))];
    });
    e.target.value = '';
  };

  const removeDocxFile = (name: string) =>
    setDocxFiles(prev => prev.filter(f => f.name !== name));

  const handleProcess = useCallback(async () => {
    if (docxFiles.length === 0 || !xsdFile) {
      setError('Please select at least one DOCX file and one XSD schema file.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setConsolidated(null);
    setGeneratedXml('');

    const initialProgress: FileProgress[] = docxFiles.map(f => ({
      name: f.name, status: 'pending', fieldCount: 0,
    }));
    setFileProgress(initialProgress);

    const xsdContent = await fileToString(xsdFile);
    const allMappings: DataMapping[] = [];
    let firstXml = '';

    for (let i = 0; i < docxFiles.length; i++) {
      const file = docxFiles[i];
      setLoadingMessage(`Processing ${i + 1} of ${docxFiles.length}: ${file.name}`);

      setFileProgress(prev =>
        prev.map((p, idx) => idx === i ? { ...p, status: 'processing' } : p)
      );

      try {
        const docxContent = await fileToString(file);
        const result: DataMappingResult = await generateDataMap(docxContent, xsdContent, file.name);

        allMappings.push(...result.mappings);
        if (!firstXml && result.generatedXml) firstXml = result.generatedXml;

        setFileProgress(prev =>
          prev.map((p, idx) => idx === i
            ? { ...p, status: 'done', fieldCount: result.mappings.length }
            : p)
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFileProgress(prev =>
          prev.map((p, idx) => idx === i
            ? { ...p, status: 'error', fieldCount: 0, error: msg }
            : p)
        );
      }
    }

    setLoadingMessage('');
    setIsLoading(false);

    if (allMappings.length === 0) {
      setError('No fields could be extracted from the uploaded files. Please check that the documents contain placeholder fields and try again.');
      return;
    }

    setConsolidated(consolidateMappings(allMappings));
    setGeneratedXml(firstXml);
  }, [docxFiles, xsdFile]);

  const handleReset = () => {
    setDocxFiles([]);
    setXsdFile(null);
    setFileProgress([]);
    setConsolidated(null);
    setGeneratedXml('');
    setError(null);
    setIsLoading(false);
    setLoadingMessage('');
  };

  const handleDownloadCsv = () => {
    if (!consolidated) return;
    const headers = ['Field', 'XSD Path', 'Sample Value', 'Template Count', 'Templates'];
    const rows = consolidated.map(r =>
      `"${r.field.replace(/"/g, '""')}","${r.xsdPath.replace(/"/g, '""')}","${r.sampleValue.replace(/"/g, '""')}",${r.templateCount},"${r.templates.join('; ')}"`
    );
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'data_mappings.csv';
    a.click();
  };

  const handleDownloadXml = () => {
    if (!generatedXml) return;
    const blob = new Blob([formatXml(generatedXml)], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'generated_data.xml';
    a.click();
  };

  const doneCount = fileProgress.filter(p => p.status === 'done').length;
  const errorCount = fileProgress.filter(p => p.status === 'error').length;
  const showProgress = fileProgress.length > 0;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 md:p-10 transition-all duration-300">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Data Mapping Generator</h2>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          Upload one or more Word documents and an XSD schema to extract unique dynamic fields and their XSD mappings.
        </p>
      </div>

      {/* ── File inputs ── */}
      {!consolidated && !isLoading && (
        <div className="space-y-6 mb-6">

          {/* DOCX multi-file */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Word Documents (.docx)
              <span className="ml-2 text-xs font-normal text-slate-400">— select one or many</span>
            </label>
            <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 transition-colors">
              <WordFileIcon className="w-8 h-8 text-slate-400 mb-1" />
              <span className="text-sm text-slate-500 dark:text-slate-400">Click to browse or drag files here</span>
              <input
                type="file"
                multiple
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={handleDocxFilesChange}
              />
            </label>

            {docxFiles.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {docxFiles.map(f => (
                  <li key={f.name} className="flex items-center justify-between bg-slate-50 dark:bg-slate-700/50 rounded-lg px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <WordFileIcon className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                      <span className="text-slate-700 dark:text-slate-300 truncate">{f.name}</span>
                    </div>
                    <button
                      onClick={() => removeDocxFile(f.name)}
                      className="ml-3 text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
                      aria-label={`Remove ${f.name}`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* XSD */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">XSD Schema</label>
            {!xsdFile ? (
              <FileUploader
                onFileChange={setXsdFile}
                acceptedFileType=".xsd"
                fileTypeName="XSD Schema"
                icon={<XmlFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />}
              />
            ) : (
              <div className="bg-slate-100 dark:bg-slate-700 p-4 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <XmlFileIcon className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  <span className="text-sm text-slate-700 dark:text-slate-300 truncate">{xsdFile.name}</span>
                </div>
                <button onClick={() => setXsdFile(null)} className="text-xs text-indigo-500 hover:underline ml-4 flex-shrink-0">Change</button>
              </div>
            )}
          </div>
        </div>
      )}

      {!isLoading && !consolidated && (
        <div className="text-center">
          <button
            onClick={handleProcess}
            disabled={docxFiles.length === 0 || !xsdFile}
            className="bg-indigo-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-300 dark:focus:ring-indigo-800 transition-all duration-300 transform hover:scale-105 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed disabled:scale-100 inline-flex items-center gap-2"
          >
            Generate Mapping
            {docxFiles.length > 0 && (
              <span className="bg-white/20 text-xs px-1.5 py-0.5 rounded-full">{docxFiles.length} file{docxFiles.length > 1 ? 's' : ''}</span>
            )}
          </button>
        </div>
      )}

      {/* ── Loading ── */}
      {isLoading && (
        <div className="space-y-6">
          <Loader />
          {loadingMessage && (
            <p className="text-center text-sm text-slate-500 dark:text-slate-400">{loadingMessage}</p>
          )}
          {showProgress && (
            <div className="max-w-lg mx-auto space-y-2">
              {fileProgress.map(p => (
                <div key={p.name} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg px-3 py-2">
                  <StatusIcon status={p.status} />
                  <span className="text-sm text-slate-700 dark:text-slate-300 flex-1 truncate">{p.name}</span>
                  {p.status === 'done' && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 flex-shrink-0">{p.fieldCount} fields</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="text-center text-red-500 dark:text-red-400 bg-red-100 dark:bg-red-900/20 p-4 rounded-lg">
          <p className="font-bold">Error</p>
          <p className="text-sm mt-1">{error}</p>
          <button onClick={handleReset} className="mt-4 bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 transition-colors text-sm">
            Try Again
          </button>
        </div>
      )}

      {/* ── Results ── */}
      {consolidated && (
        <div className="space-y-6">

          {/* Summary bar */}
          <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4 flex flex-wrap gap-4 items-start justify-between">
            <div className="space-y-1">
              <h3 className="font-bold text-slate-800 dark:text-white">Consolidation Summary</h3>
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="text-slate-600 dark:text-slate-300">
                  <span className="font-bold text-indigo-600 dark:text-indigo-400">{docxFiles.length}</span> files submitted
                </span>
                <span className="text-slate-600 dark:text-slate-300">
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{doneCount}</span> processed
                </span>
                {errorCount > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    <span className="font-bold">{errorCount}</span> failed
                  </span>
                )}
                <span className="text-slate-600 dark:text-slate-300">
                  <span className="font-bold text-indigo-600 dark:text-indigo-400">{consolidated.length}</span> unique fields
                </span>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={handleDownloadCsv} className="text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-white font-medium py-1.5 px-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                CSV
              </button>
              {generatedXml && (
                <button onClick={handleDownloadXml} className="text-sm bg-indigo-600 text-white font-medium py-1.5 px-3 rounded-lg hover:bg-indigo-700 transition-colors">
                  XML
                </button>
              )}
            </div>
          </div>

          {/* Per-file validation log */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Processing Log</h4>
            <div className="space-y-1.5">
              {fileProgress.map(p => (
                <div key={p.name} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                  p.status === 'done' ? 'bg-emerald-50 dark:bg-emerald-900/20'
                  : p.status === 'error' ? 'bg-red-50 dark:bg-red-900/20'
                  : 'bg-slate-50 dark:bg-slate-700/40'
                }`}>
                  <StatusIcon status={p.status} />
                  <span className="flex-1 text-slate-700 dark:text-slate-300 truncate">{p.name}</span>
                  {p.status === 'done' && (
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{p.fieldCount} fields extracted</span>
                  )}
                  {p.status === 'error' && (
                    <span className="text-xs text-red-500 dark:text-red-400 truncate max-w-xs" title={p.error}>{p.error}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Consolidated mappings table */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Unique Field Mappings
              <span className="ml-2 text-xs font-normal text-slate-400">— click the template badge to see which files contain each field</span>
            </h4>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Dynamic Field</th>
                    <th className="px-4 py-3 font-semibold">XSD Path</th>
                    <th className="px-4 py-3 font-semibold">Sample Value</th>
                    <th className="px-4 py-3 font-semibold w-28 text-center">Templates</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {consolidated.map((m, i) => (
                    <tr key={i} className="bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white whitespace-nowrap">{m.field}</td>
                      <td className="px-4 py-3 font-mono text-xs break-all">
                        {m.xsdPath === 'path not found'
                          ? <span className="italic text-amber-600 dark:text-amber-400">path not found</span>
                          : <span className="text-indigo-600 dark:text-indigo-400">{m.xsdPath}</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {m.sampleValue
                          ? <span className="text-slate-600 dark:text-slate-300">{m.sampleValue}</span>
                          : <span className="italic text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <TemplatesBadge mapping={m} total={doneCount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* XML preview */}
          {generatedXml && (
            <div>
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Sample XML
                <span className="ml-2 text-xs font-normal text-slate-400">— generated from first successfully processed file</span>
              </h4>
              <div className="relative">
                <span className="absolute top-2 right-2 bg-slate-200 dark:bg-slate-600 text-xs px-2 py-1 rounded text-slate-600 dark:text-slate-300">Read-only</span>
                <pre className="w-full h-64 overflow-auto bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-300">
                  {formatXml(generatedXml)}
                </pre>
              </div>
            </div>
          )}

          <div className="text-center">
            <button onClick={handleReset} className="bg-slate-200 text-slate-700 font-bold py-3 px-6 rounded-lg hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500 transition-colors">
              Reset / Start Over
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataMappingGenerator;
