import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as mammoth from 'mammoth';
import { useAuth } from '../contexts/AuthContext';
import type { Project, ProjectFile, ProjectMessage, InventoryItem, ProjectDocument, DataMapping, ConsolidatedDataMapping, BusinessRule } from '../types';
import { generateDataMap, extractBusinessRules, generateTestCases } from '../services/llmService';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RGroup {
  id: number;
  similarity: number;
  isUnique: boolean;
  documents: { fileId: number; fileName: string; fileType: string }[];
}

interface ProjectMember {
  id: number;
  username: string;
  company_name: string;
  company_role: string;
  access_type: 'owner' | 'company' | 'invited';
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function mapInventoryItem(r: any): InventoryItem {
  return {
    id: r.id,
    projectId: r.project_id ?? r.projectId,
    fileId: r.file_id ?? r.fileId,
    fileName: r.file_name ?? r.fileName ?? r.name ?? '',
    fileType: r.file_type ?? r.fileType ?? '',
    groupId: r.group_id ?? r.groupId ?? null,
    variantCount: r.variant_count ?? r.variantCount ?? 1,
    variations: r.variations ?? [],
    businessDomain: r.business_domain ?? r.businessDomain ?? '',
    status: r.status ?? 'pending',
    notes: r.notes ?? '',
    createdAt: r.created_at ?? r.createdAt ?? '',
    updatedAt: r.updated_at ?? r.updatedAt ?? '',
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RULE_TYPE_COLORS: Record<string, string> = {
  Validation:   'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  Conditional:  'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  Calculation:  'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  Presentation: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
};
const TC_CATEGORY_COLORS: Record<string, string> = {
  'Happy Path':  'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  'Mandatory':   'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  'Boundary':    'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  'Conditional': 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
  'Format':      'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  'Calculation': 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
};
const PRIORITY_COLORS: Record<string, string> = {
  High:   'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800',
  Medium: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800',
  Low:    'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600',
};

const ROLE_COLORS: Record<string, string> = {
  template:  'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
  reference: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
  xsd:       'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  csv:       'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  archived:  'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
};
const ROLE_LABELS: Record<string, string> = {
  template:  'Template',
  reference: 'Reference',
  xsd:       'XSD',
  csv:       'CSV',
  archived:  'Archived',
};


const STATUS_LABELS: Record<string, string> = { pending: 'Pending', in_progress: 'In Progress', done: 'Done' };
const STATUS_COLORS: Record<string, string> = {
  pending:     'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
  in_progress: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  done:        'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
};

// ── Main component ─────────────────────────────────────────────────────────────

interface ProjectWorkspaceProps {
  projectId: number;
  onBack: () => void;
}

type Tab = 'home' | 'files' | 'rationalise' | 'inventory' | 'field_mapping' | 'brd' | 'test_cases';


const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = ({ projectId, onBack }) => {
  const { token, user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [messages, setMessages] = useState<ProjectMessage[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [loading, setLoading] = useState(true);

  // File upload (presigned URL flow)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<{ name: string; status: 'uploading' | 'done' | 'error'; error?: string }[]>([]);

  // Rationalise
  const [rMode, setRMode] = useState<'exact' | 'semantic'>('semantic');
  const [rThreshold, setRThreshold] = useState(75);
  const [rRunning, setRRunning] = useState(false);
  const [rGroups, setRGroups] = useState<RGroup[]>([]);
  const [rSkipped, setRSkipped] = useState<string[]>([]);
  const [rSelected, setRSelected] = useState<Set<number>>(new Set());
  const [rExpandedGroups, setRExpandedGroups] = useState<Set<number>>(new Set());
  const [rError, setRError] = useState('');

  // Inventory
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [editDomainId, setEditDomainId] = useState<number | null>(null);
  const [editDomainValue, setEditDomainValue] = useState('');
  const [addingToInventory, setAddingToInventory] = useState<Set<number>>(new Set());

  const xsdInputRef = useRef<HTMLInputElement>(null);

  // Generated project documents
  const [fieldMappingDoc, setFieldMappingDoc] = useState<ProjectDocument | null>(null);
  const [fieldMappingGenerating, setFieldMappingGenerating] = useState(false);
  const [fieldMappingError, setFieldMappingError] = useState('');
  const [brdDoc, setBrdDoc] = useState<ProjectDocument | null>(null);
  const [brdGenerating, setBrdGenerating] = useState(false);
  const [brdError, setBrdError] = useState('');
  const [testCasesDoc, setTestCasesDoc] = useState<ProjectDocument | null>(null);
  const [testCasesGenerating, setTestCasesGenerating] = useState(false);
  const [testCasesError, setTestCasesError] = useState('');
  const [tcFilter, setTcFilter] = useState('All');
  const [brdFilter, setBrdFilter] = useState('All');
  const [fileSearch, setFileSearch] = useState('');
  const [fileRoleFilter, setFileRoleFilter] = useState('all');
  const [fileTagFilter, setFileTagFilter] = useState('all');

  // Share panel
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  // Chat sidebar
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Fetch functions ──────────────────────────────────────────────────────────

  const fetchProject = useCallback(async () => {
    if (!token) return;
    try {
      const [projRes, filesRes] = await Promise.all([
        fetch(`/v1/projects/${projectId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/v1/projects/${projectId}/files`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (projRes.ok) setProject((await projRes.json()).project);
      if (filesRes.ok) setFiles((await filesRes.json()).files ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [token, projectId]);

  const fetchFiles = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/v1/projects/${projectId}/files`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setFiles((await res.json()).files ?? []);
    } catch { /* ignore */ }
  }, [token, projectId]);

  const fetchInventory = useCallback(async () => {
    if (!token) return;
    setInventoryLoading(true);
    try {
      const res = await fetch(`/v1/projects/${projectId}/inventory`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setInventory((data.inventory ?? data.items ?? []).map(mapInventoryItem));
      }
    } catch { /* ignore */ }
    setInventoryLoading(false);
  }, [token, projectId]);

  const fetchChat = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/v1/projects/${projectId}/chat`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setMessages((await res.json()).messages ?? []);
    } catch { /* ignore */ }
  }, [token, projectId]);

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchProject();
    fetchInventory(); // load count for badge immediately
    fetchChat();      // chat sidebar is always visible
    // preload generated docs for Files tab tiles
    fetchFieldMappingDoc();
    fetchBrdDoc();
    fetchTestCasesDoc();
  }, [fetchProject, fetchInventory, fetchChat]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'inventory') fetchInventory();
    if (activeTab === 'field_mapping') fetchFieldMappingDoc();
    if (activeTab === 'brd') fetchBrdDoc();
    if (activeTab === 'test_cases') fetchTestCasesDoc();
  }, [activeTab, fetchInventory]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── File handlers ────────────────────────────────────────────────────────────

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || !token) return;
    const fileArr = Array.from(fileList);
    setUploadQueue(fileArr.map(f => ({ name: f.name, status: 'uploading' as const })));

    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i];
      try {
        // Step 1: get presigned URL
        const presignRes = await fetch(`/v1/projects/${projectId}/files/presign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size }),
        });
        if (!presignRes.ok) {
          const d = await presignRes.json().catch(() => ({})) as any;
          throw new Error(d.error ?? `Presign failed (${presignRes.status})`);
        }
        const { uploadUrl, method, storageKey } = await presignRes.json();

        // Step 2: upload directly to S3/Azure — no auth header (presigned URL is self-authenticated)
        const uploadRes = await fetch(uploadUrl, {
          method,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!uploadRes.ok) throw new Error(`Storage upload failed (${uploadRes.status})`);

        // Step 3: confirm
        const confirmRes = await fetch(`/v1/projects/${projectId}/files/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ storageKey, fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, role: 'template' }),
        });
        if (!confirmRes.ok) {
          const d = await confirmRes.json().catch(() => ({})) as any;
          throw new Error(d.error ?? 'Confirm failed');
        }

        setUploadQueue(q => q.map((x, idx) => idx === i ? { ...x, status: 'done' } : x));
      } catch (err: any) {
        setUploadQueue(q => q.map((x, idx) => idx === i ? { ...x, status: 'error', error: err.message } : x));
      }
    }

    // Refresh file list; clear queue after 3s
    fetchProject();
    setTimeout(() => setUploadQueue([]), 3000);
  };

  const handleArchiveFile = async (fileId: number, archive: boolean) => {
    if (!token) return;
    await fetch(`/v1/projects/${projectId}/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ archived: archive }),
    });
    fetchProject();
  };

  const handleDeleteFile = async (fileId: number) => {
    if (!token || !confirm('Delete this file from cloud storage? This cannot be undone.')) return;
    await fetch(`/v1/projects/${projectId}/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchProject();
  };

  // ── Rationalise handlers ─────────────────────────────────────────────────────

  const handleRationalise = async () => {
    if (!token) return;
    setRRunning(true); setRError(''); setRGroups([]); setRSkipped([]); setRSelected(new Set()); setRExpandedGroups(new Set());
    try {
      const res = await fetch(`/v1/projects/${projectId}/rationalise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode: rMode, threshold: rThreshold }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as any;
        throw new Error(d.error ?? `Server error (${res.status})`);
      }
      const data = await res.json();
      const groups: RGroup[] = data.groups ?? [];
      setRGroups(groups);
      setRSkipped(data.skipped ?? []);
      // Auto-expand duplicate groups
      setRExpandedGroups(new Set(groups.filter(g => !g.isUnique).map(g => g.id)));
    } catch (e: any) {
      setRError(e.message ?? 'Rationalisation failed');
    }
    setRRunning(false);
  };

  const handleBulkAddToInventory = async () => {
    if (!token || rSelected.size === 0) return;
    for (const fileId of rSelected) {
      const group = rGroups.find(g => g.documents.some(d => d.fileId === fileId));
      if (!group) continue;
      try {
        await fetch(`/v1/projects/${projectId}/inventory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ fileId, groupId: group.id, variantCount: group.documents.length, variations: [] }),
        });
      } catch { /* ignore */ }
    }
    await fetchInventory();
    setRSelected(new Set());
  };

  const handleBulkMarkAsVariation = async () => {
    if (!token || rSelected.size === 0) return;
    if (!confirm(`Mark ${rSelected.size} template(s) as Variation? They will stay in your Files list but won't appear in future Rationalisation runs.`)) return;
    for (const fileId of rSelected) {
      await fetch(`/v1/projects/${projectId}/files/${fileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lifecycle_status: 'variation' }),
      }).catch(() => {});
    }
    const variationIds = new Set(rSelected);
    setRSelected(new Set());
    setRGroups(prev => prev
      .map(g => ({ ...g, documents: g.documents.filter(d => !variationIds.has(d.fileId)) }))
      .filter(g => g.documents.length > 0)
    );
    fetchProject();
  };

  // ── Inventory handlers ───────────────────────────────────────────────────────

  const handleAddToInventory = async (fileId: number, groupId: number, variantCount: number) => {
    if (!token) return;
    setAddingToInventory(prev => new Set(prev).add(fileId));
    try {
      const res = await fetch(`/v1/projects/${projectId}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fileId, groupId, variantCount, variations: [] }),
      });
      if (res.ok) await fetchInventory();
    } catch { /* ignore */ }
    setAddingToInventory(prev => { const s = new Set(prev); s.delete(fileId); return s; });
  };

  const handleRemoveFromInventory = async (itemId: number) => {
    if (!token) return;
    await fetch(`/v1/projects/${projectId}/inventory/${itemId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setInventory(prev => prev.filter(i => i.id !== itemId));
    await fetchFiles(); // restore file to Files tab (server sets lifecycle_status back to 'rationalized')
  };

  const handleUpdateInventoryStatus = async (itemId: number, status: InventoryItem['status']) => {
    if (!token) return;
    await fetch(`/v1/projects/${projectId}/inventory/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
    setInventory(prev => prev.map(i => i.id === itemId ? { ...i, status } : i));
  };

  const handleSaveDomain = async (itemId: number) => {
    if (!token) return;
    await fetch(`/v1/projects/${projectId}/inventory/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ businessDomain: editDomainValue }),
    });
    setInventory(prev => prev.map(i => i.id === itemId ? { ...i, businessDomain: editDomainValue } : i));
    setEditDomainId(null);
  };

  // ── Doc generation helpers ─────────────────────────────────────────────────

  const downloadFileFromUrl = useCallback(async (url: string, name: string): Promise<File> => {
    const res = await fetch(url);
    const blob = await res.blob();
    return new File([blob], name);
  }, []);

  const fileToText = useCallback(async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    if (file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc')) {
      const result = await (mammoth as any).convertToHtml({ arrayBuffer });
      const div = document.createElement('div');
      div.innerHTML = result.value;
      return div.textContent ?? '';
    }
    return new TextDecoder().decode(arrayBuffer);
  }, []);

  const consolidateMappings = useCallback((mappings: DataMapping[]): ConsolidatedDataMapping[] => {
    const normalize = (s: string) => s.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
    const byKey = new Map<string, ConsolidatedDataMapping>();
    for (const m of mappings) {
      const key = normalize(m.field);
      if (!byKey.has(key)) {
        byKey.set(key, { field: m.field, xsdPath: m.xsdPath, sampleValue: m.sampleValue, templateCount: 0, templates: [] });
      }
      const ex = byKey.get(key)!;
      if (!ex.templates.includes(m.templateName)) { ex.templates.push(m.templateName); ex.templateCount++; }
      if ((!ex.xsdPath || ex.xsdPath === 'path not found') && m.xsdPath && m.xsdPath !== 'path not found') ex.xsdPath = m.xsdPath;
      if (!ex.sampleValue && m.sampleValue) ex.sampleValue = m.sampleValue;
    }
    return Array.from(byKey.values()).sort((a, b) => b.templateCount - a.templateCount);
  }, []);

  const saveDocument = useCallback(async (docType: string, content: Record<string, unknown>) => {
    if (!token) return null;
    const res = await fetch(`/v1/projects/${projectId}/documents/${docType}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.document ?? data;
  }, [token, projectId]);

  const fetchFieldMappingDoc = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`/v1/projects/${projectId}/documents/field_mapping`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) { const d = await res.json(); setFieldMappingDoc(d.document ?? null); }
  }, [token, projectId]);

  const fetchBrdDoc = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`/v1/projects/${projectId}/documents/brd`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) { const d = await res.json(); setBrdDoc(d.document ?? null); }
  }, [token, projectId]);

  const fetchTestCasesDoc = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`/v1/projects/${projectId}/documents/test_cases`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) { const d = await res.json(); setTestCasesDoc(d.document ?? null); }
  }, [token, projectId]);

  const handleGenerateFieldMapping = useCallback(async (updateOnly = false) => {
    if (!token) return;
    const processedIds: number[] = (fieldMappingDoc?.content as any)?.processedFileIds ?? [];
    const existingFields: ConsolidatedDataMapping[] = (fieldMappingDoc?.content as any)?.fields ?? [];
    const invFileIds = new Set(inventory.map(i => i.fileId));
    const invPFs = files.filter(f => invFileIds.has(f.id) && f.signedUrl && !f.archived);
    const toProcess = invPFs.filter(f =>
      (f.name.toLowerCase().endsWith('.docx') || f.name.toLowerCase().endsWith('.doc')) &&
      (!updateOnly || !processedIds.includes(f.id))
    );
    const xsdPf = files.find(f => f.name.toLowerCase().endsWith('.xsd') && !f.archived && f.signedUrl);
    if (!xsdPf) { setFieldMappingError('No XSD file found in project files. Upload an .xsd file using "Upload XSD" above.'); return; }
    if (toProcess.length === 0) { setFieldMappingError(updateOnly ? 'No new templates to process — all inventory templates already mapped.' : 'No DOCX templates found in inventory.'); return; }
    setFieldMappingGenerating(true); setFieldMappingError('');
    try {
      const xsdFile = await downloadFileFromUrl(xsdPf.signedUrl!, xsdPf.name);
      const xsdContent = await fileToText(xsdFile);
      const newMappings: DataMapping[] = [];
      for (const pf of toProcess) {
        const file = await downloadFileFromUrl(pf.signedUrl!, pf.name);
        const docxContent = await fileToText(file);
        const result = await generateDataMap(docxContent, xsdContent, pf.name);
        newMappings.push(...result.mappings);
      }
      const existingAsMappings: DataMapping[] = existingFields.flatMap(f =>
        (f.templates ?? []).map(t => ({ field: f.field, xsdPath: f.xsdPath, sampleValue: f.sampleValue, templateName: t, pageNumber: '' }))
      );
      const consolidated = consolidateMappings([...existingAsMappings, ...newMappings]);
      const newProcessedIds = [...new Set([...processedIds, ...toProcess.map(f => f.id)])];
      const saved = await saveDocument('field_mapping', {
        fields: consolidated,
        processedFileIds: newProcessedIds,
        totalFields: consolidated.length,
        summary: `${consolidated.length} unique fields across ${newProcessedIds.length} template(s).`,
      });
      if (saved) setFieldMappingDoc(saved);
    } catch (err: any) {
      setFieldMappingError(err.message ?? 'Generation failed.');
    } finally {
      setFieldMappingGenerating(false);
    }
  }, [token, fieldMappingDoc, inventory, files, saveDocument, downloadFileFromUrl, fileToText, consolidateMappings]);

  const handleGenerateBrd = useCallback(async (updateOnly = false) => {
    if (!token) return;
    const processedIds: number[] = (brdDoc?.content as any)?.processedFileIds ?? [];
    const existingRules: BusinessRule[] = (brdDoc?.content as any)?.rules ?? [];
    const invFileIds = new Set(inventory.map(i => i.fileId));
    const invPFs = files.filter(f => invFileIds.has(f.id) && f.signedUrl && !f.archived);
    const toProcess = invPFs.filter(f =>
      (f.name.toLowerCase().endsWith('.docx') || f.name.toLowerCase().endsWith('.doc')) &&
      (!updateOnly || !processedIds.includes(f.id))
    );
    if (toProcess.length === 0) { setBrdError(updateOnly ? 'No new templates to process.' : 'No DOCX templates found in inventory.'); return; }
    setBrdGenerating(true); setBrdError('');
    try {
      const newRules: BusinessRule[] = [];
      for (const pf of toProcess) {
        const file = await downloadFileFromUrl(pf.signedUrl!, pf.name);
        const text = await fileToText(file);
        const result = await extractBusinessRules(text);
        newRules.push(...result.rules);
      }
      const allRules = [...existingRules, ...newRules];
      const seen = new Set<string>();
      const deduped = allRules.filter(r => {
        const key = `${r.fieldName}|${r.ruleType}|${r.condition}`;
        if (seen.has(key)) return false; seen.add(key); return true;
      });
      const newProcessedIds = [...new Set([...processedIds, ...toProcess.map(f => f.id)])];
      const saved = await saveDocument('brd', { rules: deduped, processedFileIds: newProcessedIds, totalRules: deduped.length });
      if (saved) setBrdDoc(saved);
    } catch (err: any) {
      setBrdError(err.message ?? 'Extraction failed.');
    } finally {
      setBrdGenerating(false);
    }
  }, [token, brdDoc, inventory, files, saveDocument, downloadFileFromUrl, fileToText]);

  const handleGenerateTestCases = useCallback(async () => {
    const rules: BusinessRule[] = (brdDoc?.content as any)?.rules ?? [];
    if (!rules.length) { setTestCasesError('Generate BRD first to provide business rules.'); return; }
    setTestCasesGenerating(true); setTestCasesError('');
    try {
      const rulesText = rules.map((r, i) => [
        `Rule ${i + 1}:`,
        `  Field: ${r.fieldName}`,
        `  Type: ${r.ruleType}`,
        r.condition ? `  Condition: ${r.condition}` : '',
        r.actionFormula ? `  Action/Formula: ${r.actionFormula}` : '',
        `  Priority: ${r.priority ?? 'Medium'}`,
      ].filter(Boolean).join('\n')).join('\n\n');
      const result = await generateTestCases(`--- BUSINESS RULES ---\n\n${rulesText}\n\n--- ADDITIONAL HINTS ---\n\nNone provided.`);
      const indexed = result.testCases.map((tc, i) => ({ ...tc, id: `TC-${String(i + 1).padStart(3, '0')}` }));
      const saved = await saveDocument('test_cases', { testCases: indexed, generatedAt: new Date().toISOString(), sourceVersion: brdDoc?.version ?? 1 });
      if (saved) setTestCasesDoc(saved);
    } catch (err: any) {
      setTestCasesError(err.message ?? 'Generation failed.');
    } finally {
      setTestCasesGenerating(false);
    }
  }, [brdDoc, saveDocument]);

  const downloadBlob = (content: string, filename: string, mime: string) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = filename; a.click();
  };
  const escCsv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const handleDownloadFieldMappingCsv = () => {
    const fields: ConsolidatedDataMapping[] = (fieldMappingDoc?.content as any)?.fields ?? [];
    if (!fields.length) return;
    const header = ['Field', 'XSD Path', 'Sample Value', 'Templates', 'Template Count'];
    const rows = fields.map(f => [f.field, f.xsdPath, f.sampleValue, (f.templates ?? []).join('; '), f.templateCount].map(escCsv).join(','));
    downloadBlob([header.join(','), ...rows].join('\n'), 'Field_Mapping.csv', 'text/csv');
  };
  const handleDownloadBrdCsv = () => {
    const rules: BusinessRule[] = (brdDoc?.content as any)?.rules ?? [];
    if (!rules.length) return;
    const header = ['Field Name', 'Source Reference', 'Rule Type', 'Condition', 'Action / Formula', 'Error Message', 'Dependent Fields', 'Priority', 'Page Ref'];
    const rows = rules.map(r => [r.fieldName, r.sourceReference ?? '', r.ruleType, r.condition, r.actionFormula, r.errorMessage, r.dependentFields, r.priority, r.pageReference ?? ''].map(escCsv).join(','));
    downloadBlob([header.join(','), ...rows].join('\n'), 'Business_Rules.csv', 'text/csv');
  };
  const handleDownloadTestCasesCsv = () => {
    const cases: any[] = (testCasesDoc?.content as any)?.testCases ?? [];
    if (!cases.length) return;
    const header = ['Test Case ID', 'Field Section', 'Category', 'Description', 'Input Data', 'Expected Result', 'Priority', 'Preconditions', 'Test Steps'];
    const rows = cases.map((tc: any) => [tc.id, tc.fieldSection, tc.category, tc.testDescription, tc.inputData, tc.expectedResult, tc.priority, tc.preconditions, tc.testSteps].map(escCsv).join(','));
    downloadBlob([header.join(','), ...rows].join('\n'), 'Test_Cases.csv', 'text/csv');
  };

  // ── Inventory file loader for accelerator tabs ───────────────────────────────

  const loadInventoryFilesFromStorage = useCallback(async (): Promise<{ docxFiles: File[]; xsdFile: File | null; allFiles: File[] }> => {
    if (!token) return { docxFiles: [], xsdFile: null, allFiles: [] };
    const invFileIds = new Set(inventory.map(i => i.fileId));
    const invProjectFiles = files.filter(f => invFileIds.has(f.id) && f.signedUrl);
    const getMime = (fileType: string) => {
      if (fileType.includes('pdf')) return 'application/pdf';
      if (fileType.includes('docx') || fileType.includes('doc')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if (fileType.includes('xsd')) return 'application/xml';
      return 'application/octet-stream';
    };
    const downloaded = await Promise.all(
      invProjectFiles.map(async f => {
        try {
          const res = await fetch(f.signedUrl!);
          const blob = await res.blob();
          return new File([blob], f.name, { type: getMime(f.fileType) });
        } catch { return null; }
      })
    );
    const validFiles = downloaded.filter(Boolean) as File[];
    const docxFiles = validFiles.filter(f => f.name.toLowerCase().endsWith('.docx') || f.name.toLowerCase().endsWith('.doc'));
    const xsdFile = validFiles.find(f => f.name.toLowerCase().endsWith('.xsd')) ?? null;
    return { docxFiles, xsdFile, allFiles: validFiles };
  }, [token, inventory, files]);

  // ── Share / members ──────────────────────────────────────────────────────────

  const fetchMembers = useCallback(async () => {
    if (!token) return;
    setMembersLoading(true);
    try {
      const r = await fetch(`/v1/projects/${projectId}/members`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setMembers(d.members ?? []);
    } catch { /* ignore */ } finally {
      setMembersLoading(false);
    }
  }, [projectId, token]);

  useEffect(() => { if (showSharePanel) fetchMembers(); }, [showSharePanel, fetchMembers]);

  const handleInvite = async () => {
    if (!inviteUsername.trim()) return;
    setInviteError(''); setInviteLoading(true);
    try {
      const r = await fetch(`/v1/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username: inviteUsername.trim() }),
      });
      const d = await r.json();
      if (!r.ok) { setInviteError(d.error ?? 'Failed to invite'); return; }
      setInviteUsername('');
      fetchMembers();
    } catch { setInviteError('Network error'); } finally {
      setInviteLoading(false);
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!token) return;
    await fetch(`/v1/projects/${projectId}/members/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchMembers();
  };

  // ── Chat handler ─────────────────────────────────────────────────────────────

  const handleClearChat = useCallback(async () => {
    if (!token || !messages.length) return;
    if (!window.confirm('Clear all chat history for this project? This cannot be undone.')) return;
    try {
      await fetch(`/v1/projects/${projectId}/chat`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setMessages([]);
    } catch { /* silently ignore */ }
  }, [token, projectId, messages.length]);

  const handleSendChat = async () => {
    if (!chatInput.trim() || !token || chatLoading) return;
    const msg = chatInput.trim();
    const msgLower = msg.toLowerCase();
    setChatInput('');
    setChatLoading(true);
    setMessages(prev => [...prev, { id: Date.now(), projectId, userId: 0, role: 'user', content: msg, createdAt: new Date().toISOString() }]);

    // Intent detection: intercept generate commands before sending to LLM
    const hasGenerateVerb = /\b(generate|create|run|start|initiate|make|do|perform|build|extract|analyse|analyze|produce)\b/.test(msgLower);
    const isFieldMapping = /\b(field.?mapping|fields?.?map|map.?fields?|data.?mapping|dynamic.?fields?|field.?extract)\b/.test(msgLower);
    const isBrd = hasGenerateVerb && /\b(brd|business.?req|business.?rules?)\b/.test(msgLower);
    const isTestCases = hasGenerateVerb && /\b(test.?cases?|test.?tracker|test.?suite)\b/.test(msgLower);

    if (isFieldMapping) {
      setActiveTab('field_mapping');
      const hasXsd = files.some(f => f.name.toLowerCase().endsWith('.xsd') && !f.archived);
      const msg = hasXsd ? 'Starting field mapping from inventory…' : 'No XSD found in project files — please upload an .xsd file first.';
      setMessages(prev => [...prev, { id: Date.now() + 1, projectId, userId: 0, role: 'assistant', content: msg, createdAt: new Date().toISOString() }]);
      if (hasXsd) {
        await handleGenerateFieldMapping(fieldMappingDoc !== null);
        setMessages(prev => [...prev, { id: Date.now() + 2, projectId, userId: 0, role: 'assistant', content: '✅ Field mapping complete — see the Fields Mapping tab for results.', createdAt: new Date().toISOString() }]);
      }
      setChatLoading(false);
      return;
    }
    if (isBrd) {
      setActiveTab('brd');
      setMessages(prev => [...prev, { id: Date.now() + 1, projectId, userId: 0, role: 'assistant', content: 'Extracting business rules from inventory templates…', createdAt: new Date().toISOString() }]);
      await handleGenerateBrd(brdDoc !== null);
      setMessages(prev => [...prev, { id: Date.now() + 2, projectId, userId: 0, role: 'assistant', content: '✅ BRD extraction complete — see the BRD tab for results.', createdAt: new Date().toISOString() }]);
      setChatLoading(false);
      return;
    }
    if (isTestCases) {
      setActiveTab('test_cases');
      if (!((brdDoc?.content as any)?.rules?.length)) {
        setMessages(prev => [...prev, { id: Date.now() + 1, projectId, userId: 0, role: 'assistant', content: 'Please generate BRD first — test cases are derived from the extracted business rules.', createdAt: new Date().toISOString() }]);
      } else {
        setMessages(prev => [...prev, { id: Date.now() + 1, projectId, userId: 0, role: 'assistant', content: 'Generating test cases from BRD rules…', createdAt: new Date().toISOString() }]);
        await handleGenerateTestCases();
        setMessages(prev => [...prev, { id: Date.now() + 2, projectId, userId: 0, role: 'assistant', content: '✅ Test cases generated — see the Test Cases tab for results.', createdAt: new Date().toISOString() }]);
      }
      setChatLoading(false);
      return;
    }

    try {
      const res = await fetch(`/v1/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: msg }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(prev => [...prev, { id: Date.now() + 1, projectId, userId: 0, role: 'assistant', content: data.reply, createdAt: new Date().toISOString() }]);
      }
    } catch { /* ignore */ }
    setChatLoading(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const panelCls = 'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm';
  const inInventoryFileIds = new Set(inventory.map(i => i.fileId));
  const activeFiles = files.filter(f => !f.archived);
  const archivedFiles = files.filter(f => f.archived);
  const detectedXsd = files.find(f => f.name.toLowerCase().endsWith('.xsd') && !f.archived) ?? null;

  // Files tab filtering — includes archived files
  const filteredFiles = files.filter(f => {
    if (fileSearch && !f.name.toLowerCase().includes(fileSearch.toLowerCase())) return false;
    if (fileRoleFilter !== 'all' && f.role !== fileRoleFilter) return false;
    if (fileTagFilter === 'in_inventory' && !inInventoryFileIds.has(f.id)) return false;
    if (fileTagFilter === 'rationalized' && f.lifecycleStatus !== 'rationalized') return false;
    if (fileTagFilter === 'variation' && f.lifecycleStatus !== 'variation') return false;
    if (fileTagFilter === 'archived' && !f.archived) return false;
    return true;
  });

  if (loading) {
    return <div className="max-w-6xl mx-auto py-8 text-sm text-slate-500 dark:text-slate-400">Loading project...</div>;
  }
  if (!project) {
    return <div className="max-w-6xl mx-auto py-8 text-sm text-red-500">Project not found.</div>;
  }

  const tabs: { id: Tab; label: string; icon: string; badge?: number }[] = [
    { id: 'home',          label: 'Home',           icon: '🏠' },
    { id: 'files',         label: 'Files',          icon: '📁', badge: files.length || undefined },
    { id: 'rationalise',   label: 'Rationalise',    icon: '🔗' },
    { id: 'inventory',     label: 'Inventory',      icon: '📋', badge: inventory.length || undefined },
    { id: 'field_mapping', label: 'Fields Mapping', icon: '🗺️' },
    { id: 'brd',           label: 'BRD',            icon: '📄' },
    { id: 'test_cases',    label: 'Test Cases',     icon: '✅' },
  ];

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 140px)' }}>

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Projects
        </button>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">{project.name}</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${project.status === 'active' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>
          {project.status}
        </span>
        <div className="ml-auto">
          <button
            onClick={() => setShowSharePanel(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
            </svg>
            Share
          </button>
        </div>
      </div>

      {project.description && (
        <p className="text-sm text-slate-500 dark:text-slate-400">{project.description}</p>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
        {tabs.map(({ id, label, icon, badge }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === id
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <span>{icon}</span>
            {label}
            {badge !== undefined && badge > 0 && (
              <span className="ml-0.5 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 text-xs px-1.5 py-0.5 rounded-full">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Row split: tab content (left) + chat sidebar (right) ── */}
      <div className="flex flex-row flex-1 overflow-hidden min-h-0">
      <div className={activeTab === 'files' ? 'flex-1 min-w-0 flex flex-col overflow-hidden pr-1 pt-4' : 'flex-1 min-w-0 overflow-y-auto pb-10 space-y-4 pr-1 pt-4'}>

      {/* ── Home tab ── */}
      {activeTab === 'home' && (() => {
        // Phase auto-detection
        const phases = [
          {
            id: 1, label: 'Upload Files', desc: 'Add templates, XSD schemas, and reference documents.',
            tab: 'files' as Tab, done: files.length > 0,
            stat: `${files.length} file${files.length !== 1 ? 's' : ''}`,
            action: 'Upload Files',
          },
          {
            id: 2, label: 'Rationalise', desc: 'Group similar templates, remove duplicates, identify variations.',
            tab: 'rationalise' as Tab, done: rGroups.length > 0 || inventory.length > 0,
            stat: rGroups.length > 0 ? `${rGroups.length} group${rGroups.length !== 1 ? 's' : ''}` : 'Not run',
            action: 'Run Rationalisation',
          },
          {
            id: 3, label: 'Build Inventory', desc: 'Confirm the canonical set of templates for this project.',
            tab: 'inventory' as Tab, done: inventory.length > 0,
            stat: `${inventory.length} template${inventory.length !== 1 ? 's' : ''}`,
            action: 'Add to Inventory',
          },
          {
            id: 4, label: 'Fields Mapping', desc: 'Extract and map dynamic fields across all templates to XSD paths.',
            tab: 'field_mapping' as Tab, done: fieldMappingDoc !== null,
            stat: fieldMappingDoc ? `${(fieldMappingDoc.content as any)?.totalFields ?? 0} fields` : 'Not generated',
            action: 'Generate Field Mapping',
          },
          {
            id: 5, label: 'Business Rules', desc: 'Extract validation, conditional, and calculation rules from templates.',
            tab: 'brd' as Tab, done: brdDoc !== null,
            stat: brdDoc ? `${(brdDoc.content as any)?.rules?.length ?? 0} rules` : 'Not generated',
            action: 'Generate BRD',
          },
          {
            id: 6, label: 'Test Cases', desc: 'Generate categorised test cases (Happy Path, Boundary, Format…).',
            tab: 'test_cases' as Tab, done: testCasesDoc !== null,
            stat: testCasesDoc ? `${(testCasesDoc.content as any)?.testCases?.length ?? 0} cases` : 'Not generated',
            action: 'Generate Test Cases',
          },
        ];
        const completedCount = phases.filter(p => p.done).length;
        const nextPhase = phases.find(p => !p.done);
        const generatedDocCount = [fieldMappingDoc, brdDoc, testCasesDoc].filter(Boolean).length;
        const activeTemplates = activeFiles.filter(f => f.role === 'template').length;

        return (
          <div className="space-y-5">
            {/* Project info card */}
            <div className={`${panelCls} p-5`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">{project?.name}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${project?.status === 'active' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>
                      {project?.status === 'active' ? 'Active' : 'Archived'}
                    </span>
                  </div>
                  {project?.description && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{project.description}</p>}
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                    Created {project?.createdAt ? new Date(project.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                    {project?.updatedAt && project.updatedAt !== project.createdAt ? ` · Updated ${new Date(project.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                  </p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{completedCount}<span className="text-base font-normal text-slate-400">/{phases.length}</span></div>
                  <div className="text-xs text-slate-400 mt-0.5">phases complete</div>
                </div>
              </div>
              {/* Overall progress bar */}
              <div className="mt-4">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Overall Progress</span>
                  <span>{Math.round((completedCount / phases.length) * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-700"
                    style={{ width: `${(completedCount / phases.length) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total Files',       value: files.length,         sub: `${activeFiles.length} active`,              color: 'text-indigo-600 dark:text-indigo-400',  tab: 'files' as Tab },
                { label: 'Templates',         value: activeTemplates,      sub: `${inventory.length} in inventory`,          color: 'text-violet-600 dark:text-violet-400',  tab: 'inventory' as Tab },
                { label: 'Business Rules',    value: (brdDoc?.content as any)?.rules?.length ?? 0, sub: brdDoc ? 'Extracted' : 'Pending', color: 'text-blue-600 dark:text-blue-400', tab: 'brd' as Tab },
                { label: 'Generated Docs',    value: generatedDocCount,    sub: `of 3 available`,                            color: 'text-emerald-600 dark:text-emerald-400', tab: 'test_cases' as Tab },
              ].map(s => (
                <button key={s.label} onClick={() => setActiveTab(s.tab)} className={`${panelCls} p-4 text-left hover:shadow-md transition-shadow group`}>
                  <div className={`text-2xl font-bold ${s.color} group-hover:scale-105 transition-transform`}>{s.value}</div>
                  <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mt-0.5">{s.label}</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{s.sub}</div>
                </button>
              ))}
            </div>

            {/* Phase pipeline */}
            <div className={`${panelCls} p-5`}>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-4">Implementation Phases</h3>
              <div className="space-y-3">
                {phases.map((phase, idx) => {
                  const locked = idx > 0 && !phases[idx - 1].done;
                  return (
                    <div key={phase.id} className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${phase.done ? 'bg-emerald-50 dark:bg-emerald-900/10' : locked ? 'opacity-40' : 'bg-indigo-50 dark:bg-indigo-900/10'}`}>
                      {/* Phase indicator */}
                      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${phase.done ? 'bg-emerald-500 text-white' : locked ? 'bg-slate-200 dark:bg-slate-600 text-slate-500' : 'bg-indigo-500 text-white'}`}>
                        {phase.done ? (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                        ) : phase.id}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm font-medium ${phase.done ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200'}`}>{phase.label}</span>
                          <span className={`text-xs flex-shrink-0 ${phase.done ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>{phase.stat}</span>
                        </div>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{phase.desc}</p>
                      </div>
                      <button
                        onClick={() => setActiveTab(phase.tab)}
                        disabled={locked}
                        className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${phase.done ? 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/20' : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed'}`}
                      >
                        {phase.done ? 'View' : 'Start'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Next recommended action */}
            {nextPhase && (
              <div className={`${panelCls} p-5 border-l-4 border-indigo-500`}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs text-indigo-500 dark:text-indigo-400 font-medium uppercase tracking-wide mb-0.5">Recommended Next Step</p>
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-white">{nextPhase.action}</h4>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{nextPhase.desc}</p>
                  </div>
                  <button onClick={() => setActiveTab(nextPhase.tab)} className="flex-shrink-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors">
                    Go to Phase {nextPhase.id}
                  </button>
                </div>
              </div>
            )}
            {!nextPhase && (
              <div className={`${panelCls} p-5 border-l-4 border-emerald-500`}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">All phases complete!</h4>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Field Mapping, Business Rules, and Test Cases are ready to download from the Files tab.</p>
                  </div>
                </div>
              </div>
            )}

            {/* How it works */}
            <details className={`${panelCls}`} open>
              <summary className="p-5 text-sm font-semibold text-slate-700 dark:text-slate-300 cursor-pointer select-none list-none flex items-center justify-between">
                <span>How It Works</span>
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
              </summary>
              <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-100 dark:border-slate-700 pt-4">
                {[
                  { step: '1', title: 'Upload Files', body: 'Start by uploading all your CCM templates (DOCX/PDF), XSD schemas, and any reference files. All files are stored securely in your organisation\'s cloud storage.' },
                  { step: '2', title: 'Rationalise', body: 'The Rationalise tab clusters similar templates using AI-powered similarity analysis. Identify duplicates, merge variations, and archive files you no longer need.' },
                  { step: '3', title: 'Build Inventory', body: 'Promote the canonical set of templates into the Final Inventory. Each inventory item tracks its business domain, status, and any known variations.' },
                  { step: '4', title: 'Map Fields', body: 'Automatically extract all dynamic field placeholders from your templates and map each one to its XSD path. Supports multi-template consolidation and deduplication.' },
                  { step: '5', title: 'Extract Business Rules', body: 'AI reads your templates and extracts validation rules, conditional logic, and calculations — producing a structured BRD ready for review and download.' },
                  { step: '6', title: 'Generate Test Cases', body: 'From the BRD, automatically generate categorised test cases covering Happy Path, Mandatory fields, Boundary values, Conditional logic, Format checks, and Calculations.' },
                ].map(item => (
                  <div key={item.step} className="flex gap-3">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 text-xs font-bold flex items-center justify-center mt-0.5">{item.step}</div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{item.title}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        );
      })()}

      {/* ── Files tab ── */}
      {activeTab === 'files' && (
        <div className="flex flex-col flex-1 min-h-0 gap-4">

          {/* Generated Documents — pinned at top */}
          {(fieldMappingDoc || brdDoc || testCasesDoc) && (
            <div className={`${panelCls} p-4 flex-shrink-0`}>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-3">Generated Documents</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  fieldMappingDoc ? { label: 'Field_Mapping.csv', desc: `${(fieldMappingDoc.content as any)?.totalFields ?? 0} fields`, onDownload: handleDownloadFieldMappingCsv, updated: fieldMappingDoc.updatedAt } : null,
                  brdDoc ? { label: 'Business_Rules.csv', desc: `${(brdDoc.content as any)?.rules?.length ?? 0} rules`, onDownload: handleDownloadBrdCsv, updated: brdDoc.updatedAt } : null,
                  testCasesDoc ? { label: 'Test_Cases.csv', desc: `${(testCasesDoc.content as any)?.testCases?.length ?? 0} test cases`, onDownload: handleDownloadTestCasesCsv, updated: testCasesDoc.updatedAt } : null,
                ].filter(Boolean).map((doc: any, i) => (
                  <div key={i} className="flex items-center justify-between p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-700/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <svg className="w-5 h-5 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{doc.label}</p>
                        <p className="text-xs text-slate-400">{doc.desc} · {new Date(doc.updated).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <button onClick={doc.onDownload} className="ml-2 flex-shrink-0 text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium">Download</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Project Files — grows to fill remaining height, scrolls inside */}
          <div className={`${panelCls} flex flex-col flex-1 min-h-0 overflow-hidden mb-10`}>
            {/* Fixed header */}
            <div className="flex-shrink-0 px-5 pt-5 pb-3">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Project Files</h3>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{files.length} file{files.length !== 1 ? 's' : ''} · {activeFiles.length} active · {archivedFiles.length} archived</p>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadQueue.some(f => f.status === 'uploading')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                  </svg>
                  {uploadQueue.some(f => f.status === 'uploading') ? 'Uploading...' : 'Upload Files'}
                </button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => handleUpload(e.target.files)} accept=".pdf,.docx,.doc,.xsd,.csv,.xml,.gd" />
              </div>

              {/* Upload progress */}
              {uploadQueue.length > 0 && (
                <div className="mb-3 space-y-1">
                  {uploadQueue.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-700/50">
                      {f.status === 'uploading' && <svg className="w-3 h-3 animate-spin text-indigo-500" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
                      {f.status === 'done' && <svg className="w-3 h-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                      {f.status === 'error' && <svg className="w-3 h-3 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>}
                      <span className={f.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}>{f.name}</span>
                      {f.status === 'uploading' && <span className="text-slate-400">Uploading directly to storage…</span>}
                      {f.error && <span className="text-red-500 ml-1">{f.error}</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Filter bar */}
              {files.length > 0 && (
                <div className="space-y-2">
                  <div className="relative">
                    <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                    <input
                      type="text"
                      value={fileSearch}
                      onChange={e => setFileSearch(e.target.value)}
                      placeholder="Search files…"
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </div>
                  <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Type:</span>
                    {(['all', 'template', 'reference', 'xsd', 'csv'] as const).map(r => (
                      <button key={r} onClick={() => setFileRoleFilter(r)}
                        className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${fileRoleFilter === r ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                        {r === 'all' ? 'All' : ROLE_LABELS[r] ?? r}
                      </button>
                    ))}
                    <span className="text-slate-300 dark:text-slate-600 select-none">|</span>
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Tag:</span>
                    {[
                      { key: 'all',          label: 'All' },
                      { key: 'in_inventory', label: 'In Inventory' },
                      { key: 'rationalized', label: 'Rationalized' },
                      { key: 'variation',    label: 'Variation' },
                      { key: 'archived',     label: 'Archived' },
                    ].map(({ key, label }) => (
                      <button key={key} onClick={() => setFileTagFilter(key)}
                        className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${fileTagFilter === key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Scrollable file list */}
            <div className="flex-1 overflow-y-auto border-t border-slate-100 dark:border-slate-700">
              {files.length === 0 ? (
                <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400 transition-colors m-5" onClick={() => fileInputRef.current?.click()}>
                  <svg className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                  <p className="text-sm text-slate-500 dark:text-slate-400">No files yet. Click to upload templates, XSD schemas, or CSVs.</p>
                </div>
              ) : filteredFiles.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-6">No files match the current filters.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-700 px-5">
                  {filteredFiles.map(f => (
                    <div key={f.id} className={`flex items-center justify-between py-3 gap-3 ${f.archived ? 'opacity-60' : f.lifecycleStatus === 'variation' ? 'bg-amber-50 dark:bg-amber-900/10 -mx-1 px-1 rounded' : ''}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium truncate ${f.archived ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-white'}`}>{f.name}</span>
                          <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full ${ROLE_COLORS[f.role] ?? ROLE_COLORS.template}`}>{ROLE_LABELS[f.role] ?? f.role}</span>
                          {f.lifecycleStatus === 'rationalized' && <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">Rationalized</span>}
                          {f.lifecycleStatus === 'variation' && <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Variation</span>}
                          {inInventoryFileIds.has(f.id) && <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">In Inventory</span>}
                          {f.archived && <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">Archived</span>}
                        </div>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{formatBytes(f.sizeBytes)} · {new Date(f.createdAt).toLocaleDateString()}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {f.signedUrl && <a href={f.signedUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300">Download</a>}
                        {f.archived
                          ? <button onClick={() => handleArchiveFile(f.id, false)} className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300">Restore</button>
                          : <button onClick={() => handleArchiveFile(f.id, true)} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">Archive</button>}
                        <button onClick={() => handleDeleteFile(f.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ── Rationalise tab ── */}
      {activeTab === 'rationalise' && (
        <div className="space-y-4 relative">
          {/* Controls panel */}
          <div className={`${panelCls} p-5`}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-1">Rationalise Templates</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Groups similar templates by content. Select templates from groups, then add to inventory or archive duplicates.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              {/* Mode selector */}
              <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-sm">
                {(['exact', 'semantic'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setRMode(m)}
                    className={`px-4 py-1.5 font-medium capitalize transition-colors ${rMode === m ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {/* Threshold slider — semantic only */}
              {rMode === 'semantic' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Threshold:</span>
                  <input type="range" min={50} max={99} value={rThreshold} onChange={e => setRThreshold(Number(e.target.value))} className="w-32 accent-indigo-600" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 w-8">{rThreshold}%</span>
                </div>
              )}
              {/* Run button */}
              <button
                onClick={handleRationalise}
                disabled={rRunning || activeFiles.filter(f => f.role === 'template' || f.role === 'reference').length < 2}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                {rRunning ? (
                  <><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Analysing…</>
                ) : '▶ Run Rationalisation'}
              </button>
            </div>
            {rError && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{rError}</p>}
            {rSkipped.length > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                Skipped {rSkipped.length} file(s) (unsupported format or unreadable): {rSkipped.join(', ')}
              </p>
            )}
          </div>

          {/* File lifecycle info line */}
          {(() => {
            const origCount = files.filter(f => !f.archived && f.lifecycleStatus === 'original').length;
            const rationalizedCount = files.filter(f => !f.archived && f.lifecycleStatus === 'rationalized').length;
            const finalizedCount = inventory.length;
            const variationCount = files.filter(f => !f.archived && f.lifecycleStatus === 'variation').length;
            return (origCount + rationalizedCount + finalizedCount + variationCount) > 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 px-1">
                Showing <span className="font-medium text-slate-700 dark:text-slate-300">{origCount + rationalizedCount}</span> original &amp; rationalized file{origCount + rationalizedCount !== 1 ? 's' : ''}
                {finalizedCount > 0 && <> · <span className="font-medium text-violet-600 dark:text-violet-400">{finalizedCount} finalized</span> (in Inventory)</>}
                {variationCount > 0 && <> · <span className="font-medium text-amber-600 dark:text-amber-400">{variationCount} variation{variationCount !== 1 ? 's' : ''}</span> excluded</>}
              </p>
            ) : null;
          })()}

          {/* Empty state */}
          {!rRunning && rGroups.length === 0 && (
            <div className={`${panelCls} p-8 text-center`}>
              <p className="text-sm text-slate-500 dark:text-slate-400">Upload templates and click Run Rationalisation to identify duplicates and group similar templates.</p>
            </div>
          )}

          {/* Group accordion */}
          {rGroups.length > 0 && (
            <div className="space-y-3 pb-16">
              {rGroups.map(group => {
                const expanded = rExpandedGroups.has(group.id);
                const groupFileIds = group.documents.map(d => d.fileId);
                const allSelected = groupFileIds.length > 0 && groupFileIds.every(id => rSelected.has(id));
                const someSelected = groupFileIds.some(id => rSelected.has(id));
                const FILE_TYPE_CHIP: Record<string, string> = {
                  pdf:  'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
                  docx: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
                  doc:  'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
                  xsd:  'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
                  csv:  'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
                };
                return (
                  <div key={group.id} className={panelCls}>
                    {/* Group header */}
                    <div className="flex items-center gap-3 p-4">
                      {/* Group-level checkbox */}
                      <div className="flex-shrink-0" onClick={e => {
                        e.stopPropagation();
                        setRSelected(prev => {
                          const next = new Set(prev);
                          if (allSelected) groupFileIds.forEach(id => next.delete(id));
                          else groupFileIds.forEach(id => next.add(id));
                          return next;
                        });
                      }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                          onChange={() => {}}
                          className="w-4 h-4 accent-indigo-600 cursor-pointer"
                        />
                      </div>
                      <button
                        onClick={() => setRExpandedGroups(prev => { const s = new Set(prev); s.has(group.id) ? s.delete(group.id) : s.add(group.id); return s; })}
                        className="flex-1 flex items-center gap-3 text-left"
                      >
                        <span className="text-sm font-medium text-slate-800 dark:text-white">Group {group.id + 1}</span>
                        {group.isUnique ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Unique</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                            {group.documents.length} templates · likely duplicates
                          </span>
                        )}
                        {!group.isUnique && rMode === 'semantic' && (
                          <span className="text-xs text-slate-400">{Math.round(group.similarity * 100)}% similar</span>
                        )}
                        <svg className={`w-4 h-4 text-slate-400 transition-transform ml-auto flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                        </svg>
                      </button>
                    </div>
                    {/* Group rows */}
                    {expanded && (
                      <div className="border-t border-slate-100 dark:border-slate-700">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-700">
                              <th className="w-10 px-4 py-2 text-left"></th>
                              <th className="px-4 py-2 text-left">File Name</th>
                              <th className="px-4 py-2 text-left">Type</th>
                              <th className="px-4 py-2 text-left">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {group.documents.map(doc => {
                              const inInv = inInventoryFileIds.has(doc.fileId);
                              const ext = doc.fileName.split('.').pop()?.toLowerCase() ?? doc.fileType;
                              const lc = files.find(f => f.id === doc.fileId)?.lifecycleStatus ?? 'original';
                              return (
                                <tr key={doc.fileId} className="hover:bg-slate-50 dark:hover:bg-slate-700/20">
                                  <td className="px-4 py-2.5">
                                    <input
                                      type="checkbox"
                                      checked={rSelected.has(doc.fileId)}
                                      onChange={() => setRSelected(prev => { const s = new Set(prev); s.has(doc.fileId) ? s.delete(doc.fileId) : s.add(doc.fileId); return s; })}
                                      className="w-4 h-4 accent-indigo-600 cursor-pointer"
                                    />
                                  </td>
                                  <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300 truncate max-w-xs">{doc.fileName}</td>
                                  <td className="px-4 py-2.5">
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${FILE_TYPE_CHIP[ext] ?? 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>
                                      {ext.toUpperCase()}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 flex flex-wrap gap-1">
                                    {inInv && <span className="text-xs px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">✓ In Inventory</span>}
                                    {!inInv && lc === 'rationalized' && <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">Rationalized</span>}
                                    {!inInv && lc === 'original' && <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500">Original</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Sticky bulk action bar */}
          {rSelected.size > 0 && (
            <div className="sticky bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 shadow-lg py-3 px-4 flex items-center gap-3 z-10 rounded-b-xl">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{rSelected.size} template{rSelected.size !== 1 ? 's' : ''} selected</span>
              <div className="flex-1" />
              <button onClick={handleBulkAddToInventory} className="px-4 py-1.5 text-sm font-medium rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors">
                + Add to Inventory
              </button>
              <button onClick={handleBulkMarkAsVariation} className="px-4 py-1.5 text-sm font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors">
                Mark as Variation
              </button>
              <button onClick={() => setRSelected(new Set())} className="px-4 py-1.5 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Inventory tab ── */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          {/* Add from Rationalise */}
          {rGroups.length > 0 ? (
            <div className={`${panelCls} p-5`}>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-1">Add from Rationalise Groups</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Select templates from cluster groups to add to your implementation inventory.</p>
              <div className="space-y-2">
                {rGroups.map(group => (
                  <div key={group.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                      Group {group.id + 1} — {group.documents.length} template{group.documents.length !== 1 ? 's' : ''}{!group.isUnique ? `, ${Math.round(group.similarity * 100)}% similar` : ' · unique'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {group.documents.map(doc => (
                        <div key={doc.fileId} className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-700 rounded px-2 py-1">
                          <span className="text-xs text-slate-700 dark:text-slate-300 truncate max-w-xs">{doc.fileName}</span>
                          {inInventoryFileIds.has(doc.fileId) ? (
                            <span className="text-xs text-violet-500">✓</span>
                          ) : (
                            <button
                              onClick={() => handleAddToInventory(doc.fileId, group.id, group.documents.length)}
                              disabled={addingToInventory.has(doc.fileId)}
                              className="text-xs text-violet-600 hover:text-violet-800 font-medium disabled:opacity-50"
                            >
                              {addingToInventory.has(doc.fileId) ? '...' : '+ Add'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-700 dark:text-amber-300">
              Run <button onClick={() => setActiveTab('rationalise')} className="underline font-medium">Rationalise</button> first to identify template groups, then add representative templates here.
            </div>
          )}

          {/* Inventory list */}
          <div className={`${panelCls} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white">
                Final Inventory
                {inventory.length > 0 && <span className="ml-2 text-xs text-slate-400 font-normal">{inventory.length} template{inventory.length !== 1 ? 's' : ''}</span>}
              </h3>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 inline-block"></span> Pending
                <span className="w-2 h-2 rounded-full bg-blue-400 inline-block ml-2"></span> In Progress
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block ml-2"></span> Done
              </div>
            </div>

            {inventoryLoading ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>
            ) : inventory.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-400 dark:text-slate-500">
                No templates in inventory yet. Add them from Rationalise groups above.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                      <th className="pb-2 pr-4">Template</th>
                      <th className="pb-2 pr-4">Business Domain</th>
                      <th className="pb-2 pr-4">Variants</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {inventory.map(item => (
                      <tr key={item.id}>
                        <td className="py-3 pr-4">
                          <div className="font-medium text-slate-800 dark:text-white">{item.fileName}</div>
                          {item.groupId !== null && <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Group {item.groupId + 1}</div>}
                        </td>
                        <td className="py-3 pr-4">
                          {editDomainId === item.id ? (
                            <input
                              type="text"
                              value={editDomainValue}
                              autoFocus
                              onChange={e => setEditDomainValue(e.target.value)}
                              onBlur={() => handleSaveDomain(item.id)}
                              onKeyDown={e => { if (e.key === 'Enter') handleSaveDomain(item.id); if (e.key === 'Escape') setEditDomainId(null); }}
                              className="w-full px-2 py-1 text-xs border border-indigo-400 rounded bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:outline-none"
                            />
                          ) : (
                            <button
                              onClick={() => { setEditDomainId(item.id); setEditDomainValue(item.businessDomain); }}
                              className="text-xs text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left"
                            >
                              {item.businessDomain || <span className="text-slate-300 dark:text-slate-600 italic">click to set domain</span>}
                            </button>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-xs text-slate-600 dark:text-slate-400">{item.variantCount}</td>
                        <td className="py-3 pr-4">
                          <select
                            value={item.status}
                            onChange={e => handleUpdateInventoryStatus(item.id, e.target.value as InventoryItem['status'])}
                            className={`text-xs px-2 py-1 rounded-full border-0 font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 ${STATUS_COLORS[item.status]}`}
                          >
                            {Object.entries(STATUS_LABELS).map(([val, label]) => (
                              <option key={val} value={val}>{label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3 text-right">
                          <button
                            onClick={() => handleRemoveFromInventory(item.id)}
                            className="text-xs text-red-400 hover:text-red-600 transition-colors"
                            title="Remove from inventory"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Progress summary */}
          {inventory.length > 0 && (
            <div className={`${panelCls} p-4 flex gap-6`}>
              {(['pending', 'in_progress', 'done'] as const).map(s => {
                const count = inventory.filter(i => i.status === s).length;
                return (
                  <div key={s} className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s]}`}>{STATUS_LABELS[s]}</span>
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Fields Mapping tab ── */}
      {activeTab === 'field_mapping' && (
        <div className="space-y-4">
          <div className={`${panelCls} p-5`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Dynamic Fields Mapping</h3>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Identifies all unique variable fields across finalised inventory templates and maps them to XSD paths.</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                {detectedXsd ? (
                  <span className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                    {detectedXsd.name}
                    <button onClick={() => xsdInputRef.current?.click()} className="ml-1 text-emerald-500 hover:text-emerald-700" title="Replace XSD">↺</button>
                  </span>
                ) : (
                  <button onClick={() => xsdInputRef.current?.click()} className="px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-600 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                    Upload XSD
                  </button>
                )}
                <input ref={xsdInputRef} type="file" className="hidden" accept=".xsd" onChange={e => { if (e.target.files?.length) handleUpload(e.target.files); e.target.value = ''; }} />
                <button
                  onClick={() => handleGenerateFieldMapping(fieldMappingDoc !== null)}
                  disabled={fieldMappingGenerating || !detectedXsd || inventory.length === 0}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {fieldMappingGenerating ? (
                    <span className="flex items-center gap-1.5"><svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Processing…</span>
                  ) : fieldMappingDoc ? 'Update Mapping' : 'Generate Mapping'}
                </button>
                {fieldMappingDoc && <button onClick={handleDownloadFieldMappingCsv} className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Download CSV</button>}
              </div>
            </div>
            {!detectedXsd && (
              <div className="mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                No XSD schema found in project files. Upload an .xsd file above or from the Files tab to enable mapping.
              </div>
            )}
            {inventory.length === 0 && (
              <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/30 rounded-lg px-3 py-2">
                No templates in inventory yet. Add templates to the <button onClick={() => setActiveTab('inventory')} className="underline font-medium text-indigo-600 dark:text-indigo-400">Inventory tab</button> first.
              </div>
            )}
            {fieldMappingDoc && (
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500 flex-wrap">
                <span>{(fieldMappingDoc.content as any)?.totalFields ?? 0} unique fields</span>
                <span>{((fieldMappingDoc.content as any)?.processedFileIds ?? []).length} / {inventory.length} templates processed</span>
                <span>v{fieldMappingDoc.version} · {new Date(fieldMappingDoc.updatedAt).toLocaleDateString()}</span>
              </div>
            )}
            {fieldMappingError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{fieldMappingError}</p>}
          </div>

          {fieldMappingGenerating && (
            <div className={`${panelCls} p-6 text-center`}>
              <svg className="w-6 h-6 animate-spin text-indigo-500 mx-auto mb-2" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
              <p className="text-sm text-slate-500 dark:text-slate-400">Analysing templates and mapping fields…</p>
            </div>
          )}

          {!fieldMappingGenerating && ((fieldMappingDoc?.content as any)?.fields ?? []).length > 0 && (
            <div className={`${panelCls} overflow-hidden`}>
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {((fieldMappingDoc!.content as any).fields as ConsolidatedDataMapping[]).length} fields
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500">sorted by template frequency</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                      <th className="px-4 py-2.5 font-medium">Field Name</th>
                      <th className="px-3 py-2.5 font-medium">XSD Path</th>
                      <th className="px-3 py-2.5 font-medium">Sample Value</th>
                      <th className="px-3 py-2.5 font-medium">Templates</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {((fieldMappingDoc!.content as any).fields as ConsolidatedDataMapping[]).map((f, i) => (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                        <td className="px-4 py-2.5 font-mono font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap">{f.field}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-400 dark:text-slate-500 text-xs max-w-xs break-all">{f.xsdPath || '—'}</td>
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300 font-mono">{f.sampleValue || '—'}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {(f.templates ?? []).map((t, ti) => (
                              <span key={ti} className="px-1.5 py-0.5 rounded text-xs bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 truncate max-w-[120px]" title={t}>{t}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!fieldMappingGenerating && !fieldMappingDoc && (
            <div className={`${panelCls} p-8 text-center`}>
              <svg className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125Z" /></svg>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">No field mapping yet</h3>
              <p className="text-xs text-slate-400 dark:text-slate-500">{detectedXsd && inventory.length > 0 ? 'Click "Generate Mapping" to start.' : 'Add templates to inventory and upload an XSD schema first.'}</p>
            </div>
          )}
        </div>
      )}

      {/* ── BRD tab ── */}
      {activeTab === 'brd' && (
        <div className="space-y-4">
          <div className={`${panelCls} p-5`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Business Rules</h3>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Extracts and consolidates business rules, validations, and conditional logic from all inventory templates.</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleGenerateBrd(brdDoc !== null)}
                  disabled={brdGenerating || inventory.length === 0}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {brdGenerating ? (
                    <span className="flex items-center gap-1.5"><svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Extracting…</span>
                  ) : brdDoc ? 'Update BRD' : 'Generate BRD'}
                </button>
                {brdDoc && <button onClick={handleDownloadBrdCsv} className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Download CSV</button>}
              </div>
            </div>
            {inventory.length === 0 && (
              <div className="mt-3 text-xs text-slate-500 bg-slate-50 dark:bg-slate-700/30 rounded-lg px-3 py-2">
                No templates in inventory. Add templates to the <button onClick={() => setActiveTab('inventory')} className="underline font-medium text-indigo-600">Inventory tab</button> first.
              </div>
            )}
            {brdDoc && (
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center gap-4 text-xs text-slate-400 flex-wrap">
                <span>{((brdDoc.content as any)?.rules ?? []).length} rules extracted</span>
                <span>{((brdDoc.content as any)?.processedFileIds ?? []).length} / {inventory.length} templates processed</span>
                <span>v{brdDoc.version} · {new Date(brdDoc.updatedAt).toLocaleDateString()}</span>
              </div>
            )}
            {brdError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{brdError}</p>}
          </div>

          {brdDoc && (
            <div className={`${panelCls} overflow-hidden`}>
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
                {(['All', 'Validation', 'Conditional', 'Calculation', 'Presentation'] as const).map(f => (
                  <button key={f} onClick={() => setBrdFilter(f)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${brdFilter === f ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                    {f} {f !== 'All' ? `(${((brdDoc.content as any)?.rules ?? []).filter((r: BusinessRule) => r.ruleType === f).length})` : `(${((brdDoc.content as any)?.rules ?? []).length})`}
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                      <th className="px-4 py-2.5 font-medium">Field Name</th>
                      <th className="px-3 py-2.5 font-medium">Rule Type</th>
                      <th className="px-3 py-2.5 font-medium">Condition</th>
                      <th className="px-3 py-2.5 font-medium">Action / Formula</th>
                      <th className="px-3 py-2.5 font-medium">Priority</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {(((brdDoc.content as any)?.rules ?? []) as BusinessRule[])
                      .filter(r => brdFilter === 'All' || r.ruleType === brdFilter)
                      .map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap">{r.fieldName}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${RULE_TYPE_COLORS[r.ruleType] ?? ''}`}>{r.ruleType}</span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300 max-w-xs">{r.condition || '—'}</td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300 max-w-xs">{r.actionFormula || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[r.priority] ?? PRIORITY_COLORS.Low}`}>{r.priority}</span>
                          </td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!brdGenerating && !brdDoc && (
            <div className={`${panelCls} p-8 text-center`}>
              <svg className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">No BRD yet</h3>
              <p className="text-xs text-slate-400 dark:text-slate-500">{inventory.length > 0 ? 'Click "Generate BRD" to extract business rules from inventory templates.' : 'Add templates to inventory first.'}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Test Cases tab ── */}
      {activeTab === 'test_cases' && (
        <div className="space-y-4">
          <div className={`${panelCls} p-5`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Test Cases</h3>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Generates categorised test cases (Happy Path, Mandatory, Boundary, Conditional, Format, Calculation) from the BRD business rules.</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={handleGenerateTestCases}
                  disabled={testCasesGenerating || !((brdDoc?.content as any)?.rules?.length)}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {testCasesGenerating ? (
                    <span className="flex items-center gap-1.5"><svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Generating…</span>
                  ) : testCasesDoc ? 'Regenerate Test Cases' : 'Generate Test Cases'}
                </button>
                {testCasesDoc && <button onClick={handleDownloadTestCasesCsv} className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Download CSV</button>}
              </div>
            </div>
            {!brdDoc && (
              <div className="mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                Generate BRD first — Test Cases are derived from the extracted business rules.
              </div>
            )}
            {testCasesDoc && (
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center gap-4 text-xs text-slate-400 flex-wrap">
                <span>{((testCasesDoc.content as any)?.testCases ?? []).length} test cases</span>
                <span>v{testCasesDoc.version} · {new Date(testCasesDoc.updatedAt).toLocaleDateString()}</span>
              </div>
            )}
            {testCasesError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{testCasesError}</p>}
          </div>

          {testCasesDoc && (
            <div className={`${panelCls} overflow-hidden`}>
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
                {(['All', 'Happy Path', 'Mandatory', 'Boundary', 'Conditional', 'Format', 'Calculation'] as const).map(f => {
                  const count = f === 'All' ? ((testCasesDoc.content as any)?.testCases ?? []).length : ((testCasesDoc.content as any)?.testCases ?? []).filter((tc: any) => tc.category === f).length;
                  return (
                    <button key={f} onClick={() => setTcFilter(f)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${tcFilter === f ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                      {f} ({count})
                    </button>
                  );
                })}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                      <th className="px-4 py-2.5 font-medium w-20">ID</th>
                      <th className="px-3 py-2.5 font-medium">Category</th>
                      <th className="px-3 py-2.5 font-medium">Field</th>
                      <th className="px-3 py-2.5 font-medium">Description</th>
                      <th className="px-3 py-2.5 font-medium">Input Data</th>
                      <th className="px-3 py-2.5 font-medium">Expected Result</th>
                      <th className="px-3 py-2.5 font-medium">Priority</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {(((testCasesDoc.content as any)?.testCases ?? []) as any[])
                      .filter((tc: any) => tcFilter === 'All' || tc.category === tcFilter)
                      .map((tc: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                          <td className="px-4 py-2.5 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">{tc.id}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${TC_CATEGORY_COLORS[tc.category] ?? ''}`}>{tc.category}</span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300 whitespace-nowrap">{tc.fieldSection}</td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 max-w-xs">{tc.testDescription}</td>
                          <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-400 max-w-xs">{tc.inputData}</td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 max-w-xs">{tc.expectedResult}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[tc.priority] ?? PRIORITY_COLORS.Low}`}>{tc.priority}</span>
                          </td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!testCasesGenerating && !testCasesDoc && (
            <div className={`${panelCls} p-8 text-center`}>
              <svg className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" /></svg>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">No test cases yet</h3>
              <p className="text-xs text-slate-400 dark:text-slate-500">{brdDoc ? 'Click "Generate Test Cases" to create categorised test cases from BRD rules.' : 'Generate BRD first — test cases are derived from the extracted business rules.'}</p>
            </div>
          )}
        </div>
      )}


      </div>{/* end inner content */}

      {/* ── Chat sidebar (always visible, 20% width) ── */}
      <div className={`flex flex-col flex-shrink-0 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 transition-all duration-200 ${chatCollapsed ? 'w-10' : 'w-64'}`}>
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          {!chatCollapsed && (
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Project Chat</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {messages.length > 0 && !chatCollapsed && (
              <button
                onClick={handleClearChat}
                className="p-1 text-slate-400 hover:text-red-500 dark:hover:text-red-400 rounded transition-colors"
                title="Clear chat history"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            )}
            <button
              onClick={() => setChatCollapsed(prev => !prev)}
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors"
              title={chatCollapsed ? 'Expand chat' : 'Collapse chat'}
            >
              <svg className={`w-4 h-4 transition-transform ${chatCollapsed ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </button>
          </div>
        </div>

        {chatCollapsed ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-xs text-slate-400 dark:text-slate-500 select-none" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
              💬 Chat
            </span>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 pb-10">
              {messages.length === 0 && (
                <div className="text-center text-xs text-slate-400 dark:text-slate-500 py-8 leading-relaxed">
                  Ask anything about this project — files, rationalise results, or implementation details.
                </div>
              )}
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[90%] px-3 py-2 rounded-xl text-xs whitespace-pre-wrap leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-bl-sm'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="px-3 py-2 rounded-xl rounded-bl-sm bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-xs">
                    Thinking...
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <textarea
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                placeholder="Ask about this project..."
                rows={2}
                className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={handleSendChat}
                disabled={!chatInput.trim() || chatLoading}
                className="w-full px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                {chatLoading ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
      </div>{/* end row split */}

      {/* ── Share / Access modal ─────────────────────────────────────────────── */}
      {showSharePanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowSharePanel(false)} />
          <div className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h2 className="text-base font-semibold text-slate-800 dark:text-white">Project Access</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Share with users from any team</p>
              </div>
              <button onClick={() => setShowSharePanel(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
              </button>
            </div>

            {/* Invite input — only shown to project owner */}
            {project.createdBy === user?.id && (
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700/50">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Invite by username</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inviteUsername}
                    onChange={e => { setInviteUsername(e.target.value); setInviteError(''); }}
                    onKeyDown={e => e.key === 'Enter' && handleInvite()}
                    placeholder="Enter username…"
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <button
                    onClick={handleInvite}
                    disabled={inviteLoading || !inviteUsername.trim()}
                    className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {inviteLoading ? '…' : 'Invite'}
                  </button>
                </div>
                {inviteError && <p className="text-xs text-red-500 mt-1.5">{inviteError}</p>}
              </div>
            )}

            {/* Member list */}
            <div className="px-6 py-4 max-h-80 overflow-y-auto">
              {membersLoading ? (
                <p className="text-xs text-slate-400 text-center py-4">Loading members…</p>
              ) : members.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">No members yet.</p>
              ) : (
                <div className="space-y-2">
                  {members.map(m => (
                    <div key={m.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-50 dark:bg-slate-700/40">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-xs font-semibold text-indigo-600 dark:text-indigo-300 flex-shrink-0">
                          {m.username[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 dark:text-white truncate">{m.username}</p>
                          <p className="text-xs text-slate-400 truncate">{m.company_name || 'No company'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          m.access_type === 'owner'   ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' :
                          m.access_type === 'company' ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400' :
                          'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                        }`}>
                          {m.access_type === 'owner' ? 'Owner' : m.access_type === 'company' ? 'Team' : 'Invited'}
                        </span>
                        {project.createdBy === user?.id && m.access_type === 'invited' && m.id !== user?.id && (
                          <button onClick={() => handleRemoveMember(m.id)} className="text-xs text-red-400 hover:text-red-600 transition-colors ml-1">Remove</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-700">
              <p className="text-xs text-slate-400">Team members always have access. Invited users can view and edit this project.</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ProjectWorkspace;
