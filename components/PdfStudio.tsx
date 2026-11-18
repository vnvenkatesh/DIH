import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Template {
  id: number;
  name: string;
  description: string;
  html_content: string;
  original_format: string;
  page_size: 'A4' | 'Letter' | 'Legal';
  margin_mm: number;
  created_at: string;
  updated_at: string;
  projects?: { id: number; name: string }[];
}

interface TemplateField {
  _key?: string;
  field_name: string;
  field_type: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'object';
  is_required: boolean;
  default_value: string;
  description: string;
  parent_field: string;
  is_array?: boolean;
}

type ProjectFieldType = 'string' | 'number' | 'date' | 'boolean';
const PROJECT_FIELD_TYPES: ProjectFieldType[] = ['string', 'number', 'date', 'boolean'];

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

interface Project {
  id: number;
  name: string;
  description: string;
  template_count: number;
  created_at: string;
  updated_at: string;
}

interface ProjectDetail {
  id: number;
  name: string;
  description: string;
  templates: Template[];
  schema: TemplateField[];
}

type ActiveTab = 'projects' | 'templates' | 'apikeys';
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

// ── XSD parser ────────────────────────────────────────────────────────────────

function xsdTypeToFieldType(raw: string): ProjectFieldType {
  const t = (raw ?? '').replace(/^xs:|^xsd:/i, '').toLowerCase();
  if (['int','integer','long','short','decimal','float','double','byte',
       'nonnegativeinteger','positiveinteger','unsignedint','unsignedlong',
       'unsignedshort','unsignedbyte'].includes(t)) return 'number';
  if (['date','datetime','time','gyear','gyearmonth','gmonthday'].includes(t)) return 'date';
  if (t === 'boolean') return 'boolean';
  return 'string';
}

function parseXsd(xsdText: string): Array<Omit<TemplateField, 'parent_field'> & { is_array: boolean; field_type: ProjectFieldType }> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xsdText, 'application/xml');
  if (doc.querySelector('parsererror')) return [];

  const XSD_NS = 'http://www.w3.org/2001/XMLSchema';
  const els = Array.from(doc.getElementsByTagNameNS(XSD_NS, 'element') as HTMLCollectionOf<Element>);

  const seen = new Set<string>();
  const fields: ReturnType<typeof parseXsd> = [];

  for (const el of els) {
    const name = el.getAttribute('name');
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const typeAttr = el.getAttribute('type') ?? '';
    const maxOccurs = el.getAttribute('maxOccurs') ?? '1';
    const minOccurs = el.getAttribute('minOccurs') ?? '1';
    const isArray = maxOccurs === 'unbounded' || parseInt(maxOccurs, 10) > 1;
    const isRequired = minOccurs !== '0';

    const docEls = el.getElementsByTagNameNS(XSD_NS, 'documentation');
    const description = docEls[0]?.textContent?.trim() ?? '';

    fields.push({
      _key: uid(),
      field_name: name,
      field_type: xsdTypeToFieldType(typeAttr),
      is_array: isArray,
      is_required: isRequired,
      default_value: '',
      description,
    });
  }

  return fields;
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
      case 'number':  obj[f.field_name] = 1; break;
      case 'boolean': obj[f.field_name] = true; break;
      case 'date':    obj[f.field_name] = '2025-01-31'; break;
      case 'array': {
        const childFields = fields.filter(c => c.parent_field === f.field_name);
        const childSample = childFields.length
          ? Object.fromEntries(childFields.map(c => [c.field_name, `Sample ${c.field_name}`]))
          : { item: 'Sample item' };
        obj[f.field_name] = [childSample, { ...childSample }];
        break;
      }
      case 'object':  obj[f.field_name] = {}; break;
      default:        obj[f.field_name] = `Sample ${f.field_name}`; break;
    }
  }
  return obj;
}

// ── PdfStudio component ────────────────────────────────────────────────────────

