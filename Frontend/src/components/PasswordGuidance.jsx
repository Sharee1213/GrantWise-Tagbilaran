import React from "react";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  getPasswordRuleChecks,
  getPasswordStrength,
} from "../services/passwordPolicy.js";

export default function PasswordGuidance({ password }) {
  const strength = getPasswordStrength(password);
  const checks = getPasswordRuleChecks(password);
  const requirements = [
    {
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      passed: checks.length,
    },
    {
      label: `${PASSWORD_MAX_LENGTH} characters or fewer`,
      passed: password.length === 0 || password.length <= PASSWORD_MAX_LENGTH,
    },
    {
      label: "Not entirely whitespace",
      passed: checks.nonWhitespace,
    },
    {
      label: "Contains a letter",
      passed: checks.hasLetter,
    },
    {
      label: "Contains a number",
      passed: checks.hasNumber,
    },
    {
      label: "Contains a symbol",
      passed: checks.hasSymbol,
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
      </ul>
      <p className="field-hint">
        Use a longer password with letters, numbers, and a symbol for stronger protection.
      </p>
    </div>
  );
}
