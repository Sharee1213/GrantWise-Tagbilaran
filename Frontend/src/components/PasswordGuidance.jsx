import React from "react";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  getPasswordStrength,
} from "../services/passwordPolicy.js";

export default function PasswordGuidance({ password }) {
  const strength = getPasswordStrength(password);
  const requirements = [
    {
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      passed: password.length >= PASSWORD_MIN_LENGTH,
    },
    {
      label: `${PASSWORD_MAX_LENGTH} characters or fewer`,
      passed: password.length > 0 && password.length <= PASSWORD_MAX_LENGTH,
    },
    {
      label: "Not entirely whitespace",
      passed: password.trim().length > 0,
    },
  ];

  return (
    <div className="password-guidance">
      <div
        className="password-strength"
        role="progressbar"
        aria-label="Password strength estimate"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={strength.value}
      >
        <span className="password-strength-track" aria-hidden="true">
          <span
            className="password-strength-fill"
            style={{ width: `${strength.value}%` }}
          />
        </span>
        <span aria-live="polite">Strength estimate: {strength.label}</span>
      </div>
      <ul className="password-checklist" aria-label="Password requirements">
        {requirements.map(({ label, passed }) => (
          <li key={label} className={passed ? "password-check-passed" : ""}>
            <span className="password-check-dot" aria-hidden="true" />
            {label}
          </li>
        ))}
        <li>
          Letters, numbers, spaces, and symbols are all allowed
        </li>
      </ul>
      <p className="field-hint">
        The strength estimate is calculated in this browser and is not sent to
        an external service.
      </p>
    </div>
  );
}
