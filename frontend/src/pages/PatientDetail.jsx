import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Scatter, ComposedChart } from "recharts";
import { api, getToken, WS_BASE, severityColor, severityDot, formatApiError } from "../api";
import { useVitalsWS } from "../useVitalsWS";
import { useAuth } from "../AuthContext";
import ConnectionPill from "../components/ConnectionPill";

const METRICS = [
  { key: "glucose", label: "Glucose",   unit: "mg/dL", bands: [70, 180],  domain: [40, 300] },
  { key: "hr",      label: "Heart Rate",unit: "bpm",   bands: [50, 120],  domain: [30, 160] },
  { key: "spo2",    label: "SpO₂",      unit: "%",     bands: [90],       domain: [80, 100] },
];

function severityFor(metricKey, value) {
  if (metricKey === "glucose") {
    if (value < 54 || value > 250) return "critical";
    if (value <= 70 || value > 180) return "warning";
    return "normal";
  }
  if (metricKey === "hr") {
    if (value < 40 || value > 120) return "critical";
    if (value <= 50 || value > 100) return "warning";
    return "normal";
  }
  if (metricKey === "spo2") {
    if (value < 90) return "critical";
    if (value < 95) return "warning";
    return "normal";
  }
  return "normal";
}

function MetricChart({ metric, points }) {
  const sevColor = { critical: "#e11d48", warning: "#d97706", normal: "#0f766e" };
  const data = points.map((p) => ({
    t: new Date(p.recorded_at).getTime(),
    label: new Date(p.recorded_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    value: p.value,
    severity: p.severity || severityFor(metric.key, p.value),
  }));
  const last = data.at(-1);
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5" data-testid={`chart-${metric.key}`}>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">{metric.label}</div>
          <div className="text-2xl font-semibold font-mono">
            {last ? Math.round(last.value) : "—"} <span className="text-sm text-slate-400 font-normal">{metric.unit}</span>
          </div>
        </div>
        {last && (
          <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${severityColor(last.severity)}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${severityDot(last.severity)}`} />{last.severity}
          </span>
        )}
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
            <XAxis dataKey="label" hide />
            <YAxis domain={metric.domain} tick={{ fontSize: 10, fill: "#64748b" }} width={36} />
            {metric.bands.map((b) => (
              <ReferenceLine key={b} y={b} stroke="#cbd5e1" strokeDasharray="3 3" />
            ))}
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e2e8f0" }}
              formatter={(v) => [`${Math.round(v)} ${metric.unit}`, metric.label]}
              labelFormatter={(l) => l}
            />
            <Line type="monotone" dataKey="value" stroke="#0f172a" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            <Scatter dataKey="value" shape={(props) => {
              const { cx, cy, payload } = props;
              return <circle cx={cx} cy={cy} r={2.5} fill={sevColor[payload.severity] || "#0f766e"} />;
            }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PrescriptionPanel({ patientId, doctorRole }) {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ drug: "", dosage: "", frequency: "", notes: "" });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const refresh = () => api.get(`/prescriptions/${patientId}`).then((r) => setList(r.data));
  useEffect(() => { refresh(); }, [patientId]);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setPending(true);
    try {
      await api.post("/prescriptions", { patient_id: patientId, ...form });
      setForm({ drug: "", dosage: "", frequency: "", notes: "" });
      setOpen(false);
      refresh();
    } catch (e) { setError(formatApiError(e)); }
    finally { setPending(false); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5" data-testid="prescription-panel">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold tracking-tight">Prescriptions</div>
        {doctorRole === "doctor" && (
          <button onClick={() => setOpen(!open)} data-testid="rx-new-btn"
            className="text-xs px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50">
            {open ? "Cancel" : "+ New"}
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} data-testid="rx-form" className="grid grid-cols-2 gap-2 mb-4 text-sm">
          <input className="px-2 py-1.5 border border-slate-200 rounded col-span-2"
            placeholder="Drug name" required value={form.drug} data-testid="rx-drug"
            onChange={(e) => setForm({ ...form, drug: e.target.value })} />
          <input className="px-2 py-1.5 border border-slate-200 rounded"
            placeholder="Dosage (e.g. 500mg)" required value={form.dosage} data-testid="rx-dosage"
            onChange={(e) => setForm({ ...form, dosage: e.target.value })} />
          <input className="px-2 py-1.5 border border-slate-200 rounded"
            placeholder="Frequency (e.g. BID)" required value={form.frequency} data-testid="rx-frequency"
            onChange={(e) => setForm({ ...form, frequency: e.target.value })} />
          <input className="px-2 py-1.5 border border-slate-200 rounded col-span-2"
            placeholder="Notes (optional)" value={form.notes} data-testid="rx-notes"
            onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          {error && <div className="col-span-2 text-xs text-rose-700">{error}</div>}
          <button type="submit" disabled={pending} data-testid="rx-submit"
            className="col-span-2 bg-slate-900 text-white py-1.5 rounded text-sm hover:bg-slate-800 disabled:opacity-60">
            {pending ? "Saving…" : "Issue prescription"}
          </button>
        </form>
      )}

      <ul className="space-y-2">
        {list.map((rx) => (
          <li key={rx._id} className="text-sm border border-slate-100 rounded-md p-3 bg-slate-50/50" data-testid={`rx-item-${rx._id}`}>
            <div className="flex items-center justify-between">
              <div className="font-medium">{rx.drug} <span className="text-slate-500 font-normal">{rx.dosage}</span></div>
              <div className="text-xs text-slate-400">{new Date(rx.issued_at).toLocaleDateString()}</div>
            </div>
            <div className="text-xs text-slate-500">{rx.frequency}{rx.notes ? ` · ${rx.notes}` : ""}</div>
          </li>
        ))}
        {list.length === 0 && <li className="text-sm text-slate-400">No prescriptions yet.</li>}
      </ul>
    </div>
  );
}

function ChatPanel({ patientId, currentUser, patient }) {
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const wsRef = useRef(null);
  const endRef = useRef(null);

  // resolve canonical thread
  useEffect(() => {
    api.get(`/chat/threads/by-patient/${patientId}`).then((r) => setThread(r.data));
  }, [patientId]);

  // load history
  useEffect(() => {
    if (!thread) return;
    api.get(`/chat/threads/${thread.thread_id}/messages?limit=200`).then((r) => setMessages(r.data));
  }, [thread]);

  // open WS
  useEffect(() => {
    if (!thread) return;
    const url = `${WS_BASE}/ws/chat/${encodeURIComponent(thread.thread_id)}?token=${encodeURIComponent(getToken())}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "message") {
          setMessages((cur) => {
            if (cur.some((m) => m.id === msg.id)) return cur;
            return [...cur, {
              id: msg.id, sender_id: msg.sender_id, content: msg.content, created_at: msg.created_at,
            }];
          });
        }
      } catch (err) {
        console.warn("[ChatPanel] failed to parse WS message", err);
      }
    };
    return () => { if (ws.readyState === WebSocket.OPEN) ws.close(); };
  }, [thread]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = (e) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const recipient_id = currentUser._id === patient.assigned_doctor_id ? patientId : patient.assigned_doctor_id;
    wsRef.current.send(JSON.stringify({ content, recipient_id }));
    setDraft("");
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg flex flex-col h-96" data-testid="chat-panel">
      <div className="px-4 py-2.5 border-b border-slate-100 font-semibold tracking-tight">Secure Chat</div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.map((m) => {
          const mine = m.sender_id === currentUser._id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div data-testid={`chat-msg-${m.id}`}
                className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                  mine ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900"
                }`}>
                <div>{m.content}</div>
                <div className={`text-[10px] mt-1 ${mine ? "text-slate-300" : "text-slate-500"}`}>
                  {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && <div className="text-sm text-slate-400">No messages yet. Say hello.</div>}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="border-t border-slate-100 p-2 flex gap-2" data-testid="chat-form">
        <input
          value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          data-testid="chat-input"
          className="flex-1 px-3 py-1.5 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <button type="submit" data-testid="chat-send-btn" className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-800">Send</button>
      </form>
    </div>
  );
}

function VideoPanel() {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5" data-testid="video-panel">
      <div className="font-semibold tracking-tight mb-3">Video Consult</div>
      <div className="aspect-video bg-slate-900 rounded-md grid place-items-center text-slate-400 text-sm">
        Camera off
      </div>
      <button disabled data-testid="video-start-btn"
        className="mt-3 w-full bg-slate-200 text-slate-500 rounded-md py-2 text-sm cursor-not-allowed">
        Start Call — Coming soon (WebRTC integration pending)
      </button>
    </div>
  );
}

export default function PatientDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [series, setSeries] = useState({ glucose: [], hr: [], spo2: [] });
  const [error, setError] = useState("");

  // load profile + 7d series for each metric
  useEffect(() => {
    let cancelled = false;
    const from = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const to = new Date().toISOString();

    api.get(`/patients/${id}`).then((r) => { if (!cancelled) setProfile(r.data); }).catch((e) => setError(formatApiError(e)));
    Promise.all(METRICS.map((m) => api.get(`/vitals/${id}?metric=${m.key}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=2000`)))
      .then(([g, h, s]) => { if (!cancelled) setSeries({ glucose: g.data, hr: h.data, spo2: s.data }); })
      .catch((e) => setError(formatApiError(e)));
    return () => { cancelled = true; };
  }, [id]);

  // live updates: per-patient WS
  const { status } = useVitalsWS({
    patientId: id,
    onEvent: (ev) => {
      setSeries((cur) => {
        const k = ev.metric;
        if (!cur[k]) return cur;
        const point = { recorded_at: ev.recorded_at, value: ev.value, severity: ev.severity };
        const last = cur[k].at(-1);
        if (last && last.recorded_at === point.recorded_at) return cur;
        return { ...cur, [k]: [...cur[k], point].slice(-500) };
      });
    },
  });

  return (
    <div data-testid="patient-page">
      <Link to="/triage" className="text-sm text-slate-500 hover:text-slate-900" data-testid="patient-back">← Back to triage</Link>

      <div className="flex items-end justify-between mt-3 mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="patient-name">{profile?.profile?.full_name || "Loading…"}</h1>
          <div className="text-sm text-slate-500 mt-1">
            {profile?.profile?.email}
            {profile?.profile?.premium ? " · premium" : ""}
            {profile?.risk_level && (
              <span className={`ml-3 inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${severityColor(profile.risk_level)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${severityDot(profile.risk_level)}`} />{profile.risk_level}
              </span>
            )}
          </div>
        </div>
        <ConnectionPill status={status} />
      </div>

      {error && <div className="mb-4 text-sm rounded-md border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {METRICS.map((m) => <MetricChart key={m.key} metric={m} points={series[m.key]} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1"><PrescriptionPanel patientId={id} doctorRole={user?.role} /></div>
        <div className="lg:col-span-1"><ChatPanel patientId={id} currentUser={user} patient={profile?.profile || {}} /></div>
        <div className="lg:col-span-1"><VideoPanel /></div>
      </div>
    </div>
  );
}
