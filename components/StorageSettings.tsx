import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

type StorageProvider = 'none' | 's3' | 'azure';

const panelCls = 'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm';

const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500';

const StorageSettings: React.FC = () => {
  const { user, token, refreshUser } = useAuth();

  const [provider, setProvider] = useState<StorageProvider>('none');
  const [bucket, setBucket] = useState('');
  const [region, setRegion] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [azureConnection, setAzureConnection] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; provider?: string; bucket?: string; error?: string } | null>(null);

  useEffect(() => {
    if (user) {
      setProvider((user.storageProvider as StorageProvider) ?? 'none');
    }
  }, [user?.id]);

  const hasSaved = user?.hasStorage ?? false;

  const handleTestConnection = async () => {
    if (!token) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/v1/auth/test-storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ ok: false, error: err?.message ?? 'Request failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const body: Record<string, string> = {
        storage_provider: provider === 'none' ? '' : provider,
        storage_bucket: bucket,
        storage_region: region,
      };
      if (provider === 's3') {
        if (accessKey) body.storage_access_key = accessKey;
        if (secretKey) body.storage_secret_key = secretKey;
      } else if (provider === 'azure') {
        if (azureConnection) body.storage_azure_connection = azureConnection;
      }

      const res = await fetch('/v1/auth/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Save failed');
      }
      await refreshUser();
      setSaved(true);
      setAccessKey('');
      setSecretKey('');
      setAzureConnection('');
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg space-y-5">
      <div className={panelCls}>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Storage Provider</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Configure cloud storage for your projects. Files uploaded in Projects are stored here.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Provider</label>
            <select
              value={provider}
              onChange={e => { setProvider(e.target.value as StorageProvider); setBucket(''); setRegion(''); setAccessKey(''); setSecretKey(''); setAzureConnection(''); }}
              className={inputCls}
            >
              <option value="none">None — no storage configured</option>
              <option value="s3">Amazon S3</option>
              <option value="azure">Azure Blob Storage</option>
            </select>
          </div>

          {provider === 's3' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Bucket Name</label>
                <input type="text" value={bucket} onChange={e => setBucket(e.target.value)}
                  placeholder="my-s3-bucket" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Region</label>
                <input type="text" value={region} onChange={e => setRegion(e.target.value)}
                  placeholder="us-east-1" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                  Access Key ID
                  {hasSaved && <span className="ml-1 font-normal text-slate-400">(leave blank to keep saved key)</span>}
                </label>
                <input type="password" value={accessKey} onChange={e => setAccessKey(e.target.value)}
                  placeholder={hasSaved ? '••••• (saved)' : 'AKIAIOSFODNN7EXAMPLE'} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                  Secret Access Key
                  {hasSaved && <span className="ml-1 font-normal text-slate-400">(leave blank to keep saved key)</span>}
                </label>
                <input type="password" value={secretKey} onChange={e => setSecretKey(e.target.value)}
                  placeholder={hasSaved ? '••••• (saved)' : 'wJalrXUtnFEMI/K7MDENG/...'} className={inputCls} />
              </div>
            </>
          )}

          {provider === 'azure' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Container Name</label>
                <input type="text" value={bucket} onChange={e => setBucket(e.target.value)}
                  placeholder="my-container" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                  Connection String / SAS URL
                  {hasSaved && <span className="ml-1 font-normal text-slate-400">(leave blank to keep saved)</span>}
                </label>
                <input type="password" value={azureConnection} onChange={e => setAzureConnection(e.target.value)}
                  placeholder={hasSaved ? '••••• (saved)' : 'DefaultEndpointsProtocol=https;AccountName=...'} className={inputCls} />
              </div>
            </>
          )}
        </div>

        {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-5 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-60 ${
              saved ? 'bg-emerald-500' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Storage Settings'}
          </button>

          {hasSaved && provider !== 'none' && (
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 flex items-center gap-2 transition-all"
            >
              {testing ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Testing…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Test Connection
                </>
              )}
            </button>
          )}
        </div>

        {testResult && (
          <div className={`mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm ${
            testResult.ok
              ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400'
          }`}>
            {testResult.ok ? (
              <>
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Connected to <strong>{testResult.provider?.toUpperCase()}</strong> · bucket: <code className="font-mono text-xs">{testResult.bucket}</code></span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span>{testResult.error ?? 'Connection failed'}</span>
              </>
            )}
          </div>
        )}
      </div>

      {hasSaved && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700">
          <svg className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-emerald-700 dark:text-emerald-300">
            Storage is configured ({user?.storageProvider?.toUpperCase()}). Projects are unlocked.
          </p>
        </div>
      )}
    </div>
  );
};

export default StorageSettings;
