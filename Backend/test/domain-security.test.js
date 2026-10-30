const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateEmailForRole,
  isOfficialSchoolEmailDomain,
  getEmailPolicyConfig,
  createApp,
} = require("../app");
const {
  BLOCKED_CANDIDATE_SCHOOL_DOMAINS,
  CANDIDATE_DOMAIN_ERROR,
} = require("../staff-directory-config");
const request = require("supertest");

const policyConfig = getEmailPolicyConfig();

class FakeSecurityPool {
  async connect() {
    return this;
  }
  release() {}
  async query(text) {
    const sql = String(text || "").replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.startsWith("SELECT ( to_regclass(")) {
      return {
        rowCount: 1,
        rows: [
          {
            relational_program_schema: true,
            application_workflow_schema: true,
            has_verification_table: true,
            has_admin_funding_unit_assignment: true,
            has_program_budget_balances: true,
            has_award_approval_function: true,
            has_staff_admin_workflow: true,
            has_staff_authorizations: false,
            has_notifications_table: true,
            has_school_email_domains: true,
            has_user_email_verified_at: true,
          },
        ],
      };
    }
    return { rowCount: 0, rows: [] };
  }
}

test("1. Accepts all five official institutional student email domains", () => {
  const officialEmails = [
    "student@hnu.edu.ph",
    "scholar@bisu.edu.ph",
    "juan@universityofbohol.edu.ph",
    "maria@tagbilarancitycollege.edu.ph",
    "jose@pmicollegesbohol.edu.ph",
  ];

  for (const email of officialEmails) {
    const res = validateEmailForRole(email, "Scholar", policyConfig);
    assert.equal(res.valid, true, `Expected ${email} to be accepted`);
    assert.equal(
      isOfficialSchoolEmailDomain(res.domain, policyConfig),
      true,
      `Expected domain ${res.domain} to be official`,
    );
  }
});

test("2. Rejects all blocked candidate domains with exact required message", () => {
  const candidateEmails = [
    "student@ub.edu.ph",
    "student@tcc.edu.ph",
    "student@pmi-bohol.edu.ph",
  ];

  for (const email of candidateEmails) {
    const res = validateEmailForRole(email, "Scholar", policyConfig);
    assert.equal(res.valid, false, `Expected ${email} to be rejected`);
    assert.equal(
      res.message,
      CANDIDATE_DOMAIN_ERROR,
      `Expected exact candidate domain error message for ${email}`,
    );
    assert.equal(
      res.isBlockedCandidateDomain,
      true,
      `Expected isBlockedCandidateDomain flag for ${email}`,
    );
  }
});

test("3. Normalizes email addresses with uppercase and leading/trailing spaces", () => {
  const variations = [
    {
      input: "  STUDENT@HNU.EDU.PH  ",
      expectedValid: true,
      expectedDomain: "hnu.edu.ph",
    },
    {
      input: "\tUSER@UB.EDU.PH\n",
      expectedValid: false,
      expectedMessage: CANDIDATE_DOMAIN_ERROR,
    },
    {
      input: "  Applicant@TagbilaranCityCollege.Edu.Ph  ",
      expectedValid: true,
      expectedDomain: "tagbilarancitycollege.edu.ph",
    },
    {
      input: "  test@TCC.EDU.PH  ",
      expectedValid: false,
      expectedMessage: CANDIDATE_DOMAIN_ERROR,
    },
  ];

  for (const item of variations) {
    const res = validateEmailForRole(item.input, "Scholar", policyConfig);
    if (item.expectedValid) {
      assert.equal(res.valid, true);
      assert.equal(res.domain, item.expectedDomain);
    } else {
      assert.equal(res.valid, false);
      assert.equal(res.message, item.expectedMessage);
    }
  }
});

test("4. Rejects lookalike and unauthorized domains via exact domain matching", () => {
  const unauthorized = [
    "student@fakehnu.edu.ph",
    "student@hnu.edu.ph.attacker.com",
    "student@attacker-bisu.edu.ph",
    "student@universityofbohol.com",
    "student@tagbilarancitycollege.com",
    "student@pmicolleges.com",
    "student@randomcollege.edu.ph",
  ];

  for (const email of unauthorized) {
    const res = validateEmailForRole(email, "Scholar", policyConfig);
    assert.equal(res.valid, false, `Expected ${email} to be rejected`);
  }
});

test("5. Rejects invalid email formats", () => {
  const invalid = [
    "invalid-email",
    "student@",
    "@hnu.edu.ph",
    "student@hnu..edu.ph",
    "student<test>@hnu.edu.ph",
    "",
  ];

  for (const email of invalid) {
    const res = validateEmailForRole(email, "Scholar", policyConfig);
    assert.equal(res.valid, false);
  }
});

test("6. Candidate domain login attempts receive HTTP 401 with exact message without revealing account existence", async () => {
  const app = createApp({
    pool: new FakeSecurityPool(),
    enableTestRegistration: true,
    env: { NODE_ENV: "test", FRONTEND_ORIGIN: "http://localhost:5173" },
    logger: { error() {}, info() {} },
  });

  const candidateLogins = [
    "student@ub.edu.ph",
    "  STUDENT@TCC.EDU.PH  ",
    "user@pmi-bohol.edu.ph",
  ];

  for (const email of candidateLogins) {
    const response = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5173")
      .send({
        email,
        password: "SomePassword#2026!",
      });

    assert.equal(response.status, 401);
    assert.equal(response.body.message, CANDIDATE_DOMAIN_ERROR);
  }
});

test("7. Registration with blocked candidate domain returns HTTP 400 with exact error message", async () => {
  const app = createApp({
    pool: new FakeSecurityPool(),
    enableTestRegistration: true,
    env: { NODE_ENV: "test", FRONTEND_ORIGIN: "http://localhost:5173" },
    logger: { error() {}, info() {} },
  });

  const response = await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send({
      firstName: "Test",
      lastName: "Student",
      email: "student@ub.edu.ph",
      password: "ValidPassphrase#2026!",
      confirmPassword: "ValidPassphrase#2026!",
      barangayId: 1,
      schoolId: 3,
      studentNumber: "UB-2026-001",
      course: "BS Nursing",
    });

  assert.equal(response.status, 400);
  assert.equal(
    response.body.errors.some((e) => e.message === CANDIDATE_DOMAIN_ERROR),
    true,
  );
});

test("8. Staff and administrator accounts are not restricted by student domain policies", () => {
  const staffAccounts = [
    { email: "admin.angela@gmail.com", role: "System Admin" },
    { email: "admin.marie@gmail.com", role: "System Admin" },
    { email: "admin.tagbilarancitylgu@gmail.com", role: "LGU Admin" },
    { email: "registar.holynameuniversity@gmail.com", role: "Registrar" },
    { email: "cuevas.sharee_angela@hnu.edu.ph", role: "System Admin" },
  ];

  for (const acc of staffAccounts) {
    const res = validateEmailForRole(acc.email, acc.role, policyConfig, {
      allowExactRoleEmailLoginException: true,
    });
    assert.equal(
      res.valid,
      true,
      `Expected staff account ${acc.email} with role ${acc.role} to remain valid`,
    );
  }
});
