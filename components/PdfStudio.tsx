import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Template {
  id: number;
  name: string;
  description: string;
  html_content: string;
  original_format: string;
  created_at: string;
  updated_at: string;
}

interface TemplateField {
  _key?: string;
  field_name: string;
  field_type: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'object';
  is_required: boolean;
  default_value: string;
  description: string;
  parent_field: string;
}

interface TemplateRule {
  _key?: string;
  block_id: string;
  rule_type: 'condition' | 'loop';
  rule_config: {
    field?: string;
    operator?: string;
    value?: string;
    arrayField?: string;
  };
}

interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
}

type ActiveTab = 'templates' | 'apikeys';
type EditorStep = 1 | 2 | 3 | 4 | 5;

interface Props {
  onBack: () => void;
  onOpenFetchDoc: (init: { url: string; bearerToken: string; jsonBody: string }) => void;
}

const FIELD_TYPES = ['string', 'number', 'date', 'boolean', 'array', 'object'] as const;
const OPERATORS = ['equals', 'not_equals', 'contains', 'not_empty', 'is_empty', 'gt', 'lt'] as const;

function uid() {
  return Math.random().toString(36).slice(2);
}

// ── API helpers ───────────────────────────────────────────────────────────────

function apiFetch(path: string, token: string, opts: RequestInit = {}) {
  return fetch(path, {
    ...opts,
    headers: {
      ...(opts.headers as Record<string, string> ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

function buildSampleJson(fields: TemplateField[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.default_value) { obj[f.field_name] = f.default_value; continue; }
    switch (f.field_type) {
      case 'number':  obj[f.field_name] = 0; break;
      case 'boolean': obj[f.field_name] = false; break;
      case 'date':    obj[f.field_name] = new Date().toISOString().slice(0, 10); break;
      case 'array':   obj[f.field_name] = []; break;
      case 'object':  obj[f.field_name] = {}; break;
      default:        obj[f.field_name] = `<${f.field_name}>`; break;
    }
  }
  return obj;
}

// ── PdfStudio component ────────────────────────────────────────────────────────

const PdfStudio: React.FC<Props> = ({ onBack, onOpenFetchDoc }) => {
  const { token } = useAuth();

  // ── List view state ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>('templates');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  // ── API key creation ──────────────────────────────────────────────────────
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyCreating, setKeyCreating] = useState(false);

  // ── Editor state ──────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editorStep, setEditorStep] = useState<EditorStep>(1);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [tplName, setTplName] = useState('');
  const [tplDescription, setTplDescription] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [originalFormat, setOriginalFormat] = useState('docx');
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [rules, setRules] = useState<TemplateRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);

  // ── Preview ───────────────────────────────────────────────────────────────
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // ── Editor refs ───────────────────────────────────────────────────────────
  const editorRef = useRef<HTMLDivElement>(null);

  // ── Load list data ────────────────────────────────────────────────────────
  const loadTemplates = useCallback(async () => {
    if (!token) return;
    setListLoading(true); setListError('');
    try {
      const r = await apiFetch('/v1/pdf-studio/templates', token);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Failed to load templates');
      setTemplates(j.templates ?? []);
    } catch (e: any) {
      setListError(e.message);
    } finally {
      setListLoading(false);
    }
  }, [token]);

  const loadApiKeys = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiFetch('/v1/pdf-studio/templates/api-keys/list', token);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Failed to load keys');
      setApiKeys(j.keys ?? []);
    } catch {}
  }, [token]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useEffect(() => { if (activeTab === 'apikeys') loadApiKeys(); }, [activeTab, loadApiKeys]);

  // ── Open template for editing ─────────────────────────────────────────────
  const openEditor = async (tpl?: Template) => {
    setSaveError(''); setUploadError(''); setPreviewHtml(''); setPreviewError('');
    if (tpl) {
      setEditingId(tpl.id);
      setTplName(tpl.name);
      setTplDescription(tpl.description ?? '');
      setOriginalFormat(tpl.original_format ?? 'docx');
      // Load full template with fields + rules
      const r = await apiFetch(`/v1/pdf-studio/templates/${tpl.id}`, token!);
      const j = await r.json();
      setHtmlContent(j.template?.html_content ?? tpl.html_content ?? '');
      setFields((j.fields ?? []).map((f: any) => ({ ...f, _key: uid() })));
      setRules((j.rules ?? []).map((r: any) => ({
        _key: uid(),
        block_id: r.block_id,
        rule_type: r.rule_type,
        rule_config: typeof r.rule_config === 'string' ? JSON.parse(r.rule_config) : (r.rule_config ?? {}),
      })));
      setEditorStep(2);
    } else {
      setEditingId(null);
      setTplName('');
      setTplDescription('');
      setHtmlContent('');
      setOriginalFormat('docx');
      setFields([]);
      setRules([]);
      setEditorStep(1);
    }
    setEditing(true);
  };

  // Keep editor div in sync when htmlContent changes programmatically
  useEffect(() => {
    if (editorRef.current && editorStep === 2) {
      if (editorRef.current.innerHTML !== htmlContent) {
        editorRef.current.innerHTML = htmlContent;
      }
    }
  }, [htmlContent, editorStep]);

  const captureEditorHtml = () => {
    if (editorRef.current) setHtmlContent(editorRef.current.innerHTML);
  };

  // ── Upload DOCX/HTML ──────────────────────────────────────────────────────
  const handleUpload = async (file: File) => {
    setUploading(true); setUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await apiFetch('/v1/pdf-studio/templates/upload', token!, { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Upload failed');
      setHtmlContent(j.html ?? '');
      setOriginalFormat(j.originalFormat ?? 'docx');
      // Auto-populate fields from detected placeholders
      const detected: string[] = j.placeholders ?? [];
      if (detected.length && fields.length === 0) {
        setFields(detected.map(p => ({
          _key: uid(), field_name: p, field_type: 'string',
          is_required: false, default_value: '', description: '', parent_field: '',
        })));
      }
      setEditorStep(2);
    } catch (e: any) {
      setUploadError(e.message);
    } finally {
      setUploading(false);
    }
  };

  // ── Save template ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    captureEditorHtml();
    if (!tplName.trim()) { setSaveError('Template name is required'); return; }
    setSaving(true); setSaveError('');
    try {
      const body = {
        name: tplName.trim(),
        description: tplDescription,
        html_content: editorRef.current?.innerHTML ?? htmlContent,
        original_format: originalFormat,
        fields: fields.map(({ _key, ...f }) => f),
        rules: rules.map(({ _key, ...r }) => r),
      };
      const path = editingId
        ? `/v1/pdf-studio/templates/${editingId}`
        : '/v1/pdf-studio/templates';
      const r = await apiFetch(path, token!, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Save failed');
      if (!editingId) setEditingId(j.template?.id ?? null);
      await loadTemplates();
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Preview ───────────────────────────────────────────────────────────────
  const handlePreview = async () => {
    captureEditorHtml();
    setPreviewing(true); setPreviewError(''); setPreviewHtml('');
    try {
      const sample = buildSampleJson(fields);
      const r = await apiFetch('/v1/pdf-studio/templates/preview', token!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html_content: editorRef.current?.innerHTML ?? htmlContent,
          rules: rules.map(({ _key, ...r }) => r),
          sample_data: sample,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Preview failed');
      setPreviewHtml(j.html ?? '');
      setEditorStep(5);
    } catch (e: any) {
      setPreviewError(e.message);
    } finally {
      setPreviewing(false);
    }
  };

  // ── Duplicate template ────────────────────────────────────────────────────
  const handleDuplicate = async (tpl: Template) => {
    const r = await apiFetch(`/v1/pdf-studio/templates/${tpl.id}`, token!);
    const j = await r.json();
    setEditingId(null);
    setTplName(`${tpl.name} (copy)`);
    setTplDescription(tpl.description ?? '');
    setOriginalFormat(tpl.original_format ?? 'docx');
    setHtmlContent(j.template?.html_content ?? tpl.html_content ?? '');
    setFields((j.fields ?? []).map((f: any) => ({ ...f, _key: uid() })));
    setRules((j.rules ?? []).map((r: any) => ({
      _key: uid(), block_id: r.block_id, rule_type: r.rule_type,
      rule_config: typeof r.rule_config === 'string' ? JSON.parse(r.rule_config) : (r.rule_config ?? {}),
    })));
    setEditorStep(2);
    setEditing(true);
  };

  // ── Delete template ───────────────────────────────────────────────────────
  const handleDelete = async (id: number) => {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    await apiFetch(`/v1/pdf-studio/templates/${id}`, token!, { method: 'DELETE' });
    await loadTemplates();
  };

  // ── FetchDoc shortcut ─────────────────────────────────────────────────────
  const handleFetchDoc = async (tpl: Template) => {
    // Get the full template to build sample JSON
    const r = await apiFetch(`/v1/pdf-studio/templates/${tpl.id}`, token!);
    const j = await r.json();
    const tplFields: TemplateField[] = (j.fields ?? []).map((f: any) => ({ ...f, _key: uid() }));
    const sample = buildSampleJson(tplFields);
    const renderUrl = `${window.location.origin}/v1/pdf-render/${tpl.id}`;
    onOpenFetchDoc({
      url: renderUrl,
      bearerToken: '',
      jsonBody: JSON.stringify({ data: sample }, null, 2),
    });
  };

  // ── API key creation ──────────────────────────────────────────────────────
  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setKeyCreating(true);
    try {
      const r = await apiFetch('/v1/pdf-studio/templates/api-keys', token!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Failed to create key');
      setCreatedKey(j.key?.raw_key ?? null);
      setNewKeyName('');
      await loadApiKeys();
    } catch {}
    finally { setKeyCreating(false); }
  };

  const handleRevokeKey = async (id: number) => {
    if (!confirm('Revoke this API key?')) return;
    await apiFetch(`/v1/pdf-studio/templates/api-keys/${id}`, token!, { method: 'DELETE' });
    await loadApiKeys();
  };

  // ── Insert placeholder into editor ────────────────────────────────────────
  const insertPlaceholder = (fieldName: string) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    const chip = `<span data-placeholder="${fieldName}" class="pdf-placeholder" contenteditable="false" style="background:#dbeafe;color:#1e40af;border-radius:3px;padding:0 4px;font-size:.85em;user-select:none">{{${fieldName}}}</span>&nbsp;`;
    document.execCommand('insertHTML', false, chip);
    setHtmlContent(editorRef.current.innerHTML);
  };

  // ── Toolbar command ───────────────────────────────────────────────────────
  const execCmd = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    if (editorRef.current) setHtmlContent(editorRef.current.innerHTML);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER — Editor view
  // ═══════════════════════════════════════════════════════════════════════════
  if (editing) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900">

        {/* Header */}
        <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-3 flex items-center gap-4 shadow-sm">
          <button onClick={() => { setEditing(false); loadTemplates(); }}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-800 dark:hover:text-white text-sm font-medium transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Templates
          </button>
          <div className="h-5 w-px bg-slate-200 dark:bg-slate-600" />
          <input
            value={tplName}
            onChange={e => setTplName(e.target.value)}
            placeholder="Template name…"
            className="flex-1 text-lg font-semibold bg-transparent border-none outline-none text-slate-900 dark:text-white placeholder-slate-400"
          />
          <div className="flex items-center gap-2">
            <button onClick={handlePreview} disabled={previewing || !htmlContent}
              className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors">
              {previewing ? 'Rendering…' : 'Preview'}
            </button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors font-medium">
              {saving ? 'Saving…' : 'Save Template'}
            </button>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-2 flex items-center gap-0">
          {(['Upload', 'Edit', 'Schema', 'Rules', 'Preview'] as const).map((label, idx) => {
            const step = (idx + 1) as EditorStep;
            const isActive = editorStep === step;
            const isDone = editorStep > step;
            return (
              <React.Fragment key={step}>
                {idx > 0 && <div className={`h-px w-8 ${isDone ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-slate-600'}`} />}
                <button
                  onClick={() => { if (step < 5 || previewHtml) { captureEditorHtml(); setEditorStep(step); } }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    isActive ? 'bg-indigo-600 text-white' :
                    isDone ? 'text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20' :
                    'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                  }`}>
                  <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${
                    isActive ? 'bg-white text-indigo-600' :
                    isDone ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-600' :
                    'bg-slate-200 dark:bg-slate-600 text-slate-500'
                  }`}>{isDone ? '✓' : step}</span>
                  {label}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {saveError && (
          <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-700 px-6 py-2 text-sm text-red-700 dark:text-red-400">
            {saveError}
          </div>
        )}

        {/* Step content */}
        <div className="flex-1 flex overflow-hidden">

          {/* ── Step 1: Upload ── */}
          {editorStep === 1 && (
            <div className="flex-1 flex items-center justify-center p-10">
              <div className="max-w-lg w-full">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">Upload template document</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Upload a Word (.docx) or HTML (.html) file. Use <code>{'{{fieldName}}'}</code>, <code>{'[fieldName]'}</code> or <code>{'<fieldName>'}</code> as placeholders.</p>
                <DropZone onFile={handleUpload} uploading={uploading} />
                {uploadError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{uploadError}</p>}
                <div className="mt-6 text-center">
                  <button onClick={() => { setHtmlContent('<p>Start typing your template here…</p>'); setEditorStep(2); }}
                    className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                    Or start with a blank template →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Edit ── */}
          {editorStep === 2 && (
            <div className="flex-1 flex overflow-hidden">
              {/* Editor area */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Toolbar */}
                <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-3 py-1.5 flex flex-wrap items-center gap-1">
                  <ToolbarBtn onClick={() => execCmd('bold')} title="Bold"><strong>B</strong></ToolbarBtn>
                  <ToolbarBtn onClick={() => execCmd('italic')} title="Italic"><em>I</em></ToolbarBtn>
                  <ToolbarBtn onClick={() => execCmd('underline')} title="Underline"><u>U</u></ToolbarBtn>
                  <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
                  <ToolbarBtn onClick={() => execCmd('formatBlock', 'h1')} title="Heading 1">H1</ToolbarBtn>
                  <ToolbarBtn onClick={() => execCmd('formatBlock', 'h2')} title="Heading 2">H2</ToolbarBtn>
                  <ToolbarBtn onClick={() => execCmd('formatBlock', 'p')} title="Paragraph">¶</ToolbarBtn>
                  <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
                  <ToolbarBtn onClick={() => execCmd('insertUnorderedList')} title="Bullet list">• List</ToolbarBtn>
                  <ToolbarBtn onClick={() => execCmd('insertOrderedList')} title="Numbered list">1. List</ToolbarBtn>
                  <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
                  <ToolbarBtn onClick={() => execCmd('justifyLeft')} title="Left">⬤L</ToolbarBtn>
                  <ToolbarBtn onClick={() => execCmd('justifyCenter')} title="Center">⬤C</ToolbarBtn>
                  <ToolbarBtn onClick={() => execCmd('justifyRight')} title="Right">⬤R</ToolbarBtn>
                  <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
                  <ToolbarBtn onClick={() => execCmd('undo')} title="Undo">↩</ToolbarBtn>
                  <ToolbarBtn onClick={() => execCmd('redo')} title="Redo">↪</ToolbarBtn>
                </div>
                {/* Page */}
                <div className="flex-1 overflow-y-auto bg-slate-200 dark:bg-slate-700 p-6">
                  <div className="max-w-[800px] mx-auto bg-white dark:bg-slate-900 shadow-lg rounded min-h-[1000px] p-12">
                    <div
                      ref={editorRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={() => { if (editorRef.current) setHtmlContent(editorRef.current.innerHTML); }}
                      className="outline-none min-h-[800px] text-slate-800 dark:text-slate-200 leading-relaxed"
                      style={{ fontFamily: 'Arial, sans-serif', fontSize: '14px' }}
                    />
                  </div>
                </div>
              </div>
              {/* Fields panel */}
              <FieldsPanel fields={fields} onInsert={insertPlaceholder} onNext={() => { captureEditorHtml(); setEditorStep(3); }} />
            </div>
          )}

          {/* ── Step 3: Schema ── */}
          {editorStep === 3 && (
            <div className="flex-1 overflow-y-auto p-8">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Field schema</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Define the data fields this template accepts. Fields detected from placeholders are pre-filled.</p>
                  </div>
                  <button onClick={() => setFields(f => [...f, { _key: uid(), field_name: '', field_type: 'string', is_required: false, default_value: '', description: '', parent_field: '' }])}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
                    + Add field
                  </button>
                </div>

                {fields.length === 0 && (
                  <div className="text-center py-16 text-slate-400">No fields yet. Add a field or go back to Step 2 and insert placeholders.</div>
                )}

                <div className="space-y-3">
                  {fields.map((f, idx) => (
                    <FieldRow key={f._key} field={f}
                      onChange={updated => setFields(prev => prev.map((x, i) => i === idx ? updated : x))}
                      onRemove={() => setFields(prev => prev.filter((_, i) => i !== idx))}
                    />
                  ))}
                </div>

                <div className="mt-8 flex gap-3">
                  <button onClick={() => setEditorStep(2)} className="px-4 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">← Back</button>
                  <button onClick={() => setEditorStep(4)} className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">Next: Rules →</button>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: Rules ── */}
          {editorStep === 4 && (
            <div className="flex-1 overflow-y-auto p-8">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Conditional rules</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Rules show/hide blocks or repeat them (loops). Each rule needs a <code className="text-xs bg-slate-100 dark:bg-slate-700 px-1 rounded">data-block-id</code> attribute on the target element in your template.</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setRules(r => [...r, { _key: uid(), block_id: '', rule_type: 'condition', rule_config: { field: '', operator: 'equals', value: '' } }])}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
                      + Condition
                    </button>
                    <button onClick={() => setRules(r => [...r, { _key: uid(), block_id: '', rule_type: 'loop', rule_config: { arrayField: '' } }])}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors">
                      + Loop
                    </button>
                  </div>
                </div>

                {rules.length === 0 && (
                  <div className="text-center py-16 text-slate-400">No rules yet. Rules are optional — add them when your template has conditional blocks or repeating sections.</div>
                )}

                <div className="space-y-3">
                  {rules.map((rule, idx) => (
                    <RuleRow key={rule._key} rule={rule} fields={fields}
                      onChange={updated => setRules(prev => prev.map((x, i) => i === idx ? updated : x))}
                      onRemove={() => setRules(prev => prev.filter((_, i) => i !== idx))}
                    />
                  ))}
                </div>

                <div className="mt-8 flex gap-3">
                  <button onClick={() => setEditorStep(3)} className="px-4 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">← Back</button>
                  <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 transition-colors">{saving ? 'Saving…' : 'Save Template'}</button>
                  <button onClick={handlePreview} disabled={previewing} className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors">{previewing ? 'Rendering…' : 'Preview →'}</button>
                </div>
                {previewError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{previewError}</p>}
              </div>
            </div>
          )}

          {/* ── Step 5: Preview ── */}
          {editorStep === 5 && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-2 flex items-center gap-3">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">HTML Preview</span>
                <span className="text-xs text-slate-400">(rendered with sample data)</span>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => setEditorStep(4)} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">← Back to Rules</button>
                  <button onClick={handlePreview} disabled={previewing} className="px-3 py-1 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors disabled:opacity-50">{previewing ? '…' : 'Refresh'}</button>
                </div>
              </div>
              <iframe
                srcDoc={previewHtml}
                sandbox="allow-same-origin"
                className="flex-1 bg-white"
                title="Template preview"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER — List view
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center gap-4 shadow-sm">
        <button onClick={onBack} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 dark:hover:text-white text-sm font-medium transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="h-5 w-px bg-slate-200 dark:bg-slate-600" />
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">DocuComp — PDF Template Studio</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Build reusable PDF templates, define fields and rules, then render via REST API.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 flex gap-6">
        {(['templates', 'apikeys'] as ActiveTab[]).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            {tab === 'templates' ? 'Templates' : 'API Keys'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">

        {/* ── Templates tab ── */}
        {activeTab === 'templates' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">Your templates</h2>
              <button onClick={() => openEditor()} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New Template
              </button>
            </div>

            {listLoading && <div className="text-sm text-slate-400 py-8 text-center">Loading…</div>}
            {listError && <div className="text-sm text-red-600 dark:text-red-400 py-4">{listError}</div>}

            {!listLoading && templates.length === 0 && (
              <div className="text-center py-20">
                <svg className="w-16 h-16 text-slate-200 dark:text-slate-700 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">No templates yet.</p>
                <button onClick={() => openEditor()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg transition-colors">Create your first template</button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {templates.map(tpl => (
                <div key={tpl.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 dark:text-white truncate">{tpl.name}</h3>
                      {tpl.description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{tpl.description}</p>}
                    </div>
                    <span className="flex-shrink-0 text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded uppercase">{tpl.original_format}</span>
                  </div>
                  <p className="text-xs text-slate-400">Updated {new Date(tpl.updated_at).toLocaleDateString()}</p>
                  <div className="flex flex-wrap gap-2 mt-auto pt-2 border-t border-slate-100 dark:border-slate-700">
                    <button onClick={() => openEditor(tpl)} className="flex-1 text-xs text-center px-2 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors font-medium">Open</button>
                    <button onClick={() => handleDuplicate(tpl)} className="flex-1 text-xs text-center px-2 py-1.5 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors">Duplicate</button>
                    <button onClick={() => handleFetchDoc(tpl)} className="flex-1 text-xs text-center px-2 py-1.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors font-medium" title="Open in FetchDoc with pre-filled render URL">FetchDoc</button>
                    <button onClick={() => handleDelete(tpl.id)} className="text-xs px-2 py-1.5 text-red-500 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── API Keys tab ── */}
        {activeTab === 'apikeys' && (
          <div className="max-w-2xl">
            <div className="mb-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-1">API Keys</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Keys are used to authenticate calls to <code className="text-xs bg-slate-100 dark:bg-slate-700 px-1 rounded">POST /v1/pdf-render/:templateId</code>. The full key is shown only once at creation.</p>
            </div>

            {/* Create new key */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-6">
              <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-3">Create new key</h3>
              <div className="flex gap-3">
                <input value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateKey()}
                  placeholder="Key name, e.g. Production"
                  className="flex-1 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button onClick={handleCreateKey} disabled={keyCreating || !newKeyName.trim()} className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors font-medium">
                  {keyCreating ? 'Creating…' : 'Create'}
                </button>
              </div>

              {createdKey && (
                <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                  <p className="text-xs font-medium text-green-800 dark:text-green-300 mb-1">Key created — copy it now, it won't be shown again:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono text-green-900 dark:text-green-100 break-all">{createdKey}</code>
                    <button onClick={() => navigator.clipboard.writeText(createdKey)} className="flex-shrink-0 text-xs px-2 py-1 bg-green-200 dark:bg-green-800 text-green-900 dark:text-green-100 rounded hover:bg-green-300 dark:hover:bg-green-700 transition-colors">Copy</button>
                  </div>
                  <button onClick={() => setCreatedKey(null)} className="mt-2 text-xs text-green-700 dark:text-green-400 hover:underline">Dismiss</button>
                </div>
              )}
            </div>

            {/* Key list */}
            {apiKeys.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No API keys yet.</p>
            ) : (
              <div className="space-y-2">
                {apiKeys.map(k => (
                  <div key={k.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{k.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        <code>{k.key_prefix}…</code>
                        {' · Created '}{new Date(k.created_at).toLocaleDateString()}
                        {k.last_used_at ? ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}` : ' · Never used'}
                      </p>
                    </div>
                    <button onClick={() => handleRevokeKey(k.id)} className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 font-medium transition-colors">Revoke</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────────

const ToolbarBtn: React.FC<{ onClick: () => void; title: string; children: React.ReactNode }> = ({ onClick, title, children }) => (
  <button onMouseDown={e => { e.preventDefault(); onClick(); }} title={title}
    className="px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors min-w-[26px] text-center">
    {children}
  </button>
);

const FieldsPanel: React.FC<{ fields: TemplateField[]; onInsert: (name: string) => void; onNext: () => void }> = ({ fields, onInsert, onNext }) => (
  <div className="w-56 flex-shrink-0 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 flex flex-col">
    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
      <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">Fields</h3>
      <p className="text-xs text-slate-400 mt-0.5">Click to insert at cursor</p>
    </div>
    <div className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
      {fields.length === 0 && <p className="text-xs text-slate-400 py-2">No fields yet — define them in the Schema step.</p>}
      {fields.map(f => (
        <button key={f._key ?? f.field_name} onClick={() => onInsert(f.field_name)}
          className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 font-mono transition-colors truncate"
          title={`Insert {{${f.field_name}}}`}>
          {'{{' + f.field_name + '}}'}
        </button>
      ))}
    </div>
    <div className="px-3 py-3 border-t border-slate-200 dark:border-slate-700">
      <button onClick={onNext} className="w-full py-1.5 text-xs text-center bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
        Next: Schema →
      </button>
    </div>
  </div>
);

const FieldRow: React.FC<{ field: TemplateField; onChange: (f: TemplateField) => void; onRemove: () => void }> = ({ field, onChange, onRemove }) => {
  const inp = 'flex-1 px-2.5 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500';
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
      <div className="flex gap-3">
        <input value={field.field_name} onChange={e => onChange({ ...field, field_name: e.target.value })}
          placeholder="field_name" className={`${inp} font-mono`} />
        <select value={field.field_type} onChange={e => onChange({ ...field, field_type: e.target.value as TemplateField['field_type'] })}
          className={`w-28 ${inp}`}>
          {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">
          <input type="checkbox" checked={field.is_required} onChange={e => onChange({ ...field, is_required: e.target.checked })} className="rounded" />
          Required
        </label>
        <button onClick={onRemove} className="text-slate-400 hover:text-red-500 transition-colors" title="Remove field">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex gap-3">
        <input value={field.default_value} onChange={e => onChange({ ...field, default_value: e.target.value })}
          placeholder="Default value" className={inp} />
        <input value={field.description} onChange={e => onChange({ ...field, description: e.target.value })}
          placeholder="Description" className={`${inp} flex-[2]`} />
        {(field.field_type === 'array' || field.field_type === 'object') && (
          <input value={field.parent_field} onChange={e => onChange({ ...field, parent_field: e.target.value })}
            placeholder="Parent field" className={`${inp} w-32`} />
        )}
      </div>
    </div>
  );
};

const RuleRow: React.FC<{ rule: TemplateRule; fields: TemplateField[]; onChange: (r: TemplateRule) => void; onRemove: () => void }> = ({ rule, fields, onChange, onRemove }) => {
  const inp = 'flex-1 px-2.5 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500';
  const badge = rule.rule_type === 'condition'
    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300';
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge} uppercase`}>{rule.rule_type}</span>
        <input value={rule.block_id} onChange={e => onChange({ ...rule, block_id: e.target.value })}
          placeholder="data-block-id value" className={`${inp} font-mono`} />
        <button onClick={onRemove} className="text-slate-400 hover:text-red-500 transition-colors" title="Remove rule">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {rule.rule_type === 'condition' && (
        <div className="flex gap-3">
          <select value={rule.rule_config.field ?? ''} onChange={e => onChange({ ...rule, rule_config: { ...rule.rule_config, field: e.target.value } })}
            className={`w-40 ${inp}`}>
            <option value="">— field —</option>
            {fields.map(f => <option key={f._key ?? f.field_name} value={f.field_name}>{f.field_name}</option>)}
          </select>
          <select value={rule.rule_config.operator ?? 'equals'} onChange={e => onChange({ ...rule, rule_config: { ...rule.rule_config, operator: e.target.value } })}
            className={`w-36 ${inp}`}>
            {OPERATORS.map(op => <option key={op} value={op}>{op.replace('_', ' ')}</option>)}
          </select>
          {!['not_empty', 'is_empty'].includes(rule.rule_config.operator ?? 'equals') && (
            <input value={rule.rule_config.value ?? ''} onChange={e => onChange({ ...rule, rule_config: { ...rule.rule_config, value: e.target.value } })}
              placeholder="Value" className={inp} />
          )}
        </div>
      )}
      {rule.rule_type === 'loop' && (
        <div className="flex gap-3 items-center">
          <span className="text-sm text-slate-500">Repeat block for each item in:</span>
          <select value={rule.rule_config.arrayField ?? ''} onChange={e => onChange({ ...rule, rule_config: { ...rule.rule_config, arrayField: e.target.value } })}
            className={`w-48 ${inp}`}>
            <option value="">— array field —</option>
            {fields.filter(f => f.field_type === 'array').map(f => <option key={f._key ?? f.field_name} value={f.field_name}>{f.field_name}</option>)}
          </select>
        </div>
      )}
    </div>
  );
};

const DropZone: React.FC<{ onFile: (f: File) => void; uploading: boolean }> = ({ onFile, uploading }) => {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${dragging ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-slate-300 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500 bg-white dark:bg-slate-800'}`}
    >
      <input ref={inputRef} type="file" accept=".docx,.doc,.html,.htm" className="hidden" onChange={e => { if (e.target.files?.[0]) onFile(e.target.files[0]); }} />
      {uploading ? (
        <div className="flex flex-col items-center gap-3">
          <svg className="w-8 h-8 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-slate-500">Converting document…</p>
        </div>
      ) : (
        <>
          <svg className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Drop your file here, or click to browse</p>
          <p className="text-xs text-slate-400 mt-1">.docx or .html, up to 50 MB</p>
        </>
      )}
    </div>
  );
};

export default PdfStudio;
