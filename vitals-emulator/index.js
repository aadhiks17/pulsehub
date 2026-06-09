/**
 * PulseHub Vitals Emulator
 *
 * Streams realistic CGM (glucose) + PulseOx (HR/SpO2) readings to the backend's
 * POST /api/vitals endpoint for every seeded patient. Exposes an HTTP control
 * surface on PORT (default 9001) to inject anomalies for demo/testing.
 */

require("dotenv").config();
// Also try the backend's .env (which is where the auto-generated EMULATOR_PASSWORD lives)
require("dotenv").config({ path: "/app/backend/.env" });
const axios = require("axios");
const express = require("express");

// ---- config ----
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8001";
const EMULATOR_EMAIL = process.env.EMULATOR_EMAIL || "emulator@pulsehub.system";
const EMULATOR_PASSWORD = process.env.EMULATOR_PASSWORD; // injected by supervisor env
const CONTROL_PORT = parseInt(process.env.CONTROL_PORT || "9001", 10);
const CGM_INTERVAL_MS = parseInt(process.env.CGM_INTERVAL_MS || "5000", 10);
const PULSEOX_INTERVAL_MS = parseInt(process.env.PULSEOX_INTERVAL_MS || "10000", 10);

if (!EMULATOR_PASSWORD) {
  console.error("[emulator] FATAL: EMULATOR_PASSWORD not set. Backend must seed it on startup.");
  process.exit(1);
}

const log = (...args) => console.log(new Date().toISOString(), "[emulator]", ...args);

// ---- HTTP client with bearer-token auto-refresh ----
let TOKEN = null;
const http = axios.create({ baseURL: BACKEND_URL, timeout: 10_000 });
http.interceptors.request.use((cfg) => {
  if (TOKEN) cfg.headers.Authorization = `Bearer ${TOKEN}`;
  return cfg;
});

async function login() {
  const res = await http.post("/api/auth/login", {
    email: EMULATOR_EMAIL,
    password: EMULATOR_PASSWORD,
  });
  TOKEN = res.data.access_token;
  log(`logged in as ${res.data.user.email} (role=${res.data.user.role})`);
}

async function safePost(path, body) {
  try {
    return await http.post(path, body);
  } catch (e) {
    if (e.response && e.response.status === 401) {
      log("token expired, re-logging in");
      await login();
      return http.post(path, body);
    }
    throw e;
  }
}

// ---- patient state ----
const state = {
  patients: [],          // [{id, full_name, ...}]
  glucoseBaseline: {},   // patientId -> current glucose baseline (random walk)
  hrBaseline: {},
  spo2Baseline: {},
  anomalyQueue: {},      // patientId -> [{metric, value}]
  lastReading: {},       // patientId -> { metric: {value, severity, recorded_at} }
  startedAt: new Date().toISOString(),
};

function pushAnomaly(patientId, metric, value) {
  if (!state.anomalyQueue[patientId]) state.anomalyQueue[patientId] = [];
  state.anomalyQueue[patientId].push({ metric, value });
}

function popAnomaly(patientId, metric) {
  const q = state.anomalyQueue[patientId] || [];
  const idx = q.findIndex((a) => a.metric === metric);
  if (idx < 0) return null;
  const [a] = q.splice(idx, 1);
  return a.value;
}

// ---- stream helpers ----
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function jitter(amplitude) { return (Math.random() * 2 - 1) * amplitude; }

function nextGlucose(patientId) {
  const forced = popAnomaly(patientId, "glucose");
  if (forced !== null) return forced;
  let base = state.glucoseBaseline[patientId] ?? 105;
  // random walk + mild sinusoidal "meal" drift over a 10-minute cycle
  const mealCycle = Math.sin(Date.now() / 1000 / 60 / 5) * 12;
  base = base + jitter(3);
  state.glucoseBaseline[patientId] = clamp(base, 80, 160);
  return Math.round(state.glucoseBaseline[patientId] + mealCycle + jitter(4));
}

