import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiRequest } from "../services/api.js";

const AuthContext = createContext({
  user: null,
  loading: true,
  refreshSession: async () => null,
  logout: async () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const response = await apiRequest("auth/me");
      setUser(response?.user || null);
      return response?.user || null;
    } catch (error) {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest("auth/logout", { method: "POST" });
    } catch {
      // Ignore stale session/logout failures and clear client state.
    } finally {
      setUser(null);
      window.dispatchEvent(new CustomEvent("grantwise:auth-changed"));
    }
  }, []);

  useEffect(() => {
    refreshSession();

    const handleAuthChange = () => {
      refreshSession();
    };

    window.addEventListener("grantwise:auth-changed", handleAuthChange);
    return () => {
      window.removeEventListener("grantwise:auth-changed", handleAuthChange);
    };
  }, [refreshSession]);

  const value = useMemo(
    () => ({ user, loading, refreshSession, logout }),
    [user, loading, refreshSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
