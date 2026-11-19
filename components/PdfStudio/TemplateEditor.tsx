import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PdfTemplate, PdfTemplateField, PdfTemplateRule, PdfApiKey } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import SchemaEditor from './SchemaEditor';
import RuleEditor from './RuleEditor';

interface Props {
  template: PdfTemplate | null;
  onSaved: () => void;
  onCancel: () => void;
  onOpenFetchDoc?: (init: { url: string; bearerToken: string; jsonBody: string }) => void;
}

type Step = 'upload' | 'edit' | 'schema' | 'rules';

export default function TemplateEditor({ template, onSaved, onCancel, onOpenFetchDoc }: Props) {
  const { token } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Metadata
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [htmlContent, setHtmlContent] = useState(template?.html_content ?? '');
  const [originalFormat, setOriginalFormat] = useState(template?.original_format ?? 'docx');
  const [fields, setFields] = useState<PdfTemplateField[]>([]);
  const [rules, setRules] = useState<PdfTemplateRule[]>([]);
  const [step, setStep] = useState<Step>(template ? 'edit' : 'upload');
  const [showFetchDoc, setShowFetchDoc] = useState(false);

  // Derive block IDs and placeholder names from HTML so Rules and Schema stay in sync
  function extractBlockIds(html: string): string[] {
    const ids: string[] = [];
    const re = /data-block-id="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) ids.push(m[1]);
    return [...new Set(ids)];
  }

  function extractPlaceholderNames(html: string): string[] {
    const names: string[] = [];
    const re = /data-placeholder="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) names.push(m[1]);
    return [...new Set(names)];
  }

  const blockIds = extractBlockIds(htmlContent);

  // When htmlContent changes, auto-add new placeholder chips to the fields list
  useEffect(() => {
    const detected = extractPlaceholderNames(htmlContent);
    if (detected.length === 0) return;
    setFields(prev => {
      const existing = new Set(prev.map(f => f.field_name));
      const toAdd = detected.filter(n => !existing.has(n));
      if (toAdd.length === 0) return prev;
      const newFields: PdfTemplateField[] = toAdd.map((n, i) => ({
        id: 0,
        template_id: 0,
        field_name: n,
        field_type: 'string' as const,
        is_required: true,
        default_value: '',
        description: '',
        parent_field: null,
        sort_order: prev.length + i,
      }));
      return [...prev, ...newFields];
    });
  }, [htmlContent]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // When editing an existing template, load full content + fields + rules on mount.
  // The list endpoint omits html_content for performance, so we fetch the single record.
  const [loadingTemplate, setLoadingTemplate] = useState(!!template);
  const [loaded, setLoaded] = useState(false);
  if (template && !loaded) {
    setLoaded(true);
    fetch(`/v1/pdf-studio/templates/${template.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => {
        if (d.template?.html_content) setHtmlContent(d.template.html_content);
        if (d.template?.original_format) setOriginalFormat(d.template.original_format);
        setFields(d.fields ?? []);
        setRules(d.rules ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingTemplate(false));
  }

  // Upload a DOCX or HTML file for conversion
  async function handleFileUpload(file: File) {
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/v1/pdf-studio/templates/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Upload failed');
      const data = await res.json();
      setHtmlContent(data.html);
      setOriginalFormat(data.originalFormat ?? 'docx');
      if (!name) setName(file.name.replace(/\.[^.]+$/, ''));
      // Auto-build fields from detected placeholders
      const detected: PdfTemplateField[] = (data.placeholders ?? []).map((p: string, i: number) => ({
        id: 0,
        template_id: 0,
        field_name: p,
        field_type: 'string' as const,
        is_required: true,
        default_value: '',
        description: '',
        parent_field: null,
        sort_order: i,
      }));
      setFields(detected);
      setStep('edit');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }

  async function handleSave() {
    if (!name.trim()) { setError('Template name is required'); return; }
    if (!htmlContent.trim()) { setError('Template content is empty'); return; }
    setSaving(true);
    setError('');
    try {
      const body = {
        name: name.trim(),
        description: description.trim(),
        html_content: htmlContent,
        original_format: originalFormat,
        fields: fields.map((f, i) => ({ ...f, sort_order: i })),
        rules: rules.map(r => ({
          block_id: r.block_id,
          rule_type: r.rule_type,
          rule_config: r.rule_config,
        })),
      };
      const url = template
        ? `/v1/pdf-studio/templates/${template.id}`
        : '/v1/pdf-studio/templates';
      const res = await fetch(url, {
        method: template ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleOpenFetchDoc() {
    if (!template || !onOpenFetchDoc) return;
    const templateName = name || template.name;
    const url = `${window.location.origin}/v1/pdf-render/${encodeURIComponent(templateName)}`;
    let bearerToken = '<Your DIH API key here>';
    try {
      const r = await fetch('/v1/pdf-studio/templates/api-keys/list', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      if (d.keys?.length > 0) {
        const firstId = d.keys[0].id;
        const rev = await fetch(`/v1/pdf-studio/templates/api-keys/${firstId}/reveal`, { headers: { Authorization: `Bearer ${token}` } });
        const revData = await rev.json();
        bearerToken = revData.raw_key ?? d.keys[0].key_prefix;
      }
    } catch { /* keep placeholder */ }
    // Build sample JSON payload from template fields
    const payloadFields: Record<string, string> = {};
    fields.forEach(f => { payloadFields[f.field_name] = f.default_value || ''; });
    const jsonBody = JSON.stringify({ data: payloadFields }, null, 2);
    onOpenFetchDoc({ url, bearerToken, jsonBody });
  }

  const STEPS: { id: Step; label: string }[] = [
    { id: 'upload', label: '1. Upload' },
    { id: 'edit', label: '2. Layout' },
    { id: 'schema', label: '3. Schema' },
    { id: 'rules', label: '4. Rules' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">
            {template ? 'Edit Template' : 'New Template'}
          </h2>
          {template && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{template.name}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {template && onOpenFetchDoc && (
            <button
              onClick={() => void handleOpenFetchDoc()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-indigo-700 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Fetch Doc
            </button>
          )}
          {template && (
            <button
              onClick={() => setShowFetchDoc(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              CURL Doc
            </button>
          )}
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </div>

      {/* Step tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-slate-200 dark:border-slate-700">
        {STEPS.filter(s => template || s.id !== 'upload').map(s => (
          <button
            key={s.id}
            onClick={() => s.id !== 'upload' || !template ? setStep(s.id) : undefined}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              step === s.id
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 rounded-lg text-red-700 dark:text-red-300 text-sm">{error}</div>
      )}

      {/* Name / Description — always visible */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Template Name *</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Insurance Quote Letter"
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Description</label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional short description"
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white"
          />
        </div>
      </div>

      {/* Step content */}
      {step === 'upload' && (
        <UploadStep
          onFile={handleFileUpload}
          uploading={uploading}
          fileInputRef={fileInputRef}
          onDrop={handleDrop}
        />
      )}

      {step === 'edit' && (
        loadingTemplate ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading template…
          </div>
        ) : (
          <HtmlEditor html={htmlContent} onChange={setHtmlContent} />
        )
      )}

      {step === 'schema' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-4">
            Define the data fields your template accepts. These are auto-detected from placeholders.
          </p>
          <SchemaEditor fields={fields} onChange={setFields} />
        </div>
      )}

      {step === 'rules' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-4">
            Add conditional or loop rules. Mark HTML blocks with <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded text-xs">data-block-id="..."</code> to reference them here.
          </p>
          <RuleEditor fields={fields} rules={rules} onChange={setRules} blockIds={blockIds} />
        </div>
      )}

      {showFetchDoc && template && (
        <FetchDocModal
          template={template}
          fields={fields}
          token={token!}
          onClose={() => setShowFetchDoc(false)}
        />
      )}

      {/* Navigation between steps */}
      {step !== 'upload' && (
        <div className="flex justify-between mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={() => {
              const idx = STEPS.findIndex(s => s.id === step);
              if (idx > 0) setStep(STEPS[idx - 1].id);
            }}
            className="text-sm text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          {step !== 'rules' && (
            <button
              onClick={() => {
                const allSteps = template ? STEPS.filter(s => s.id !== 'upload') : STEPS;
                const idx = allSteps.findIndex(s => s.id === step);
                if (idx < allSteps.length - 1) setStep(allSteps[idx + 1].id);
              }}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 flex items-center gap-1"
            >
              Next
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Upload Step ───────────────────────────────────────────────────────────────
function UploadStep({
  onFile,
  uploading,
  fileInputRef,
  onDrop,
}: {
  onFile: (f: File) => void;
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={e => e.preventDefault()}
      className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-12 text-center hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors cursor-pointer"
      onClick={() => fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.doc,.html,.htm"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      {uploading ? (
        <div className="flex flex-col items-center gap-3 text-indigo-500">
          <svg className="animate-spin w-8 h-8" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span className="text-sm">Uploading and converting…</span>
        </div>
      ) : (
        <>
          <svg className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
            Drop a Word document or HTML file here
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            .docx, .doc, .html — placeholders as {'{{field}}'}, {'<field>'} or {'[field]'} are auto-detected
          </p>
        </>
      )}
    </div>
  );
}

// ── WYSIWYG Editor helpers ────────────────────────────────────────────────────
type RibbonTab = 'formatting' | 'insert' | 'review' | 'rules';

interface LayoutAnnotation {
  id: string;
  label: string;
  type: 'conditional' | 'validation' | 'visibility' | 'formatting';
  condition: string;
  action: string;
  notes: string;
}

interface BadgePos {
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
  index: number;
}

function extractRules(html: string): { clean: string; rules: LayoutAnnotation[] } {
  const m = html.match(/<!--\s*LAYOUT_RULES:([\s\S]*?)-->/);
  if (!m) return { clean: html, rules: [] };
  try {
    return {
      clean: html.replace(/<!--\s*LAYOUT_RULES:([\s\S]*?)-->/, '').trimEnd(),
      rules: JSON.parse(m[1]) as LayoutAnnotation[],
    };
  } catch { return { clean: html, rules: [] }; }
}

function embedRules(html: string, rules: LayoutAnnotation[]): string {
  const clean = html.replace(/<!--\s*LAYOUT_RULES:([\s\S]*?)-->/, '').trimEnd();
  return rules.length ? `${clean}<!-- LAYOUT_RULES:${JSON.stringify(rules)} -->` : clean;
}

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const TYPE_COLORS: Record<LayoutAnnotation['type'], string> = {
  conditional: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  validation:  'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  visibility:  'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  formatting:  'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
};

const TEXT_COLORS  = ['#1e293b','#dc2626','#ea580c','#ca8a04','#16a34a','#2563eb','#9333ea','#db2777','#ffffff'];
const HILITE_COLORS = ['#fef08a','#bbf7d0','#bfdbfe','#f5d0fe','#fed7aa','#fecdd3','#e2e8f0'];

function RibbonBtn({
  onClick, title, children, active = false, disabled = false,
}: {
  onClick: () => void; title?: string; children: React.ReactNode; active?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onMouseDown={e => e.preventDefault()} // keep editor focus
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex items-center justify-center w-7 h-7 rounded transition-colors flex-shrink-0 ${
        disabled
          ? 'opacity-30 cursor-not-allowed'
          : active
          ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-400'
          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
      }`}
    >
      {children}
    </button>
  );
}

function RibbonSep() {
  return <div className="w-px h-5 bg-slate-300 dark:bg-slate-600 mx-0.5 flex-shrink-0" />;
}

function RibbonLabelBtn({
  onClick, title, children, disabled = false, variant = 'default',
}: {
  onClick: () => void; title?: string; children: React.ReactNode; disabled?: boolean;
  variant?: 'default' | 'amber' | 'indigo';
}) {
  const cls = {
    default: 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600',
    amber:   disabled ? 'border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-40' : 'bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300 hover:bg-amber-100',
    indigo:  disabled ? 'border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-40' : 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100',
  }[variant];
  return (
    <button
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors ${cls}`}
    >
      {children}
    </button>
  );
}

function SentimentButton({ editorRef }: { editorRef: React.RefObject<HTMLDivElement> }) {
  const [result, setResult] = useState<{ label: string; colorCls: string; emoji: string } | null>(null);
  const [loading, setLoading] = useState(false);

  function analyse() {
    const text = (editorRef.current?.innerText ?? '').toLowerCase();
    if (!text.trim()) return;
    setLoading(true);
    setTimeout(() => {
      const pos = ['great','good','thank','please','value','help','support','best','excellent','appreciate','benefit','confirm','pleased','happy'];
      const neg = ['problem','issue','concern','sorry','unfortunately','fail','error','incorrect','delay','complaint','regret','unable','cannot','dispute'];
      const p = pos.filter(w => text.includes(w)).length;
      const n = neg.filter(w => text.includes(w)).length;
      if (p > n + 1)      setResult({ label: 'Positive', emoji: '😊', colorCls: 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300' });
      else if (n > p + 1) setResult({ label: 'Negative', emoji: '😕', colorCls: 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300' });
      else                setResult({ label: 'Neutral',  emoji: '😐', colorCls: 'bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300' });
      setLoading(false);
    }, 700);
  }

  return (
    <div className="flex items-center gap-2">
      <RibbonLabelBtn onClick={analyse} title="Analyse sentiment of the content" disabled={loading}>
        {loading ? (
          <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/>
            <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="2.5"/><line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="2.5"/>
          </svg>
        )}
        Sentiment
      </RibbonLabelBtn>
      {result && (
        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${result.colorCls}`}>
          <span>{result.emoji}</span>{result.label}
        </span>
      )}
    </div>
  );
}

