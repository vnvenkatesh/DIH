import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { Project, ProjectFile, ProjectMessage } from '../types';

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

// ── File size formatter ────────────────────────────────────────────────────────

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

// ── Role badge ─────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  template: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
  reference: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
  xsd: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  csv: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  archived: 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
};

// ── Main component ─────────────────────────────────────────────────────────────

interface ProjectWorkspaceProps {
  projectId: number;
  onBack: () => void;
}

type Tab = 'files' | 'rationalise' | 'chat';

const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = ({ projectId, onBack }) => {
  const { token } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [messages, setMessages] = useState<ProjectMessage[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('files');
  const [loading, setLoading] = useState(true);

  // File upload
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rationalise
  const [threshold, setThreshold] = useState(75);
  const [clusters, setClusters] = useState<DocCluster[]>([]);
  const [rationalising, setRationalising] = useState(false);
  const [rationaliseError, setRationaliseError] = useState('');
  const [savedResult, setSavedResult] = useState(false);

  // Chat
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

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

  const fetchChat = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/v1/projects/${projectId}/chat`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setMessages((await res.json()).messages ?? []);
    } catch { /* ignore */ }
  }, [token, projectId]);

  useEffect(() => { fetchProject(); }, [fetchProject]);

  useEffect(() => {
    if (activeTab === 'chat') fetchChat();
  }, [activeTab, fetchChat]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || !token) return;
    setUploading(true);
    const fd = new FormData();
    Array.from(fileList).forEach(f => fd.append('files', f));
    fd.append('role', 'template');
    try {
      const res = await fetch(`/v1/projects/${projectId}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (res.ok) fetchProject();
    } catch { /* ignore */ }
    setUploading(false);
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

  const handleRationalise = async () => {
    const templates = files.filter(f => !f.archived && (f.role === 'template' || f.role === 'reference'));
    if (templates.length < 2) { setRationaliseError('Upload at least 2 template files to rationalise.'); return; }

    setRationalising(true); setRationaliseError(''); setSavedResult(false); setClusters([]);

    try {
      // Download file text via signed URLs
      const texts = await Promise.all(templates.map(async (f) => {
        if (!f.signedUrl) return f.name;
        try {
          const res = await fetch(f.signedUrl);
          return await res.text();
        } catch { return f.name; }
      }));

      const result = clusterFiles(templates, texts, threshold);
      setClusters(result);

      // Save result to project
      if (token) {
        await fetch(`/v1/projects/${projectId}/results`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            accelerator: 'rationalise',
            result_data: { threshold, clusters: result.map(c => ({ id: c.id, files: c.files.map(f => f.name), similarity: c.similarity })) },
          }),
        });
        setSavedResult(true);
      }
    } catch (e: any) {
      setRationaliseError(e.message ?? 'Rationalise failed');
    }
    setRationalising(false);
  };

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

  const panelCls = 'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm';

  if (loading) {
    return <div className="max-w-6xl mx-auto py-8 text-sm text-slate-500 dark:text-slate-400">Loading project...</div>;
  }

  if (!project) {
    return <div className="max-w-6xl mx-auto py-8 text-sm text-red-500">Project not found.</div>;
  }

  const activeFiles = files.filter(f => !f.archived);
  const archivedFiles = files.filter(f => f.archived);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Breadcrumb / header */}
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

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {([
          { id: 'files' as Tab, label: 'Files', icon: '📁' },
          { id: 'rationalise' as Tab, label: 'Rationalise', icon: '🔗' },
          { id: 'chat' as Tab, label: 'Chat', icon: '💬' },
        ]).map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px flex items-center gap-1.5 ${
              activeTab === id
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <span>{icon}</span> {label}
          </button>
        ))}
      </div>

      {/* ── Files tab ── */}
      {activeTab === 'files' && (
        <div className="space-y-4">
          {/* Upload zone */}
          <div className={`${panelCls} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Project Files</h3>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
                {uploading ? 'Uploading...' : 'Upload Files'}
              </button>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => handleUpload(e.target.files)} accept=".pdf,.docx,.doc,.xsd,.csv,.xml,.gd" />
            </div>

            {activeFiles.length === 0 ? (
              <div
                className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
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
                      </div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{formatBytes(f.sizeBytes)} · {new Date(f.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {f.signedUrl && (
                        <a href={f.signedUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300">Download</a>
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
            <details className={`${panelCls}`}>
              <summary className="p-5 text-sm font-medium text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                Archived Files ({archivedFiles.length})
              </summary>
              <div className="px-5 pb-4 divide-y divide-slate-100 dark:divide-slate-700">
                {archivedFiles.map(f => (
                  <div key={f.id} className="flex items-center justify-between py-3 gap-3">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm text-slate-500 dark:text-slate-400 truncate line-through">{f.name}</span>
                    </div>
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
              Groups similar template files by content similarity. Duplicate groups can be archived directly from results.
            </p>

            <div className="flex items-center gap-4 mb-4">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Similarity threshold: <strong>{threshold}%</strong></label>
              <input type="range" min={50} max={99} value={threshold} onChange={e => setThreshold(Number(e.target.value))} className="w-40 accent-indigo-600" />
            </div>

            {rationaliseError && <p className="text-xs text-red-600 mb-2">{rationaliseError}</p>}
            {savedResult && <p className="text-xs text-emerald-600 mb-2">Result saved to project.</p>}

            <button
              onClick={handleRationalise}
              disabled={rationalising || activeFiles.filter(f => f.role === 'template' || f.role === 'reference').length < 2}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              {rationalising ? 'Analysing...' : 'Run Rationalise'}
            </button>
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
                    {cluster.files.length > 1 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                        {Math.round(cluster.similarity)}% similar
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {cluster.files.map((f, i) => (
                      <div key={f.id} className="flex items-center justify-between">
                        <span className="text-sm text-slate-700 dark:text-slate-300">{f.name}</span>
                        {cluster.files.length > 1 && i > 0 && (
                          <button
                            onClick={() => handleArchiveFile(f.id, true)}
                            className="text-xs text-amber-600 hover:text-amber-800 dark:hover:text-amber-400 border border-amber-300 dark:border-amber-600 px-2 py-0.5 rounded transition-colors"
                          >
                            Archive duplicate
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Chat tab ── */}
      {activeTab === 'chat' && (
        <div className={`${panelCls} flex flex-col`} style={{ height: '60vh' }}>
          {/* Messages */}
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

          {/* Input */}
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