const PdfStudio: React.FC<Props> = ({ onBack, onOpenFetchDoc }) => {
  const { token } = useAuth();

  // ── List view state ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>('projects');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  // ── Projects state ────────────────────────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState('');
  const [openProject, setOpenProject] = useState<ProjectDetail | null>(null);
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<number | null>(null);
  const [showNewProjectForm, setShowNewProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [showAddExistingModal, setShowAddExistingModal] = useState(false);
  const [projectSchema, setProjectSchema] = useState<TemplateField[]>([]);
  const [savingProjectSchema, setSavingProjectSchema] = useState(false);
  const [creatingInProjectId, setCreatingInProjectId] = useState<number | null>(null);
  const [projectDetailTab, setProjectDetailTab] = useState<'templates' | 'schema'>('templates');
  const [xsdUploading, setXsdUploading] = useState(false);

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
  const [tplPageSize, setTplPageSize] = useState<'A4' | 'Letter' | 'Legal'>('A4');
  const [tplMarginMm, setTplMarginMm] = useState(20);
  const [htmlContent, setHtmlContent] = useState('');
  const [originalFormat, setOriginalFormat] = useState('docx');
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [rules, setRules] = useState<TemplateRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);

  // ── Inline confirmation state ─────────────────────────────────────────────
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);

  // ── Preview ───────────────────────────────────────────────────────────────
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // ── Editor project schema (inherited from the project this template belongs to) ──
  const [editorProjectId, setEditorProjectId] = useState<number | null>(null);
  const [editorProjectName, setEditorProjectName] = useState('');
  const [editorProjectSchema, setEditorProjectSchema] = useState<TemplateField[]>([]);
  const [editorXsdUploading, setEditorXsdUploading] = useState(false);

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
      const r = await apiFetch('/v1/pdf-studio/templates/api-keys', token);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Failed to load keys');
      setApiKeys(j.keys ?? []);
    } catch {}
  }, [token]);

  const loadProjects = useCallback(async () => {
    if (!token) return;
    setProjectsLoading(true); setProjectsError('');
    try {
      const r = await apiFetch('/v1/pdf-studio/templates/projects', token);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Failed to load projects');
      setProjects(j.projects ?? []);
    } catch (e: any) { setProjectsError(e.message); }
    finally { setProjectsLoading(false); }
  }, [token]);

  const loadProjectDetail = useCallback(async (id: number) => {
    if (!token) return;
    const r = await apiFetch(`/v1/pdf-studio/templates/projects/${id}`, token);
    const j = await r.json();
    if (!r.ok) return;
    setOpenProject({ id: j.project.id, name: j.project.name, description: j.project.description, templates: j.templates ?? [], schema: j.schema ?? [] });
    setProjectSchema((j.schema ?? []).map((f: any) => ({ ...f, _key: uid() })));
    setProjectDetailTab('templates');
  }, [token]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useEffect(() => { if (activeTab === 'apikeys') loadApiKeys(); }, [activeTab, loadApiKeys]);
  useEffect(() => { if (activeTab === 'projects') loadProjects(); }, [activeTab, loadProjects]);

  // ── Open template for editing ─────────────────────────────────────────────
  const openEditor = async (tpl?: Template) => {
    setSaveError(''); setUploadError(''); setPreviewHtml(''); setPreviewError('');
    // Reset project schema
    setEditorProjectId(null); setEditorProjectName(''); setEditorProjectSchema([]);
    if (tpl) {
      setEditingId(tpl.id);
      setTplName(tpl.name);
      setTplDescription(tpl.description ?? '');
      setTplPageSize((tpl.page_size as any) ?? 'A4');
      setTplMarginMm(tpl.margin_mm ?? 20);
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
      // If template belongs to a project, load that project's schema
      const firstProject = tpl.projects?.[0];
      if (firstProject) {
        try {
          const pr = await apiFetch(`/v1/pdf-studio/templates/projects/${firstProject.id}`, token!);
          const pj = await pr.json();
          if (pr.ok && pj.schema?.length) {
            setEditorProjectId(firstProject.id);
            setEditorProjectName(firstProject.name);
            setEditorProjectSchema((pj.schema ?? []).map((f: any) => ({ ...f, _key: uid() })));
          }
        } catch {}
      }
      setEditorStep(2);
    } else {
      setEditingId(null);
      setTplName('');
      setTplDescription('');
      setTplPageSize('A4');
      setTplMarginMm(20);
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
    if (editorRef.current && editorStep === 3) {
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
        page_size: tplPageSize,
        margin_mm: tplMarginMm,
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
      const newId = j.template?.id ?? null;
      if (!editingId) {
        setEditingId(newId);
        // If created from within a project, link it
        if (newId && creatingInProjectId) {
          await apiFetch(`/v1/pdf-studio/templates/projects/${creatingInProjectId}/templates`, token!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ template_id: newId }),
          });
          setCreatingInProjectId(null);
          await loadProjects();
        }
      }
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
    const r = await apiFetch(`/v1/pdf-studio/templates/${tpl.id}/duplicate`, token!, { method: 'POST' });
    if (!r.ok) return;
    await loadTemplates();
  };

  // ── Delete template ───────────────────────────────────────────────────────
  const handleDelete = async (id: number) => {
    await apiFetch(`/v1/pdf-studio/templates/${id}`, token!, { method: 'DELETE' });
    setConfirmDeleteId(null);
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
    await apiFetch(`/v1/pdf-studio/templates/api-keys/${id}`, token!, { method: 'DELETE' });
    setConfirmRevokeId(null);
    await loadApiKeys();
  };

  // ── Project handlers ──────────────────────────────────────────────────────
  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    setCreatingProject(true);
    try {
      const r = await apiFetch('/v1/pdf-studio/templates/projects', token!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName.trim(), description: newProjectDesc }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Failed to create project');
      setNewProjectName(''); setNewProjectDesc(''); setShowNewProjectForm(false);
      await loadProjects();
    } catch {}
    finally { setCreatingProject(false); }
  };

  const handleDeleteProject = async (id: number) => {
    await apiFetch(`/v1/pdf-studio/templates/projects/${id}`, token!, { method: 'DELETE' });
    setConfirmDeleteProjectId(null);
    if (openProject?.id === id) setOpenProject(null);
    await loadProjects();
  };

  const handleAddTemplateToProject = async (templateId: number) => {
    if (!openProject) return;
    await apiFetch(`/v1/pdf-studio/templates/projects/${openProject.id}/templates`, token!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId }),
    });
    setShowAddExistingModal(false);
    await Promise.all([loadTemplates(), loadProjectDetail(openProject.id)]);
  };

  const handleRemoveTemplateFromProject = async (templateId: number) => {
    if (!openProject) return;
    await apiFetch(`/v1/pdf-studio/templates/projects/${openProject.id}/templates/${templateId}`, token!, { method: 'DELETE' });
    await loadProjectDetail(openProject.id);
  };

  const handleSaveProjectSchema = async () => {
    if (!openProject) return;
    setSavingProjectSchema(true);
    try {
      const r = await apiFetch(`/v1/pdf-studio/templates/projects/${openProject.id}`, token!, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: openProject.name, description: openProject.description, schema: projectSchema.map(({ _key, ...f }) => f) }),
      });
      if (r.ok) await loadProjectDetail(openProject.id);
    } catch {}
    finally { setSavingProjectSchema(false); }
  };

  // ── Cursor-in-table detection ─────────────────────────────────────────────
  const [cursorInTable, setCursorInTable] = useState(false);

  useEffect(() => {
    const checkCursor = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !editorRef.current) { setCursorInTable(false); return; }
      let node: Node | null = sel.getRangeAt(0).startContainer;
      while (node && node !== editorRef.current) {
        if ((node as Element).tagName === 'TABLE') { setCursorInTable(true); return; }
        node = node.parentNode;
      }
      setCursorInTable(false);
    };
    document.addEventListener('selectionchange', checkCursor);
    return () => document.removeEventListener('selectionchange', checkCursor);
  }, []);

  const getActiveTable = (): HTMLTableElement | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return null;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    while (node && node !== editorRef.current) {
      if ((node as Element).tagName === 'TABLE') return node as HTMLTableElement;
      node = node.parentNode;
    }
    return null;
  };

  const getActiveCell = (): HTMLTableCellElement | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return null;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    while (node && node !== editorRef.current) {
      const tag = (node as Element).tagName;
      if (tag === 'TD' || tag === 'TH') return node as HTMLTableCellElement;
      node = node.parentNode;
    }
    return null;
  };

  const getActiveRow = (): HTMLTableRowElement | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return null;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    while (node && node !== editorRef.current) {
      if ((node as Element).tagName === 'TR') return node as HTMLTableRowElement;
      node = node.parentNode;
    }
    return null;
  };

  // ── Table commands ────────────────────────────────────────────────────────
  const insertTable = () => {
    const cell = 'style="border:1px solid #000000;padding:4px 8px;min-width:60px"';
    const row = `<tr><td ${cell}>&nbsp;</td><td ${cell}>&nbsp;</td><td ${cell}>&nbsp;</td></tr>`;
    const tableHtml = `<table style="border-collapse:collapse;width:100%"><tbody>${row}${row}${row}</tbody></table><p><br></p>`;
    editorRef.current?.focus();
    document.execCommand('insertHTML', false, tableHtml);
    if (editorRef.current) setHtmlContent(editorRef.current.innerHTML);
  };

  const addTableRow = () => {
    const tr = getActiveRow();
    if (!tr) return;
    const newRow = tr.cloneNode(true) as HTMLTableRowElement;
    newRow.querySelectorAll('td,th').forEach(c => { c.innerHTML = '&nbsp;'; });
    tr.parentNode?.insertBefore(newRow, tr.nextSibling);
    if (editorRef.current) setHtmlContent(editorRef.current.innerHTML);
  };

  const removeTableRow = () => {
    const tr = getActiveRow();
    if (!tr) return;
    const table = getActiveTable();
    if (table && table.rows.length <= 1) return; // keep at least one row
    tr.remove();
    if (editorRef.current) setHtmlContent(editorRef.current.innerHTML);
  };

  const addTableColumn = () => {
    const table = getActiveTable();
    const td = getActiveCell();
    if (!table || !td) return;
    const colIdx = td.cellIndex;
    Array.from(table.rows).forEach(row => {
      const newCell = row.cells[0]?.cloneNode(false) as HTMLTableCellElement ?? document.createElement('td');
      newCell.innerHTML = '&nbsp;';
      if (row.cells[colIdx + 1]) row.insertBefore(newCell, row.cells[colIdx + 1]);
      else row.appendChild(newCell);
    });
    if (editorRef.current) setHtmlContent(editorRef.current.innerHTML);
  };

  const removeTableColumn = () => {
    const table = getActiveTable();
    const td = getActiveCell();
    if (!table || !td) return;
    if (table.rows[0] && table.rows[0].cells.length <= 1) return; // keep at least one column
    const colIdx = td.cellIndex;
    Array.from(table.rows).forEach(row => { if (row.cells[colIdx]) row.deleteCell(colIdx); });
    if (editorRef.current) setHtmlContent(editorRef.current.innerHTML);
  };

  const deleteTable = () => {
    const table = getActiveTable();
    if (!table) return;
    table.remove();
    if (editorRef.current) setHtmlContent(editorRef.current.innerHTML);
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
            <select value={tplPageSize} onChange={e => setTplPageSize(e.target.value as any)}
              className="px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500">
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
              <option value="Legal">Legal</option>
            </select>
            <div className="flex items-center gap-1">
              <input type="number" min={0} max={50} value={tplMarginMm} onChange={e => setTplMarginMm(Number(e.target.value))}
                className="w-14 px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              <span className="text-xs text-slate-400">mm</span>
            </div>
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

        {/* Step indicator + nav */}
        <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-2 flex items-center justify-between">
          {/* Step pills */}
          <div className="flex items-center gap-0">
            {(['Upload', 'Schema', 'Edit', 'Rules', 'Preview'] as const).map((label, idx) => {
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

          {/* Nav buttons — right-aligned */}
          <div className="flex items-center gap-2 pl-4">
            {editorStep >= 2 && (
              <button
                onClick={() => {
                  if (editorStep === 3) captureEditorHtml();
                  setEditorStep((editorStep - 1) as EditorStep);
                }}
                className="px-3 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                ← Back
              </button>
            )}
            {editorStep === 2 && (
              <button onClick={() => setEditorStep(3)}
                className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
                Edit →
              </button>
            )}
            {editorStep === 3 && (
              <button onClick={() => { captureEditorHtml(); setEditorStep(4); }}
                className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
                Rules →
              </button>
            )}
            {editorStep === 4 && (
              <>
                <button onClick={handleSave} disabled={saving}
                  className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 transition-colors">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={handlePreview} disabled={previewing}
                  className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors">
                  {previewing ? 'Rendering…' : 'Preview →'}
                </button>
              </>
            )}
            {editorStep === 5 && (
              <button onClick={handlePreview} disabled={previewing}
                className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors">
                {previewing ? '…' : 'Refresh'}
              </button>
            )}
          </div>
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

          {/* ── Step 2: Schema ── */}
          {editorStep === 2 && (
            <div className="flex-1 overflow-y-auto p-8">
              <div className="max-w-3xl mx-auto">

                {/* ── Project schema (read-only inherited fields) ── */}
                {editorProjectSchema.length > 0 ? (
                  <>
                    {/* Project schema banner */}
                    <div className="flex items-center gap-3 mb-6 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-xl px-4 py-3">
                      <svg className="w-5 h-5 text-purple-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-purple-800 dark:text-purple-200">Schema inherited from project <strong>{editorProjectName}</strong></p>
                        <p className="text-xs text-purple-600 dark:text-purple-400 mt-0.5">{editorProjectSchema.length} shared field{editorProjectSchema.length !== 1 ? 's' : ''} — read-only. Add template-specific fields below.</p>
                      </div>
                    </div>

                    {/* Read-only project fields */}
                    <div className="mb-8">
                      <div className="hidden md:flex gap-2 px-3 pb-1 text-xs font-medium text-slate-400 uppercase tracking-wide">
                        <span className="flex-1 min-w-[120px]">Name</span>
                        <span className="w-28">Type</span>
                        <span className="w-16 text-center">Array</span>
                        <span className="w-20 text-center">Required</span>
                        <span className="flex-1">Description</span>
                      </div>
                      <div className="space-y-1">
                        {editorProjectSchema.map(f => (
                          <div key={f._key} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-50/60 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-800/40 text-sm">
                            <span className="flex-1 min-w-[120px] font-mono text-slate-700 dark:text-slate-300">{f.field_name}</span>
                            <span className="w-28 text-xs text-slate-500 dark:text-slate-400">{f.field_type}{f.is_array ? '[]' : ''}</span>
                            <span className="w-16 text-center text-xs text-slate-400">{f.is_array ? '✓' : '—'}</span>
                            <span className="w-20 text-center text-xs text-slate-400">{f.is_required ? '✓' : '—'}</span>
                            <span className="flex-1 text-xs text-slate-400 truncate">{f.description || '—'}</span>
                            <span className="text-xs text-purple-500 italic flex-none">project</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Template-specific fields */}
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Template-specific fields</p>
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          if (!editingId) return;
                          const r = await apiFetch(`/v1/pdf-studio/templates/${editingId}/extract-schema`, token!, { method: 'POST' });
                          const j = await r.json();
                          const existing = new Set([...fields.map(f => f.field_name), ...editorProjectSchema.map(f => f.field_name)]);
                          const newFields = (j.placeholders ?? []).filter((p: string) => !existing.has(p)).map((p: string) => ({ _key: uid(), field_name: p, field_type: 'string' as const, is_required: false, default_value: '', description: '', parent_field: '' }));
                          if (newFields.length) setFields(f => [...f, ...newFields]);
                        }} disabled={!editingId}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-40">
                          ↻ Re-scan
                        </button>
                        <button onClick={() => setFields(f => [...f, { _key: uid(), field_name: '', field_type: 'string', is_required: false, default_value: '', description: '', parent_field: '' }])}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
                          + Add field
                        </button>
                      </div>
                    </div>

                    {fields.length === 0 ? (
                      <div className="text-center py-10 text-slate-400 text-sm border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                        No template-specific fields. Add one or click Re-scan to detect placeholders.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {fields.map((f, idx) => (
                          <FieldRow key={f._key} field={f} allFields={fields}
                            onChange={updated => setFields(prev => prev.map((x, i) => i === idx ? updated : x))}
                            onRemove={() => setFields(prev => prev.filter((_, i) => i !== idx))}
                          />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* No project — full schema editor with XSD import */}
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Field schema</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Define the data fields this template accepts. Import from XSD or add manually.</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* XSD upload */}
                        <label className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${editorXsdUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          {editorXsdUploading ? 'Parsing…' : 'Import XSD'}
                          <input type="file" accept=".xsd,.xml" className="hidden" disabled={editorXsdUploading} onChange={async e => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setEditorXsdUploading(true);
                            try {
                              const text = await file.text();
                              const parsed = parseXsd(text);
                              if (parsed.length === 0) return;
                              const existing = new Set(fields.map(f => f.field_name));
                              const toAdd = parsed.filter(f => !existing.has(f.field_name)).map(f => ({
                                ...f, parent_field: '',
                              }));
                              setFields(s => [...s, ...toAdd]);
                            } finally {
                              setEditorXsdUploading(false);
                              e.target.value = '';
                            }
                          }} />
                        </label>
                        <button onClick={async () => {
                          if (!editingId) return;
                          const r = await apiFetch(`/v1/pdf-studio/templates/${editingId}/extract-schema`, token!, { method: 'POST' });
                          const j = await r.json();
                          const existing = new Set(fields.map(f => f.field_name));
                          const newFields = (j.placeholders ?? []).filter((p: string) => !existing.has(p)).map((p: string) => ({ _key: uid(), field_name: p, field_type: 'string' as const, is_required: false, default_value: '', description: '', parent_field: '' }));
                          if (newFields.length) setFields(f => [...f, ...newFields]);
                        }} disabled={!editingId} title={editingId ? undefined : 'Save template first to re-scan'}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-40">
                          ↻ Re-scan
                        </button>
                        <button onClick={() => setFields(f => [...f, { _key: uid(), field_name: '', field_type: 'string', is_required: false, default_value: '', description: '', parent_field: '' }])}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
                          + Add field
                        </button>
                      </div>
                    </div>

                    {fields.length === 0 && (
                      <div className="text-center py-16 text-slate-400">No fields yet. Import an XSD, add a field, or click Re-scan after saving the template.</div>
                    )}

                    {fields.length > 0 && (
                      <div className="hidden md:flex gap-3 px-4 pb-1 text-xs font-medium text-slate-400 uppercase tracking-wide">
                        <span className="flex-1 min-w-[120px]">Name</span>
                        <span className="w-28 flex-none">Type</span>
                        <span className="w-36 flex-none">Parent (loop child)</span>
                        <span className="whitespace-nowrap">Required</span>
                      </div>
                    )}

                    <div className="space-y-3">
                      {fields.map((f, idx) => (
                        <FieldRow key={f._key} field={f} allFields={fields}
                          onChange={updated => setFields(prev => prev.map((x, i) => i === idx ? updated : x))}
                          onRemove={() => setFields(prev => prev.filter((_, i) => i !== idx))}
                        />
                      ))}
                    </div>
                  </>
                )}

              </div>
            </div>
          )}

          {/* ── Step 3: Edit ── */}
          {editorStep === 3 && (
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
                  <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
                  <ToolbarBtn onClick={insertTable} title="Insert 3×3 table">⊞ Table</ToolbarBtn>
                  {cursorInTable && (
                    <>
                      <div className="w-px h-5 bg-slate-300 dark:bg-slate-500 mx-1" />
                      <span className="text-[10px] text-slate-400 font-medium px-1">Row:</span>
                      <ToolbarBtn onClick={addTableRow} title="Add row below">+Row</ToolbarBtn>
                      <ToolbarBtn onClick={removeTableRow} title="Remove current row">−Row</ToolbarBtn>
                      <span className="text-[10px] text-slate-400 font-medium px-1">Col:</span>
                      <ToolbarBtn onClick={addTableColumn} title="Add column after">+Col</ToolbarBtn>
                      <ToolbarBtn onClick={removeTableColumn} title="Remove current column">−Col</ToolbarBtn>
                      <ToolbarBtn onClick={deleteTable} title="Delete entire table" className="text-red-500 hover:text-red-700">✕ Table</ToolbarBtn>
                    </>
                  )}
                </div>
                {/* Page */}
                <div className="flex-1 overflow-y-auto bg-slate-200 dark:bg-slate-700 p-6">
                  <div className="max-w-[800px] mx-auto bg-white dark:bg-slate-900 shadow-lg rounded min-h-[1000px] p-12">
                    <div
                      ref={editorRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={() => { if (editorRef.current) setHtmlContent(editorRef.current.innerHTML); }}
                      className="outline-none min-h-[800px] text-slate-800 dark:text-slate-200 leading-relaxed [&_table]:border-collapse [&_table]:w-full [&_td]:border [&_td]:border-slate-300 [&_td]:p-1 [&_th]:border [&_th]:border-slate-300 [&_th]:p-1 [&_th]:bg-slate-50 dark:[&_td]:border-slate-600 dark:[&_th]:border-slate-600 dark:[&_th]:bg-slate-700"
                      style={{ fontFamily: 'Arial, sans-serif', fontSize: '14px' }}
                    />
                  </div>
                </div>
              </div>
              {/* Fields panel */}
              <FieldsPanel fields={fields} onInsert={insertPlaceholder} />
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

                {previewError && <p className="mt-6 text-sm text-red-600 dark:text-red-400">{previewError}</p>}
              </div>
            </div>
          )}

          {/* ── Step 5: Preview ── */}
          {editorStep === 5 && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-2 flex items-center gap-3">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">HTML Preview</span>
                <span className="text-xs text-slate-400">(rendered with sample data)</span>
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
        {(['projects', 'templates', 'apikeys'] as ActiveTab[]).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            {tab === 'projects' ? 'Projects' : tab === 'templates' ? 'Templates' : 'API Keys'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">

        {/* ── Projects tab ── */}
        {activeTab === 'projects' && (
          <>
            {/* Project detail view */}
            {openProject ? (
              <div className="max-w-4xl">
                {/* Back + header */}
                <div className="flex items-center gap-3 mb-6">
                  <button onClick={() => setOpenProject(null)} className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-white flex items-center gap-1 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                    All Projects
                  </button>
                  <span className="text-slate-300 dark:text-slate-600">/</span>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">{openProject.name}</h2>
                </div>

                {/* Sub-tabs */}
                <div className="flex border-b border-slate-200 dark:border-slate-700 mb-6">
                  {(['templates', 'schema'] as const).map(t => (
                    <button key={t} onClick={() => setProjectDetailTab(t)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${projectDetailTab === t ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                      {t === 'templates' ? 'Templates' : 'Schema'}
                    </button>
                  ))}
                </div>

                {/* Templates tab */}
                {projectDetailTab === 'templates' && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm text-slate-500 dark:text-slate-400">Templates in this project</p>
                      <div className="flex gap-2">
                        <button onClick={() => { setCreatingInProjectId(openProject.id); openEditor(); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
                          + New Template
                        </button>
                        <button onClick={() => { loadTemplates(); setShowAddExistingModal(true); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                          + Add Existing
                        </button>
                      </div>
                    </div>
                    {openProject.templates.length === 0 ? (
                      <div className="text-center py-10 text-slate-400 text-sm bg-white dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-600 rounded-xl">
                        No templates in this project yet.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {openProject.templates.map(tpl => (
                          <div key={tpl.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-slate-900 dark:text-white truncate">{tpl.name}</p>
                              {tpl.description && <p className="text-xs text-slate-400 mt-0.5 truncate">{tpl.description}</p>}
                            </div>
                            <div className="flex gap-2 flex-shrink-0">
                              <button onClick={() => openEditor(tpl)} className="text-xs px-2.5 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 rounded hover:bg-indigo-100 transition-colors">Open</button>
                              <button onClick={() => handleRemoveTemplateFromProject(tpl.id)} className="text-xs px-2.5 py-1 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">Remove</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Schema tab */}
                {projectDetailTab === 'schema' && (
                  <div>
                    {/* Toolbar */}
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                      <p className="text-sm text-slate-500 dark:text-slate-400">Common fields shared across all templates in this project.</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* XSD upload */}
                        <label className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${xsdUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          {xsdUploading ? 'Parsing…' : 'Import XSD'}
                          <input type="file" accept=".xsd,.xml" className="hidden" disabled={xsdUploading} onChange={async e => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setXsdUploading(true);
                            try {
                              const text = await file.text();
                              const parsed = parseXsd(text);
                              if (parsed.length === 0) return;
                              // Merge: skip names already present
                              const existing = new Set(projectSchema.map(f => f.field_name));
                              const toAdd = parsed.filter(f => !existing.has(f.field_name)).map(f => ({
                                ...f, parent_field: '',
                              }));
                              setProjectSchema(s => [...s, ...toAdd]);
                            } finally {
                              setXsdUploading(false);
                              e.target.value = '';
                            }
                          }} />
                        </label>
                        <button onClick={() => setProjectSchema(s => [...s, { _key: uid(), field_name: '', field_type: 'string', is_required: false, default_value: '', description: '', parent_field: '', is_array: false }])}
                          className="text-xs px-3 py-1.5 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                          + Add Field
                        </button>
                        <button onClick={handleSaveProjectSchema} disabled={savingProjectSchema}
                          className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors font-medium">
                          {savingProjectSchema ? 'Saving…' : 'Save Schema'}
                        </button>
                      </div>
                    </div>

                    {projectSchema.length === 0 ? (
                      <div className="text-center py-16 text-slate-400 text-sm border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                        No fields yet. Import an XSD or add fields manually.
                      </div>
                    ) : (
                      <>
                        {/* Column header */}
                        <div className="hidden md:flex gap-2 px-3 pb-1 text-xs font-medium text-slate-400 uppercase tracking-wide">
                          <span className="flex-1 min-w-[120px]">Name</span>
                          <span className="w-28">Type</span>
                          <span className="w-16 text-center">Array</span>
                          <span className="w-20 text-center">Required</span>
                          <span className="flex-1">Description</span>
                          <span className="w-6" />
                        </div>
                        <div className="space-y-2">
                          {projectSchema.map((f, idx) => (
                            <ProjectFieldRow key={f._key} field={f}
                              onChange={updated => setProjectSchema(prev => prev.map((x, i) => i === idx ? updated : x))}
                              onRemove={() => setProjectSchema(prev => prev.filter((_, i) => i !== idx))}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* Project list view */
              <>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">Projects</h2>
                  <button onClick={() => setShowNewProjectForm(v => !v)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                    New Project
                  </button>
                </div>

                {showNewProjectForm && (
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-6">
                    <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-3">Create project</h3>
                    <div className="space-y-3">
                      <input value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
                        placeholder="Project name"
                        className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <input value={newProjectDesc} onChange={e => setNewProjectDesc(e.target.value)}
                        placeholder="Description (optional)"
                        className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <div className="flex gap-3 justify-end">
                        <button onClick={() => { setShowNewProjectForm(false); setNewProjectName(''); setNewProjectDesc(''); }}
                          className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                          Cancel
                        </button>
                        <button onClick={handleCreateProject} disabled={creatingProject || !newProjectName.trim()}
                          className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors font-medium">
                          {creatingProject ? 'Creating…' : 'Create'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {projectsLoading && <div className="text-sm text-slate-400 py-8 text-center">Loading…</div>}
                {projectsError && <div className="text-sm text-red-600 dark:text-red-400 py-4">{projectsError}</div>}

                {!projectsLoading && projects.length === 0 && (
                  <div className="text-center py-20">
                    <svg className="w-16 h-16 text-slate-200 dark:text-slate-700 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">No projects yet.</p>
                    <button onClick={() => setShowNewProjectForm(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg transition-colors">Create your first project</button>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {projects.map(proj => (
                    <div key={proj.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-slate-900 dark:text-white truncate">{proj.name}</h3>
                          {proj.description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{proj.description}</p>}
                        </div>
                        <span className="flex-shrink-0 text-xs bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded font-medium whitespace-nowrap">
                          {proj.template_count ?? 0} template{(proj.template_count ?? 0) !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">Updated {new Date(proj.updated_at).toLocaleDateString()}</p>
                      {confirmDeleteProjectId === proj.id ? (
                        <div className="mt-auto pt-2 border-t border-slate-100 dark:border-slate-700">
                          <p className="text-xs text-slate-700 dark:text-slate-300 mb-2">Delete <strong>{proj.name}</strong>? Templates are not deleted.</p>
                          <div className="flex gap-2">
                            <button onClick={() => handleDeleteProject(proj.id)} className="flex-1 text-xs px-2 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded transition-colors font-medium">Delete</button>
                            <button onClick={() => setConfirmDeleteProjectId(null)} className="flex-1 text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 mt-auto pt-2 border-t border-slate-100 dark:border-slate-700">
                          <button onClick={() => loadProjectDetail(proj.id)} className="flex-1 text-xs text-center px-2 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors font-medium">Open</button>
                          <button onClick={() => setConfirmDeleteProjectId(proj.id)} className="text-xs px-2 py-1.5 text-red-500 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">Delete</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Add Existing Template modal */}
            {showAddExistingModal && openProject && (
              <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowAddExistingModal(false)}>
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Add existing template to "{openProject.name}"</h3>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {templates.filter(t => !openProject.templates.some(pt => pt.id === t.id)).length === 0 ? (
                      <p className="text-sm text-slate-400 text-center py-6">All templates are already in this project.</p>
                    ) : templates.filter(t => !openProject.templates.some(pt => pt.id === t.id)).map(tpl => (
                      <div key={tpl.id} className="flex items-center justify-between gap-3 p-3 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{tpl.name}</p>
                          {tpl.description && <p className="text-xs text-slate-400 truncate">{tpl.description}</p>}
                        </div>
                        <button onClick={() => handleAddTemplateToProject(tpl.id)} className="flex-shrink-0 text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">Add</button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button onClick={() => setShowAddExistingModal(false)} className="px-4 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Close</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

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
                    <div className="flex-shrink-0 flex gap-1">
                      <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded font-medium">{tpl.page_size ?? 'A4'}</span>
                      <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded uppercase">{tpl.original_format}</span>
                    </div>
                  </div>
                  {tpl.projects && tpl.projects.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {tpl.projects.map(p => (
                        <span key={p.id} className="text-[11px] bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded">
                          {p.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-slate-400">Updated {new Date(tpl.updated_at).toLocaleDateString()}</p>
                  {confirmDeleteId === tpl.id ? (
                    <div className="mt-auto pt-2 border-t border-slate-100 dark:border-slate-700">
                      <p className="text-xs text-slate-700 dark:text-slate-300 mb-2">Delete <strong>{tpl.name}</strong>? This cannot be undone.</p>
                      <div className="flex gap-2">
                        <button onClick={() => handleDelete(tpl.id)} className="flex-1 text-xs px-2 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded transition-colors font-medium">Delete</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="flex-1 text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 mt-auto pt-2 border-t border-slate-100 dark:border-slate-700">
                      <button onClick={() => openEditor(tpl)} className="flex-1 text-xs text-center px-2 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors font-medium">Open</button>
                      <button onClick={() => handleDuplicate(tpl)} className="flex-1 text-xs text-center px-2 py-1.5 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors">Duplicate</button>
                      <button onClick={() => handleFetchDoc(tpl)} className="flex-1 text-xs text-center px-2 py-1.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors font-medium" title="Open in FetchDoc with pre-filled render URL">FetchDoc</button>
                      <button onClick={() => setConfirmDeleteId(tpl.id)} className="text-xs px-2 py-1.5 text-red-500 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">Delete</button>
                    </div>
                  )}
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
                  <div key={k.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3">
                    {confirmRevokeId === k.id ? (
                      <div>
                        <p className="text-xs text-slate-700 dark:text-slate-300 mb-2">Revoke key <strong>{k.name}</strong>? Systems using it will be rejected immediately.</p>
                        <div className="flex gap-2">
                          <button onClick={() => handleRevokeKey(k.id)} className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded transition-colors font-medium">Revoke</button>
                          <button onClick={() => setConfirmRevokeId(null)} className="text-xs px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white">{k.name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            <code>{k.key_prefix}…</code>
                            {' · Created '}{new Date(k.created_at).toLocaleDateString()}
                            {k.last_used_at ? ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}` : ' · Never used'}
                          </p>
                        </div>
                        <button onClick={() => setConfirmRevokeId(k.id)} className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 font-medium transition-colors">Revoke</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* curl examples */}
            <div className="mt-8 bg-slate-900 dark:bg-slate-950 rounded-xl p-5 space-y-5">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-2">Single template</p>
                <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto">{`curl -X POST \\
  ${window.location.origin}/v1/pdf-render/<templateId> \\
  -H "Authorization: Bearer <your-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"data": {"fieldName": "value"}}' \\
  --output rendered.pdf`}</pre>
              </div>
              <div className="border-t border-slate-700 pt-5">
                <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-2">Multiple templates → one PDF</p>
                <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto">{`curl -X POST \\
  ${window.location.origin}/v1/pdf-render \\
  -H "Authorization: Bearer <your-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "shared_data": {"companyName": "Acme"},
    "templates": [
      {"id": 1, "data": {"greeting": "Hello"}},
      {"id": "Invoice Template", "data": {"amount": 500}}
    ]
  }' \\
  --output composed.pdf`}</pre>
                <p className="text-xs text-slate-500 mt-2">Templates render in order. Each gets its own <code className="bg-slate-800 px-1 rounded">data</code> plus <code className="bg-slate-800 px-1 rounded">shared_data</code> merged in. Add <code className="bg-slate-800 px-1 rounded">?debug=1</code> to get JSON instead of a PDF.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────────

const ToolbarBtn: React.FC<{ onClick: () => void; title: string; children: React.ReactNode; className?: string }> = ({ onClick, title, children, className }) => (
  <button onMouseDown={e => { e.preventDefault(); onClick(); }} title={title}
    className={`px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors min-w-[26px] text-center ${className ?? 'text-slate-600 dark:text-slate-300'}`}>
    {children}
  </button>
);

const FieldsPanel: React.FC<{ fields: TemplateField[]; onInsert: (name: string) => void }> = ({ fields, onInsert }) => (
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
  </div>
);

const FieldRow: React.FC<{
  field: TemplateField;
  allFields: TemplateField[];
  onChange: (f: TemplateField) => void;
  onRemove: () => void;
}> = ({ field, allFields, onChange, onRemove }) => {
  const inp = 'flex-1 px-2.5 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500';
  // Available parents: other fields typed array or object (not self)
  const parentOptions = allFields.filter(
    f => (f.field_type === 'array' || f.field_type === 'object') && f.field_name !== field.field_name && f.field_name
  );
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
      <div className="flex gap-3 flex-wrap">
        <input value={field.field_name} onChange={e => onChange({ ...field, field_name: e.target.value })}
          placeholder="field_name" className={`${inp} font-mono min-w-[120px]`} />
        <select value={field.field_type} onChange={e => onChange({ ...field, field_type: e.target.value as TemplateField['field_type'] })}
          className={`w-28 flex-none px-2.5 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500`}>
          {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {/* Parent: select for all fields — marks this field as a child of a loop array */}
        <select
          value={field.parent_field ?? ''}
          onChange={e => onChange({ ...field, parent_field: e.target.value })}
          className={`w-36 flex-none px-2.5 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
            field.parent_field
              ? 'border-purple-400 bg-purple-50 dark:bg-purple-900/20 text-purple-800 dark:text-purple-200'
              : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400'
          }`}
          title="Parent array/object field (marks this as a child field for loops)"
        >
          <option value="">(no parent)</option>
          {parentOptions.map(p => (
            <option key={p.field_name} value={p.field_name}>{p.field_name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">
          <input type="checkbox" checked={field.is_required} onChange={e => onChange({ ...field, is_required: e.target.checked })} className="rounded" />
          Required
        </label>
        <button onClick={onRemove} className="text-slate-400 hover:text-red-500 transition-colors ml-auto" title="Remove field">
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
      </div>
      {/* Child indicator badge */}
      {field.parent_field && (
        <p className="text-xs text-purple-600 dark:text-purple-400">
          ↳ Child of <strong>{field.parent_field}</strong> — supplied per array item, not at top level
        </p>
      )}
    </div>
  );
};

const ProjectFieldRow: React.FC<{
  field: TemplateField & { is_array?: boolean };
  onChange: (f: TemplateField & { is_array?: boolean }) => void;
  onRemove: () => void;
}> = ({ field, onChange, onRemove }) => {
  const inp = 'px-2.5 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500';
  return (
    <div className="flex items-center gap-2 flex-wrap p-2 rounded-lg border border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <input value={field.field_name} onChange={e => onChange({ ...field, field_name: e.target.value })}
        placeholder="field_name" className={`${inp} flex-1 min-w-[120px] font-mono`} />
      <select value={field.field_type as string} onChange={e => onChange({ ...field, field_type: e.target.value as ProjectFieldType })}
        className={`${inp} w-28 flex-none`}>
        {PROJECT_FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      {/* Array checkbox */}
      <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap w-16 justify-center">
        <input type="checkbox" checked={field.is_array ?? false} onChange={e => onChange({ ...field, is_array: e.target.checked })}
          className="rounded accent-indigo-600" />
        Array
      </label>
      {/* Required checkbox */}
      <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap w-20 justify-center">
        <input type="checkbox" checked={field.is_required} onChange={e => onChange({ ...field, is_required: e.target.checked })}
          className="rounded accent-indigo-600" />
        Required
      </label>
      <input value={field.description} onChange={e => onChange({ ...field, description: e.target.value })}
        placeholder="Description" className={`${inp} flex-1 min-w-[100px]`} />
      <button onClick={onRemove} className="text-slate-400 hover:text-red-500 transition-colors flex-none" title="Remove field">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
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