// ── WYSIWYG Editor ────────────────────────────────────────────────────────────
function HtmlEditor({ html, onChange }: { html: string; onChange: (h: string) => void }) {
  const [mode, setMode] = useState<'edit' | 'source'>('edit');
  const editorRef = useRef<HTMLDivElement>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const savedRange = useRef<Range | null>(null);
  const [dialog, setDialog] = useState<null | 'dynamic' | 'block'>(null);
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const suppressInput = useRef(false); // prevent feedback loop when we set innerHTML

  // Ribbon state
  const [ribbonTab, setRibbonTab]           = useState<RibbonTab>('formatting');
  const [colorPicker, setColorPicker]       = useState<'text' | 'highlight' | null>(null);
  const [tableDialog, setTableDialog]       = useState(false);
  const [tableRows, setTableRows]           = useState(3);
  const [tableCols, setTableCols]           = useState(3);
  const [barcodeDialog, setBarcodeDialog]   = useState(false);
  const [barcodeValue, setBarcodeValue]     = useState('');
  const [spellCheckOn, setSpellCheckOn]     = useState(false);
  const [wordCount, setWordCount]           = useState(0);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Layout annotation rules
  const [layoutRules, setLayoutRules] = useState<LayoutAnnotation[]>(() => extractRules(html).rules);
  const layoutRulesRef = useRef<LayoutAnnotation[]>(layoutRules);
  const [badgePositions, setBadgePositions] = useState<BadgePos[]>([]);
  const [activeBadgeId, setActiveBadgeId] = useState<string | null>(null);
  const [ruleDialog, setRuleDialog] = useState<{ mode: 'add' | 'edit'; id?: string } | null>(null);
  const [ruleForm, setRuleForm] = useState<LayoutAnnotation>({ id: '', label: '', type: 'conditional', condition: '', action: '', notes: '' });
  const ruleFormRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Keep layoutRulesRef in sync with state
  useEffect(() => { layoutRulesRef.current = layoutRules; }, [layoutRules]);

  // Set editor content when mode switches to edit
  useEffect(() => {
    if (mode === 'edit' && editorRef.current) {
      suppressInput.current = true;
      editorRef.current.innerHTML = extractRules(html).clean;
      suppressInput.current = false;
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Populate on first mount
  useEffect(() => {
    if (editorRef.current && html) {
      const { clean, rules } = extractRules(html);
      suppressInput.current = true;
      editorRef.current.innerHTML = clean;
      suppressInput.current = false;
      setLayoutRules(rules);
      layoutRulesRef.current = rules;
      setWordCount(calcWords());
      setTimeout(() => syncBadges(rules), 100);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync externally-changed html (e.g. template loaded from server) into the editor
  const lastHtmlRef = useRef(html);
  useEffect(() => {
    if (html !== lastHtmlRef.current && mode === 'edit' && editorRef.current) {
      lastHtmlRef.current = html;
      const { clean, rules } = extractRules(html);
      suppressInput.current = true;
      editorRef.current.innerHTML = clean;
      suppressInput.current = false;
      setLayoutRules(rules);
      layoutRulesRef.current = rules;
      setTimeout(() => syncBadges(rules), 100);
    }
    lastHtmlRef.current = html;
  }, [html, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track text selection
  useEffect(() => {
    function onSelChange() {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && editorRef.current?.contains(sel.anchorNode)) {
        savedRange.current = sel.getRangeAt(0).cloneRange();
        setHasSelection(true);
      } else if (!dialog) {
        setHasSelection(false);
      }
    }
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, [dialog]);

  // Close color picker on outside click
  useEffect(() => {
    if (!colorPicker) return;
    function onDown(e: MouseEvent) {
      if (!(e.target as Element).closest('[data-cpicker]')) setColorPicker(null);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [colorPicker]);

  // Close badge popup on outside click
  useEffect(() => {
    if (!activeBadgeId) return;
    function onDown(e: MouseEvent) {
      if (!(e.target as Element).closest('[data-badge-popup]')) setActiveBadgeId(null);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [activeBadgeId]);

  // syncBadges: compute overlay badge positions from DOM
  const syncBadges = useCallback((rules: LayoutAnnotation[]) => {
    if (!editorRef.current) return;
    const containerRect = editorRef.current.getBoundingClientRect();
    const scrollTop  = editorRef.current.scrollTop;
    const scrollLeft = editorRef.current.scrollLeft;
    const positions: BadgePos[] = [];
    rules.forEach((rule, i) => {
      const el = editorRef.current!.querySelector(`[data-rule-id="${rule.id}"]`);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      positions.push({
        id: rule.id,
        index: i + 1,
        top:  rect.top  - containerRect.top  + scrollTop,
        left: rect.left - containerRect.left + scrollLeft,
        width:  rect.width,
        height: rect.height,
      });
    });
    setBadgePositions(positions);
  }, []);

  // Re-sync badges when rules change
  useEffect(() => { syncBadges(layoutRules); }, [layoutRules, syncBadges]);

  // Re-sync badges on editor scroll
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const onScroll = () => syncBadges(layoutRulesRef.current);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [syncBadges]);

  // MutationObserver: auto-delete rules when their annotated element is removed
  useEffect(() => {
    if (!editorRef.current) return;
    const observer = new MutationObserver(() => {
      if (!editorRef.current) return;
      const present = new Set(
        Array.from(editorRef.current.querySelectorAll('[data-rule-id]'))
          .map(el => (el as HTMLElement).dataset.ruleId!)
      );
      setLayoutRules(prev => {
        const next = prev.filter(r => present.has(r.id));
        if (next.length !== prev.length) {
          layoutRulesRef.current = next;
          const newHtml = editorRef.current!.innerHTML;
          lastHtmlRef.current = newHtml;
          onChange(embedRules(newHtml, next));
          setTimeout(() => syncBadges(next), 0);
        }
        return next;
      });
    });
    observer.observe(editorRef.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [onChange, syncBadges]);

  function calcWords() {
    return (editorRef.current?.innerText ?? '').trim().split(/\s+/).filter(Boolean).length;
  }

  function handleInput() {
    if (suppressInput.current) return;
    if (editorRef.current) {
      const innerHTML = editorRef.current.innerHTML;
      lastHtmlRef.current = innerHTML;
      onChange(embedRules(innerHTML, layoutRulesRef.current));
      setWordCount(calcWords());
      syncBadges(layoutRulesRef.current);
    }
  }

  function switchToSource() {
    if (editorRef.current) onChange(embedRules(editorRef.current.innerHTML, layoutRulesRef.current));
    setMode('source');
  }

  function switchToEdit() { setMode('edit'); }

  // Execute a document.execCommand and sync the result
  function exec(cmd: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value ?? undefined);
    if (editorRef.current) {
      const innerHTML = editorRef.current.innerHTML;
      lastHtmlRef.current = innerHTML;
      onChange(embedRules(innerHTML, layoutRulesRef.current));
      setTimeout(() => syncBadges(layoutRulesRef.current), 0);
    }
  }

  // ── Insert helpers ──────────────────────────────────────────────────────────
  function insertTable() {
    let h = '<table style="border-collapse:collapse;width:100%;margin:8px 0">';
    for (let r = 0; r < tableRows; r++) {
      h += '<tr>';
      for (let c = 0; c < tableCols; c++) {
        const isH = r === 0;
        const tag = isH ? 'th' : 'td';
        const st  = isH
          ? 'border:1px solid #94a3b8;padding:6px 10px;background:#f1f5f9;font-weight:600;text-align:left'
          : 'border:1px solid #cbd5e1;padding:6px 10px;text-align:left';
        h += `<${tag} style="${st}">${isH ? `Col ${c + 1}` : '&nbsp;'}</${tag}>`;
      }
      h += '</tr>';
    }
    h += '</table><p>&nbsp;</p>';
    exec('insertHTML', h);
    setTableDialog(false);
  }

  function insertBarcode() {
    const val = barcodeValue.trim() || 'SAMPLE';
    // Deterministic pseudo-random bar pattern seeded from the value string
    let seed = 0;
    for (let i = 0; i < val.length; i++) seed = (seed * 31 + val.charCodeAt(i)) & 0xffff;
    let bars = ''; let x = 10;
    for (let i = 0; i < 56; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const w = (seed & 1) ? 2 : 3;
      if (i % 2 === 0) bars += `<rect x="${x}" y="2" width="${w}" height="38" fill="black"/>`;
      x += w;
    }
    const W = x + 10;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="56" ` +
      `style="display:inline-block;border:1px solid #e2e8f0;background:white;border-radius:3px;padding:2px;vertical-align:middle;margin:2px">` +
      `<rect x="0" y="0" width="${W}" height="56" fill="white"/>` +
      bars +
      `<text x="${W / 2}" y="52" text-anchor="middle" font-family="monospace" font-size="9" fill="#1e293b">${val}</text>` +
      `</svg>`;
    exec('insertHTML', svg);
    setBarcodeDialog(false);
    setBarcodeValue('');
  }

  function handleImageInsert(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { if (ev.target?.result) exec('insertImage', ev.target.result as string); };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  // ── Rule handlers ───────────────────────────────────────────────────────────
  function openAddRule() {
    if (!hasSelection) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && editorRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
    setRuleForm({ id: '', label: '', type: 'conditional', condition: '', action: '', notes: '' });
    setRuleDialog({ mode: 'add' });
    setTimeout(() => ruleFormRef.current?.focus(), 50);
  }

  function openEditRule(id: string) {
    const rule = layoutRulesRef.current.find(r => r.id === id);
    if (!rule) return;
    setRuleForm({ ...rule });
    setRuleDialog({ mode: 'edit', id });
    setTimeout(() => ruleFormRef.current?.focus(), 50);
  }

  function saveRule() {
    if (!ruleForm.label.trim()) return;
    if (ruleDialog?.mode === 'add') {
      const id = genId();
      if (savedRange.current) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(savedRange.current);
        const span = document.createElement('span');
        span.setAttribute('data-rule-id', id);
        span.setAttribute('style',
          'background:rgba(99,102,241,0.12);border-bottom:2px solid #6366f1;border-radius:2px;padding:0 1px');
        try {
          savedRange.current.surroundContents(span);
        } catch {
          const frag = savedRange.current.extractContents();
          span.appendChild(frag);
          savedRange.current.insertNode(span);
        }
      }
      const newRule: LayoutAnnotation = { ...ruleForm, id };
      const newRules = [...layoutRulesRef.current, newRule];
      setLayoutRules(newRules);
      layoutRulesRef.current = newRules;
      if (editorRef.current) {
        const innerHTML = editorRef.current.innerHTML;
        lastHtmlRef.current = innerHTML;
        onChange(embedRules(innerHTML, newRules));
      }
      setTimeout(() => syncBadges(newRules), 50);
    } else if (ruleDialog?.id) {
      const newRules = layoutRulesRef.current.map(r =>
        r.id === ruleDialog.id ? { ...ruleForm, id: r.id } : r
      );
      setLayoutRules(newRules);
      layoutRulesRef.current = newRules;
      if (editorRef.current) onChange(embedRules(editorRef.current.innerHTML, newRules));
    }
    setRuleDialog(null);
    setHasSelection(false);
    editorRef.current?.focus();
  }

  function deleteRule(id: string) {
    const el = editorRef.current?.querySelector(`[data-rule-id="${id}"]`) as HTMLElement | null;
    if (el) {
      const frag = document.createDocumentFragment();
      while (el.firstChild) frag.appendChild(el.firstChild);
      el.parentNode?.replaceChild(frag, el);
    }
    const newRules = layoutRulesRef.current.filter(r => r.id !== id);
    setLayoutRules(newRules);
    layoutRulesRef.current = newRules;
    if (editorRef.current) {
      const innerHTML = editorRef.current.innerHTML;
      lastHtmlRef.current = innerHTML;
      onChange(embedRules(innerHTML, newRules));
    }
    setBadgePositions(prev => prev.filter(b => b.id !== id));
    if (activeBadgeId === id) setActiveBadgeId(null);
  }

  function scrollToRule(id: string) {
    const el = editorRef.current?.querySelector(`[data-rule-id="${id}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.outline = '2px solid #6366f1';
    setTimeout(() => { if (el) el.style.outline = ''; }, 1500);
  }

  function openDialog(type: 'dynamic' | 'block') {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && editorRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
    setInputVal('');
    setDialog(type);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function applyDynamic() {
    const fieldName = inputVal.trim();
    if (!fieldName || !savedRange.current) { setDialog(null); return; }

    // Restore selection then wrap
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(savedRange.current);

    const chip = document.createElement('span');
    chip.setAttribute('data-placeholder', fieldName);
    chip.setAttribute('class', 'pdf-placeholder');
    chip.setAttribute('contenteditable', 'false');
    chip.setAttribute('style',
      'display:inline-block;padding:1px 8px;border-radius:4px;' +
      'background:#fef3c7;border:1px solid #f59e0b;color:#92400e;' +
      'font-size:12px;font-weight:600;font-family:monospace;cursor:default;user-select:none;margin:0 2px'
    );
    chip.textContent = `{{${fieldName}}}`;

    try {
      savedRange.current.deleteContents();
      savedRange.current.insertNode(chip);
      // Move caret after chip
      const after = document.createRange();
      after.setStartAfter(chip);
      after.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(after);
    } catch { /* cross-boundary — ignore */ }

    if (editorRef.current) {
      const newHtml = editorRef.current.innerHTML;
      lastHtmlRef.current = newHtml; // prevent useEffect from re-injecting
      onChange(newHtml);
    }
    setDialog(null);
    setHasSelection(false);
    editorRef.current?.focus();
  }

  function applyBlock() {
    const blockId = inputVal.trim().replace(/\s+/g, '-').toLowerCase();
    if (!blockId || !savedRange.current) { setDialog(null); return; }

    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(savedRange.current);

    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-block-id', blockId);
    wrapper.setAttribute('style',
      'border:2px dashed #6366f1;border-radius:6px;margin:8px 0;overflow:hidden'
    );

    // Inline header bar — no absolute positioning needed
    const header = document.createElement('div');
    header.setAttribute('contenteditable', 'false');
    header.setAttribute('style',
      'display:flex;align-items:center;gap:6px;background:#6366f1;' +
      'color:white;font-size:10px;font-weight:600;padding:3px 10px;' +
      'font-family:monospace;letter-spacing:0.04em;user-select:none'
    );
    header.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
      '<rect x="3" y="3" width="18" height="18" rx="2"/></svg>' +
      ` block: ${blockId}`;
    wrapper.appendChild(header);

    // Content area
    const content = document.createElement('div');
    content.setAttribute('style', 'padding:8px 12px');
    try {
      const fragment = savedRange.current.extractContents();
      content.appendChild(fragment);
    } catch { /* ignore */ }
    wrapper.appendChild(content);

    try {
      savedRange.current.insertNode(wrapper);
    } catch { /* ignore */ }

    if (editorRef.current) {
      const newHtml = editorRef.current.innerHTML;
      lastHtmlRef.current = newHtml; // prevent useEffect from re-injecting
      onChange(newHtml);
    }
    setDialog(null);
    setHasSelection(false);
    editorRef.current?.focus();
  }

  function removeChipOrBlock(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    // Click on a chip's × button
    if (target.dataset.removeChip) {
      const chip = target.closest('[data-placeholder]') as HTMLElement;
      chip?.parentNode?.removeChild(chip);
      if (editorRef.current) onChange(editorRef.current.innerHTML);
      return;
    }
    // Double-click on a block badge removes the block wrapper (keeps inner content)
    if (target.dataset.removeBadge) {
      const block = target.closest('[data-block-id]') as HTMLElement;
      if (block) {
        const frag = document.createDocumentFragment();
        Array.from(block.childNodes).forEach(n => { if (n !== target) frag.appendChild(n.cloneNode(true)); });
        block.parentNode?.replaceChild(frag, block);
        if (editorRef.current) onChange(editorRef.current.innerHTML);
      }
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">

      {/* ── Top bar: mode toggle + word count ─────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-1 bg-slate-200 dark:bg-slate-700 rounded-md p-0.5">
          <button onClick={switchToEdit}
            className={`text-xs font-medium px-2.5 py-1 rounded transition-colors ${mode === 'edit' ? 'bg-white dark:bg-slate-600 text-slate-700 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}>
            Edit
          </button>
          <button onClick={switchToSource}
            className={`text-xs font-medium px-2.5 py-1 rounded transition-colors ${mode === 'source' ? 'bg-white dark:bg-slate-600 text-slate-700 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}>
            HTML Source
          </button>
        </div>
        {mode === 'edit' && (
          <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">{wordCount} words</span>
        )}
      </div>

      {/* ── Ribbon (edit mode only) ────────────────────────────────────────── */}
      {mode === 'edit' && (
        <>
          {/* Tab strip */}
          <div className="flex items-center px-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
            {(['formatting', 'insert', 'review', 'rules'] as RibbonTab[]).map(tab => (
              <button key={tab}
                onMouseDown={e => e.preventDefault()}
                onClick={() => setRibbonTab(tab)}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px capitalize transition-colors ${
                  ribbonTab === tab
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Ribbon content row */}
          <div className="flex items-center flex-wrap gap-1 px-3 py-2 min-h-[44px] bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700">

            {/* ── Formatting tab ─────────────────────────────────────────── */}
            {ribbonTab === 'formatting' && (
              <>
                {/* Text styles */}
                <RibbonBtn onClick={() => exec('bold')} title="Bold (Ctrl+B)">
                  <span className="font-bold text-sm leading-none">B</span>
                </RibbonBtn>
                <RibbonBtn onClick={() => exec('italic')} title="Italic (Ctrl+I)">
                  <span className="italic text-sm leading-none font-serif">I</span>
                </RibbonBtn>
                <RibbonBtn onClick={() => exec('underline')} title="Underline (Ctrl+U)">
                  <span className="underline text-sm leading-none">U</span>
                </RibbonBtn>
                <RibbonBtn onClick={() => exec('strikethrough')} title="Strikethrough">
                  <span className="line-through text-sm leading-none">S</span>
                </RibbonBtn>

                <RibbonSep />

                {/* Block format */}
                <RibbonBtn onClick={() => exec('formatBlock', 'h1')} title="Heading 1">
                  <span className="text-xs font-bold leading-none">H1</span>
                </RibbonBtn>
                <RibbonBtn onClick={() => exec('formatBlock', 'h2')} title="Heading 2">
                  <span className="text-xs font-bold leading-none">H2</span>
                </RibbonBtn>
                <RibbonBtn onClick={() => exec('formatBlock', 'h3')} title="Heading 3">
                  <span className="text-xs font-bold leading-none">H3</span>
                </RibbonBtn>
                <RibbonBtn onClick={() => exec('formatBlock', 'p')} title="Paragraph">
                  <span className="text-xs leading-none">¶</span>
                </RibbonBtn>

                <RibbonSep />

                {/* Alignment — proper line-based SVG icons */}
                <RibbonBtn onClick={() => exec('justifyLeft')} title="Align Left">
                  <svg viewBox="0 0 14 11" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1" y1="1.5" x2="13" y2="1.5"/>
                    <line x1="1" y1="4.5" x2="9"  y2="4.5"/>
                    <line x1="1" y1="7.5" x2="13" y2="7.5"/>
                    <line x1="1" y1="10"  x2="7"  y2="10"/>
                  </svg>
                </RibbonBtn>
                <RibbonBtn onClick={() => exec('justifyCenter')} title="Align Center">
                  <svg viewBox="0 0 14 11" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1"   y1="1.5" x2="13"  y2="1.5"/>
                    <line x1="3"   y1="4.5" x2="11"  y2="4.5"/>
                    <line x1="1"   y1="7.5" x2="13"  y2="7.5"/>
                    <line x1="3.5" y1="10"  x2="10.5" y2="10"/>
                  </svg>
                </RibbonBtn>
                <RibbonBtn onClick={() => exec('justifyRight')} title="Align Right">
                  <svg viewBox="0 0 14 11" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1"  y1="1.5" x2="13" y2="1.5"/>
                    <line x1="5"  y1="4.5" x2="13" y2="4.5"/>
                    <line x1="1"  y1="7.5" x2="13" y2="7.5"/>
                    <line x1="7"  y1="10"  x2="13" y2="10"/>
                  </svg>
                </RibbonBtn>
                <RibbonBtn onClick={() => exec('justifyFull')} title="Justify">
                  <svg viewBox="0 0 14 11" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1" y1="1.5" x2="13" y2="1.5"/>
                    <line x1="1" y1="4.5" x2="13" y2="4.5"/>
                    <line x1="1" y1="7.5" x2="13" y2="7.5"/>
                    <line x1="1" y1="10"  x2="13" y2="10"/>
                  </svg>
                </RibbonBtn>

                <RibbonSep />

                {/* Text color */}
                <div className="relative" data-cpicker>
                  <button onMouseDown={e => e.preventDefault()}
                    onClick={() => setColorPicker(p => p === 'text' ? null : 'text')}
                    title="Text Color"
                    className="flex flex-col items-center justify-center w-7 h-7 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                    <span className="text-xs font-bold leading-none text-slate-700 dark:text-slate-200">A</span>
                    <span className="w-4 h-1 rounded-sm mt-0.5 bg-red-600"/>
                  </button>
                  {colorPicker === 'text' && (
                    <div className="absolute top-full left-0 mt-1 z-20 p-1.5 flex gap-1 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700">
                      {TEXT_COLORS.map(c => (
                        <button key={c}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => { exec('foreColor', c); setColorPicker(null); }}
                          className="w-5 h-5 rounded border border-slate-300 dark:border-slate-600 hover:scale-125 transition-transform flex-shrink-0"
                          style={{ background: c }} title={c}/>
                      ))}
                    </div>
                  )}
                </div>

                {/* Highlight */}
                <div className="relative" data-cpicker>
                  <button onMouseDown={e => e.preventDefault()}
                    onClick={() => setColorPicker(p => p === 'highlight' ? null : 'highlight')}
                    title="Highlight Color"
                    className="flex flex-col items-center justify-center w-7 h-7 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="#f59e0b">
                      <path d="M17.66 7.93L12 2.27 6.34 7.93c-3.12 3.12-3.12 8.19 0 11.31C7.9 20.8 9.95 21.58 12 21.58c2.05 0 4.1-.78 5.66-2.34 3.12-3.12 3.12-8.19 0-11.31z"/>
                    </svg>
                    <span className="w-4 h-1 rounded-sm mt-0.5 bg-yellow-200"/>
                  </button>
                  {colorPicker === 'highlight' && (
                    <div className="absolute top-full left-0 mt-1 z-20 p-1.5 flex gap-1 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700">
                      {HILITE_COLORS.map(c => (
                        <button key={c}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => { exec('hiliteColor', c); setColorPicker(null); }}
                          className="w-5 h-5 rounded border border-slate-300 dark:border-slate-600 hover:scale-125 transition-transform flex-shrink-0"
                          style={{ background: c }} title={c}/>
                      ))}
                    </div>
                  )}
                </div>

                <RibbonSep />

                {/* Clear formatting */}
                <RibbonBtn onClick={() => exec('removeFormat')} title="Clear Formatting">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v9"/>
                    <line x1="3" y1="21" x2="21" y2="3"/>
                  </svg>
                </RibbonBtn>
              </>
            )}

            {/* ── Insert tab ─────────────────────────────────────────────── */}
            {ribbonTab === 'insert' && (
              <>
                {/* Table */}
                <div className="relative">
                  <RibbonLabelBtn onClick={() => setTableDialog(d => !d)} title="Insert Table">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <line x1="3" y1="9"  x2="21" y2="9"/>
                      <line x1="3" y1="15" x2="21" y2="15"/>
                      <line x1="9" y1="3"  x2="9"  y2="21"/>
                      <line x1="15" y1="3" x2="15" y2="21"/>
                    </svg>
                    Table
                  </RibbonLabelBtn>
                  {tableDialog && (
                    <div className="absolute top-full left-0 mt-1 z-20 p-3 w-52 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Table size</p>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div>
                          <label className="text-xs text-slate-500 dark:text-slate-400">Rows</label>
                          <input type="number" min={1} max={20} value={tableRows}
                            onChange={e => setTableRows(+e.target.value)}
                            className="w-full mt-0.5 text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-white"/>
                        </div>
                        <div>
                          <label className="text-xs text-slate-500 dark:text-slate-400">Columns</label>
                          <input type="number" min={1} max={10} value={tableCols}
                            onChange={e => setTableCols(+e.target.value)}
                            className="w-full mt-0.5 text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-white"/>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={insertTable} className="flex-1 py-1 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700">Insert</button>
                        <button onClick={() => setTableDialog(false)} className="text-xs text-slate-400 hover:text-slate-600 px-2">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Image */}
                <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageInsert}/>
                <RibbonLabelBtn onClick={() => imageInputRef.current?.click()} title="Insert Image">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  Image
                </RibbonLabelBtn>

                {/* Barcode */}
                <div className="relative">
                  <RibbonLabelBtn onClick={() => setBarcodeDialog(d => !d)} title="Insert Barcode">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <line x1="4"  y1="4" x2="4"  y2="20"/>
                      <line x1="7"  y1="4" x2="7"  y2="20"/>
                      <line x1="10" y1="4" x2="10" y2="20"/>
                      <line x1="12" y1="4" x2="12" y2="20"/>
                      <line x1="15" y1="4" x2="15" y2="20"/>
                      <line x1="18" y1="4" x2="18" y2="20"/>
                      <line x1="20" y1="4" x2="20" y2="20"/>
                    </svg>
                    Barcode
                  </RibbonLabelBtn>
                  {barcodeDialog && (
                    <div className="absolute top-full left-0 mt-1 z-20 p-3 w-56 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Barcode value</p>
                      <input value={barcodeValue} onChange={e => setBarcodeValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') insertBarcode(); if (e.key === 'Escape') setBarcodeDialog(false); }}
                        placeholder="e.g. REF-00123456"
                        className="w-full text-sm px-2 py-1.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-white font-mono mb-3"/>
                      <div className="flex gap-2">
                        <button onClick={insertBarcode} className="flex-1 py-1 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700">Insert</button>
                        <button onClick={() => setBarcodeDialog(false)} className="text-xs text-slate-400 hover:text-slate-600 px-2">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Horizontal rule */}
                <RibbonBtn onClick={() => exec('insertHorizontalRule')} title="Horizontal Rule">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="3" y1="12" x2="21" y2="12"/>
                    <line x1="3" y1="8"  x2="8"  y2="8" strokeWidth="1" strokeOpacity="0.4"/>
                    <line x1="3" y1="16" x2="8"  y2="16" strokeWidth="1" strokeOpacity="0.4"/>
                  </svg>
                </RibbonBtn>

                <RibbonSep />

                {/* Make Dynamic — moved from old toolbar */}
                <RibbonLabelBtn
                  onClick={() => openDialog('dynamic')}
                  disabled={!hasSelection}
                  title={hasSelection ? 'Wrap selection as a dynamic placeholder' : 'Select text first'}
                  variant="amber"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"/>
                  </svg>
                  Dynamic
                </RibbonLabelBtn>

                {/* Tag as Block — moved from old toolbar */}
                <RibbonLabelBtn
                  onClick={() => openDialog('block')}
                  disabled={!hasSelection}
                  title={hasSelection ? 'Tag selection as a conditional/loop block' : 'Select text first'}
                  variant="indigo"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-8 6h16"/>
                  </svg>
                  Block
                </RibbonLabelBtn>
              </>
            )}

            {/* ── Review tab ─────────────────────────────────────────────── */}
            {ribbonTab === 'review' && (
              <>
                {/* Spell check */}
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => setSpellCheckOn(s => !s)}
                  title="Toggle browser spell check"
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors ${
                    spellCheckOn
                      ? 'bg-green-50 dark:bg-green-900/30 border-green-400 dark:border-green-600 text-green-700 dark:text-green-300'
                      : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
                  </svg>
                  Spell Check {spellCheckOn ? '(On)' : '(Off)'}
                </button>

                <RibbonSep />

                {/* Word count badge */}
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 select-none">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="3" y1="6"  x2="21" y2="6"/>
                    <line x1="3" y1="12" x2="21" y2="12"/>
                    <line x1="3" y1="18" x2="15" y2="18"/>
                  </svg>
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{wordCount}</span> words
                </div>

                <RibbonSep />

                {/* Sentiment analysis */}
                <SentimentButton editorRef={editorRef}/>
              </>
            )}

            {/* ── Rules tab ──────────────────────────────────────────────── */}
            {ribbonTab === 'rules' && (
              <div className="flex items-center gap-2 w-full flex-wrap">
                <RibbonLabelBtn
                  onClick={openAddRule}
                  disabled={!hasSelection}
                  title={hasSelection ? 'Annotate selection with a rule' : 'Select text first'}
                  variant="indigo"
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Add Rule
                </RibbonLabelBtn>
                <RibbonSep />
                {layoutRules.length === 0 ? (
                  <span className="text-xs text-slate-400 dark:text-slate-500">No rules — select text then click Add Rule</span>
                ) : (
                  <div className="flex items-center gap-1 flex-wrap">
                    {layoutRules.map((r, i) => (
                      <div key={r.id} className="flex items-center gap-0.5 pl-1 pr-0.5 py-0.5 rounded-full text-xs bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 max-w-[200px]">
                        <button
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => scrollToRule(r.id)}
                          title="Scroll to annotated element"
                          className="flex items-center gap-1 hover:opacity-80 min-w-0"
                        >
                          <span className="w-4 h-4 rounded-full bg-indigo-500 text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                          <span className="truncate max-w-[80px]">{r.label}</span>
                          <span className={`text-[9px] px-1 rounded-full flex-shrink-0 ${TYPE_COLORS[r.type]}`}>{r.type.slice(0, 4)}</span>
                        </button>
                        <button
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => openEditRule(r.id)}
                          title="Edit rule"
                          className="ml-0.5 p-0.5 opacity-50 hover:opacity-100 hover:text-indigo-600 flex-shrink-0"
                        >
                          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => deleteRule(r.id)}
                          title="Delete rule"
                          className="p-0.5 opacity-50 hover:opacity-100 hover:text-red-500 flex-shrink-0"
                        >
                          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Rule add/edit dialog ─────────────────────────────────────────── */}
      {ruleDialog && (
        <div className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
          <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 mb-2">
            {ruleDialog.mode === 'add' ? 'Add Rule' : 'Edit Rule'}
          </p>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-0.5">Label *</label>
              <input ref={ruleFormRef} value={ruleForm.label}
                onChange={e => setRuleForm(f => ({ ...f, label: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') saveRule(); if (e.key === 'Escape') setRuleDialog(null); }}
                placeholder="e.g. Premium Only"
                className="w-full text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-white"/>
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-0.5">Type</label>
              <select value={ruleForm.type}
                onChange={e => setRuleForm(f => ({ ...f, type: e.target.value as LayoutAnnotation['type'] }))}
                className="w-full text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-white">
                <option value="conditional">Conditional</option>
                <option value="validation">Validation</option>
                <option value="visibility">Visibility</option>
                <option value="formatting">Formatting</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-0.5">Condition</label>
              <input value={ruleForm.condition}
                onChange={e => setRuleForm(f => ({ ...f, condition: e.target.value }))}
                placeholder="e.g. policyType === 'premium'"
                className="w-full text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-white font-mono"/>
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-0.5">Action</label>
              <input value={ruleForm.action}
                onChange={e => setRuleForm(f => ({ ...f, action: e.target.value }))}
                placeholder="e.g. show this block"
                className="w-full text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-white"/>
            </div>
          </div>
          <div className="mb-2">
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-0.5">Notes (optional)</label>
            <input value={ruleForm.notes}
              onChange={e => setRuleForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Additional context…"
              className="w-full text-sm px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-white"/>
          </div>
          <div className="flex gap-2">
            <button onClick={saveRule} disabled={!ruleForm.label.trim()}
              className="px-3 py-1 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 disabled:opacity-40">
              {ruleDialog.mode === 'add' ? 'Add Rule' : 'Save Changes'}
            </button>
            <button onClick={() => setRuleDialog(null)} className="text-xs text-slate-400 hover:text-slate-600 px-2">Cancel</button>
          </div>
        </div>
      )}

      {/* ── Inline dialogs (dynamic / block) ─────────────────────────────── */}
      {dialog && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          {dialog === 'dynamic' ? (
            <>
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300 whitespace-nowrap">Field name:</span>
              <input ref={inputRef} value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyDynamic(); if (e.key === 'Escape') setDialog(null); }}
                placeholder="e.g. customerName"
                className="flex-1 text-sm px-2 py-1 rounded border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 text-slate-800 dark:text-white font-mono min-w-0"/>
              <button onClick={applyDynamic} className="px-3 py-1 bg-amber-500 text-white rounded text-xs font-medium hover:bg-amber-600 whitespace-nowrap">Add Chip</button>
              <button onClick={() => setDialog(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            </>
          ) : (
            <>
              <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300 whitespace-nowrap">Block ID:</span>
              <input ref={inputRef} value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyBlock(); if (e.key === 'Escape') setDialog(null); }}
                placeholder="e.g. premium-section"
                className="flex-1 text-sm px-2 py-1 rounded border border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 text-slate-800 dark:text-white font-mono min-w-0"/>
              <button onClick={applyBlock} className="px-3 py-1 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 whitespace-nowrap">Tag Block</button>
              <button onClick={() => setDialog(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            </>
          )}
        </div>
      )}

      {/* ── Editor / Source ───────────────────────────────────────────────── */}
      {mode === 'edit' ? (
        <div className="relative overflow-hidden">
          <div ref={editorRef} contentEditable suppressContentEditableWarning
            onInput={handleInput} onClick={removeChipOrBlock}
            spellCheck={spellCheckOn}
            className="p-6 min-h-[420px] bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 outline-none overflow-auto"
            style={{ fontFamily: 'Arial, sans-serif', fontSize: '14px', lineHeight: '1.7' }}/>

          {/* Badge overlay */}
          <div ref={overlayRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
            {badgePositions.map(bp => (
              <div key={bp.id} className="absolute pointer-events-auto" style={{
                top: bp.top,
                left: bp.left + bp.width,
                transform: 'translate(-100%, -50%)',
              }}>
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => setActiveBadgeId(id => id === bp.id ? null : bp.id)}
                  className="w-5 h-5 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shadow-md ring-1 ring-white dark:ring-slate-900 transition-colors"
                  title={`Rule: ${layoutRulesRef.current.find(r => r.id === bp.id)?.label ?? ''}`}
                >
                  {bp.index}
                </button>

                {activeBadgeId === bp.id && (() => {
                  const rule = layoutRulesRef.current.find(r => r.id === bp.id);
                  if (!rule) return null;
                  return (
                    <div data-badge-popup className="absolute right-0 top-6 w-56 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 p-3 z-20">
                      <div className="flex items-start justify-between gap-1 mb-1.5">
                        <span className="text-sm font-semibold text-slate-800 dark:text-white leading-tight">{rule.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${TYPE_COLORS[rule.type]}`}>{rule.type}</span>
                      </div>
                      {rule.condition && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">
                          <span className="font-medium text-slate-600 dark:text-slate-300">If: </span>{rule.condition}
                        </p>
                      )}
                      {rule.action && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">
                          <span className="font-medium text-slate-600 dark:text-slate-300">Then: </span>{rule.action}
                        </p>
                      )}
                      {rule.notes && (
                        <p className="text-xs text-slate-400 dark:text-slate-500 italic mt-1">{rule.notes}</p>
                      )}
                      <div className="flex gap-1.5 mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                        <button
                          onClick={() => { setActiveBadgeId(null); openEditRule(rule.id); }}
                          className="flex-1 text-xs py-1 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
                        >Edit</button>
                        <button
                          onClick={() => { setActiveBadgeId(null); deleteRule(rule.id); }}
                          className="flex-1 text-xs py-1 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40"
                        >Delete</button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <textarea value={extractRules(html).clean} onChange={e => onChange(embedRules(e.target.value, layoutRulesRef.current))}
          className="w-full h-[420px] p-4 font-mono text-xs bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 resize-none outline-none"
          spellCheck={false}/>
      )}

      {/* ── Help strip ────────────────────────────────────────────────────── */}
      {mode === 'edit' && (
        <div className="px-4 py-1.5 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500">
          <span><span className="font-mono text-amber-600 dark:text-amber-400">{'{{field}}'}</span> — dynamic placeholder</span>
          <span><span className="font-mono text-indigo-500">block:id</span> — conditional / loop region</span>
          <span className="ml-auto">Switch to HTML Source for raw editing</span>
        </div>
      )}
    </div>
  );
}

// ── CURL Doc Modal ────────────────────────────────────────────────────────────
function FetchDocModal({
  template,
  fields,
  token,
  onClose,
}: {
  template: PdfTemplate;
  fields: PdfTemplateField[];
  token: string;
  onClose: () => void;
}) {
  const [apiKeys, setApiKeys] = useState<PdfApiKey[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch('/v1/pdf-studio/api-keys', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setApiKeys(d.keys ?? []))
      .catch(() => {});
  }, [token]);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const endpoint = `${baseUrl}/v1/pdf-render/${encodeURIComponent(template.name)}`;

  const firstKey = apiKeys[0];
  const bearerHint = firstKey ? `${firstKey.key_prefix}...` : '<YOUR_API_KEY>';
  const keyName    = firstKey ? ` (${firstKey.name})` : '';

  const payloadObj: Record<string, string> = {};
  fields.forEach(f => { payloadObj[f.field_name] = f.default_value || ''; });
  const payloadJson = JSON.stringify({ data: payloadObj }, null, 2);

  const curlCmd =
    `curl -X POST "${endpoint}" \\\n` +
    `  -H "Authorization: Bearer ${bearerHint}" \\\n` +
    `  -H "Content-Type: application/json" \\\n` +
    `  -d '${JSON.stringify({ data: payloadObj })}' \\\n` +
    `  --output document.pdf`;

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <h3 className="font-semibold text-slate-800 dark:text-white">CURL Doc</h3>
            <span className="text-sm text-slate-400 dark:text-slate-500">— {template.name}</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Endpoint */}
          <Section label="Endpoint">
            <CodeRow value={`POST  ${endpoint}`} onCopy={() => copy(endpoint, 'url')} copied={copied === 'url'} />
          </Section>

          {/* Auth */}
          <Section label="Authorization">
            {apiKeys.length === 0 ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                No API keys found. Create one in the <strong>API Keys</strong> tab first.
              </p>
            ) : (
              <>
                <CodeRow
                  value={`Bearer ${bearerHint}${keyName}`}
                  onCopy={() => copy(`Bearer ${bearerHint}`, 'auth')}
                  copied={copied === 'auth'}
                />
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
                  Only the key prefix is shown here. Use the full key that was displayed when you created it.
                </p>
              </>
            )}
          </Section>

          {/* Payload */}
          <Section label="Payload">
            {fields.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">
                No schema fields defined — add them in the Schema tab.
              </p>
            ) : null}
            <div className="relative">
              <pre className="text-xs font-mono bg-slate-50 dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700 overflow-x-auto text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{payloadJson}</pre>
              <CopyBtn onCopy={() => copy(payloadJson, 'payload')} copied={copied === 'payload'} />
            </div>
          </Section>

          {/* curl */}
          <Section label="curl Command">
            <div className="relative">
              <pre className="text-xs font-mono bg-slate-900 dark:bg-black rounded-lg p-3 overflow-x-auto text-green-400 whitespace-pre-wrap">{curlCmd}</pre>
              <CopyBtn onCopy={() => copy(curlCmd, 'curl')} copied={copied === 'curl'} dark />
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
              On Windows PowerShell add <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">--ssl-no-revoke</code> and replace <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">'…'</code> with <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">"…"</code> with escaped inner quotes.
            </p>
          </Section>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">{label}</p>
      {children}
    </div>
  );
}

function CodeRow({ value, onCopy, copied }: { value: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
      <code className="flex-1 text-xs font-mono text-slate-700 dark:text-slate-300 truncate">{value}</code>
      <button
        onClick={onCopy}
        className="flex-shrink-0 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 font-medium"
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}

function CopyBtn({ onCopy, copied, dark }: { onCopy: () => void; copied: boolean; dark?: boolean }) {
  return (
    <button
      onClick={onCopy}
      className={`absolute top-2 right-2 text-xs px-2 py-1 rounded font-medium transition-colors ${
        dark
          ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600'
      }`}
    >
      {copied ? '✓' : 'Copy'}
    </button>
  );
}
