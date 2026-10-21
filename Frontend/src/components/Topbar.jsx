import React, { useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  Landmark,
  LogOut,
  Menu,
  Shield,
  User,
  UserRound,
} from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import ThemeToggle from "./ThemeToggle.jsx";
import { getPortalPathForRole } from "../pages/LoginPage.jsx";

export default function Topbar({
  user,
  portalType,
  onOpenMobileSidebar,
  onLogout,
  signingOut = false,
  isPortalView = false,
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const location = useLocation();

  return (
    <header className={`site-header ${isPortalView ? "is-portal-topbar" : ""}`}>
      <div className="header-inner">
        {/* Left: Mobile hamburger (if portal) + Brand */}
        <div className="header-left">
          {isPortalView && (
            <button
              type="button"
              className="mobile-menu-trigger"
              onClick={onOpenMobileSidebar}
              aria-label="Open sidebar navigation"
            >
              <Menu size={20} aria-hidden="true" />
            </button>
          )}

          <NavLink className="brand" to="/" aria-label="GrantWise Tagbilaran home">
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
            <NavLink to="/" end>
              Home
            </NavLink>
            <NavLink to="/programs">Programs</NavLink>
            <NavLink to="/application-guide">How to Apply</NavLink>
            <NavLink to="/portals">Portals</NavLink>
            <NavLink to="/status">System Status</NavLink>
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
    </header>
  );
}
