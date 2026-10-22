import React from "react";
import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout.jsx";
import {
  ProtectedRoute,
  PublicOnlyRoute,
} from "./components/ProtectedRoute.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import ApplicationGuidePage from "./pages/ApplicationGuidePage.jsx";
import HomePage from "./pages/HomePage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import SignUpPage from "./pages/SignUpPage.jsx";
import StatusPage from "./pages/StatusPage.jsx";
import ProgramsPage from "./pages/ProgramsPage.jsx";
import PortalDirectoryPage from "./pages/PortalDirectoryPage.jsx";
import StaffAccessManagementPage from "./pages/StaffAccessManagementPage.jsx";
import StaffPortalPage from "./pages/StaffPortalPage.jsx";
import StaffRegisterPage from "./pages/StaffRegisterPage.jsx";
import StudentPortalPage from "./pages/StudentPortalPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";

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
