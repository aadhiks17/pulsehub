export default function ConnectionPill({ status }) {
  const map = {
    live:         { label: "Live",          cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500 animate-pulse" },
    connecting:   { label: "Connecting…",   cls: "bg-amber-50 text-amber-700 border-amber-200",         dot: "bg-amber-500" },
    reconnecting: { label: "Reconnecting…", cls: "bg-amber-50 text-amber-700 border-amber-200",         dot: "bg-amber-500" },
    idle:         { label: "Offline",       cls: "bg-slate-100 text-slate-600 border-slate-200",        dot: "bg-slate-400" },
  };
  const s = map[status] || map.idle;
  return (
    <span data-testid="connection-pill" className={`inline-flex items-center gap-2 text-xs font-medium px-2.5 py-1 rounded-full border ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
