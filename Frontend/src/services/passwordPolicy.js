export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

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
  if (!password) return { label: "Not rated", value: 0 };
  if (password.trim().length === 0) {
    return { label: "Needs non-space characters", value: 0 };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { label: "Weak", value: 25 };
  }
  if (password.length < 16) return { label: "Fair", value: 50 };
  if (password.length < 24) return { label: "Good", value: 75 };
  return { label: "Strong", value: 100 };
}
