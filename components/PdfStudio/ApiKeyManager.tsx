import React, { useEffect, useState } from 'react';
import { PdfApiKey } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

export default function ApiKeyManager() {
  const { token } = useAuth();
  const [keys, setKeys] = useState<PdfApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newRaw, setNewRaw] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch('/v1/pdf-studio/templates/api-keys/list', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    setKeys(d.keys ?? []);
    setLoading(false);
  }

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/v1/pdf-studio/templates/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim() }),
      });
      const d = await res.json();
      setNewRaw(d.key?.raw_key ?? null);
      setName('');
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: number, keyName: string) {
    if (!confirm(`Revoke API key "${keyName}"? Any integration using it will stop working.`)) return;
    await fetch(`/v1/pdf-studio/templates/api-keys/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setKeys(prev => prev.filter(k => k.id !== id));
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const fmtDate = (s: string | null) =>
    s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';

  const renderApiInfo = () => (
    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-sm space-y-2">
      <p className="font-medium text-slate-700 dark:text-slate-300">How to use</p>
      <p className="text-slate-500 dark:text-slate-400">
        Pass the key as a Bearer token to the render endpoint:
      </p>
      <pre className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-xs overflow-x-auto text-slate-700 dark:text-slate-300">
{`curl -X POST https://your-app.vercel.app/v1/pdf-render/{templateId} \\
  -H "Authorization: Bearer dih_..." \\
  -H "Content-Type: application/json" \\
  -d '{"data": {"customerName": "Alice", "balance": "£500"}}' \\
  --output document.pdf`}
      </pre>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">API Keys</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Generate keys to call the PDF render API. Each key is shown only once.
        </p>
      </div>

      {renderApiInfo()}

      {/* New key revealed */}
      {newRaw && (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl space-y-2">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            Copy this key now — it won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 break-all">
              {newRaw}
            </code>
            <button
              onClick={() => copy(newRaw)}
              className="flex-shrink-0 px-3 py-2 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setNewRaw(null)}
            className="text-xs text-amber-600 dark:text-amber-400 hover:underline"
          >
            I've saved the key, dismiss
          </button>
        </div>
      )}

      {/* Create */}
      <div className="flex items-center gap-3">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && create()}
          placeholder="Key name (e.g. Production)"
          className="flex-1 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white"
        />
        <button
          onClick={create}
          disabled={creating || !name.trim()}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {creating ? 'Creating…' : 'Create Key'}
        </button>
      </div>

      {/* List */}
      {loading && <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>}

      {!loading && keys.length === 0 && (
        <p className="text-sm text-slate-400 dark:text-slate-500 italic">No API keys yet.</p>
      )}

      {keys.length > 0 && (
        <div className="divide-y divide-slate-100 dark:divide-slate-700 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          {keys.map(k => (
            <div key={k.id} className="flex items-center gap-4 px-4 py-3 bg-white dark:bg-slate-800">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-white">{k.name}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 font-mono mt-0.5">
                  {k.key_prefix}…
                  <span className="ml-3 text-slate-400 dark:text-slate-500 font-sans not-italic">
                    Last used: {fmtDate(k.last_used_at)}
                  </span>
                </p>
              </div>
              <button
                onClick={() => revoke(k.id, k.name)}
                className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
