import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { Project } from '../types';

interface ProjectsProps {
  onOpenProject: (projectId: number) => void;
}

const Projects: React.FC<ProjectsProps> = ({ onOpenProject }) => {
  const { user, token } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const fetchProjects = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/v1/projects', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const handleCreate = async () => {
    if (!newName.trim() || !token) return;
    setCreating(true); setError('');
    try {
      const res = await fetch('/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create project');
      setShowCreate(false);
      setNewName(''); setNewDesc('');
      fetchProjects();
    } catch (e: any) {
      setError(e.message);
    }
    setCreating(false);
  };

  const handleArchive = async (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    if (!token) return;
    const newStatus = project.status === 'active' ? 'archived' : 'active';
    await fetch(`/v1/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchProjects();
  };

  const hasCompany = Boolean(user?.companyId);

  const panelCls = 'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm';

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Projects</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Persistent workspaces for your document implementation projects.</p>
        </div>
        {hasCompany && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Project
          </button>
        )}
      </div>

      {/* No company warning */}
      {!hasCompany && (
        <div className={`${panelCls} flex items-start gap-3`}>
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-white">Company required</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Projects are tied to a company workspace. Go to Settings → Company to set one up or ask your Admin to add you.</p>
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className={panelCls}>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-3">New Project</h3>
          {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Project Name</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="e.g. Motor Insurance Templates Q4"
                className="w-full max-w-sm px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Description (optional)</label>
              <textarea
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                rows={2}
                className="w-full max-w-sm px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white resize-none"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleCreate} disabled={creating || !newName.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => { setShowCreate(false); setError(''); setNewName(''); setNewDesc(''); }}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:underline">Cancel</button>
          </div>
        </div>
      )}

      {/* Projects grid */}
      {loading ? (
        <div className="text-sm text-slate-500 dark:text-slate-400 py-4">Loading projects...</div>
      ) : projects.length === 0 && hasCompany ? (
        <div className={`${panelCls} text-center py-12`}>
          <svg className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
          </svg>
          <p className="text-sm text-slate-500 dark:text-slate-400">No projects yet. Click "New Project" to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(project => (
            <button
              key={project.id}
              onClick={() => onOpenProject(project.id)}
              className="text-left bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                    {project.name}
                  </h3>
                  {project.description && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{project.description}</p>
                  )}
                </div>
                <span
                  className={`ml-2 flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                    project.status === 'active'
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {project.status}
                </span>
              </div>

              <div className="flex items-center justify-between mt-4">
                <div className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                  {project.fileCount ?? 0} files
                </div>
                <button
                  onClick={e => handleArchive(e, project)}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  title={project.status === 'active' ? 'Archive project' : 'Restore project'}
                >
                  {project.status === 'active' ? 'Archive' : 'Restore'}
                </button>
              </div>

              <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                Updated {new Date(project.updatedAt).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default Projects;
