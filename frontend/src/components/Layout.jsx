import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";

const navCls = ({ isActive }) =>
  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors " +
  (isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100");

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const doLogout = () => { logout(); navigate("/login"); };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: '"Inter", system-ui, sans-serif' }}>
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/triage" data-testid="nav-logo" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-slate-900 text-white grid place-items-center font-bold text-sm">P</div>
              <span className="font-semibold tracking-tight">PulseHub</span>
            </Link>
            <nav className="flex items-center gap-1">
              <NavLink to="/triage" className={navCls} data-testid="nav-triage">Triage</NavLink>
              {user?.role === "admin" && (
                <NavLink to="/admin/doctors" className={navCls} data-testid="nav-admin">Admin</NavLink>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-600" data-testid="nav-user-name">
              {user?.full_name} <span className="text-slate-400">· {user?.role}</span>
            </div>
            <button
              onClick={doLogout}
              data-testid="nav-logout-btn"
              className="text-sm px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-100"
            >
              Logout
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
