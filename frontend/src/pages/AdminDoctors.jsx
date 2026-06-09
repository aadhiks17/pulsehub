import { useEffect, useState } from "react";
import { api, formatApiError } from "../api";

export default function AdminDoctors() {
  const [doctors, setDoctors] = useState([]);
  const [form, setForm] = useState({ email: "", password: "", full_name: "", specialty: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const refresh = () => api.get("/admin/doctors").then((r) => setDoctors(r.data)).catch((e) => setError(formatApiError(e)));
  useEffect(() => { refresh(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setInfo(""); setPending(true);
    try {
      const { data } = await api.post("/admin/doctors", { ...form, role: "doctor" });
      setInfo(`Created ${data.full_name} (${data.email})`);
      setForm({ email: "", password: "", full_name: "", specialty: "" });
      refresh();
    } catch (e) { setError(formatApiError(e)); }
    finally { setPending(false); }
  };

  return (
    <div data-testid="admin-doctors-page">
      <h1 className="text-3xl font-semibold tracking-tight mb-1">Doctors</h1>
      <p className="text-sm text-slate-500 mb-8">Create new doctor accounts and view the roster.</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm" data-testid="admin-doctors-table">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Email</th>
                <th className="text-left px-4 py-2.5">Specialty</th>
                <th className="text-left px-4 py-2.5">Created</th>
              </tr>
            </thead>
            <tbody>
              {doctors.map((d) => (
                <tr key={d._id} className="border-t border-slate-100" data-testid={`admin-doctor-${d._id}`}>
                  <td className="px-4 py-2.5 font-medium">{d.full_name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{d.email}</td>
                  <td className="px-4 py-2.5 text-slate-600">{d.specialty || "—"}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{d.created_at ? new Date(d.created_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
              {doctors.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">No doctors yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-lg p-5 space-y-3" data-testid="admin-doctor-form">
          <div className="font-semibold tracking-tight mb-1">Create doctor</div>
          <label className="block">
            <span className="text-xs text-slate-700">Full name</span>
            <input required value={form.full_name} data-testid="admin-doctor-name"
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-md text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-700">Email</span>
            <input required type="email" value={form.email} data-testid="admin-doctor-email"
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-md text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-700">Specialty</span>
            <input value={form.specialty} data-testid="admin-doctor-specialty"
              onChange={(e) => setForm({ ...form, specialty: e.target.value })}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-md text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-700">Temporary password</span>
            <input required minLength={6} type="text" value={form.password} data-testid="admin-doctor-password"
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-md text-sm font-mono" />
          </label>
          {error && <div className="text-xs text-rose-700">{error}</div>}
          {info && <div className="text-xs text-emerald-700">{info}</div>}
          <button type="submit" disabled={pending} data-testid="admin-doctor-submit"
            className="w-full bg-slate-900 text-white py-2 rounded-md text-sm hover:bg-slate-800 disabled:opacity-60">
            {pending ? "Creating…" : "Create doctor"}
          </button>
        </form>
      </div>
    </div>
  );
}
