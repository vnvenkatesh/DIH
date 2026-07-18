import React, { createContext, useContext, useState, useEffect } from 'react';

export type Theme = 'light' | 'dark';
export type LLMProvider = 'gemini' | 'claude' | 'openai';

export interface AppSettings {
  theme: Theme;
  llmProvider: LLMProvider;
  geminiApiKey: string;
  claudeApiKey: string;
  openaiApiKey: string;
  geminiModel: string;
  claudeModel: string;
  openaiModel: string;
}

interface SettingsContextValue {
  settings: AppSettings;
  saveSettings: (partial: Partial<AppSettings>) => void;
}

export const SETTINGS_STORAGE_KEY = 'dih_settings';

const defaultSettings: AppSettings = {
  theme: 'light',
  llmProvider: 'gemini',
  geminiApiKey: '',
  claudeApiKey: '',
  openaiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  claudeModel: 'claude-haiku-4-5-20251001',
  openaiModel: 'gpt-4o-mini',
};

const SettingsContext = createContext<SettingsContextValue>({
  settings: defaultSettings,
  saveSettings: () => {},
});

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
    } catch {
      return defaultSettings;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [settings.theme]);

  const saveSettings = (partial: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...partial };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <SettingsContext.Provider value={{ settings, saveSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);
