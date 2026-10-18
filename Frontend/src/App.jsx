import React from "react";
import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout.jsx";
import ApplicationGuidePage from "./pages/ApplicationGuidePage.jsx";
import HomePage from "./pages/HomePage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import StatusPage from "./pages/StatusPage.jsx";
import ProgramsPage from "./pages/ProgramsPage.jsx";
import PortalDirectoryPage from "./pages/PortalDirectoryPage.jsx";
import PortalPlaceholderPage from "./pages/PortalPlaceholderPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/programs" element={<ProgramsPage />} />
        <Route path="/application-guide" element={<ApplicationGuidePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/portals" element={<PortalDirectoryPage />} />
        <Route path="/portal/:portalType" element={<PortalPlaceholderPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
