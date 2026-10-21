import React, { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import Topbar from "./Topbar.jsx";
import { apiRequest } from "../services/api.js";

export default function AppLayout() {
  const [user, setUser] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("grantwise-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  // Determine if on a portal route
  const isPortalRoute = location.pathname.startsWith("/portal");
  const portalTypeMatch = location.pathname.match(/^\/portal\/([^/?#]+)/);
  const currentPortalType = portalTypeMatch ? portalTypeMatch[1] : null;

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

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  function handleToggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("grantwise-sidebar-collapsed", String(next));
      } catch {}
      return next;
    });
  }

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
    <div className={`app-shell ${isPortalRoute ? "has-dashboard-shell" : "has-public-shell"}`}>
      {isPortalRoute ? (
        <div className="dashboard-layout">
          <Sidebar
            user={user}
            portalType={currentPortalType}
            collapsed={sidebarCollapsed}
            onToggleCollapse={handleToggleSidebar}
            mobileOpen={mobileSidebarOpen}
            onCloseMobile={() => setMobileSidebarOpen(false)}
            onLogout={handleLogout}
            signingOut={signingOut}
          />

          <div className="dashboard-main-area">
            <Topbar
              user={user}
              portalType={currentPortalType}
              onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
              onLogout={handleLogout}
              signingOut={signingOut}
              isPortalView={true}
            />

            <main className="dashboard-content" id="main-content">
              <Outlet />
            </main>

            <footer className="dashboard-footer">
              <div className="footer-content">
                <span>GrantWise Tagbilaran · LGU Scholarship Engine</span>
                <span className="footer-tag">Official City Government System</span>
              </div>
            </footer>
          </div>
        </div>
      ) : (
        <>
          <Topbar
            user={user}
            portalType={null}
            onLogout={handleLogout}
            signingOut={signingOut}
            isPortalView={false}
          />

          <main id="main-content">
            <Outlet />
          </main>

          <footer className="site-footer">
            <div className="footer-inner">
              <div className="footer-brand">
                <strong>GrantWise Tagbilaran</strong>
                <p>Multi-Unit LGU Scholarship & Educational Grant Disbursement Engine</p>
              </div>
              <div className="footer-notes">
                <span>City Government of Tagbilaran, Bohol, Philippines</span>
                <span>In coordination with participating colleges, universities, and 15 barangays</span>
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
