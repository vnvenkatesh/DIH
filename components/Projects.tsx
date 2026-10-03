import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { Project, ProjectMember } from '../types';

type FilterTab = 'all' | 'active' | 'archived';

interface ProjectsProps {
  onOpenProject: (projectId: number) => void;
  onGoToStorage?: () => void;
}

const panelCls = 'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm';

// ── Icons ──────────────────────────────────────────────────────────────────

const LockIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const ShareIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
  </svg>
);

// ── Visibility badge ───────────────────────────────────────────────────────

const VisibilityBadge: React.FC<{ visibility: 'private' | 'shared' }> = ({ visibility }) =>
  visibility === 'private' ? (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium">
      <LockIcon /> Private
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 font-medium">
      <ShareIcon /> Shared
    </span>
  );

// ── Share panel ───────────────────────────────────────────────────────────

interface SharePanelProps {
  project: Project;
  token: string;
  onClose: () => void;
}

const SharePanel: React.FC<SharePanelProps> = ({ project, token, onClose }) => {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [inviteUsername, setInviteUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState('');

  const authHeader = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/v1/projects/${project.id}/members`, { headers: authHeader });
      const data = await res.json();
      setMembers(data.members ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [project.id, token]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const handleInvite = async () => {
    if (!inviteUsername.trim()) return;
    setInviting(true);
    setError('');
    try {
      const res = await fetch(`/v1/projects/${project.id}/members`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ username: inviteUsername.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to invite');
      setInviteUsername('');
      fetchMembers();
    } catch (e: any) {
      setError(e.message);
    }
    setInviting(false);
  };

  const handleRemove = async (userId: number) => {
    try {
      await fetch(`/v1/projects/${project.id}/members/${userId}`, {
        method: 'DELETE',
        headers: authHeader,
      });
      fetchMembers();
    } catch { /* ignore */ }
  };

  return (
    <div className="mt-3 p-4 rounded-lg border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 text-sm space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-indigo-700 dark:text-indigo-300 text-xs uppercase tracking-wider">Share with users</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <input
          type="text"
          value={inviteUsername}
          onChange={e => setInviteUsername(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleInvite()}
          placeholder="Username to invite…"
          className="flex-1 px-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={handleInvite}
          disabled={inviting || !inviteUsername.trim()}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-colors"
        >
          {inviting ? '…' : 'Add'}
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : members.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">No members added yet.</p>
      ) : (
        <ul className="space-y-1">
          {members.map(m => (
            <li key={m.userId} className="flex items-center justify-between py-1 px-2 rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600">
              <span className="text-xs text-slate-700 dark:text-slate-200">{m.username}</span>
              <button
                onClick={() => handleRemove(m.userId)}
                className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-300"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────

const Projects: React.FC<ProjectsProps> = ({ onOpenProject, onGoToStorage }) => {
  const { user, token } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newVisibility, setNewVisibility] = useState<'shared' | 'private'>('shared');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [sharePanelFor, setSharePanelFor] = useState<number | null>(null);

  const isGeneralUser = !user?.companyId || user?.companyName === 'General';
  const isLocked =
    user?.role !== 'Admin' &&
    (isGeneralUser ? !user?.hasStorage : !user?.companyHasStorage);

  const authHeader = { Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/json' };

  const fetchProjects = useCallback(async () => {
    if (!token || isLocked) return;
    setLoading(true);
    try {
      const res = await fetch('/v1/projects', { headers: authHeader });
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [token, isLocked]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const handleCreate = async () => {
    if (!newName.trim() || !token) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/v1/projects', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim(), visibility: newVisibility }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create project');
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      setNewVisibility('shared');
      fetchProjects();
    } catch (e: any) {
      setError(e.message);
    }
    setCreating(false);
  };

  const handleDelete = async (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
    try {
      await fetch(`/v1/projects/${project.id}`, { method: 'DELETE', headers: authHeader });
      fetchProjects();
    } catch { /* ignore */ }
  };

  const handleArchive = async (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    if (!token) return;
    const newStatus = project.status === 'active' ? 'archived' : 'active';
    await fetch(`/v1/projects/${project.id}`, {
      method: 'PUT',
      headers: authHeader,
      body: JSON.stringify({ status: newStatus }),
    });
    fetchProjects();
  };

  const toggleSharePanel = (e: React.MouseEvent, projectId: number) => {
    e.stopPropagation();
    setSharePanelFor(prev => (prev === projectId ? null : projectId));
  };

  const filtered = projects.filter(p =>
    filter === 'all' ? true : p.status === filter
  );

  // ── Lock screen ───────────────────────────────────────────────────────────
  if (isLocked) {
    const storageLabel = isGeneralUser ? 'Storage Settings' : 'Company Storage';
    return (
      <div className="max-w-lg mx-auto mt-16 text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Storage Required</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-sm mx-auto">
            Projects need a storage container to save uploaded files and results. Configure {storageLabel} to unlock Projects.
          </p>
        </div>
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-left">
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            No storage configured.{' '}
            {onGoToStorage && (
              <button onClick={onGoToStorage} className="font-semibold underline hover:no-underline">
                Go to {storageLabel}
              </button>
            )}
          </p>
        </div>
      </div>
    );
  }

  // ── Main view ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Projects</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Persistent workspaces for your document implementation projects.
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setNewName(''); setNewDesc(''); setNewVisibility('shared'); setError(''); }}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Project
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {(['all', 'active', 'archived'] as FilterTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px capitalize ${
              filter === tab
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {tab}
            {tab !== 'all' && (
              <span className="ml-1.5 text-xs opacity-60">
                ({projects.filter(p => p.status === tab).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6 border border-slate-200 dark:border-slate-700">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">New Project</h3>
            {error && <p className="text-xs text-red-600 dark:text-red-400 mb-3">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Project Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder="e.g. Motor Insurance Templates Q4"
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Description (optional)</label>
                <textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Visibility</label>
                <div className="flex gap-2">
                  {(['shared', 'private'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setNewVisibility(v)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
                        newVisibility === v
                          ? v === 'shared'
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'bg-slate-700 border-slate-700 text-white'
                          : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      {v === 'private' ? <LockIcon /> : <ShareIcon />}
                      {v === 'shared' ? 'Shared (Company)' : 'Private (Only Me)'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
                  {newVisibility === 'shared'
                    ? 'All company members can view and access this project.'
                    : 'Only you (and invited users) can access this project.'}
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2 px-4 rounded-lg text-sm font-semibold text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={creating || !newName.trim()} className="flex-1 py-2 px-4 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Projects grid */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-slate-500 dark:text-slate-400 text-sm">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading projects…
        </div>
      ) : filtered.length === 0 ? (
        <div className={`${panelCls} text-center py-12`}>
          <svg className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
          </svg>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {filter === 'all' ? 'No projects yet. Click "New Project" to get started.' : `No ${filter} projects.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(project => (
            <div key={project.id} className="flex flex-col">
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 px-5 py-4 shadow-sm hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-md transition-all group">
                <div className="flex items-center gap-4">
                  {/* Left: name + description */}
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpenProject(project.id)}>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                      {project.name}
                    </h3>
                    {project.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{project.description}</p>
                    )}
                  </div>

                  {/* Middle: metadata chips */}
                  <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
                    <VisibilityBadge visibility={project.visibility ?? 'shared'} />
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      project.status === 'active'
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                    }`}>
                      {project.status}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">
                      {project.fileCount ?? 0} files · {new Date(project.updatedAt).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); onOpenProject(project.id); }}
                      className="py-1.5 px-3 text-xs font-medium rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                    >
                      Open
                    </button>
                    {project.createdBy === user?.id && (
                      <button
                        onClick={e => toggleSharePanel(e, project.id)}
                        className={`p-1.5 rounded-lg transition-colors ${
                          sharePanelFor === project.id
                            ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300'
                            : 'text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
                        }`}
                        title="Share project"
                      >
                        <ShareIcon />
                      </button>
                    )}
                    <button
                      onClick={e => handleArchive(e, project)}
                      className="py-1.5 px-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                      title={project.status === 'active' ? 'Archive' : 'Restore'}
                    >
                      {project.status === 'active' ? 'Archive' : 'Restore'}
                    </button>
                    <button
                      onClick={e => handleDelete(e, project)}
                      className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      title="Delete project"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Inline share panel — renders below the card */}
              {sharePanelFor === project.id && token && (
                <SharePanel
                  project={project}
                  token={token}
                  onClose={() => setSharePanelFor(null)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Projects;
