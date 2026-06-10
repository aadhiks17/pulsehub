import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  api,
  clearSession,
  getToken,
  setSession,
  getBiometricEnabled,
} from './api';

interface User {
  _id: string;
  id?: string;
  email: string;
  full_name: string;
  role: string;
  premium?: boolean;
  [key: string]: any;
}

interface AuthContextType {
  user: User | null;
  bootstrapping: boolean;
  biometricPending: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  completeBiometric: (success: boolean) => Promise<void>;
}

const AuthCtx = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [biometricPending, setBiometricPending] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) {
        setBootstrapping(false);
        return;
      }

      const bioEnabled = await getBiometricEnabled();
      if (bioEnabled) {
        setBiometricPending(true);
        setBootstrapping(false);
        return;
      }

      try {
        const { data } = await api.get('/auth/me');
        setUser(data);
        await setSession(token, data);
      } catch {
        await clearSession();
        setUser(null);
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  const completeBiometric = useCallback(async (success: boolean) => {
    setBiometricPending(false);
    if (!success) return;
    const token = await getToken();
    if (!token) return;
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
      await setSession(token, data);
    } catch {
      await clearSession();
    }
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const { data } = await api.post('/auth/login', { email, password });
    await setSession(data.access_token, data.user);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await clearSession();
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider
      value={{ user, bootstrapping, biometricPending, login, logout, completeBiometric }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
