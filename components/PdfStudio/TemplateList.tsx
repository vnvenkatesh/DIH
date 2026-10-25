import React, { useEffect, useState } from 'react';
import { PdfTemplate } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

interface Props {
  onNew: () => void;
  onEdit: (t: PdfTemplate) => void;
  onOpenFetchDoc?: (init: { url: string; bearerToken: string; jsonBody: string }) => void;
}

export default function TemplateList({ onNew, onEdit, onOpenFetchDoc }: Props) {
  const { token } = useAuth();
  const [templates, setTemplates] = useState<PdfTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/v1/pdf-studio/templates', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setTemplates(data.templates ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete template "${name}"?`)) return;
    try {
      await fetch(`/v1/pdf-studio/templates/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch (e: any) {
      alert('Delete failed: ' + e.message);
    }
  }

  async function handleFetchDoc(t: PdfTemplate) {
    if (!onOpenFetchDoc) return;
    const url = `${window.location.origin}/v1/pdf-render/${encodeURIComponent(t.name)}`;
    let bearerToken = '<Your DIH API key here>';
    let jsonBody = JSON.stringify({ data: {} }, null, 2);
    try {
      const [keysRes, tplRes] = await Promise.all([
        fetch('/v1/pdf-studio/api-keys/list', { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/v1/pdf-studio/templates/${t.id}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const keysData = await keysRes.json();
      if (keysData.keys?.length > 0) bearerToken = keysData.keys[0].key_prefix;
      const tplData = await tplRes.json();
      const payloadFields: Record<string, string> = {};
      (tplData.fields ?? []).forEach((f: { field_name: string; default_value: string }) => {
        payloadFields[f.field_name] = f.default_value || '';
      });
      jsonBody = JSON.stringify({ data: payloadFields }, null, 2);
    } catch { /* keep defaults */ }
    onOpenFetchDoc({ url, bearerToken, jsonBody });
  }

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Templates</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Your private PDF templates — upload a DOCX to get started.
          </p>
        </div>
        <button
          onClick={onNew}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Template
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-slate-400 dark:text-slate-500">
          <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Loading templates…
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/30 rounded-lg text-red-700 dark:text-red-300 text-sm">{error}</div>
      )}

      {!loading && !error && templates.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg className="w-16 h-16 text-slate-200 dark:text-slate-700 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-1">No templates yet</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Upload a Word document to create your first PDF template.
          </p>
          <button
            onClick={onNew}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            Create Template
          </button>
        </div>
      )}

      {!loading && templates.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map(t => (
            <div
              key={t.id}
              className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 flex items-center justify-center">
                    <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </span>
                  <h3 className="font-semibold text-slate-800 dark:text-white text-sm truncate">{t.name}</h3>
                </div>
                <span className="flex-shrink-0 px-2 py-0.5 text-xs rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  {t.original_format}
                </span>
              </div>

              {t.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 line-clamp-2">{t.description}</p>
              )}

              <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">Updated {formatDate(t.updated_at)}</p>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => onEdit(t)}
                  className="flex-1 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                >
                  Edit
                </button>
                {onOpenFetchDoc && (
                  <button
                    onClick={() => void handleFetchDoc(t)}
                    className="px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                    title="Open in Fetch Doc"
                  >
                    Fetch Doc
                  </button>
                )}
                <button
                  onClick={() => handleDelete(t.id, t.name)}
                  className="px-3 py-1.5 text-xs font-medium text-red-500 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
