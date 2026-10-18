import React from "react";
import { ArrowRight, Landmark } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

export default function AppLayout() {
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

          <NavLink className="header-link" to="/login">
            Sign in
            <ArrowRight size={15} aria-hidden="true" />
          </NavLink>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="site-footer">
        <span>GrantWise Tagbilaran</span>
        <span>Scholarship and educational grant information · Preview</span>
      </footer>
    </div>
  );
}
