import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, SEVERITY_ORDER, severityColor, severityDot } from "../api";
import { useVitalsWS } from "../useVitalsWS";
import ConnectionPill from "../components/ConnectionPill";

const METRICS = ["glucose", "hr", "spo2"];
const METRIC_LABEL = { glucose: "Glucose", hr: "HR", spo2: "SpO₂" };
const METRIC_UNIT  = { glucose: "mg/dL",   hr: "bpm", spo2: "%" };

function computeRisk(latest) {
  let worst = "normal";
  for (const m of METRICS) {
    const s = latest?.[m]?.severity;
    if (s && SEVERITY_ORDER[s] < SEVERITY_ORDER[worst]) worst = s;
  }
  return worst;
}

export default function Triage() {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [flashing, setFlashing] = useState({}); // patientId -> ts
  const [tick, setTick] = useState(0);          // forces re-render of recency
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api.get("/patients")
      .then((r) => { if (!cancelled) setPatients(r.data); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.detail || e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // expire flash highlight + jiggle "last-update" labels every 2s
  useEffect(() => {
    const t = setInterval(() => {
      setTick((x) => x + 1);
      setFlashing((cur) => {
        const now = Date.now();
        const next = {};
        for (const [k, v] of Object.entries(cur)) if (now - v < 3000) next[k] = v;
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const { status } = useVitalsWS({
    onEvent: (ev) => {
      setPatients((cur) => {
        const idx = cur.findIndex((p) => p.id === ev.patient_id);
        if (idx < 0) return cur;
        const p = cur[idx];
        const nextLatest = { ...(p.latest || {}), [ev.metric]: {
          value: ev.value, unit: ev.unit, severity: ev.severity, recorded_at: ev.recorded_at,
        }};
        const nextP = { ...p, latest: nextLatest, risk_level: computeRisk(nextLatest), _last_update: Date.now() };
        const next = [...cur];
        next[idx] = nextP;
        return next;
      });
      if (ev.severity === "critical") {
        setFlashing((cur) => ({ ...cur, [ev.patient_id]: Date.now() }));
      }
    },
  });

  const filtered = useMemo(() => {
    let list = patients.slice();
    if (search) list = list.filter((p) => p.full_name.toLowerCase().includes(search.toLowerCase()));
    if (riskFilter !== "all") list = list.filter((p) => p.risk_level === riskFilter);
    list.sort((a, b) => {
      const r = SEVERITY_ORDER[a.risk_level] - SEVERITY_ORDER[b.risk_level];
      if (r !== 0) return r;
      return (b._last_update || 0) - (a._last_update || 0);
    });
    return list;
  }, [patients, search, riskFilter, tick]);

  const counts = useMemo(() => {
    const c = { critical: 0, warning: 0, normal: 0 };
    patients.forEach((p) => { c[p.risk_level] = (c[p.risk_level] || 0) + 1; });
    return c;
  }, [patients]);

  const fmtTime = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (diff < 60) return `${Math.round(diff)}s ago`;
    if (diff < 3600) return `${Math.round(diff/60)}m ago`;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div data-testid="triage-page">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="triage-title">Triage</h1>
          <p className="text-sm text-slate-500 mt-1">Live vitals across your assigned patients.</p>
        </div>
        <ConnectionPill status={status} />
      </div>

      {/* summary chips */}
      <div className="flex gap-2 mb-5">
        {[
          ["all",      `All ${patients.length}`],
          ["critical", `Critical ${counts.critical}`],
          ["warning",  `Warning ${counts.warning}`],
          ["normal",   `Normal ${counts.normal}`],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setRiskFilter(k)}
            data-testid={`triage-filter-${k}`}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              riskFilter === k
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patient name…"
          data-testid="triage-search"
          className="text-sm px-3 py-1.5 border border-slate-200 rounded-md bg-white w-64"
        />
      </div>

      {loading && <div className="text-sm text-slate-500">Loading patients…</div>}
      {error && <div className="text-sm rounded-md border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden" data-testid="triage-table">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5">Patient</th>
              <th className="text-left px-4 py-2.5">Risk</th>
              <th className="text-left px-4 py-2.5">Glucose</th>
              <th className="text-left px-4 py-2.5">HR</th>
              <th className="text-left px-4 py-2.5">SpO₂</th>
              <th className="text-left px-4 py-2.5">Last update</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const isFlashing = !!flashing[p.id];
              const latest = p.latest || {};
              const lastIso = METRICS.map((m) => latest[m]?.recorded_at).filter(Boolean).sort().reverse()[0];
              return (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/patients/${p.id}`)}
                  data-testid={`triage-row-${p.id}`}
                  className={`border-t border-slate-100 cursor-pointer transition-colors ${
                    isFlashing ? "bg-rose-100" : "hover:bg-slate-50"
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{p.full_name}</div>
                    <div className="text-xs text-slate-500">{p.email} {p.premium ? "· premium" : ""}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${severityColor(p.risk_level)}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${severityDot(p.risk_level)}`} />
                      {p.risk_level}
                    </span>
                  </td>
                  {METRICS.map((m) => {
                    const cell = latest[m];
                    return (
                      <td key={m} className="px-4 py-3" data-testid={`triage-${p.id}-${m}`}>
                        {cell ? (
                          <div>
                            <div className={`font-mono ${cell.severity !== "normal" ? "font-semibold" : ""}`}>
                              {Math.round(cell.value)} <span className="text-xs text-slate-400">{METRIC_UNIT[m]}</span>
                            </div>
                            <div className="text-xs text-slate-400">{fmtTime(cell.recorded_at)}</div>
                          </div>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtTime(lastIso)}</td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">No patients match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
