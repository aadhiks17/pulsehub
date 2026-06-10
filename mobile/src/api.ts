import axios from 'axios';
import { getSecureItem, setSecureItem, deleteSecureItem } from './secureStore';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
export const API_BASE = `${BACKEND_URL}/api`;
export const WS_BASE = BACKEND_URL.replace(/^http/, 'ws') + '/api';

const TOKEN_KEY = 'pulsehub_jwt';
const USER_KEY = 'pulsehub_user';
const BIO_KEY = 'biometric_enabled';

export async function getToken(): Promise<string | null> {
  return getSecureItem(TOKEN_KEY);
}

export async function getStoredUser(): Promise<any | null> {
  const raw = await getSecureItem(USER_KEY);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setSession(token: string, user: any): Promise<void> {
  await setSecureItem(TOKEN_KEY, token);
  await setSecureItem(USER_KEY, JSON.stringify(user));
}

export async function clearSession(): Promise<void> {
  await deleteSecureItem(TOKEN_KEY);
  await deleteSecureItem(USER_KEY);
}

export async function getBiometricEnabled(): Promise<boolean> {
  const val = await getSecureItem(BIO_KEY);
  return val === 'true';
}

export async function getBiometricAsked(): Promise<boolean> {
  const val = await getSecureItem(BIO_KEY);
  return val !== null;
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await setSecureItem(BIO_KEY, enabled ? 'true' : 'false');
}

export const api = axios.create({ baseURL: API_BASE, timeout: 12000 });

api.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error?.response?.status === 401) {
      await clearSession();
    }
    return Promise.reject(error);
  },
);

export function formatApiError(err: any): string {
  const d = err?.response?.data?.detail;
  if (!d) return err.message || 'Something went wrong';
  if (typeof d === 'string') return d;
  if (Array.isArray(d))
    return d.map((e: any) => e?.msg || JSON.stringify(e)).join(' · ');
  if (d?.msg) return d.msg;
  return String(d);
}
