import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface Company {
  id: number;
  name: string;
  storageProvider: string | null;
  hasStorage: boolean;
  memberCount: number;
  createdAt: string;
}

const GUARDED = ['AdminCo', 'General'];

const CompanyAdmin: React.FC = () => {
  const { token } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [renameTarget, setRenameTarget] = useState<Company | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renaming, setRenaming] = useState(false);

  const authHeader = { Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/json' };

  const fetchCompanies = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/v1/companies', { headers: authHeader });
      const data = await res.json();
      setCompanies(data.companies ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const res = await fetch('/v1/companies', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create company');
      setShowCreate(false);
      setNewName('');
      fetchCompanies();
    } catch (e: any) {
      setCreateError(e.message);
    }
    setCreating(false);
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    setRenaming(true);
    try {
      const res = await fetch(`/v1/companies/${renameTarget.id}`, {
        method: 'PATCH',
        headers: authHeader,
        body: JSON.stringify({ name: renameName.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Rename failed');
      }
      setRenameTarget(null);
      fetchCompanies();
    } catch (e: any) {
      setError(e.message);
    }
    setRenaming(false);
  };

  const handleDelete = async (company: Company) => {
    if (!confirm(`Delete company "${company.name}"?\n\nAll associated projects will be permanently removed. This cannot be undone.`)) return;
    try {
      const res = await fetch(`/v1/companies/${company.id}`, { method: 'DELETE', headers: authHeader });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Delete failed');
      }
      fetchCompanies();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Companies</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Manage company workspaces, storage, and members.
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setNewName(''); setCreateError(''); }}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Company
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400 flex items-center justify-between">
          {error}
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-2">✕</button>
        </div>
      )}

      {showCreate && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-3">New Company</h3>
          {createError && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{createError}</p>}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Company Name</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="e.g. Deloitte UK"
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                autoFocus
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500 dark:text-slate-400 py-4">Loading companies…</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {['Name', 'Storage', 'Members', 'Created', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {companies.map(c => (
                <tr key={c.id} className="bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                    {renameTarget?.id === c.id ? (
                      <div className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={renameName}
                          onChange={e => setRenameName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRename();
                            if (e.key === 'Escape') setRenameTarget(null);
                          }}
                          className="px-2 py-1 text-sm border border-indigo-400 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          autoFocus
                        />
                        <button onClick={handleRename} disabled={renaming} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50">
                          {renaming ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setRenameTarget(null)} className="text-xs text-slate-400 hover:underline">Cancel</button>
                      </div>
                    ) : (
                      <span className="flex items-center gap-2">
                        {c.name}
                        {GUARDED.includes(c.name) && (
                          <span className="text-xs px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded">system</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.hasStorage ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        c.storageProvider === 's3'
                          ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      }`}>
                        {c.storageProvider === 's3' ? 'Amazon S3' : 'Azure Blob'}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{c.memberCount}</td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {!GUARDED.includes(c.name) && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => { setRenameTarget(c); setRenameName(c.name); }}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-md transition-colors"
                          title="Rename"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(c)}
                          className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                          title="Delete"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {companies.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                    No companies found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CompanyAdmin;
