import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

function LoadingState() {
  return (
    <div className="page-container information-page narrow-page">
      <div
        className="auth-card"
        style={{ textAlign: "center", padding: "2rem" }}
      >
        <p>Checking your session...</p>
      </div>
    </div>
  );
}

export function ProtectedRoute({
  children,
  allowedRoles = null,
  redirectTo = "/login",
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingState />;
  if (!user) {
    return (
      <Navigate to={redirectTo} replace state={{ from: location.pathname }} />
    );
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    const defaultPath = user.dashboardPath || "/";
    return <Navigate to={defaultPath} replace />;
  }

  return children;
}

export function PublicOnlyRoute({ children, redirectTo = "/" }) {
  const { user, loading } = useAuth();

  if (loading) return <LoadingState />;
  if (user) {
    return <Navigate to={user.dashboardPath || redirectTo} replace />;
  }

  return children;
}
