import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { Project, ProjectFile, ProjectMessage, InventoryItem, ProjectDocument } from '../types';

// ── Inline cluster math ────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function wordHashEmbed(text: string): number[] {
  const vec = new Float32Array(768);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  for (const w of words) {
    let h = 5381;
    for (let i = 0; i < w.length; i++) h = ((h * 33) ^ w.charCodeAt(i)) >>> 0;
    for (let k = 0; k < 4; k++) { const idx = (h + k * 7919) % 768; vec[idx] += 1; }
  }
  let norm = 0;
  for (let i = 0; i < 768; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec).map(v => v / norm);
}

interface DocCluster { id: number; files: ProjectFile[]; similarity: number }

function clusterFiles(files: ProjectFile[], texts: string[], threshold: number): DocCluster[] {
  const embeddings = texts.map(t => wordHashEmbed(t));
  const n = files.length;
  const assigned = new Array(n).fill(-1);
  const clusters: DocCluster[] = [];
  for (let i = 0; i < n; i++) {
    if (assigned[i] !== -1) continue;
    const cluster: DocCluster = { id: clusters.length, files: [files[i]], similarity: 100 };
    assigned[i] = cluster.id;
    for (let j = i + 1; j < n; j++) {
      if (assigned[j] !== -1) continue;
      const sim = cosineSimilarity(embeddings[i], embeddings[j]) * 100;
      if (sim >= threshold) { cluster.files.push(files[j]); assigned[j] = cluster.id; cluster.similarity = Math.min(cluster.similarity, sim); }
    }
    clusters.push(cluster);
  }
  return clusters;
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

type Tab = 'files' | 'rationalise' | 'inventory' | 'brd' | 'test_cases' | 'chat';

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
  const [threshold, setThreshold] = useState(75);
  const [clusters, setClusters] = useState<DocCluster[]>([]);
  const [rationalising, setRationalising] = useState(false);
  const [rationaliseError, setRationaliseError] = useState('');
  const [savedResult, setSavedResult] = useState(false);

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

  // Chat
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
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

  const fetchInventory = useCallback(async () => {
    if (!token) return;
    setInventoryLoading(true);
    try {
      const res = await fetch(`/v1/projects/${projectId}/inventory`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setInventory((data.items ?? data ?? []).map(mapInventoryItem));
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
  }, [fetchProject, fetchInventory]);

  useEffect(() => {
    if (activeTab === 'inventory') fetchInventory();
    if (activeTab === 'brd') fetchBrdDoc();
    if (activeTab === 'test_cases') fetchTestCasesDoc();
    if (activeTab === 'chat') fetchChat();
  }, [activeTab, fetchInventory, fetchBrdDoc, fetchTestCasesDoc, fetchChat]);

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

  // ── Rationalise handler ──────────────────────────────────────────────────────

  const handleRationalise = async () => {
    const templates = files.filter(f => !f.archived && (f.role === 'template' || f.role === 'reference'));
    if (templates.length < 2) { setRationaliseError('Upload at least 2 template files to rationalise.'); return; }
    setRationalising(true); setRationaliseError(''); setSavedResult(false); setClusters([]);
    try {
      const texts = await Promise.all(templates.map(async (f) => {
        if (!f.signedUrl) return f.name;
        try { return await (await fetch(f.signedUrl)).text(); } catch { return f.name; }
      }));
      const result = clusterFiles(templates, texts, threshold);
      setClusters(result);
      if (token) {
        await fetch(`/v1/projects/${projectId}/results`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            accelerator: 'rationalise',
            result_data: { threshold, clusters: result.map(c => ({ id: c.id, files: c.files.map(f => ({ id: f.id, name: f.name })), similarity: c.similarity })) },
          }),
        });
        setSavedResult(true);
      }
    } catch (e: any) {
      setRationaliseError(e.message ?? 'Rationalise failed');
    }
    setRationalising(false);
  };

  // ── Inventory handlers ───────────────────────────────────────────────────────

  const handleAddToInventory = async (file: ProjectFile, cluster: DocCluster) => {
    if (!token) return;
    setAddingToInventory(prev => new Set(prev).add(file.id));
    try {
      const res = await fetch(`/v1/projects/${projectId}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fileId: file.id, groupId: cluster.id, variantCount: cluster.files.length, variations: [] }),
      });
      if (res.ok) await fetchInventory();
      // 409 = already in inventory, silently ignore
    } catch { /* ignore */ }
    setAddingToInventory(prev => { const s = new Set(prev); s.delete(file.id); return s; });
  };

  const handleRemoveFromInventory = async (itemId: number) => {
    if (!token) return;
    await fetch(`/v1/projects/${projectId}/inventory/${itemId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setInventory(prev => prev.filter(i => i.id !== itemId));
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

  // ── Chat handler ─────────────────────────────────────────────────────────────

  const handleSendChat = async () => {
    if (!chatInput.trim() || !token || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatLoading(true);
    setMessages(prev => [...prev, { id: Date.now(), projectId, userId: 0, role: 'user', content: msg, createdAt: new Date().toISOString() }]);
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
    { id: 'files',      label: 'Files',       icon: '📁', badge: activeFiles.length || undefined },
    { id: 'rationalise',label: 'Rationalise', icon: '🔗' },
    { id: 'inventory',  label: 'Inventory',   icon: '📋', badge: inventory.length || undefined },
    { id: 'brd',        label: 'BRD',         icon: '📄' },
    { id: 'test_cases', label: 'Test Cases',  icon: '✅' },
    { id: 'chat',       label: 'Chat',        icon: '💬' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-4">
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
                  <div key={f.id} className="flex items-center justify-between py-3 gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-800 dark:text-white truncate">{f.name}</span>
                        <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full ${ROLE_COLORS[f.role] ?? ROLE_COLORS.template}`}>{f.role}</span>
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
        <div className="space-y-4">
          <div className={`${panelCls} p-5`}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-1">Rationalise Templates</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Groups similar template files by content similarity. After rationalising, add representative templates to the Final Inventory.
            </p>
            <div className="flex items-center gap-4 mb-4">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Similarity threshold: <strong>{threshold}%</strong></label>
              <input type="range" min={50} max={99} value={threshold} onChange={e => setThreshold(Number(e.target.value))} className="w-40 accent-indigo-600" />
            </div>
            {rationaliseError && <p className="text-xs text-red-600 mb-2">{rationaliseError}</p>}
            {savedResult && <p className="text-xs text-emerald-600 mb-2">Result saved to project.</p>}
            <div className="flex items-center gap-3">
              <button
                onClick={handleRationalise}
                disabled={rationalising || activeFiles.filter(f => f.role === 'template' || f.role === 'reference').length < 2}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                {rationalising ? 'Analysing...' : 'Run Rationalise'}
              </button>
              {clusters.length > 0 && (
                <button
                  onClick={() => setActiveTab('inventory')}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
                >
                  Add to Inventory →
                </button>
              )}
            </div>
          </div>

          {clusters.length > 0 && (
            <div className="space-y-3">
              {clusters.map(cluster => (
                <div key={cluster.id} className={`${panelCls} p-5`}>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-white">
                      Group {cluster.id + 1}
                      {cluster.files.length === 1 && <span className="ml-2 text-xs text-slate-400 font-normal">(unique)</span>}
                    </h4>
                    <div className="flex items-center gap-2">
                      {cluster.files.length > 1 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                          {Math.round(cluster.similarity)}% similar · {cluster.files.length} templates
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {cluster.files.map((f, i) => (
                      <div key={f.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-slate-700 dark:text-slate-300">{f.name}</span>
                          {i === 0 && cluster.files.length > 1 && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">canonical</span>
                          )}
                          {inInventoryFileIds.has(f.id) && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">in inventory</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {!inInventoryFileIds.has(f.id) && (
                            <button
                              onClick={() => handleAddToInventory(f, cluster)}
                              disabled={addingToInventory.has(f.id)}
                              className="text-xs text-violet-600 hover:text-violet-800 dark:hover:text-violet-300 border border-violet-300 dark:border-violet-600 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                            >
                              {addingToInventory.has(f.id) ? 'Adding...' : '+ Inventory'}
                            </button>
                          )}
                          {cluster.files.length > 1 && i > 0 && (
                            <button
                              onClick={() => handleArchiveFile(f.id, true)}
                              className="text-xs text-amber-600 hover:text-amber-800 dark:hover:text-amber-400 border border-amber-300 dark:border-amber-600 px-2 py-0.5 rounded transition-colors"
                            >
                              Archive duplicate
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Inventory tab ── */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          {/* Add from Rationalise */}
          {clusters.length > 0 ? (
            <div className={`${panelCls} p-5`}>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-1">Add from Rationalise Groups</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Select templates from cluster groups to add to your implementation inventory.</p>
              <div className="space-y-2">
                {clusters.map(cluster => (
                  <div key={cluster.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                      Group {cluster.id + 1} — {cluster.files.length} template{cluster.files.length !== 1 ? 's' : ''}{cluster.files.length > 1 ? `, ${Math.round(cluster.similarity)}% similar` : ''}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {cluster.files.map(f => (
                        <div key={f.id} className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-700 rounded px-2 py-1">
                          <span className="text-xs text-slate-700 dark:text-slate-300 truncate max-w-xs">{f.name}</span>
                          {inInventoryFileIds.has(f.id) ? (
                            <span className="text-xs text-violet-500">✓</span>
                          ) : (
                            <button
                              onClick={() => handleAddToInventory(f, cluster)}
                              disabled={addingToInventory.has(f.id)}
                              className="text-xs text-violet-600 hover:text-violet-800 font-medium disabled:opacity-50"
                            >
                              {addingToInventory.has(f.id) ? '...' : '+ Add'}
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

                {brdDoc.content?.sections?.templatesOverview?.length > 0 && (
                  <CollapseSection title="Templates Overview">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                          <th className="pb-1 pr-4">Template</th>
                          <th className="pb-1 pr-4">Domain</th>
                          <th className="pb-1">Variants</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {brdDoc.content.sections.templatesOverview.map((t: any, i: number) => (
                          <tr key={i}>
                            <td className="py-1.5 pr-4 font-medium text-slate-800 dark:text-white">{t.name}</td>
                            <td className="py-1.5 pr-4 text-slate-600 dark:text-slate-300">{t.domain ?? '—'}</td>
                            <td className="py-1.5 text-slate-600 dark:text-slate-300">{t.variants ?? 1}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CollapseSection>
                )}

                {brdDoc.content?.sections?.requirements?.length > 0 && (
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

      {/* ── Chat tab ── */}
      {activeTab === 'chat' && (
        <div className={`${panelCls} flex flex-col`} style={{ height: '60vh' }}>
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-sm text-slate-400 dark:text-slate-500 py-8">
                Ask anything about this project — files, rationalise results, or implementation details.
              </div>
            )}
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-lg px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap ${
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
                <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-sm">
                  Thinking...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-700 p-4 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendChat()}
              placeholder="Ask about this project..."
              className="flex-1 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={handleSendChat}
              disabled={!chatInput.trim() || chatLoading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectWorkspace;