function nextHR(patientId) {
  const forced = popAnomaly(patientId, "hr");
  if (forced !== null) return forced;
  let base = state.hrBaseline[patientId] ?? 72;
  base = base + jitter(2);
  state.hrBaseline[patientId] = clamp(base, 60, 95);
  return Math.round(state.hrBaseline[patientId] + jitter(3));
}

function nextSpO2(patientId) {
  const forced = popAnomaly(patientId, "spo2");
  if (forced !== null) return forced;
  let base = state.spo2Baseline[patientId] ?? 97;
  base = base + jitter(0.4);
  state.spo2Baseline[patientId] = clamp(base, 95, 99);
  return Math.round(state.spo2Baseline[patientId]);
}

async function sendVital(patient, device, metric, value) {
  try {
    const { data } = await safePost("/api/vitals", {
      patient_id: patient.id,
      device,
      metric,
      value,
    });
    if (!state.lastReading[patient.id]) state.lastReading[patient.id] = {};
    state.lastReading[patient.id][metric] = {
      value,
      severity: data.severity,
      recorded_at: data.recorded_at,
    };
    if (data.severity !== "normal") {
      log(`! ${patient.full_name} ${metric}=${value} (${data.severity})`);
    }
  } catch (e) {
    log(`POST /api/vitals failed for ${patient.id} ${metric}: ${e.message}`);
  }
}

async function refreshPatients() {
  const { data } = await http.get("/api/patients");
  state.patients = data.map((p) => ({ id: p.id, full_name: p.full_name, email: p.email }));
  log(`tracking ${state.patients.length} patients`);
}

// ---- main loop ----
async function start() {
  await login();
  await refreshPatients();

  setInterval(async () => {
    for (const p of state.patients) {
      const v = nextGlucose(p.id);
      await sendVital(p, "cgm", "glucose", v);
    }
  }, CGM_INTERVAL_MS);

  setInterval(async () => {
    for (const p of state.patients) {
      const hr = nextHR(p.id);
      const spo2 = nextSpO2(p.id);
      await sendVital(p, "pulseox", "hr", hr);
      await sendVital(p, "pulseox", "spo2", spo2);
    }
  }, PULSEOX_INTERVAL_MS);

  // re-sync patient list every 5 minutes (in case admin adds a doctor/patient)
  setInterval(() => refreshPatients().catch((e) => log("refresh failed:", e.message)), 5 * 60_000);
}

// ---- HTTP control surface ----
const app = express();
app.use(express.json());

app.get("/status", (_req, res) => {
  res.json({
    started_at: state.startedAt,
    backend_url: BACKEND_URL,
    patients: state.patients.length,
    cadence_ms: { cgm: CGM_INTERVAL_MS, pulseox: PULSEOX_INTERVAL_MS },
    last_reading: state.lastReading,
    anomaly_queue: state.anomalyQueue,
  });
});

const ANOMALIES = {
  hypo:          { metric: "glucose", value: 38 },
  hyper:         { metric: "glucose", value: 320 },
  hypoxia:       { metric: "spo2",    value: 84 },
  bradycardia:   { metric: "hr",      value: 32 },
  tachycardia:   { metric: "hr",      value: 145 },
};

app.post("/trigger/:patientId/:kind", (req, res) => {
  const { patientId, kind } = req.params;
  const a = ANOMALIES[kind];
  if (!a) return res.status(400).json({ error: `unknown anomaly '${kind}'` });
  const found = state.patients.find((p) => p.id === patientId);
  if (!found) return res.status(404).json({ error: `unknown patient '${patientId}'` });
  pushAnomaly(patientId, a.metric, a.value);
  log(`queued anomaly ${kind} (${a.metric}=${a.value}) for ${patientId}`);
  res.json({ queued: true, patient_id: patientId, kind, ...a });
});

app.listen(CONTROL_PORT, "0.0.0.0", () => log(`control surface on :${CONTROL_PORT}`));

start().catch((e) => {
  console.error("[emulator] startup failed:", e.message);
  process.exit(1);
});
