import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  FileCheck,
  FileText,
  GraduationCap,
  KeyRound,
  MailCheck,
  PartyPopper,
  RefreshCw,
  School,
  Send,
  ShieldAlert,
  User,
  UserCheck,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import ApplicationTimeline from "../components/ApplicationTimeline.jsx";
import ModalDialog from "../components/ModalDialog.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingSkeleton from "../components/LoadingSkeleton.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { getPortalPathForRole } from "../services/portalPaths.js";
import { apiRequest } from "../services/api.js";

function statusLabel(status) {
  return String(status || "").replaceAll("_", " ");
}

function formatDocumentType(value) {
  const label = String(value || "Document").replaceAll("_", " ");
  return label.replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function StudentPortalPage() {
  const [searchParams] = useSearchParams();
  const [selectedProgramId, setSelectedProgramId] = useState(
    () => searchParams.get("programId") || "",
  );
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [applications, setApplications] = useState([]);
  const [applicationSubmissionEnabled, setApplicationSubmissionEnabled] =
    useState(false);
  const [details, setDetails] = useState({});
  const [applicationDocuments, setApplicationDocuments] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Email verification state
  const [verificationTokenInput, setVerificationTokenInput] = useState(
    () => searchParams.get("verifyToken") || "",
  );
  const [issuedDevToken, setIssuedDevToken] = useState("");
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);

  // Apply confirmation dialog
  const [confirmApplyProgram, setConfirmApplyProgram] = useState(null);

  const navigate = useNavigate();
  const { addToast } = useToast();

  async function loadData() {
    setLoading(true);
    try {
      const { user } = await apiRequest("auth/me");
      if (user.role !== "Scholar") {
        navigate(getPortalPathForRole(user.role), { replace: true });
        return;
      }
      const [programData, applicationData, profileData] = await Promise.all([
        apiRequest("programs"),
        apiRequest("student/applications"),
        apiRequest("student/profile"),
      ]);

      setCurrentUser(user);
      setPrograms(programData.programs || []);
      setApplicationSubmissionEnabled(
        programData.applicationSubmissionEnabled === true,
      );
      setApplications(applicationData.applications || []);
      setProfile(profileData?.profile || null);
    } catch (requestError) {
      const loadFailureMessage =
        requestError.message || "Could not load your student portal.";
      if (requestError.status === 401) {
        const programId = searchParams.get("programId");
        navigate(
          programId
            ? `/login?programId=${encodeURIComponent(programId)}`
            : "/login",
          {
            replace: true,
          },
        );
      } else {
        setError(loadFailureMessage);
        addToast({
          variant: "error",
          title: "Portal load failed",
          message: loadFailureMessage,
        });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [navigate, searchParams]);

  async function refreshApplications() {
    try {
      const data = await apiRequest("student/applications");
      setApplications(data.applications || []);
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Could not refresh your applications.");
    }
  }

  async function handleRequestVerificationToken() {
    setError("");
    setNotice("");
    setResendingVerification(true);
    try {
      const result = await apiRequest("auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email: currentUser?.email || "" }),
      });
      const devToken =
        result.emailVerification?.verificationToken || result.verificationToken;
      if (devToken) {
        setIssuedDevToken(devToken);
        setVerificationTokenInput(devToken);
      }
      setNotice(
        result.message ||
          "Verification token generated. Enter the token below to confirm email ownership.",
      );
    } catch (requestError) {
      setError(
        requestError.message ||
          "Could not issue an email verification token at this time.",
      );
    } finally {
      setResendingVerification(false);
    }
  }

  async function handleVerifyEmail(event) {
    if (event) event.preventDefault();
    setError("");
    setNotice("");
    const trimmedToken = verificationTokenInput.trim();
    if (!trimmedToken) {
      setError("Please enter your verification token.");
      return;
    }
    setVerifyingEmail(true);
    try {
      const result = await apiRequest("auth/verify-email", {
        method: "POST",
        body: JSON.stringify({
          email: currentUser?.email || "",
          verificationToken: trimmedToken,
        }),
      });
      const refreshed = await apiRequest("auth/me");
      setCurrentUser(refreshed.user || currentUser);
      setIssuedDevToken("");
      setVerificationTokenInput("");
      setEmailModalOpen(false);
      setNotice(
        result.message ||
          "Email ownership verified! Your account is now confirmed.",
      );
    } catch (requestError) {
      setError(
        requestError.message ||
          "Email verification failed. Check that your token is valid and unexpired.",
      );
    } finally {
      setVerifyingEmail(false);
    }
  }

  async function executeSubmitApplication(numericProgramId) {
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      const result = await apiRequest("student/applications", {
        method: "POST",
        body: JSON.stringify({ programId: numericProgramId }),
      });
      await refreshApplications();
      const successMessage =
        "Application submitted successfully! Your application is now queued for municipal review.";
      setNotice(successMessage);
      addToast({
        variant: "success",
        title: "Application submitted",
        message: successMessage,
      });
      setSelectedProgramId("");
      setConfirmApplyProgram(null);
    } catch (requestError) {
      const errorMessage = requestError.message || "Could not submit your application.";
      setError(errorMessage);
      addToast({
        variant: "error",
        title: "Application not submitted",
        message: errorMessage,
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleDetails(applicationId) {
    if (details[applicationId]) {
      setDetails((current) => {
        const next = { ...current };
        delete next[applicationId];
        return next;
      });
      return;
    }
    setLoadingDetail(applicationId);
    setError("");
    try {
      const [detailResult, documentResult] = await Promise.all([
        apiRequest(`student/applications/${applicationId}`),
        apiRequest(`student/applications/${applicationId}/documents`),
      ]);
      setDetails((current) => ({
        ...current,
        [applicationId]: detailResult,
      }));
      setApplicationDocuments((current) => ({
        ...current,
        [applicationId]: Array.isArray(documentResult?.documents)
          ? documentResult.documents
          : [],
      }));
    } catch (requestError) {
      setError(
        requestError.message ||
          "Could not load application verification records.",
      );
    } finally {
      setLoadingDetail(null);
    }
  }

  const openPrograms = programs.filter(
    (program) => program.availability === "open",
  );
  const appliedProgramIds = new Set(
    applications
      .filter((app) => app.application_status !== "withdrawn")
      .map((app) => Number(app.program_id)),
  );

  return (
    <div className="student-portal-workspace">
      {/* Workspace Header */}
      <div className="workspace-header">
        <div>
          <PageHeading
            eyebrow="STUDENT SCHOLAR PORTAL"
            title="Scholarship Portal & Applications"
            description="Apply for open educational assistance programs, track multi-stage municipal verification, and view grant awards."
          />
        </div>
        <div className="workspace-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={loadData}
            disabled={loading}
          >
            <RefreshCw
              size={15}
              className={loading ? "spin" : ""}
              aria-hidden="true"
            />
            <span>Refresh Portal</span>
          </button>
        </div>
      </div>

      {/* Notices */}
      {error && (
        <div className="staff-notice staff-notice-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>Application Notice</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {notice && (
        <div className="staff-notice staff-notice-success" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <p>{notice}</p>
        </div>
      )}

      {loading && <LoadingSkeleton type="stats" />}

      {!loading && (
        <div className="workspace-body">
          {/* Scholar Profile Card */}
          <div className="student-profile-hero">
            <div className="profile-hero-left">
              <div className="profile-hero-avatar">
                {currentUser?.firstName?.charAt(0) || "S"}
              </div>
              <div className="profile-hero-details">
                <div className="flex items-center gap-2">
                  <h2 className="profile-hero-name">
                    {currentUser?.firstName} {currentUser?.lastName}
                  </h2>
                  <span className="profile-hero-badge">
                    Scholar / Applicant
                  </span>
                </div>
                <div className="profile-hero-meta">
                  <span>
                    Student ID:{" "}
                    <strong>{profile?.student_number || "Not assigned"}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    School:{" "}
                    <strong>
                      {profile?.school_name || "Tagbilaran Institution"}
                    </strong>
                  </span>
                  <span>·</span>
                  <span>
                    Residency:{" "}
                    <strong>
                      Brgy. {profile?.barangay_name || "Tagbilaran"}
                    </strong>
                  </span>
                  <span>·</span>
                  <span>
                    Curriculum:{" "}
                    <strong>
                      {profile?.course || "College"} (
                      {profile?.year_level || "1st Year"})
                    </strong>
                  </span>
                </div>
              </div>
            </div>

            <div className="profile-hero-right">
              {currentUser?.emailVerified ? (
                <div className="email-status-pill verified">
                  <MailCheck size={16} aria-hidden="true" />
                  <span>Email Verified</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="button button-outline button-sm text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800"
                  onClick={() => setEmailModalOpen(true)}
                >
                  <KeyRound size={14} aria-hidden="true" />
                  <span>Verify Student Email</span>
                </button>
              )}
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="stats-grid-4">
            <StatCard
              title="Active Applications"
              value={applications.length}
              subtext="Under municipal review"
              icon={FileText}
            />
            <StatCard
              title="Open Programs"
              value={openPrograms.length}
              subtext="Currently accepting applications"
              icon={GraduationCap}
              variant="success"
            />
            <StatCard
              title="Approved Awards"
              value={
                applications.filter((a) => a.application_status === "approved")
                  .length
              }
              subtext="Committed scholarship grants"
              icon={CheckCircle2}
              variant="success"
            />
            <StatCard
              title="Submission Status"
              value={applicationSubmissionEnabled ? "Active" : "Closed"}
              subtext="Online portal engine"
              icon={Send}
              variant={applicationSubmissionEnabled ? "info" : "default"}
            />
          </div>

          {/* HIGHLIGHTED BANNER CARD: READY TO CLAIM AT BARANGAY HALL */}
          {applications.some((app) => app.application_status === "approved") && (
            <div className="mb-6 overflow-hidden rounded-2xl border-2 border-emerald-500/50 bg-gradient-to-br from-emerald-50/90 via-teal-50/50 to-emerald-100/60 p-6 shadow-sm dark:border-emerald-500/40 dark:from-emerald-950/60 dark:via-emerald-900/30 dark:to-teal-950/40">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-600/25">
                  <PartyPopper className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-200 mb-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Scholarship Granted — Ready to Claim
                  </div>
                  <h3 className="text-xl font-bold text-gray-950 dark:text-white">
                    Congratulations, {profile?.first_name || currentUser?.firstName || "Scholar"}!
                  </h3>
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                    Your scholarship application has been officially approved by the Tagbilaran City LGU. Your grant is now released and ready for claiming at your designated barangay office.
                  </p>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex items-start gap-3 rounded-xl border border-emerald-200/80 bg-white/90 p-3.5 shadow-xs dark:border-emerald-800/60 dark:bg-gray-800/90">
                      <Building2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          Claim Location
                        </span>
                        <span className="font-bold text-gray-900 dark:text-white text-sm">
                          Brgy. {applications.find((a) => a.application_status === "approved")?.barangay_name || profile?.barangay_name || "Manga"} Hall / Office
                        </span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Barangay Education &amp; Scholarship Desk
                        </span>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 rounded-xl border border-emerald-200/80 bg-white/90 p-3.5 shadow-xs dark:border-emerald-800/60 dark:bg-gray-800/90">
                      <FileCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          Claim Requirements
                        </span>
                        <span className="block text-xs leading-relaxed text-gray-800 dark:text-gray-200 mt-0.5">
                          Please bring your <strong>valid student ID</strong> and <strong>certificate of enrollment (COR)</strong> to your Barangay Hall to claim your educational assistance.
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* List of approved applications with amounts */}
                  <div className="mt-4 space-y-2">
                    {applications
                      .filter((a) => a.application_status === "approved")
                      .map((app) => (
                        <div
                          key={app.application_id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-100/60 px-3.5 py-2 text-xs text-emerald-950 dark:border-emerald-800/60 dark:bg-emerald-900/40 dark:text-emerald-100"
                        >
                          <div className="font-medium">
                            <strong>{app.program_name}</strong> (App #{app.application_id})
                          </div>
                          {app.award_amount && (
                            <div className="font-bold text-emerald-700 dark:text-emerald-300">
                              Grant Amount: ₱{Number(app.award_amount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION: MY APPLICATIONS */}
          <section className="staff-panel" id="overview">
            <div className="panel-title-bar">
              <div>
                <h2>My Scholarship Applications</h2>
                <p className="text-muted text-xs">
                  Review the real-time lifecycle stages for all your submitted
                  applications.
                </p>
              </div>
            </div>

            {applications.length === 0 ? (
              <EmptyState
                icon={FileCheck}
                title="No applications submitted yet"
                description="Explore the open programs below and submit your first scholarship application."
              />
            ) : (
              <div className="space-y-6">
                {applications.map((app) => {
                  const detail = details[app.application_id];
                  const isLoadingThis = loadingDetail === app.application_id;

                  return (
                    <div
                      key={app.application_id}
                      className="application-scholar-card"
                    >
                      <div className="app-card-top">
                        <div>
                          <span className="app-card-eyebrow">
                            APPLICATION #{app.application_id}
                          </span>
                          <h3 className="app-card-title">{app.program_name}</h3>
                          <div className="app-card-meta">
                            <span>Cycle: {app.funding_cycle || "Current"}</span>
                            <span>·</span>
                            <span>
                              Submitted:{" "}
                              {app.submitted_at
                                ? new Date(app.submitted_at).toLocaleDateString(
                                    "en-PH",
                                  )
                                : "Draft"}
                            </span>
                            <span>·</span>
                            <span>
                              Barangay: Brgy.{" "}
                              {app.barangay_name || profile?.barangay_name}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <StatusBadge status={app.application_status} />
                          <button
                            type="button"
                            className="button button-outline button-sm"
                            onClick={() => toggleDetails(app.application_id)}
                            disabled={isLoadingThis}
                          >
                            {isLoadingThis
                              ? "Loading..."
                              : detail
                                ? "Hide Details"
                                : "View Verification Trail"}
                          </button>
                        </div>
                      </div>

                      {/* Approved & Ready to Claim Callout */}
                      {app.application_status === "approved" && (
                        <div className="mt-3 mb-4 rounded-xl border border-emerald-300 bg-emerald-50/90 p-4 dark:border-emerald-800/70 dark:bg-emerald-950/40">
                          <div className="flex items-start gap-3">
                            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                            <div className="text-xs text-emerald-900 dark:text-emerald-200 space-y-1">
                              <div className="font-bold text-sm text-emerald-950 dark:text-emerald-100">
                                Grant Approved — Ready to Claim
                              </div>
                              <p className="leading-relaxed">
                                Your educational assistance grant has been approved and is ready to claim at{" "}
                                <strong>Brgy. {app.barangay_name || profile?.barangay_name} Hall/Office</strong>.
                              </p>
                              <p className="inline-block rounded-md bg-white/80 dark:bg-emerald-900/60 px-2.5 py-1.5 font-medium border border-emerald-200/60 dark:border-emerald-800/50">
                                📋 <strong>Required Documents to Bring:</strong> Please present your <u>valid student ID</u> and <u>certificate of enrollment (COR)</u> upon claiming.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Visual Timeline Stepper */}
                      <ApplicationTimeline
                        status={app.application_status}
                        submittedAt={app.submitted_at}
                        reviewedAt={app.reviewed_at}
                        remarks={app.remarks}
                        verifications={detail?.verifications || []}
                      />

                      {/* Expanded Details Drawer */}
                      {detail && (
                        <div className="app-card-details-expanded">
                          <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">
                            Verification Breakdown & Audit
                          </h4>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {(detail.verifications || []).map((v) => (
                              <div
                                key={v.verification_type}
                                className="p-3 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] text-xs"
                              >
                                <div className="flex justify-between items-center mb-1">
                                  <strong className="capitalize">
                                    {v.verification_type} Verification
                                  </strong>
                                  <StatusBadge
                                    status={v.status}
                                    type="verification"
                                  />
                                </div>
                                <p className="text-muted m-0">
                                  {v.remarks
                                    ? `"${v.remarks}"`
                                    : "Pending reviewer remarks."}
                                </p>
                                {v.reviewed_at && (
                                  <span className="text-[10px] text-muted block mt-1">
                                    {new Date(v.reviewed_at).toLocaleString(
                                      "en-PH",
                                    )}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>

                          <div className="mt-4">
                            <h5 className="text-[11px] font-bold uppercase tracking-wider text-muted mb-2">
                              Application Documents
                            </h5>

                            {(applicationDocuments[app.application_id] || []).length === 0 ? (
                              <p className="text-xs text-muted m-0">
                                No documents recorded for this application
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {(applicationDocuments[app.application_id] || []).map((document) => {
                                  const isVerified = Boolean(document.is_verified);
                                  return (
                                    <div
                                      key={document.document_id}
                                      className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--surface)] px-3 py-2"
                                    >
                                      <div className="min-w-0">
                                        <div className="font-medium text-sm">
                                          {formatDocumentType(document.document_type)}
                                        </div>
                                        <div className="text-[11px] text-muted">
                                          {document.uploaded_at
                                            ? new Date(document.uploaded_at).toLocaleString("en-PH")
                                            : "Date unavailable"}
                                        </div>
                                      </div>
                                      <span
                                        className={`status-badge ${
                                          isVerified
                                            ? "status-badge-success"
                                            : "status-badge-warning"
                                        }`}
                                        role="status"
                                      >
                                        {isVerified ? "Verified" : "Pending"}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* SECTION: OPEN SCHOLARSHIP PROGRAMS */}
          <section className="staff-panel" id="programs">
            <div className="panel-title-bar">
              <div>
                <h2>Available Tagbilaran Scholarship Programs</h2>
                <p className="text-muted text-xs">
                  Programs currently open for application from participating
                  funding units.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {openPrograms.map((prog) => {
                const isAlreadyApplied = appliedProgramIds.has(
                  Number(prog.program_id),
                );
                return (
                  <div key={prog.program_id} className="program-scholar-card">
                    <div className="program-scholar-badge">
                      <GraduationCap size={16} />
                      <span>{prog.funding_unit_name || "LGU Tagbilaran"}</span>
                    </div>

                    <h3 className="program-scholar-title">
                      {prog.program_name}
                    </h3>
                    <p className="program-scholar-cycle">
                      Cycle: {prog.funding_cycle || "2026"}
                    </p>

                    <div className="program-scholar-dates">
                      <Calendar size={13} aria-hidden="true" />
                      <span>
                        {prog.start_date
                          ? new Date(prog.start_date).toLocaleDateString(
                              "en-PH",
                            )
                          : "Open"}{" "}
                        –{" "}
                        {prog.end_date
                          ? new Date(prog.end_date).toLocaleDateString("en-PH")
                          : "Open until filled"}
                      </span>
                    </div>

                    <div className="program-scholar-footer">
                      {isAlreadyApplied ? (
                        <div className="already-applied-pill">
                          <CheckCircle2 size={14} />
                          <span>Application Submitted</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="button button-primary button-sm w-full"
                          onClick={() => setConfirmApplyProgram(prog)}
                          disabled={!applicationSubmissionEnabled || submitting}
                        >
                          <Send size={14} aria-hidden="true" />
                          <span>Apply for Program</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* =====================================================================
         MODAL: EMAIL VERIFICATION
         ===================================================================== */}
      <ModalDialog
        isOpen={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        title="Verify Student Email Ownership"
        subtitle={`Verifying ownership for ${currentUser?.email}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleVerifyEmail} className="space-y-4">
          <p className="text-xs text-muted leading-relaxed">
            GrantWise sends a verification token to verify your school or
            personal Gmail account. This confirms account ownership; your school
            registrar performs academic verification separately.
          </p>

          <div className="form-field">
            <label className="form-label">Verification Token</label>
            <input
              required
              placeholder="Paste 64-character token"
              value={verificationTokenInput}
              onChange={(e) => setVerificationTokenInput(e.target.value)}
            />
          </div>

          {issuedDevToken && (
            <div className="p-3 rounded-lg bg-[var(--hover-bg)] border border-[var(--border-color)] text-xs font-mono break-all">
              <span className="text-muted block text-[10px]">
                Development Token:
              </span>
              {issuedDevToken}
            </div>
          )}

          <div className="flex justify-between items-center pt-2">
            <button
              type="button"
              className="button button-outline button-sm"
              onClick={handleRequestVerificationToken}
              disabled={resendingVerification}
            >
              {resendingVerification ? "Generating..." : "Generate New Token"}
            </button>

            <button
              type="submit"
              className="button button-primary"
              disabled={verifyingEmail || !verificationTokenInput.trim()}
            >
              {verifyingEmail ? "Verifying..." : "Verify Ownership"}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* =====================================================================
         CONFIRMATION DIALOG: APPLY FOR PROGRAM
         ===================================================================== */}
      {confirmApplyProgram && (
        <ConfirmDialog
          isOpen={Boolean(confirmApplyProgram)}
          onClose={() => setConfirmApplyProgram(null)}
          onConfirm={() =>
            executeSubmitApplication(Number(confirmApplyProgram.program_id))
          }
          title="Submit Scholarship Application"
          message={`Are you ready to submit your application for '${confirmApplyProgram.program_name}'? Your verified student profile and residency credentials will be forwarded to your Barangay Coordinator and School Registrar.`}
          confirmText="Confirm & Submit Application"
          variant="primary"
          busy={submitting}
        />
      )}
    </div>
  );
}
