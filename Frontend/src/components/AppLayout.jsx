import React, { useCallback, useEffect, useState } from "react";
import { ArrowRight, Landmark, LogOut, UserRound } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { getPortalPathForRole } from "../pages/LoginPage.jsx";
import { apiRequest } from "../services/api.js";

export default function AppLayout() {
  const [user, setUser] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const checkSession = useCallback(async () => {
    try {
      const response = await apiRequest("auth/me");
      setUser(response?.user || null);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession, location.pathname]);

  useEffect(() => {
    const handleAuthChange = () => {
      checkSession();
    };
    window.addEventListener("grantwise:auth-changed", handleAuthChange);
    return () => {
      window.removeEventListener("grantwise:auth-changed", handleAuthChange);
    };
  }, [checkSession]);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await apiRequest("auth/logout", { method: "POST" });
    } catch {
      // Clear client state even if session is already expired
    } finally {
      setUser(null);
      setSigningOut(false);
      window.dispatchEvent(new CustomEvent("grantwise:auth-changed"));
      navigate("/login");
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <NavLink className="brand" to="/" aria-label="GrantWise home">
            <span className="brand-mark">
              <Landmark size={21} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className="brand-copy">
              <strong>GrantWise</strong>
              <span>TAGBILARAN CITY</span>
            </span>
          </NavLink>

          <nav className="main-nav" aria-label="Main navigation">
            <NavLink to="/" end>
              Home
            </NavLink>
            <NavLink to="/programs">Programs</NavLink>
            <NavLink to="/application-guide">How to apply</NavLink>
            <NavLink to="/portals">Portals</NavLink>
            <NavLink to="/status">System status</NavLink>
          </nav>

          {user ? (
            <div className="header-auth-controls">
              <NavLink
                className="header-user-pill"
                to={getPortalPathForRole(user.role)}
                title={`Open ${user.role} portal`}
              >
                <UserRound size={14} aria-hidden="true" />
                <span>{user.firstName}</span>
                <small>{user.role}</small>
              </NavLink>
              <button
                type="button"
                className="header-link header-logout-btn"
                onClick={handleLogout}
                disabled={signingOut}
              >
                <LogOut size={14} aria-hidden="true" />
                {signingOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          ) : (
            <NavLink className="header-link" to="/login">
              Sign in
              <ArrowRight size={15} aria-hidden="true" />
            </NavLink>
          )}
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="site-footer">
        <span>GrantWise Tagbilaran</span>
        <span>Scholarship and educational grant management</span>
      </footer>
    </div>
  );
}
