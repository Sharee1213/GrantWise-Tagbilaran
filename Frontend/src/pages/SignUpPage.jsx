import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
import PasswordGuidance from "../components/PasswordGuidance.jsx";
import { apiRequest } from "../services/api.js";
import { getNewPasswordError } from "../services/passwordPolicy.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^[0-9+()\-\s]{7,30}$/;
const NAME_PATTERN = /^[\p{L}\p{M}\s.'-]+$/u;

const DISALLOWED_STUDENT_CONSUMER_DOMAINS = new Set([
  "googlemail.com",
  "yahoo.com",
  "yahoo.com.ph",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "mail.com",
  "gmx.com",
]);

const APPROVED_SCHOOL_DOMAINS = new Set([
  "hnu.edu.ph",
  "holyname.edu.ph",
  "holynameuniversity.edu.ph",
  "bisu.edu.ph",
  "boholislandstateuniv.edu.ph",
  "boholislandstateuniversity.edu.ph",
  "universityofbohol.edu.ph",
  "universityofbohol.ph",
  "ub.edu.ph",
  "tagbilarancitycollege.edu.ph",
  "tcc.edu.ph",
  "pmi-coleges.edu.ph",
  "pmi-colleges.edu.ph",
  "pmicollegesbohol.edu.ph",
  "pmi-bohol.edu.ph",
  "pmicolleges.edu.ph",
  "pmi.edu.ph",
]);

export function isAllowedStudentEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized) || /[<>",;\\]/.test(normalized)) {
    return false;
  }
  const parts = normalized.split("@");
  if (parts.length !== 2) return false;
  const [, domain] = parts;
  if (domain === "gmail.com") return true;
  if (
    DISALLOWED_STUDENT_CONSUMER_DOMAINS.has(domain) ||
    domain.endsWith(".gov.ph") ||
    domain.endsWith(".gov")
  ) {
    return false;
  }
  if (APPROVED_SCHOOL_DOMAINS.has(domain)) {
    return true;
  }
  return (
    (domain.endsWith(".edu.ph") && domain.length > ".edu.ph".length) ||
    (domain.endsWith(".edu") && domain.length > ".edu".length)
  );
}

const YEAR_LEVEL_OPTIONS = [
  "1st Year",
  "2nd Year",
  "3rd Year",
  "4th Year",
  "5th Year",
];

function validateRegistrationForm(form) {
  const errors = {};
  const firstName = form.firstName.trim();
  const lastName = form.lastName.trim();
  const email = form.email.trim().toLowerCase();
  const phoneNumber = form.phoneNumber.trim();
  const studentNumber = form.studentNumber.trim();
  const course = form.course.trim();

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
    errors.email = "Email address is required.";
  } else if (email.length > 255) {
    errors.email = "Email address must be 255 characters or fewer.";
  } else if (/\s/.test(email) || !EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address (for example, name@gmail.com or name@school.edu.ph).";
  } else if (!isAllowedStudentEmail(email)) {
    errors.email =
      "Students must register using a personal Gmail (@gmail.com) or an official school email (@hnu.edu.ph, @universityofbohol.edu.ph, @universityofbohol.ph, @bisu.edu.ph, @tagbilarancitycollege.edu.ph, @pmicollegesbohol.edu.ph, @pmi-coleges.edu.ph).";
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

  if (!form.barangayId || Number(form.barangayId) < 1) {
    errors.barangayId = "Select your Tagbilaran barangay.";
  }

  if (!form.schoolId || Number(form.schoolId) < 1) {
    errors.schoolId = "Select your approved school.";
  }

  if (!studentNumber) {
    errors.studentNumber = "Student number is required.";
  } else if (studentNumber.length > 50) {
    errors.studentNumber = "Student number must be 50 characters or fewer.";
  }

  if (!course) {
    errors.course = "Course or degree program is required.";
  } else if (course.length > 100) {
    errors.course = "Course must be 100 characters or fewer.";
  }

  if (form.yearLevel && form.yearLevel.trim().length > 50) {
    errors.yearLevel = "Year level must be 50 characters or fewer.";
  }

  return errors;
}

