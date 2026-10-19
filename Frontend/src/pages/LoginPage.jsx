import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
} from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
import { apiRequest } from "../services/api.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function getPortalPathForRole(role, programId = null, dashboardPath = null) {
  if (role === "Scholar") {
    return programId && /^\d+$/.test(programId)
      ? `/portal/student?programId=${encodeURIComponent(programId)}`
      : "/portal/student";
  }
  if (role === "LGU Admin") return "/portal/lgu-admin";
  if (role === "Barangay Coordinator") return "/portal/barangay-coordinator";
  if (role === "Registrar") return "/portal/school-registrar";
  if (typeof dashboardPath === "string" && dashboardPath.startsWith("/portal/")) {
    return dashboardPath;
  }
  return "/portals";
}

function validateLoginFields({ email, password }) {
  const errors = {};
  const trimmedEmail = email.trim();

  if (!trimmedEmail) {
    errors.email = "Email address is required.";
  } else if (trimmedEmail.length > 255) {
    errors.email = "Email address must be 255 characters or fewer.";
  } else if (/\s/.test(trimmedEmail) || !EMAIL_PATTERN.test(trimmedEmail)) {
    errors.email = "Enter a valid email address (for example, name@gmail.com or name@school.edu.ph).";
  }

  if (!password) {
    errors.password = "Password is required.";
  } else if (password.trim().length === 0) {
    errors.password = "Password cannot contain only whitespace.";
  } else if (password.length > 128) {
    errors.password = "Password must be 128 characters or fewer.";
  }

  return errors;
}

