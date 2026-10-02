import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { Company, CompanyMember } from '../types';

interface CompanySettingsProps {
  token: string;
}

const CompanySettings: React.FC<CompanySettingsProps> = ({ token }) => {
  const { user } = useAuth();
  const isCompanyAdmin = user?.companyRole === 'admin';

  const [company, setCompany] = useState<Company | null>(null);
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [addUsername, setAddUsername] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    name: '',
    storage_provider: '' as '' | 's3' | 'azure',
    storage_bucket: '',
    storage_region: '',
    storage_access_key: '',
    storage_secret_key: '',
    storage_azure_connection: '',
    gemini_api_key: '',
    claude_api_key: '',
    openai_api_key: '',
    grok_api_key: '',
  });

  const fetchCompany = useCallback(async () => {
    try {
      const res = await fetch('/v1/companies/mine', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.company) {
        setCompany(data.company);
        setForm(f => ({
          ...f,
          name: data.company.name,
          storage_provider: data.company.storageProvider ?? '',
          storage_bucket: data.company.storageBucket ?? '',
          storage_region: data.company.storageRegion ?? '',
        }));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  const fetchMembers = useCallback(async () => {
    if (!isCompanyAdmin) return;
    try {
      const res = await fetch('/v1/companies/mine/members', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members ?? []);
      }
    } catch { /* ignore */ }
  }, [token, isCompanyAdmin]);

  useEffect(() => {
    fetchCompany();
  }, [fetchCompany]);

  useEffect(() => {
    if (company) fetchMembers();
  }, [company, fetchMembers]);

  const handleCreate = async () => {
    if (!newCompanyName.trim()) return;
    setSaving(true); setError('');
    try {
      const res = await fetch('/v1/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newCompanyName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCompany(data.company);
      setCreateMode(false);
      setSuccess('Company created.');
      window.location.reload(); // refresh to update user's companyId
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  };

  const handleSave = async () => {
    if (!company) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const body: Record<string, string | null> = {
        name: form.name || null,
        storage_provider: form.storage_provider || null,
        storage_bucket: form.storage_bucket || null,
        storage_region: form.storage_region || null,
      };
      if (form.storage_access_key) body.storage_access_key = form.storage_access_key;
      if (form.storage_secret_key) body.storage_secret_key = form.storage_secret_key;
      if (form.storage_azure_connection) body.storage_azure_connection = form.storage_azure_connection;
      if (form.gemini_api_key) body.gemini_api_key = form.gemini_api_key;
      if (form.claude_api_key) body.claude_api_key = form.claude_api_key;
      if (form.openai_api_key) body.openai_api_key = form.openai_api_key;
      if (form.grok_api_key) body.grok_api_key = form.grok_api_key;

      const res = await fetch(`/v1/companies/${company.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCompany(data.company);
      setSuccess('Company settings saved.');
      setForm(f => ({ ...f, gemini_api_key: '', claude_api_key: '', openai_api_key: '', grok_api_key: '', storage_access_key: '', storage_secret_key: '', storage_azure_connection: '' }));
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  };

  const handleAddMember = async () => {
    if (!company || !addUsername.trim()) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const res = await fetch(`/v1/companies/${company.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username: addUsername.trim(), uses_company_keys: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAddUsername('');
      setSuccess('Member added.');
      fetchMembers();
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  };

  const handleRemoveMember = async (memberId: number) => {
    if (!company) return;
    try {
      await fetch(`/v1/companies/${company.id}/members/${memberId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchMembers();
    } catch { /* ignore */ }
  };

  const handleToggleCompanyKeys = async (memberId: number, current: boolean) => {
    if (!company) return;
    await fetch(`/v1/companies/${company.id}/members/${memberId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ uses_company_keys: !current }),
    });
    fetchMembers();
  };

  if (loading) {
    return <div className="text-sm text-slate-500 dark:text-slate-400 py-4">Loading company settings...</div>;
  }

  const panelCls = 'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm';

  if (!company && !createMode) {
    if (user?.role !== 'Admin') {
      return (
        <div className={`${panelCls} text-sm text-slate-500 dark:text-slate-400`}>
          You are not associated with a company. Contact an Admin to be added to one.
        </div>
      );
    }
    return (
      <div className={panelCls}>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">No company configured. Create one to enable shared storage and API keys.</p>
        <button
          onClick={() => setCreateMode(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Create Company
        </button>
      </div>
    );
  }

  if (createMode) {
    return (
      <div className={panelCls}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-3">Create Company</h3>
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        <input
          type="text"
          value={newCompanyName}
          onChange={e => setNewCompanyName(e.target.value)}
          placeholder="Company name"
          className="w-full max-w-xs px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white mb-3"
        />
        <div className="flex gap-2">
          <button onClick={handleCreate} disabled={saving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
            {saving ? 'Creating...' : 'Create'}
          </button>
          <button onClick={() => setCreateMode(false)} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:underline">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Company info */}
      <div className={panelCls}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-white">{company!.name}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Your role: <span className="font-medium capitalize">{user?.companyRole ?? 'member'}</span>
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            {company!.hasGeminiKey && <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">Gemini ✓</span>}
            {company!.hasClaudeKey && <span className="px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">Claude ✓</span>}
            {company!.hasOpenAiKey && <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">OpenAI ✓</span>}
            {company!.hasGrokKey && <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Grok ✓</span>}
          </div>
        </div>

        {!isCompanyAdmin && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {user?.usesCompanyKeys ? 'Using company-shared LLM keys.' : 'Using your personal LLM keys.'}
          </p>
        )}
      </div>

      {isCompanyAdmin && (
        <>
          {/* Storage */}
          <div className={panelCls}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-4">Cloud Storage</h3>
            {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
            {success && <p className="text-xs text-emerald-600 mb-2">{success}</p>}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Company Name</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full max-w-sm px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Storage Provider</label>
                <select value={form.storage_provider} onChange={e => setForm(f => ({ ...f, storage_provider: e.target.value as any }))}
                  className="px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white">
                  <option value="">None</option>
                  <option value="s3">Amazon S3</option>
                  <option value="azure">Azure Blob Storage</option>
                </select>
              </div>

              {form.storage_provider === 's3' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">S3 Bucket</label>
                    <input type="text" value={form.storage_bucket} onChange={e => setForm(f => ({ ...f, storage_bucket: e.target.value }))} placeholder="my-bucket"
                      className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Region</label>
                    <input type="text" value={form.storage_region} onChange={e => setForm(f => ({ ...f, storage_region: e.target.value }))} placeholder="us-east-1"
                      className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Access Key ID</label>
                    <input type="text" value={form.storage_access_key} onChange={e => setForm(f => ({ ...f, storage_access_key: e.target.value }))} placeholder="Enter to update"
                      className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Secret Access Key</label>
                    <input type="password" value={form.storage_secret_key} onChange={e => setForm(f => ({ ...f, storage_secret_key: e.target.value }))} placeholder="Enter to update"
                      className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white" />
                  </div>
                </div>
              )}

              {form.storage_provider === 'azure' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Container Name</label>
                  <input type="text" value={form.storage_bucket} onChange={e => setForm(f => ({ ...f, storage_bucket: e.target.value }))} placeholder="my-container"
                    className="w-full max-w-sm px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white mb-2" />
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Connection String / SAS URL</label>
                  <input type="password" value={form.storage_azure_connection} onChange={e => setForm(f => ({ ...f, storage_azure_connection: e.target.value }))} placeholder="Enter to update"
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white" />
                </div>
              )}
            </div>
          </div>

          {/* Shared LLM Keys */}
          <div className={panelCls}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-1">Shared LLM API Keys</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Keys set here are available to all company members with "Use company keys" enabled. Enter a value to update; leave blank to keep existing.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { key: 'gemini_api_key', label: 'Gemini API Key', has: company!.hasGeminiKey },
                { key: 'claude_api_key', label: 'Claude API Key', has: company!.hasClaudeKey },
                { key: 'openai_api_key', label: 'OpenAI API Key', has: company!.hasOpenAiKey },
                { key: 'grok_api_key', label: 'Grok API Key', has: company!.hasGrokKey },
              ].map(({ key, label, has }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    {label} {has && <span className="text-emerald-600 dark:text-emerald-400">(saved)</span>}
                  </label>
                  <input
                    type="password"
                    value={(form as any)[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={has ? 'Enter to replace' : 'Enter key'}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSave} disabled={saving}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : 'Save Company Settings'}
            </button>
          </div>

          {/* Members */}
          <div className={panelCls}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-4">Members</h3>
            <div className="flex gap-2 mb-4">
              <input type="text" value={addUsername} onChange={e => setAddUsername(e.target.value)} placeholder="Username to add"
                className="px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white w-48" />
              <button onClick={handleAddMember} disabled={saving || !addUsername.trim()}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg disabled:opacity-50">Add</button>
            </div>
            {members.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">No members yet.</p>
            ) : (
              <div className="space-y-2">
                {members.map(m => (
                  <div key={m.id} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
                    <div>
                      <span className="text-sm font-medium text-slate-800 dark:text-white">{m.username}</span>
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${m.companyRole === 'admin' ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                        {m.companyRole}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => handleToggleCompanyKeys(m.id, m.usesCompanyKeys)}
                        className={`text-xs px-2 py-1 rounded-full border transition-colors ${m.usesCompanyKeys ? 'border-emerald-400 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400'}`}
                        title="Toggle company key usage">
                        {m.usesCompanyKeys ? 'Uses company keys' : 'Uses own keys'}
                      </button>
                      {m.id !== user?.id && (
                        <button onClick={() => handleRemoveMember(m.id)} className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400">Remove</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default CompanySettings;
