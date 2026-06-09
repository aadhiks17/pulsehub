import { useEffect, useState } from "react";
import "@/App.css";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function StatusDot({ ok }) {
  return (
    <span
      data-testid="api-status-dot"
      className={`inline-block w-2.5 h-2.5 rounded-full ${
        ok === null ? "bg-stone-400" : ok ? "bg-emerald-500" : "bg-rose-500"
      }`}
    />
  );
}

export default function App() {
  const [apiOk, setApiOk] = useState(null);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/`);
        if (!cancelled) {
          setApiOk(true);
          setInfo(r.data);
        }
      } catch {
        if (!cancelled) setApiOk(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      data-testid="phase0-landing"
      className="min-h-screen bg-stone-50 text-stone-900 flex items-center justify-center px-6"
      style={{ fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace' }}
    >
      <div className="max-w-2xl w-full">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-md bg-stone-900 text-stone-50 grid place-items-center font-bold text-lg">
            P
          </div>
          <div className="text-sm tracking-widest uppercase text-stone-500">PulseHub</div>
        </div>

        <h1
          data-testid="phase0-title"
          className="text-4xl sm:text-5xl lg:text-6xl font-semibold leading-tight tracking-tight"
        >
          Doctor Portal —{" "}
          <span className="text-stone-500">Phase&nbsp;0 backend ready.</span>
        </h1>

        <p className="mt-6 text-base sm:text-lg text-stone-600 max-w-xl">
          The FastAPI backend, MongoDB schema, HIPAA encryption utilities, JWT auth,
          and seed data are all online. The real React doctor portal lands in Phase&nbsp;2.
        </p>

        <div
          data-testid="api-status-card"
          className="mt-12 border border-stone-300 rounded-lg p-5 bg-white"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <StatusDot ok={apiOk} />
              <span className="font-medium">API</span>
            </div>
            <code className="text-xs text-stone-500">{API}</code>
          </div>
          {info && (
            <pre
              data-testid="api-status-payload"
              className="mt-4 text-xs bg-stone-50 border border-stone-200 rounded p-3 overflow-auto"
            >
              {JSON.stringify(info, null, 2)}
            </pre>
          )}
        </div>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {[
            ["OpenAPI", `${API}/openapi.json`],
            ["Swagger UI", `${API}/docs`],
            ["Health", `${API}/health`],
            ["Login", `POST ${API}/auth/login`],
          ].map(([k, v]) => (
            <div
              key={k}
              data-testid={`endpoint-${k.toLowerCase().replace(/\s+/g, "-")}`}
              className="border border-stone-200 rounded-md p-3 bg-white"
            >
              <div className="text-stone-500 text-xs uppercase tracking-wider">{k}</div>
              <div className="font-mono text-xs mt-1 break-all">{v}</div>
            </div>
          ))}
        </div>

        <div className="mt-12 text-xs text-stone-500">
          Seed accounts live in <code>/app/memory/test_credentials.md</code>.
        </div>
      </div>
    </div>
  );
}
