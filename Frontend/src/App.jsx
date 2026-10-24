import React, { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout.jsx";
import {
  ProtectedRoute,
  PublicOnlyRoute,
} from "./components/ProtectedRoute.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import HomePage from "./pages/HomePage.jsx";

// Route-level code splitting: only the home page ships in the initial bundle.
const ApplicationGuidePage = lazy(() => import("./pages/ApplicationGuidePage.jsx"));
const LoginPage = lazy(() => import("./pages/LoginPage.jsx"));
const SignUpPage = lazy(() => import("./pages/SignUpPage.jsx"));
const StatusPage = lazy(() => import("./pages/StatusPage.jsx"));
const ProgramsPage = lazy(() => import("./pages/ProgramsPage.jsx"));
const PortalDirectoryPage = lazy(() => import("./pages/PortalDirectoryPage.jsx"));
const StaffAccessManagementPage = lazy(() => import("./pages/StaffAccessManagementPage.jsx"));
const StaffPortalPage = lazy(() => import("./pages/StaffPortalPage.jsx"));
const StaffRegisterPage = lazy(() => import("./pages/StaffRegisterPage.jsx"));
const StudentPortalPage = lazy(() => import("./pages/StudentPortalPage.jsx"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.jsx"));

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/programs" element={<ProgramsPage />} />
          <Route path="/application-guide" element={<ApplicationGuidePage />} />
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <LoginPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/signup"
            element={
              <PublicOnlyRoute>
                <SignUpPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/staff-register"
            element={
              <PublicOnlyRoute>
                <StaffRegisterPage />
              </PublicOnlyRoute>
            }
          />
          <Route path="/portals" element={<PortalDirectoryPage />} />
          <Route
            path="/portal/student"
            element={
              <ProtectedRoute allowedRoles={["Scholar"]}>
                <StudentPortalPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/portal/system-admin"
            element={
              <ProtectedRoute allowedRoles={["System Admin"]}>
                <StaffAccessManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/portal/:portalType"
            element={
              <ProtectedRoute
                allowedRoles={[
                  "Scholar",
                  "LGU Admin",
                  "Barangay Coordinator",
                  "Registrar",
                  "System Admin",
                ]}
              >
                <StaffPortalPage />
              </ProtectedRoute>
            }
          />
          <Route path="/status" element={<StatusPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}