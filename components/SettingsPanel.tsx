import React, { useState } from 'react';
import { useSettings, Theme, LLMProvider } from '../contexts/SettingsContext';

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

const GearIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
  </svg>
);

const SettingsPanel: React.FC = () => {
  const { settings, saveSettings } = useSettings();
  const [isOpen, setIsOpen] = useState(false);

  const [draftProvider, setDraftProvider] = useState<LLMProvider>(settings.llmProvider);
  const [draftGeminiKey, setDraftGeminiKey] = useState(settings.geminiApiKey || process.env.API_KEY || '');
  const [draftClaudeKey, setDraftClaudeKey] = useState(settings.claudeApiKey);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showClaudeKey, setShowClaudeKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleOpen = () => {
    setDraftProvider(settings.llmProvider);
    setDraftGeminiKey(settings.geminiApiKey || process.env.API_KEY || '');
    setDraftClaudeKey(settings.claudeApiKey);
    setShowGeminiKey(false);
    setShowClaudeKey(false);
    setSaved(false);
    setIsOpen(true);
  };

  const handleThemeChange = (theme: Theme) => {
    saveSettings({ theme });
  };

  const handleSave = () => {
    saveSettings({
      llmProvider: draftProvider,
      geminiApiKey: draftGeminiKey,
      claudeApiKey: draftClaudeKey,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700 transition-colors"
        title="Settings"
        aria-label="Open settings"
      >
        <GearIcon className="w-6 h-6" />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />
          <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Settings</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Theme */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">Theme</h3>
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

            <div className="border-t border-slate-200 dark:border-slate-700 mb-6" />

            {/* LLM Provider */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">LLM Provider</h3>
              <div className="space-y-3">
                {/* Gemini */}
                <div className={`p-3 rounded-lg border-2 transition-all ${
                  draftProvider === 'gemini'
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                    : 'border-slate-200 dark:border-slate-600'
                }`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="llm"
                      value="gemini"
                      checked={draftProvider === 'gemini'}
                      onChange={() => setDraftProvider('gemini')}
                      className="w-4 h-4 accent-indigo-600"
                    />
                    <span className="font-medium text-slate-700 dark:text-slate-200">Google Gemini</span>
                  </label>
                  {draftProvider === 'gemini' && (
                    <div className="relative mt-2">
                      <input
                        type={showGeminiKey ? 'text' : 'password'}
                        value={draftGeminiKey}
                        onChange={(e) => setDraftGeminiKey(e.target.value)}
                        placeholder="Gemini API key (leave blank to use env key)"
                        className="w-full pr-10 px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGeminiKey(v => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        aria-label={showGeminiKey ? 'Hide key' : 'Show key'}
                      >
                        {showGeminiKey ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                      </button>
                    </div>
                  )}
                </div>

                {/* Claude */}
                <div className={`p-3 rounded-lg border-2 transition-all ${
                  draftProvider === 'claude'
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                    : 'border-slate-200 dark:border-slate-600'
                }`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="llm"
                      value="claude"
                      checked={draftProvider === 'claude'}
                      onChange={() => setDraftProvider('claude')}
                      className="w-4 h-4 accent-indigo-600"
                    />
                    <span className="font-medium text-slate-700 dark:text-slate-200">Anthropic Claude</span>
                  </label>
                  {draftProvider === 'claude' && (
                    <div className="relative mt-2">
                      <input
                        type={showClaudeKey ? 'text' : 'password'}
                        value={draftClaudeKey}
                        onChange={(e) => setDraftClaudeKey(e.target.value)}
                        placeholder="Claude API key (sk-ant-...)"
                        className="w-full pr-10 px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowClaudeKey(v => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        aria-label={showClaudeKey ? 'Hide key' : 'Show key'}
                      >
                        {showClaudeKey ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={handleSave}
              className={`w-full py-2.5 px-4 rounded-lg font-semibold text-white transition-all duration-200 ${
                saved
                  ? 'bg-green-500'
                  : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800'
              }`}
            >
              {saved ? 'Saved!' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default SettingsPanel;
