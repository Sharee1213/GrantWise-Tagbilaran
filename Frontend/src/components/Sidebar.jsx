import React from "react";
import {
  Building2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Globe,
  GraduationCap,
  Landmark,
  LayoutDashboard,
  LogOut,
  School,
  Shield,
  ShieldCheck,
  User,
  Users,
  X,
} from "lucide-react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { getPortalStrategy } from "../strategies/portalStrategies.js";

const ICON_MAP = {
  LayoutDashboard,
  Landmark,
  CheckSquare,
  FileText,
  ShieldCheck,
  GraduationCap,
  User,
  Users,
  Eye,
  Globe,
  Shield,
  School,
  Building2,
};

export default function Sidebar({
  user,
  portalType,
  collapsed = false,
  onToggleCollapse,
  mobileOpen = false,
  onCloseMobile,
  onLogout,
  signingOut = false,
}) {
  const location = useLocation();
  const strategy = getPortalStrategy(portalType || user?.role);
  const navItems = strategy ? strategy.getNavItems() : [];

  const navEntries = [
    ...navItems.map((item) => ({
      ...item,
      kind: "section",
      href: `#${item.id}`,
      isActive: location.hash === `#${item.id}`,
    })),
    {
      id: "portal-directory",
      label: "Portal Directory",
      icon: "Globe",
      kind: "link",
      href: "/portals",
      isActive: location.pathname === "/portals",
    },
    {
      id: "public-programs",
      label: "Public Programs",
      icon: "GraduationCap",
      kind: "link",
      href: "/programs",
      isActive: location.pathname === "/programs",
    },
  ];

  const activeIndex = navEntries.findIndex((item) => item.isActive);

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="sidebar-mobile-backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`app-sidebar ${collapsed ? "is-collapsed" : ""} ${
          mobileOpen ? "is-mobile-open" : ""
        }`}
        aria-label="Portal Navigation"
      >
        <div className="sidebar-brand-wrapper">
          <Link to="/" className="sidebar-brand" title="GrantWise Home">
            <span className="sidebar-brand-icon">
              <Landmark size={20} strokeWidth={2} aria-hidden="true" />
            </span>
            {!collapsed && (
              <div className="sidebar-brand-text">
                <strong>GrantWise</strong>
                <span>TAGBILARAN CITY</span>
              </div>
            )}
          </Link>
          <button
            type="button"
            className="sidebar-close-mobile-btn"
            onClick={onCloseMobile}
            aria-label="Close navigation"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {strategy && !collapsed && (
          <div className="sidebar-role-pill">
            <span className="sidebar-role-eyebrow">{strategy.eyebrow}</span>
            <span className="sidebar-role-name">{strategy.roleName}</span>
          </div>
        )}

        <nav className="sidebar-nav" aria-label="Portal sections">
          <div className="sidebar-nav-section-title">
            {!collapsed ? "NAVIGATION" : "•••"}
          </div>

          <ul className="sidebar-nav-list">
            {activeIndex >= 0 && (
              <li
                className="sidebar-nav-indicator"
                aria-hidden="true"
                style={{ transform: `translateY(${activeIndex * 44}px)` }}
              />
            )}

            {navEntries.map((item, index) => {
              const Icon = ICON_MAP[item.icon] || LayoutDashboard;
              const isActive = item.isActive || (item.kind === "section" && index === activeIndex);
              const itemClassName = `sidebar-nav-item ${isActive ? "active" : ""} ${item.pending ? "is-pending" : ""}`;

              if (item.kind === "link") {
                return (
                  <li key={item.id}>
                    <NavLink
                      to={item.href}
                      className={({ isActive: navIsActive }) =>
                        `sidebar-nav-item ${navIsActive ? "active" : ""} ${item.pending ? "is-pending" : ""}`
                      }
                      title={collapsed ? item.label : undefined}
                      onClick={onCloseMobile}
                    >
                      <Icon size={18} className="sidebar-item-icon" aria-hidden="true" />
                      {!collapsed && <span className="sidebar-item-label">{item.label}</span>}
                    </NavLink>
                  </li>
                );
              }

              return (
                <li key={item.id}>
                  <a
                    href={item.href}
                    className={itemClassName}
                    title={collapsed ? item.label : undefined}
                    onClick={() => {
                      if (onCloseMobile) onCloseMobile();
                    }}
                  >
                    <Icon size={18} className="sidebar-item-icon" aria-hidden="true" />
                    {!collapsed && <span className="sidebar-item-label">{item.label}</span>}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="sidebar-footer">
          {onToggleCollapse && (
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={onToggleCollapse}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <ChevronRight size={16} aria-hidden="true" />
              ) : (
                <>
                  <ChevronLeft size={16} aria-hidden="true" />
                  <span>Collapse sidebar</span>
                </>
              )}
            </button>
          )}

          {user && !collapsed && (
            <div className="sidebar-user-info">
              <div className="sidebar-user-avatar">
                {user.firstName ? user.firstName.charAt(0).toUpperCase() : "U"}
              </div>
              <div className="sidebar-user-text">
                <span className="sidebar-user-name">
                  {user.firstName} {user.lastName}
                </span>
                <span className="sidebar-user-role">{user.role}</span>
              </div>
              <button
                type="button"
                className="sidebar-logout-btn"
                onClick={onLogout}
                disabled={signingOut}
                title="Sign out of GrantWise"
                aria-label="Sign out"
              >
                <LogOut size={16} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
