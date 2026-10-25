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

  // Set editor content when html prop changes externally or mode switches to edit
  useEffect(() => {
    if (mode === 'edit' && editorRef.current) {
      suppressInput.current = true;
      editorRef.current.innerHTML = html;
      suppressInput.current = false;
    }
  }, [mode]);

  // Also populate on first mount
  useEffect(() => {
    if (editorRef.current && html) {
      suppressInput.current = true;
      editorRef.current.innerHTML = html;
      suppressInput.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // If html changes externally (e.g. template loaded from server) while in edit mode, sync it in
  const lastHtmlRef = useRef(html);
  useEffect(() => {
    if (html !== lastHtmlRef.current && mode === 'edit' && editorRef.current) {
      lastHtmlRef.current = html;
      suppressInput.current = true;
      editorRef.current.innerHTML = html;
      suppressInput.current = false;
    }
    lastHtmlRef.current = html;
  }, [html, mode]);

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

  function handleInput() {
    if (suppressInput.current) return;
    if (editorRef.current) {
      lastHtmlRef.current = editorRef.current.innerHTML;
      onChange(editorRef.current.innerHTML);
    }
  }

  // Switch to source: read current DOM
  function switchToSource() {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
    setMode('source');
  }

  // Switch to edit: apply source changes to DOM
  function switchToEdit() {
    setMode('edit');
    // useEffect will sync html → innerHTML
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
      {/* ── Toolbar ── */}
      <div className="flex items-center flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
        {/* Mode tabs */}
        <div className="flex items-center gap-1 bg-slate-200 dark:bg-slate-700 rounded-md p-0.5">
          <button
            onClick={switchToEdit}
            className={`text-xs font-medium px-2.5 py-1 rounded transition-colors ${
              mode === 'edit' ? 'bg-white dark:bg-slate-600 text-slate-700 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
            }`}
          >
            Edit
          </button>
          <button
            onClick={switchToSource}
            className={`text-xs font-medium px-2.5 py-1 rounded transition-colors ${
              mode === 'source' ? 'bg-white dark:bg-slate-600 text-slate-700 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
            }`}
          >
            HTML Source
          </button>
        </div>

        {mode === 'edit' && (
          <>
            <div className="h-4 w-px bg-slate-300 dark:bg-slate-600" />

            {/* Make Dynamic */}
            <button
              onClick={() => openDialog('dynamic')}
              disabled={!hasSelection}
              title={hasSelection ? 'Wrap selection as a dynamic placeholder' : 'Select text first'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                hasSelection
                  ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300 hover:bg-amber-100'
                  : 'border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-500 cursor-not-allowed'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
              </svg>
              Make Dynamic
            </button>

            {/* Tag as Block */}
            <button
              onClick={() => openDialog('block')}
              disabled={!hasSelection}
              title={hasSelection ? 'Tag selection as a conditional/loop block' : 'Select text first'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                hasSelection
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100'
                  : 'border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-500 cursor-not-allowed'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-8 6h16" />
              </svg>
              Tag as Block
            </button>

            <div className="flex-1" />
            <span className="text-xs text-slate-400 dark:text-slate-500 hidden sm:block">
              Select text, then use the buttons above
            </span>
          </>
        )}
      </div>

      {/* ── Inline dialogs ── */}
      {dialog && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          {dialog === 'dynamic' ? (
            <>
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300 whitespace-nowrap">Field name:</span>
              <input
                ref={inputRef}
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyDynamic(); if (e.key === 'Escape') setDialog(null); }}
                placeholder="e.g. customerName"
                className="flex-1 text-sm px-2 py-1 rounded border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 text-slate-800 dark:text-white font-mono min-w-0"
              />
              <button onClick={applyDynamic} className="px-3 py-1 bg-amber-500 text-white rounded text-xs font-medium hover:bg-amber-600 whitespace-nowrap">Add Chip</button>
              <button onClick={() => setDialog(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            </>
          ) : (
            <>
              <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300 whitespace-nowrap">Block ID:</span>
              <input
                ref={inputRef}
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyBlock(); if (e.key === 'Escape') setDialog(null); }}
                placeholder="e.g. premium-section"
                className="flex-1 text-sm px-2 py-1 rounded border border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 text-slate-800 dark:text-white font-mono min-w-0"
              />
              <button onClick={applyBlock} className="px-3 py-1 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 whitespace-nowrap">Tag Block</button>
              <button onClick={() => setDialog(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            </>
          )}
        </div>
      )}

      {/* ── Editor / Source ── */}
      {mode === 'edit' ? (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onClick={removeChipOrBlock}
          className="p-6 min-h-[420px] bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 outline-none overflow-auto"
          style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            lineHeight: '1.7',
          }}
        />
      ) : (
        <textarea
          value={html}
          onChange={e => onChange(e.target.value)}
          className="w-full h-[420px] p-4 font-mono text-xs bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 resize-none outline-none"
          spellCheck={false}
        />
      )}

      {/* Help strip */}
      {mode === 'edit' && (
        <div className="px-4 py-1.5 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500">
          <span><span className="font-mono text-amber-600 dark:text-amber-400">{'{{field}}'}</span> — dynamic placeholder chip</span>
          <span><span className="font-mono text-indigo-500">block:id</span> — conditional / loop region</span>
          <span className="ml-auto">Click a chip to select · Switch to HTML Source for raw editing</span>
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
