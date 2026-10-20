import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
import { apiRequest } from "../services/api.js";

const ROLE_OPTIONS = [
  { value: "LGU Admin", label: "LGU Program Admin (Funding-Unit Scoped)" },
  { value: "Barangay Coordinator", label: "Barangay Coordinator (Barangay Scoped)" },
  { value: "Registrar", label: "School Registrar (School Scoped)" },
];

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
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState("");
  const [issuedInvitation, setIssuedInvitation] = useState(null);

  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [revokeReasonById, setRevokeReasonById] = useState({});
  const [confirmingRevokeId, setConfirmingRevokeId] = useState(null);

  const [inviteForm, setInviteForm] = useState({
    email: "",
    role: "LGU Admin",
    fundingUnitId: "",
    barangayId: "",
    schoolId: "",
    positionTitle: "",
    expiresInHours: "72",
    notes: "",
    lguPermissions: {
      read_only_reports: true,
      program_management: true,
      application_review: true,
      award_approval: true,
      disbursement_release: false,
    },
  });

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
    try {
      const [lookupData, authData, domainData, auditData, previewData] = await Promise.all([
        apiRequest("system-admin/lookups"),
        apiRequest("system-admin/staff-authorizations"),
        apiRequest("system-admin/school-domains"),
        apiRequest("system-admin/audit-logs"),
        apiRequest("system-admin/portal-previews"),
      ]);
      setLookups((current) => ({ ...current, ...lookupData }));
      setAuthorizations(authData.authorizations || []);
      setSchoolDomains(domainData.schoolDomains || []);
      setAuditLogs(auditData.auditLogs || []);
      setPortalPreviews(previewData.previews || []);
    } catch (requestError) {
      setError({
        status: requestError.status,
        title: "Could not load Staff Access Management data.",
        message: requestError.message || "Try again in a moment.",
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

  function applyTemplate(template, role) {
    setError(null);
    setSuccess("");
    if (role === "LGU Admin") {
      const matchedUnit = lookups.fundingUnits.find(
        (u) =>
          u.funding_unit_name.toLowerCase() ===
          String(template.suggestedFundingUnitName || "").toLowerCase(),
      );
      const perms = {
        read_only_reports: false,
        program_management: false,
        application_review: false,
        award_approval: false,
        disbursement_release: false,
      };
      for (const key of template.recommendedPermissions || []) {
        if (key in perms) perms[key] = true;
      }
      setInviteForm((current) => ({
        ...current,
        email: template.proposedEmail,
        role: "LGU Admin",
        fundingUnitId: matchedUnit ? String(matchedUnit.funding_unit_id) : "",
        barangayId: "",
        schoolId: "",
        positionTitle: template.positionTitle || "",
        notes: template.verificationNote || "",
        lguPermissions: perms,
      }));
    } else if (role === "Barangay Coordinator") {
      const matchedBarangay = lookups.barangays.find(
        (b) =>
          b.barangay_name.toLowerCase() ===
          String(template.barangayName || "").toLowerCase(),
      );
      setInviteForm((current) => ({
        ...current,
        email: template.proposedEmail,
        role: "Barangay Coordinator",
        fundingUnitId: "",
        barangayId: matchedBarangay ? String(matchedBarangay.barangay_id) : "",
        schoolId: "",
        positionTitle: `Barangay ${template.barangayName} Scholarship Coordinator`,
        notes: "Proposed barangay coordinator directory entry — requires email ownership verification.",
      }));
    } else if (role === "Registrar") {
      const matchedSchool = lookups.schools.find(
        (s) =>
          s.school_name.toLowerCase() ===
          String(template.dbSchoolName || "").toLowerCase(),
      );
      setInviteForm((current) => ({
        ...current,
        email: template.proposedEmail,
        role: "Registrar",
        fundingUnitId: "",
        barangayId: "",
        schoolId: matchedSchool ? String(matchedSchool.school_id) : "",
        positionTitle: `${template.displayName} Registrar`,
        notes: `Scoped strictly to ${template.intendedAccess}.`,
      }));
    }
  }

  async function handleCreateAuthorization(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess("");
    setIssuedInvitation(null);

    try {
      const payload = {
        email: inviteForm.email.trim().toLowerCase(),
        role: inviteForm.role,
        positionTitle: inviteForm.positionTitle.trim() || null,
        expiresInHours: Number(inviteForm.expiresInHours) || 72,
        notes: inviteForm.notes.trim() || null,
      };
      if (inviteForm.role === "LGU Admin") {
        payload.fundingUnitId = Number(inviteForm.fundingUnitId);
        payload.lguPermissions = inviteForm.lguPermissions;
      } else if (inviteForm.role === "Barangay Coordinator") {
        payload.barangayId = Number(inviteForm.barangayId);
      } else if (inviteForm.role === "Registrar") {
        payload.schoolId = Number(inviteForm.schoolId);
      }

      const result = await apiRequest("system-admin/staff-authorizations", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setSuccess(result.message || "Staff email authorization created.");
      setIssuedInvitation({
        email: result.authorization.email,
        role: result.authorization.role_name,
        invitationToken: result.invitationToken,
        emailSent: Boolean(result.emailDelivery?.emailSent),
        expiresAt: result.authorization.expires_at,
      });
      setInviteForm((current) => ({
        ...current,
        email: "",
        positionTitle: "",
        notes: "",
      }));
      await loadSystemAdminData();
    } catch (requestError) {
      setError({
        status: requestError.status,
        title: "Could not authorize staff email.",
        message: requestError.message || "Check the form fields and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

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
        title="Staff Email Allowlist, Invitations & School Scopes."
        description="Authorize specific staff email addresses, bind each invitation to a single role and organizational scope (funding unit, barangay, or school), manage verified school domains, and audit access changes."
      />

      {identityState === "ready" && (
        <section className="staff-panel">
          <h2>Preview staff dashboards</h2>
          <p>
            Open an active LGU Admin, Barangay Coordinator, or Registrar
            dashboard in read-only mode.
          </p>
          {portalPreviews.length === 0 ? (
            <p className="staff-empty">No active staff assignments are available to preview.</p>
          ) : (
            <div className="staff-record-list">
              {portalPreviews.map((preview) => {
                const query = new URLSearchParams({
                  previewRole: preview.role_name,
                  previewScopeId: String(preview.scope_id),
                  previewName: preview.displayName,
                });
                return (
                  <article className="staff-record" key={`${preview.role_name}-${preview.user_id}`}>
                    <div>
                      <strong>{preview.displayName}</strong>
                      <p>{preview.email} · {preview.role_name}</p>
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
          <section className="student-profile-summary">
            <div>
              <span className="eyebrow">AUTHENTICATED DEVELOPER ADMINISTRATOR</span>
              <h2>
                {currentUser?.firstName} {currentUser?.lastName} ({currentUser?.email})
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

          <div className="portal-grid">
            <section className="auth-card">
              <p className="eyebrow">1. AUTHORIZE & INVITE STAFF MEMBER</p>
              <h2>Add email to staff allowlist.</h2>
              <p className="field-hint">
                Only explicitly authorized email addresses can register for a
                staff role via <code>/staff-register</code>. Every staff account
                is bound to a single organizational scope on the backend.
              </p>

              <form onSubmit={handleCreateAuthorization} className="auth-form">
                <div className="form-field">
                  <label className="form-label" htmlFor="invite-email">
                    Staff email address
                  </label>
                  <input
                    id="invite-email"
                    className="form-input"
                    type="email"
                    placeholder="shareerizal@admin.com or registrar@hnu.edu.ph"
                    value={inviteForm.email}
                    onChange={(e) =>
                      setInviteForm((c) => ({ ...c, email: e.target.value }))
                    }
                    onBlur={(e) =>
                      setInviteForm((c) => ({
                        ...c,
                        email: e.target.value.trim().toLowerCase(),
                      }))
                    }
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="invite-role">
                    Permitted staff role
                  </label>
                  <select
                    id="invite-role"
                    className="form-input"
                    value={inviteForm.role}
                    onChange={(e) =>
                      setInviteForm((c) => ({
                        ...c,
                        role: e.target.value,
                        fundingUnitId: "",
                        barangayId: "",
                        schoolId: "",
                      }))
                    }
                    required
                  >
                    {ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {inviteForm.role === "LGU Admin" && (
                  <>
                    <div className="form-field">
                      <label className="form-label" htmlFor="invite-funding-unit">
                        Assigned funding unit (required)
                      </label>
                      <select
                        id="invite-funding-unit"
                        className="form-input"
                        value={inviteForm.fundingUnitId}
                        onChange={(e) =>
                          setInviteForm((c) => ({
                            ...c,
                            fundingUnitId: e.target.value,
                          }))
                        }
                        required
                      >
                        <option value="">Select one authorized funding unit</option>
                        {lookups.fundingUnits.map((unit) => (
                          <option
                            key={unit.funding_unit_id}
                            value={unit.funding_unit_id}
                          >
                            {unit.funding_unit_name} ({unit.funding_unit_code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-field">
                      <span className="form-label">
                        Granular LGU permissions (least-privilege scope)
                      </span>
                      <div className="password-checklist">
                        {lookups.lguPermissionCategories.map((perm) => (
                          <label key={perm.key} className="form-label">
                            <input
                              type="checkbox"
                              checked={Boolean(
                                inviteForm.lguPermissions[perm.key],
                              )}
                              onChange={(e) =>
                                setInviteForm((c) => ({
                                  ...c,
                                  lguPermissions: {
                                    ...c.lguPermissions,
                                    [perm.key]: e.target.checked,
                                  },
                                }))
                              }
                            />{" "}
                            <strong>{perm.label}</strong> — {perm.description}
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {inviteForm.role === "Barangay Coordinator" && (
                  <div className="form-field">
                    <label className="form-label" htmlFor="invite-barangay">
                      Assigned Tagbilaran barangay (required)
                    </label>
                    <select
                      id="invite-barangay"
                      className="form-input"
                      value={inviteForm.barangayId}
                      onChange={(e) =>
                        setInviteForm((c) => ({
                          ...c,
                          barangayId: e.target.value,
                        }))
                      }
                      required
                    >
                      <option value="">Select one authorized barangay</option>
                      {lookups.barangays.map((b) => (
                        <option key={b.barangay_id} value={b.barangay_id}>
                          {b.barangay_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {inviteForm.role === "Registrar" && (
                  <div className="form-field">
                    <label className="form-label" htmlFor="invite-school">
                      Assigned school (required)
                    </label>
                    <select
                      id="invite-school"
                      className="form-input"
                      value={inviteForm.schoolId}
                      onChange={(e) =>
                        setInviteForm((c) => ({
                          ...c,
                          schoolId: e.target.value,
                        }))
                      }
                      required
                    >
                      <option value="">Select one authorized school</option>
                      {lookups.schools.map((s) => (
                        <option key={s.school_id} value={s.school_id}>
                          {s.school_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="form-grid-two">
                  <div className="form-field">
                    <label className="form-label" htmlFor="invite-position">
                      Position / office title
                    </label>
                    <input
                      id="invite-position"
                      className="form-input"
                      placeholder="e.g., Scholarship Program Officer"
                      value={inviteForm.positionTitle}
                      onChange={(e) =>
                        setInviteForm((c) => ({
                          ...c,
                          positionTitle: e.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="form-field">
                    <label className="form-label" htmlFor="invite-expiration">
                      Invitation expiration (hours)
                    </label>
                    <input
                      id="invite-expiration"
                      className="form-input"
                      type="number"
                      min="1"
                      max="720"
                      value={inviteForm.expiresInHours}
                      onChange={(e) =>
                        setInviteForm((c) => ({
                          ...c,
                          expiresInHours: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="invite-notes">
                    Authorization notes / audit remarks
                  </label>
                  <input
                    id="invite-notes"
                    className="form-input"
                    placeholder="Optional notes on office authorization"
                    value={inviteForm.notes}
                    onChange={(e) =>
                      setInviteForm((c) => ({ ...c, notes: e.target.value }))
                    }
                  />
                </div>

                <button
                  type="submit"
                  className="button button-primary"
                  disabled={busy}
                >
                  <UserPlus size={16} aria-hidden="true" /> Authorize & issue
                  invitation
                </button>
              </form>
            </section>

            <section className="auth-card">
              <p className="eyebrow">2. PROPOSED CONFIGURATION TEMPLATES</p>
              <h2>Reference directories (not auto-activated).</h2>
              <div className="auth-banner auth-banner-error">
                <ShieldAlert size={18} aria-hidden="true" />
                <div>
                  <strong>Unverified placeholder warning</strong>
                  <p>
                    Entries below are configuration templates only. None of
                    these accounts are created automatically; clicking a
                    template only pre-fills the form on the left so an
                    authorized developer can review and issue a single-use
                    verification invitation.
                  </p>
                </div>
              </div>

              <h3>LGU Officials & Scholarship Office Templates</h3>
              <ul>
                {lookups.proposedDirectories.lguOfficials.map((item) => (
                  <li key={item.proposedEmail}>
                    <strong>{item.positionTitle}</strong> ({item.officialName}) —{" "}
                    <code>{item.proposedEmail}</code>{" "}
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => applyTemplate(item, "LGU Admin")}
                    >
                      Pre-fill form
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
                      onClick={() => applyTemplate(item, "Registrar")}
                    >
                      Pre-fill form
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
                      onClick={() =>
                        applyTemplate(item, "Barangay Coordinator")
                      }
                    >
                      Use
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="auth-card">
            <p className="eyebrow">3. STAFF EMAIL ALLOWLIST & INVITATION STATUS</p>
            <h2>Authorized staff directory ({filteredAuthorizations.length}).</h2>

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
                  <article
                    key={auth.authorization_id}
                    className="portal-card"
                  >
                    <p className="eyebrow">
                      {auth.role_name} · STATUS: {String(auth.status).toUpperCase()}
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
                      <strong>Invited:</strong> {formatDateTime(auth.authorized_at)}
                      {auth.authorized_by_email
                        ? ` by ${auth.authorized_by_email}`
                        : ""}
                    </p>
                    {auth.expires_at && auth.status === "pending" && (
                      <p>
                        <strong>Expires:</strong> {formatDateTime(auth.expires_at)}
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
                        <strong>Revoked:</strong> {formatDateTime(auth.revoked_at)}
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

          <div className="portal-grid">
            <section className="auth-card">
              <p className="eyebrow">4. SCHOOL EMAIL DOMAINS & HIGH SCHOOLS</p>
              <h2>Configure partner schools & official domains.</h2>
              <p className="field-hint">
                Add a new partner school (including Tagbilaran high schools when
                confirmed) or configure an official school email domain. Do not
                mark a domain as verified until confirmed with the institution.
              </p>

              <form onSubmit={handleConfigureSchoolDomain} className="auth-form">
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
                    <option value="existing">Existing school in database</option>
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
                      Official email domain (optional if unknown for high school)
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

            <section className="auth-card">
              <p className="eyebrow">5. SECURITY AUDIT LOGS</p>
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
