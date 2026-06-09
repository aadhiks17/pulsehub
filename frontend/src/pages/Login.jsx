import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { formatApiError, clearSession } from "../api";

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (user && (user.role === "doctor" || user.role === "admin")) {
    return <Navigate to="/triage" replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setPending(true);
    try {
      const u = await login(email.trim(), password);
      if (u.role === "patient") {
        clearSession();
        setError("Patients should use the PulseHub mobile app to access their data.");
      } else if (u.role === "doctor" || u.role === "admin") {
        navigate("/triage");
      } else {
        clearSession();
        setError("This account cannot use the doctor portal.");
      }
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6"
         style={{ fontFamily: '"Inter", system-ui, sans-serif' }}>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-10">
          <div className="w-8 h-8 rounded-md bg-slate-900 text-white grid place-items-center font-bold">P</div>
          <span className="font-semibold tracking-tight">PulseHub <span className="text-slate-400 font-normal">· Doctor Portal</span></span>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight mb-2">Sign in</h1>
        <p className="text-sm text-slate-500 mb-8">Use your clinician credentials. Patients should use the mobile app.</p>

        <form onSubmit={submit} className="space-y-4" data-testid="login-form">
          <label className="block">
            <span className="text-sm text-slate-700">Email</span>
            <input
              type="email" required autoFocus autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)}
              data-testid="login-email"
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-700">Password</span>
            <input
              type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </label>

          {error && (
            <div data-testid="login-error" className="text-sm rounded-md border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit" disabled={pending}
            data-testid="login-submit"
            className="w-full bg-slate-900 text-white py-2.5 rounded-md font-medium hover:bg-slate-800 disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-10 text-xs text-slate-500 leading-relaxed">
          Test accounts: <code>dr.smith@pulsehub.test</code> / Doctor123! · <code>admin@pulsehub.test</code> / Admin123!
        </div>
      </div>
    </div>
  );
}
