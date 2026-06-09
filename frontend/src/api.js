// Minimal API + auth helpers for PulseHub doctor portal.
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;
export const WS_BASE = BACKEND_URL.replace(/^http/, "ws") + "/api";

const TOKEN_KEY = "pulsehub_jwt";
const USER_KEY = "pulsehub_user";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getStoredUser = () => {
  const raw = localStorage.getItem(USER_KEY);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};
export const setSession = (token, user) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};
export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

export const api = axios.create({ baseURL: API, timeout: 12000 });
api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export function formatApiError(err) {
  const d = err?.response?.data?.detail;
  if (!d) return err.message || "Something went wrong";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" • ");
  if (d?.msg) return d.msg;
  return String(d);
}

// Severity helpers
export const SEVERITY_ORDER = { critical: 0, warning: 1, normal: 2 };
export const severityColor = (s) => ({
  critical: "text-rose-700 bg-rose-50 border-rose-200",
  warning:  "text-amber-700 bg-amber-50 border-amber-200",
  normal:   "text-emerald-700 bg-emerald-50 border-emerald-200",
}[s] || "text-slate-600 bg-slate-50 border-slate-200");
export const severityDot = (s) => ({
  critical: "bg-rose-500",
  warning:  "bg-amber-500",
  normal:   "bg-emerald-500",
}[s] || "bg-slate-300");
