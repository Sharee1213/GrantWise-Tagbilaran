export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function getPasswordRuleChecks(password = "") {
  const value = String(password ?? "");
  const trimmed = value.trim();

  return {
    length: value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH,
    nonWhitespace: trimmed.length > 0,
    hasLetter: /[A-Za-z]/.test(value),
    hasNumber: /\d/.test(value),
    hasSymbol: /[^A-Za-z0-9\s]/.test(value),
  };
}

export function getNewPasswordError(password) {
  if (!password) return "Password is required.";
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  }
  if (password.trim().length === 0) {
    return "Password cannot contain only whitespace.";
  }
  return "";
}

export function getPasswordStrength(password) {
  if (!password) {
    return { label: "Not rated", value: 0, passed: 0, total: 5 };
  }

  const checks = getPasswordRuleChecks(password);
  const total = Object.keys(checks).length;
  const passed = Object.values(checks).filter(Boolean).length;
  const value = Math.round((passed / total) * 100);

  if (password.trim().length === 0) {
    return { label: "Needs non-space characters", value: 0, passed: 0, total };
  }

  // Length and rule-based evaluation (NIST 800-63B passphrase friendly)
  if (password.length >= 24 || passed === 5) {
    return { label: "Strong", value: 100, passed, total };
  }
  if (password.length >= 16 || passed === 4) {
    return { label: "Good", value: Math.max(75, value), passed, total };
  }
  if (password.length >= 12 || passed === 3) {
    return { label: "Fair", value: Math.max(50, value), passed, total };
  }
  return { label: "Weak", value: Math.max(25, value), passed, total };
}
