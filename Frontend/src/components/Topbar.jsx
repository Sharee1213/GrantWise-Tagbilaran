import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  KeyRound,
  Landmark,
  LogOut,
  Menu,
  UserRound,
  X,
} from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import ChangePasswordDialog from "./ChangePasswordDialog.jsx";
import NotificationBell from "./NotificationBell.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import { getPortalPathForRole } from "../services/portalPaths.js";

const PUBLIC_NAV_LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/programs", label: "Programs" },
  { to: "/application-guide", label: "How to Apply" },
  { to: "/portals", label: "Portals" },
  { to: "/status", label: "System Status" },
];

export default function Topbar({
  user,
  portalType,
  onOpenMobileSidebar,
  onLogout,
  signingOut = false,
  isPortalView = false,
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const location = useLocation();

  const notificationConfig =
    user?.role === "Scholar"
      ? {
          listPath: "student/notifications",
          readPath: (id) => `student/notifications/${id}/read`,
        }
      : user?.role === "Barangay Coordinator"
        ? {
            listPath: "coordinator/notifications",
            readPath: (id) => `coordinator/notifications/${id}/read`,
          }
        : null;

  // Close the public mobile menu whenever the route changes.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  // Allow Escape to dismiss the public mobile menu.
  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") setMobileNavOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileNavOpen]);

  return (
    <header className={`site-header ${isPortalView ? "is-portal-topbar" : ""}`}>
      <div className="header-inner">
        {/* Left: Mobile hamburger + Brand */}
        <div className="header-left">
          {isPortalView ? (
            <button
              type="button"
              className="mobile-menu-trigger"
              onClick={onOpenMobileSidebar}
              aria-label="Open sidebar navigation"
            >
              <Menu size={20} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="mobile-menu-trigger"
              onClick={() => setMobileNavOpen((open) => !open)}
              aria-label={mobileNavOpen ? "Close main menu" : "Open main menu"}
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-main-nav"
            >
              {mobileNavOpen ? (
                <X size={20} aria-hidden="true" />
              ) : (
                <Menu size={20} aria-hidden="true" />
              )}
            </button>
          )}

          <NavLink
            className="brand"
            to="/"
            aria-label="GrantWise Tagbilaran home"
          >
            <span className="brand-mark">
              <Landmark size={20} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className="brand-copy">
              <strong>GrantWise</strong>
              <span>TAGBILARAN CITY</span>
            </span>
          </NavLink>
        </div>

        {/* Center: Main public navigation (if not in portal view) or breadcrumb */}
        {!isPortalView ? (
          <nav className="main-nav" aria-label="Main navigation">
            {PUBLIC_NAV_LINKS.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end}>
                {label}
              </NavLink>
            ))}
          </nav>
        ) : (
          <div className="portal-breadcrumbs">
            <Link to="/portals" className="breadcrumb-root">
              Portals
            </Link>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-current">
              {portalType === "lgu-admin"
                ? "LGU Admin Workspace"
                : portalType === "barangay-coordinator"
                  ? "Barangay Coordinator"
                  : portalType === "school-registrar"
                    ? "School Registrar"
                    : portalType === "student"
                      ? "Student Portal"
                      : portalType === "system-admin"
                        ? "Developer Security"
                        : "Staff Workspace"}
            </span>
          </div>
        )}

        {/* Right: Theme toggle & User Controls */}
        <div className="header-right">
          <ThemeToggle />

          {user ? (
            <div className="header-auth-controls">
              {!isPortalView && (
                <NavLink
                  className="header-user-pill"
                  to={getPortalPathForRole(user.role)}
                  title={`Open ${user.role} workspace`}
                >
                  <UserRound size={14} aria-hidden="true" />
                  <span>{user.firstName}</span>
                  <small>{user.role}</small>
                </NavLink>
              )}

              {notificationConfig && (
                <NotificationBell
                  listPath={notificationConfig.listPath}
                  readPath={notificationConfig.readPath}
                />
              )}

              <button
                type="button"
                className="header-link header-logout-btn"
                onClick={() => setChangePasswordOpen(true)}
                title="Change your password"
              >
                <KeyRound size={14} aria-hidden="true" />
                <span>Change password</span>
              </button>

              <button
                type="button"
                className="header-link header-logout-btn"
                onClick={onLogout}
                disabled={signingOut}
                title="Sign out of GrantWise"
              >
                <LogOut size={14} aria-hidden="true" />
                <span>{signingOut ? "Signing out..." : "Sign out"}</span>
              </button>
            </div>
          ) : (
            <NavLink className="header-link header-signin-btn" to="/login">
              <span>Sign in</span>
              <ArrowRight size={15} aria-hidden="true" />
            </NavLink>
          )}
        </div>
      </div>

      {!isPortalView && mobileNavOpen && (
        <nav
          id="mobile-main-nav"
          className="mobile-nav-panel"
          aria-label="Main navigation (mobile)"
        >
          {PUBLIC_NAV_LINKS.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end}>
              {label}
            </NavLink>
          ))}
        </nav>
      )}

      {user && (
        <ChangePasswordDialog
          isOpen={changePasswordOpen}
          onClose={() => setChangePasswordOpen(false)}
        />
      )}
    </header>
  );
}
