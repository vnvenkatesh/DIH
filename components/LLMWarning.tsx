import React from 'react';
import { useSettings } from '../contexts/SettingsContext';

interface LLMWarningProps {
  onGoToSettings: () => void;
}

const LLMWarning: React.FC<LLMWarningProps> = ({ onGoToSettings }) => {
  const { settings } = useSettings();

  const provider = settings.llmProvider;
  const hasKey =
    provider === 'gemini'
      ? Boolean(settings.geminiApiKey || process.env.API_KEY)
      : Boolean(settings.claudeApiKey);

  if (hasKey) return null;

  const providerLabel = provider === 'gemini' ? 'Google Gemini' : 'Anthropic Claude';
  const keyLabel = provider === 'gemini' ? 'Gemini API key' : 'Claude API key';

  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 px-4 py-3.5">
      <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          LLM not configured — this tool requires an API key
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
          You have <strong>{providerLabel}</strong> selected but no {keyLabel} has been set.
          Add your key in Settings before using this accelerator.
        </p>
      </div>
      <button
        onClick={onGoToSettings}
        className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors"
      >
        Go to Settings
      </button>
    </div>
  );
};

export default LLMWarning;