export default function SignUpPage() {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    phoneNumber: "",
    barangayId: "",
    schoolId: "",
    studentNumber: "",
    course: "",
    yearLevel: "",
  });
  const [barangays, setBarangays] = useState([]);
  const [schools, setSchools] = useState([]);
  const [lookupsLoading, setLookupsLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [serverFieldErrors, setServerFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    apiRequest("lookups")
      .then((data) => {
        if (!Array.isArray(data?.barangays) || !Array.isArray(data?.schools)) {
          throw new Error("The API returned an invalid lookup response.");
        }
        if (active) {
          setBarangays(data.barangays);
          setSchools(data.schools);
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(`Could not load barangays and schools. ${requestError.message}`);
        }
      })
      .finally(() => {
        if (active) setLookupsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const clientErrors = validateRegistrationForm(form);

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
  }

  function handleBlur(event) {
    const { name, value } = event.target;
    setTouched((current) => ({ ...current, [name]: true }));
    if (
      ["firstName", "lastName", "email", "phoneNumber", "studentNumber", "course"].includes(
        name,
      )
    ) {
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

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitted(true);
    setServerFieldErrors({});
    setError("");

    const validationErrors = validateRegistrationForm(form);
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setLoading(true);
    const normalizedEmail = form.email.trim().toLowerCase();
    try {
      await apiRequest("auth/register", {
        method: "POST",
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: normalizedEmail,
          password: form.password,
          confirmPassword: form.confirmPassword,
          phoneNumber: form.phoneNumber.trim() ? form.phoneNumber.replace(/[\s-]/g, "") : null,
          barangayId: Number(form.barangayId),
          schoolId: Number(form.schoolId),
          studentNumber: form.studentNumber.trim(),
          course: form.course.trim(),
          yearLevel: form.yearLevel.trim() || null,
        }),
      });
      navigate("/login?registered=1", {
        state: {
          registeredEmail: normalizedEmail,
          registeredMessage:
            "Your student account has been created. Sign in below to continue.",
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
      setError(requestError.message || "Registration failed. Please review your details.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-container information-page narrow-page">
      <PageHeading
        eyebrow="STUDENT REGISTRATION"
        title="Create your student account."
        description="Scholarship applicants register here using a personal Gmail (@gmail.com) or school-issued email address. LGU Program Admin, Barangay Coordinator, and School Registrar accounts are provisioned only through authorized administration."
      />

      <div className="auth-card">
        {error && (
          <div role="alert" className="auth-banner auth-banner-error">
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <strong>Registration could not be completed</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="form-grid-two">
            <div className="form-field">
              <label className="form-label" htmlFor="signup-firstName">
                First name
              </label>
              <input
                id="signup-firstName"
                className={`form-input ${getFieldError("firstName") ? "form-input-error" : ""}`}
                name="firstName"
                placeholder="Juan"
                value={form.firstName}
                onChange={handleChange}
                onBlur={handleBlur}
                autoComplete="given-name"
                aria-invalid={Boolean(getFieldError("firstName"))}
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
              <label className="form-label" htmlFor="signup-lastName">
                Last name
              </label>
              <input
                id="signup-lastName"
                className={`form-input ${getFieldError("lastName") ? "form-input-error" : ""}`}
                name="lastName"
                placeholder="Dela Cruz"
                value={form.lastName}
                onChange={handleChange}
                onBlur={handleBlur}
                autoComplete="family-name"
                aria-invalid={Boolean(getFieldError("lastName"))}
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

          <div className="form-grid-two">
            <div className="form-field">
              <label className="form-label" htmlFor="signup-email">
                Email address
              </label>
              <input
                id="signup-email"
                className={`form-input ${getFieldError("email") ? "form-input-error" : ""}`}
                name="email"
                type="email"
                inputMode="email"
                placeholder="name@gmail.com or student@school.edu.ph"
                value={form.email}
                onChange={handleChange}
                onBlur={handleBlur}
                autoComplete="email"
                aria-invalid={Boolean(getFieldError("email"))}
                aria-describedby="signup-email-hint"
                disabled={loading}
                required
              />
              <p id="signup-email-hint" className="field-hint">
                Accepted: personal Gmail (<code>@gmail.com</code>) or official school email (<code>@hnu.edu.ph</code>, <code>@universityofbohol.edu.ph</code>, <code>@bisu.edu.ph</code>, <code>@tagbilarancitycollege.edu.ph</code>, <code>@pmicollegesbohol.edu.ph</code>, <code>@pmi-coleges.edu.ph</code>).
              </p>
              {getFieldError("email") && (
                <p role="alert" className="field-error">
                  {getFieldError("email")}
                </p>
              )}
            </div>

            <div className="form-field">
              <div className="form-label-row">
                <label className="form-label" htmlFor="signup-phoneNumber">
                  Phone number
                </label>
                <span className="form-label-meta">Optional · 11 digits</span>
              </div>
              <input
                id="signup-phoneNumber"
                className={`form-input ${getFieldError("phoneNumber") ? "form-input-error" : ""}`}
                name="phoneNumber"
                type="tel"
                placeholder="09171234567"
                maxLength={13}
                value={form.phoneNumber}
                onChange={handleChange}
                onBlur={handleBlur}
                autoComplete="tel"
                aria-invalid={Boolean(getFieldError("phoneNumber"))}
                aria-describedby="signup-phone-hint"
                disabled={loading}
              />
              <p id="signup-phone-hint" className="field-hint">
                Must be exactly 11 digits starting with 09 (e.g. 09171234567).
              </p>
              {getFieldError("phoneNumber") && (
                <p role="alert" className="field-error">
                  {getFieldError("phoneNumber")}
                </p>
              )}
            </div>
          </div>

          <div className="form-grid-two">
            <div className="form-field">
              <label className="form-label" htmlFor="signup-password">
                Password
              </label>
              <div className="input-with-icon">
                <input
                  id="signup-password"
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
                  aria-invalid={Boolean(getFieldError("password"))}
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
              <label className="form-label" htmlFor="signup-confirmPassword">
                Confirm password
              </label>
              <input
                id="signup-confirmPassword"
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
                aria-invalid={Boolean(getFieldError("confirmPassword"))}
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

          <div className="form-grid-two">
            <div className="form-field">
              <label className="form-label" htmlFor="signup-barangayId">
                Barangay (Tagbilaran City)
              </label>
              <select
                id="signup-barangayId"
                className={`form-input ${getFieldError("barangayId") ? "form-input-error" : ""}`}
                name="barangayId"
                value={form.barangayId}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={Boolean(getFieldError("barangayId"))}
                disabled={loading || lookupsLoading}
                required
              >
                <option value="">
                  {lookupsLoading ? "Loading barangays..." : "Select your barangay"}
                </option>
                {barangays.map((b) => (
                  <option key={b.barangay_id} value={b.barangay_id}>
                    {b.barangay_name}
                  </option>
                ))}
              </select>
              {getFieldError("barangayId") && (
                <p role="alert" className="field-error">
                  {getFieldError("barangayId")}
                </p>
              )}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="signup-schoolId">
                School or university
              </label>
              <select
                id="signup-schoolId"
                className={`form-input ${getFieldError("schoolId") ? "form-input-error" : ""}`}
                name="schoolId"
                value={form.schoolId}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={Boolean(getFieldError("schoolId"))}
                disabled={loading || lookupsLoading}
                required
              >
                <option value="">
                  {lookupsLoading ? "Loading schools..." : "Select your school"}
                </option>
                {schools.map((s) => (
                  <option key={s.school_id} value={s.school_id}>
                    {s.school_name}
                  </option>
                ))}
              </select>
              {getFieldError("schoolId") && (
                <p role="alert" className="field-error">
                  {getFieldError("schoolId")}
                </p>
              )}
            </div>
          </div>

          <div className="form-grid-two">
            <div className="form-field">
              <label className="form-label" htmlFor="signup-studentNumber">
                Student ID number
              </label>
              <input
                id="signup-studentNumber"
                className={`form-input ${
                  getFieldError("studentNumber") ? "form-input-error" : ""
                }`}
                name="studentNumber"
                placeholder="e.g. 2024-00123"
                value={form.studentNumber}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={Boolean(getFieldError("studentNumber"))}
                disabled={loading}
                required
              />
              {getFieldError("studentNumber") && (
                <p role="alert" className="field-error">
                  {getFieldError("studentNumber")}
                </p>
              )}
            </div>

            <div className="form-field">
              <div className="form-label-row">
                <label className="form-label" htmlFor="signup-yearLevel">
                  Year level
                </label>
                <span className="form-label-meta">Optional</span>
              </div>
              <select
                id="signup-yearLevel"
                className={`form-input ${getFieldError("yearLevel") ? "form-input-error" : ""}`}
                name="yearLevel"
                value={form.yearLevel}
                onChange={handleChange}
                onBlur={handleBlur}
                disabled={loading}
              >
                <option value="">Select year level</option>
                {YEAR_LEVEL_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {getFieldError("yearLevel") && (
                <p role="alert" className="field-error">
                  {getFieldError("yearLevel")}
                </p>
              )}
            </div>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="signup-course">
              Course or degree program
            </label>
            <input
              id="signup-course"
              className={`form-input ${getFieldError("course") ? "form-input-error" : ""}`}
              name="course"
              placeholder="e.g. BS Information Technology"
              value={form.course}
              onChange={handleChange}
              onBlur={handleBlur}
              aria-invalid={Boolean(getFieldError("course"))}
              disabled={loading}
              required
            />
            {getFieldError("course") && (
              <p role="alert" className="field-error">
                {getFieldError("course")}
              </p>
            )}
          </div>

          <button
            className="button button-primary auth-submit-btn"
            type="submit"
            disabled={loading || lookupsLoading}
          >
            {loading ? "Creating account..." : "Create student account"}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
      </div>

      <div className="page-actions">
        <Link className="text-link" to="/login">
          Already have an account? Sign in
        </Link>
        <Link className="text-link" to="/">
          Return to home
        </Link>
      </div>
    </div>
  );
}
