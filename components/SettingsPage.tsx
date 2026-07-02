import React, { useState, useEffect } from 'react';
import { useSettings, Theme, LLMProvider } from '../contexts/SettingsContext';
import { useAuth, AuthUser, UserPreferences } from '../contexts/AuthContext';

// ── Icons ──────────────────────────────────────────────────────────────────

const EyeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
  </svg>
);

const EyeSlashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
  </svg>
);

// ── Appearance Tab ─────────────────────────────────────────────────────────

const AppearanceTab: React.FC<{
  updatePreferences: (p: Partial<UserPreferences>) => Promise<void>;
}> = ({ updatePreferences }) => {
  const { settings, saveSettings } = useSettings();

  const handleThemeChange = async (theme: Theme) => {
    saveSettings({ theme });
    await updatePreferences({ theme });
  };

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Theme</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Your theme preference is saved to your account and applied on every login.
        </p>
        <div className="flex gap-3">
          {(['light', 'dark'] as Theme[]).map((t) => (
            <label
              key={t}
              className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                settings.theme === t
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500'
              }`}
            >
              <input
                type="radio"
                name="theme"
                value={t}
                checked={settings.theme === t}
                onChange={() => handleThemeChange(t)}
                className="sr-only"
              />
              <span className="font-medium capitalize">{t}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── LLM Provider Tab ───────────────────────────────────────────────────────

const LLMProviderTab: React.FC<{
  updatePreferences: (p: Partial<UserPreferences>) => Promise<void>;
}> = ({ updatePreferences }) => {
  const { settings, saveSettings } = useSettings();
  const [draftProvider, setDraftProvider] = useState<LLMProvider>(settings.llmProvider);
  const [draftGeminiKey, setDraftGeminiKey] = useState(settings.geminiApiKey || '');
  const [draftClaudeKey, setDraftClaudeKey] = useState(settings.claudeApiKey);
  const [draftOpenAIKey, setDraftOpenAIKey] = useState(settings.openaiApiKey || '');
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showClaudeKey, setShowClaudeKey] = useState(false);
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Keep draft in sync if settings change externally (e.g. on login)
  useEffect(() => {
    setDraftProvider(settings.llmProvider);
    setDraftGeminiKey(settings.geminiApiKey || '');
    setDraftClaudeKey(settings.claudeApiKey);
    setDraftOpenAIKey(settings.openaiApiKey || '');
  }, [settings.llmProvider, settings.geminiApiKey, settings.claudeApiKey, settings.openaiApiKey]);

  const handleSave = async () => {
    setSaving(true);
    const prefs: Partial<UserPreferences> = {
      llmProvider: draftProvider,
      geminiApiKey: draftGeminiKey,
      claudeApiKey: draftClaudeKey,
      openaiApiKey: draftOpenAIKey,
    };
    saveSettings({ llmProvider: draftProvider, geminiApiKey: draftGeminiKey, claudeApiKey: draftClaudeKey, openaiApiKey: draftOpenAIKey });
    await updatePreferences(prefs);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">LLM Provider</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Your API key is stored securely in your account and used by all accelerators.
        </p>
        <div className="space-y-3">
          {/* Gemini */}
          <div className={`p-3 rounded-lg border-2 transition-all ${draftProvider === 'gemini' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30' : 'border-slate-200 dark:border-slate-600'}`}>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="radio" name="llm" value="gemini" checked={draftProvider === 'gemini'} onChange={() => setDraftProvider('gemini')} className="w-4 h-4 accent-indigo-600" />
              <span className="font-medium text-slate-700 dark:text-slate-200">Google Gemini</span>
            </label>
            {draftProvider === 'gemini' && (
              <div className="relative mt-2">
                <input
                  type={showGeminiKey ? 'text' : 'password'}
                  value={draftGeminiKey}
                  onChange={(e) => setDraftGeminiKey(e.target.value)}
                  placeholder="Gemini API key (leave blank to use env key)"
                  className="w-full pr-10 px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button type="button" onClick={() => setShowGeminiKey(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  {showGeminiKey ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>

          {/* Claude */}
          <div className={`p-3 rounded-lg border-2 transition-all ${draftProvider === 'claude' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30' : 'border-slate-200 dark:border-slate-600'}`}>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="radio" name="llm" value="claude" checked={draftProvider === 'claude'} onChange={() => setDraftProvider('claude')} className="w-4 h-4 accent-indigo-600" />
              <span className="font-medium text-slate-700 dark:text-slate-200">Anthropic Claude</span>
            </label>
            {draftProvider === 'claude' && (
              <div className="relative mt-2">
                <input
                  type={showClaudeKey ? 'text' : 'password'}
                  value={draftClaudeKey}
                  onChange={(e) => setDraftClaudeKey(e.target.value)}
                  placeholder="Claude API key (sk-ant-...)"
                  className="w-full pr-10 px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button type="button" onClick={() => setShowClaudeKey(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  {showClaudeKey ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>

          {/* OpenAI */}
          <div className={`p-3 rounded-lg border-2 transition-all ${draftProvider === 'openai' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30' : 'border-slate-200 dark:border-slate-600'}`}>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="radio" name="llm" value="openai" checked={draftProvider === 'openai'} onChange={() => setDraftProvider('openai')} className="w-4 h-4 accent-indigo-600" />
              <span className="font-medium text-slate-700 dark:text-slate-200">OpenAI GPT</span>
            </label>
            {draftProvider === 'openai' && (
              <div className="relative mt-2">
                <input
                  type={showOpenAIKey ? 'text' : 'password'}
                  value={draftOpenAIKey}
                  onChange={(e) => setDraftOpenAIKey(e.target.value)}
                  placeholder="OpenAI API key (sk-...)"
                  className="w-full pr-10 px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button type="button" onClick={() => setShowOpenAIKey(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  {showOpenAIKey ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className={`px-5 py-2.5 rounded-lg font-semibold text-sm text-white transition-all duration-200 disabled:opacity-60 ${saved ? 'bg-green-500' : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800'}`}
      >
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
      </button>
    </div>
  );
};

// ── Users Tab ──────────────────────────────────────────────────────────────

interface DBUser {
  id: number;
  username: string;
  role: 'Admin' | 'AppUser';
  created_at: string;
}

const UsersTab: React.FC<{ currentUser: AuthUser; token: string }> = ({ currentUser, token }) => {
  const [users, setUsers] = useState<DBUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<DBUser | null>(null);
  const [form, setForm] = useState({ username: '', password: '', role: 'AppUser' as 'Admin' | 'AppUser' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const authHeader = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchUsers = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/v1/users', { headers: authHeader });
      if (!res.ok) throw new Error('Failed to load users');
      setUsers(await res.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(); }, []);

  const openAdd = () => { setEditTarget(null); setForm({ username: '', password: '', role: 'AppUser' }); setFormError(''); setShowModal(true); };
  const openEdit = (u: DBUser) => { setEditTarget(u); setForm({ username: u.username, password: '', role: u.role }); setFormError(''); setShowModal(true); };

  const handleSave = async () => {
    if (!form.username.trim()) { setFormError('Username is required'); return; }
    if (!editTarget && !form.password) { setFormError('Password is required for new users'); return; }
    setSaving(true); setFormError('');
    try {
      const body: any = { username: form.username.trim(), role: form.role };
      if (form.password) body.password = form.password;
      const res = editTarget
        ? await fetch(`/v1/users/${editTarget.id}`, { method: 'PUT', headers: authHeader, body: JSON.stringify(body) })
        : await fetch('/v1/users', { method: 'POST', headers: authHeader, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Save failed'); }
      setShowModal(false);
      await fetchUsers();
    } catch (e: any) { setFormError(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (u: DBUser) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/v1/users/${u.id}`, { method: 'DELETE', headers: authHeader });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Delete failed'); }
      await fetchUsers();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">User Management</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Manage who has access to this application.</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          Add User
        </button>
      </div>

      {error && <div className="px-3.5 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-slate-500 dark:text-slate-400 text-sm">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          Loading users…
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Username</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {users.map((u) => (
                <tr key={u.id} className="bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                    {u.username}
                    {u.id === currentUser.id && <span className="ml-2 text-xs text-indigo-600 dark:text-indigo-400 font-normal">(you)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${u.role === 'Admin' ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEdit(u)} className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-md transition-colors" title="Edit">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" /></svg>
                      </button>
                      {u.id !== currentUser.id && (
                        <button onClick={() => handleDelete(u)} className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors" title="Delete">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6 border border-slate-200 dark:border-slate-700">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">{editTarget ? 'Edit User' : 'Add User'}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Username</label>
                <input type="text" value={form.username} onChange={(e) => setForm(f => ({ ...f, username: e.target.value }))} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Enter username" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                  Password {editTarget && <span className="normal-case font-normal">(leave blank to keep current)</span>}
                </label>
                <input type="password" value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder={editTarget ? 'New password (optional)' : 'Enter password'} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Role</label>
                <select value={form.role} onChange={(e) => setForm(f => ({ ...f, role: e.target.value as 'Admin' | 'AppUser' }))} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="AppUser">AppUser</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>
              {formError && <p className="text-xs text-red-600 dark:text-red-400 px-1">{formError}</p>}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2 px-4 rounded-lg text-sm font-semibold text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2 px-4 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors">{saving ? 'Saving…' : editTarget ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Settings Page ──────────────────────────────────────────────────────────

type SettingsTab = 'appearance' | 'llm' | 'users';

const SettingsPage: React.FC = () => {
  const { user, token, updatePreferences } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');

  const tabs: { id: SettingsTab; label: string; adminOnly?: boolean }[] = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'llm', label: 'LLM Provider' },
    { id: 'users', label: 'Users', adminOnly: true },
  ];

  const visibleTabs = tabs.filter(t => !t.adminOnly || user?.role === 'Admin');

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Preferences are saved to your account and applied on every login.</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700 mb-6">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'appearance' && <AppearanceTab updatePreferences={updatePreferences} />}
      {activeTab === 'llm' && <LLMProviderTab updatePreferences={updatePreferences} />}
      {activeTab === 'users' && user?.role === 'Admin' && token && (
        <UsersTab currentUser={user} token={token} />
      )}
    </div>
  );
};

export default SettingsPage;
