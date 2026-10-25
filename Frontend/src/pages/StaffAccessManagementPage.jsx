import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
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
  const [copiedEmail, setCopiedEmail] = useState("");
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState("");
  const [issuedInvitation, setIssuedInvitation] = useState(null);

  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [revokeReasonById, setRevokeReasonById] = useState({});
  const [confirmingRevokeId, setConfirmingRevokeId] = useState(null);

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
    // allSettled: one failing endpoint no longer blanks out the whole page,
    // and the error names exactly which part failed.
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
          .join(
            ", ",
          )}. ${failed[0].reason?.message || "Try again in a moment."}`,
      });
    }
  }, []);

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

  // The portal sidebar renders plain "#section" links (ids come from
  // SystemAdminPortalStrategy: invitations, previews, domains, audits).
  // Scroll smoothly to the matching section on this page.
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

  function permissionLabel(key) {
    return (
      lookups.lguPermissionCategories.find((item) => item.key === key)?.label ||
      key
    );
  }

  const filteredAuthorizations = authorizations.filter((auth) => {
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

  return (
    <div className="page-container information-page">
      <PageHeading
        eyebrow="DEVELOPER & SYSTEM ADMIN ACCESS CONTROL"
        title="Staff Access, School Scopes & Audit Logs."
        description="Review authorized staff accounts and their organizational scopes (funding unit, barangay, or school), manage verified school domains, and audit access changes."
      />

      {identityState === "ready" && (
        <section
          className="staff-panel"
          id="previews"
          style={{ scrollMarginTop: "5rem" }}
        >
          <h2>Preview staff dashboards</h2>
          <p>
            Open an active LGU Admin, Barangay Coordinator, or Registrar
            dashboard in read-only mode.
          </p>
          {portalPreviews.length === 0 ? (
            <p className="staff-empty">
              No active staff assignments are available to preview.
            </p>
          ) : (
            <div className="staff-record-list">
              {portalPreviews.map((preview) => {
                const query = new URLSearchParams({
                  previewRole: preview.role_name,
                  previewScopeId: String(preview.scope_id),
                  previewName: preview.displayName,
                });
                return (
                  <article
                    className="staff-record"
                    key={`${preview.role_name}-${preview.user_id}`}
                  >
                    <div>
                      <strong>{preview.displayName}</strong>
                      <p>
                        {preview.email} · {preview.role_name}
                      </p>
                      <p>{preview.scope_name}</p>
                    </div>
                    <Link
                      className="text-link"
                      to={`${preview.dashboard_path}?${query.toString()}`}
                    >
                      Open read-only dashboard
                    </Link>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {identityState === "loading" && (
        <p role="status">Verifying System Admin session...</p>
      )}

      {error && (
        <section className="staff-notice staff-notice-error" role="alert">
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
        <section className="auth-card" role="status">
          <div className="auth-banner auth-banner-success">
            <KeyRound size={18} aria-hidden="true" />
            <div>
              <strong>
                Single-Use Staff Invitation Token ({issuedInvitation.email} ·{" "}
                {issuedInvitation.role})
              </strong>
              <p>
                {issuedInvitation.emailSent
                  ? "An invitation email was dispatched via the configured SMTP provider."
                  : "Automated SMTP email delivery is currently disabled (EMAIL_VERIFICATION_ENABLED=false). GrantWise does not pretend an email was sent. Copy this one-time token and deliver it securely to the invited staff member."}
              </p>
              <p>
                <strong>Invitation Token:</strong>{" "}
                <code>{issuedInvitation.invitationToken}</code>
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
                  navigator.clipboard?.writeText(
                    issuedInvitation.invitationToken,
                  );
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
          <section className="student-profile-summary">
            <div>
              <span className="eyebrow">
                AUTHENTICATED DEVELOPER ADMINISTRATOR
              </span>
              <h2>
                {currentUser?.firstName} {currentUser?.lastName} (
                {currentUser?.email})
              </h2>
              <p>
                Role: {currentUser?.role} · Email Delivery:{" "}
                {lookups.emailDeliveryEnabled
                  ? "Enabled (SMTP)"
                  : "Development / Manual Token Handoff Mode"}
              </p>
            </div>
            <div className="student-profile-meta">
              <button
                type="button"
                className="button button-secondary"
                onClick={loadSystemAdminData}
                disabled={busy}
              >
                <RefreshCw size={15} aria-hidden="true" /> Refresh directory
              </button>
            </div>
          </section>

          <section
            className="auth-card"
            id="invitations"
            style={{ scrollMarginTop: "5rem" }}
          >
            <p className="eyebrow">1. AUTHORIZED STAFF DIRECTORY</p>
            <h2>
              Authorized staff directory ({filteredAuthorizations.length}).
            </h2>

            <div className="form-grid-two">
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
                  <option value="Barangay Coordinator">
                    Barangay Coordinator
                  </option>
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

            <div className="form-field">
              <label className="form-label" htmlFor="filter-search">
                Search by email, barangay, school, or funding unit
              </label>
              <input
                id="filter-search"
                className="form-input"
                placeholder="Search email or scope..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {filteredAuthorizations.length === 0 ? (
              <p>No staff email authorizations match the current filter.</p>
            ) : (
              <div className="portal-grid">
                {filteredAuthorizations.map((auth) => (
                  <article key={auth.authorization_id} className="portal-card">
                    <p className="eyebrow">
                      {auth.role_name} · STATUS:{" "}
                      {String(auth.status).toUpperCase()}
                    </p>
                    <h3>{auth.email}</h3>
                    <p>
                      <strong>Assigned Scope:</strong> {formatScopeLabel(auth)}
                    </p>
                    {auth.position_title && (
                      <p>
                        <strong>Title:</strong> {auth.position_title}
                      </p>
                    )}
                    <p>
                      <strong>Invited:</strong>{" "}
                      {formatDateTime(auth.authorized_at)}
                      {auth.authorized_by_email
                        ? ` by ${auth.authorized_by_email}`
                        : ""}
                    </p>
                    {auth.expires_at && auth.status === "pending" && (
                      <p>
                        <strong>Expires:</strong>{" "}
                        {formatDateTime(auth.expires_at)}
                      </p>
                    )}
                    {auth.activated_at && (
                      <p>
                        <strong>Activated:</strong>{" "}
                        {formatDateTime(auth.activated_at)}
                      </p>
                    )}
                    {auth.revoked_at && (
                      <p>
                        <strong>Revoked:</strong>{" "}
                        {formatDateTime(auth.revoked_at)}
                        {auth.revocation_reason
                          ? ` (${auth.revocation_reason})`
                          : ""}
                      </p>
                    )}

                    <div className="page-actions">
                      {["pending", "expired"].includes(auth.status) && (
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={busy}
                          onClick={() =>
                            handleRegenerateToken(auth.authorization_id)
                          }
                        >
                          <RefreshCw size={14} aria-hidden="true" /> Regenerate
                          token
                        </button>
                      )}

                      {auth.status !== "revoked" && (
                        <>
                          {confirmingRevokeId === auth.authorization_id ? (
                            <div>
                              <input
                                className="form-input"
                                placeholder="Reason for revocation"
                                value={
                                  revokeReasonById[auth.authorization_id] || ""
                                }
                                onChange={(e) =>
                                  setRevokeReasonById((c) => ({
                                    ...c,
                                    [auth.authorization_id]: e.target.value,
                                  }))
                                }
                              />
                              <button
                                type="button"
                                className="button button-primary"
                                disabled={busy}
                                onClick={() =>
                                  handleRevokeAuthorization(
                                    auth.authorization_id,
                                  )
                                }
                              >
                                <XCircle size={14} aria-hidden="true" /> Confirm
                                revoke & kill sessions
                              </button>
                              <button
                                type="button"
                                className="button button-secondary"
                                onClick={() => setConfirmingRevokeId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="button button-secondary"
                              disabled={busy}
                              onClick={() =>
                                setConfirmingRevokeId(auth.authorization_id)
                              }
                            >
                              <XCircle size={14} aria-hidden="true" /> Revoke
                              access
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

          <section
            className="auth-card"
            id="templates"
            style={{ scrollMarginTop: "5rem" }}
          >
            <p className="eyebrow">2. PROPOSED CONFIGURATION TEMPLATES</p>
            <h2>Reference directories (read-only).</h2>

            <h3>LGU Officials & Scholarship Office Templates</h3>
            <ul>
              {lookups.proposedDirectories.lguOfficials.map((item) => (
                <li key={item.proposedEmail}>
                  <strong>{item.positionTitle}</strong> ({item.officialName}) —{" "}
                  <code>{item.proposedEmail}</code>
                  <br />
                  <small>
                    Funding unit: {item.suggestedFundingUnitName} · Suggested
                    access:{" "}
                    {(item.recommendedPermissions || [])
                      .map(permissionLabel)
                      .join(", ") || "None"}
                  </small>{" "}
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => handleCopyEmail(item.proposedEmail)}
                  >
                    {copiedEmail === item.proposedEmail
                      ? "Copied"
                      : "Copy email"}
                  </button>
                </li>
              ))}
            </ul>

            <h3>School Registrar Templates (5 Partner Colleges)</h3>
            <ul>
              {lookups.proposedDirectories.schoolRegistrars.map((item) => (
                <li key={item.proposedEmail}>
                  <strong>{item.displayName}</strong> —{" "}
                  <code>{item.proposedEmail}</code> ({item.candidateDomain}:{" "}
                  {item.defaultDomainStatus}){" "}
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => handleCopyEmail(item.proposedEmail)}
                  >
                    {copiedEmail === item.proposedEmail
                      ? "Copied"
                      : "Copy email"}
                  </button>
                </li>
              ))}
            </ul>

            <h3>15 Tagbilaran Barangay Coordinator Templates</h3>
            <div className="form-grid-two">
              {lookups.proposedDirectories.barangayCoordinators.map((item) => (
                <div key={item.proposedEmail}>
                  <strong>{item.barangayName}:</strong>{" "}
                  <code>{item.proposedEmail}</code>{" "}
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => handleCopyEmail(item.proposedEmail)}
                  >
                    {copiedEmail === item.proposedEmail
                      ? "Copied"
                      : "Copy email"}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <div className="portal-grid">
            <section
              className="auth-card"
              id="domains"
              style={{ scrollMarginTop: "5rem" }}
            >
              <p className="eyebrow">3. SCHOOL EMAIL DOMAINS & HIGH SCHOOLS</p>
              <h2>Configure partner schools & official domains.</h2>
              <p className="field-hint">
                Add a new partner school (including Tagbilaran high schools when
                confirmed) or configure an official school email domain. Do not
                mark a domain as verified until confirmed with the institution.
              </p>

              <form
                onSubmit={handleConfigureSchoolDomain}
                className="auth-form"
              >
                <div className="form-field">
                  <label className="form-label" htmlFor="domain-mode">
                    Target school
                  </label>
                  <select
                    id="domain-mode"
                    className="form-input"
                    value={domainForm.mode}
                    onChange={(e) =>
                      setDomainForm((c) => ({ ...c, mode: e.target.value }))
                    }
                  >
                    <option value="existing">
                      Existing school in database
                    </option>
                    <option value="new">Add new school / high school</option>
                  </select>
                </div>

                {domainForm.mode === "existing" ? (
                  <div className="form-field">
                    <label className="form-label" htmlFor="domain-school-id">
                      Select school
                    </label>
                    <select
                      id="domain-school-id"
                      className="form-input"
                      value={domainForm.schoolId}
                      onChange={(e) =>
                        setDomainForm((c) => ({
                          ...c,
                          schoolId: e.target.value,
                        }))
                      }
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
                      New school or high school name
                    </label>
                    <input
                      id="domain-school-name"
                      className="form-input"
                      placeholder="e.g., Dr. Cecilio Putong National High School"
                      value={domainForm.schoolName}
                      onChange={(e) =>
                        setDomainForm((c) => ({
                          ...c,
                          schoolName: e.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                )}

                <div className="form-grid-two">
                  <div className="form-field">
                    <label className="form-label" htmlFor="domain-value">
                      Official email domain (optional if unknown for high
                      school)
                    </label>
                    <input
                      id="domain-value"
                      className="form-input"
                      placeholder="e.g., hnu.edu.ph"
                      value={domainForm.domain}
                      onChange={(e) =>
                        setDomainForm((c) => ({ ...c, domain: e.target.value }))
                      }
                    />
                  </div>

                  <div className="form-field">
                    <label className="form-label" htmlFor="domain-status">
                      Verification status
                    </label>
                    <select
                      id="domain-status"
                      className="form-input"
                      value={domainForm.domainStatus}
                      onChange={(e) =>
                        setDomainForm((c) => ({
                          ...c,
                          domainStatus: e.target.value,
                        }))
                      }
                    >
                      <option value="verified">Verified</option>
                      <option value="candidate">Candidate (unconfirmed)</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  className="button button-primary"
                  disabled={busy}
                >
                  <ShieldCheck size={16} aria-hidden="true" /> Save school /
                  domain
                </button>
              </form>

              <h3>Configured School Email Domains</h3>
              <ul>
                {schoolDomains.map((sd) => (
                  <li key={sd.domain_id}>
                    <strong>{sd.school_name}:</strong> <code>@{sd.domain}</code>{" "}
                    ({sd.domain_status}){" "}
                    {sd.domain_status !== "verified" && (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() =>
                          handleUpdateDomainStatus(sd.domain_id, "verified")
                        }
                      >
                        Mark verified
                      </button>
                    )}{" "}
                    {sd.domain_status !== "disabled" && (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() =>
                          handleUpdateDomainStatus(sd.domain_id, "disabled")
                        }
                      >
                        Disable
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section
              className="auth-card"
              id="audits"
              style={{ scrollMarginTop: "5rem" }}
            >
              <p className="eyebrow">4. SECURITY AUDIT LOGS</p>
              <h2>Recent authorization & access events.</h2>
              {auditLogs.length === 0 ? (
                <p>No audit logs recorded yet.</p>
              ) : (
                <ul>
                  {auditLogs.slice(0, 15).map((log) => (
                    <li key={log.log_id}>
                      <strong>{log.action_type}</strong> on{" "}
                      <code>{log.entity_type}</code> #{log.entity_id} —{" "}
                      {formatDateTime(log.created_at)}{" "}
                      {log.actor_email ? `by ${log.actor_email}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
