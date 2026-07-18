import React, { useState, useEffect, useCallback } from 'react';
import { useSettings, LLMProvider } from '../contexts/SettingsContext';
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

  const handleThemeChange = async (theme: 'light' | 'dark') => {
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
          {(['light', 'dark'] as const).map((t) => (
            <label
              key={t}
              className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                settings.theme === t
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500'
              }`}
            >
              <input type="radio" name="theme" value={t} checked={settings.theme === t} onChange={() => handleThemeChange(t)} className="sr-only" />
              <span className="font-medium capitalize">{t}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Usage stats types ──────────────────────────────────────────────────────

interface ProviderSummary {
  provider: string;
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: string;
}

interface RecentLog {
  id: number;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: string;
  created_at: string;
}

interface UsageStats {
  summary: ProviderSummary[];
  recent: RecentLog[];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(raw: string | number): string {
  const n = typeof raw === 'string' ? parseFloat(raw) : raw;
  if (isNaN(n)) return '$0.00';
  if (n < 0.001) return `<$0.001`;
  return `$${n.toFixed(4)}`;
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return `${Math.round(diff)}s ago`;
  if (diff < 3600)  return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

// ── AI Providers Tab ───────────────────────────────────────────────────────

const PROVIDER_CONFIG: { id: LLMProvider; label: string; keyField: keyof Pick<UserPreferences, 'geminiApiKey' | 'claudeApiKey' | 'openaiApiKey'>; placeholder: string; color: string }[] = [
  { id: 'gemini', label: 'Google Gemini',    keyField: 'geminiApiKey', placeholder: 'Gemini API key (leave blank to use env key)', color: 'blue'   },
  { id: 'claude', label: 'Anthropic Claude', keyField: 'claudeApiKey', placeholder: 'Claude API key (sk-ant-...)',                  color: 'orange' },
  { id: 'openai', label: 'OpenAI GPT',       keyField: 'openaiApiKey', placeholder: 'OpenAI API key (sk-...)',                      color: 'emerald'},
];

interface ModelOption { id: string; label: string; costHint: string; }
const MODEL_OPTIONS: Record<LLMProvider, ModelOption[]> = {
  gemini: [
    { id: 'gemini-2.5-flash',        label: 'Gemini 2.5 Flash',         costHint: '$0.30 / $2.50 per 1M tokens'   },
    { id: 'gemini-2.5-pro',          label: 'Gemini 2.5 Pro',           costHint: '$1.25 / $10.00 per 1M tokens'  },
    { id: 'gemini-3.1-pro-preview',  label: 'Gemini 3.1 Pro (Preview)', costHint: '~$1.25 / $10.00 per 1M tokens' },
  ],
  claude: [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  costHint: '$0.80 / $4.00 per 1M tokens'   },
    { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6', costHint: '$3.00 / $15.00 per 1M tokens'  },
    { id: 'claude-opus-4-8',           label: 'Claude Opus 4.8',   costHint: '$15.00 / $75.00 per 1M tokens' },
  ],
  openai: [
    { id: 'gpt-4o-mini',  label: 'GPT-4o Mini',  costHint: '$0.15 / $0.60 per 1M tokens'  },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', costHint: '$0.40 / $1.60 per 1M tokens'  },
    { id: 'gpt-4o',       label: 'GPT-4o',       costHint: '$2.50 / $10.00 per 1M tokens' },
    { id: 'gpt-4.1',      label: 'GPT-4.1',      costHint: '$2.00 / $8.00 per 1M tokens'  },
  ],
};

const ACCENT: Record<string, string> = {
  blue:    'border-blue-400   bg-blue-50   dark:bg-blue-950/30   dark:border-blue-600',
  orange:  'border-orange-400 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-600',
  emerald: 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-600',
};

const BADGE: Record<string, string> = {
  blue:    'bg-blue-100    dark:bg-blue-900/40   text-blue-700    dark:text-blue-300',
  orange:  'bg-orange-100  dark:bg-orange-900/40  text-orange-700  dark:text-orange-300',
  emerald: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
};

const AiProvidersTab: React.FC<{
  updatePreferences: (p: Partial<UserPreferences>) => Promise<void>;
  token: string;
}> = ({ updatePreferences, token }) => {
  const { settings, saveSettings } = useSettings();
  const [activeProvider, setActiveProvider] = useState<LLMProvider>('gemini');

  const [keys, setKeys] = useState({
    gemini: settings.geminiApiKey || '',
    claude: settings.claudeApiKey || '',
    openai: settings.openaiApiKey || '',
  });

  const [models, setModels] = useState({
    gemini: settings.geminiModel || 'gemini-2.5-flash',
    claude: settings.claudeModel || 'claude-haiku-4-5-20251001',
    openai: settings.openaiModel || 'gpt-4o-mini',
  });
  const [showKey, setShowKey] = useState({ gemini: false, claude: false, openai: false });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  const [stats, setStats]         = useState<UsageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError]    = useState('');

  // Keep keys and models in sync if settings change externally (e.g. on login hydration)
  useEffect(() => {
    setKeys({
      gemini: settings.geminiApiKey || '',
      claude: settings.claudeApiKey || '',
      openai: settings.openaiApiKey || '',
    });
  }, [settings.geminiApiKey, settings.claudeApiKey, settings.openaiApiKey]);

  useEffect(() => {
    setModels({
      gemini: settings.geminiModel || 'gemini-2.5-flash',
      claude: settings.claudeModel || 'claude-haiku-4-5-20251001',
      openai: settings.openaiModel || 'gpt-4o-mini',
    });
  }, [settings.geminiModel, settings.claudeModel, settings.openaiModel]);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError('');
    try {
      const res = await fetch('/v1/llm/stats', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to load usage stats');
      setStats(await res.json());
    } catch (e: any) {
      setStatsError(e.message);
    } finally {
      setStatsLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleSaveKey = async () => {
    setSaving(true);
    const prefs: Partial<UserPreferences> = {
      geminiApiKey: keys.gemini,
      claudeApiKey: keys.claude,
      openaiApiKey: keys.openai,
      geminiModel: models.gemini,
      claudeModel: models.claude,
      openaiModel: models.openai,
    };
    saveSettings(prefs);
    await updatePreferences(prefs);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const providerSummary = stats?.summary.find(s => s.provider === activeProvider);
  const providerRecent  = stats?.recent.filter(r => r.provider === activeProvider) ?? [];
  const cfg = PROVIDER_CONFIG.find(p => p.id === activeProvider)!;

  return (
    <div className="max-w-2xl space-y-5">
      {/* Provider sub-tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {PROVIDER_CONFIG.map(({ id, label, color }) => (
          <button
            key={id}
            onClick={() => setActiveProvider(id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px ${
              activeProvider === id
                ? `border-current ${BADGE[color]} border-b-2`
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* API Key + Model section */}
      <div className={`rounded-xl border-2 p-4 transition-colors ${ACCENT[cfg.color]}`}>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">{cfg.label} API Key</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Stored securely in your account. Shared across all accelerators.
        </p>
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <input
              type={showKey[cfg.id] ? 'text' : 'password'}
              value={keys[cfg.id]}
              onChange={e => setKeys(k => ({ ...k, [cfg.id]: e.target.value }))}
              placeholder={cfg.placeholder}
              className="w-full pr-10 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={() => setShowKey(s => ({ ...s, [cfg.id]: !s[cfg.id] }))}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              {showKey[cfg.id] ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
            </button>
          </div>
          <button
            onClick={handleSaveKey}
            disabled={saving}
            className={`px-4 py-2 rounded-lg font-semibold text-sm text-white transition-all disabled:opacity-60 flex-shrink-0 ${saved ? 'bg-green-500' : 'bg-indigo-600 hover:bg-indigo-700'}`}
          >
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
          </button>
        </div>

        {/* Model selection */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-600">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5 block">Model</label>
          <select
            value={models[cfg.id]}
            onChange={e => setModels(m => ({ ...m, [cfg.id]: e.target.value }))}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {MODEL_OPTIONS[cfg.id].map(opt => (
              <option key={opt.id} value={opt.id}>
                {opt.label}  ·  {opt.costHint}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
            Applied to all accelerators for this provider. Click Save to persist.
          </p>
        </div>
      </div>

      {/* Usage Stats section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Usage Statistics</h3>
          <button
            onClick={fetchStats}
            disabled={statsLoading}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
          >
            {statsLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {statsError && (
          <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400 mb-3">
            {statsError}
          </div>
        )}

        {statsLoading && !stats ? (
          <div className="flex items-center gap-2 py-6 text-slate-500 dark:text-slate-400 text-sm">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading stats…
          </div>
        ) : (
          <>
            {/* Summary tiles */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Total Calls',    value: providerSummary ? String(providerSummary.total_calls) : '0' },
                { label: 'Input Tokens',   value: providerSummary ? formatTokens(providerSummary.total_input_tokens)  : '0' },
                { label: 'Output Tokens',  value: providerSummary ? formatTokens(providerSummary.total_output_tokens) : '0' },
                { label: '~Cost',          value: providerSummary ? formatCost(providerSummary.total_cost_usd) : '$0.00' },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200 dark:border-slate-700 text-center">
                  <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{value}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Recent transactions */}
            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
              Recent Activity
            </h4>

            {providerRecent.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 py-4 text-center">
                No activity recorded yet for {cfg.label}.
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      {['Model', 'Input', 'Output', '~Cost', 'When'].map(h => (
                        <th key={h} className="text-left px-3 py-2 font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                    {providerRecent.slice(0, 10).map(row => (
                      <tr key={row.id} className="bg-white dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300 max-w-[140px] truncate" title={row.model}>{row.model}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{formatTokens(row.input_tokens)}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{formatTokens(row.output_tokens)}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{formatCost(row.cost_usd)}</td>
                        <td className="px-3 py-2 text-slate-400 dark:text-slate-500 whitespace-nowrap">{timeAgo(row.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
              * Costs are approximate based on published pricing and may differ from actual charges.
            </p>
          </>
        )}
      </div>
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
  const [users, setUsers]       = useState<DBUser[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
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

  const openAdd  = () => { setEditTarget(null); setForm({ username: '', password: '', role: 'AppUser' }); setFormError(''); setShowModal(true); };
  const openEdit = (u: DBUser) => { setEditTarget(u); setForm({ username: u.username, password: '', role: u.role }); setFormError(''); setShowModal(true); };

  const handleSave = async () => {
    if (!form.username.trim()) { setFormError('Username is required'); return; }
    if (!editTarget && !form.password) { setFormError('Password is required for new users'); return; }
    setSaving(true); setFormError('');
    try {
      const body: any = { username: form.username.trim(), role: form.role };
      if (form.password) body.password = form.password;
      const res = editTarget
        ? await fetch(`/v1/users/${editTarget.id}`, { method: 'PUT',    headers: authHeader, body: JSON.stringify(body) })
        : await fetch('/v1/users',                    { method: 'POST',   headers: authHeader, body: JSON.stringify(body) });
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

type SettingsTab = 'appearance' | 'ai' | 'users';

const SettingsPage: React.FC = () => {
  const { user, token, updatePreferences } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai');

  const tabs: { id: SettingsTab; label: string; adminOnly?: boolean }[] = [
    { id: 'ai',         label: 'AI Providers'        },
    { id: 'users',      label: 'Users', adminOnly: true },
    { id: 'appearance', label: 'Appearance'          },
  ];

  const visibleTabs = tabs.filter(t => !t.adminOnly || user?.role === 'Admin');

  return (
    <div className="max-w-5xl mx-auto">
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
      {activeTab === 'ai' && token && (
        <AiProvidersTab updatePreferences={updatePreferences} token={token} />
      )}
      {activeTab === 'users' && user?.role === 'Admin' && token && (
        <UsersTab currentUser={user} token={token} />
      )}
    </div>
  );
};

export default SettingsPage;
