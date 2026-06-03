import React, { createContext, useContext, useState, useEffect } from 'react';

export type UserRole = 'Admin' | 'AppUser';

export interface UserPreferences {
  theme: 'light' | 'dark';
  llmProvider: 'gemini' | 'claude';
  geminiApiKey: string;
  claudeApiKey: string;
}

export interface AuthUser extends UserPreferences {
  id: number;
  username: string;
  role: UserRole;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>;
  isLoading: boolean;
}

const AUTH_STORAGE_KEY = 'dih_auth';

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  login: async () => {},
  logout: () => {},
  updatePreferences: async () => {},
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

  const login = async (username: string, password: string): Promise<void> => {
    let res: Response;
    try {
      res = await fetch('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
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

  const updatePreferences = async (prefs: Partial<UserPreferences>): Promise<void> => {
    if (!token) return;
    const body: Record<string, string> = {};
    if (prefs.theme !== undefined) body.theme = prefs.theme;
    if (prefs.llmProvider !== undefined) body.llm_provider = prefs.llmProvider;
    if (prefs.geminiApiKey !== undefined) body.gemini_api_key = prefs.geminiApiKey;
    if (prefs.claudeApiKey !== undefined) body.claude_api_key = prefs.claudeApiKey;

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
    <AuthContext.Provider value={{ user, token, login, logout, updatePreferences, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
