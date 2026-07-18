import React, { useState, useRef, useEffect } from 'react';
import { useSettings, LLMProvider } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  gemini: 'Gemini',
  claude: 'Claude',
  openai: 'OpenAI',
};

const PROVIDER_COLORS: Record<LLMProvider, string> = {
  gemini: 'text-blue-600 dark:text-blue-400',
  claude: 'text-orange-600 dark:text-orange-400',
  openai: 'text-emerald-600 dark:text-emerald-400',
};

const PROVIDER_DESCRIPTIONS: Record<LLMProvider, string> = {
  gemini: 'Google Gemini',
  claude: 'Anthropic Claude',
  openai: 'OpenAI GPT',
};

const AiInUseIndicator: React.FC = () => {
  const { settings, saveSettings } = useSettings();
  const { updatePreferences } = useAuth();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<LLMProvider | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const hasKey = (provider: LLMProvider): boolean => {
    if (provider === 'gemini') return !!settings.geminiApiKey;
    if (provider === 'claude') return !!settings.claudeApiKey;
    return !!settings.openaiApiKey;
  };

  const handleSelect = async (provider: LLMProvider) => {
    if (provider === settings.llmProvider) { setOpen(false); return; }
    setSwitching(provider);
    saveSettings({ llmProvider: provider });
    await updatePreferences({ llmProvider: provider });
    setSwitching(null);
    setOpen(false);
  };

  const current    = settings.llmProvider;
  const currentKey = hasKey(current);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm rounded-full pl-3 pr-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        aria-label="Switch AI provider"
      >
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500 select-none">AI In Use:</span>

        {currentKey ? (
          <span className={`text-sm font-semibold ${PROVIDER_COLORS[current]}`}>
            {PROVIDER_LABELS[current]}
          </span>
        ) : (
          <span
            className="flex items-center gap-1 text-sm font-semibold text-amber-500 dark:text-amber-400"
            title="No API key configured for this provider. Set one in Settings → AI Providers."
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" clipRule="evenodd" />
            </svg>
            No Key
          </span>
        )}

        <svg
          className={`w-3 h-3 text-slate-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 z-50 py-2">
          <p className="px-4 py-1 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            Switch AI Provider
          </p>

          {(['gemini', 'claude', 'openai'] as LLMProvider[]).map((p) => {
            const isActive   = p === current;
            const isLoading  = switching === p;
            const noKey      = !hasKey(p);

            return (
              <button
                key={p}
                onClick={() => handleSelect(p)}
                disabled={!!switching}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors disabled:opacity-60 ${
                  isActive
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-semibold'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 font-medium'
                }`}
              >
                <span className="text-left">
                  <span className="block">{PROVIDER_LABELS[p]}</span>
                  <span className="block text-xs font-normal text-slate-400 dark:text-slate-500">
                    {PROVIDER_DESCRIPTIONS[p]}
                  </span>
                </span>

                <span className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                  {noKey && !isActive && (
                    <span
                      className="text-amber-500 text-xs leading-none"
                      title="No API key configured — set one in Settings"
                    >
                      ⚠
                    </span>
                  )}
                  {isLoading && (
                    <svg className="w-3.5 h-3.5 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {isActive && !isLoading && (
                    <svg className="w-3.5 h-3.5 text-indigo-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                    </svg>
                  )}
                </span>
              </button>
            );
          })}

          <div className="mx-4 mt-1.5 pt-2 border-t border-slate-100 dark:border-slate-700">
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Configure API keys in{' '}
              <span className="font-medium text-slate-500 dark:text-slate-400">Settings → AI Providers</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default AiInUseIndicator;
