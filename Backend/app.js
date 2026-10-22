const argon2 = require("argon2");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const crypto = require("node:crypto");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const helmet = require("helmet");
const { z } = require("zod");
const defaultPool = require("./db");
const { initDatabase } = require("./init-database");
const {
  tokenHash,
  verifyHashMatch,
  setSessionCookie,
  clearSessionCookie,
} = require("./lib/auth");
const {
  formatFieldErrors,
  sendValidationError,
} = require("./lib/responseHelpers");
const {
  DEFAULT_DEVELOPER_ALLOWLIST,
  LGU_PERMISSION_CATEGORIES,
  DEFAULT_LGU_PERMISSIONS,
  PROPOSED_LGU_OFFICIALS_DIRECTORY,
  PROPOSED_BARANGAY_COORDINATOR_DIRECTORY,
  PROPOSED_SCHOOL_REGISTRAR_DIRECTORY,
  DEFAULT_SCHOOL_DOMAIN_BY_ID,
} = require("./staff-directory-config");
const { getAllowedDeveloperEmails } = require("./scripts/bootstrap-developer");

const SESSION_COOKIE = "grantwise_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const SESSION_DURATION_SECONDS = SESSION_DURATION_MS / 1000;
const MAX_QUEUE_SIZE = 50;

const ROLE_PORTAL_PATHS = Object.freeze({
  Scholar: "/portal/student",
  "LGU Admin": "/portal/lgu-admin",
  "Barangay Coordinator": "/portal/barangay-coordinator",
  Registrar: "/portal/school-registrar",
  "System Admin": "/portal/system-admin",
});

const ROLE_SCOPE_TYPES = Object.freeze({
  Scholar: "student",
  "LGU Admin": "funding_unit",
  "Barangay Coordinator": "barangay",
  Registrar: "school",
  "System Admin": "system",
});

const DEFAULT_APPROVED_SCHOOL_DOMAINS = new Set(
  Object.values(DEFAULT_SCHOOL_DOMAIN_BY_ID),
);

const PERSONAL_GMAIL_DOMAINS = new Set(["gmail.com"]);
const PERSONAL_CONSUMER_DOMAINS = new Set([
  "gmail.com",
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

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function parseEmailAddress(value) {
  const normalized = normalizeEmail(value);
  if (!normalized || normalized.length > 255) return null;
  if (/\s/.test(normalized) || /[<>",;\\]/.test(normalized)) return null;

  const parts = normalized.split("@");
  if (parts.length !== 2) return null;
  const [localPart, domain] = parts;
  if (!localPart || !domain || localPart.length > 64 || domain.length > 253) {
    return null;
  }
  if (
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)
  ) {
    return null;
  }

  const domainLabels = domain.split(".");
  if (domainLabels.length < 2) return null;
  const validLabels = domainLabels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
  );
  const tld = domainLabels[domainLabels.length - 1];
  if (!validLabels || !/^[a-z]{2,63}$/.test(tld)) {
    return null;
  }

  return {
    normalized,
    localPart,
    domain,
  };
}

function parseConfiguredDomainSet(raw) {
  if (!raw || typeof raw !== "string") return new Set();
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase().replace(/^@+/, ""))
      .filter(Boolean),
  );
}

function matchesDomainSet(domain, domainSet) {
  for (const configured of domainSet) {
    if (domain === configured || domain.endsWith(`.${configured}`)) {
      return true;
    }
  }
  return false;
}

function getEmailPolicyConfig(env = process.env) {
  const schoolDomains = parseConfiguredDomainSet(
    env.ALLOWED_SCHOOL_EMAIL_DOMAINS || env.SCHOOL_EMAIL_DOMAINS,
  );
  const lguDomains = parseConfiguredDomainSet(
    env.ALLOWED_LGU_EMAIL_DOMAINS || env.LGU_EMAIL_DOMAINS,
  );
  const barangayDomains = parseConfiguredDomainSet(
    env.ALLOWED_BARANGAY_EMAIL_DOMAINS || env.BARANGAY_EMAIL_DOMAINS,
  );
  const developerAllowlist = new Set(getAllowedDeveloperEmails(env));
  const strictSchoolDomainAllowlist =
    env.STRICT_SCHOOL_DOMAIN_ALLOWLIST === "true";
  const requireStudentSchoolEmail = env.REQUIRE_STUDENT_SCHOOL_EMAIL === "true";
  const emailVerificationEnabled = Boolean(
    env.EMAIL_VERIFICATION_ENABLED === "true" && env.SMTP_HOST && env.SMTP_FROM,
  );

  return {
    schoolDomains,
    lguDomains,
    barangayDomains,
    developerAllowlist,
    strictSchoolDomainAllowlist,
    requireStudentSchoolEmail,
    emailVerificationEnabled,
  };
}

function normalizeDomainList(schoolDomainFromDb) {
  if (!schoolDomainFromDb) return [];
  const list = Array.isArray(schoolDomainFromDb)
    ? schoolDomainFromDb
    : [schoolDomainFromDb];
  return list
    .filter((item) => typeof item === "string")
    .map((item) => item.trim().toLowerCase().replace(/^@+/, ""))
    .filter(Boolean);
}

function isOfficialSchoolEmailDomain(
  domain,
  policyConfig,
  schoolDomainFromDb = null,
) {
  if (
    PERSONAL_CONSUMER_DOMAINS.has(domain) ||
    matchesDomainSet(domain, policyConfig.lguDomains) ||
    matchesDomainSet(domain, policyConfig.barangayDomains) ||
    domain.endsWith(".gov.ph") ||
    domain.endsWith(".gov")
  ) {
    return false;
  }

  const explicitSchoolDomains = normalizeDomainList(schoolDomainFromDb);
  if (explicitSchoolDomains.length > 0) {
    return matchesDomainSet(domain, new Set(explicitSchoolDomains));
  }

  if (policyConfig.schoolDomains.size > 0) {
    if (matchesDomainSet(domain, policyConfig.schoolDomains)) {
      return true;
    }
    if (policyConfig.strictSchoolDomainAllowlist) {
      return false;
    }
  }

  return matchesDomainSet(domain, DEFAULT_APPROVED_SCHOOL_DOMAINS);
}

function isOfficialLguEmailDomain(domain, policyConfig) {
  if (
    PERSONAL_GMAIL_DOMAINS.has(domain) ||
    PERSONAL_CONSUMER_DOMAINS.has(domain) ||
    matchesDomainSet(domain, policyConfig.schoolDomains) ||
    domain.endsWith(".edu.ph") ||
    domain.endsWith(".edu")
  ) {
    return false;
  }

  if (policyConfig.lguDomains.size > 0) {
    return matchesDomainSet(domain, policyConfig.lguDomains);
  }

  return true;
}

function isOfficialBarangayOrLguEmailDomain(domain, policyConfig) {
  if (
    PERSONAL_CONSUMER_DOMAINS.has(domain) ||
    matchesDomainSet(domain, policyConfig.schoolDomains) ||
    domain.endsWith(".edu.ph") ||
    domain.endsWith(".edu")
  ) {
    return false;
  }

  if (
    policyConfig.barangayDomains.size > 0 ||
    policyConfig.lguDomains.size > 0
  ) {
    return (
      matchesDomainSet(domain, policyConfig.barangayDomains) ||
      matchesDomainSet(domain, policyConfig.lguDomains)
    );
  }

  return true;
}

function validateEmailForRole(
  email,
  role,
  policyConfig = getEmailPolicyConfig(),
  options = {},
) {
  const parsed = parseEmailAddress(email);
  if (!parsed) {
    return {
      valid: false,
      message: "Enter a valid email address.",
    };
  }

  const { domain, normalized } = parsed;

  if (role === "System Admin") {
    const allowlist =
      policyConfig.developerAllowlist || new Set(DEFAULT_DEVELOPER_ALLOWLIST);
    if (allowlist.has(normalized)) {
      return { valid: true, normalizedEmail: normalized, domain };
    }
    return {
      valid: false,
      message:
        "System Admin accounts must use an email address on the configured developer allowlist and complete verified bootstrap.",
    };
  }

  if (role === "Scholar") {
    const allowGmail =
      !options.requireSchoolEmail && !policyConfig.requireStudentSchoolEmail;
    if (
      (allowGmail && PERSONAL_GMAIL_DOMAINS.has(domain)) ||
      isOfficialSchoolEmailDomain(domain, policyConfig, options.schoolDomain)
    ) {
      return { valid: true, normalizedEmail: normalized, domain };
    }
    if (options.schoolDomain && !PERSONAL_GMAIL_DOMAINS.has(domain)) {
      const expectedDomains = normalizeDomainList(options.schoolDomain);
      return {
        valid: false,
        message:
          expectedDomains.length > 0
            ? `The email domain (@${domain}) does not match the official domain (${expectedDomains.map((d) => `@${d}`).join(", ")}) configured for the selected school.`
            : "Students must register using a personal Gmail address (@gmail.com) or an approved official school-issued email address.",
      };
    }
    return {
      valid: false,
      message:
        "Students must register using a personal Gmail address (@gmail.com) or an official school-issued email address from an approved partner institution.",
    };
  }

  if (role === "LGU Admin") {
    if (
      PERSONAL_GMAIL_DOMAINS.has(domain) ||
      PERSONAL_CONSUMER_DOMAINS.has(domain) ||
      matchesDomainSet(domain, policyConfig.schoolDomains) ||
      domain.endsWith(".edu.ph") ||
      domain.endsWith(".edu")
    ) {
      return {
        valid: false,
        message:
          "LGU Program Admin accounts must use an official LGU-issued email address. Personal Gmail, consumer, and school email addresses are not permitted.",
      };
    }
    if (options.isDeveloperAuthorized) {
      return { valid: true, normalizedEmail: normalized, domain };
    }
    if (
      options.requireConfiguredLguDomain &&
      policyConfig.lguDomains.size === 0
    ) {
      return {
        valid: false,
        code: "LGU_DOMAIN_CONFIG_REQUIRED",
        message:
          "Official LGU email domain configuration (ALLOWED_LGU_EMAIL_DOMAINS) must be confirmed with the LGU and configured before provisioning LGU Program Admin accounts.",
      };
    }
    if (!isOfficialLguEmailDomain(domain, policyConfig)) {
      return {
        valid: false,
        message:
          "LGU Program Admin accounts must use an approved official LGU-issued email address.",
      };
    }
    return { valid: true, normalizedEmail: normalized, domain };
  }

  if (role === "Barangay Coordinator") {
    if (
      options.isDeveloperAuthorized ||
      PERSONAL_GMAIL_DOMAINS.has(domain) ||
      isOfficialBarangayOrLguEmailDomain(domain, policyConfig)
    ) {
      return { valid: true, normalizedEmail: normalized, domain };
    }
    return {
      valid: false,
      message:
        "Barangay Coordinators must use a personal Gmail address (@gmail.com) or an official barangay/LGU email address.",
    };
  }

  if (role === "Registrar") {
    const expectedDomains = normalizeDomainList(options.schoolDomain);
    if (expectedDomains.length > 0) {
      if (matchesDomainSet(domain, new Set(expectedDomains))) {
        return { valid: true, normalizedEmail: normalized, domain };
      }
      if (!options.allowGmailRegistrar || !PERSONAL_GMAIL_DOMAINS.has(domain)) {
        return {
          valid: false,
          message: `Registrar email domain (@${domain}) must match the assigned school's verified domain (${expectedDomains.map((d) => `@${d}`).join(", ")}).`,
        };
      }
    }
    if (
      options.isDeveloperAuthorized ||
      PERSONAL_GMAIL_DOMAINS.has(domain) ||
      isOfficialSchoolEmailDomain(domain, policyConfig, options.schoolDomain)
    ) {
      return { valid: true, normalizedEmail: normalized, domain };
    }
    return {
      valid: false,
      message:
        "School Registrars must use a personal Gmail address (@gmail.com) or an official school email address.",
    };
  }

  return {
    valid: false,
    message: "This account does not have a supported role assignment.",
  };
}

const registrationSchema = z
  .object({
    firstName: z
      .string({ required_error: "First name is required." })
      .trim()
      .min(1, "First name is required.")
      .max(100, "First name must be 100 characters or fewer."),
    lastName: z
      .string({ required_error: "Last name is required." })
      .trim()
      .min(1, "Last name is required.")
      .max(100, "Last name must be 100 characters or fewer."),
    email: z
      .string({ required_error: "Email address is required." })
      .trim()
      .min(1, "Email address is required.")
      .max(255, "Email address must be 255 characters or fewer.")
      .transform((value) => normalizeEmail(value))
      .refine((value) => Boolean(parseEmailAddress(value)), {
        message: "Enter a valid email address.",
      }),
    password: z
      .string({ required_error: "Password is required." })
      .min(12, "Password must be at least 12 characters long.")
      .max(128, "Password must be 128 characters or fewer.")
      .refine((value) => value.trim().length > 0, {
        message: "Password cannot contain only whitespace.",
      }),
    phoneNumber: z
      .string()
      .trim()
      .max(30, "Phone number must be 30 characters or fewer.")
      .regex(/^[0-9+()\-\s]*$/, "Enter a valid phone number.")
      .optional()
      .nullable(),
    barangayId: z
      .number({ required_error: "Select your barangay." })
      .int("Select a valid barangay.")
      .positive("Select a valid barangay."),
    schoolId: z
      .number({ required_error: "Select your school." })
      .int("Select an approved school.")
      .positive("Select an approved school."),
    studentNumber: z
      .string({ required_error: "Student number is required." })
      .trim()
      .min(1, "Student number is required.")
      .max(50, "Student number must be 50 characters or fewer."),
    course: z
      .string({ required_error: "Course or degree program is required." })
      .trim()
      .min(1, "Course or degree program is required.")
      .max(100, "Course must be 100 characters or fewer."),
    yearLevel: z
      .string()
      .trim()
      .max(50, "Year level must be 50 characters or fewer.")
      .optional()
      .nullable(),
  })
  .strict();

const loginSchema = z
  .object({
    email: z
      .string({ required_error: "Email address is required." })
      .trim()
      .min(1, "Email address is required.")
      .max(255, "Email address must be 255 characters or fewer.")
      .transform((value) => normalizeEmail(value))
      .refine((value) => Boolean(parseEmailAddress(value)), {
        message: "Enter a valid email address.",
      }),
    password: z
      .string({ required_error: "Password is required." })
      .min(1, "Password is required.")
      .max(128, "Password must be 128 characters or fewer.")
      .refine((value) => value.trim().length > 0, {
        message: "Password cannot contain only whitespace.",
      }),
  })
  .strict();

const staffProvisionSchema = z
  .object({
    role: z.enum(["LGU Admin", "Barangay Coordinator", "Registrar"], {
      required_error: "Select an authorized staff role.",
    }),
    firstName: z
      .string({ required_error: "First name is required." })
      .trim()
      .min(1, "First name is required.")
      .max(100, "First name must be 100 characters or fewer."),
    lastName: z
      .string({ required_error: "Last name is required." })
      .trim()
      .min(1, "Last name is required.")
      .max(100, "Last name must be 100 characters or fewer."),
    email: z
      .string({ required_error: "Email address is required." })
      .trim()
      .min(1, "Email address is required.")
      .max(255, "Email address must be 255 characters or fewer.")
      .transform((value) => normalizeEmail(value))
      .refine((value) => Boolean(parseEmailAddress(value)), {
        message: "Enter a valid email address.",
      }),
    password: z
      .string({ required_error: "Password is required." })
      .min(12, "Password must be at least 12 characters long.")
      .max(128, "Password must be 128 characters or fewer.")
      .refine((value) => value.trim().length > 0, {
        message: "Password cannot contain only whitespace.",
      }),
    phoneNumber: z
      .string()
      .trim()
      .max(30, "Phone number must be 30 characters or fewer.")
      .regex(/^[0-9+()\-\s]*$/, "Enter a valid phone number.")
      .optional()
      .nullable(),
    positionTitle: z.string().trim().min(1).max(100).optional().nullable(),
    fundingUnitId: z.number().int().positive().optional(),
    barangayId: z.number().int().positive().optional(),
    schoolId: z.number().int().positive().optional(),
  })
  .strict();

const applicationSchema = z
  .object({
    programId: z.number().int().positive(),
  })
  .strict();

const verificationDecisionSchema = z
  .object({
    status: z.enum(["approved", "rejected", "needs_information", "pending"]),
    remarks: z.string().trim().max(2000).optional().nullable(),
  })
  .strict();

const applicationDecisionSchema = z
  .object({
    status: z.enum(["approved", "rejected", "needs_information"]),
    awardAmount: z
      .number()
      .finite()
      .positive()
      .max(9999999999.99)
      .refine(
        (value) => Number.isInteger(value * 100),
        "Use no more than two decimal places.",
      )
      .optional(),
    remarks: z.string().trim().max(2000).optional().nullable(),
  })
  .strict()
  .refine(
    (value) => value.status !== "approved" || value.awardAmount !== undefined,
    {
      message: "An award amount is required for approval.",
      path: ["awardAmount"],
    },
  )
  .refine(
    (value) => value.status === "approved" || value.awardAmount === undefined,
    {
      message: "An award amount is only valid when approving.",
      path: ["awardAmount"],
    },
  );

const isoDateSchema = z.string().refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value
  );
}, "Use a valid calendar date in YYYY-MM-DD format.");

