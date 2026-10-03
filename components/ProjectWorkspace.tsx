import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { Project, ProjectFile, ProjectMessage, InventoryItem, ProjectDocument } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RGroup {
  id: number;
  similarity: number;
  isUnique: boolean;
  documents: { fileId: number; fileName: string; fileType: string }[];
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

function mapDocument(r: any): ProjectDocument {
  return {
    id: r.id,
    projectId: r.project_id ?? r.projectId,
    docType: r.doc_type ?? r.docType,
    content: r.content ?? {},
    version: r.version ?? 1,
    createdAt: r.created_at ?? r.createdAt ?? '',
    updatedAt: r.updated_at ?? r.updatedAt ?? '',
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  template: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
  reference: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
  xsd: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  csv: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  archived: 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
};

const TC_CATEGORY_COLORS: Record<string, string> = {
  'Happy Path':  'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  'Mandatory':   'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  'Boundary':    'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  'Conditional': 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  'Format':      'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  'Calculation': 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
};

const STATUS_LABELS: Record<string, string> = { pending: 'Pending', in_progress: 'In Progress', done: 'Done' };
const STATUS_COLORS: Record<string, string> = {
  pending:     'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
  in_progress: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  done:        'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
};

// ── CollapseSection ───────────────────────────────────────────────────────────

const CollapseSection: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-800 dark:text-white bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-left"
      >
        {title}
        <svg className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && <div className="p-4 text-sm text-slate-700 dark:text-slate-300">{children}</div>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface ProjectWorkspaceProps {
  projectId: number;
  onBack: () => void;
}

type Tab = 'files' | 'rationalise' | 'inventory' | 'field_mapping' | 'brd' | 'test_cases';

const FIELD_TYPE_COLORS: Record<string, string> = {
  text:     'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
  date:     'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  currency: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  number:   'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  boolean:  'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  address:  'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  list:     'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
};

const RULE_TYPE_COLORS: Record<string, string> = {
  Validation:   'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  Conditional:  'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  Calculation:  'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  Presentation: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
};

const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = ({ projectId, onBack }) => {
  const { token } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [messages, setMessages] = useState<ProjectMessage[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('files');
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

  // BRD
  const [brdDoc, setBrdDoc] = useState<ProjectDocument | null>(null);
  const [brdLoading, setBrdLoading] = useState(false);
  const [brdGenerating, setBrdGenerating] = useState(false);
  const [brdError, setBrdError] = useState('');

  // Test Cases
  const [testCasesDoc, setTestCasesDoc] = useState<ProjectDocument | null>(null);
  const [testCasesLoading, setTestCasesLoading] = useState(false);
  const [testCasesGenerating, setTestCasesGenerating] = useState(false);
  const [testCasesError, setTestCasesError] = useState('');

  // Field Mapping
  const [fieldMappingDoc, setFieldMappingDoc] = useState<ProjectDocument | null>(null);
  const [fieldMappingLoading, setFieldMappingLoading] = useState(false);
  const [fieldMappingGenerating, setFieldMappingGenerating] = useState(false);
  const [fieldMappingError, setFieldMappingError] = useState('');

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

  const fetchBrdDoc = useCallback(async () => {
    if (!token) return;
    setBrdLoading(true);
    try {
      const res = await fetch(`/v1/projects/${projectId}/documents/brd`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setBrdDoc(mapDocument(data.document ?? data));
      } else if (res.status === 404) {
        setBrdDoc(null);
      }
    } catch { /* ignore */ }
    setBrdLoading(false);
  }, [token, projectId]);

  const fetchTestCasesDoc = useCallback(async () => {
    if (!token) return;
    setTestCasesLoading(true);
    try {
      const res = await fetch(`/v1/projects/${projectId}/documents/test_cases`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setTestCasesDoc(mapDocument(data.document ?? data));
      } else if (res.status === 404) {
        setTestCasesDoc(null);
      }
    } catch { /* ignore */ }
    setTestCasesLoading(false);
  }, [token, projectId]);

  const fetchFieldMappingDoc = useCallback(async () => {
    if (!token) return;
    setFieldMappingLoading(true);
    try {
      const res = await fetch(`/v1/projects/${projectId}/documents/field_mapping`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setFieldMappingDoc(mapDocument(data.document ?? data));
      } else if (res.status === 404) {
        setFieldMappingDoc(null);
      }
    } catch { /* ignore */ }
    setFieldMappingLoading(false);
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
  }, [fetchProject, fetchInventory, fetchChat]);

  useEffect(() => {
    if (activeTab === 'inventory') fetchInventory();
    if (activeTab === 'field_mapping') fetchFieldMappingDoc();
    if (activeTab === 'brd') fetchBrdDoc();
    if (activeTab === 'test_cases') fetchTestCasesDoc();
  }, [activeTab, fetchInventory, fetchFieldMappingDoc, fetchBrdDoc, fetchTestCasesDoc]);

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

  // ── BRD handlers ─────────────────────────────────────────────────────────────

  const handleGenerateBrd = async () => {
    if (!token) return;
    setBrdGenerating(true); setBrdError('');
    try {
      const res = await fetch(`/v1/projects/${projectId}/documents/brd/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBrdDoc(mapDocument(data.document ?? data));
      } else {
        const err = await res.json().catch(() => ({}));
        setBrdError(err.error ?? 'BRD generation failed');
      }
    } catch (e: any) {
      setBrdError(e.message ?? 'BRD generation failed');
    }
    setBrdGenerating(false);
  };

  const handleDownloadBrdText = () => {
    if (!brdDoc?.content) return;
    const c = brdDoc.content;
    const s = c.sections ?? {};
    let text = `# ${c.title ?? 'Business Requirements Document'}\nVersion: ${brdDoc.version} | Updated: ${new Date(brdDoc.updatedAt).toLocaleDateString()}\n\n`;
    if (s.executiveSummary) text += `## Executive Summary\n${s.executiveSummary}\n\n`;
    if (s.templatesOverview?.length) {
      text += `## Templates Overview\n`;
      for (const t of s.templatesOverview) text += `- ${t.name} (${t.domain ?? ''}, ${t.variants ?? 1} variants)\n`;
      text += '\n';
    }
    if (s.requirements?.length) {
      text += `## Requirements\n`;
      for (const r of s.requirements) {
        text += `### ${r.templateName}\nPurpose: ${r.purpose ?? ''}\nKey Fields: ${r.keyFields ?? ''}\nConditional Logic: ${r.conditionalLogic ?? ''}\nBusiness Rules: ${r.businessRules ?? ''}\nNotes: ${r.notes ?? ''}\n\n`;
      }
    }
    if (s.commonRequirements) text += `## Common Requirements\n${s.commonRequirements}\n\n`;
    if (s.implementationNotes) text += `## Implementation Notes\n${s.implementationNotes}\n\n`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'BRD.txt'; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Test Cases handlers ──────────────────────────────────────────────────────

  const handleGenerateTestCases = async () => {
    if (!token) return;
    setTestCasesGenerating(true); setTestCasesError('');
    try {
      const res = await fetch(`/v1/projects/${projectId}/documents/test-cases/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTestCasesDoc(mapDocument(data.document ?? data));
      } else {
        const err = await res.json().catch(() => ({}));
        setTestCasesError(err.error ?? 'Test case generation failed');
      }
    } catch (e: any) {
      setTestCasesError(e.message ?? 'Test case generation failed');
    }
    setTestCasesGenerating(false);
  };

  const handleDownloadTestCasesCsv = () => {
    if (!testCasesDoc?.content?.templates) return;
    const headers = ['Template', 'Test Case ID', 'Category', 'Description', 'Input Data', 'Expected Result', 'Priority', 'Preconditions'];
    const rows: string[][] = [];
    for (const tmpl of testCasesDoc.content.templates) {
      for (const tc of (tmpl.testCases ?? [])) {
        rows.push([tmpl.templateName ?? '', tc.id ?? '', tc.category ?? '', tc.description ?? '', tc.inputData ?? '', tc.expectedResult ?? '', tc.priority ?? '', tc.preconditions ?? '']);
      }
    }
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'test-cases.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Field Mapping handlers ───────────────────────────────────────────────────

  const handleGenerateFieldMapping = async () => {
    if (!token) return;
    setFieldMappingGenerating(true); setFieldMappingError('');
    try {
      const res = await fetch(`/v1/projects/${projectId}/documents/field-mapping/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFieldMappingDoc(mapDocument(data.document ?? data));
      } else {
        const err = await res.json().catch(() => ({}));
        setFieldMappingError((err as any).error ?? 'Field mapping generation failed');
      }
    } catch (e: any) {
      setFieldMappingError(e.message ?? 'Field mapping generation failed');
    }
    setFieldMappingGenerating(false);
  };

  const handleDownloadFieldMappingCsv = () => {
    if (!fieldMappingDoc?.content?.fields) return;
    const headers = ['Field Name', 'Display Name', 'Data Type', 'Templates', 'Sample Value', 'Is Conditional', 'Conditional Logic', 'XSD Path'];
    const rows = (fieldMappingDoc.content.fields as any[]).map(f => [
      f.fieldName ?? '', f.displayName ?? '', f.dataType ?? '',
      (f.templates ?? []).join('; '), f.sampleValue ?? '',
      f.isConditional ? 'Yes' : 'No', f.conditionalLogic ?? '', f.xsdPath ?? '',
    ]);
    const csv = [headers, ...rows].map(r => r.map((c: string) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'field-mapping.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Chat handler ─────────────────────────────────────────────────────────────

  const handleSendChat = async () => {
    if (!chatInput.trim() || !token || chatLoading) return;
    const msg = chatInput.trim();
    const msgLower = msg.toLowerCase();
    setChatInput('');
    setChatLoading(true);
    setMessages(prev => [...prev, { id: Date.now(), projectId, userId: 0, role: 'user', content: msg, createdAt: new Date().toISOString() }]);

    // Intent detection: intercept generate commands before sending to LLM
    const hasGenerateVerb = /\b(generate|create|run|start|initiate|make|do|perform|build|extract|analyse|analyze|produce)\b/.test(msgLower);
    // Field mapping: any mention of these phrases is itself a command (map/data/dynamic fields)
    const isFieldMapping = /\b(field.?mapping|fields?.?map|map.?fields?|data.?mapping|dynamic.?fields?|field.?extract)\b/.test(msgLower);
    // BRD and test cases require an explicit action verb to avoid false positives from questions
    const isBrd = hasGenerateVerb && /\b(brd|business.?req|business.?rules?)\b/.test(msgLower);
    const isTestCases = hasGenerateVerb && /\b(test.?cases?|test.?tracker|test.?suite)\b/.test(msgLower);

    if (isFieldMapping) {
      setMessages(prev => [...prev, { id: Date.now() + 1, projectId, userId: 0, role: 'assistant', content: "I'll generate the Fields Mapping now...", createdAt: new Date().toISOString() }]);
      setActiveTab('field_mapping');
      await handleGenerateFieldMapping();
      setMessages(prev => [...prev, { id: Date.now() + 2, projectId, userId: 0, role: 'assistant', content: '✅ Fields Mapping generated! Switch to the Fields Mapping tab to view results.', createdAt: new Date().toISOString() }]);
      setChatLoading(false);
      return;
    }
    if (isBrd) {
      setMessages(prev => [...prev, { id: Date.now() + 1, projectId, userId: 0, role: 'assistant', content: "I'll generate the Business Requirements Document now...", createdAt: new Date().toISOString() }]);
      setActiveTab('brd');
      await handleGenerateBrd();
      setMessages(prev => [...prev, { id: Date.now() + 2, projectId, userId: 0, role: 'assistant', content: '✅ BRD generated! Switch to the BRD tab to view results.', createdAt: new Date().toISOString() }]);
      setChatLoading(false);
      return;
    }
    if (isTestCases) {
      setMessages(prev => [...prev, { id: Date.now() + 1, projectId, userId: 0, role: 'assistant', content: "I'll generate Test Cases now...", createdAt: new Date().toISOString() }]);
      setActiveTab('test_cases');
      await handleGenerateTestCases();
      setMessages(prev => [...prev, { id: Date.now() + 2, projectId, userId: 0, role: 'assistant', content: '✅ Test Cases generated! Switch to the Test Cases tab to view results.', createdAt: new Date().toISOString() }]);
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

  if (loading) {
    return <div className="max-w-6xl mx-auto py-8 text-sm text-slate-500 dark:text-slate-400">Loading project...</div>;
  }
  if (!project) {
    return <div className="max-w-6xl mx-auto py-8 text-sm text-red-500">Project not found.</div>;
  }

  const tabs: { id: Tab; label: string; icon: string; badge?: number }[] = [
    { id: 'files',         label: 'Files',          icon: '📁', badge: activeFiles.length || undefined },
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
      <div className="flex-1 min-w-0 overflow-y-auto pb-10 space-y-4 pr-1 pt-4">

      {/* ── Files tab ── */}
      {activeTab === 'files' && (
        <div className="space-y-4">
          <div className={`${panelCls} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Project Files</h3>
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
            {activeFiles.length === 0 ? (
              <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400 transition-colors" onClick={() => fileInputRef.current?.click()}>
                <svg className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <p className="text-sm text-slate-500 dark:text-slate-400">No files yet. Click to upload templates, XSD schemas, or CSVs.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {activeFiles.map(f => (
                  <div key={f.id} className={`flex items-center justify-between py-3 gap-3 ${f.lifecycleStatus === 'variation' ? 'bg-amber-50 dark:bg-amber-900/10 -mx-1 px-1 rounded' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-800 dark:text-white truncate">{f.name}</span>
                        <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full ${ROLE_COLORS[f.role] ?? ROLE_COLORS.template}`}>{f.role}</span>
                        {f.lifecycleStatus === 'rationalized' && (
                          <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">Rationalized</span>
                        )}
                        {f.lifecycleStatus === 'variation' && (
                          <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Variation</span>
                        )}
                        {inInventoryFileIds.has(f.id) && (
                          <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">in inventory</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{formatBytes(f.sizeBytes)} · {new Date(f.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {f.signedUrl && (
                        <a href={f.signedUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300">Download</a>
                      )}
                      <button onClick={() => handleArchiveFile(f.id, true)} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">Archive</button>
                      <button onClick={() => handleDeleteFile(f.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {archivedFiles.length > 0 && (
            <details className={panelCls}>
              <summary className="p-5 text-sm font-medium text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                Archived Files ({archivedFiles.length})
              </summary>
              <div className="px-5 pb-4 divide-y divide-slate-100 dark:divide-slate-700">
                {archivedFiles.map(f => (
                  <div key={f.id} className="flex items-center justify-between py-3 gap-3">
                    <span className="text-sm text-slate-500 dark:text-slate-400 truncate line-through flex-1">{f.name}</span>
                    <button onClick={() => handleArchiveFile(f.id, false)} className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300">Restore</button>
                    <button onClick={() => handleDeleteFile(f.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                  </div>
                ))}
              </div>
            </details>
          )}
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
          {fieldMappingLoading ? (
            <div className="text-sm text-slate-400 dark:text-slate-500 py-4">Loading field mapping...</div>
          ) : fieldMappingDoc ? (
            <>
              <div className={`${panelCls} p-5`}>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Dynamic Fields Mapping</h3>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      v{fieldMappingDoc.version} · Updated {new Date(fieldMappingDoc.updatedAt).toLocaleDateString()}
                      {fieldMappingDoc.content?.totalFields ? ` · ${fieldMappingDoc.content.totalFields} fields` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleGenerateFieldMapping}
                      disabled={fieldMappingGenerating || inventory.length === 0}
                      className="px-3 py-1.5 text-sm text-indigo-600 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50 transition-colors"
                    >
                      {fieldMappingGenerating ? 'Updating...' : 'Update Mapping'}
                    </button>
                    <button
                      onClick={handleDownloadFieldMappingCsv}
                      className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      Download CSV
                    </button>
                  </div>
                </div>
                {fieldMappingDoc.content?.summary && (
                  <p className="mt-3 text-xs text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-700 pt-3">
                    {fieldMappingDoc.content.summary}
                  </p>
                )}
              </div>

              {fieldMappingError && <p className="text-sm text-red-600">{fieldMappingError}</p>}

              {(fieldMappingDoc.content?.fields ?? []).length > 0 && (
                <div className={`${panelCls} overflow-hidden`}>
                  <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {(fieldMappingDoc.content.fields as any[]).length} fields mapped
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {(fieldMappingDoc.content.fields as any[]).filter((f: any) => f.isConditional).length} conditional
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-700">
                    {(fieldMappingDoc.content.fields as any[]).map((f: any, i: number) => (
                      <div key={i} className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">{f.fieldName}</span>
                              {f.displayName && f.displayName !== f.fieldName && (
                                <span className="text-xs text-slate-400 dark:text-slate-500">({f.displayName})</span>
                              )}
                              <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${FIELD_TYPE_COLORS[f.dataType] ?? FIELD_TYPE_COLORS.text}`}>
                                {f.dataType}
                              </span>
                              {f.isConditional && (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
                                  ⚡ conditional
                                </span>
                              )}
                            </div>
                            {f.sampleValue && (
                              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                <span className="text-slate-400 dark:text-slate-500">Sample: </span>
                                <span className="font-mono text-slate-600 dark:text-slate-300">{f.sampleValue}</span>
                              </div>
                            )}
                            {f.isConditional && f.conditionalLogic && (
                              <div className="mt-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1">
                                {f.conditionalLogic}
                              </div>
                            )}
                            {f.xsdPath && f.xsdPath !== 'path not found' && (
                              <div className="mt-1 font-mono text-xs text-slate-400 dark:text-slate-500 break-all">{f.xsdPath}</div>
                            )}
                          </div>
                          {(f.templates ?? []).length > 0 && (
                            <div className="shrink-0 flex flex-wrap gap-1 max-w-[200px] justify-end">
                              {(f.templates as string[]).map((t, ti) => (
                                <span key={ti} className="px-1.5 py-0.5 rounded text-xs bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 truncate max-w-[120px]" title={t}>{t}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className={`${panelCls} p-8 text-center`}>
              <svg className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125Z" />
              </svg>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">No Fields Mapping yet</h3>
              {inventory.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
                  Add templates to the <button onClick={() => setActiveTab('inventory')} className="underline font-medium">Final Inventory</button> first.
                </p>
              ) : (
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
                  Extract all unique dynamic fields from your {inventory.length} template{inventory.length !== 1 ? 's' : ''} using the Data Mapping accelerator.
                </p>
              )}
              {fieldMappingError && <p className="text-xs text-red-600 mb-3">{fieldMappingError}</p>}
              <button
                onClick={handleGenerateFieldMapping}
                disabled={fieldMappingGenerating || inventory.length === 0}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                {fieldMappingGenerating ? 'Generating… (this may take up to a minute)' : 'Generate Fields Mapping'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── BRD tab ── */}
      {activeTab === 'brd' && (
        <div className="space-y-4">
          {brdLoading ? (
            <div className="text-sm text-slate-400 dark:text-slate-500 py-4">Loading BRD...</div>
          ) : brdDoc ? (
            <>
              <div className={`${panelCls} p-5`}>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Business Requirements Document</h3>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      v{brdDoc.version} · Updated {new Date(brdDoc.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleGenerateBrd}
                      disabled={brdGenerating || inventory.length === 0}
                      className="px-3 py-1.5 text-sm text-indigo-600 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50 transition-colors"
                    >
                      {brdGenerating ? 'Updating...' : 'Update BRD'}
                    </button>
                    <button
                      onClick={handleDownloadBrdText}
                      className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      Download
                    </button>
                  </div>
                </div>
              </div>

              {brdError && <p className="text-sm text-red-600">{brdError}</p>}

              <div className="space-y-1">
                {brdDoc.content?.sections?.executiveSummary && (
                  <CollapseSection title="Executive Summary">
                    <p className="whitespace-pre-wrap leading-relaxed">{brdDoc.content.sections.executiveSummary}</p>
                  </CollapseSection>
                )}

                {brdDoc.content?.sections?.scope && (
                  <CollapseSection title="Scope" defaultOpen={false}>
                    <p className="whitespace-pre-wrap leading-relaxed">{brdDoc.content.sections.scope}</p>
                  </CollapseSection>
                )}

                {brdDoc.content?.sections?.templatesOverview?.length > 0 && (
                  <CollapseSection title="Templates Overview">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                          <th className="pb-1 pr-4">Template</th>
                          <th className="pb-1 pr-4">Domain</th>
                          <th className="pb-1 pr-4">Variants</th>
                          <th className="pb-1">Purpose</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {brdDoc.content.sections.templatesOverview.map((t: any, i: number) => (
                          <tr key={i}>
                            <td className="py-1.5 pr-4 font-medium text-slate-800 dark:text-white">{t.name}</td>
                            <td className="py-1.5 pr-4 text-slate-600 dark:text-slate-300">{t.domain ?? '—'}</td>
                            <td className="py-1.5 pr-4 text-slate-600 dark:text-slate-300">{t.variants ?? 1}</td>
                            <td className="py-1.5 text-slate-500 dark:text-slate-400">{t.purpose ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CollapseSection>
                )}

                {/* New businessRules schema (v2 BRDs) */}
                {brdDoc.content?.sections?.businessRules?.length > 0 && (
                  <CollapseSection title="Business Rules">
                    <div className="space-y-4">
                      {brdDoc.content.sections.businessRules.map((tmpl: any, ti: number) => (
                        <div key={ti}>
                          <p className="font-semibold text-slate-800 dark:text-white mb-2 pb-1 border-b border-slate-200 dark:border-slate-700">{tmpl.templateName}</p>
                          {(tmpl.rules ?? []).length > 0 && (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-700">
                                    <th className="pb-1 pr-3">Rule</th>
                                    <th className="pb-1 pr-3">Type</th>
                                    <th className="pb-1 pr-3">Condition</th>
                                    <th className="pb-1 pr-3">Action</th>
                                    <th className="pb-1">Priority</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
                                  {tmpl.rules.map((r: any, ri: number) => (
                                    <tr key={ri}>
                                      <td className="py-1.5 pr-3 font-medium text-slate-700 dark:text-slate-300">{r.ruleName}</td>
                                      <td className="py-1.5 pr-3 whitespace-nowrap">
                                        <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${RULE_TYPE_COLORS[r.ruleType] ?? 'bg-slate-100 text-slate-600'}`}>{r.ruleType}</span>
                                      </td>
                                      <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{r.condition}</td>
                                      <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{r.action}</td>
                                      <td className="py-1.5">
                                        <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${r.priority === 'High' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : r.priority === 'Medium' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>{r.priority}</span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CollapseSection>
                )}

                {/* Legacy requirements schema (v1 BRDs) */}
                {!brdDoc.content?.sections?.businessRules?.length && brdDoc.content?.sections?.requirements?.length > 0 && (
                  <CollapseSection title="Requirements per Template">
                    <div className="space-y-4">
                      {brdDoc.content.sections.requirements.map((r: any, i: number) => (
                        <div key={i} className="border-l-2 border-indigo-300 dark:border-indigo-600 pl-3">
                          <p className="font-semibold text-slate-800 dark:text-white mb-1">{r.templateName}</p>
                          {r.purpose && <p className="text-xs mb-1"><span className="font-medium">Purpose:</span> {r.purpose}</p>}
                          {r.keyFields && <p className="text-xs mb-1"><span className="font-medium">Key Fields:</span> {r.keyFields}</p>}
                          {r.conditionalLogic && <p className="text-xs mb-1"><span className="font-medium">Conditional Logic:</span> {r.conditionalLogic}</p>}
                          {r.businessRules && <p className="text-xs mb-1"><span className="font-medium">Business Rules:</span> {r.businessRules}</p>}
                          {r.notes && <p className="text-xs text-slate-500 dark:text-slate-400">{r.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </CollapseSection>
                )}

                {brdDoc.content?.sections?.commonRequirements && (
                  <CollapseSection title="Common Requirements">
                    <p className="whitespace-pre-wrap leading-relaxed">{brdDoc.content.sections.commonRequirements}</p>
                  </CollapseSection>
                )}

                {brdDoc.content?.sections?.implementationNotes && (
                  <CollapseSection title="Implementation Notes">
                    <p className="whitespace-pre-wrap leading-relaxed">{brdDoc.content.sections.implementationNotes}</p>
                  </CollapseSection>
                )}

                {brdDoc.content?.sections?.assumptions && (
                  <CollapseSection title="Assumptions" defaultOpen={false}>
                    <p className="whitespace-pre-wrap leading-relaxed">{brdDoc.content.sections.assumptions}</p>
                  </CollapseSection>
                )}
              </div>
            </>
          ) : (
            <div className={`${panelCls} p-8 text-center`}>
              <svg className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">No Business Requirements Document yet</h3>
              {inventory.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
                  Add templates to the <button onClick={() => setActiveTab('inventory')} className="underline font-medium">Final Inventory</button> first.
                </p>
              ) : (
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">Generate a structured BRD from your {inventory.length} inventory template{inventory.length !== 1 ? 's' : ''}.</p>
              )}
              {brdError && <p className="text-xs text-red-600 mb-3">{brdError}</p>}
              <button
                onClick={handleGenerateBrd}
                disabled={brdGenerating || inventory.length === 0}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                {brdGenerating ? 'Generating BRD… (this may take up to a minute)' : 'Generate BRD from Inventory'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Test Cases tab ── */}
      {activeTab === 'test_cases' && (
        <div className="space-y-4">
          {testCasesLoading ? (
            <div className="text-sm text-slate-400 dark:text-slate-500 py-4">Loading test cases...</div>
          ) : testCasesDoc ? (
            <>
              <div className={`${panelCls} p-5`}>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Test Case Tracker</h3>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      v{testCasesDoc.version} · Updated {new Date(testCasesDoc.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleGenerateTestCases}
                      disabled={testCasesGenerating || inventory.length === 0}
                      className="px-3 py-1.5 text-sm text-indigo-600 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50 transition-colors"
                    >
                      {testCasesGenerating ? 'Updating...' : 'Update Test Cases'}
                    </button>
                    <button
                      onClick={handleDownloadTestCasesCsv}
                      className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      Download CSV
                    </button>
                  </div>
                </div>
              </div>

              {testCasesError && <p className="text-sm text-red-600">{testCasesError}</p>}

              <div className="space-y-1">
                {(testCasesDoc.content?.templates ?? []).map((tmpl: any, ti: number) => (
                  <CollapseSection key={ti} title={tmpl.templateName ?? `Template ${ti + 1}`}>
                    {(tmpl.testCases ?? []).length === 0 ? (
                      <p className="text-xs text-slate-400">No test cases.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                              <th className="pb-1 pr-3">ID</th>
                              <th className="pb-1 pr-3">Category</th>
                              <th className="pb-1 pr-3">Description</th>
                              <th className="pb-1 pr-3">Input</th>
                              <th className="pb-1 pr-3">Expected</th>
                              <th className="pb-1">Priority</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {(tmpl.testCases ?? []).map((tc: any, i: number) => (
                              <tr key={i}>
                                <td className="py-1.5 pr-3 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">{tc.id ?? `TC-${i + 1}`}</td>
                                <td className="py-1.5 pr-3 whitespace-nowrap">
                                  <span className={`px-1.5 py-0.5 rounded-full font-medium text-xs ${TC_CATEGORY_COLORS[tc.category] ?? 'bg-slate-100 text-slate-600'}`}>
                                    {tc.category}
                                  </span>
                                </td>
                                <td className="py-1.5 pr-3 text-slate-700 dark:text-slate-300 max-w-xs">{tc.description}</td>
                                <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400 max-w-xs">{tc.inputData}</td>
                                <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400 max-w-xs">{tc.expectedResult}</td>
                                <td className="py-1.5">
                                  <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${tc.priority === 'High' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : tc.priority === 'Medium' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'}`}>
                                    {tc.priority}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CollapseSection>
                ))}
              </div>
            </>
          ) : (
            <div className={`${panelCls} p-8 text-center`}>
              <svg className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">No Test Case Tracker yet</h3>
              {inventory.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
                  Add templates to the <button onClick={() => setActiveTab('inventory')} className="underline font-medium">Final Inventory</button> first.
                </p>
              ) : (
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
                  Generate categorised test cases (Happy Path, Mandatory, Boundary, Conditional, Format) from your {inventory.length} inventory template{inventory.length !== 1 ? 's' : ''}.
                </p>
              )}
              {testCasesError && <p className="text-xs text-red-600 mb-3">{testCasesError}</p>}
              <button
                onClick={handleGenerateTestCases}
                disabled={testCasesGenerating || inventory.length === 0}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                {testCasesGenerating ? 'Generating… (this may take up to a minute)' : 'Generate Test Cases from Inventory'}
              </button>
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
          <button
            onClick={() => setChatCollapsed(prev => !prev)}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors ml-auto"
            title={chatCollapsed ? 'Expand chat' : 'Collapse chat'}
          >
            <svg className={`w-4 h-4 transition-transform ${chatCollapsed ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </button>
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
    </div>
  );
};

export default ProjectWorkspace;
