import React, { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';

interface VariableMapEntry {
  fillPointId: number;
  fieldLabel: string;
  domain: string;
  fieldName: string;
  xsdPath: string;
  sampleValue: string;
  detectionMethod: 'placeholder' | 'sampleValue';
  isDate: boolean;
  gdMatched?: boolean;
}

interface GenerationResult {
  gdContent: string;
  sampleXml: string;
  variableMap: VariableMapEntry[];
  skipped: string[];
  unresolved: string[];
}

const DOMAIN_COLORS: Record<string, string> = {
  Claim:   'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  Company: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  Person:  'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  // fallbacks for derived names (no .gd reference)
  Contact: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  Policy:  'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  Support: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
};

function domainColor(domain: string): string {
  return DOMAIN_COLORS[domain] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
}

const DocxIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
);

const GhostIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8.13 2 5 5.13 5 9v8l2-2 2 2 2-2 2 2 2-2 2 2V9c0-3.87-3.13-7-7-7z" />
    <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="9" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const UploadZone: React.FC<{
  label: string;
  description: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  color: string;
  icon: React.ReactNode;
}> = ({ label, description, accept, file, onFile, color, icon }) => {
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  }, [onFile]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFile(f);
  };

  return (
    <div
      className={`relative border-2 border-dashed rounded-xl p-5 transition-all cursor-pointer ${
        dragging ? `border-${color}-500 bg-${color}-50 dark:bg-${color}-900/20` :
        file ? 'border-green-400 bg-green-50 dark:bg-green-900/20' :
        'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept={accept}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        onChange={handleChange}
      />
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${file ? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
          {file ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ) : icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
          {file ? (
            <p className="text-xs text-green-600 dark:text-green-400 truncate">{file.name}</p>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500">{description}</p>
          )}
        </div>
        {file && (
          <button
            className="ml-auto flex-shrink-0 text-slate-400 hover:text-red-500 transition-colors"
            onClick={(e) => { e.stopPropagation(); onFile(null); }}
            title="Remove file"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

const GhostDraftGenerator: React.FC = () => {
  const { token } = useAuth();
  const { settings } = useSettings();
  const [gdFile, setGdFile] = useState<File | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [xsdFile, setXsdFile] = useState<File | null>(null);
  const [gdRefFile, setGdRefFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);

  const canGenerate = !!gdFile;
  const isAutoDetect = !csvFile;

  const handleGenerate = async () => {
    if (!gdFile) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append('gd', gdFile);
    if (csvFile)   form.append('csv', csvFile);
    if (xsdFile)   form.append('xsd', xsdFile);
    if (gdRefFile) form.append('gdref', gdRefFile);
    form.append('provider', settings.llmProvider ?? 'gemini');

    try {
      const response = await fetch('/v1/ghostdraft-generator', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Generation failed');
      setResult(data as GenerationResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewDocument = () => {
    setGdFile(null);
    setResult(null);
    setError(null);
  };

  const handleReset = () => {
    setGdFile(null);
    setCsvFile(null);
    setXsdFile(null);
    setGdRefFile(null);
    setResult(null);
    setError(null);
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const baseName = gdFile?.name.replace(/\.gd$/i, '') ?? 'document';

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Upload Section */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400">
            <GhostIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Upload Files</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">.gd document required · CSV, XSD and reference .gd are optional and stay loaded across sessions</p>
          </div>
          <span className={`ml-auto flex-shrink-0 px-2.5 py-0.5 text-xs rounded-full font-medium ${
            isAutoDetect
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
          }`}>
            {isAutoDetect ? 'Auto-detect mode' : 'Deterministic mode'}
          </span>
        </div>

        {/* 2×2 grid — only .gd is required */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <UploadZone
            label=".gd Document"
            description="GhostDraft .gd file to process"
            accept=".gd,.xml"
            file={gdFile}
            onFile={setGdFile}
            color="indigo"
            icon={<GhostIcon className="w-5 h-5" />}
          />
          <UploadZone
            label="Data Mapping CSV (optional)"
            description="Enables deterministic variable mapping"
            accept=".csv"
            file={csvFile}
            onFile={setCsvFile}
            color="emerald"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125" />
              </svg>
            }
          />
          <UploadZone
            label="XSD Schema (optional)"
            description="Business data schema (.xsd)"
            accept=".xsd,.xml"
            file={xsdFile}
            onFile={setXsdFile}
            color="violet"
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
              </svg>
            }
          />
          <UploadZone
            label="Reference .gd for GUIDs (optional)"
            description="Supplies root/child node UUIDs for Model Library"
            accept=".gd,.xml"
            file={gdRefFile}
            onFile={setGdRefFile}
            color="blue"
            icon={<DocxIcon className="w-5 h-5" />}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || isLoading}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating…
              </>
            ) : (
              <>
                <GhostIcon className="w-4 h-4" />
                Generate GhostDraft Document
              </>
            )}
          </button>
          {result && (
            <>
              <button
                onClick={handleNewDocument}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors"
                title="Clear .gd document and result — CSV, XSD and reference .gd stay loaded"
              >
                <GhostIcon className="w-4 h-4" />
                New Document
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2.5 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 text-sm font-medium transition-colors"
                title="Clear all files and start fresh"
              >
                Reset all
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-5">

          {/* Summary Banner */}
          <div className="flex flex-wrap items-center gap-4 p-5 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
                {result.variableMap.length} fill point{result.variableMap.length !== 1 ? 's' : ''} mapped
              </span>
            </div>
            <span className={`px-2.5 py-0.5 text-xs rounded-full font-medium ${
              isAutoDetect
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
            }`}>
              {isAutoDetect ? 'Auto-detect' : 'Deterministic'}
            </span>
            {result.unresolved?.length > 0 && (
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <span className="text-sm">{result.unresolved.length} placeholder{result.unresolved.length !== 1 ? 's' : ''} not completed</span>
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => downloadFile(result.gdContent, `${baseName}.gd`, 'text/xml')}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download .gd
              </button>
              <button
                onClick={() => downloadFile(result.sampleXml, `${baseName}-sample.xml`, 'text/xml')}
                className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-50 dark:hover:bg-slate-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download sample XML
              </button>
            </div>
          </div>

          {/* Unresolved Placeholders */}
          {result.unresolved?.length > 0 && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
              <div className="flex items-start gap-2 mb-3">
                <svg className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-red-800 dark:text-red-300">Placeholders not completed — no mapping found</p>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">These tags remain unchanged in the output .gd file. Add them to your CSV mapping or reference .gd to complete them.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {result.unresolved.map((tag, i) => (
                  <span key={i} className="inline-block px-2.5 py-0.5 text-xs bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 rounded-full border border-red-200 dark:border-red-700 font-mono">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Variable Mapping Table */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Variable Mapping</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">How each fill point maps to the GhostDraft Model Library</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Field Label</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Domain</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Variable Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">XSD Path</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Sample Value</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Detection</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {result.variableMap.map((v) => (
                    <tr key={v.fillPointId} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs font-bold">
                          {v.fillPointId}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium">{v.fieldLabel}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${domainColor(v.domain)}`}>
                          {v.domain}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 px-1.5 py-0.5 rounded">
                          {v.fieldName}
                        </code>
                        {v.isDate && (
                          <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">(date)</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs text-slate-500 dark:text-slate-400">{v.xsdPath}</code>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">{v.sampleValue}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${
                          v.detectionMethod === 'placeholder'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                        }`}>
                          {v.detectionMethod === 'placeholder' ? 'Placeholder' : 'Sample value'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {v.gdMatched ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                            .gd reference
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">Derived</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Workflow tip */}
          <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-600 dark:text-slate-400">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
            </svg>
            <span>
              Open the generated <strong>.gd</strong> file in GhostDraft Studio, then load the <strong>sample XML</strong> as the data source to preview the rendered document immediately.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default GhostDraftGenerator;
