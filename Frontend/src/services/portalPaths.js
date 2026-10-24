export function getPortalPathForRole(
  role,
  programId = null,
  dashboardPath = null,
) {
  if (role === "Scholar") {
    return programId && /^\d+$/.test(programId)
      ? `/portal/student?programId=${encodeURIComponent(programId)}`
      : "/portal/student";
  }
  if (role === "System Admin") return "/portal/system-admin";
  if (role === "LGU Admin") return "/portal/lgu-admin";
  if (role === "Barangay Coordinator") return "/portal/barangay-coordinator";
  if (role === "Registrar") return "/portal/school-registrar";
  if (
    typeof dashboardPath === "string" &&
    dashboardPath.startsWith("/portal/")
  ) {
    return dashboardPath;
  }
  return "/portals";
}
