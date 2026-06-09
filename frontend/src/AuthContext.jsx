import { createContext, useContext, useEffect, useState } from "react";
import { api, clearSession, getStoredUser, getToken, setSession } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser());
  const [bootstrapping, setBootstrapping] = useState(!!getToken());

  // On mount, if we have a token, validate it against /api/auth/me
  useEffect(() => {
    if (!getToken()) { setBootstrapping(false); return; }
    api.get("/auth/me")
      .then((r) => { setUser(r.data); localStorage.setItem("pulsehub_user", JSON.stringify(r.data)); })
      .catch(() => { clearSession(); setUser(null); })
      .finally(() => setBootstrapping(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setSession(data.access_token, data.user);
    setUser(data.user);
    return data.user;
  };

  const logout = () => { clearSession(); setUser(null); };

  return (
    <AuthCtx.Provider value={{ user, login, logout, bootstrapping }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
