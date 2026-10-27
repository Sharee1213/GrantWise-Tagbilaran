import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
import PasswordGuidance from "../components/PasswordGuidance.jsx";
import { apiRequest } from "../services/api.js";
import { getNewPasswordError } from "../services/passwordPolicy.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^[0-9+()\-\s]{7,30}$/;
const NAME_PATTERN = /^[\p{L}\p{M}\s.'-]+$/u;

function formatScopeSummary(inv) {
  if (!inv) return "";
  if (inv.role_name === "LGU Admin") {
    return inv.funding_unit_name
      ? `Funding Unit: ${inv.funding_unit_name} (#${inv.funding_unit_id})`
      : `Funding Unit #${inv.funding_unit_id}`;
  }
  if (inv.role_name === "Barangay Coordinator") {
    return inv.barangay_name
      ? `Barangay: ${inv.barangay_name} (#${inv.barangay_id})`
      : `Barangay #${inv.barangay_id}`;
  }
  if (inv.role_name === "Registrar") {
    return inv.school_name
      ? `School: ${inv.school_name} (#${inv.school_id})`
      : `School #${inv.school_id}`;
  }
  return "Scoped Staff Assignment";
}

function validateStaffRegistrationForm(form) {
  const errors = {};
  const firstName = form.firstName.trim();
  const lastName = form.lastName.trim();
  const email = form.email.trim().toLowerCase();
  const invitationToken = form.invitationToken.trim();
  const phoneNumber = form.phoneNumber.trim();

  if (!firstName) {
    errors.firstName = "First name is required.";
  } else if (firstName.length > 100) {
    errors.firstName = "First name must be 100 characters or fewer.";
  } else if (!NAME_PATTERN.test(firstName)) {
    errors.firstName = "Enter a valid first name.";
  }

  if (!lastName) {
    errors.lastName = "Last name is required.";
  } else if (lastName.length > 100) {
    errors.lastName = "Last name must be 100 characters or fewer.";
  } else if (!NAME_PATTERN.test(lastName)) {
    errors.lastName = "Enter a valid last name.";
  }

  if (!email) {
    errors.email = "Authorized staff email address is required.";
  } else if (email.length > 255) {
    errors.email = "Email address must be 255 characters or fewer.";
  } else if (/\s/.test(email) || !EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!invitationToken) {
    errors.invitationToken = "Single-use staff invitation token is required.";
  } else if (invitationToken.length < 16) {
    errors.invitationToken = "Enter the complete invitation token.";
  }

  const passwordError = getNewPasswordError(form.password);
  if (passwordError) errors.password = passwordError;

  if (!form.confirmPassword) {
    errors.confirmPassword = "Confirm your password.";
  } else if (form.confirmPassword !== form.password) {
    errors.confirmPassword = "Passwords do not match.";
  }

  if (phoneNumber) {
    const cleaned = phoneNumber.replace(/[\s-]/g, "");
    if (!/^[\d\s-]+$/.test(phoneNumber)) {
      errors.phoneNumber = "Phone number must contain only numbers.";
    } else if (cleaned.length !== 11) {
      errors.phoneNumber = "Phone number must be exactly 11 digits (e.g., 09171234567).";
    } else if (!cleaned.startsWith("09")) {
      errors.phoneNumber = "Phone number must start with 09 (e.g., 09171234567).";
    }
  }

  return errors;
}

export default function StaffRegisterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [form, setForm] = useState(() => ({
    firstName: "",
    lastName: "",
    email: (searchParams.get("email") || "").trim().toLowerCase(),
    invitationToken: (searchParams.get("token") || "").trim(),
    phoneNumber: "",
    password: "",
    confirmPassword: "",
  }));

  const [inspectedInvitation, setInspectedInvitation] = useState(null);
  const [inspecting, setInspecting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [serverFieldErrors, setServerFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const initialEmail = (searchParams.get("email") || "").trim().toLowerCase();
    const initialToken = (searchParams.get("token") || "").trim();
    if (initialEmail && initialToken.length >= 16) {
      let active = true;
      setInspecting(true);
      apiRequest("auth/staff-invitations/inspect", {
        method: "POST",
        body: JSON.stringify({
          email: initialEmail,
          invitationToken: initialToken,
        }),
      })
        .then((result) => {
          if (active && result?.invitation) {
            setInspectedInvitation(result.invitation);
          }
        })
        .catch((requestError) => {
          if (active) {
            setError(
              requestError.message ||
                "This staff invitation could not be verified.",
            );
          }
        })
        .finally(() => {
          if (active) setInspecting(false);
        });
      return () => {
        active = false;
      };
    }
    return undefined;
  }, [searchParams]);

  const clientErrors = validateStaffRegistrationForm(form);

  function getFieldError(fieldName) {
    if (serverFieldErrors[fieldName]) return serverFieldErrors[fieldName];
    if (touched[fieldName] || submitted) return clientErrors[fieldName] || "";
    return "";
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (error) setError("");
    if (serverFieldErrors[name]) {
      setServerFieldErrors((current) => ({ ...current, [name]: "" }));
    }
    if (name === "email" || name === "invitationToken") {
      setInspectedInvitation(null);
    }
  }

  function handleBlur(event) {
    const { name, value } = event.target;
    setTouched((current) => ({ ...current, [name]: true }));
    if (["firstName", "lastName", "email", "invitationToken", "phoneNumber"].includes(name)) {
      setForm((current) => ({
        ...current,
        [name]: name === "email" ? value.trim().toLowerCase() : value.trim(),
      }));
    }
    if (name === "password" || name === "confirmPassword") {
      setCapsLockOn(false);
    }
  }

  function handlePasswordKeyEvent(event) {
    if (typeof event.getModifierState === "function") {
      setCapsLockOn(event.getModifierState("CapsLock"));
    }
  }

  async function handleInspectInvitation() {
    setError("");
    const normalizedEmail = form.email.trim().toLowerCase();
    const token = form.invitationToken.trim();
    if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) {
      setError("Enter a valid authorized staff email address first.");
      return;
    }
    if (!token || token.length < 16) {
      setError("Enter your complete staff invitation token first.");
      return;
    }
    setInspecting(true);
    try {
      const result = await apiRequest("auth/staff-invitations/inspect", {
        method: "POST",
        body: JSON.stringify({
          email: normalizedEmail,
          invitationToken: token,
        }),
      });
      setInspectedInvitation(result.invitation || null);
    } catch (requestError) {
      setInspectedInvitation(null);
      setError(
        requestError.message ||
          "No active staff invitation matches this email and token.",
      );
    } finally {
      setInspecting(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitted(true);
    setServerFieldErrors({});
    setError("");

    const validationErrors = validateStaffRegistrationForm(form);
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setLoading(true);
    const normalizedEmail = form.email.trim().toLowerCase();
    try {
      const result = await apiRequest("auth/staff-register", {
        method: "POST",
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: normalizedEmail,
          invitationToken: form.invitationToken.trim(),
          phoneNumber: form.phoneNumber.trim() ? form.phoneNumber.replace(/[\s-]/g, "") : null,
          password: form.password,
          confirmPassword: form.confirmPassword,
        }),
      });

      navigate("/login?registered=1", {
        state: {
          registeredEmail: normalizedEmail,
          registeredMessage:
            result?.message ||
            "Your authorized staff account has been activated. Sign in below to open your assigned portal.",
        },
      });
    } catch (requestError) {
      const apiFieldErrors = {};
      if (Array.isArray(requestError.payload?.errors)) {
        for (const issue of requestError.payload.errors) {
          if (issue?.field && issue?.message && !apiFieldErrors[issue.field]) {
            apiFieldErrors[issue.field] = issue.message;
          }
        }
      }
      if (Object.keys(apiFieldErrors).length > 0) {
        setServerFieldErrors(apiFieldErrors);
      }
      setError(
        requestError.message ||
          "Staff registration failed. Verify that your email and invitation token are active.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-container information-page narrow-page">
      <PageHeading
        eyebrow="DEVELOPER-CONTROLLED STAFF INVITATION REGISTRATION"
        title="Activate your authorized staff account."
        description="Only email addresses explicitly added to the GrantWise staff allowlist by a System Administrator may register here. Your role and organizational scope (funding unit, barangay, or school) are enforced by the backend."
      />

      <div className="auth-card">
        {error && (
          <div role="alert" className="auth-banner auth-banner-error">
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <strong>Staff authorization check failed</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {inspectedInvitation && (
          <div role="status" className="auth-banner auth-banner-success">
            <ShieldCheck size={18} aria-hidden="true" />
            <div>
              <strong>Verified Staff Invitation</strong>
              <p>
                Email: <code>{inspectedInvitation.email}</code> · Role:{" "}
                <strong>{inspectedInvitation.role_name}</strong> ·{" "}
                {formatScopeSummary(inspectedInvitation)}
              </p>
              {inspectedInvitation.position_title && (
                <p>Position: {inspectedInvitation.position_title}</p>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="form-grid-two">
            <div className="form-field">
              <label className="form-label" htmlFor="staff-email">
                Authorized staff email
              </label>
              <input
                id="staff-email"
                className={`form-input ${getFieldError("email") ? "form-input-error" : ""}`}
                name="email"
                type="email"
                placeholder="shareerizal@admin.com or registrar@hnu.edu.ph"
                value={form.email}
                onChange={handleChange}
                onBlur={handleBlur}
                autoComplete="email"
                disabled={loading}
                required
              />
              {getFieldError("email") && (
                <p role="alert" className="field-error">
                  {getFieldError("email")}
                </p>
              )}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="staff-invitationToken">
                Single-use invitation token
              </label>
              <input
                id="staff-invitationToken"
                className={`form-input ${
                  getFieldError("invitationToken") ? "form-input-error" : ""
                }`}
                name="invitationToken"
                placeholder="Paste your 64-character invitation token"
                value={form.invitationToken}
                onChange={handleChange}
                onBlur={handleBlur}
                disabled={loading}
                required
              />
              {getFieldError("invitationToken") && (
                <p role="alert" className="field-error">
                  {getFieldError("invitationToken")}
                </p>
              )}
            </div>
          </div>

          <div>
            <button
              type="button"
              className="button button-secondary"
              onClick={handleInspectInvitation}
              disabled={loading || inspecting}
            >
              <CheckCircle2 size={15} aria-hidden="true" />{" "}
              {inspecting
                ? "Verifying invitation..."
                : "Verify invitation scope"}
            </button>
          </div>

          <div className="form-grid-two">
            <div className="form-field">
              <label className="form-label" htmlFor="staff-firstName">
                First name
              </label>
              <input
                id="staff-firstName"
                className={`form-input ${getFieldError("firstName") ? "form-input-error" : ""}`}
                name="firstName"
                placeholder="Sharee"
                value={form.firstName}
                onChange={handleChange}
                onBlur={handleBlur}
                autoComplete="given-name"
                disabled={loading}
                required
              />
              {getFieldError("firstName") && (
                <p role="alert" className="field-error">
                  {getFieldError("firstName")}
                </p>
              )}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="staff-lastName">
                Last name
              </label>
              <input
                id="staff-lastName"
                className={`form-input ${getFieldError("lastName") ? "form-input-error" : ""}`}
                name="lastName"
                placeholder="Rizal"
                value={form.lastName}
                onChange={handleChange}
                onBlur={handleBlur}
                autoComplete="family-name"
                disabled={loading}
                required
              />
              {getFieldError("lastName") && (
                <p role="alert" className="field-error">
                  {getFieldError("lastName")}
                </p>
              )}
            </div>
          </div>

          <div className="form-field">
            <div className="form-label-row">
              <label className="form-label" htmlFor="staff-phoneNumber">
                Office or mobile phone number
              </label>
              <span className="form-label-meta">Optional</span>
            </div>
            <input
              id="staff-phoneNumber"
              className={`form-input ${getFieldError("phoneNumber") ? "form-input-error" : ""}`}
              name="phoneNumber"
              type="tel"
              placeholder="0917 123 4567"
              value={form.phoneNumber}
              onChange={handleChange}
              onBlur={handleBlur}
              autoComplete="tel"
              disabled={loading}
            />
            {getFieldError("phoneNumber") && (
              <p role="alert" className="field-error">
                {getFieldError("phoneNumber")}
              </p>
            )}
          </div>

          <div className="form-grid-two">
            <div className="form-field">
              <label className="form-label" htmlFor="staff-password">
                Password
              </label>
              <div className="input-with-icon">
                <input
                  id="staff-password"
                  className={`form-input has-trailing-action ${
                    getFieldError("password") ? "form-input-error" : ""
                  }`}
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 12 characters"
                  value={form.password}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  onKeyDown={handlePasswordKeyEvent}
                  onKeyUp={handlePasswordKeyEvent}
                  autoComplete="new-password"
                  disabled={loading}
                  required
                />
                <button
                  className="password-toggle-btn"
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <EyeOff size={18} aria-hidden="true" />
                  ) : (
                    <Eye size={18} aria-hidden="true" />
                  )}
                </button>
              </div>
              {getFieldError("password") && (
                <p role="alert" className="field-error">
                  {getFieldError("password")}
                </p>
              )}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="staff-confirmPassword">
                Confirm password
              </label>
              <input
                id="staff-confirmPassword"
                className={`form-input ${
                  getFieldError("confirmPassword") ? "form-input-error" : ""
                }`}
                name="confirmPassword"
                type={showPassword ? "text" : "password"}
                placeholder="Re-enter your password"
                value={form.confirmPassword}
                onChange={handleChange}
                onBlur={handleBlur}
                onKeyDown={handlePasswordKeyEvent}
                onKeyUp={handlePasswordKeyEvent}
                autoComplete="new-password"
                disabled={loading}
                required
              />
              {getFieldError("confirmPassword") && (
                <p role="alert" className="field-error">
                  {getFieldError("confirmPassword")}
                </p>
              )}
            </div>
          </div>

          {capsLockOn && (
            <p role="status" className="field-warning">
              <KeyRound size={14} aria-hidden="true" />
              Caps Lock is on — passwords are case-sensitive.
            </p>
          )}

          <PasswordGuidance password={form.password} />

          <button
            className="button button-primary auth-submit-btn"
            type="submit"
            disabled={loading}
          >
            {loading ? "Activating staff account..." : "Activate staff account"}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
      </div>

      <div className="page-actions">
        <Link className="text-link" to="/login">
          Already activated your account? Sign in
        </Link>
        <Link className="text-link" to="/signup">
          Register as a student instead
        </Link>
        <Link className="text-link" to="/portals">
          Explore role portals
        </Link>
      </div>
    </div>
  );
}
