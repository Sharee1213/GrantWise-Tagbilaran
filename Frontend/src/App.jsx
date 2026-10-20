import React from "react";
import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout.jsx";
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
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/programs" element={<ProgramsPage />} />
        <Route path="/application-guide" element={<ApplicationGuidePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/staff-register" element={<StaffRegisterPage />} />
        <Route path="/portals" element={<PortalDirectoryPage />} />
        <Route path="/portal/student" element={<StudentPortalPage />} />
        <Route
          path="/portal/system-admin"
          element={<StaffAccessManagementPage />}
        />
        <Route path="/portal/:portalType" element={<StaffPortalPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
