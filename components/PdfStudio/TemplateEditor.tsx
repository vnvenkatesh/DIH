import React, { useState, useCallback, useRef } from 'react';
import { PdfTemplate, PdfTemplateField, PdfTemplateRule } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import SchemaEditor from './SchemaEditor';
import RuleEditor from './RuleEditor';

interface Props {
  template: PdfTemplate | null;
  onSaved: () => void;
  onCancel: () => void;
}

type Step = 'upload' | 'edit' | 'schema' | 'rules';

export default function TemplateEditor({ template, onSaved, onCancel }: Props) {
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

  const STEPS: { id: Step; label: string }[] = [
    { id: 'upload', label: '1. Upload' },
    { id: 'edit', label: '2. Edit' },
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
          <RuleEditor fields={fields} rules={rules} onChange={setRules} />
        </div>
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

// ── Simple HTML Editor ────────────────────────────────────────────────────────
function HtmlEditor({ html, onChange }: { html: string; onChange: (h: string) => void }) {
  const [activeTab, setActiveTab] = useState<'preview' | 'source'>('preview');

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-4 py-2 gap-2">
        <button
          onClick={() => setActiveTab('preview')}
          className={`text-xs font-medium px-2 py-1 rounded transition-colors ${
            activeTab === 'preview'
              ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white'
          }`}
        >
          Preview
        </button>
        <button
          onClick={() => setActiveTab('source')}
          className={`text-xs font-medium px-2 py-1 rounded transition-colors ${
            activeTab === 'source'
              ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white'
          }`}
        >
          HTML Source
        </button>
        <div className="flex-1" />
        <span className="text-xs text-slate-400 dark:text-slate-500">
          Placeholders show as <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded text-amber-600 dark:text-amber-400">{'{{field}}'}</code> chips
        </span>
      </div>

      {activeTab === 'preview' ? (
        <div
          className="p-6 min-h-[400px] bg-white dark:bg-slate-900 prose dark:prose-invert max-w-none overflow-auto"
          style={{ fontFamily: 'Arial, sans-serif', fontSize: '14px', lineHeight: '1.6' }}
          dangerouslySetInnerHTML={{ __html: styledHtml(html) }}
        />
      ) : (
        <textarea
          value={html}
          onChange={e => onChange(e.target.value)}
          className="w-full h-[400px] p-4 font-mono text-xs bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 resize-none outline-none"
          spellCheck={false}
        />
      )}
    </div>
  );
}

function styledHtml(html: string) {
  // Inject inline styles for placeholder chips in the preview
  return html.replace(
    /(<span\s+data-placeholder="[^"]+"\s*[^>]*>)(.*?)(<\/span>)/g,
    '<span style="display:inline-block;padding:1px 6px;border-radius:4px;background:#fef3c7;border:1px solid #f59e0b;color:#92400e;font-size:12px;font-weight:600;font-family:monospace">$2</span>'
  );
}
