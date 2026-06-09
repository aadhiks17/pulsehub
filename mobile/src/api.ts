import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
export const API_BASE = `${BACKEND_URL}/api`;
export const WS_BASE = BACKEND_URL.replace(/^http/, 'ws') + '/api';

const TOKEN_KEY = 'pulsehub_jwt';
const USER_KEY = 'pulsehub_user';

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function getStoredUser(): Promise<any | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setSession(token: string, user: any): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY);
  await AsyncStorage.removeItem(USER_KEY);
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