export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const programId = searchParams.get("programId");

  const [email, setEmail] = useState(
    () => location.state?.registeredEmail || searchParams.get("email") || "",
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [submitted, setSubmitted] = useState(false);
  const [serverFieldErrors, setServerFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(
    () =>
      location.state?.registeredMessage ||
      (searchParams.get("registered") === "1"
        ? "Account created. Sign in with your registered email and password."
        : ""),
  );
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [loading, setLoading] = useState(false);

  const emailInputRef = useRef(null);
  const passwordInputRef = useRef(null);

  const clientErrors = validateLoginFields({ email, password });
  const emailError =
    serverFieldErrors.email ||
    ((touched.email || submitted) ? clientErrors.email : "");
  const passwordError =
    serverFieldErrors.password ||
    ((touched.password || submitted) ? clientErrors.password : "");
  const showShortPasswordHint =
    !passwordError &&
    (touched.password || submitted) &&
    password.length > 0 &&
    password.length < 12;

  useEffect(() => {
    let active = true;
    apiRequest("auth/me")
      .then(({ user }) => {
        if (active && user?.role && user?.scopeId) {
          navigate(getPortalPathForRole(user.role, programId, user.dashboardPath), {
            replace: true,
          });
        }
      })
      .catch((requestError) => {
        if (active && requestError.status !== 401) {
          setError(requestError.message || "Unable to check the current session.");
        }
      });
    return () => {
      active = false;
    };
  }, [navigate, programId]);

  function handleEmailChange(event) {
    setEmail(event.target.value);
    if (error) setError("");
    if (serverFieldErrors.email) {
      setServerFieldErrors((current) => ({ ...current, email: "" }));
    }
  }

  function handlePasswordChange(event) {
    setPassword(event.target.value);
    if (error) setError("");
    if (serverFieldErrors.password) {
      setServerFieldErrors((current) => ({ ...current, password: "" }));
    }
  }

  function handleEmailBlur() {
    setEmail((current) => current.trim());
    setTouched((current) => ({ ...current, email: true }));
  }

  function handlePasswordBlur() {
    setTouched((current) => ({ ...current, password: true }));
    setCapsLockOn(false);
  }

  function handlePasswordKeyEvent(event) {
    if (typeof event.getModifierState === "function") {
      setCapsLockOn(event.getModifierState("CapsLock"));
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitted(true);
    setTouched({ email: true, password: true });
    setServerFieldErrors({});
    setError("");

    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail !== email) {
      setEmail(normalizedEmail);
    }

    const validationErrors = validateLoginFields({
      email: normalizedEmail,
      password,
    });

    if (Object.keys(validationErrors).length > 0) {
      if (validationErrors.email) {
        emailInputRef.current?.focus();
      } else if (validationErrors.password) {
        passwordInputRef.current?.focus();
      }
      return;
    }

    setLoading(true);
    try {
      const loginResult = await apiRequest("auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: normalizedEmail,
          password,
        }),
      });
      // Retrieve the user's backend-verified role and trusted organizational assignment
      const sessionResult = await apiRequest("auth/me");
      const verifiedUser = sessionResult?.user || loginResult?.user;
      if (!verifiedUser?.role || !verifiedUser?.scopeId) {
        throw new Error("This account does not have an active role assignment.");
      }
      setNotice("");
      window.dispatchEvent(new CustomEvent("grantwise:auth-changed"));
      navigate(
        getPortalPathForRole(
          verifiedUser.role,
          programId,
          verifiedUser.dashboardPath,
        ),
      );
    } catch (requestError) {
      setFailedAttempts((count) => count + 1);
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

      if (requestError.status === 429) {
        setError(
          "Too many sign-in attempts. Please wait 15 minutes before trying again.",
        );
      } else if (requestError.status === 401) {
        setError(
          requestError.message ||
            "Email or password is invalid. Check your credentials and try again.",
        );
      } else {
        setError(requestError.message || "Sign in failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-container information-page narrow-page">
      <PageHeading
        eyebrow="SHARED ROLE SIGN-IN"
        title="Sign in to GrantWise."
        description="Students, LGU Program Admins, Barangay Coordinators, and School Registrars sign in here. After authentication, GrantWise verifies your role and organizational assignment and redirects you to your dashboard."
      />

      <div className="auth-card">
        {notice && (
          <div role="status" className="auth-banner auth-banner-success">
            <CheckCircle2 size={18} aria-hidden="true" />
            <div>
              <strong>Account ready</strong>
              <p>{notice}</p>
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="auth-banner auth-banner-error">
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <strong>Unable to sign in</strong>
              <p>{error}</p>
              {failedAttempts >= 2 && (
                <p className="auth-banner-hint">
                  Tip: Make sure your email spelling is exact and check whether
                  Caps Lock is enabled. Student passwords are at least 12
                  characters long.
                </p>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="form-field">
            <label className="form-label" htmlFor="login-email">
              Email address
            </label>
            <div className="input-with-icon">
              <Mail size={16} className="input-leading-icon" aria-hidden="true" />
              <input
                ref={emailInputRef}
                id="login-email"
                name="email"
                className={`form-input has-leading-icon ${emailError ? "form-input-error" : ""}`}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@school.edu.ph"
                value={email}
                onChange={handleEmailChange}
                onBlur={handleEmailBlur}
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailError ? "login-email-error" : undefined}
                disabled={loading}
                required
              />
            </div>
            {emailError && (
              <p id="login-email-error" role="alert" className="field-error">
                {emailError}
              </p>
            )}
          </div>

          <div className="form-field">
            <div className="form-label-row">
              <label className="form-label" htmlFor="login-password">
                Password
              </label>
              <span className="form-label-meta">Case-sensitive</span>
            </div>
            <div className="input-with-icon">
              <Lock size={16} className="input-leading-icon" aria-hidden="true" />
              <input
                ref={passwordInputRef}
                id="login-password"
                name="password"
                className={`form-input has-leading-icon has-trailing-action ${
                  passwordError ? "form-input-error" : ""
                }`}
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={handlePasswordChange}
                onBlur={handlePasswordBlur}
                onKeyDown={handlePasswordKeyEvent}
                onKeyUp={handlePasswordKeyEvent}
                autoComplete="current-password"
                aria-invalid={Boolean(passwordError)}
                aria-describedby={
                  [
                    passwordError ? "login-password-error" : null,
                    capsLockOn ? "login-capslock-warning" : null,
                    showShortPasswordHint ? "login-password-hint" : null,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                disabled={loading}
                required
              />
              <button
                className="password-toggle-btn"
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                tabIndex={0}
              >
                {showPassword ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>

            {capsLockOn && (
              <p id="login-capslock-warning" role="status" className="field-warning">
                <KeyRound size={14} aria-hidden="true" />
                Caps Lock is on — passwords are case-sensitive.
              </p>
            )}

            {passwordError && (
              <p id="login-password-error" role="alert" className="field-error">
                {passwordError}
              </p>
            )}

            {showShortPasswordHint && (
              <p id="login-password-hint" className="field-hint">
                Note: Standard GrantWise accounts use passwords with 12 or more
                characters.
              </p>
            )}
          </div>

          <button
            className="button button-primary auth-submit-btn"
            type="submit"
            disabled={loading}
          >
            {loading ? "Signing in..." : "Sign in"}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
      </div>

      <div className="page-actions">
        <Link className="text-link" to="/signup">
          Create a student account
        </Link>
        <Link className="text-link" to="/portals">
          Explore role portals
        </Link>
        <Link className="text-link" to="/">
          Return to home
        </Link>
      </div>
    </div>
  );
}
