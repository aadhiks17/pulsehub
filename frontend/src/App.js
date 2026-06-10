import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Triage from "./pages/Triage";
import PatientDetail from "./pages/PatientDetail";
import AdminDoctors from "./pages/AdminDoctors";

// Stable role arrays — avoid creating new references on every render
const DOCTOR_OR_ADMIN = ["doctor", "admin"];
const ADMIN_ONLY = ["admin"];

function ProtectedRoute({ roles }) {
  const { user, bootstrapping } = useAuth();
  if (bootstrapping) return <div className="min-h-screen grid place-items-center text-sm text-slate-500">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/triage" replace />;
  return <Layout><Outlet /></Layout>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute roles={DOCTOR_OR_ADMIN} />}>
            <Route path="/triage" element={<Triage />} />
            <Route path="/patients/:id" element={<PatientDetail />} />
          </Route>
          <Route element={<ProtectedRoute roles={ADMIN_ONLY} />}>
            <Route path="/admin/doctors" element={<AdminDoctors />} />
          </Route>
          <Route path="*" element={<Navigate to="/triage" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
