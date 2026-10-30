export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DISALLOWED_STUDENT_CONSUMER_DOMAINS = new Set([
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

export const APPROVED_SCHOOL_DOMAINS = new Set([
  "hnu.edu.ph",
  "bisu.edu.ph",
  "universityofbohol.edu.ph",
  "tagbilarancitycollege.edu.ph",
  "pmicollegesbohol.edu.ph",
]);

export const BLOCKED_CANDIDATE_DOMAINS = new Set([
  "ub.edu.ph",
  "tcc.edu.ph",
  "pmi-bohol.edu.ph",
]);

export const CANDIDATE_DOMAIN_ERROR =
  "Your email domain is not an accepted official domain for this institution. Please use your school's approved institutional email address or contact the system administrator.";

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
    BLOCKED_CANDIDATE_DOMAINS.has(domain) ||
    DISALLOWED_STUDENT_CONSUMER_DOMAINS.has(domain) ||
    domain.endsWith(".gov.ph") ||
    domain.endsWith(".gov")
  ) {
    return false;
  }
  return APPROVED_SCHOOL_DOMAINS.has(domain);
}

