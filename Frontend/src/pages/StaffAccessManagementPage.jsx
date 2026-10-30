import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Eye,
  KeyRound,
  Landmark,
  RefreshCw,
  School,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import DataTable from "../components/DataTable.jsx";
import ModalDialog from "../components/ModalDialog.jsx";
import { apiRequest } from "../services/api.js";

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatScopeLabel(auth) {
  if (auth.role_name === "LGU Admin") {
    return auth.funding_unit_name
      ? `Funding Unit: ${auth.funding_unit_name} (#${auth.funding_unit_id})`
      : `Funding Unit #${auth.funding_unit_id}`;
  }
  if (auth.role_name === "Barangay Coordinator") {
    return auth.barangay_name
      ? `Barangay: ${auth.barangay_name} (#${auth.barangay_id})`
      : `Barangay #${auth.barangay_id}`;
  }
  if (auth.role_name === "Registrar") {
    return auth.school_name
      ? `School: ${auth.school_name} (#${auth.school_id})`
      : `School #${auth.school_id}`;
  }
  return "System";
}

export default function StaffAccessManagementPage() {
  const [identityState, setIdentityState] = useState("loading");
  const [currentUser, setCurrentUser] = useState(null);
  const [lookups, setLookups] = useState({
    fundingUnits: [],
    barangays: [],
    schools: [],
    schoolDomains: [],
    lguPermissionCategories: [],
    defaultLguPermissions: {
      read_only_reports: true,
      program_management: true,
      application_review: true,
      award_approval: true,
      disbursement_release: false,
    },
    emailDeliveryEnabled: false,
    proposedDirectories: {
      developers: [],
      lguOfficials: [],
      barangayCoordinators: [],
      schoolRegistrars: [],
    },
  });
  const [authorizations, setAuthorizations] = useState([]);
  const [portalPreviews, setPortalPreviews] = useState([]);
  const [schoolDomains, setSchoolDomains] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState("");
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState("");
  const [issuedInvitation, setIssuedInvitation] = useState(null);

  // Filters & State
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [revokeReasonById, setRevokeReasonById] = useState({});
  const [confirmingRevokeId, setConfirmingRevokeId] = useState(null);

  // Accordion state for Proposed Templates
  const [expandedSections, setExpandedSections] = useState({
    lgu: true,
    schools: true,
    barangays: true,
  });
  const [lguSearch, setLguSearch] = useState("");
  const [schoolSearch, setSchoolSearch] = useState("");
  const [brgySearch, setBrgySearch] = useState("");

  // Audit Log Detail Modal
  const [selectedAuditLog, setSelectedAuditLog] = useState(null);

  // School Domain Form State
  const [domainForm, setDomainForm] = useState({
    mode: "existing",
    schoolId: "",
    schoolName: "",
    domain: "",
    domainStatus: "verified",
    isPrimary: true,
    notes: "",
  });

  const loadSystemAdminData = useCallback(async () => {
    setError(null);
    const labels = [
      "lookups",
      "staff authorizations",
      "school domains",
      "audit logs",
      "portal previews",
    ];
    const results = await Promise.allSettled([
      apiRequest("system-admin/lookups"),
      apiRequest("system-admin/staff-authorizations"),
      apiRequest("system-admin/school-domains"),
      apiRequest("system-admin/audit-logs"),
      apiRequest("system-admin/portal-previews"),
    ]);
    const [lookupRes, authRes, domainRes, auditRes, previewRes] = results;
    if (lookupRes.status === "fulfilled") {
      setLookups((current) => ({ ...current, ...lookupRes.value }));
    }
    if (authRes.status === "fulfilled") {
      setAuthorizations(authRes.value.authorizations || []);
    }
    if (domainRes.status === "fulfilled") {
      setSchoolDomains(domainRes.value.schoolDomains || []);
    }
    if (auditRes.status === "fulfilled") {
      setAuditLogs(auditRes.value.auditLogs || []);
    }
    if (previewRes.status === "fulfilled") {
      setPortalPreviews(previewRes.value.previews || []);
    }
    const failed = results
      .map((result, index) =>
        result.status === "rejected"
          ? { label: labels[index], reason: result.reason }
          : null,
      )
      .filter(Boolean);
    if (failed.length > 0) {
      setError({
        status: failed[0].reason?.status,
        title: "Could not load Staff Access Management data.",
        message: `Failed to load: ${failed
          .map((item) => item.label)
          .join(", ")}. ${failed[0].reason?.message || "Try again in a moment."}`,
      });
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadSystemAdminData();
      await new Promise((resolve) => setTimeout(resolve, 600));
    } finally {
      setRefreshing(false);
    }
  }, [loadSystemAdminData]);

  useEffect(() => {
    let active = true;
    setIdentityState("loading");
    apiRequest("auth/me")
      .then(({ user }) => {
        if (!active) return;
        setCurrentUser(user);
        if (user?.role !== "System Admin") {
          setIdentityState("forbidden");
          setError({
            status: 403,
            title: "Developer / System Admin authorization required.",
            message:
              "This Staff Access Management portal is restricted to verified System Admin accounts.",
          });
          return;
        }
        setIdentityState("ready");
      })
      .catch((requestError) => {
        if (!active) return;
        setIdentityState(requestError.status === 401 ? "signed-out" : "error");
        setError({
          status: requestError.status,
          title:
            requestError.status === 401
              ? "Sign in with a verified System Admin account."
              : "Could not verify your session.",
          message: requestError.message || "Authentication is required.",
        });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (identityState === "ready") {
      loadSystemAdminData();
    }
  }, [identityState, loadSystemAdminData]);

  // Sidebar smooth scrolling to section hashes
  useEffect(() => {
    function handleSidebarClick(event) {
      const link = event.target.closest?.('a.sidebar-nav-item[href^="#"]');
      if (!link) return;
      const hash = (link.getAttribute("href") || "").slice(1);
      const target = hash ? document.getElementById(hash) : null;
      if (target) {
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    document.addEventListener("click", handleSidebarClick);
    return () => document.removeEventListener("click", handleSidebarClick);
  }, []);

  async function handleRegenerateToken(authorizationId) {
    setBusy(true);
    setError(null);
    setSuccess("");
    try {
      const result = await apiRequest(
        `system-admin/staff-authorizations/${authorizationId}/regenerate-token`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setSuccess(result.message || "Invitation token regenerated.");
      setIssuedInvitation({
        email: result.authorization.email,
        role: result.authorization.role_name,
        invitationToken: result.invitationToken,
        emailSent: Boolean(result.emailDelivery?.emailSent),
        expiresAt: result.authorization.expires_at,
      });
      await loadSystemAdminData();
    } catch (requestError) {
      setError({
        status: requestError.status,
        title: "Could not regenerate invitation token.",
        message: requestError.message || "Try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeAuthorization(authorizationId) {
    setBusy(true);
    setError(null);
    setSuccess("");
    try {
      const reason = (revokeReasonById[authorizationId] || "").trim();
      const result = await apiRequest(
        `system-admin/staff-authorizations/${authorizationId}/revoke`,
        {
          method: "POST",
          body: JSON.stringify({ reason: reason || null }),
        },
      );
      setSuccess(
        `${result.message} (${result.revokedSessionCount || 0} active session(s) terminated).`,
      );
      setConfirmingRevokeId(null);
      await loadSystemAdminData();
    } catch (requestError) {
      setError({
        status: requestError.status,
        title: "Could not revoke staff authorization.",
        message: requestError.message || "Try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleConfigureSchoolDomain(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess("");
    if (
      domainForm.domainStatus === "verified" &&
      ["ub.edu.ph", "tcc.edu.ph", "pmi-bohol.edu.ph"].includes(
        domainForm.domain.trim().toLowerCase(),
      )
    ) {
      setError({
        status: 400,
        title: "Invalid domain verification status.",
        message:
          "Candidate domains (ub.edu.ph, tcc.edu.ph, pmi-bohol.edu.ph) cannot be verified as student registration domains.",
      });
      setBusy(false);
      return;
    }
    try {
      const payload = {
        domain: domainForm.domain.trim().toLowerCase() || null,
        domainStatus: domainForm.domainStatus,
        isPrimary: domainForm.isPrimary,
        notes: domainForm.notes.trim() || null,
      };
      if (domainForm.mode === "existing") {
        payload.schoolId = Number(domainForm.schoolId);
      } else {
        payload.schoolName = domainForm.schoolName.trim();
      }
      await apiRequest("system-admin/school-domains", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setSuccess("School and email domain configuration saved.");
      setDomainForm((current) => ({
        ...current,
        schoolName: "",
        domain: "",
        notes: "",
      }));
      await loadSystemAdminData();
    } catch (requestError) {
      setError({
        status: requestError.status,
        title: "Could not save school domain configuration.",
        message: requestError.message || "Check your inputs and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateDomainStatus(domainId, nextStatus) {
    setBusy(true);
    setError(null);
    setSuccess("");
    const targetDomain = schoolDomains.find((d) => d.domain_id === domainId);
    if (
      nextStatus === "verified" &&
      targetDomain &&
      ["ub.edu.ph", "tcc.edu.ph", "pmi-bohol.edu.ph"].includes(
        targetDomain.domain?.toLowerCase(),
      )
    ) {
      setError({
        status: 400,
        title: "Invalid domain verification status.",
        message:
          "Candidate domains (ub.edu.ph, tcc.edu.ph, pmi-bohol.edu.ph) cannot be verified as student registration domains.",
      });
      setBusy(false);
      return;
    }
    try {
      await apiRequest(`system-admin/school-domains/${domainId}`, {
        method: "PATCH",
        body: JSON.stringify({ domainStatus: nextStatus }),
      });
      setSuccess(`School email domain updated to '${nextStatus}'.`);
      await loadSystemAdminData();
    } catch (requestError) {
      setError({
        status: requestError.status,
        title: "Could not update school domain status.",
        message: requestError.message || "Try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyEmail(email) {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      setTimeout(() => {
        setCopiedEmail((current) => (current === email ? "" : current));
      }, 2000);
    } catch {
      setCopiedEmail("");
    }
  }

  async function handleCopyJsonPayload(details) {
    try {
      const text =
        typeof details === "object"
          ? JSON.stringify(details, null, 2)
          : String(details || "{}");
      await navigator.clipboard.writeText(text);
      setCopiedPayload(true);
      setTimeout(() => setCopiedPayload(false), 2000);
    } catch {
      setCopiedPayload(false);
    }
  }

  function permissionLabel(key) {
    return (
      lookups.lguPermissionCategories.find((item) => item.key === key)?.label ||
      key
    );
  }

  // Filtered staff authorizations
  const filteredAuthorizations = useMemo(() => {
    return authorizations.filter((auth) => {
      if (roleFilter !== "ALL" && auth.role_name !== roleFilter) return false;
      if (statusFilter !== "ALL" && auth.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const needle = searchQuery.trim().toLowerCase();
        const haystack = [
          auth.email,
          auth.role_name,
          auth.funding_unit_name,
          auth.barangay_name,
          auth.school_name,
          auth.position_title,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [authorizations, roleFilter, statusFilter, searchQuery]);

  // Filtered proposed directory templates
  const filteredLguOfficials = useMemo(() => {
    const list = lookups.proposedDirectories.lguOfficials || [];
    if (!lguSearch.trim()) return list;
    const q = lguSearch.toLowerCase();
    return list.filter(
      (item) =>
        item.positionTitle?.toLowerCase().includes(q) ||
        item.officialName?.toLowerCase().includes(q) ||
        item.proposedEmail?.toLowerCase().includes(q) ||
        item.suggestedFundingUnitName?.toLowerCase().includes(q),
    );
  }, [lookups.proposedDirectories.lguOfficials, lguSearch]);

  const filteredSchoolRegistrars = useMemo(() => {
    const list = lookups.proposedDirectories.schoolRegistrars || [];
    if (!schoolSearch.trim()) return list;
    const q = schoolSearch.toLowerCase();
    return list.filter(
      (item) =>
        item.displayName?.toLowerCase().includes(q) ||
        item.proposedEmail?.toLowerCase().includes(q) ||
        item.candidateDomain?.toLowerCase().includes(q),
    );
  }, [lookups.proposedDirectories.schoolRegistrars, schoolSearch]);

  const filteredBarangayCoordinators = useMemo(() => {
    const list = lookups.proposedDirectories.barangayCoordinators || [];
    if (!brgySearch.trim()) return list;
    const q = brgySearch.toLowerCase();
    return list.filter(
      (item) =>
        item.barangayName?.toLowerCase().includes(q) ||
        item.proposedEmail?.toLowerCase().includes(q),
    );
  }, [lookups.proposedDirectories.barangayCoordinators, brgySearch]);

  // Audit Logs Columns
  const auditColumns = useMemo(
    () => [
      {
        header: "Action / Event",
        accessor: "action_type",
        render: (row) => (
          <span
            className="chip-tag verified"
            style={{ textTransform: "none", fontWeight: 700 }}
          >
            {row.action_type}
          </span>
        ),
      },
      {
        header: "Target Entity",
        accessor: "entity_type",
        render: (row) => (
          <div>
            <strong style={{ fontSize: "13px" }}>{row.entity_type}</strong>
            {row.entity_id != null && (
              <code
                style={{
                  marginLeft: "6px",
                  fontSize: "11px",
                  color: "var(--secondary-text)",
                }}
              >
                #{row.entity_id}
              </code>
            )}
          </div>
        ),
      },
      {
        header: "Actor / Performed By",
        accessor: "actor_email",
        render: (row) => {
          const name = [row.actor_first_name, row.actor_last_name]
            .filter(Boolean)
            .join(" ");
          return (
            <div>
              <span style={{ fontWeight: 600, display: "block" }}>
                {name || row.actor_email || "System"}
              </span>
              {name && row.actor_email && (
                <small style={{ color: "var(--secondary-text)" }}>
                  {row.actor_email}
                </small>
              )}
            </div>
          );
        },
      },
      {
        header: "Timestamp",
        accessor: "created_at",
        render: (row) => (
          <span style={{ fontSize: "12px", color: "var(--secondary-text)" }}>
            {formatDateTime(row.created_at)}
          </span>
        ),
      },
      {
        header: "Details",
        accessor: "log_id",
        render: (row) => (
          <button
            type="button"
            className="button button-secondary"
            style={{ padding: "5px 12px", fontSize: "12px" }}
            onClick={() => setSelectedAuditLog(row)}
            title="Inspect audit payload"
          >
            <Eye size={13} aria-hidden="true" />
            <span>View Details</span>
          </button>
        ),
      },
    ],
    [],
  );

  return (
    <div className="staff-portal-workspace">
      {/* Workspace Header */}
      <div className="workspace-header">
        <div>
          <PageHeading
            eyebrow="DEVELOPER & SYSTEM ADMIN ACCESS CONTROL"
            title="Staff Access, School Scopes & Audit Logs"
            description="Review authorized staff accounts and their organizational scopes (funding unit, barangay, or school), manage verified school domains, and audit access changes."
          />
          <div className="workspace-scope-pill">
            <span className="scope-indicator" aria-hidden="true" />
            <span>Developer Security Control · Tagbilaran City Infrastructure</span>
          </div>
        </div>

        <div className="workspace-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={handleRefresh}
            disabled={busy || refreshing}
            title="Refresh staff directory and security records"
          >
            <RefreshCw
              size={15}
              aria-hidden="true"
              className={busy || refreshing ? "spin" : ""}
            />
            <span>{refreshing ? "Refreshing..." : "Refresh Directory"}</span>
          </button>
        </div>
      </div>

      {/* Metrics Stat Grid */}
      <div className="stats-grid-4">
        <StatCard
          icon={Users}
          title="Authorized Staff Accounts"
          value={authorizations.length}
          subtext={`${authorizations.filter((a) => a.status === "active").length} active accounts`}
          variant="success"
        />
        <StatCard
          icon={School}
          title="Configured School Domains"
          value={schoolDomains.length}
          subtext={`${schoolDomains.filter((d) => d.domain_status === "verified").length} verified domains`}
          variant="info"
        />
        <StatCard
          icon={ShieldCheck}
          title="Security Audit Events"
          value={auditLogs.length}
          subtext="Immutable logging enabled"
          variant="default"
        />
        <StatCard
          icon={Eye}
          title="Staff Previews Available"
          value={portalPreviews.length}
          subtext="LGU, Barangay & Registrar roles"
          variant="default"
        />
      </div>

      {identityState === "loading" && (
        <p role="status" style={{ padding: "16px 0", color: "var(--secondary-text)" }}>
          Verifying System Admin session...
        </p>
      )}

      {error && (
        <section className="staff-notice staff-notice-error" role="alert">
          <ShieldAlert size={20} aria-hidden="true" />
          <div>
            <strong>{error.title}</strong>
            <p>{error.message}</p>
            {error.status === 401 && (
              <Link className="text-link" to="/login">
                Sign in to continue
              </Link>
            )}
            {error.status === 403 && (
              <Link className="text-link" to="/portals">
                Return to portal directory
              </Link>
            )}
          </div>
        </section>
      )}

      {success && (
        <div role="status" className="auth-banner auth-banner-success">
          <CheckCircle2 size={18} aria-hidden="true" />
          <div>
            <strong>Action recorded</strong>
            <p>{success}</p>
          </div>
        </div>
      )}

      {issuedInvitation && (
        <section className="auth-card" role="status" style={{ marginBottom: "24px" }}>
          <div className="auth-banner auth-banner-success">
            <KeyRound size={18} aria-hidden="true" />
            <div>
              <strong>
                Single-Use Staff Invitation Token ({issuedInvitation.email} · {issuedInvitation.role})
              </strong>
              <p>
                {issuedInvitation.emailSent
                  ? "An invitation email was dispatched via the configured SMTP provider."
                  : "Automated SMTP email delivery is currently disabled. Deliver this one-time token securely to the invited staff member."}
              </p>
              <p>
                <strong>Invitation Token:</strong>{" "}
                <code style={{ background: "rgba(0,0,0,0.3)", padding: "2px 6px", borderRadius: "4px" }}>
                  {issuedInvitation.invitationToken}
                </code>
              </p>
              <p>
                <strong>Registration Link:</strong>{" "}
                <Link
                  className="text-link"
                  to={`/staff-register?email=${encodeURIComponent(
                    issuedInvitation.email,
                  )}&token=${encodeURIComponent(issuedInvitation.invitationToken)}`}
                >
                  Open Staff Invitation Registration (/staff-register)
                </Link>
              </p>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(issuedInvitation.invitationToken);
                }}
              >
                <Copy size={14} aria-hidden="true" /> Copy token
              </button>
            </div>
          </div>
        </section>
      )}

      {identityState === "ready" && (
        <>
          {/* SECTION: PREVIEW STAFF DASHBOARDS */}
          <section
            className="staff-panel"
            id="previews"
            style={{ scrollMarginTop: "5rem", marginBottom: "28px" }}
          >
            <div className="panel-title-bar">
              <div>
                <h2 style={{ margin: 0 }}>Preview Staff Dashboards</h2>
                <p style={{ margin: "4px 0 0", color: "var(--secondary-text)", fontSize: "13px" }}>
                  Open an active LGU Admin, Barangay Coordinator, or Registrar dashboard in read-only mode to verify role views.
                </p>
              </div>
            </div>

            {portalPreviews.length === 0 ? (
              <p className="staff-empty">No active staff assignments are available to preview.</p>
            ) : (
              <div className="preview-cards-grid">
                {portalPreviews.map((preview) => {
                  const query = new URLSearchParams({
                    previewRole: preview.role_name,
                    previewScopeId: String(preview.scope_id),
                    previewName: preview.displayName,
                  });
                  const Icon =
                    preview.role_name === "LGU Admin"
                      ? Landmark
                      : preview.role_name === "Barangay Coordinator"
                        ? Building2
                        : School;
                  return (
                    <article
                      className="preview-portal-card"
                      key={`${preview.role_name}-${preview.user_id}`}
                    >
                      <div className="preview-card-top">
                        <div className="preview-card-icon">
                          <Icon size={20} />
                        </div>
                        <div className="preview-card-info">
                          <strong>{preview.displayName}</strong>
                          <p>{preview.email}</p>
                          <div className="preview-card-scope">
                            {preview.role_name} · {preview.scope_name}
                          </div>
                        </div>
                      </div>
                      <Link
                        className="preview-launch-btn"
                        to={`${preview.dashboard_path}?${query.toString()}`}
                      >
                        <Eye size={14} aria-hidden="true" />
                        <span>Open read-only dashboard</span>
                      </Link>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* SECTION 1: AUTHORIZED STAFF DIRECTORY */}
          <section
            className="staff-panel"
            id="invitations"
            style={{ scrollMarginTop: "5rem", marginBottom: "28px" }}
          >
            <div className="panel-title-bar">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>1. AUTHORIZED STAFF DIRECTORY</p>
                <h2 style={{ margin: "4px 0 0" }}>
                  Staff Invitations & Scope Authorizations ({filteredAuthorizations.length})
                </h2>
                <p style={{ margin: "4px 0 0", color: "var(--secondary-text)", fontSize: "13px" }}>
                  Active accounts, pending onboarding invitations, and organizational scopes.
                </p>
              </div>
            </div>

            <div className="form-grid-two" style={{ marginBottom: "16px" }}>
              <div className="form-field">
                <label className="form-label" htmlFor="filter-role">
                  Filter by role
                </label>
                <select
                  id="filter-role"
                  className="form-input"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                >
                  <option value="ALL">All roles</option>
                  <option value="LGU Admin">LGU Admin</option>
                  <option value="Barangay Coordinator">Barangay Coordinator</option>
                  <option value="Registrar">Registrar</option>
                </select>
              </div>

              <div className="form-field">
                <label className="form-label" htmlFor="filter-status">
                  Filter by status
                </label>
                <select
                  id="filter-status"
                  className="form-input"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="ALL">All statuses</option>
                  <option value="pending">Pending invitation</option>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="revoked">Revoked</option>
                </select>
              </div>
            </div>

            <div className="form-field" style={{ marginBottom: "20px" }}>
              <label className="form-label" htmlFor="filter-search">
                Search by email, barangay, school, or funding unit
              </label>
              <div className="input-with-icon">
                <Search size={16} className="input-leading-icon" aria-hidden="true" />
                <input
                  id="filter-search"
                  className="form-input has-leading-icon"
                  placeholder="Search staff email, position, or organizational scope..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {filteredAuthorizations.length === 0 ? (
              <p className="staff-empty">No staff email authorizations match the current filter.</p>
            ) : (
              <div className="template-grid">
                {filteredAuthorizations.map((auth) => (
                  <article key={auth.authorization_id} className="template-card">
                    <div>
                      <div className="template-card-header">
                        <div>
                          <span className="chip-tag readonly" style={{ marginBottom: "6px" }}>
                            {auth.role_name}
                          </span>
                          <h4 className="template-card-title">{auth.email}</h4>
                          {auth.position_title && (
                            <p className="template-card-subtitle">{auth.position_title}</p>
                          )}
                        </div>
                        <StatusBadge status={auth.status} />
                      </div>

                      <div style={{ marginTop: "12px", fontSize: "12px", display: "grid", gap: "5px", color: "var(--secondary-text)" }}>
                        <div>
                          <strong style={{ color: "var(--main-text)" }}>Scope: </strong>
                          {formatScopeLabel(auth)}
                        </div>
                        <div>
                          <strong style={{ color: "var(--main-text)" }}>Authorized: </strong>
                          {formatDateTime(auth.authorized_at)}
                          {auth.authorized_by_email ? ` by ${auth.authorized_by_email}` : ""}
                        </div>
                        {auth.expires_at && auth.status === "pending" && (
                          <div>
                            <strong style={{ color: "var(--main-text)" }}>Expires: </strong>
                            {formatDateTime(auth.expires_at)}
                          </div>
                        )}
                        {auth.activated_at && (
                          <div>
                            <strong style={{ color: "var(--main-text)" }}>Activated: </strong>
                            {formatDateTime(auth.activated_at)}
                          </div>
                        )}
                        {auth.revoked_at && (
                          <div style={{ color: "#ef4444" }}>
                            <strong>Revoked: </strong>
                            {formatDateTime(auth.revoked_at)}
                            {auth.revocation_reason ? ` (${auth.revocation_reason})` : ""}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      {["pending", "expired"].includes(auth.status) && (
                        <button
                          type="button"
                          className="button button-secondary"
                          style={{ width: "100%", justifyContent: "center" }}
                          disabled={busy}
                          onClick={() => handleRegenerateToken(auth.authorization_id)}
                        >
                          <RefreshCw size={13} aria-hidden="true" className={busy ? "spin" : ""} />
                          <span>Regenerate token</span>
                        </button>
                      )}

                      {auth.status !== "revoked" && (
                        <>
                          {confirmingRevokeId === auth.authorization_id ? (
                            <div style={{ display: "grid", gap: "8px" }}>
                              <input
                                className="form-input"
                                placeholder="Reason for revocation"
                                value={revokeReasonById[auth.authorization_id] || ""}
                                onChange={(e) =>
                                  setRevokeReasonById((c) => ({
                                    ...c,
                                    [auth.authorization_id]: e.target.value,
                                  }))
                                }
                              />
                              <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                  type="button"
                                  className="button button-danger"
                                  style={{ flex: 1, padding: "7px 10px", fontSize: "12px", justifyContent: "center" }}
                                  disabled={busy}
                                  onClick={() => handleRevokeAuthorization(auth.authorization_id)}
                                >
                                  <XCircle size={13} aria-hidden="true" />
                                  <span>Confirm Revoke</span>
                                </button>
                                <button
                                  type="button"
                                  className="button button-secondary"
                                  style={{ padding: "7px 12px", fontSize: "12px" }}
                                  onClick={() => setConfirmingRevokeId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="button button-secondary"
                              style={{ width: "100%", justifyContent: "center", color: "#f87171" }}
                              disabled={busy}
                              onClick={() => setConfirmingRevokeId(auth.authorization_id)}
                            >
                              <XCircle size={13} aria-hidden="true" />
                              <span>Revoke access</span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* SECTION 2: PROPOSED CONFIGURATION TEMPLATES (ACCORDION & CARDS) */}
          <section
            className="staff-panel"
            id="templates"
            style={{ scrollMarginTop: "5rem", marginBottom: "28px" }}
          >
            <div className="panel-title-bar">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>2. PROPOSED CONFIGURATION TEMPLATES</p>
                <h2 style={{ margin: "4px 0 0" }}>Reference Directories (Read-Only)</h2>
                <p style={{ margin: "4px 0 0", color: "var(--secondary-text)", fontSize: "13px" }}>
                  Official email formats, partner colleges, and 15 Tagbilaran barangays with one-click copy.
                </p>
              </div>
            </div>

            <div className="accordion-group">
              {/* ACCORDION ITEM 1: LGU Officials */}
              <div className={`accordion-card ${expandedSections.lgu ? "is-expanded" : ""}`}>
                <button
                  type="button"
                  className="accordion-trigger"
                  onClick={() => setExpandedSections((prev) => ({ ...prev, lgu: !prev.lgu }))}
                  aria-expanded={expandedSections.lgu}
                >
                  <div className="accordion-title-wrap">
                    <Landmark size={18} style={{ color: "#34d399" }} />
                    <h3>LGU Officials & Scholarship Office Templates</h3>
                    <span className="accordion-badge">{filteredLguOfficials.length}</span>
                  </div>
                  <ChevronDown
                    size={18}
                    className={`accordion-chevron ${expandedSections.lgu ? "is-rotated" : ""}`}
                    aria-hidden="true"
                  />
                </button>

                {expandedSections.lgu && (
                  <div className="accordion-content">
                    <div style={{ marginBottom: "12px" }}>
                      <div className="input-with-icon" style={{ maxWidth: "360px" }}>
                        <Search size={14} className="input-leading-icon" aria-hidden="true" />
                        <input
                          className="form-input has-leading-icon"
                          placeholder="Search LGU official, title, or email..."
                          value={lguSearch}
                          onChange={(e) => setLguSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="template-grid">
                      {filteredLguOfficials.map((item) => {
                        const isCopied = copiedEmail === item.proposedEmail;
                        return (
                          <div key={item.proposedEmail} className="template-card">
                            <div>
                              <div className="template-card-header">
                                <div>
                                  <h4 className="template-card-title">{item.positionTitle}</h4>
                                  <p className="template-card-subtitle">{item.officialName}</p>
                                </div>
                                <span className="chip-tag readonly">Read-Only</span>
                              </div>
                              <div style={{ marginTop: "10px", fontSize: "11px", color: "var(--secondary-text)" }}>
                                <strong>Funding unit:</strong> {item.suggestedFundingUnitName}
                              </div>
                              <div style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                {(item.recommendedPermissions || []).map((perm) => (
                                  <span key={perm} className="chip-tag candidate" style={{ fontSize: "9px" }}>
                                    {permissionLabel(perm)}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="template-card-email-box">
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {item.proposedEmail}
                              </span>
                              <button
                                type="button"
                                className={`copy-chip-btn ${isCopied ? "is-copied" : ""}`}
                                onClick={() => handleCopyEmail(item.proposedEmail)}
                                title="Copy email address"
                              >
                                {isCopied ? (
                                  <>
                                    <Check size={12} className="copy-icon-success" />
                                    <span>Copied!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy size={12} />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ACCORDION ITEM 2: Partner School Registrars */}
              <div className={`accordion-card ${expandedSections.schools ? "is-expanded" : ""}`}>
                <button
                  type="button"
                  className="accordion-trigger"
                  onClick={() => setExpandedSections((prev) => ({ ...prev, schools: !prev.schools }))}
                  aria-expanded={expandedSections.schools}
                >
                  <div className="accordion-title-wrap">
                    <School size={18} style={{ color: "#34d399" }} />
                    <h3>School Registrar Templates (5 Partner Colleges)</h3>
                    <span className="accordion-badge">{filteredSchoolRegistrars.length}</span>
                  </div>
                  <ChevronDown
                    size={18}
                    className={`accordion-chevron ${expandedSections.schools ? "is-rotated" : ""}`}
                    aria-hidden="true"
                  />
                </button>

                {expandedSections.schools && (
                  <div className="accordion-content">
                    <div style={{ marginBottom: "12px" }}>
                      <div className="input-with-icon" style={{ maxWidth: "360px" }}>
                        <Search size={14} className="input-leading-icon" aria-hidden="true" />
                        <input
                          className="form-input has-leading-icon"
                          placeholder="Search partner college..."
                          value={schoolSearch}
                          onChange={(e) => setSchoolSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="template-grid">
                      {filteredSchoolRegistrars.map((item) => {
                        const isCopied = copiedEmail === item.proposedEmail;
                        return (
                          <div key={item.proposedEmail} className="template-card">
                            <div>
                              <div className="template-card-header">
                                <h4 className="template-card-title">{item.displayName}</h4>
                                <span
                                  className={`chip-tag ${
                                    item.defaultDomainStatus === "verified" ? "verified" : "candidate"
                                  }`}
                                >
                                  {item.defaultDomainStatus}
                                </span>
                              </div>
                              <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--secondary-text)" }}>
                                <strong>Domain:</strong> @{item.candidateDomain}
                              </div>
                            </div>

                            <div className="template-card-email-box">
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {item.proposedEmail}
                              </span>
                              <button
                                type="button"
                                className={`copy-chip-btn ${isCopied ? "is-copied" : ""}`}
                                onClick={() => handleCopyEmail(item.proposedEmail)}
                                title="Copy email address"
                              >
                                {isCopied ? (
                                  <>
                                    <Check size={12} className="copy-icon-success" />
                                    <span>Copied!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy size={12} />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ACCORDION ITEM 3: 15 Barangay Coordinators */}
              <div className={`accordion-card ${expandedSections.barangays ? "is-expanded" : ""}`}>
                <button
                  type="button"
                  className="accordion-trigger"
                  onClick={() => setExpandedSections((prev) => ({ ...prev, barangays: !prev.barangays }))}
                  aria-expanded={expandedSections.barangays}
                >
                  <div className="accordion-title-wrap">
                    <Building2 size={18} style={{ color: "#34d399" }} />
                    <h3>15 Tagbilaran Barangay Coordinator Templates</h3>
                    <span className="accordion-badge">{filteredBarangayCoordinators.length}</span>
                  </div>
                  <ChevronDown
                    size={18}
                    className={`accordion-chevron ${expandedSections.barangays ? "is-rotated" : ""}`}
                    aria-hidden="true"
                  />
                </button>

                {expandedSections.barangays && (
                  <div className="accordion-content">
                    <div style={{ marginBottom: "12px" }}>
                      <div className="input-with-icon" style={{ maxWidth: "360px" }}>
                        <Search size={14} className="input-leading-icon" aria-hidden="true" />
                        <input
                          className="form-input has-leading-icon"
                          placeholder="Search barangay (e.g., Bool, Cabawan, Manga)..."
                          value={brgySearch}
                          onChange={(e) => setBrgySearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="template-grid">
                      {filteredBarangayCoordinators.map((item) => {
                        const isCopied = copiedEmail === item.proposedEmail;
                        return (
                          <div key={item.proposedEmail} className="template-card">
                            <div>
                              <div className="template-card-header">
                                <h4 className="template-card-title">Brgy. {item.barangayName}</h4>
                                <span className="chip-tag verified">Coordinator</span>
                              </div>
                              <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--secondary-text)" }}>
                                Tagbilaran City Local Official
                              </div>
                            </div>

                            <div className="template-card-email-box">
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {item.proposedEmail}
                              </span>
                              <button
                                type="button"
                                className={`copy-chip-btn ${isCopied ? "is-copied" : ""}`}
                                onClick={() => handleCopyEmail(item.proposedEmail)}
                                title="Copy email address"
                              >
                                {isCopied ? (
                                  <>
                                    <Check size={12} className="copy-icon-success" />
                                    <span>Copied!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy size={12} />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* SECTION 3: SCHOOL EMAIL DOMAINS */}
          <section
            className="staff-panel"
            id="domains"
            style={{ scrollMarginTop: "5rem", marginBottom: "28px" }}
          >
            <div className="panel-title-bar">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>3. SCHOOL EMAIL DOMAINS & HIGH SCHOOLS</p>
                <h2 style={{ margin: "4px 0 0" }}>Configure Partner Schools & Official Domains</h2>
                <p style={{ margin: "4px 0 0", color: "var(--secondary-text)", fontSize: "13px" }}>
                  Add a new partner school or configure an official institutional email domain for student eligibility.
                </p>
              </div>
            </div>

            <form onSubmit={handleConfigureSchoolDomain} className="auth-form" style={{ marginBottom: "24px" }}>
              <div className="form-field">
                <label className="form-label" htmlFor="domain-mode">
                  Target School
                </label>
                <select
                  id="domain-mode"
                  className="form-input"
                  value={domainForm.mode}
                  onChange={(e) => setDomainForm((c) => ({ ...c, mode: e.target.value }))}
                >
                  <option value="existing">Existing school in database</option>
                  <option value="new">Add new school / high school</option>
                </select>
              </div>

              {domainForm.mode === "existing" ? (
                <div className="form-field">
                  <label className="form-label" htmlFor="domain-school-id">
                    Select School
                  </label>
                  <select
                    id="domain-school-id"
                    className="form-input"
                    value={domainForm.schoolId}
                    onChange={(e) => setDomainForm((c) => ({ ...c, schoolId: e.target.value }))}
                    required
                  >
                    <option value="">Choose school</option>
                    {lookups.schools.map((s) => (
                      <option key={s.school_id} value={s.school_id}>
                        {s.school_name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="form-field">
                  <label className="form-label" htmlFor="domain-school-name">
                    New School or High School Name
                  </label>
                  <input
                    id="domain-school-name"
                    className="form-input"
                    placeholder="e.g., Dr. Cecilio Putong National High School"
                    value={domainForm.schoolName}
                    onChange={(e) => setDomainForm((c) => ({ ...c, schoolName: e.target.value }))}
                    required
                  />
                </div>
              )}

              <div className="form-grid-two">
                <div className="form-field">
                  <label className="form-label" htmlFor="domain-value">
                    Official Email Domain
                  </label>
                  <input
                    id="domain-value"
                    className="form-input"
                    placeholder="e.g., hnu.edu.ph"
                    value={domainForm.domain}
                    onChange={(e) => setDomainForm((c) => ({ ...c, domain: e.target.value }))}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="domain-status">
                    Verification Status
                  </label>
                  <select
                    id="domain-status"
                    className="form-input"
                    value={domainForm.domainStatus}
                    onChange={(e) => setDomainForm((c) => ({ ...c, domainStatus: e.target.value }))}
                  >
                    <option value="verified">Verified</option>
                    <option value="candidate">Candidate (unconfirmed)</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
              </div>

              <button type="submit" className="button button-primary" disabled={busy}>
                <ShieldCheck size={16} aria-hidden="true" className={busy ? "spin" : ""} />
                <span>{busy ? "Saving Configuration..." : "Save School / Domain"}</span>
              </button>
            </form>

            <h3 style={{ fontSize: "15px", marginBottom: "12px", color: "var(--main-text)" }}>
              Configured School Email Domains ({schoolDomains.length})
            </h3>
            <div className="template-grid">
              {schoolDomains.map((sd) => (
                <div key={sd.domain_id} className="template-card">
                  <div>
                    <div className="template-card-header">
                      <h4 className="template-card-title">{sd.school_name}</h4>
                      <span
                        className={`chip-tag ${
                          sd.domain_status === "verified"
                            ? "verified"
                            : sd.domain_status === "disabled"
                              ? "readonly"
                              : "candidate"
                        }`}
                      >
                        {sd.domain_status}
                      </span>
                    </div>
                    <div style={{ marginTop: "8px", fontFamily: "monospace", fontSize: "13px", color: "var(--primary-interactive)" }}>
                      @{sd.domain}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                    {sd.domain_status !== "verified" && (
                      <button
                        type="button"
                        className="button button-secondary"
                        style={{ padding: "5px 10px", fontSize: "11px" }}
                        onClick={() => handleUpdateDomainStatus(sd.domain_id, "verified")}
                        disabled={busy || ["ub.edu.ph", "tcc.edu.ph", "pmi-bohol.edu.ph"].includes(sd.domain?.toLowerCase())}
                        title={["ub.edu.ph", "tcc.edu.ph", "pmi-bohol.edu.ph"].includes(sd.domain?.toLowerCase()) ? "Candidate domains cannot be verified" : undefined}
                      >
                        Mark verified
                      </button>
                    )}
                    {sd.domain_status !== "disabled" && (
                      <button
                        type="button"
                        className="button button-secondary"
                        style={{ padding: "5px 10px", fontSize: "11px" }}
                        onClick={() => handleUpdateDomainStatus(sd.domain_id, "disabled")}
                        disabled={busy}
                      >
                        Disable
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* SECTION 4: SECURITY AUDIT LOGS (DATA TABLE & DETAIL MODAL) */}
          <section
            className="staff-panel"
            id="audits"
            style={{ scrollMarginTop: "5rem" }}
          >
            <div className="panel-title-bar">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>4. SECURITY AUDIT LOGS</p>
                <h2 style={{ margin: "4px 0 0" }}>System Audit Trail ({auditLogs.length})</h2>
                <p style={{ margin: "4px 0 0", color: "var(--secondary-text)", fontSize: "13px" }}>
                  Immutable security records of authorization, grant awards, disbursements, and authentication events.
                </p>
              </div>
            </div>

            <DataTable
              columns={auditColumns}
              data={auditLogs}
              keyField="log_id"
              searchPlaceholder="Search audit events by action, actor, or entity..."
              searchFields={["action_type", "entity_type", "actor_email", "actor_first_name", "actor_last_name"]}
              defaultPageSize={10}
              emptyTitle="No audit logs recorded"
              emptyDescription="Security audit events will be logged here as actions are performed in the system."
            />
          </section>
        </>
      )}

      {/* AUDIT LOG DETAILS MODAL */}
      {selectedAuditLog && (
        <ModalDialog
          isOpen={Boolean(selectedAuditLog)}
          onClose={() => setSelectedAuditLog(null)}
          title="Security Audit Log Details"
          subtitle={`Audit Event #${selectedAuditLog.log_id} · Recorded ${formatDateTime(selectedAuditLog.created_at)}`}
          maxWidth="max-w-3xl"
        >
          <div className="audit-detail-card">
            <div className="audit-meta-grid">
              <div className="audit-meta-item">
                <span>Action Type</span>
                <strong style={{ color: "#34d399" }}>{selectedAuditLog.action_type}</strong>
              </div>
              <div className="audit-meta-item">
                <span>Target Entity</span>
                <strong>
                  {selectedAuditLog.entity_type} #{selectedAuditLog.entity_id}
                </strong>
              </div>
              <div className="audit-meta-item">
                <span>Actor / Performed By</span>
                <strong>{selectedAuditLog.actor_email || "System Service"}</strong>
              </div>
              <div className="audit-meta-item">
                <span>Timestamp</span>
                <strong>{formatDateTime(selectedAuditLog.created_at)}</strong>
              </div>
            </div>

            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <strong style={{ fontSize: "13px", color: "var(--main-text)" }}>
                  Event Payload & Context
                </strong>
                <button
                  type="button"
                  className={`copy-chip-btn ${copiedPayload ? "is-copied" : ""}`}
                  onClick={() => handleCopyJsonPayload(selectedAuditLog.details)}
                  title="Copy full JSON payload"
                >
                  {copiedPayload ? (
                    <>
                      <Check size={12} className="copy-icon-success" />
                      <span>JSON Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Copy JSON</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="audit-payload-box">
                {typeof selectedAuditLog.details === "object"
                  ? JSON.stringify(selectedAuditLog.details, null, 2)
                  : String(selectedAuditLog.details || "No details payload recorded.")}
              </pre>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setSelectedAuditLog(null)}
              >
                Close
              </button>
            </div>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
