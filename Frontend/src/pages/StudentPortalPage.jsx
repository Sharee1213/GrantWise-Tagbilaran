import React, { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, MailCheck, ShieldAlert } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
import { getPortalPathForRole } from "./LoginPage.jsx";
import { apiRequest } from "../services/api.js";

function statusLabel(status) {
  return String(status || "").replaceAll("_", " ");
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
  const [applicationSubmissionEnabled, setApplicationSubmissionEnabled] = useState(false);
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [verificationTokenInput, setVerificationTokenInput] = useState(
    () => searchParams.get("verifyToken") || "",
  );
  const [issuedDevToken, setIssuedDevToken] = useState("");
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { user } = await apiRequest("auth/me");
        if (user.role !== "Scholar") {
          navigate(getPortalPathForRole(user.role), { replace: true });
          return;
        }
        const [programData, applicationData, profileData] = await Promise.all([
          apiRequest("programs"),
          apiRequest("student/applications"),
          apiRequest("student/profile").catch(() => ({ profile: null })),
        ]);
        if (active) {
          setCurrentUser(user);
          setPrograms(programData.programs || []);
          setApplicationSubmissionEnabled(
            programData.applicationSubmissionEnabled === true,
          );
          setApplications(applicationData.applications || []);
          setProfile(profileData?.profile || null);
        }
      } catch (requestError) {
        if (active && requestError.status === 401) {
          const programId = searchParams.get("programId");
          navigate(programId ? `/login?programId=${encodeURIComponent(programId)}` : "/login", {
            replace: true,
          });
        } else if (active) {
          setError(requestError.message || "Could not load your student portal.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [navigate, searchParams]);

  async function refreshApplications() {
    const data = await apiRequest("student/applications");
    setApplications(data.applications || []);
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
          "Verification token generated. Enter the token below to verify your email ownership.",
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
    event.preventDefault();
    setError("");
    setNotice("");
    const trimmedToken = verificationTokenInput.trim();
    if (!trimmedToken) {
      setError("Enter your email verification token.");
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
      setNotice(
        result.message ||
          "Email ownership verified. Note: School Registrar enrollment verification is still completed separately by your school registrar.",
      );
    } catch (requestError) {
      setError(
        requestError.message ||
          "Email verification failed. Check that your token is valid and has not expired.",
      );
    } finally {
      setVerifyingEmail(false);
    }
  }

  async function submitApplication(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    const numericProgramId = Number(selectedProgramId);
    if (!Number.isSafeInteger(numericProgramId) || numericProgramId < 1) {
      setError("Please select a valid open scholarship program.");
      return;
    }

    const alreadyApplied = applications.some(
      (app) =>
        Number(app.program_id) === numericProgramId &&
        app.application_status !== "withdrawn",
    );
    if (alreadyApplied) {
      setError("You already have an active application for this program.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiRequest("student/applications", {
        method: "POST",
        body: JSON.stringify({ programId: numericProgramId }),
      });
      await refreshApplications();
      setNotice(
        `Application submitted. Current status: ${statusLabel(
          result.application.application_status,
        )}.`,
      );
      setSelectedProgramId("");
    } catch (requestError) {
      setError(requestError.message || "Could not submit your application.");
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
      const result = await apiRequest(`student/applications/${applicationId}`);
      setDetails((current) => ({
        ...current,
        [applicationId]: result,
      }));
    } catch (requestError) {
      setError(requestError.message || "Could not load application status.");
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
    <div className="page-container information-page">
      <PageHeading
        eyebrow="STUDENT APPLICATION PORTAL"
        title="Your applications."
        description="Submit an application to an open program and track its verification stages here."
      />

      {loading && <p role="status">Loading your applications...</p>}
      {error && (
        <div role="alert" className="auth-banner auth-banner-error">
          <div>
            <strong>Application notice</strong>
            <p>{error}</p>
          </div>
        </div>
      )}
      {notice && (
        <div role="status" className="auth-banner auth-banner-success">
          <div>
            <strong>Portal update</strong>
            <p>{notice}</p>
          </div>
        </div>
      )}

      {!loading && (
        <>
          {profile && (
            <section className="student-profile-summary">
              <div>
                <span className="eyebrow">SCHOLAR PROFILE</span>
                <h2>
                  {profile.first_name} {profile.last_name}
                </h2>
                <p>
                  {profile.school_name} · {profile.course}
                  {profile.year_level ? ` (${profile.year_level})` : ""}
                </p>
              </div>
              <div className="student-profile-meta">
                <span>
                  <strong>Student ID:</strong> {profile.student_number}
                </span>
                {profile.barangay_name && (
                  <span>
                    <strong>Barangay:</strong> {profile.barangay_name}
                  </span>
                )}
                <span>
                  <strong>Email Ownership:</strong>{" "}
                  {currentUser?.emailVerified ? "Verified" : "Unverified"}
                </span>
              </div>
            </section>
          )}

          {currentUser && !currentUser.emailVerified && (
            <section className="instruction-main">
              <p className="eyebrow">SCHOOL / STUDENT EMAIL OWNERSHIP VERIFICATION</p>
              <h2>Verify control of {currentUser.email}.</h2>
              <p className="field-hint">
                <ShieldAlert size={15} aria-hidden="true" /> Verifying your
                email address confirms that you control this email account. It{" "}
                <strong>does not</strong> replace School Registrar enrollment
                verification or Barangay Coordinator residency verification.
              </p>

              {issuedDevToken && (
                <div role="status" className="auth-banner auth-banner-success">
                  <KeyRound size={18} aria-hidden="true" />
                  <div>
                    <strong>Development / Manual Verification Token Issued</strong>
                    <p>
                      Automated email sending is disabled in this environment (
                      <code>EMAIL_VERIFICATION_ENABLED=false</code>). Use this
                      one-time token to verify your email ownership:{" "}
                      <code>{issuedDevToken}</code>
                    </p>
                  </div>
                </div>
              )}

              <form onSubmit={handleVerifyEmail} className="auth-form">
                <div className="form-field">
                  <label className="form-label" htmlFor="student-verify-token">
                    Single-use verification token
                  </label>
                  <input
                    id="student-verify-token"
                    className="form-input"
                    placeholder="Paste your email verification token"
                    value={verificationTokenInput}
                    onChange={(e) => setVerificationTokenInput(e.target.value)}
                    disabled={verifyingEmail}
                  />
                </div>
                <div className="staff-actions">
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={verifyingEmail || !verificationTokenInput.trim()}
                  >
                    <MailCheck size={15} aria-hidden="true" />{" "}
                    {verifyingEmail ? "Verifying..." : "Verify email ownership"}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={handleRequestVerificationToken}
                    disabled={resendingVerification}
                  >
                    {resendingVerification
                      ? "Generating token..."
                      : "Send / generate verification token"}
                  </button>
                </div>
              </form>
            </section>
          )}

          {currentUser?.emailVerified && (
            <div role="status" className="auth-banner auth-banner-success">
              <CheckCircle2 size={18} aria-hidden="true" />
              <div>
                <strong>Email ownership verified ({currentUser.email})</strong>
                <p>
                  Your email address ownership is verified. School Registrar
                  enrollment verification and Barangay residency verification
                  are still performed independently on each scholarship
                  application.
                </p>
              </div>
            </div>
          )}

          <section className="instruction-main">
            <p className="eyebrow">NEW APPLICATION</p>
            <h2>Apply to an open program.</h2>
            {!applicationSubmissionEnabled ? (
              <p>
                New applications are unavailable until the required funding and
                verification database schema is installed.
              </p>
            ) : openPrograms.length === 0 ? (
              <p>There are no programs currently accepting applications.</p>
            ) : (
              <form onSubmit={submitApplication} className="auth-form">
                <div className="form-field">
                  <label className="form-label" htmlFor="application-program">
                    Select a program
                  </label>
                  <select
                    id="application-program"
                    className="form-input"
                    value={selectedProgramId}
                    onChange={(event) => setSelectedProgramId(event.target.value)}
                    required
                  >
                    <option value="">Choose an open program</option>
                    {openPrograms.map((program) => {
                      const alreadyApplied = appliedProgramIds.has(
                        Number(program.program_id),
                      );
                      return (
                        <option
                          key={program.program_id}
                          value={program.program_id}
                          disabled={alreadyApplied}
                        >
                          {program.program_name} ({program.cycle_code})
                          {alreadyApplied ? " — Already applied" : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <p className="field-hint">
                  GrantWise initiates the multi-stage verification workflow
                  (Barangay Coordinator → School Registrar → LGU Admin). Confirm
                  documentary requirements with the funding unit before applying.
                </p>
                <button
                  className="button button-primary"
                  disabled={submitting || !selectedProgramId}
                  type="submit"
                >
                  {submitting ? "Submitting..." : "Submit application"}
                </button>
              </form>
            )}
          </section>

          <section className="information-section">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">APPLICATION STATUS</p>
                <h2>Track your submissions.</h2>
              </div>
            </div>
            {applications.length === 0 ? (
              <p>You have not submitted any applications yet.</p>
            ) : (
              <div className="space-y-3">
                {applications.map((application) => (
                  <article className="pillar-card" key={application.application_id}>
                    <h3>{application.program_name}</h3>
                    <p>
                      Status: <strong>{statusLabel(application.application_status)}</strong>
                      {application.cycle_code ? ` · ${application.cycle_code}` : ""}
                    </p>
                    {application.submitted_at && (
                      <p>
                        Submitted:{" "}
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                        }).format(new Date(application.submitted_at))}
                      </p>
                    )}
                    <button
                      className="text-link"
                      type="button"
                      onClick={() => toggleDetails(application.application_id)}
                      disabled={loadingDetail === application.application_id}
                    >
                      {loadingDetail === application.application_id
                        ? "Loading status..."
                        : details[application.application_id]
                          ? "Hide verification details"
                          : "View verification details"}
                    </button>
                    {details[application.application_id] && (
                      <ul className="verification-stage-list">
                        {details[application.application_id].verifications.map((item) => (
                          <li key={item.verification_type}>
                            <strong>{statusLabel(item.verification_type)}:</strong>{" "}
                            <span>{statusLabel(item.status)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <div className="page-actions">
        <Link className="text-link" to="/programs">Browse programs</Link>
      </div>
    </div>
  );
}
