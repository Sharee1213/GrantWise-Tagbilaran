import {
  BarangayVerificationStrategy,
  LguVerificationStrategy,
  RegistrarVerificationStrategy,
} from "./verificationStrategies.js";

/**
 * Base Role Portal Strategy
 */
export class RolePortalStrategy {
  constructor(config) {
    this.id = config.id;
    this.roleName = config.roleName;
    this.eyebrow = config.eyebrow;
    this.title = config.title;
    this.description = config.description;
    this.base = config.base;
    this.scopeType = config.scopeType;
  }

  getNavItems() {
    return [{ id: "overview", label: "Dashboard", icon: "LayoutDashboard" }];
  }

  formatScope(scopeId, scopeName) {
    if (!scopeId) return "Assigned Organization";
    return scopeName ? `${scopeName} (#${scopeId})` : `Scope #${scopeId}`;
  }

  getVerificationStrategy() {
    return null;
  }

  async loadDashboardData(requestPortalData, apiRequest) {
    const [dashboard, queue] = await Promise.all([
      requestPortalData(`${this.base}/dashboard`),
      requestPortalData(`${this.base}/verifications`),
    ]);
    return { ...dashboard, ...queue };
  }
}

/**
 * LGU Program Administrator Strategy
 */
export class LguAdminPortalStrategy extends RolePortalStrategy {
  constructor() {
    super({
      id: "lgu-admin",
      roleName: "LGU Admin",
      eyebrow: "LGU PROGRAM ADMINISTRATION",
      title: "Multi-Unit Program & Disbursement Engine",
      description:
        "Manage funding-unit programs, allocate barangay quotas, review scholar applications, and approve scholarship awards.",
      base: "admin",
      scopeType: "funding_unit",
    });
  }

  getNavItems() {
    return [
      { id: "overview", label: "Overview", icon: "LayoutDashboard" },
      { id: "programs", label: "Programs & Allocations", icon: "Landmark" },
      { id: "verifications", label: "Application Queue", icon: "CheckSquare" },
      { id: "applications", label: "All Applications", icon: "FileText" },
    ];
  }

  formatScope(scopeId, scopeName) {
    return scopeName ? `Funding Unit: ${scopeName}` : `Funding Unit #${scopeId || "General"}`;
  }

  getVerificationStrategy() {
    return new LguVerificationStrategy();
  }

  async loadDashboardData(requestPortalData, apiRequest) {
    const [dashboard, programs, applications, fundingCycles, queue, lookups] =
      await Promise.all([
        requestPortalData("admin/dashboard"),
        requestPortalData("admin/programs"),
        requestPortalData("admin/applications"),
        requestPortalData("admin/funding-cycles"),
        requestPortalData("admin/verifications"),
        apiRequest("lookups"),
      ]);
    return {
      ...dashboard,
      ...programs,
      ...applications,
      ...fundingCycles,
      ...queue,
      ...lookups,
    };
  }
}

/**
 * Barangay Coordinator Strategy
 */
export class BarangayCoordinatorPortalStrategy extends RolePortalStrategy {
  constructor() {
    super({
      id: "barangay-coordinator",
      roleName: "Barangay Coordinator",
      eyebrow: "BARANGAY VERIFICATION WORKSPACE",
      title: "Residency & Indigency Verification",
      description:
        "Review applications within your designated Tagbilaran barangay, verify proof of residency, and record verification status.",
      base: "coordinator",
      scopeType: "barangay",
    });
  }

  getNavItems() {
    return [
      { id: "overview", label: "Overview", icon: "LayoutDashboard" },
      { id: "verifications", label: "Residency Queue", icon: "ShieldCheck" },
    ];
  }

  formatScope(scopeId, scopeName) {
    return scopeName ? `Barangay: ${scopeName}` : `Barangay #${scopeId || "Local"}`;
  }

  getVerificationStrategy() {
    return new BarangayVerificationStrategy();
  }
}

/**
 * School Registrar Strategy
 */
export class SchoolRegistrarPortalStrategy extends RolePortalStrategy {
  constructor() {
    super({
      id: "school-registrar",
      roleName: "Registrar",
      eyebrow: "ACADEMIC REGISTRAR WORKSPACE",
      title: "School Enrollment & Academic Verification",
      description:
        "Verify student enrollment status, grade point averages, and academic eligibility for your partner institution.",
      base: "registrar",
      scopeType: "school",
    });
  }

  getNavItems() {
    return [
      { id: "overview", label: "Overview", icon: "LayoutDashboard" },
      { id: "verifications", label: "Academic Queue", icon: "GraduationCap" },
    ];
  }

  formatScope(scopeId, scopeName) {
    return scopeName ? `School: ${scopeName}` : `School #${scopeId || "Campus"}`;
  }

  getVerificationStrategy() {
    return new RegistrarVerificationStrategy();
  }
}

/**
 * Scholar / Student Strategy
 */
export class StudentPortalStrategy extends RolePortalStrategy {
  constructor() {
    super({
      id: "student",
      roleName: "Scholar",
      eyebrow: "STUDENT SCHOLAR PORTAL",
      title: "Scholarship Tracking & Applications",
      description:
        "Browse open grant programs, submit applications, monitor verification progress, and manage student credentials.",
      base: "student",
      scopeType: "student",
    });
  }

  getNavItems() {
    return [
      { id: "overview", label: "My Applications", icon: "FileText" },
      { id: "programs", label: "Open Programs", icon: "GraduationCap" },
      { id: "profile", label: "Student Profile", icon: "User" },
    ];
  }

  formatScope() {
    return "Student Scholar";
  }
}

/**
 * System Admin Strategy
 */
export class SystemAdminPortalStrategy extends RolePortalStrategy {
  constructor() {
    super({
      id: "system-admin",
      roleName: "System Admin",
      eyebrow: "DEVELOPER ACCESS & SECURITY CONTROL",
      title: "Staff Provisioning & System Audits",
      description:
        "Manage authorized staff invitations, school email domains, portal developer previews, and security audit logs.",
      base: "system-admin",
      scopeType: "system",
    });
  }

  getNavItems() {
    return [
      { id: "invitations", label: "Staff Authorizations", icon: "Users" },
      { id: "previews", label: "Portal Previews", icon: "Eye" },
      { id: "domains", label: "School Domains", icon: "Globe" },
      { id: "audits", label: "Audit Logs", icon: "Shield" },
    ];
  }

  formatScope() {
    return "City Government Developer / Admin";
  }
}

const STRATEGY_INSTANCES = {
  "lgu-admin": new LguAdminPortalStrategy(),
  "barangay-coordinator": new BarangayCoordinatorPortalStrategy(),
  "school-registrar": new SchoolRegistrarPortalStrategy(),
  student: new StudentPortalStrategy(),
  "system-admin": new SystemAdminPortalStrategy(),
};

const ROLE_TO_PORTAL_TYPE = {
  "LGU Admin": "lgu-admin",
  "Barangay Coordinator": "barangay-coordinator",
  Registrar: "school-registrar",
  Scholar: "student",
  "System Admin": "system-admin",
};

export function getPortalStrategy(portalTypeOrRole) {
  if (!portalTypeOrRole) return null;
  if (STRATEGY_INSTANCES[portalTypeOrRole]) {
    return STRATEGY_INSTANCES[portalTypeOrRole];
  }
  const mappedType = ROLE_TO_PORTAL_TYPE[portalTypeOrRole];
  if (mappedType && STRATEGY_INSTANCES[mappedType]) {
    return STRATEGY_INSTANCES[mappedType];
  }
  return null;
}
