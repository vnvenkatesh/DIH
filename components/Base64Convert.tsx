
import React, { useState, useCallback, useRef } from 'react';

type Mode = 'encode' | 'decode';

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-all duration-200 ${
        copied
          ? 'bg-green-500 border-green-500 text-white'
          : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-500 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600'
      }`}
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
};

// ── Encode: File → Base64 ────────────────────────────────────────────────────

const EncodePanel: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [base64, setBase64] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((f: File) => {
    setFile(f);
    setBase64('');
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (e.g. "data:application/pdf;base64,")
      const b64 = result.includes(',') ? result.split(',')[1] : result;
      setBase64(b64);
      setIsProcessing(false);
    };
    reader.onerror = () => setIsProcessing(false);
    reader.readAsDataURL(f);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  }, [processFile]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const encodedSize = base64 ? Math.ceil(base64.length * 4 / 3) : 0;
  const overhead = file ? Math.round(((base64.length - file.size) / file.size) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 p-10 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
          isDragging
            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-750'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }}
        />
        <div className="w-14 h-14 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
          <svg className="w-7 h-7 text-indigo-500 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
        </div>
        {file ? (
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-800 dark:text-white">{file.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{formatSize(file.size)} · {file.type || 'unknown type'}</p>
            <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-1">Click or drop to replace</p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Drop any file here</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">or click to browse — any format accepted</p>
          </div>
        )}
      </div>

      {/* Output */}
      {isProcessing && (
        <div className="flex items-center justify-center gap-2 py-6 text-slate-500 dark:text-slate-400">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Encoding…</span>
        </div>
      )}

      {base64 && !isProcessing && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1 0-1zm0 2h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1 0-1zm0 2h4a.5.5 0 0 1 0 1H5a.5.5 0 0 1 0-1z"/><path fillRule="evenodd" d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z"/></svg>
                BASE64
              </span>
              <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                <span>{base64.length.toLocaleString()} chars</span>
                <span>·</span>
                <span>~{formatSize(encodedSize)}</span>
                <span>·</span>
                <span className="text-amber-600 dark:text-amber-400">+{overhead}% overhead</span>
              </div>
            </div>
            <CopyButton text={base64} />
          </div>

          {/* Base64 text area */}
          <textarea
            readOnly
            value={base64}
            rows={8}
            className="w-full px-4 py-3 text-xs font-mono text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 resize-none focus:outline-none leading-relaxed"
          />

          {/* Download as .txt */}
          <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80">
            <button
              onClick={() => {
                const blob = new Blob([base64], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${file!.name}.b64.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Download as .txt
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Decode: Base64 → File ────────────────────────────────────────────────────

const DecodePanel: React.FC = () => {
  const [input, setInput] = useState('');
  const [fileName, setFileName] = useState('decoded-file');
  const [error, setError] = useState('');
  const [decoded, setDecoded] = useState<Uint8Array | null>(null);
  const [mimeType, setMimeType] = useState('application/octet-stream');
  // Blob URL created once at decode time; stored in state so the <a> can reference it.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const guessExtension = (bytes: Uint8Array): { ext: string; mime: string } => {
    const h = (n: number) => bytes[n];
    if (h(0) === 0x25 && h(1) === 0x50 && h(2) === 0x44 && h(3) === 0x46) return { ext: 'pdf', mime: 'application/pdf' };
    if (h(0) === 0x89 && h(1) === 0x50 && h(2) === 0x4e && h(3) === 0x47) return { ext: 'png', mime: 'image/png' };
    if (h(0) === 0xff && h(1) === 0xd8) return { ext: 'jpg', mime: 'image/jpeg' };
    if (h(0) === 0x47 && h(1) === 0x49 && h(2) === 0x46) return { ext: 'gif', mime: 'image/gif' };
    if (h(0) === 0x52 && h(1) === 0x49 && h(2) === 0x46 && h(3) === 0x46) return { ext: 'webp', mime: 'image/webp' };
    if (h(0) === 0x50 && h(1) === 0x4b) return { ext: 'zip', mime: 'application/zip' };
    if (h(0) === 0x3c) return { ext: 'xml', mime: 'application/xml' };
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, 512)); return { ext: 'txt', mime: 'text/plain' }; } catch { /* binary */ }
    return { ext: 'bin', mime: 'application/octet-stream' };
  };

  const handleDecode = () => {
    // Revoke any previous blob URL before creating a new one.
    if (blobUrl) { URL.revokeObjectURL(blobUrl); setBlobUrl(null); }
    setError('');
    setDecoded(null);
    const cleaned = input.replace(/\s/g, '');
    if (!cleaned) { setError('Paste a base64 string first.'); return; }
    try {
      const binary = atob(cleaned);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const { ext, mime } = guessExtension(bytes);
      // Create the blob URL immediately in the event handler — no useEffect, no timing issues.
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      setDecoded(bytes);
      setMimeType(mime);
      setBlobUrl(url);
      if (!fileName || fileName === 'decoded-file') setFileName(`decoded-file.${ext}`);
    } catch {
      setError('Invalid base64 — check for missing padding or unexpected characters.');
    }
  };

  const handleLoadFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => setInput((reader.result as string).trim());
    reader.readAsText(f);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-5">
      {/* Base64 input */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Base64 Input</span>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.b64"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLoadFile(f); }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
              Load .txt file
            </button>
            {input && (
              <button
                onClick={() => { setInput(''); setDecoded(null); setError(''); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <textarea
          value={input}
          onChange={(e) => { setInput(e.target.value); setDecoded(null); setError(''); }}
          rows={8}
          placeholder="Paste base64-encoded string here…"
          className="w-full px-4 py-3 text-xs font-mono text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 resize-none focus:outline-none leading-relaxed placeholder:text-slate-400 dark:placeholder:text-slate-600"
        />
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {input.replace(/\s/g, '').length.toLocaleString()} chars
          </span>
          <button
            onClick={handleDecode}
            disabled={!input.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white disabled:text-slate-400 dark:disabled:text-slate-500 transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            Decode
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Result */}
      {decoded && !error && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-700 bg-white dark:bg-slate-800 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-100 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Decoded successfully</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-500">{formatSize(decoded.length)} · {mimeType}</p>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {/* File name input */}
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">Output filename</label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="filename.ext"
              />
            </div>

            {/* Preview for text/XML */}
            {(mimeType === 'text/plain' || mimeType === 'application/xml') && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">Preview</label>
                <pre className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-auto max-h-40 whitespace-pre-wrap break-all leading-relaxed">
                  {new TextDecoder().decode(decoded.slice(0, 2000))}
                  {decoded.length > 2000 && '\n\n… (truncated for preview)'}
                </pre>
              </div>
            )}

            {/* Image preview */}
            {(mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/gif' || mimeType === 'image/webp') && blobUrl && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">Preview</label>
                <img
                  src={blobUrl}
                  alt="decoded"
                  className="max-h-48 rounded-lg border border-slate-200 dark:border-slate-700 object-contain bg-slate-100 dark:bg-slate-900"
                />
              </div>
            )}

            {blobUrl && (
              <a
                href={blobUrl}
                download={fileName || 'decoded-file'}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download {fileName}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const Base64Convert: React.FC = () => {
  const [mode, setMode] = useState<Mode>('encode');

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30">
        <svg className="w-5 h-5 text-indigo-500 dark:text-indigo-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
        <p className="text-sm text-indigo-700 dark:text-indigo-300">
          All processing happens <strong>entirely in your browser</strong> — no file data is sent to any server.
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 w-fit">
        {([
          { key: 'encode', label: 'File → Base64', icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          )},
          { key: 'decode', label: 'Base64 → File', icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
          )},
        ] as { key: Mode; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
              mode === key
                ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm border border-slate-200 dark:border-slate-600'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* Panel */}
      {mode === 'encode' ? <EncodePanel /> : <DecodePanel />}
    </div>
  );
};

export default Base64Convert;