const programCreateSchema = z
  .object({
    programName: z.string().trim().min(1).max(200),
    fundingCycleId: z.number().int().positive(),
    totalBudget: z
      .number()
      .finite()
      .positive()
      .max(999999999999.99)
      .refine(
        (value) => Number.isInteger(value * 100),
        "Use no more than two decimal places.",
      ),
    startDate: isoDateSchema.nullable().optional(),
    endDate: isoDateSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.startDate || !value.endDate || value.endDate >= value.startDate,
    {
      message: "End date must be on or after the start date.",
      path: ["endDate"],
    },
  );

const allocationSchema = z
  .object({
    allocations: z
      .array(
        z
          .object({
            barangayId: z.number().int().positive(),
            allocatedAmount: z
              .number()
              .finite()
              .nonnegative()
              .max(999999999999.99)
              .refine(
                (value) => Number.isInteger(value * 100),
                "Use no more than two decimal places.",
              ),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_QUEUE_SIZE),
  })
  .strict()
  .refine(
    ({ allocations }) =>
      new Set(allocations.map(({ barangayId }) => barangayId)).size ===
      allocations.length,
    {
      message: "Each barangay may be listed only once.",
      path: ["allocations"],
    },
  );

const programUpdateSchema = z
  .object({
    programName: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["active", "inactive", "closed"]).optional(),
    startDate: isoDateSchema.nullable().optional(),
    endDate: isoDateSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one permitted program field is required.",
  })
  .refine(
    (value) =>
      !value.startDate || !value.endDate || value.endDate >= value.startDate,
    {
      message: "End date must be on or after the start date.",
      path: ["endDate"],
    },
  );

const gradeReportSchema = z
  .object({
    schoolYear: z.string().trim().min(1).max(20),
    semester: z.string().trim().min(1).max(20),
    gpa: z
      .number()
      .finite()
      .min(0)
      .max(99.99)
      .refine(
        (value) => Number.isInteger(value * 100),
        "Use no more than two decimal places.",
      ),
    remarks: z.string().trim().max(2000).optional().nullable(),
  })
  .strict();

const eligibilityCheckSchema = z
  .object({
    checkType: z.string().trim().min(1).max(50),
    result: z.enum(["eligible", "ineligible", "pending"]),
    remarks: z.string().trim().max(2000).optional().nullable(),
  })
  .strict();

const lguPermissionsSchema = z
  .object({
    read_only_reports: z.boolean(),
    program_management: z.boolean(),
    application_review: z.boolean(),
    award_approval: z.boolean(),
    disbursement_release: z.boolean(),
  })
  .strict();

const staffAuthorizationCreateSchema = z
  .object({
    email: z
      .string({ required_error: "Email address is required." })
      .trim()
      .min(1, "Email address is required.")
      .max(255, "Email address must be 255 characters or fewer.")
      .transform((value) => normalizeEmail(value))
      .refine((value) => Boolean(parseEmailAddress(value)), {
        message: "Enter a valid email address.",
      }),
    role: z.enum(["LGU Admin", "Barangay Coordinator", "Registrar"], {
      required_error: "Select an authorized staff role.",
    }),
    fundingUnitId: z.number().int().positive().optional().nullable(),
    barangayId: z.number().int().positive().optional().nullable(),
    schoolId: z.number().int().positive().optional().nullable(),
    positionTitle: z.string().trim().min(1).max(100).optional().nullable(),
    lguPermissions: lguPermissionsSchema.optional().nullable(),
    expiresInHours: z.number().int().min(1).max(720).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .strict();

const staffAuthorizationRevokeSchema = z
  .object({
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

const staffInvitationInspectSchema = z
  .object({
    email: z
      .string({ required_error: "Email address is required." })
      .trim()
      .min(1, "Email address is required.")
      .max(255, "Email address must be 255 characters or fewer.")
      .transform((value) => normalizeEmail(value))
      .refine((value) => Boolean(parseEmailAddress(value)), {
        message: "Enter a valid email address.",
      }),
    invitationToken: z
      .string({ required_error: "Invitation token is required." })
      .trim()
      .min(16, "Invitation token is invalid.")
      .max(256, "Invitation token is invalid."),
  })
  .strict();

const staffInvitationRegisterSchema = z
  .object({
    email: z
      .string({ required_error: "Email address is required." })
      .trim()
      .min(1, "Email address is required.")
      .max(255, "Email address must be 255 characters or fewer.")
      .transform((value) => normalizeEmail(value))
      .refine((value) => Boolean(parseEmailAddress(value)), {
        message: "Enter a valid email address.",
      }),
    invitationToken: z
      .string({ required_error: "Invitation token is required." })
      .trim()
      .min(16, "Invitation token is invalid.")
      .max(256, "Invitation token is invalid."),
    firstName: z
      .string({ required_error: "First name is required." })
      .trim()
      .min(1, "First name is required.")
      .max(100, "First name must be 100 characters or fewer."),
    lastName: z
      .string({ required_error: "Last name is required." })
      .trim()
      .min(1, "Last name is required.")
      .max(100, "Last name must be 100 characters or fewer."),
    phoneNumber: z
      .string()
      .trim()
      .max(30, "Phone number must be 30 characters or fewer.")
      .regex(/^[0-9+()\-\s]*$/, "Enter a valid phone number.")
      .optional()
      .nullable(),
    password: z
      .string({ required_error: "Password is required." })
      .min(12, "Password must be at least 12 characters long.")
      .max(128, "Password must be 128 characters or fewer.")
      .refine((value) => value.trim().length > 0, {
        message: "Password cannot contain only whitespace.",
      }),
  })
  .strict();

const schoolDomainCreateSchema = z
  .object({
    schoolId: z.number().int().positive().optional().nullable(),
    schoolName: z.string().trim().min(2).max(150).optional().nullable(),
    domain: z
      .string()
      .trim()
      .max(253)
      .transform((value) => value.toLowerCase().replace(/^@+/, ""))
      .refine((value) => {
        if (!value) return true;
        const parsed = parseEmailAddress(`check@${value}`);
        return Boolean(parsed && !PERSONAL_CONSUMER_DOMAINS.has(value));
      }, "Enter a valid institutional email domain (non-consumer).")
      .optional()
      .nullable(),
    domainStatus: z.enum(["verified", "candidate", "disabled"]).optional(),
    isPrimary: z.boolean().optional(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

const schoolDomainUpdateSchema = z
  .object({
    domain: z
      .string()
      .trim()
      .min(3)
      .max(253)
      .transform((value) => value.toLowerCase().replace(/^@+/, ""))
      .refine((value) => {
        const parsed = parseEmailAddress(`check@${value}`);
        return Boolean(parsed && !PERSONAL_CONSUMER_DOMAINS.has(value));
      }, "Enter a valid institutional email domain (non-consumer).")
      .optional(),
    domainStatus: z.enum(["verified", "candidate", "disabled"]).optional(),
    isPrimary: z.boolean().optional(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one school domain field is required.",
  });

const studentEmailVerifySchema = z
  .object({
    email: z
      .string({ required_error: "Email address is required." })
      .trim()
      .min(1, "Email address is required.")
      .max(255, "Email address must be 255 characters or fewer.")
      .transform((value) => normalizeEmail(value))
      .refine((value) => Boolean(parseEmailAddress(value)), {
        message: "Enter a valid email address.",
      }),
    verificationToken: z
      .string({ required_error: "Verification token is required." })
      .trim()
      .min(16, "Verification token is invalid.")
      .max(256, "Verification token is invalid."),
  })
  .strict();

const studentEmailResendSchema = z
  .object({
    email: z
      .string({ required_error: "Email address is required." })
      .trim()
      .min(1, "Email address is required.")
      .max(255, "Email address must be 255 characters or fewer.")
      .transform((value) => normalizeEmail(value))
      .refine((value) => Boolean(parseEmailAddress(value)), {
        message: "Enter a valid email address.",
      }),
  })
  .strict();

function getAllowedOrigins(env) {
  const configured = env.FRONTEND_ORIGINS || env.FRONTEND_ORIGIN;
  const values = configured
    ? configured
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : env.NODE_ENV === "production"
      ? []
      : ["http://localhost:5173"];

  return new Set(values.map((origin) => new URL(origin).origin));
}

async function getSchemaCapabilities(pool) {
  const result = await pool.query(
    `SELECT
            (
                to_regclass('"Funding_Units"') IS NOT NULL
                AND to_regclass('"Funding_Cycles"') IS NOT NULL
                AND EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'Funding_Programs'
                      AND column_name = 'funding_unit_id'
                )
                AND EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'Funding_Programs'
                      AND column_name = 'funding_cycle_id'
                )
            ) AS relational_program_schema,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'LGU_Admins'
                  AND column_name = 'funding_unit_id'
            ) AS has_admin_funding_unit_assignment,
            (
                EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'Funding_Programs'
                      AND column_name = 'reserved_budget'
                )
                AND EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'Funding_Programs'
                      AND column_name = 'released_budget'
                )
            ) AS has_program_budget_balances,
            (
                to_regclass('"Program_Barangay_Allocations"') IS NOT NULL
                AND to_regclass('"Application_Verifications"') IS NOT NULL
                AND (
                    SELECT COUNT(DISTINCT trigger_name) = 7
                    FROM information_schema.triggers
                    WHERE event_object_schema = current_schema()
                      AND (
                          (event_object_table = 'Applications'
                           AND trigger_name IN (
                               'trg_application_barangay_check',
                               'trg_application_status_transition',
                               'trg_application_funding_unit_scope',
                               'trg_initialize_application_verification'
                           ))
                          OR (event_object_table = 'Application_Verifications'
                              AND trigger_name IN (
                                  'trg_validate_application_verification_scope',
                                  'trg_validate_application_verification_transition',
                                  'trg_advance_application_verification'
                              ))
                      )
                )
            ) AS application_workflow_schema,
            to_regclass('"Application_Verifications"') IS NOT NULL
            AS has_verification_table,
            to_regprocedure('approve_award(integer,integer)') IS NOT NULL
            AS has_award_approval_function,
            (
            SELECT COUNT(DISTINCT trigger_name) = 5
            FROM information_schema.triggers
            WHERE event_object_schema = current_schema()
              AND event_object_table IN (
                  'Funding_Programs', 'Program_Barangay_Allocations',
                  'LGU_Admins', 'Scholarship_Awards'
              )
              AND trigger_name IN (
                  'trg_validate_program_funding_scope',
                  'trg_validate_program_budget_totals',
                  'trg_validate_program_barangay_allocation',
                  'trg_validate_lgu_admin_funding_unit',
                  'trg_validate_award_status_transition'
              )
            ) AS has_staff_admin_workflow,
            to_regclass('"Staff_Email_Authorizations"') IS NOT NULL
            AS has_staff_authorizations,
            to_regclass('"School_Email_Domains"') IS NOT NULL
            AS has_school_email_domains,
            to_regclass('"Email_Verification_Tokens"') IS NOT NULL
            AS has_email_verification_tokens,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'Users'
                  AND column_name = 'email_verified_at'
            ) AS has_user_email_verified_at,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'LGU_Admins'
                  AND column_name = 'permissions'
            ) AS has_lgu_admin_permissions`,
  );
  const capabilities = result.rows[0];
  return {
    relationalProgramSchema: capabilities.relational_program_schema,
    applicationWorkflowEnabled: capabilities.application_workflow_schema,
    hasVerificationTable: capabilities.has_verification_table,
    hasAdminFundingUnitAssignment:
      capabilities.has_admin_funding_unit_assignment,
    hasProgramBudgetBalances: capabilities.has_program_budget_balances,
    hasAwardApprovalFunction: capabilities.has_award_approval_function,
    hasStaffAdminWorkflow: capabilities.has_staff_admin_workflow,
    hasStaffAuthorizations: Boolean(capabilities.has_staff_authorizations),
    hasSchoolEmailDomains: Boolean(capabilities.has_school_email_domains),
    hasEmailVerificationTokens: Boolean(
      capabilities.has_email_verification_tokens,
    ),
    hasUserEmailVerifiedAt: Boolean(capabilities.has_user_email_verified_at),
    hasLguAdminPermissions: Boolean(capabilities.has_lgu_admin_permissions),
    adminPortalEnabled:
      capabilities.relational_program_schema &&
      capabilities.application_workflow_schema &&
      capabilities.has_admin_funding_unit_assignment &&
      capabilities.has_program_budget_balances &&
      capabilities.has_award_approval_function &&
      capabilities.has_staff_admin_workflow,
    applicationSubmissionEnabled:
      capabilities.relational_program_schema &&
      capabilities.application_workflow_schema,
  };
}

function createApp({
  pool = defaultPool,
  initializeDatabase = initDatabase,
  enableTestRegistration = false,
  env = process.env,
  logger = console,
} = {}) {
  const app = express();
  const allowedOrigins = getAllowedOrigins(env);
  const emailPolicyConfig = getEmailPolicyConfig(env);
  const secureCookies = env.NODE_ENV === "production";
  const allowDevelopmentRoutes = env.NODE_ENV === "development";
  const allowRegistration =
    allowDevelopmentRoutes ||
    (env.NODE_ENV === "test" && enableTestRegistration);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        callback(null, !origin || allowedOrigins.has(origin));
      },
    }),
  );
  app.use(express.json({ limit: "32kb", strict: true }));
  app.use(cookieParser());

  const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => env.NODE_ENV === "test",
    message: { message: "Too many authentication attempts. Try again later." },
  });

  function requireTrustedOrigin(req, res, next) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }

    const origin = req.get("origin");
    if (!origin || !allowedOrigins.has(origin)) {
      return res
        .status(403)
        .json({ message: "Request origin is not allowed." });
    }
    return next();
  }

  app.use("/api", requireTrustedOrigin);

  app.get("/", (req, res) => {
    res.json({ message: "GrantWise API is running!" });
  });

  app.get("/api/test-db", async (req, res) => {
    try {
      const result = await pool.query("SELECT NOW()");
      res.json({ message: "Connected to Neon!", time: result.rows[0].now });
    } catch (error) {
      logger.error("Database health check failed", { code: error.code });
      res.status(500).json({ message: "Database connection failed" });
    }
  });

  // ADDED: dropdown data for the sign-up form (barangays and approved schools)
  app.get("/api/lookups", async (req, res, next) => {
    try {
      const barangays = await pool.query(
        'SELECT barangay_id, barangay_name FROM "Barangays" ORDER BY barangay_name',
      );
      const schools = await pool.query(
        'SELECT school_id, school_name FROM "Schools" WHERE is_approved = TRUE ORDER BY school_name',
      );
      res.json({ barangays: barangays.rows, schools: schools.rows });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/programs", async (req, res, next) => {
    try {
      const capabilities = await getSchemaCapabilities(pool);
      const result = capabilities.relationalProgramSchema
        ? await pool.query(
            `SELECT program.program_id, program.program_name,
                            program.start_date AS application_start_date,
                            program.end_date AS application_end_date,
                            cycle.cycle_code,
                            cycle.start_date AS cycle_start_date,
                            cycle.end_date AS cycle_end_date,
                            unit.funding_unit_name,
                            CASE
                                WHEN program.start_date > CURRENT_DATE
                                  OR cycle.start_date > CURRENT_DATE
                                THEN 'upcoming'
                                ELSE 'open'
                            END AS availability
                     FROM "Funding_Programs" program
                     JOIN "Funding_Units" unit
                       ON unit.funding_unit_id = program.funding_unit_id
                     JOIN "Funding_Cycles" cycle
                       ON cycle.funding_cycle_id = program.funding_cycle_id
                     WHERE program.status = 'active'
                       AND unit.status = 'active'
                       AND cycle.status = 'active'
                       AND (program.end_date IS NULL
                            OR program.end_date >= CURRENT_DATE)
                       AND (cycle.end_date IS NULL
                            OR cycle.end_date >= CURRENT_DATE)
                     ORDER BY COALESCE(program.start_date, cycle.start_date),
                              program.program_name`,
          )
        : await pool.query(
            `SELECT program_id, program_name,
                            funding_cycle AS cycle_code,
                            start_date AS application_start_date,
                            end_date AS application_end_date,
                            CASE WHEN start_date > CURRENT_DATE
                                 THEN 'upcoming' ELSE 'open' END AS availability
                     FROM "Funding_Programs"
                     WHERE status = 'active'
                       AND (end_date IS NULL OR end_date >= CURRENT_DATE)
                     ORDER BY start_date, program_name`,
          );
      return res.json({
        programs: result.rows,
        applicationSubmissionEnabled: capabilities.applicationSubmissionEnabled,
      });
    } catch (error) {
      return next(error);
    }
  });

  if (allowDevelopmentRoutes) {
    app.post("/api/init-db", async (req, res) => {
      try {
        await initializeDatabase();
        res.json({
          message: "GrantWise database schema initialized successfully.",
        });
      } catch (error) {
        logger.error("Schema initialization failed", { code: error.code });
        res.status(500).json({ message: "Schema initialization failed" });
      }
    });
  }

  if (allowRegistration) {
    app.post("/api/auth/register", authRateLimit, async (req, res) => {
      const input = registrationSchema.safeParse(req.body);
      if (!input.success) {
        return sendValidationError(
          res,
          "Registration details are invalid.",
          input.error.issues,
        );
      }

      const data = input.data;
      if (emailPolicyConfig.developerAllowlist.has(data.email)) {
        return res.status(403).json({
          message:
            "This email address is listed in the developer configuration directory and cannot be activated through public student registration. Complete the verified developer bootstrap procedure instead.",
          errors: [
            {
              field: "email",
              message:
                "Developer allowlist email addresses cannot be registered publicly.",
            },
          ],
        });
      }

      const studentEmailPolicy = validateEmailForRole(
        data.email,
        "Scholar",
        emailPolicyConfig,
      );
      if (!studentEmailPolicy.valid) {
        return res.status(400).json({
          message: "Registration details are invalid.",
          errors: [
            {
              field: "email",
              message: studentEmailPolicy.message,
            },
          ],
        });
      }

      const passwordHash = await argon2.hash(data.password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [data.email],
        );

        const existingUser = await client.query(
          'SELECT 1 FROM "Users" WHERE lower(email) = $1 LIMIT 1',
          [data.email],
        );
        const existingStudent = await client.query(
          'SELECT 1 FROM "Students" WHERE student_number = $1 LIMIT 1',
          [data.studentNumber],
        );
        const approvedSchool = await client.query(
          'SELECT 1 FROM "Schools" WHERE school_id = $1 AND is_approved = TRUE',
          [data.schoolId],
        );
        const existingBarangay = await client.query(
          'SELECT 1 FROM "Barangays" WHERE barangay_id = $1',
          [data.barangayId],
        );

        if (existingUser.rowCount > 0 || existingStudent.rowCount > 0) {
          await client.query("ROLLBACK");
          const conflictErrors = [];
          if (existingUser.rowCount > 0) {
            conflictErrors.push({
              field: "email",
              message: "An account with this email address already exists.",
            });
          }
          if (existingStudent.rowCount > 0) {
            conflictErrors.push({
              field: "studentNumber",
              message: "This student number is already registered.",
            });
          }
          return res.status(409).json({
            message:
              "An account with this email or student number already exists.",
            errors: conflictErrors,
          });
        }
        if (approvedSchool.rowCount === 0 || existingBarangay.rowCount === 0) {
          await client.query("ROLLBACK");
          const lookupErrors = [];
          if (existingBarangay.rowCount === 0) {
            lookupErrors.push({
              field: "barangayId",
              message: "Select a valid barangay.",
            });
          }
          if (approvedSchool.rowCount === 0) {
            lookupErrors.push({
              field: "schoolId",
              message: "Select an approved school.",
            });
          }
          return res.status(400).json({
            message: "Select a valid barangay and an approved school.",
            errors: lookupErrors,
          });
        }

        const schoolEmailDomain =
          approvedSchool.rows[0]?.email_domain ||
          approvedSchool.rows[0]?.verified_domains ||
          DEFAULT_SCHOOL_DOMAIN_BY_ID[data.schoolId] ||
          null;
        if (schoolEmailDomain) {
          const schoolSpecificEmailCheck = validateEmailForRole(
            data.email,
            "Scholar",
            emailPolicyConfig,
            { schoolDomain: schoolEmailDomain },
          );
          if (!schoolSpecificEmailCheck.valid) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              message: "Registration details are invalid.",
              errors: [
                {
                  field: "email",
                  message: schoolSpecificEmailCheck.message,
                },
              ],
            });
          }
        }

        // Public self-registration only ever creates Scholar accounts.
        const role = await client.query(
          'SELECT role_id FROM "Roles" WHERE role_name = $1',
          ["Scholar"],
        );
        if (role.rowCount !== 1) {
          throw new Error("The Scholar role is not configured.");
        }

        const user = await client.query(
          `INSERT INTO "Users" (
                        role_id, barangay_id, first_name, last_name, email,
                        password_hash, phone_number
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING user_id`,
          [
            role.rows[0].role_id,
            data.barangayId,
            data.firstName,
            data.lastName,
            data.email,
            passwordHash,
            data.phoneNumber || null,
          ],
        );

        await client.query(
          `INSERT INTO "Students" (
                        user_id, school_id, student_number, course, year_level
                    ) VALUES ($1, $2, $3, $4, $5)`,
          [
            user.rows[0].user_id,
            data.schoolId,
            data.studentNumber,
            data.course,
            data.yearLevel || null,
          ],
        );
        await client.query("COMMIT");
        return res.status(201).json({
          message: "Account created. Sign in to continue.",
          emailVerification: {
            enabled: emailPolicyConfig.emailVerificationEnabled,
            verified: false,
            verificationEmailSent: false,
          },
        });
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.error("Registration transaction rollback failed", {
            code: rollbackError.code,
          });
        }
        if (error.code === "23505") {
          return res.status(409).json({
            message:
              "An account with this email or student number already exists.",
          });
        }
        throw error;
      } finally {
        client.release();
      }
    });
  }

  app.post(
    "/api/auth/resend-verification",
    authRateLimit,
    async (req, res, next) => {
      const input = studentEmailResendSchema.safeParse(req.body);
      if (!input.success) {
        return res.status(400).json({
          message: "Email verification request is invalid.",
          errors: input.error.issues.map(({ path, message }) => ({
            field: path.join(".") || "email",
            message,
          })),
        });
      }
      try {
        const capabilities = await getSchemaCapabilities(pool);
        if (!capabilities.hasEmailVerificationTokens) {
          return res.status(503).json({
            message: "The email verification token schema is not installed.",
          });
        }
        const userResult = await pool.query(
          `SELECT user_id, email, email_verified_at
                 FROM "Users"
                 WHERE lower(email) = $1 AND is_active = TRUE
                 LIMIT 1`,
          [input.data.email],
        );
        if (userResult.rowCount === 0) {
          return res.status(404).json({
            message: "No active account was found for that email address.",
          });
        }
        const user = userResult.rows[0];
        if (user.email_verified_at) {
          return res.status(409).json({
            message: "This email address has already been verified.",
          });
        }
        const rawVerificationToken = crypto
          .randomBytes(32)
          .toString("base64url");
        await pool.query(
          `INSERT INTO "Email_Verification_Tokens" (
                    user_id, email, token_hash, purpose, expires_at
                 ) VALUES ($1, $2, $3, 'account_verification', NOW() + INTERVAL '24 hours')`,
          [
            user.user_id,
            normalizeEmail(user.email),
            tokenHash(rawVerificationToken),
          ],
        );
        return res.status(201).json({
          message: emailPolicyConfig.emailVerificationEnabled
            ? "Verification token generated for email delivery."
            : "Verification token generated. Automated SMTP delivery is currently disabled; use the verification code below in development/test mode.",
          emailVerification: {
            email: normalizeEmail(user.email),
            enabled: emailPolicyConfig.emailVerificationEnabled,
            verified: false,
            verificationEmailSent: false,
            ...(allowDevelopmentRoutes || env.NODE_ENV === "test"
              ? { verificationToken: rawVerificationToken }
              : {}),
          },
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post("/api/auth/verify-email", authRateLimit, async (req, res, next) => {
    const input = studentEmailVerifySchema.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({
        message: "Email verification details are invalid.",
        errors: input.error.issues.map(({ path, message }) => ({
          field: path.join("."),
          message,
        })),
      });
    }
    let capabilities;
    try {
      capabilities = await getSchemaCapabilities(pool);
    } catch (error) {
      return next(error);
    }
    if (!capabilities.hasEmailVerificationTokens) {
      return res.status(503).json({
        message: "The email verification token schema is not installed.",
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tokenRow = await client.query(
        `SELECT verification_token_id, user_id, email, token_hash,
                        expires_at, consumed_at
                 FROM "Email_Verification_Tokens"
                 WHERE lower(email) = $1
                   AND purpose = 'account_verification'
                 ORDER BY created_at DESC, verification_token_id DESC
                 LIMIT 1
                 FOR UPDATE`,
        [input.data.email],
      );
      if (tokenRow.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          message: "Verification token is invalid or has expired.",
        });
      }
      const record = tokenRow.rows[0];
      if (
        record.consumed_at ||
        new Date(record.expires_at).getTime() <= Date.now() ||
        !verifyHashMatch(input.data.verificationToken, record.token_hash)
      ) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          message: "Verification token is invalid or has expired.",
        });
      }

      await client.query(
        `UPDATE "Email_Verification_Tokens"
                 SET consumed_at = NOW()
                 WHERE verification_token_id = $1`,
        [record.verification_token_id],
      );
      await client.query(
        `UPDATE "Users"
                 SET email_verified_at = NOW()
                 WHERE user_id = $1`,
        [record.user_id],
      );
      await client.query(
        `INSERT INTO "Audit_Logs" (
                    user_id, action_type, entity_type, entity_id, details
                 ) VALUES ($1, 'student_email_verified', 'Users', $1,
                           jsonb_build_object(
                               'email', $2::TEXT,
                               'enrollment_verified', FALSE
                           ))`,
        [record.user_id, input.data.email],
      );
      await client.query("COMMIT");
      return res.json({
        message:
          "Email ownership verified. Note: School Registrar enrollment and academic eligibility verification remain required for scholarship applications.",
        emailVerification: {
          email: input.data.email,
          verified: true,
          enrollmentVerified: false,
        },
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        logger.error("Email verification rollback failed", {
          code: rollbackError.code,
        });
      }
      return next(error);
    } finally {
      client.release();
    }
  });

  app.post(
    "/api/auth/staff-invitations/inspect",
    authRateLimit,
    async (req, res, next) => {
      const input = staffInvitationInspectSchema.safeParse(req.body);
      if (!input.success) {
        return res.status(400).json({
          message: "Invitation details are invalid.",
          errors: input.error.issues.map(({ path, message }) => ({
            field: path.join("."),
            message,
          })),
        });
      }
      try {
        const capabilities = await getSchemaCapabilities(pool);
        if (!capabilities.hasStaffAuthorizations) {
          return res.status(503).json({
            message: "The staff authorization schema is not installed.",
          });
        }
        const result = await pool.query(
          `SELECT sa.authorization_id, sa.email, sa.role_name,
                        sa.funding_unit_id, unit.funding_unit_name,
                        sa.barangay_id, barangay.barangay_name,
                        sa.school_id, school.school_name,
                        sa.position_title, sa.invitation_token_hash,
                        sa.status, sa.expires_at
                 FROM "Staff_Email_Authorizations" sa
                 LEFT JOIN "Funding_Units" unit ON unit.funding_unit_id = sa.funding_unit_id
                 LEFT JOIN "Barangays" barangay ON barangay.barangay_id = sa.barangay_id
                 LEFT JOIN "Schools" school ON school.school_id = sa.school_id
                 WHERE lower(sa.email) = $1
                 ORDER BY sa.updated_at DESC, sa.authorization_id DESC
                 LIMIT 1`,
          [input.data.email],
        );
        if (result.rowCount === 0) {
          return res.status(403).json({
            message: "This email address does not have a staff invitation.",
          });
        }
        const inv = result.rows[0];
        if (inv.status === "revoked") {
          return res.status(403).json({
            message: "This staff authorization has been revoked.",
          });
        }
        if (inv.status === "active") {
          return res.status(409).json({
            message: "This staff invitation has already been activated.",
          });
        }
        if (
          inv.status === "expired" ||
          (inv.expires_at && new Date(inv.expires_at).getTime() <= Date.now())
        ) {
          return res.status(403).json({
            message: "This staff invitation has expired.",
          });
        }
        if (
          !verifyHashMatch(
            input.data.invitationToken,
            inv.invitation_token_hash,
          )
        ) {
          return res.status(403).json({
            message: "Invalid staff invitation token.",
          });
        }
        const scopeId =
          inv.role_name === "LGU Admin"
            ? inv.funding_unit_id
            : inv.role_name === "Barangay Coordinator"
              ? inv.barangay_id
              : inv.school_id;
        const scopeName =
          inv.role_name === "LGU Admin"
            ? inv.funding_unit_name
            : inv.role_name === "Barangay Coordinator"
              ? inv.barangay_name
              : inv.school_name;
        return res.json({
          valid: true,
          invitation: {
            authorizationId: inv.authorization_id,
            email: normalizeEmail(inv.email),
            role: inv.role_name,
            scopeType: ROLE_SCOPE_TYPES[inv.role_name],
            scopeId,
            scopeName: scopeName || `Scope #${scopeId}`,
            positionTitle: inv.position_title,
            expiresAt: inv.expires_at,
          },
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post(
    "/api/auth/staff-register",
    authRateLimit,
    async (req, res, next) => {
      const input = staffInvitationRegisterSchema.safeParse(req.body);
      if (!input.success) {
        return res.status(400).json({
          message: "Staff registration details are invalid.",
          errors: input.error.issues.map(({ path, message }) => ({
            field: path.join("."),
            message,
          })),
        });
      }

      let capabilities;
      try {
        capabilities = await getSchemaCapabilities(pool);
      } catch (error) {
        return next(error);
      }
      if (!capabilities.hasStaffAuthorizations) {
        return res.status(503).json({
          message: "The staff authorization schema is not installed.",
        });
      }

      const data = input.data;
      const passwordHash = await argon2.hash(data.password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [data.email],
        );

        const authResult = await client.query(
          `SELECT sa.authorization_id, sa.email, sa.role_name,
                        sa.funding_unit_id, sa.barangay_id, sa.school_id,
                        sa.position_title, sa.lgu_permissions,
                        sa.invitation_token_hash, sa.status, sa.expires_at
                 FROM "Staff_Email_Authorizations" sa
                 WHERE lower(sa.email) = $1
                 ORDER BY sa.updated_at DESC, sa.authorization_id DESC
                 LIMIT 1
                 FOR UPDATE`,
          [data.email],
        );
        if (authResult.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(403).json({
            message:
              "This email address is not authorized on the staff allowlist.",
          });
        }

        const authRow = authResult.rows[0];
        if (authRow.status === "revoked") {
          await client.query("ROLLBACK");
          return res.status(403).json({
            message: "This staff authorization has been revoked.",
          });
        }
        if (authRow.status === "active") {
          await client.query("ROLLBACK");
          return res.status(409).json({
            message: "This staff invitation has already been activated.",
          });
        }
        if (
          authRow.status === "expired" ||
          (authRow.expires_at &&
            new Date(authRow.expires_at).getTime() <= Date.now())
        ) {
          await client.query(
            `UPDATE "Staff_Email_Authorizations"
                     SET status = 'expired', updated_at = NOW()
                     WHERE authorization_id = $1`,
            [authRow.authorization_id],
          );
          await client.query("COMMIT");
          return res.status(403).json({
            message: "This staff invitation has expired.",
          });
        }
        if (
          !verifyHashMatch(data.invitationToken, authRow.invitation_token_hash)
        ) {
          await client.query("ROLLBACK");
          return res.status(403).json({
            message: "Invalid staff invitation token.",
          });
        }

        const existingUser = await client.query(
          'SELECT 1 FROM "Users" WHERE lower(email) = $1 LIMIT 1',
          [data.email],
        );
        if (existingUser.rowCount > 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            message: "An account with this email address already exists.",
          });
        }

        const roleRow = await client.query(
          'SELECT role_id FROM "Roles" WHERE role_name = $1',
          [authRow.role_name],
        );
        if (roleRow.rowCount !== 1) {
          throw new Error(`The ${authRow.role_name} role is not configured.`);
        }

        const userBarangayId =
          authRow.role_name === "Barangay Coordinator"
            ? authRow.barangay_id
            : null;
        const createdUser = await client.query(
          `INSERT INTO "Users" (
                    role_id, barangay_id, first_name, last_name, email,
                    password_hash, phone_number, email_verified_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                 RETURNING user_id`,
          [
            roleRow.rows[0].role_id,
            userBarangayId,
            data.firstName,
            data.lastName,
            data.email,
            passwordHash,
            data.phoneNumber || null,
          ],
        );
        const newUserId = createdUser.rows[0].user_id;

        let targetScopeId = null;
        if (authRow.role_name === "LGU Admin") {
          targetScopeId = authRow.funding_unit_id;
          const resolvedPermissions = {
            ...DEFAULT_LGU_PERMISSIONS,
            ...(authRow.lgu_permissions &&
            typeof authRow.lgu_permissions === "object"
              ? authRow.lgu_permissions
              : {}),
          };
          await client.query(
            `INSERT INTO "LGU_Admins" (
                        user_id, funding_unit_id, position_title, permissions, is_active
                     ) VALUES ($1, $2, $3, $4::JSONB, TRUE)`,
            [
              newUserId,
              targetScopeId,
              authRow.position_title || "Scholarship Program Officer",
              JSON.stringify(resolvedPermissions),
            ],
          );
        } else if (authRow.role_name === "Barangay Coordinator") {
          targetScopeId = authRow.barangay_id;
          await client.query(
            `INSERT INTO "Barangay_Coordinators" (
                        user_id, barangay_id, position_title, term_start, is_current
                     ) VALUES ($1, $2, $3, CURRENT_DATE, TRUE)`,
            [
              newUserId,
              targetScopeId,
              authRow.position_title || "Barangay Scholarship Coordinator",
            ],
          );
        } else if (authRow.role_name === "Registrar") {
          targetScopeId = authRow.school_id;
          await client.query(
            `INSERT INTO "Registrars" (
                        user_id, school_id, position_title, is_active
                     ) VALUES ($1, $2, $3, TRUE)`,
            [
              newUserId,
              targetScopeId,
              authRow.position_title || "School Registrar",
            ],
          );
        }

        await client.query(
          `UPDATE "Staff_Email_Authorizations"
                 SET status = 'active',
                     activated_user_id = $1,
                     activated_at = NOW(),
                     invitation_token_hash = NULL,
                     updated_at = NOW()
                 WHERE authorization_id = $2`,
          [newUserId, authRow.authorization_id],
        );

        await client.query(
          `INSERT INTO "Audit_Logs" (
                    user_id, action_type, entity_type, entity_id, details
                 ) VALUES ($1, 'staff_invitation_redeemed', 'Staff_Email_Authorizations', $2,
                           jsonb_build_object(
                               'email', $3::TEXT,
                               'role_name', $4::TEXT,
                               'scope_id', $5::INTEGER
                           ))`,
          [
            newUserId,
            authRow.authorization_id,
            data.email,
            authRow.role_name,
            targetScopeId,
          ],
        );

        await client.query("COMMIT");
        return res.status(201).json({
          message:
            "Staff account verified and activated. Sign in to access your portal.",
          staffAccount: {
            userId: newUserId,
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            role: authRow.role_name,
            scopeId: targetScopeId,
            scopeType: ROLE_SCOPE_TYPES[authRow.role_name],
            dashboardPath: ROLE_PORTAL_PATHS[authRow.role_name],
          },
          emailVerification: {
            enabled: emailPolicyConfig.emailVerificationEnabled,
            verified: true,
            verificationEmailSent: false,
          },
        });
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.error("Staff registration rollback failed", {
            code: rollbackError.code,
          });
        }
        if (error.code === "23505") {
          return res.status(409).json({
            message:
              "An account or active role assignment already exists for this staff member.",
          });
        }
        return next(error);
      } finally {
        client.release();
      }
    },
  );

  app.post("/api/auth/login", authRateLimit, async (req, res) => {
    const input = loginSchema.safeParse(req.body);
    if (!input.success) {
      return sendValidationError(
        res,
        "Email or password is invalid.",
        input.error.issues,
      );
    }

    const result = await pool.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.email,
                    u.password_hash, u.is_active, r.role_name,
                    student.student_id,
                    admin.funding_unit_id,
                    coordinator.barangay_id AS coordinator_barangay_id,
                    registrar.school_id AS registrar_school_id
             FROM "Users" u
             JOIN "Roles" r ON r.role_id = u.role_id
             LEFT JOIN "Students" student
               ON student.user_id = u.user_id AND student.is_active = TRUE
             LEFT JOIN "LGU_Admins" admin
               ON admin.user_id = u.user_id AND admin.is_active = TRUE
             LEFT JOIN "Barangay_Coordinators" coordinator
               ON coordinator.user_id = u.user_id
              AND coordinator.is_current = TRUE
              AND coordinator.term_start <= CURRENT_DATE
              AND (coordinator.term_end IS NULL OR coordinator.term_end >= CURRENT_DATE)
             LEFT JOIN "Registrars" registrar
               ON registrar.user_id = u.user_id AND registrar.is_active = TRUE
             WHERE lower(u.email) = $1
             LIMIT 1`,
      [input.data.email],
    );
    const user = result.rows[0];
    let validPassword = false;

    if (user) {
      try {
        validPassword = await argon2.verify(
          user.password_hash,
          input.data.password,
        );
      } catch {
        validPassword = false;
      }
    } else {
      await argon2.hash(input.data.password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
    }

    if (!user || !user.is_active || !validPassword) {
      return res.status(401).json({ message: "Email or password is invalid." });
    }

    if (!ROLE_PORTAL_PATHS[user.role_name]) {
      return res.status(403).json({
        message: "This account does not have an active role assignment.",
      });
    }

    if (user.staff_auth_status === "revoked") {
      return res.status(403).json({
        message: "This staff authorization has been revoked.",
      });
    }
    if (
      user.staff_auth_status === "pending" ||
      user.staff_auth_status === "expired" ||
      user.staff_auth_status === "unauthorized"
    ) {
      return res.status(403).json({
        message:
          "This staff account does not have an active developer authorization.",
      });
    }

    const roleEmailCheck = validateEmailForRole(
      user.email,
      user.role_name,
      emailPolicyConfig,
      {
        isDeveloperAuthorized: user.staff_auth_status === "active",
        schoolDomain: user.verified_school_domains || null,
      },
    );
    if (!roleEmailCheck.valid) {
      return res.status(403).json({
        message: roleEmailCheck.message,
      });
    }

    let resolvedScopeId = null;
    if (user.role_name === "Scholar" && user.student_id !== undefined) {
      resolvedScopeId = user.student_id;
    } else if (
      user.role_name === "LGU Admin" &&
      user.funding_unit_id !== undefined
    ) {
      resolvedScopeId = user.funding_unit_id;
    } else if (
      user.role_name === "Barangay Coordinator" &&
      user.coordinator_barangay_id !== undefined
    ) {
      resolvedScopeId = user.coordinator_barangay_id;
    } else if (
      user.role_name === "Registrar" &&
      user.registrar_school_id !== undefined
    ) {
      resolvedScopeId = user.registrar_school_id;
    } else if (user.role_name === "System Admin") {
      resolvedScopeId = user.user_id;
    }

    const token = crypto.randomBytes(32).toString("base64url");
    await pool.query(
      `INSERT INTO "Login_Sessions" (user_id, token_hash, expires_at)
             VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'))`,
      [user.user_id, tokenHash(token), SESSION_DURATION_SECONDS],
    );
    setSessionCookie(
      res,
      SESSION_COOKIE,
      token,
      secureCookies,
      SESSION_DURATION_MS,
    );
    return res.json({
      user: {
        userId: user.user_id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: normalizeEmail(user.email),
        role: user.role_name,
        scopeId: resolvedScopeId,
        scopeType: ROLE_SCOPE_TYPES[user.role_name] || null,
        dashboardPath: ROLE_PORTAL_PATHS[user.role_name],
      },
      emailVerification: {
        enabled: emailPolicyConfig.emailVerificationEnabled,
        verified: Boolean(user.email_verified_at),
      },
    });
  });

  async function requireAuthentication(req, res, next) {
    const token = req.cookies[SESSION_COOKIE];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return res.status(401).json({ message: "Authentication is required." });
    }

    try {
      const capabilities = await getSchemaCapabilities(pool);
      const adminFundingUnit = capabilities.hasAdminFundingUnitAssignment
        ? "admin.funding_unit_id"
        : "NULL::INTEGER";
      const extraSelects = [];
      if (capabilities.hasUserEmailVerifiedAt) {
        extraSelects.push("u.email_verified_at");
      }
      if (capabilities.hasLguAdminPermissions) {
        extraSelects.push("admin.permissions AS lgu_permissions");
      }
      if (capabilities.hasStaffAuthorizations) {
        extraSelects.push("staff_auth.status AS staff_auth_status");
      }
      const extraSelectClause =
        extraSelects.length > 0
          ? `,\n                        ${extraSelects.join(",\n                        ")}`
          : "";
      const staffAuthJoin = capabilities.hasStaffAuthorizations
        ? `\n                 LEFT JOIN LATERAL (
                     SELECT sa.status
                     FROM "Staff_Email_Authorizations" sa
                     WHERE lower(sa.email) = lower(u.email)
                     ORDER BY sa.updated_at DESC, sa.authorization_id DESC
                     LIMIT 1
                 ) staff_auth ON TRUE`
        : "";
      const result = await pool.query(
        `SELECT u.user_id, u.first_name, u.last_name, u.email,
                        r.role_name,
                        student.student_id,
                        ${adminFundingUnit} AS funding_unit_id,
                        coordinator.barangay_id AS coordinator_barangay_id,
                        registrar.school_id AS registrar_school_id${extraSelectClause}
                 FROM "Login_Sessions" session
                 JOIN "Users" u ON u.user_id = session.user_id
                 JOIN "Roles" r ON r.role_id = u.role_id
                 LEFT JOIN "Students" student
                   ON student.user_id = u.user_id AND student.is_active = TRUE
                 LEFT JOIN "LGU_Admins" admin
                   ON admin.user_id = u.user_id AND admin.is_active = TRUE
                 LEFT JOIN "Barangay_Coordinators" coordinator
                   ON coordinator.user_id = u.user_id
                  AND coordinator.is_current = TRUE
                  AND coordinator.term_start <= CURRENT_DATE
                  AND (coordinator.term_end IS NULL OR coordinator.term_end >= CURRENT_DATE)
                 LEFT JOIN "Registrars" registrar
                   ON registrar.user_id = u.user_id AND registrar.is_active = TRUE${staffAuthJoin}
                 WHERE session.token_hash = $1
                   AND session.revoked_at IS NULL
                   AND session.expires_at > NOW()
                   AND u.is_active = TRUE
                 LIMIT 1`,
        [tokenHash(token)],
      );
      const row = result.rows[0];

      if (!row) {
        clearSessionCookie(res, SESSION_COOKIE, secureCookies);
        return res.status(401).json({ message: "Authentication is required." });
      }

      if (
        row.staff_auth_status === "revoked" ||
        row.staff_auth_status === "expired" ||
        row.staff_auth_status === "pending" ||
        row.staff_auth_status === "unauthorized"
      ) {
        clearSessionCookie(res, SESSION_COOKIE, secureCookies);
        return res.status(403).json({
          message: "This staff authorization is no longer active.",
        });
      }

      let scopeId = null;
      if (row.role_name === "Scholar") scopeId = row.student_id;
      if (row.role_name === "LGU Admin") scopeId = row.funding_unit_id;
      if (row.role_name === "Barangay Coordinator") {
        scopeId = row.coordinator_barangay_id;
      }
      if (row.role_name === "Registrar") scopeId = row.registrar_school_id;
      if (row.role_name === "System Admin") scopeId = row.user_id;

      if (!scopeId) {
        if (
          row.role_name === "LGU Admin" &&
          !capabilities.hasAdminFundingUnitAssignment
        ) {
          return res.status(503).json({
            message: "The funding-unit assignment schema is not installed.",
          });
        }
        return res.status(403).json({
          message: "This account does not have an active role assignment.",
        });
      }

      const roleEmailCheck = validateEmailForRole(
        row.email,
        row.role_name,
        emailPolicyConfig,
        {
          isDeveloperAuthorized: row.staff_auth_status === "active",
          schoolDomain: row.verified_school_domains || null,
        },
      );
      if (!roleEmailCheck.valid) {
        return res.status(403).json({
          message: roleEmailCheck.message,
        });
      }

      const lguPermissions =
        row.role_name === "LGU Admin"
          ? {
              ...DEFAULT_LGU_PERMISSIONS,
              ...(row.lgu_permissions && typeof row.lgu_permissions === "object"
                ? row.lgu_permissions
                : {}),
            }
          : null;

      req.auth = {
        userId: row.user_id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: normalizeEmail(row.email),
        role: row.role_name,
        scopeId,
        scopeType: ROLE_SCOPE_TYPES[row.role_name] || null,
        dashboardPath: ROLE_PORTAL_PATHS[row.role_name] || "/portals",
        lguPermissions,
        emailVerified: Boolean(row.email_verified_at),
      };
      return next();
    } catch (error) {
      return next(error);
    }
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (roles.includes(req.auth.role)) {
        return next();
      }

      const previewRole = req.query.previewRole;
      const previewScopeId = req.query.previewScopeId;
      if (
        req.auth.role !== "System Admin" ||
        req.method !== "GET" ||
        roles.length !== 1 ||
        previewRole !== roles[0] ||
        !["LGU Admin", "Barangay Coordinator", "Registrar"].includes(
          previewRole,
        ) ||
        typeof previewScopeId !== "string" ||
        !/^[1-9]\d*$/.test(previewScopeId) ||
        !Number.isSafeInteger(Number(previewScopeId))
      ) {
        return res.status(403).json({
          message: "This account is not authorized for this resource.",
        });
      }

      req.auth.actualRole = req.auth.role;
      req.auth.role = previewRole;
      req.auth.scopeId = Number(previewScopeId);
      req.auth.scopeType = ROLE_SCOPE_TYPES[previewRole];
      req.auth.isDeveloperPreview = true;
      if (previewRole === "LGU Admin") {
        req.auth.lguPermissions = {
          ...DEFAULT_LGU_PERMISSIONS,
          read_only_reports: true,
        };
      }
      return next();
    };
  }

  function requireLguPermission(permissionKey) {
    return (req, res, next) => {
      if (req.auth.role !== "LGU Admin") {
        return res.status(403).json({
          message: "This account is not authorized for this resource.",
        });
      }
      const perms = req.auth.lguPermissions || DEFAULT_LGU_PERMISSIONS;
      if (!perms[permissionKey]) {
        return res.status(403).json({
          message: `This LGU Admin account does not have the '${permissionKey}' permission for this action.`,
        });
      }
      return next();
    };
  }

  async function requireStaffSchema(res, { admin = false } = {}) {
    const capabilities = await getSchemaCapabilities(pool);
    const available = admin
      ? capabilities.adminPortalEnabled
      : capabilities.applicationWorkflowEnabled;
    if (!available) {
      res.status(503).json({
        message: admin
          ? "The funding-unit assignment, budget, and verification workflow schema is not installed."
          : "The application verification workflow schema is not installed.",
      });
      return false;
    }
    return true;
  }

  function parseStaffPage(req, res) {
    const rawLimit = req.query.limit === undefined ? "25" : req.query.limit;
    const rawOffset = req.query.offset === undefined ? "0" : req.query.offset;
    if (
      typeof rawLimit !== "string" ||
      typeof rawOffset !== "string" ||
      !/^\d+$/.test(rawLimit) ||
      !/^\d+$/.test(rawOffset)
    ) {
      res.status(400).json({ message: "Pagination values are invalid." });
      return null;
    }
    const limit = Number(rawLimit);
    const offset = Number(rawOffset);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_QUEUE_SIZE ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    ) {
      res
        .status(400)
        .json({ message: "Pagination values are outside the allowed range." });
      return null;
    }
    return { limit, offset };
  }

  function parsePositiveId(value, label, res) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ message: `${label} is invalid.` });
      return null;
    }
    return id;
  }

  app.get(
    "/api/admin/dashboard",
    requireAuthentication,
    requireRole("LGU Admin"),
    requireLguPermission("read_only_reports"),
    async (req, res) => {
      if (!(await requireStaffSchema(res, { admin: true }))) return;
      const result = await pool.query(
        `SELECT COUNT(*)::INTEGER AS program_count,
                        COALESCE(SUM(program.total_budget), 0)::NUMERIC AS total_budget,
                        COALESCE(SUM(program.remaining_budget), 0)::NUMERIC
                            AS remaining_budget,
                        COALESCE(SUM(program.reserved_budget), 0)::NUMERIC
                            AS reserved_budget,
                        COALESCE(SUM(program.released_budget), 0)::NUMERIC
                            AS released_budget,
                        (SELECT COUNT(*)::INTEGER
                         FROM "Applications" application
                         JOIN "Funding_Programs" scoped_program
                           ON scoped_program.program_id = application.program_id
                         WHERE scoped_program.funding_unit_id = $1)
                            AS application_count,
                        (SELECT COUNT(*)::INTEGER
                         FROM "Applications" application
                         JOIN "Funding_Programs" scoped_program
                           ON scoped_program.program_id = application.program_id
                         WHERE scoped_program.funding_unit_id = $1
                           AND application.application_status IN
                               ('submitted', 'barangay_verification',
                                'registrar_verification', 'lgu_review'))
                            AS in_review_count
                 FROM "Funding_Programs" program
                 WHERE program.funding_unit_id = $1`,
        [req.auth.scopeId],
      );
      return res.json({ summary: result.rows[0] });
    },
  );

  app.get(
    "/api/admin/programs",
    requireAuthentication,
    requireRole("LGU Admin"),
    requireLguPermission("read_only_reports"),
    async (req, res) => {
      if (!(await requireStaffSchema(res, { admin: true }))) return;
      const page = parseStaffPage(req, res);
      if (!page) return;
      const result = await pool.query(
        `SELECT program.program_id, program.program_name,
                        program.funding_cycle_id, cycle.cycle_code,
                        program.total_budget, program.remaining_budget,
                        program.reserved_budget, program.released_budget,
                        program.status, program.start_date, program.end_date,
                        COALESCE(allocations.items, '[]'::JSON) AS barangay_allocations
                 FROM "Funding_Programs" program
                 JOIN "Funding_Cycles" cycle
                   ON cycle.funding_cycle_id = program.funding_cycle_id
                 LEFT JOIN LATERAL (
                     SELECT json_agg(json_build_object(
                         'barangayId', allocation.barangay_id,
                         'barangayName', barangay.barangay_name,
                         'allocatedAmount', allocation.allocated_amount,
                         'reservedAmount', allocation.reserved_amount,
                         'releasedAmount', allocation.released_amount,
                         'availableAmount', allocation.allocated_amount -
                             allocation.reserved_amount - allocation.released_amount
                     ) ORDER BY barangay.barangay_name) AS items
                     FROM "Program_Barangay_Allocations" allocation
                     JOIN "Barangays" barangay
                       ON barangay.barangay_id = allocation.barangay_id
                     WHERE allocation.program_id = program.program_id
                 ) allocations ON TRUE
                 WHERE program.funding_unit_id = $1
                 ORDER BY program.created_at DESC, program.program_id DESC
                 LIMIT $2 OFFSET $3`,
        [req.auth.scopeId, page.limit, page.offset],
      );
      return res.json({ programs: result.rows, pagination: page });
    },
  );

  app.put(
    "/api/admin/programs/:programId/barangay-allocations",
    requireAuthentication,
    requireRole("LGU Admin"),
    requireLguPermission("program_management"),
    async (req, res, next) => {
      if (!(await requireStaffSchema(res, { admin: true }))) return;
      const programId = parsePositiveId(
        req.params.programId,
        "Program ID",
        res,
      );
      if (!programId) return;
      const input = allocationSchema.safeParse(req.body);
      if (!input.success) {
        return res.status(400).json({
          message: "Barangay allocations are invalid.",
          errors: input.error.issues.map(({ path, message }) => ({
            field: path.join("."),
            message,
          })),
        });
      }
      const barangayIds = input.data.allocations.map(
        ({ barangayId }) => barangayId,
      );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const scopedProgram = await client.query(
          `SELECT program_id
                     FROM "Funding_Programs"
                     WHERE program_id = $1 AND funding_unit_id = $2`,
          [programId, req.auth.scopeId],
        );
        if (scopedProgram.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ message: "Program not found." });
        }
        await client.query(
          `SELECT allocation_id
                     FROM "Program_Barangay_Allocations"
                     WHERE program_id = $1
                     ORDER BY allocation_id
                     FOR UPDATE`,
          [programId],
        );
        const program = await client.query(
          `SELECT program_id, total_budget
                     FROM "Funding_Programs"
                     WHERE program_id = $1 AND funding_unit_id = $2
                     FOR UPDATE`,
          [programId, req.auth.scopeId],
        );
        const requestedCents = input.data.allocations.reduce(
          (total, allocation) =>
            total + Math.round(allocation.allocatedAmount * 100),
          0,
        );
        if (
          requestedCents >
          Math.round(Number(program.rows[0].total_budget) * 100)
        ) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "Barangay allocations cannot exceed the program budget.",
          });
        }
        const knownBarangays = await client.query(
          `SELECT barangay_id
                     FROM "Barangays"
                     WHERE barangay_id = ANY($1::INTEGER[])`,
          [barangayIds],
        );
        if (knownBarangays.rowCount !== barangayIds.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "One or more barangays do not exist.",
          });
        }
        await client.query(
          `DELETE FROM "Program_Barangay_Allocations"
                     WHERE program_id = $1
                       AND NOT (barangay_id = ANY($2::INTEGER[]))`,
          [programId, barangayIds],
        );
        for (const allocation of input.data.allocations) {
          await client.query(
            `INSERT INTO "Program_Barangay_Allocations" (
                            program_id, barangay_id, allocated_amount
                         ) VALUES ($1, $2, $3)
                         ON CONFLICT (program_id, barangay_id)
                         DO UPDATE SET allocated_amount = EXCLUDED.allocated_amount,
                                       updated_at = NOW()`,
            [programId, allocation.barangayId, allocation.allocatedAmount],
          );
        }
        const allocations = await client.query(
          `SELECT allocation.barangay_id, barangay.barangay_name,
                            allocation.allocated_amount, allocation.reserved_amount,
                            allocation.released_amount,
                            allocation.allocated_amount - allocation.reserved_amount -
                                allocation.released_amount AS available_amount
                     FROM "Program_Barangay_Allocations" allocation
                     JOIN "Barangays" barangay
                       ON barangay.barangay_id = allocation.barangay_id
                     WHERE allocation.program_id = $1
                     ORDER BY barangay.barangay_name`,
          [programId],
        );
        await client.query(
          `INSERT INTO "Audit_Logs" (
                        user_id, action_type, entity_type, entity_id, details
                     ) VALUES ($1, 'program_barangay_allocations_updated',
                               'Funding_Programs', $2,
                               jsonb_build_object('allocation_count', $3))`,
          [req.auth.userId, programId, allocations.rowCount],
        );
        await client.query("COMMIT");
        return res.json({ allocations: allocations.rows });
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.error("Program allocation rollback failed", {
            code: rollbackError.code,
          });
        }
        if (["P0001", "23514"].includes(error.code)) {
          return res.status(409).json({
            message:
              "The allocations could not be saved because committed or released funding would be affected.",
          });
        }
        return next(error);
      } finally {
        client.release();
      }
    },
  );

  app.get(
    "/api/admin/programs/:programId",
    requireAuthentication,
    requireRole("LGU Admin"),
    requireLguPermission("read_only_reports"),
    async (req, res) => {
      if (!(await requireStaffSchema(res, { admin: true }))) return;
      const programId = parsePositiveId(
        req.params.programId,
        "Program ID",
        res,
      );
      if (!programId) return;
      const result = await pool.query(
        `SELECT program.program_id, program.program_name,
                        program.funding_cycle_id, cycle.cycle_code,
                        program.total_budget, program.remaining_budget,
                        program.reserved_budget, program.released_budget,
                        program.status, program.start_date, program.end_date,
                        COALESCE(allocations.items, '[]'::JSON) AS barangay_allocations
                 FROM "Funding_Programs" program
                 JOIN "Funding_Cycles" cycle
                   ON cycle.funding_cycle_id = program.funding_cycle_id
                 LEFT JOIN LATERAL (
                     SELECT json_agg(json_build_object(
                         'barangayId', allocation.barangay_id,
                         'barangayName', barangay.barangay_name,
                         'allocatedAmount', allocation.allocated_amount,
                         'reservedAmount', allocation.reserved_amount,
                         'releasedAmount', allocation.released_amount,
                         'availableAmount', allocation.allocated_amount -
                             allocation.reserved_amount - allocation.released_amount
                     ) ORDER BY barangay.barangay_name) AS items
                     FROM "Program_Barangay_Allocations" allocation
                     JOIN "Barangays" barangay
                       ON barangay.barangay_id = allocation.barangay_id
                     WHERE allocation.program_id = program.program_id
                 ) allocations ON TRUE
                 WHERE program.program_id = $1
                   AND program.funding_unit_id = $2`,
        [programId, req.auth.scopeId],
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ message: "Program not found." });
      }
      return res.json({ program: result.rows[0] });
    },
  );

  app.post(
    "/api/admin/programs",
    requireAuthentication,
    requireRole("LGU Admin"),
    requireLguPermission("program_management"),
    async (req, res, next) => {
      if (!(await requireStaffSchema(res, { admin: true }))) return;
      const input = programCreateSchema.safeParse(req.body);
      if (!input.success) {
        return res.status(400).json({
          message: "Program details are invalid.",
          errors: input.error.issues.map(({ path, message }) => ({
            field: path.join("."),
            message,
          })),
        });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const cycle = await client.query(
          `SELECT funding_cycle_id
                     FROM "Funding_Cycles"
                     WHERE funding_cycle_id = $1
                       AND status = 'active'
                       AND (start_date IS NULL OR start_date <= CURRENT_DATE)
                       AND (end_date IS NULL OR end_date >= CURRENT_DATE)
                     FOR SHARE`,
          [input.data.fundingCycleId],
        );
        if (cycle.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "Choose an active funding cycle.",
          });
        }
        const result = await client.query(
          `INSERT INTO "Funding_Programs" (
                        program_name, funding_unit_id, funding_cycle_id,
                        total_budget, remaining_budget, reserved_budget,
                        released_budget, status, start_date, end_date
                     ) VALUES ($1, $2, $3, $4, $4, 0, 0, 'active', $5, $6)
                     RETURNING program_id, program_name, funding_cycle_id,
                               total_budget, remaining_budget, reserved_budget,
                               released_budget, status, start_date, end_date`,
          [
            input.data.programName,
            req.auth.scopeId,
            input.data.fundingCycleId,
            input.data.totalBudget,
            input.data.startDate || null,
            input.data.endDate || null,
          ],
        );
        await client.query(
          `INSERT INTO "Audit_Logs" (
                        user_id, action_type, entity_type, entity_id, details
                     ) VALUES ($1, 'funding_program_created', 'Funding_Programs', $2,
                               jsonb_build_object(
                                   'funding_unit_id', $3,
                                   'funding_cycle_id', $4
                               ))`,
          [
            req.auth.userId,
            result.rows[0].program_id,
            req.auth.scopeId,
            input.data.fundingCycleId,
          ],
        );
        await client.query("COMMIT");
        return res.status(201).json({ program: result.rows[0] });
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.error("Program creation rollback failed", {
            code: rollbackError.code,
          });
        }
        if (error.code === "23514") {
          return res.status(400).json({
            message:
              "Program dates or budget do not satisfy database constraints.",
          });
        }
        return next(error);
      } finally {
        client.release();
      }
    },
  );

  app.get(
    "/api/admin/funding-cycles",
    requireAuthentication,
    requireRole("LGU Admin"),
    requireLguPermission("read_only_reports"),
    async (req, res) => {
      if (!(await requireStaffSchema(res, { admin: true }))) return;
      const result = await pool.query(
        `SELECT funding_cycle_id, cycle_code, start_date, end_date
                 FROM "Funding_Cycles"
                 WHERE status = 'active'
                   AND (start_date IS NULL OR start_date <= CURRENT_DATE)
                   AND (end_date IS NULL OR end_date >= CURRENT_DATE)
                 ORDER BY start_date DESC NULLS LAST, cycle_code DESC
                 LIMIT $1`,
        [MAX_QUEUE_SIZE],
      );
      return res.json({ fundingCycles: result.rows });
    },
  );

  app.patch(
    "/api/admin/programs/:programId",
    requireAuthentication,
    requireRole("LGU Admin"),
    requireLguPermission("program_management"),
    async (req, res, next) => {
      if (!(await requireStaffSchema(res, { admin: true }))) return;
      const programId = parsePositiveId(
        req.params.programId,
        "Program ID",
        res,
      );
      if (!programId) return;
      const input = programUpdateSchema.safeParse(req.body);
      if (!input.success) {
        return res.status(400).json({
          message: "Program updates are invalid.",
          errors: input.error.issues.map(({ path, message }) => ({
            field: path.join("."),
            message,
          })),
        });
      }
      const fields = {
        programName: "program_name",
        status: "status",
        startDate: "start_date",
        endDate: "end_date",
      };
      const values = [programId, req.auth.scopeId, req.auth.userId];
      const updates = Object.entries(input.data).map(([key, value]) => {
        values.push(value);
        return `${fields[key]} = $${values.length}`;
      });
      values.push(JSON.stringify(Object.keys(input.data)));
      const changedFieldsIndex = values.length;
      let result;
      try {
        result = await pool.query(
          `WITH updated_program AS (
                         UPDATE "Funding_Programs"
                         SET ${updates.join(", ")}
                         WHERE program_id = $1 AND funding_unit_id = $2
                         RETURNING program_id, program_name, funding_cycle_id,
                                   total_budget, remaining_budget, reserved_budget,
                                   released_budget, status, start_date, end_date
                     ),
                     logged AS (
                         INSERT INTO "Audit_Logs" (
                             user_id, action_type, entity_type, entity_id, details
                         )
                         SELECT $3, 'funding_program_updated', 'Funding_Programs',
                                program_id,
                                jsonb_build_object(
                                    'changed_fields', $${changedFieldsIndex}::JSONB
                                )
                         FROM updated_program
                         RETURNING log_id
                     )
                     SELECT updated_program.*
                     FROM updated_program CROSS JOIN logged`,
          values,
        );
      } catch (error) {
        if (error.code === "23514") {
          return res.status(400).json({
            message:
              "Program dates or status do not satisfy database constraints.",
          });
        }
        return next(error);
      }
      if (result.rowCount === 0) {
        return res.status(404).json({ message: "Program not found." });
      }
      return res.json({ program: result.rows[0] });
    },
  );

  app.get(
    "/api/admin/applications",
    requireAuthentication,
    requireRole("LGU Admin"),
    requireLguPermission("read_only_reports"),
    async (req, res) => {
      if (!(await requireStaffSchema(res, { admin: true }))) return;
      const page = parseStaffPage(req, res);
      if (!page) return;
      const result = await pool.query(
        `SELECT application.application_id, application.application_status,
                        application.submitted_at, application.created_at,
                        program.program_id, program.program_name,
                        student.student_number, student.course, student.year_level,
                        student_user.first_name, student_user.last_name,
                        school.school_name, barangay.barangay_name
                 FROM "Applications" application
                 JOIN "Funding_Programs" program
                   ON program.program_id = application.program_id
                 JOIN "Students" student ON student.student_id = application.student_id
                 JOIN "Users" student_user ON student_user.user_id = student.user_id
                 JOIN "Schools" school ON school.school_id = student.school_id
                 JOIN "Barangays" barangay ON barangay.barangay_id = application.barangay_id
                 WHERE program.funding_unit_id = $1
                 ORDER BY application.created_at DESC, application.application_id DESC
                 LIMIT $2 OFFSET $3`,
        [req.auth.scopeId, page.limit, page.offset],
      );
      return res.json({ applications: result.rows, pagination: page });
    },
  );

  app.get(
    "/api/admin/applications/:applicationId",
    requireAuthentication,
    requireRole("LGU Admin"),
    requireLguPermission("read_only_reports"),
    async (req, res) => {
      if (!(await requireStaffSchema(res, { admin: true }))) return;
      const applicationId = parsePositiveId(
        req.params.applicationId,
        "Application ID",
        res,
      );
      if (!applicationId) return;
      const result = await pool.query(
        `SELECT application.application_id, application.application_status,
                        application.submitted_at, application.reviewed_at,
                        application.remarks, application.created_at,
                        program.program_id, program.program_name,
                        student.student_number, student.course, student.year_level,
                        student_user.first_name, student_user.last_name,
                        school.school_name, barangay.barangay_name
                 FROM "Applications" application
                 JOIN "Funding_Programs" program
                   ON program.program_id = application.program_id
                 JOIN "Students" student ON student.student_id = application.student_id
                 JOIN "Users" student_user ON student_user.user_id = student.user_id
                 JOIN "Schools" school ON school.school_id = student.school_id
                 JOIN "Barangays" barangay ON barangay.barangay_id = application.barangay_id
                 WHERE application.application_id = $1
                   AND program.funding_unit_id = $2`,
        [applicationId, req.auth.scopeId],
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ message: "Application not found." });
      }
      const verifications = await pool.query(
        `SELECT verification_type, status, remarks, activated_at, reviewed_at
                 FROM "Application_Verifications"
                 WHERE application_id = $1
                 ORDER BY activated_at`,
        [applicationId],
      );
      return res.json({
        application: result.rows[0],
        verifications: verifications.rows,
      });
    },
  );

  app.post(
    "/api/admin/staff-accounts",
    requireAuthentication,
    requireRole("LGU Admin"),
    requireLguPermission("program_management"),
    async (req, res, next) => {
      if (!(await requireStaffSchema(res, { admin: true }))) return;
      const input = staffProvisionSchema.safeParse(req.body);
      if (!input.success) {
        return res.status(400).json({
          message: "Staff account details are invalid.",
          errors: input.error.issues.map(({ path, message }) => ({
            field: path.join("."),
            message,
          })),
        });
      }

      const data = input.data;
      const emailPolicyCheck = validateEmailForRole(
        data.email,
        data.role,
        emailPolicyConfig,
        { requireConfiguredLguDomain: data.role === "LGU Admin" },
      );
      if (!emailPolicyCheck.valid) {
        const status =
          emailPolicyCheck.code === "LGU_DOMAIN_CONFIG_REQUIRED" ? 503 : 400;
        return res.status(status).json({
          message: emailPolicyCheck.message,
          errors: [
            {
              field: "email",
              message: emailPolicyCheck.message,
            },
          ],
        });
      }

      if (data.role === "LGU Admin") {
        if (
          data.fundingUnitId !== undefined &&
          data.fundingUnitId !== req.auth.scopeId
        ) {
          return res.status(403).json({
            message:
              "LGU administrators may only provision accounts within their assigned funding unit.",
          });
        }
      } else if (data.role === "Barangay Coordinator") {
        if (!data.barangayId) {
          return res.status(400).json({
            message:
              "Select the assigned barangay for the Barangay Coordinator.",
            errors: [
              {
                field: "barangayId",
                message: "Select a valid barangay.",
              },
            ],
          });
        }
      } else if (data.role === "Registrar") {
        if (!data.schoolId) {
          return res.status(400).json({
            message: "Select the assigned partner school for the Registrar.",
            errors: [
              {
                field: "schoolId",
                message: "Select an approved school.",
              },
            ],
          });
        }
      }

      const passwordHash = await argon2.hash(data.password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [data.email],
        );

        const existingUser = await client.query(
          'SELECT 1 FROM "Users" WHERE lower(email) = $1 LIMIT 1',
          [data.email],
        );
        if (existingUser.rowCount > 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            message: "An account with this email address already exists.",
            errors: [
              {
                field: "email",
                message: "An account with this email address already exists.",
              },
            ],
          });
        }

        let targetScopeId = req.auth.scopeId;
        let userBarangayId = null;

        if (data.role === "Barangay Coordinator") {
          const barangay = await client.query(
            'SELECT 1 FROM "Barangays" WHERE barangay_id = $1',
            [data.barangayId],
          );
          if (barangay.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              message: "Select a valid barangay.",
              errors: [
                {
                  field: "barangayId",
                  message: "Select a valid barangay.",
                },
              ],
            });
          }
          targetScopeId = data.barangayId;
          userBarangayId = data.barangayId;
        } else if (data.role === "Registrar") {
          const school = await client.query(
            'SELECT 1 FROM "Schools" WHERE school_id = $1 AND is_approved = TRUE',
            [data.schoolId],
          );
          if (school.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              message: "Select an approved school.",
              errors: [
                {
                  field: "schoolId",
                  message: "Select an approved school.",
                },
              ],
            });
          }
          targetScopeId = data.schoolId;
        }

        const roleRow = await client.query(
          'SELECT role_id FROM "Roles" WHERE role_name = $1',
          [data.role],
        );
        if (roleRow.rowCount !== 1) {
          throw new Error(`The ${data.role} role is not configured.`);
        }

        const createdUser = await client.query(
          `INSERT INTO "Users" (
                        role_id, barangay_id, first_name, last_name, email,
                        password_hash, phone_number
                     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                     RETURNING user_id`,
          [
            roleRow.rows[0].role_id,
            userBarangayId,
            data.firstName,
            data.lastName,
            data.email,
            passwordHash,
            data.phoneNumber || null,
          ],
        );
        const newUserId = createdUser.rows[0].user_id;

        if (data.role === "LGU Admin") {
          await client.query(
            `INSERT INTO "LGU_Admins" (
                            user_id, funding_unit_id, position_title, is_active
                         ) VALUES ($1, $2, $3, TRUE)`,
            [
              newUserId,
              targetScopeId,
              data.positionTitle || "Scholarship Program Officer",
            ],
          );
        } else if (data.role === "Barangay Coordinator") {
          await client.query(
            `INSERT INTO "Barangay_Coordinators" (
                            user_id, barangay_id, position_title, term_start, is_current
                         ) VALUES ($1, $2, $3, CURRENT_DATE, TRUE)`,
            [
              newUserId,
              targetScopeId,
              data.positionTitle || "Barangay Scholarship Coordinator",
            ],
          );
        } else if (data.role === "Registrar") {
          await client.query(
            `INSERT INTO "Registrars" (
                            user_id, school_id, position_title, is_active
                         ) VALUES ($1, $2, $3, TRUE)`,
            [
              newUserId,
              targetScopeId,
              data.positionTitle || "School Registrar",
            ],
          );
        }

        await client.query(
          `INSERT INTO "Audit_Logs" (
                        user_id, action_type, entity_type, entity_id, details
                     ) VALUES ($1, 'staff_account_provisioned', 'Users', $2,
                               jsonb_build_object(
                                   'provisioned_role', $3,
                                   'scope_id', $4
                               ))`,
          [req.auth.userId, newUserId, data.role, targetScopeId],
        );

        await client.query("COMMIT");
        return res.status(201).json({
          message: "Staff account provisioned.",
          staffAccount: {
            userId: newUserId,
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            role: data.role,
            scopeId: targetScopeId,
            scopeType: ROLE_SCOPE_TYPES[data.role],
            dashboardPath: ROLE_PORTAL_PATHS[data.role],
          },
          emailVerification: {
            enabled: emailPolicyConfig.emailVerificationEnabled,
            verified: false,
            verificationEmailSent: false,
          },
        });
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.error("Staff provisioning rollback failed", {
            code: rollbackError.code,
          });
        }
        if (error.code === "23505") {
          return res.status(409).json({
            message:
              "An account or active role assignment already exists for this staff member.",
          });
        }
        return next(error);
      } finally {
        client.release();
      }
    },
  );

  app.post("/api/auth/logout", requireAuthentication, async (req, res) => {
    await pool.query(
      `UPDATE "Login_Sessions"
             SET revoked_at = NOW()
             WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash(req.cookies[SESSION_COOKIE])],
    );
    clearSessionCookie(res, SESSION_COOKIE, secureCookies);
    return res.json({ message: "Signed out." });
  });

  app.get("/api/auth/me", requireAuthentication, (req, res) => {
    res.json({
      user: {
        userId: req.auth.userId,
        firstName: req.auth.firstName,
        lastName: req.auth.lastName,
        email: req.auth.email,
        role: req.auth.role,
        scopeId: req.auth.scopeId,
        scopeType: req.auth.scopeType,
        dashboardPath: req.auth.dashboardPath,
        ...(req.auth.lguPermissions
          ? { lguPermissions: req.auth.lguPermissions }
          : {}),
      },
      emailVerification: {
        enabled: emailPolicyConfig.emailVerificationEnabled,
        verified: Boolean(req.auth.emailVerified),
      },
    });
  });

  app.get(
    "/api/student/profile",
    requireAuthentication,
    requireRole("Scholar"),
    async (req, res) => {
      const result = await pool.query(
        `SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone_number,
                        u.barangay_id, barangay.barangay_name,
                        student.student_id, student.school_id, school.school_name,
                        student.student_number, student.course, student.year_level
                 FROM "Users" u
                 JOIN "Students" student ON student.user_id = u.user_id
                 JOIN "Schools" school ON school.school_id = student.school_id
                 LEFT JOIN "Barangays" barangay ON barangay.barangay_id = u.barangay_id
                 WHERE u.user_id = $1 AND student.is_active = TRUE`,
        [req.auth.userId],
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ message: "Student profile not found." });
      }
      return res.json({ profile: result.rows[0] });
    },
  );

  app.get(
    "/api/student/applications",
    requireAuthentication,
    requireRole("Scholar"),
    async (req, res) => {
      const capabilities = await getSchemaCapabilities(pool);
      const result = capabilities.relationalProgramSchema
        ? await pool.query(
            `SELECT application.application_id, application.application_status,
                            application.submitted_at, application.created_at, application.updated_at,
                            program.program_id, program.program_name,
                            cycle.cycle_code
                     FROM "Applications" application
                     JOIN "Students" student ON student.student_id = application.student_id
                     JOIN "Funding_Programs" program ON program.program_id = application.program_id
                     LEFT JOIN "Funding_Cycles" cycle
                       ON cycle.funding_cycle_id = program.funding_cycle_id
                     WHERE student.user_id = $1 AND student.is_active = TRUE
                     ORDER BY application.created_at DESC
                     LIMIT $2`,
            [req.auth.userId, MAX_QUEUE_SIZE],
          )
        : await pool.query(
            `SELECT application.application_id, application.application_status,
                            application.submitted_at, application.created_at, application.updated_at,
                            program.program_id, program.program_name,
                            program.funding_cycle AS cycle_code
                     FROM "Applications" application
                     JOIN "Students" student ON student.student_id = application.student_id
                     JOIN "Funding_Programs" program ON program.program_id = application.program_id
                     WHERE student.user_id = $1 AND student.is_active = TRUE
                     ORDER BY application.created_at DESC
                     LIMIT $2`,
            [req.auth.userId, MAX_QUEUE_SIZE],
          );
      return res.json({ applications: result.rows });
    },
  );

  app.post(
    "/api/student/applications",
    requireAuthentication,
    requireRole("Scholar"),
    async (req, res, next) => {
      const input = applicationSchema.safeParse(req.body);
      if (!input.success) {
        return res.status(400).json({
          message: "Application details are invalid.",
          errors: input.error.issues.map(({ path, message }) => ({
            field: path.join("."),
            message,
          })),
        });
      }

      let capabilities;
      try {
        capabilities = await getSchemaCapabilities(pool);
      } catch (error) {
        return next(error);
      }
      if (!capabilities.applicationSubmissionEnabled) {
        return res.status(503).json({
          message:
            "Online applications are unavailable until the required funding and verification database schema is installed.",
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const student = await client.query(
          `SELECT student.student_id, resident.barangay_id
                     FROM "Students" student
                     JOIN "Users" resident ON resident.user_id = student.user_id
                     WHERE student.user_id = $1
                       AND student.student_id = $2
                       AND student.is_active = TRUE
                       AND resident.is_active = TRUE
                     FOR UPDATE OF student`,
          [req.auth.userId, req.auth.scopeId],
        );
        if (student.rowCount !== 1 || !student.rows[0].barangay_id) {
          await client.query("ROLLBACK");
          return res.status(403).json({
            message:
              "An active student profile with a barangay is required to apply.",
          });
        }

        const program = await client.query(
          `SELECT program.program_id
                     FROM "Funding_Programs" program
                     JOIN "Funding_Units" unit
                       ON unit.funding_unit_id = program.funding_unit_id
                     JOIN "Funding_Cycles" cycle
                       ON cycle.funding_cycle_id = program.funding_cycle_id
                     WHERE program.program_id = $1
                       AND program.status = 'active'
                       AND unit.status = 'active'
                       AND cycle.status = 'active'
                       AND (program.start_date IS NULL
                            OR program.start_date <= CURRENT_DATE)
                       AND (program.end_date IS NULL
                            OR program.end_date >= CURRENT_DATE)
                       AND (cycle.start_date IS NULL
                            OR cycle.start_date <= CURRENT_DATE)
                       AND (cycle.end_date IS NULL
                            OR cycle.end_date >= CURRENT_DATE)
                       AND (
                           NOT EXISTS (
                               SELECT 1
                               FROM "Program_Barangay_Allocations" configured
                               WHERE configured.program_id = program.program_id
                           )
                           OR EXISTS (
                               SELECT 1
                               FROM "Program_Barangay_Allocations" allocation
                               WHERE allocation.program_id = program.program_id
                                 AND allocation.barangay_id = $2
                                 AND allocation.allocated_amount >
                                     allocation.reserved_amount + allocation.released_amount
                           )
                       )
                     FOR SHARE OF program`,
          [input.data.programId, student.rows[0].barangay_id],
        );
        if (program.rowCount !== 1) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message:
              "This program is not currently accepting applications for your barangay.",
          });
        }

        const existingApplication = await client.query(
          `SELECT application_id
                     FROM "Applications"
                     WHERE student_id = $1
                       AND program_id = $2
                       AND application_status <> 'withdrawn'
                     LIMIT 1`,
          [student.rows[0].student_id, input.data.programId],
        );
        if (existingApplication.rowCount > 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            message: "You already have an active application for this program.",
          });
        }

        const application = await client.query(
          `INSERT INTO "Applications" (
                        student_id, program_id, barangay_id, application_status
                     ) VALUES ($1, $2, $3, 'draft')
                     RETURNING application_id`,
          [
            student.rows[0].student_id,
            input.data.programId,
            student.rows[0].barangay_id,
          ],
        );
        await client.query(
          `UPDATE "Applications"
                     SET application_status = 'submitted'
                     WHERE application_id = $1`,
          [application.rows[0].application_id],
        );
        const submitted = await client.query(
          `SELECT application.application_id,
                            application.application_status,
                            application.submitted_at
                     FROM "Applications" application
                     WHERE application.application_id = $1`,
          [application.rows[0].application_id],
        );
        await client.query("COMMIT");
        return res.status(201).json({ application: submitted.rows[0] });
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.error("Application transaction rollback failed", {
            code: rollbackError.code,
          });
        }
        if (error.code === "23505") {
          return res.status(409).json({
            message: "You already have an active application for this program.",
          });
        }
        return next(error);
      } finally {
        client.release();
      }
    },
  );

  app.get(
    "/api/student/applications/:applicationId",
    requireAuthentication,
    requireRole("Scholar"),
    async (req, res) => {
      const applicationId = Number(req.params.applicationId);
      if (!Number.isSafeInteger(applicationId) || applicationId < 1) {
        return res.status(400).json({ message: "Application ID is invalid." });
      }
      const capabilities = await getSchemaCapabilities(pool);
      const result = capabilities.relationalProgramSchema
        ? await pool.query(
            `SELECT application.application_id, application.application_status,
                            application.submitted_at, application.created_at, application.updated_at,
                            program.program_id, program.program_name, cycle.cycle_code
                     FROM "Applications" application
                     JOIN "Students" student ON student.student_id = application.student_id
                     JOIN "Funding_Programs" program ON program.program_id = application.program_id
                     LEFT JOIN "Funding_Cycles" cycle
                       ON cycle.funding_cycle_id = program.funding_cycle_id
                     WHERE application.application_id = $1
                       AND student.user_id = $2
                       AND student.is_active = TRUE`,
            [applicationId, req.auth.userId],
          )
        : await pool.query(
            `SELECT application.application_id, application.application_status,
                            application.submitted_at, application.created_at, application.updated_at,
                            program.program_id, program.program_name,
                            program.funding_cycle AS cycle_code
                     FROM "Applications" application
                     JOIN "Students" student ON student.student_id = application.student_id
                     JOIN "Funding_Programs" program ON program.program_id = application.program_id
                     WHERE application.application_id = $1
                       AND student.user_id = $2
                       AND student.is_active = TRUE`,
            [applicationId, req.auth.userId],
          );
      if (result.rowCount === 0) {
        return res.status(404).json({ message: "Application not found." });
      }

      const verifications = capabilities.hasVerificationTable
        ? await pool.query(
            `SELECT verification_type, status, activated_at, reviewed_at
                     FROM "Application_Verifications"
                     WHERE application_id = $1
                     ORDER BY activated_at`,
            [applicationId],
          )
        : { rows: [] };
      return res.json({
        application: result.rows[0],
        verifications: verifications.rows,
      });
    },
  );

  app.get(
    "/api/student/applications/:applicationId/documents",
    requireAuthentication,
    requireRole("Scholar"),
    async (req, res) => {
      const applicationId = Number(req.params.applicationId);
      if (!Number.isSafeInteger(applicationId) || applicationId < 1) {
        return res.status(400).json({ message: "Application ID is invalid." });
      }
      const ownedApplication = await pool.query(
        `SELECT application.application_id
                 FROM "Applications" application
                 JOIN "Students" student ON student.student_id = application.student_id
                 WHERE application.application_id = $1
                   AND student.user_id = $2
                   AND student.is_active = TRUE`,
        [applicationId, req.auth.userId],
      );
      if (ownedApplication.rowCount === 0) {
        return res.status(404).json({ message: "Application not found." });
      }
      const result = await pool.query(
        `SELECT document.document_id, document.document_type,
                        document.is_verified, document.uploaded_at
                 FROM "Documents" document
                 JOIN "Applications" application
                   ON application.application_id = document.application_id
                 JOIN "Students" student ON student.student_id = application.student_id
                 WHERE application.application_id = $1
                   AND student.user_id = $2
                   AND student.is_active = TRUE
                 ORDER BY document.uploaded_at DESC`,
        [applicationId, req.auth.userId],
      );
      return res.json({ documents: result.rows });
    },
  );

  const verificationRoles = [
    {
      path: "/api/coordinator/verifications",
      role: "Barangay Coordinator",
      verificationType: "barangay",
      scopeColumn: "application.barangay_id",
    },
    {
      path: "/api/registrar/verifications",
      role: "Registrar",
      verificationType: "registrar",
      scopeColumn: "student.school_id",
    },
    {
      path: "/api/admin/verifications",
      role: "LGU Admin",
      verificationType: "lgu",
      scopeColumn: "program.funding_unit_id",
    },
  ];

  for (const config of verificationRoles) {
    const { path, role, verificationType, scopeColumn } = config;
    const roleMiddleware = [requireAuthentication, requireRole(role)];

    if (role !== "LGU Admin") {
      app.get(
        `${path.replace("/verifications", "")}/dashboard`,
        ...roleMiddleware,
        async (req, res) => {
          if (!(await requireStaffSchema(res))) return;
          const result = await pool.query(
            `SELECT COUNT(*) FILTER (
                                    WHERE verification.status = 'pending'
                                )::INTEGER AS pending_count,
                                COUNT(*) FILTER (
                                    WHERE verification.status = 'needs_information'
                                )::INTEGER AS needs_information_count
                         FROM "Application_Verifications" verification
                         JOIN "Applications" application
                           ON application.application_id = verification.application_id
                         JOIN "Students" student
                           ON student.student_id = application.student_id
                         JOIN "Funding_Programs" program
                           ON program.program_id = application.program_id
                         WHERE verification.verification_type = $1
                           AND verification.status IN ('pending', 'needs_information')
                           AND ${scopeColumn} = $2`,
            [verificationType, req.auth.scopeId],
          );
          return res.json({ summary: result.rows[0] });
        },
      );
    }

    app.get(path, ...roleMiddleware, async (req, res) => {
      if (!(await requireStaffSchema(res, { admin: role === "LGU Admin" })))
        return;
      const result = await pool.query(
        `SELECT verification.verification_id, verification.application_id,
                        verification.status, verification.activated_at,
                        application.application_status,
                        program.program_name,
                        student.student_number, student.course, student.year_level,
                        student_user.first_name, student_user.last_name,
                        school.school_name, barangay.barangay_name
                 FROM "Application_Verifications" verification
                 JOIN "Applications" application
                   ON application.application_id = verification.application_id
                 JOIN "Students" student ON student.student_id = application.student_id
                 JOIN "Users" student_user ON student_user.user_id = student.user_id
                 JOIN "Schools" school ON school.school_id = student.school_id
                 JOIN "Funding_Programs" program ON program.program_id = application.program_id
                 JOIN "Barangays" barangay ON barangay.barangay_id = application.barangay_id
                 WHERE verification.verification_type = $1
                   AND verification.status IN ('pending', 'needs_information')
                   AND ${scopeColumn} = $2
                 ORDER BY verification.activated_at ASC
                 LIMIT $3`,
        [verificationType, req.auth.scopeId, MAX_QUEUE_SIZE],
      );
      return res.json({ verifications: result.rows });
    });

    app.get(`${path}/:verificationId`, ...roleMiddleware, async (req, res) => {
      if (!(await requireStaffSchema(res, { admin: role === "LGU Admin" })))
        return;
      const verificationId = parsePositiveId(
        req.params.verificationId,
        "Verification ID",
        res,
      );
      if (!verificationId) return;
      const result = await pool.query(
        `SELECT verification.verification_id, verification.application_id,
                        verification.verification_type, verification.status,
                        verification.activated_at, verification.reviewed_at,
                        application.application_status,
                        program.program_name,
                        student.student_number, student.course, student.year_level,
                        student_user.first_name, student_user.last_name,
                        school.school_name, barangay.barangay_name
                 FROM "Application_Verifications" verification
                 JOIN "Applications" application
                   ON application.application_id = verification.application_id
                 JOIN "Students" student ON student.student_id = application.student_id
                 JOIN "Users" student_user ON student_user.user_id = student.user_id
                 JOIN "Schools" school ON school.school_id = student.school_id
                 JOIN "Funding_Programs" program ON program.program_id = application.program_id
                 JOIN "Barangays" barangay ON barangay.barangay_id = application.barangay_id
                 WHERE verification.verification_id = $1
                   AND verification.verification_type = $2
                   AND ${scopeColumn} = $3`,
        [verificationId, verificationType, req.auth.scopeId],
      );
      if (result.rowCount === 0) {
        return res
          .status(404)
          .json({ message: "Verification task not found." });
      }
      const response = { verification: result.rows[0] };
      if (role === "Registrar") {
        const academicRecords = await pool.query(
          `SELECT grade_report.school_year, grade_report.semester,
                            grade_report.gpa, grade_report.remarks,
                            grade_report.submitted_at
                     FROM "Grade_Reports" grade_report
                     JOIN "Registrars" registrar
                       ON registrar.registrar_id = grade_report.registrar_id
                     WHERE grade_report.student_id = (
                         SELECT application.student_id
                         FROM "Applications" application
                         WHERE application.application_id = $1
                     )
                       AND registrar.school_id = $2
                     ORDER BY grade_report.submitted_at DESC
                     LIMIT $3`,
          [result.rows[0].application_id, req.auth.scopeId, MAX_QUEUE_SIZE],
        );
        const eligibilityChecks = await pool.query(
          `SELECT eligibility.check_type, eligibility.result,
                            eligibility.remarks, eligibility.reviewed_at
                     FROM "Eligibility_Checks" eligibility
                     JOIN "Registrars" registrar
                       ON registrar.registrar_id = eligibility.registrar_id
                     WHERE eligibility.student_id = (
                         SELECT application.student_id
                         FROM "Applications" application
                         WHERE application.application_id = $1
                     )
                       AND registrar.school_id = $2
                     ORDER BY eligibility.reviewed_at DESC
                     LIMIT $3`,
          [result.rows[0].application_id, req.auth.scopeId, MAX_QUEUE_SIZE],
        );
        response.academicRecords = {
          gradeReports: academicRecords.rows,
          eligibilityChecks: eligibilityChecks.rows,
        };
      }
      return res.json(response);
    });

    app.patch(
      `${path}/:verificationId`,
      ...roleMiddleware,
      async (req, res, next) => {
        const isAdmin = role === "LGU Admin";
        if (!(await requireStaffSchema(res, { admin: isAdmin }))) return;
        const verificationId = parsePositiveId(
          req.params.verificationId,
          "Verification ID",
          res,
        );
        if (!verificationId) return;
        const input = (
          isAdmin ? applicationDecisionSchema : verificationDecisionSchema
        ).safeParse(req.body);
        if (!input.success) {
          return res.status(400).json({
            message: "Verification decision is invalid.",
            errors: input.error.issues.map(({ path, message }) => ({
              field: path.join("."),
              message,
            })),
          });
        }
        if (isAdmin) {
          const perms = req.auth.lguPermissions || DEFAULT_LGU_PERMISSIONS;
          const requiredPerm =
            input.data.status === "approved"
              ? "award_approval"
              : "application_review";
          if (!perms[requiredPerm]) {
            return res.status(403).json({
              message: `This LGU Admin account does not have the '${requiredPerm}' permission for this action.`,
            });
          }
        }

        const expectedApplicationStatus = {
          barangay: "barangay_verification",
          registrar: "registrar_verification",
          lgu: "lgu_review",
        }[verificationType];
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const current = await client.query(
            `SELECT verification.verification_id,
                                verification.application_id, verification.status,
                                application.application_status,
                                application.program_id
                         FROM "Application_Verifications" verification
                         JOIN "Applications" application
                           ON application.application_id = verification.application_id
                         JOIN "Students" student
                           ON student.student_id = application.student_id
                         JOIN "Funding_Programs" program
                           ON program.program_id = application.program_id
                         WHERE verification.verification_id = $1
                           AND verification.verification_type = $2
                           AND ${scopeColumn} = $3
                         FOR UPDATE OF verification, application`,
            [verificationId, verificationType, req.auth.scopeId],
          );
          if (current.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
              message: "Verification task not found.",
            });
          }
          const task = current.rows[0];
          if (
            task.application_status !== expectedApplicationStatus ||
            !["pending", "needs_information"].includes(task.status) ||
            task.status === input.data.status
          ) {
            await client.query("ROLLBACK");
            return res.status(409).json({
              message:
                "This verification is not in a state that allows the requested decision.",
            });
          }
          const updated = await client.query(
            `UPDATE "Application_Verifications"
                         SET status = $1,
                             remarks = $2,
                             reviewed_by = $3,
                             reviewed_at = CASE
                                 WHEN $1 IN ('approved', 'rejected') THEN NOW()
                                 ELSE NULL
                             END
                         WHERE verification_id = $4
                         RETURNING verification_id, application_id,
                                   verification_type, status, remarks,
                                   reviewed_at`,
            [
              input.data.status,
              input.data.remarks || null,
              req.auth.userId,
              verificationId,
            ],
          );
          let award = null;
          if (isAdmin && input.data.status === "approved") {
            const insertedAward = await client.query(
              `INSERT INTO "Scholarship_Awards" (
                                application_id, program_id, award_amount,
                                award_status, award_date
                             ) VALUES ($1, $2, $3, 'pending', CURRENT_DATE)
                             RETURNING award_id, award_amount`,
              [task.application_id, task.program_id, input.data.awardAmount],
            );
            await client.query("SELECT approve_award($1, $2)", [
              insertedAward.rows[0].award_id,
              req.auth.userId,
            ]);
            award = {
              award_id: insertedAward.rows[0].award_id,
              award_amount: insertedAward.rows[0].award_amount,
              award_status: "approved",
            };
          }
          await client.query(
            `INSERT INTO "Audit_Logs" (
                            user_id, action_type, entity_type, entity_id, details
                         ) VALUES ($1, $2, 'Application_Verifications', $3,
                                   jsonb_build_object(
                                       'verification_type', $4,
                                       'status', $5
                                   ))`,
            [
              req.auth.userId,
              isAdmin
                ? "lgu_application_reviewed"
                : "staff_verification_recorded",
              verificationId,
              verificationType,
              input.data.status,
            ],
          );
          await client.query("COMMIT");
          return res.json({ verification: updated.rows[0], award });
        } catch (error) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            logger.error("Verification decision rollback failed", {
              code: rollbackError.code,
            });
          }
          if (isAdmin && ["P0001", "23505", "23514"].includes(error.code)) {
            return res.status(409).json({
              message:
                "The award could not be approved because workflow, eligibility, duplicate-funding, or budget requirements were not met.",
            });
          }
          if (["P0001", "23514"].includes(error.code)) {
            return res.status(409).json({
              message:
                "The requested verification status transition is not allowed.",
            });
          }
          return next(error);
        } finally {
          client.release();
        }
      },
    );

    if (role === "Registrar") {
      const registrarBase = path.replace("/verifications", "");
      const academicRecordRoutes = [
        {
          path: `${registrarBase}/applications/:applicationId/grade-reports`,
          schema: gradeReportSchema,
          insertSql: `INSERT INTO "Grade_Reports" (
                                    student_id, registrar_id, school_year,
                                    semester, gpa, remarks
                                ) VALUES ($1, $2, $3, $4, $5, $6)
                                RETURNING grade_report_id, school_year,
                                          semester, gpa, remarks, submitted_at`,
          values(data, assignment) {
            return [
              assignment.student_id,
              assignment.registrar_id,
              data.schoolYear,
              data.semester,
              data.gpa,
              data.remarks || null,
            ];
          },
          responseKey: "gradeReport",
          auditAction: "registrar_grade_report_recorded",
        },
        {
          path: `${registrarBase}/applications/:applicationId/eligibility-checks`,
          schema: eligibilityCheckSchema,
          insertSql: `INSERT INTO "Eligibility_Checks" (
                                    student_id, registrar_id, check_type,
                                    result, remarks
                                ) VALUES ($1, $2, $3, $4, $5)
                                RETURNING eligibility_id, check_type,
                                          result, remarks, reviewed_at`,
          values(data, assignment) {
            return [
              assignment.student_id,
              assignment.registrar_id,
              data.checkType,
              data.result,
              data.remarks || null,
            ];
          },
          responseKey: "eligibilityCheck",
          auditAction: "registrar_eligibility_check_recorded",
        },
      ];

      for (const recordRoute of academicRecordRoutes) {
        app.post(
          recordRoute.path,
          ...roleMiddleware,
          async (req, res, next) => {
            if (!(await requireStaffSchema(res))) return;
            const applicationId = parsePositiveId(
              req.params.applicationId,
              "Application ID",
              res,
            );
            if (!applicationId) return;
            const input = recordRoute.schema.safeParse(req.body);
            if (!input.success) {
              return res.status(400).json({
                message: "Academic verification details are invalid.",
                errors: input.error.issues.map(({ path, message }) => ({
                  field: path.join("."),
                  message,
                })),
              });
            }

            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              const assignment = await client.query(
                `SELECT application.application_id,
                                        student.student_id, registrar.registrar_id
                                 FROM "Applications" application
                                 JOIN "Students" student
                                   ON student.student_id = application.student_id
                                 JOIN "Registrars" registrar
                                   ON registrar.user_id = $2
                                  AND registrar.school_id = student.school_id
                                  AND registrar.is_active = TRUE
                                 WHERE application.application_id = $1
                                   AND application.application_status =
                                       'registrar_verification'
                                   AND student.is_active = TRUE
                                   AND registrar.school_id = $3
                                 FOR UPDATE OF application, student, registrar`,
                [applicationId, req.auth.userId, req.auth.scopeId],
              );
              if (assignment.rowCount === 0) {
                await client.query("ROLLBACK");
                return res.status(404).json({
                  message:
                    "Application not found in your school's active verification queue.",
                });
              }
              const result = await client.query(
                recordRoute.insertSql,
                recordRoute.values(input.data, assignment.rows[0]),
              );
              await client.query(
                `INSERT INTO "Audit_Logs" (
                                    user_id, action_type, entity_type, entity_id, details
                                 ) VALUES ($1, $2, $3, $4,
                                           jsonb_build_object(
                                               'application_id', $5,
                                               'school_id', $6
                                           ))`,
                [
                  req.auth.userId,
                  recordRoute.auditAction,
                  recordRoute.responseKey,
                  result.rows[0].grade_report_id ||
                    result.rows[0].eligibility_id,
                  applicationId,
                  req.auth.scopeId,
                ],
              );
              await client.query("COMMIT");
              return res.status(201).json({
                [recordRoute.responseKey]: result.rows[0],
              });
            } catch (error) {
              try {
                await client.query("ROLLBACK");
              } catch (rollbackError) {
                logger.error("Academic record rollback failed", {
                  code: rollbackError.code,
                });
              }
              return next(error);
            } finally {
              client.release();
            }
          },
        );
      }
    }
  }

  const systemAdminMiddleware = [
    requireAuthentication,
    requireRole("System Admin"),
  ];

  app.get(
    "/api/system-admin/lookups",
    ...systemAdminMiddleware,
    async (req, res, next) => {
      try {
        const capabilities = await getSchemaCapabilities(pool);
        const fundingUnits = capabilities.relationalProgramSchema
          ? await pool.query(
              `SELECT funding_unit_id, funding_unit_name, funding_unit_code, status
                         FROM "Funding_Units"
                         WHERE status = 'active'
                         ORDER BY funding_unit_id`,
            )
          : { rows: [] };
        const barangays = await pool.query(
          'SELECT barangay_id, barangay_name FROM "Barangays" ORDER BY barangay_name',
        );
        const schools = await pool.query(
          'SELECT school_id, school_name, is_approved FROM "Schools" ORDER BY school_id',
        );
        const schoolDomains = capabilities.hasSchoolEmailDomains
          ? await pool.query(
              `SELECT sd.domain_id, sd.school_id, s.school_name,
                                sd.domain, sd.domain_status, sd.is_primary,
                                sd.notes, sd.updated_at
                         FROM "School_Email_Domains" sd
                         JOIN "Schools" s ON s.school_id = sd.school_id
                         ORDER BY sd.school_id, sd.is_primary DESC, sd.domain`,
            )
          : { rows: [] };
        return res.json({
          fundingUnits: fundingUnits.rows,
          barangays: barangays.rows,
          schools: schools.rows,
          schoolDomains: schoolDomains.rows,
          lguPermissionCategories: LGU_PERMISSION_CATEGORIES,
          defaultLguPermissions: DEFAULT_LGU_PERMISSIONS,
          emailDeliveryEnabled: emailPolicyConfig.emailVerificationEnabled,
          proposedDirectories: {
            developers: [...emailPolicyConfig.developerAllowlist],
            lguOfficials: PROPOSED_LGU_OFFICIALS_DIRECTORY,
            barangayCoordinators: PROPOSED_BARANGAY_COORDINATOR_DIRECTORY,
            schoolRegistrars: PROPOSED_SCHOOL_REGISTRAR_DIRECTORY,
          },
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.get(
    "/api/system-admin/portal-previews",
    ...systemAdminMiddleware,
    async (req, res, next) => {
      try {
        const result = await pool.query(
          `SELECT preview.user_id, preview.first_name, preview.last_name,
                            preview.email, preview.role_name, preview.scope_id,
                            preview.scope_name, preview.dashboard_path
                     FROM (
                         SELECT u.user_id, u.first_name, u.last_name, u.email,
                                'LGU Admin'::VARCHAR AS role_name,
                                admin.funding_unit_id AS scope_id,
                                unit.funding_unit_name AS scope_name,
                                '/portal/lgu-admin'::VARCHAR AS dashboard_path
                         FROM "Users" u
                         JOIN "LGU_Admins" admin
                           ON admin.user_id = u.user_id AND admin.is_active = TRUE
                         JOIN "Funding_Units" unit
                           ON unit.funding_unit_id = admin.funding_unit_id
                         WHERE u.is_active = TRUE
                         UNION ALL
                         SELECT u.user_id, u.first_name, u.last_name, u.email,
                                'Barangay Coordinator'::VARCHAR AS role_name,
                                coordinator.barangay_id AS scope_id,
                                barangay.barangay_name AS scope_name,
                                '/portal/barangay-coordinator'::VARCHAR AS dashboard_path
                         FROM "Users" u
                         JOIN "Barangay_Coordinators" coordinator
                           ON coordinator.user_id = u.user_id
                          AND coordinator.is_current = TRUE
                          AND coordinator.term_start <= CURRENT_DATE
                          AND (coordinator.term_end IS NULL
                               OR coordinator.term_end >= CURRENT_DATE)
                         JOIN "Barangays" barangay
                           ON barangay.barangay_id = coordinator.barangay_id
                         WHERE u.is_active = TRUE
                         UNION ALL
                         SELECT u.user_id, u.first_name, u.last_name, u.email,
                                'Registrar'::VARCHAR AS role_name,
                                registrar.school_id AS scope_id,
                                school.school_name AS scope_name,
                                '/portal/school-registrar'::VARCHAR AS dashboard_path
                         FROM "Users" u
                         JOIN "Registrars" registrar
                           ON registrar.user_id = u.user_id AND registrar.is_active = TRUE
                         JOIN "Schools" school ON school.school_id = registrar.school_id
                         WHERE u.is_active = TRUE
                     ) preview
                     ORDER BY preview.role_name, preview.scope_name,
                              preview.last_name, preview.first_name`,
        );
        return res.json({
          previews: result.rows.map((row) => ({
            ...row,
            displayName: `${row.first_name} ${row.last_name}`.trim(),
          })),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.get(
    "/api/system-admin/staff-authorizations",
    ...systemAdminMiddleware,
    async (req, res, next) => {
      try {
        const capabilities = await getSchemaCapabilities(pool);
        if (!capabilities.hasStaffAuthorizations) {
          return res.status(503).json({
            message: "The staff authorization schema is not installed.",
          });
        }
        const result = await pool.query(
          `SELECT sa.authorization_id, sa.email, sa.role_name,
                            sa.funding_unit_id, unit.funding_unit_name,
                            sa.barangay_id, barangay.barangay_name,
                            sa.school_id, school.school_name,
                            sa.position_title, sa.lgu_permissions,
                            CASE
                                WHEN sa.status = 'pending'
                                  AND sa.expires_at IS NOT NULL
                                  AND sa.expires_at <= NOW()
                                THEN 'expired'
                                ELSE sa.status
                            END AS status,
                            sa.expires_at,
                            sa.authorized_by,
                            authorizer.email AS authorized_by_email,
                            sa.authorized_at,
                            sa.activated_user_id,
                            sa.activated_at,
                            sa.revoked_by,
                            revoker.email AS revoked_by_email,
                            sa.revoked_at,
                            sa.revocation_reason,
                            sa.notes,
                            sa.updated_at
                     FROM "Staff_Email_Authorizations" sa
                     LEFT JOIN "Funding_Units" unit ON unit.funding_unit_id = sa.funding_unit_id
                     LEFT JOIN "Barangays" barangay ON barangay.barangay_id = sa.barangay_id
                     LEFT JOIN "Schools" school ON school.school_id = sa.school_id
                     LEFT JOIN "Users" authorizer ON authorizer.user_id = sa.authorized_by
                     LEFT JOIN "Users" revoker ON revoker.user_id = sa.revoked_by
                     ORDER BY sa.authorized_at DESC, sa.authorization_id DESC
                     LIMIT $1`,
          [MAX_QUEUE_SIZE * 2],
        );
        return res.json({ authorizations: result.rows });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post(
    "/api/system-admin/staff-authorizations",
    ...systemAdminMiddleware,
    async (req, res, next) => {
      const input = staffAuthorizationCreateSchema.safeParse(req.body);
      if (!input.success) {
        return res.status(400).json({
          message: "Staff authorization details are invalid.",
          errors: input.error.issues.map(({ path, message }) => ({
            field: path.join("."),
            message,
          })),
        });
      }

      const data = input.data;
      if (emailPolicyConfig.developerAllowlist.has(data.email)) {
        return res.status(400).json({
          message:
            "Developer allowlist email addresses cannot be assigned ordinary staff roles via staff invitations.",
          errors: [
            {
              field: "email",
              message: "Use a dedicated staff email address.",
            },
          ],
        });
      }

      if (data.role === "LGU Admin") {
        if (!data.fundingUnitId || data.barangayId || data.schoolId) {
          return res.status(400).json({
            message:
              "LGU Program Admin authorizations require exactly one fundingUnitId and no barangayId or schoolId.",
            errors: [
              {
                field: "fundingUnitId",
                message: "Select one authorized funding unit.",
              },
            ],
          });
        }
      } else if (data.role === "Barangay Coordinator") {
        if (!data.barangayId || data.fundingUnitId || data.schoolId) {
          return res.status(400).json({
            message:
              "Barangay Coordinator authorizations require exactly one barangayId and no fundingUnitId or schoolId.",
            errors: [
              {
                field: "barangayId",
                message: "Select one authorized barangay.",
              },
            ],
          });
        }
      } else if (data.role === "Registrar") {
        if (!data.schoolId || data.fundingUnitId || data.barangayId) {
          return res.status(400).json({
            message:
              "School Registrar authorizations require exactly one schoolId and no fundingUnitId or barangayId.",
            errors: [
              {
                field: "schoolId",
                message: "Select one authorized school.",
              },
            ],
          });
        }
      }

      let capabilities;
      try {
        capabilities = await getSchemaCapabilities(pool);
      } catch (error) {
        return next(error);
      }
      if (!capabilities.hasStaffAuthorizations) {
        return res.status(503).json({
          message: "The staff authorization schema is not installed.",
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [data.email],
        );

        let schoolDomainsForValidation = null;
        if (data.role === "LGU Admin") {
          const unit = await client.query(
            `SELECT funding_unit_id, funding_unit_name
                         FROM "Funding_Units"
                         WHERE funding_unit_id = $1 AND status = 'active'`,
            [data.fundingUnitId],
          );
          if (unit.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              message: "Select an active funding unit.",
              errors: [
                {
                  field: "fundingUnitId",
                  message: "Select an active funding unit.",
                },
              ],
            });
          }
        } else if (data.role === "Barangay Coordinator") {
          const barangay = await client.query(
            'SELECT 1 FROM "Barangays" WHERE barangay_id = $1',
            [data.barangayId],
          );
          if (barangay.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              message: "Select a valid Tagbilaran barangay.",
              errors: [
                {
                  field: "barangayId",
                  message: "Select a valid barangay.",
                },
              ],
            });
          }
        } else if (data.role === "Registrar") {
          const school = await client.query(
            'SELECT 1 FROM "Schools" WHERE school_id = $1 AND is_approved = TRUE',
            [data.schoolId],
          );
          if (school.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              message: "Select an approved partner school.",
              errors: [
                {
                  field: "schoolId",
                  message: "Select an approved school.",
                },
              ],
            });
          }
          if (capabilities.hasSchoolEmailDomains) {
            const sd = await client.query(
              `SELECT domain
                             FROM "School_Email_Domains"
                             WHERE school_id = $1 AND domain_status = 'verified'`,
              [data.schoolId],
            );
            if (sd.rowCount > 0) {
              schoolDomainsForValidation = sd.rows.map((r) => r.domain);
            }
          } else if (DEFAULT_SCHOOL_DOMAIN_BY_ID[data.schoolId]) {
            schoolDomainsForValidation = [
              DEFAULT_SCHOOL_DOMAIN_BY_ID[data.schoolId],
            ];
          }
        }

        const emailCheck = validateEmailForRole(
          data.email,
          data.role,
          emailPolicyConfig,
          {
            isDeveloperAuthorized: true,
            schoolDomain: schoolDomainsForValidation,
          },
        );
        if (!emailCheck.valid) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: emailCheck.message,
            errors: [
              {
                field: "email",
                message: emailCheck.message,
              },
            ],
          });
        }

        const existingAuth = await client.query(
          `SELECT authorization_id, status, expires_at
                     FROM "Staff_Email_Authorizations"
                     WHERE lower(email) = $1
                       AND status IN ('pending', 'active')
                     LIMIT 1
                     FOR UPDATE`,
          [data.email],
        );
        if (existingAuth.rowCount > 0) {
          const current = existingAuth.rows[0];
          const isExpiredPending =
            current.status === "pending" &&
            current.expires_at &&
            new Date(current.expires_at).getTime() <= Date.now();
          if (!isExpiredPending) {
            await client.query("ROLLBACK");
            return res.status(409).json({
              message:
                "An active or pending staff authorization already exists for this email address.",
            });
          }
          await client.query(
            `UPDATE "Staff_Email_Authorizations"
                         SET status = 'expired', updated_at = NOW()
                         WHERE authorization_id = $1`,
            [current.authorization_id],
          );
        }

        const expiresInHours = data.expiresInHours || 72;
        const rawInvitationToken = crypto.randomBytes(32).toString("base64url");
        const resolvedLguPermissions =
          data.role === "LGU Admin"
            ? {
                ...DEFAULT_LGU_PERMISSIONS,
                ...(data.lguPermissions || {}),
              }
            : null;

        const inserted = await client.query(
          `INSERT INTO "Staff_Email_Authorizations" (
                        email, role_name, funding_unit_id, barangay_id, school_id,
                        position_title, lgu_permissions, invitation_token_hash,
                        status, expires_at, authorized_by, authorized_at, notes
                     ) VALUES (
                        $1, $2, $3, $4, $5,
                        $6, $7::JSONB, $8,
                        'pending', NOW() + ($9 * INTERVAL '1 hour'), $10, NOW(), $11
                     )
                     RETURNING authorization_id, email, role_name,
                               funding_unit_id, barangay_id, school_id,
                               position_title, lgu_permissions, status,
                               expires_at, authorized_by, authorized_at, notes`,
          [
            data.email,
            data.role,
            data.role === "LGU Admin" ? data.fundingUnitId : null,
            data.role === "Barangay Coordinator" ? data.barangayId : null,
            data.role === "Registrar" ? data.schoolId : null,
            data.positionTitle || null,
            resolvedLguPermissions
              ? JSON.stringify(resolvedLguPermissions)
              : null,
            tokenHash(rawInvitationToken),
            expiresInHours,
            req.auth.userId,
            data.notes || null,
          ],
        );

        await client.query(
          `INSERT INTO "Audit_Logs" (
                        user_id, action_type, entity_type, entity_id, details
                     ) VALUES ($1, 'staff_authorization_created', 'Staff_Email_Authorizations', $2,
                               jsonb_build_object(
                                   'email', $3::TEXT,
                                   'role_name', $4::TEXT,
                                   'funding_unit_id', $5::INTEGER,
                                   'barangay_id', $6::INTEGER,
                                   'school_id', $7::INTEGER
                               ))`,
          [
            req.auth.userId,
            inserted.rows[0].authorization_id,
            data.email,
            data.role,
            data.fundingUnitId || null,
            data.barangayId || null,
            data.schoolId || null,
          ],
        );

        await client.query("COMMIT");
        return res.status(201).json({
          message: emailPolicyConfig.emailVerificationEnabled
            ? "Staff authorization recorded and invitation prepared for email delivery."
            : "Staff authorization recorded. Automated SMTP delivery is currently disabled; share the single-use invitation token below with the authorized staff member.",
          authorization: inserted.rows[0],
          invitationToken: rawInvitationToken,
          emailDelivery: {
            enabled: emailPolicyConfig.emailVerificationEnabled,
            emailSent: false,
          },
        });
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.error("Staff authorization creation rollback failed", {
            code: rollbackError.code,
          });
        }
        if (error.code === "23505") {
          return res.status(409).json({
            message:
              "An active or pending staff authorization already exists for this email address.",
          });
        }
        return next(error);
      } finally {
        client.release();
      }
    },
  );

  app.post(
    "/api/system-admin/staff-authorizations/:authorizationId/regenerate-token",
    ...systemAdminMiddleware,
    async (req, res, next) => {
      const authorizationId = parsePositiveId(
        req.params.authorizationId,
        "Authorization ID",
        res,
      );
      if (!authorizationId) return;
      try {
        const capabilities = await getSchemaCapabilities(pool);
        if (!capabilities.hasStaffAuthorizations) {
          return res.status(503).json({
            message: "The staff authorization schema is not installed.",
          });
        }
        const rawInvitationToken = crypto.randomBytes(32).toString("base64url");
        const updated = await pool.query(
          `UPDATE "Staff_Email_Authorizations"
                     SET invitation_token_hash = $1,
                         status = 'pending',
                         expires_at = NOW() + INTERVAL '72 hours',
                         updated_at = NOW()
                     WHERE authorization_id = $2
                       AND status IN ('pending', 'expired')
                     RETURNING authorization_id, email, role_name, status, expires_at`,
          [tokenHash(rawInvitationToken), authorizationId],
        );
        if (updated.rowCount === 0) {
          return res.status(409).json({
            message:
              "Only pending or expired invitations can regenerate a token.",
          });
        }
        await pool.query(
          `INSERT INTO "Audit_Logs" (
                        user_id, action_type, entity_type, entity_id, details
                     ) VALUES ($1, 'staff_invitation_regenerated', 'Staff_Email_Authorizations', $2,
                               jsonb_build_object('email', $3::TEXT))`,
          [req.auth.userId, authorizationId, updated.rows[0].email],
        );
        return res.json({
          message: "Invitation token regenerated.",
          authorization: updated.rows[0],
          invitationToken: rawInvitationToken,
          emailDelivery: {
            enabled: emailPolicyConfig.emailVerificationEnabled,
            emailSent: false,
          },
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post(
    "/api/system-admin/staff-authorizations/:authorizationId/revoke",
    ...systemAdminMiddleware,
    async (req, res, next) => {
      const authorizationId = parsePositiveId(
        req.params.authorizationId,
        "Authorization ID",
        res,
      );
      if (!authorizationId) return;
      const input = staffAuthorizationRevokeSchema.safeParse(req.body || {});
      if (!input.success) {
        return res.status(400).json({
          message: "Revocation details are invalid.",
          errors: input.error.issues.map(({ path, message }) => ({
            field: path.join("."),
            message,
          })),
        });
      }

      let capabilities;
      try {
        capabilities = await getSchemaCapabilities(pool);
      } catch (error) {
        return next(error);
      }
      if (!capabilities.hasStaffAuthorizations) {
        return res.status(503).json({
          message: "The staff authorization schema is not installed.",
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query(
          `SELECT authorization_id, email, role_name, status, activated_user_id
                     FROM "Staff_Email_Authorizations"
                     WHERE authorization_id = $1
                     FOR UPDATE`,
          [authorizationId],
        );
        if (current.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({
            message: "Staff authorization not found.",
          });
        }
        const authRecord = current.rows[0];
        if (authRecord.status === "revoked") {
          await client.query("ROLLBACK");
          return res.status(409).json({
            message: "This staff authorization is already revoked.",
          });
        }

        const revoked = await client.query(
          `UPDATE "Staff_Email_Authorizations"
                     SET status = 'revoked',
                         revoked_by = $1,
                         revoked_at = NOW(),
                         revocation_reason = $2,
                         invitation_token_hash = NULL,
                         updated_at = NOW()
                     WHERE authorization_id = $3
                     RETURNING authorization_id, email, role_name, status,
                               revoked_by, revoked_at, revocation_reason`,
          [req.auth.userId, input.data.reason || null, authorizationId],
        );

        const matchingUser = await client.query(
          `SELECT user_id
                     FROM "Users"
                     WHERE user_id = $1 OR lower(email) = lower($2)
                     LIMIT 1
                     FOR UPDATE`,
          [authRecord.activated_user_id || -1, authRecord.email],
        );

        let revokedSessionCount = 0;
        if (matchingUser.rowCount > 0) {
          const targetUserId = matchingUser.rows[0].user_id;
          await client.query(
            'UPDATE "Users" SET is_active = FALSE WHERE user_id = $1',
            [targetUserId],
          );
          await client.query(
            'UPDATE "LGU_Admins" SET is_active = FALSE WHERE user_id = $1',
            [targetUserId],
          );
          await client.query(
            `UPDATE "Barangay_Coordinators"
                         SET is_current = FALSE,
                             term_end = COALESCE(term_end, CURRENT_DATE)
                         WHERE user_id = $1 AND is_current = TRUE`,
            [targetUserId],
          );
          await client.query(
            'UPDATE "Registrars" SET is_active = FALSE WHERE user_id = $1',
            [targetUserId],
          );
          const revokedSessions = await client.query(
            `UPDATE "Login_Sessions"
                         SET revoked_at = NOW()
                         WHERE user_id = $1 AND revoked_at IS NULL`,
            [targetUserId],
          );
          revokedSessionCount = revokedSessions.rowCount || 0;
        }

        await client.query(
          `INSERT INTO "Audit_Logs" (
                        user_id, action_type, entity_type, entity_id, details
                     ) VALUES ($1, 'staff_authorization_revoked', 'Staff_Email_Authorizations', $2,
                               jsonb_build_object(
                                   'email', $3::TEXT,
                                   'role_name', $4::TEXT,
                                   'reason', $5::TEXT,
                                   'revoked_sessions', $6::INTEGER
                               ))`,
          [
            req.auth.userId,
            authorizationId,
            authRecord.email,
            authRecord.role_name,
            input.data.reason || "",
            revokedSessionCount,
          ],
        );

        await client.query("COMMIT");
        return res.json({
          message:
            "Staff authorization revoked and active sessions terminated.",
          authorization: revoked.rows[0],
          sessionsRevoked: true,
          revokedSessionCount,
        });
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.error("Staff revocation rollback failed", {
            code: rollbackError.code,
          });
        }
        return next(error);
      } finally {
        client.release();
      }
    },
  );

  app.get(
    "/api/system-admin/school-domains",
    ...systemAdminMiddleware,
    async (req, res, next) => {
      try {
        const capabilities = await getSchemaCapabilities(pool);
        if (!capabilities.hasSchoolEmailDomains) {
          return res.status(503).json({
            message: "The school email domains schema is not installed.",
          });
        }
        const result = await pool.query(
          `SELECT sd.domain_id, sd.school_id, s.school_name, s.is_approved,
                            sd.domain, sd.domain_status, sd.is_primary,
                            sd.notes, sd.created_at, sd.updated_at
                     FROM "School_Email_Domains" sd
                     JOIN "Schools" s ON s.school_id = sd.school_id
                     ORDER BY sd.school_id, sd.is_primary DESC, sd.domain`,
        );
        return res.json({ schoolDomains: result.rows });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post(
    "/api/system-admin/school-domains",
    ...systemAdminMiddleware,
    async (req, res, next) => {
      const input = schoolDomainCreateSchema.safeParse(req.body);
      if (!input.success) {
        return res.status(400).json({
          message: "School domain configuration is invalid.",
          errors: input.error.issues.map(({ path, message }) => ({
            field: path.join("."),
            message,
          })),
        });
      }
      const data = input.data;
      if (!data.schoolId && !data.schoolName) {
        return res.status(400).json({
          message: "Provide either an existing schoolId or a new schoolName.",
        });
      }

      let capabilities;
      try {
        capabilities = await getSchemaCapabilities(pool);
      } catch (error) {
        return next(error);
      }
      if (!capabilities.hasSchoolEmailDomains) {
        return res.status(503).json({
          message: "The school email domains schema is not installed.",
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        let targetSchoolId = data.schoolId || null;
        let schoolRecord = null;

        if (targetSchoolId) {
          const existingSchool = await client.query(
            'SELECT school_id, school_name, is_approved FROM "Schools" WHERE school_id = $1',
            [targetSchoolId],
          );
          if (existingSchool.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "School not found." });
          }
          schoolRecord = existingSchool.rows[0];
        } else {
          const createdSchool = await client.query(
            `INSERT INTO "Schools" (school_name, is_approved)
                         VALUES ($1, TRUE)
                         ON CONFLICT (school_name) DO UPDATE SET is_approved = TRUE
                         RETURNING school_id, school_name, is_approved`,
            [data.schoolName],
          );
          schoolRecord = createdSchool.rows[0];
          targetSchoolId = schoolRecord.school_id;
        }

        let domainRecord = null;
        if (data.domain) {
          const insertedDomain = await client.query(
            `INSERT INTO "School_Email_Domains" (
                            school_id, domain, domain_status, is_primary, configured_by, notes
                         ) VALUES ($1, $2, $3, $4, $5, $6)
                         RETURNING domain_id, school_id, domain, domain_status, is_primary, notes`,
            [
              targetSchoolId,
              data.domain,
              data.domainStatus || "verified",
              data.isPrimary !== undefined ? data.isPrimary : true,
              req.auth.userId,
              data.notes || null,
            ],
          );
          domainRecord = insertedDomain.rows[0];
        }

        await client.query(
          `INSERT INTO "Audit_Logs" (
                        user_id, action_type, entity_type, entity_id, details
                     ) VALUES ($1, 'school_domain_configured', 'Schools', $2,
                               jsonb_build_object(
                                   'school_name', $3::TEXT,
                                   'domain', $4::TEXT
                               ))`,
          [
            req.auth.userId,
            targetSchoolId,
            schoolRecord.school_name,
            data.domain || "",
          ],
        );

        await client.query("COMMIT");
        return res.status(201).json({
          school: schoolRecord,
          schoolDomain: domainRecord,
        });
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.error("School domain configuration rollback failed", {
            code: rollbackError.code,
          });
        }
        if (error.code === "23505") {
          return res.status(409).json({
            message: "This school email domain is already configured.",
          });
        }
        return next(error);
      } finally {
        client.release();
      }
    },
  );

  app.patch(
    "/api/system-admin/school-domains/:domainId",
    ...systemAdminMiddleware,
    async (req, res, next) => {
      const domainId = parsePositiveId(req.params.domainId, "Domain ID", res);
      if (!domainId) return;
      const input = schoolDomainUpdateSchema.safeParse(req.body);
      if (!input.success) {
        return res.status(400).json({
          message: "School domain update is invalid.",
          errors: input.error.issues.map(({ path, message }) => ({
            field: path.join("."),
            message,
          })),
        });
      }
      try {
        const capabilities = await getSchemaCapabilities(pool);
        if (!capabilities.hasSchoolEmailDomains) {
          return res.status(503).json({
            message: "The school email domains schema is not installed.",
          });
        }
        const fields = {
          domain: "domain",
          domainStatus: "domain_status",
          isPrimary: "is_primary",
          notes: "notes",
        };
        const values = [domainId];
        const updates = Object.entries(input.data).map(([key, value]) => {
          values.push(value);
          return `${fields[key]} = $${values.length}`;
        });
        updates.push("updated_at = NOW()");
        const result = await pool.query(
          `UPDATE "School_Email_Domains"
                     SET ${updates.join(", ")}
                     WHERE domain_id = $1
                     RETURNING domain_id, school_id, domain, domain_status, is_primary, notes, updated_at`,
          values,
        );
        if (result.rowCount === 0) {
          return res.status(404).json({ message: "School domain not found." });
        }
        await pool.query(
          `INSERT INTO "Audit_Logs" (
                        user_id, action_type, entity_type, entity_id, details
                     ) VALUES ($1, 'school_domain_updated', 'School_Email_Domains', $2,
                               jsonb_build_object('domain', $3::TEXT, 'status', $4::TEXT))`,
          [
            req.auth.userId,
            domainId,
            result.rows[0].domain,
            result.rows[0].domain_status,
          ],
        );
        return res.json({ schoolDomain: result.rows[0] });
      } catch (error) {
        if (error.code === "23505") {
          return res.status(409).json({
            message: "This school email domain is already assigned.",
          });
        }
        return next(error);
      }
    },
  );

  app.get(
    "/api/system-admin/audit-logs",
    ...systemAdminMiddleware,
    async (req, res, next) => {
      try {
        const result = await pool.query(
          `SELECT log.log_id, log.user_id, actor.email AS actor_email,
                            actor.first_name AS actor_first_name,
                            actor.last_name AS actor_last_name,
                            log.action_type, log.entity_type, log.entity_id,
                            log.details, log.created_at
                     FROM "Audit_Logs" log
                     LEFT JOIN "Users" actor ON actor.user_id = log.user_id
                     ORDER BY log.created_at DESC, log.log_id DESC
                     LIMIT $1`,
          [MAX_QUEUE_SIZE],
        );
        return res.json({ auditLogs: result.rows });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (
      error instanceof SyntaxError &&
      error.status === 400 &&
      "body" in error
    ) {
      return res.status(400).json({
        message: "Request body must be valid JSON.",
        errors: [
          { field: "body", message: "Request body must be valid JSON." },
        ],
      });
    }
    logger.error("Request failed", {
      method: req.method,
      path: req.path,
      code: error.code,
      name: error.name,
    });
    return res.status(500).json({ message: "An internal error occurred." });
  });

  return app;
}

module.exports = {
  createApp,
  SESSION_COOKIE,
  ROLE_PORTAL_PATHS,
  ROLE_SCOPE_TYPES,
  normalizeEmail,
  parseEmailAddress,
  getEmailPolicyConfig,
  validateEmailForRole,
  tokenHash,
};
