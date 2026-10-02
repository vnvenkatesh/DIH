import React, { createContext, useContext, useState, useEffect } from 'react';

export type UserRole = 'Admin' | 'AppUser';

export interface UserPreferences {
  theme: 'light' | 'dark';
  llmProvider: 'gemini' | 'claude' | 'openai';
  geminiApiKey: string;
  claudeApiKey: string;
  openaiApiKey: string;
  geminiModel: string;
  claudeModel: string;
  openaiModel: string;
  claudeEffort: 'high' | 'medium' | 'low';
  grokApiKey: string;
  grokModel: string;
}

export interface AuthUser extends UserPreferences {
  id: number;
  username: string;
  role: UserRole;
  companyId: number | null;
  companyRole: 'admin' | 'member' | null;
  companyName: string | null;
  usesCompanyKeys: boolean;
  hasStorage: boolean;
  companyHasStorage: boolean;
  storageProvider: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  login: (username: string, password: string, company?: string) => Promise<void>;
  logout: () => void;
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>;
  refreshUser: () => Promise<void>;
  isLoading: boolean;
}

const AUTH_STORAGE_KEY = 'dih_auth';

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  login: async (_u, _p, _c?) => {},
  logout: () => {},
  updatePreferences: async () => {},
  refreshUser: async () => {},
  isLoading: true,
});

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

/** Map the snake_case server response to the camelCase AuthUser */
function deserializeUser(raw: any): AuthUser {
  return {
    id: raw.id,
    username: raw.username,
    role: raw.role,
    theme: raw.theme ?? 'light',
    llmProvider: raw.llm_provider ?? 'gemini',
    geminiApiKey: raw.gemini_api_key ?? '',
    claudeApiKey: raw.claude_api_key ?? '',
    openaiApiKey: raw.openai_api_key ?? '',
    geminiModel: raw.gemini_model ?? 'gemini-2.5-flash',
    claudeModel: raw.claude_model ?? 'claude-haiku-4-5-20251001',
    openaiModel: raw.openai_model ?? 'gpt-4o-mini',
    claudeEffort: raw.claude_effort ?? 'medium',
    grokApiKey: raw.grok_api_key ?? '',
    grokModel: raw.grok_model ?? 'grok-4.3',
    companyId: raw.company_id ?? null,
    companyRole: raw.company_role ?? null,
    companyName: raw.company_name ?? null,
    usesCompanyKeys: raw.uses_company_keys ?? false,
    hasStorage: raw.has_storage ?? false,
    companyHasStorage: raw.company_has_storage ?? false,
    storageProvider: raw.storage_provider ?? null,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const { user: u, token: t } = JSON.parse(stored);
        if (!isTokenExpired(t)) {
          setUser(u);
          setToken(t);
        } else {
          localStorage.removeItem(AUTH_STORAGE_KEY);
        }
      }
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
    setIsLoading(false);
  }, []);

  const login = async (username: string, password: string, company?: string): Promise<void> => {
    let res: Response;
    try {
      res = await fetch('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, ...(company?.trim() ? { company: company.trim() } : {}) }),
      });
    } catch (networkErr: any) {
      console.error('[login] Network error:', networkErr);
      throw new Error('Cannot reach the server. Make sure the API server is running (npm run dev).');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[login] HTTP', res.status, text);
      let message = `Server error (${res.status})`;
      try { message = JSON.parse(text).error || message; } catch { /* not JSON */ }
      throw new Error(message);
    }
    const { token: t, user: rawUser } = await res.json();
    const u = deserializeUser(rawUser);
    setUser(u);
    setToken(t);
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: u, token: t }));
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  };

  const refreshUser = async (): Promise<void> => {
    if (!token) return;
    try {
      const res = await fetch('/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const { user: rawUser } = await res.json();
      const u = deserializeUser(rawUser);
      setUser(u);
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: u, token }));
    } catch { /* ignore */ }
  };

  const updatePreferences = async (prefs: Partial<UserPreferences>): Promise<void> => {
    if (!token) return;
    const body: Record<string, string> = {};
    if (prefs.theme !== undefined) body.theme = prefs.theme;
    if (prefs.llmProvider !== undefined) body.llm_provider = prefs.llmProvider;
    if (prefs.geminiApiKey !== undefined) body.gemini_api_key = prefs.geminiApiKey;
    if (prefs.claudeApiKey !== undefined) body.claude_api_key = prefs.claudeApiKey;
    if (prefs.openaiApiKey !== undefined) body.openai_api_key = prefs.openaiApiKey;
    if (prefs.geminiModel !== undefined) body.gemini_model = prefs.geminiModel;
    if (prefs.claudeModel !== undefined) body.claude_model = prefs.claudeModel;
    if (prefs.openaiModel !== undefined) body.openai_model = prefs.openaiModel;
    if (prefs.claudeEffort !== undefined) body.claude_effort = prefs.claudeEffort;
    if (prefs.grokApiKey   !== undefined) body.grok_api_key  = prefs.grokApiKey;
    if (prefs.grokModel    !== undefined) body.grok_model    = prefs.grokModel;

    const res = await fetch('/v1/auth/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    const { user: rawUser } = await res.json();
    const updated = deserializeUser(rawUser);
    setUser(updated);
    // Keep localStorage in sync
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: updated, token }));
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, updatePreferences, refreshUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
