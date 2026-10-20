const assert = require("node:assert/strict");
const argon2 = require("argon2");
const crypto = require("node:crypto");
const { before, test } = require("node:test");
const request = require("supertest");
const { createApp, SESSION_COOKIE } = require("../app");

const FRONTEND_ORIGIN = "http://localhost:5173";

const fixtureUsers = {
    studentA: {
        user_id: 11,
        first_name: "Student",
        last_name: "One",
        email: "one@gmail.com",
        role_name: "Scholar",
        student_id: 101
    },
    studentB: {
        user_id: 22,
        first_name: "Student",
        last_name: "Two",
        email: "two@hnu.edu.ph",
        role_name: "Scholar",
        student_id: 202
    },
    studentWithoutAssignment: {
        user_id: 23,
        first_name: "Unassigned",
        last_name: "Student",
        email: "unassigned@gmail.com",
        role_name: "Scholar"
    },
    unsupportedRole: {
        user_id: 24,
        first_name: "Unsupported",
        last_name: "Role",
        email: "unsupported@gmail.com",
        role_name: "Auditor"
    },
    inactiveStudent: {
        user_id: 25,
        first_name: "Inactive",
        last_name: "Student",
        email: "inactive@gmail.com",
        role_name: "Scholar",
        student_id: 303,
        is_active: false
    },
    coordinatorA: {
        user_id: 33,
        first_name: "Coordinator",
        last_name: "One",
        email: "coordinator@gmail.com",
        role_name: "Barangay Coordinator",
        coordinator_barangay_id: 7
    },
    registrarA: {
        user_id: 44,
        first_name: "Registrar",
        last_name: "One",
        email: "registrar@hnu.edu.ph",
        role_name: "Registrar",
        registrar_school_id: 31
    },
    adminA: {
        user_id: 55,
        first_name: "Admin",
        last_name: "One",
        email: "admin@lgu-tagbilaran.example",
        role_name: "LGU Admin",
        funding_unit_id: 41
    },
    developerA: {
        user_id: 66,
        first_name: "Developer",
        last_name: "One",
        email: "cuevas.sharee_angela@hnu.edu.ph",
        role_name: "System Admin"
    }
};

const tokenToUser = new Map();
const invalidSessionHashes = new Set();
let loginPasswordHash;
const applicationOwners = new Map([
    [5001, 101],
    [5002, 202]
]);
const verificationScopes = new Map([
    [601, { type: "barangay", scopeId: 7 }],
    [602, { type: "barangay", scopeId: 8 }],
    [611, { type: "registrar", scopeId: 31 }],
    [612, { type: "registrar", scopeId: 32 }],
    [621, { type: "lgu", scopeId: 41 }],
    [622, { type: "lgu", scopeId: 42 }]
]);
const verifications = [
    { verification_id: 601, type: "barangay", scopeId: 7 },
    { verification_id: 602, type: "barangay", scopeId: 8 },
    { verification_id: 611, type: "registrar", scopeId: 31 },
    { verification_id: 612, type: "registrar", scopeId: 32 },
    { verification_id: 621, type: "lgu", scopeId: 41 },
    { verification_id: 622, type: "lgu", scopeId: 42 }
];

function createToken(userOrKey) {
    const token = crypto.randomBytes(32).toString("base64url");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    tokenToUser.set(
        hash,
        typeof userOrKey === "string" ? fixtureUsers[userOrKey] : userOrKey
    );
    return token;
}

const tokens = {
    studentA: createToken("studentA"),
    studentB: createToken("studentB"),
    studentWithoutAssignment: createToken("studentWithoutAssignment"),
    unsupportedRole: createToken("unsupportedRole"),
    inactiveStudent: createToken("inactiveStudent"),
    coordinatorA: createToken("coordinatorA"),
    registrarA: createToken("registrarA"),
    adminA: createToken("adminA"),
    developerA: createToken("developerA")
};

class FakePool {
    async connect() {
        this.connectCount = (this.connectCount || 0) + 1;
        return this;
    }

    release() {}

    async query(query, values = []) {
        const sql = query.replace(/\s+/g, " ").trim();
        this.queries ||= [];
        this.queries.push(sql);

        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
            return { rowCount: 0, rows: [] };
        }

        if (sql.startsWith("SELECT ( to_regclass(")) {
            const relationalSchema = !this.legacyProgramSchema;
            const workflowSchema =
                relationalSchema && this.applicationWorkflowReady !== false;
            return {
                rowCount: 1,
                rows: [{
                    relational_program_schema: relationalSchema,
                    application_workflow_schema: workflowSchema,
                    has_verification_table: workflowSchema,
                    has_admin_funding_unit_assignment: relationalSchema,
                    has_program_budget_balances: relationalSchema,
                    has_award_approval_function: relationalSchema,
                    has_staff_admin_workflow: relationalSchema
                }]
            };
        }

        if (sql.startsWith("SELECT pg_advisory_xact_lock")) {
            return { rowCount: 1, rows: [{}] };
        }

        if (sql.startsWith('SELECT 1 FROM "Users" WHERE lower(email)')) {
            if (this.duplicateEmail) {
                return { rowCount: 1, rows: [{}] };
            }
            return { rowCount: 0, rows: [] };
        }

        if (
            sql.startsWith('SELECT 1 FROM "Students"')
        ) {
            if (this.duplicateStudentNumber) {
                return { rowCount: 1, rows: [{}] };
            }
            return { rowCount: 0, rows: [{}] };
        }

        if (sql.startsWith("SELECT program.program_id, program.program_name,")) {
            return {
                rowCount: 1,
                rows: [{
                    program_id: 701,
                    program_name: "Fixture Grant",
                    application_start_date: "2026-01-01",
                    application_end_date: "2026-12-31",
                    cycle_code: "2026-2027",
                    cycle_start_date: "2026-01-01",
                    cycle_end_date: "2026-12-31",
                    funding_unit_name: "Fixture Unit",
                    availability: "open"
                }]
            };
        }

        if (sql.startsWith('SELECT program_id, program_name, funding_cycle AS cycle_code')) {
            return {
                rowCount: 1,
                rows: [{
                    program_id: 702,
                    program_name: "Legacy Fixture Grant",
                    cycle_code: "2025-2026",
                    application_start_date: null,
                    application_end_date: null,
                    availability: "open"
                }]
            };
        }

        if (sql.startsWith("SELECT student.student_id, resident.barangay_id")) {
            const user = Object.values(fixtureUsers).find(
                (candidate) =>
                    candidate.user_id === Number(values[0]) &&
                    candidate.student_id === Number(values[1])
            );
            return {
                rowCount: user ? 1 : 0,
                rows: user ? [{
                    student_id: user.student_id,
                    barangay_id: 7
                }] : []
            };
        }

        if (sql.startsWith('SELECT program.program_id FROM "Funding_Programs"')) {
            if (this.applicationProgramUnavailable) {
                return { rowCount: 0, rows: [] };
            }
            return { rowCount: 1, rows: [{ program_id: Number(values[0]) }] };
        }

        if (sql.startsWith('SELECT application_id FROM "Applications"')) {
            return this.existingApplication
                ? { rowCount: 1, rows: [{ application_id: 5001 }] }
                : { rowCount: 0, rows: [] };
        }

        if (sql.startsWith('INSERT INTO "Applications"')) {
            this.createdApplicationId = 7001;
            this.createdApplicationValues = values;
            return {
                rowCount: 1,
                rows: [{ application_id: this.createdApplicationId }]
            };
        }

        if (sql.startsWith("UPDATE \"Applications\" SET application_status = 'submitted'")) {
            this.applicationSubmitted = true;
            return { rowCount: 1, rows: [] };
        }

        if (sql.includes(
            'application.submitted_at FROM "Applications" application WHERE application.application_id = $1'
        )) {
            return {
                rowCount: 1,
                rows: [{
                    application_id: this.createdApplicationId,
                    application_status: "barangay_verification",
                    submitted_at: "2026-01-01T00:00:00.000Z"
                }]
            };
        }

        if (sql.startsWith('SELECT barangay_id, barangay_name FROM "Barangays"')) {
            return {
                rowCount: 1,
                rows: [{ barangay_id: 1, barangay_name: "Fixture Barangay" }]
            };
        }

        if (sql.startsWith('SELECT school_id, school_name FROM "Schools"')) {
            return {
                rowCount: 1,
                rows: [{ school_id: 1, school_name: "Fixture School" }]
            };
        }

        if (sql.startsWith('SELECT 1 FROM "Barangays"')) {
            return { rowCount: 1, rows: [{}] };
        }

        if (sql.startsWith('SELECT 1 FROM "Schools"')) {
            return { rowCount: 1, rows: [{}] };
        }

        if (sql.startsWith('SELECT role_id FROM "Roles"')) {
            const roleMap = {
                "LGU Admin": 1,
                "Barangay Coordinator": 2,
                Registrar: 3,
                Scholar: 4
            };
            const roleId = roleMap[values[0]] || 4;
            return { rowCount: 1, rows: [{ role_id: roleId }] };
        }

        if (sql.startsWith('INSERT INTO "Users"')) {
            this.registrationWriteCount = (this.registrationWriteCount || 0) + 1;
            this.insertedUserValues = values;
            return { rowCount: 1, rows: [{ user_id: 88 }] };
        }

        if (sql.startsWith('INSERT INTO "Students"')) {
            this.registrationWriteCount = (this.registrationWriteCount || 0) + 1;
            this.insertedStudentValues = values;
            return { rowCount: 1, rows: [] };
        }

        if (sql.startsWith('INSERT INTO "LGU_Admins"')) {
            this.insertedLguAdminValues = values;
            return { rowCount: 1, rows: [] };
        }

        if (sql.startsWith('INSERT INTO "Barangay_Coordinators"')) {
            this.insertedCoordinatorValues = values;
            return { rowCount: 1, rows: [] };
        }

        if (sql.startsWith('INSERT INTO "Registrars"')) {
            this.insertedRegistrarValues = values;
            return { rowCount: 1, rows: [] };
        }

        if (sql.startsWith('INSERT INTO "Audit_Logs"')) {
            this.insertedAuditLogValues = values;
            return { rowCount: 1, rows: [] };
        }

        if (sql.includes('FROM "Users" u JOIN "Roles"')) {
            const user = Object.values(fixtureUsers).find(
                (candidate) => candidate.email === values[0]
            );
            return {
                rowCount: user ? 1 : 0,
                rows: user
                    ? [{
                        user_id: user.user_id,
                        first_name: user.first_name,
                        last_name: user.last_name,
                        email: user.email,
                        password_hash: loginPasswordHash,
                        is_active: user.is_active !== false,
                        role_name: user.role_name,
                        student_id: user.student_id,
                        funding_unit_id: user.funding_unit_id,
                        coordinator_barangay_id: user.coordinator_barangay_id,
                        registrar_school_id: user.registrar_school_id
                    }]
                    : []
            };
        }

        if (sql.startsWith('INSERT INTO "Login_Sessions"')) {
            const user = Object.values(fixtureUsers).find(
                (candidate) => candidate.user_id === Number(values[0])
            );
            if (user) tokenToUser.set(values[1], user);
            return { rowCount: 1, rows: [] };
        }

        if (sql.startsWith('UPDATE "Login_Sessions"')) {
            tokenToUser.delete(values[0]);
            return { rowCount: 1, rows: [] };
        }

        if (sql.includes('FROM "Login_Sessions" session')) {
            this.sessionLookupCount = (this.sessionLookupCount || 0) + 1;
            const user = tokenToUser.get(values[0]);
            const sessionInvalid =
                invalidSessionHashes.has(values[0]) || user?.is_active === false;
            if (
                sql.includes("session.revoked_at IS NULL") &&
                sql.includes("session.expires_at > NOW()") &&
                sql.includes("u.is_active = TRUE")
            ) {
                return {
                    rowCount: user && !sessionInvalid ? 1 : 0,
                    rows: user && !sessionInvalid ? [user] : []
                };
            }
            return { rowCount: user ? 1 : 0, rows: user ? [user] : [] };
        }

        if (sql.startsWith('SELECT application.application_id FROM "Applications" application')) {
            const applicationId = Number(values[0]);
            const userId = Number(values[1]);
            const expectedStudentId = applicationOwners.get(applicationId);
            const user = Object.values(fixtureUsers).find(
                (candidate) => candidate.user_id === userId
            );
            const authorized =
                expectedStudentId !== undefined &&
                user?.student_id === expectedStudentId;
            return {
                rowCount: authorized ? 1 : 0,
                rows: authorized ? [{ application_id: applicationId }] : []
            };
        }

        if (
            sql.includes('FROM "Applications" application') &&
            sql.includes("WHERE student.user_id = $1")
        ) {
            const userId = Number(values[0]);
            const user = Object.values(fixtureUsers).find(
                (candidate) => candidate.user_id === userId
            );
            const rows = [...applicationOwners.entries()]
                .filter(([, studentId]) => studentId === user?.student_id)
                .map(([application_id]) => ({
                    application_id,
                    application_status: "draft",
                    program_name: "Fixture program"
                }));
            return { rowCount: rows.length, rows };
        }

        if (sql.startsWith('SELECT verification_type, status, activated_at, reviewed_at')) {
            return { rowCount: 0, rows: [] };
        }

        if (sql.includes('FROM "Grade_Reports" grade_report')) {
            return { rowCount: 0, rows: [] };
        }

        if (sql.includes('FROM "Eligibility_Checks" eligibility')) {
            return { rowCount: 0, rows: [] };
        }

        if (sql.includes('SELECT document.document_id')) {
            return { rowCount: 0, rows: [] };
        }

        if (
            sql.includes('FROM "Applications" application') &&
            sql.includes("application.application_id = $1") &&
            sql.includes("student.user_id = $2")
        ) {
            const applicationId = Number(values[0]);
            const userId = Number(values[1]);
            const expectedStudentId = applicationOwners.get(applicationId);
            const user = Object.values(fixtureUsers).find(
                (candidate) => candidate.user_id === userId
            );
            const authorized =
                expectedStudentId !== undefined &&
                user?.student_id === expectedStudentId;
            return {
                rowCount: authorized ? 1 : 0,
                rows: authorized
                    ? [{
                        application_id: applicationId,
                        application_status: "draft",
                        program_name: "Fixture program"
                    }]
                    : []
            };
        }

        if (
            sql.includes('FROM "Application_Verifications" verification') &&
            !sql.includes("verification.verification_id = $1")
        ) {
            const rows = verifications
                .filter(
                    (verification) =>
                        verification.type === values[0] &&
                        verification.scopeId === Number(values[1])
                )
                .map(({ verification_id }) => ({
                    verification_id,
                    status: "pending"
                }));
            return { rowCount: rows.length, rows };
        }

        if (sql.includes('FROM "Application_Verifications" verification')) {
            const verificationId = Number(values[0]);
            const requestedType = values[1];
            const requestedScope = Number(values[2]);
            const record = verificationScopes.get(verificationId);
            const authorized =
                record?.type === requestedType &&
                record.scopeId === requestedScope;
            return {
                rowCount: authorized ? 1 : 0,
                rows: authorized
                    ? [{
                        verification_id: verificationId,
                        verification_type: requestedType,
                        status: "pending"
                    }]
                    : []
            };
        }

        throw new Error(`Unexpected test query: ${sql}`);
    }
}

class StaffPortalPool extends FakePool {
    async query(query, values = []) {
        const sql = query.replace(/\s+/g, " ").trim();
        this.queries ||= [];
        this.queries.push(sql);

        if (sql.startsWith("SELECT preview.user_id")) {
            return {
                rowCount: 1,
                rows: [{
                    user_id: 33,
                    first_name: "Coordinator",
                    last_name: "One",
                    email: "coordinator@gmail.com",
                    role_name: "Barangay Coordinator",
                    scope_id: 7,
                    scope_name: "Taloto",
                    dashboard_path: "/portal/barangay-coordinator"
                }]
            };
        }
        if (sql.startsWith("SELECT COUNT(*)::INTEGER AS program_count")) {
            this.lastDashboardScope = values[0];
            return {
                rowCount: 1,
                rows: [{
                    program_count: 2,
                    application_count: 3,
                    in_review_count: 1,
                    total_budget: "5000.00",
                    remaining_budget: "3000.00",
                    reserved_budget: "1000.00",
                    released_budget: "1000.00"
                }]
            };
        }
        if (sql.includes("AS pending_count")) {
            this.lastQueueScope = values[1];
            return {
                rowCount: 1,
                rows: [{
                    pending_count: 2,
                    needs_information_count: 1
                }]
            };
        }
        if (
            sql.includes('FROM "Funding_Programs" program') &&
            sql.includes("program.program_id = $1") &&
            sql.includes("program.funding_unit_id = $2")
        ) {
            const authorized = Number(values[1]) === 41 && Number(values[0]) === 701;
            return {
                rowCount: authorized ? 1 : 0,
                rows: authorized ? [{ program_id: 701 }] : []
            };
        }
        if (
            sql.includes('FROM "Funding_Programs" program') &&
            sql.includes('JOIN "Funding_Cycles" cycle') &&
            sql.includes("WHERE program.funding_unit_id = $1")
        ) {
            this.lastProgramListScope = values[0];
            return {
                rowCount: 1,
                rows: Number(values[0]) === 41
                    ? [{ program_id: 701, program_name: "Unit A Grant" }]
                    : []
            };
        }
        if (sql.startsWith('SELECT funding_cycle_id FROM "Funding_Cycles"')) {
            return {
                    rowCount: Number(values[0]) === 901 ? 1 : 0,
                    rows: Number(values[0]) === 901 ? [{ funding_cycle_id: 901 }] : []
            };
        }
        if (sql.startsWith('SELECT program_id FROM "Funding_Programs"')) {
            const authorized = Number(values[0]) === 701 && Number(values[1]) === 41;
            return {
                rowCount: authorized ? 1 : 0,
                rows: authorized ? [{ program_id: 701 }] : []
            };
        }
        if (sql.startsWith('SELECT allocation_id FROM "Program_Barangay_Allocations"')) {
            return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT program_id, total_budget FROM "Funding_Programs"')) {
            return {
                rowCount: 1,
                rows: [{ program_id: 701, total_budget: "1000.00" }]
            };
        }
        if (sql.startsWith('SELECT barangay_id FROM "Barangays"')) {
            return {
                rowCount: values[0].length,
                rows: values[0].map((barangay_id) => ({ barangay_id }))
            };
        }
        if (sql.startsWith('DELETE FROM "Program_Barangay_Allocations"')) {
            return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO "Program_Barangay_Allocations"')) {
            (this.savedAllocationValues ||= []).push(values);
            return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('SELECT allocation.barangay_id, barangay.barangay_name')) {
            return {
                rowCount: this.savedAllocationValues?.length || 0,
                rows: (this.savedAllocationValues || []).map((allocation) => ({
                    barangay_id: allocation[1],
                    barangay_name: `Barangay ${allocation[1]}`,
                    allocated_amount: allocation[2]
                }))
            };
        }
        if (sql.startsWith('INSERT INTO "Funding_Programs"')) {
            this.createdProgramValues = values;
            return {
                    rowCount: 1,
                    rows: [{
                        program_id: 702,
                        program_name: values[0],
                        funding_cycle_id: values[2],
                        total_budget: values[3],
                        remaining_budget: values[3],
                        status: "active"
                    }]
            };
        }
        if (sql.startsWith("WITH updated_program AS ( UPDATE \"Funding_Programs\"")) {
            this.updatedProgramValues = values;
            const authorized =
                    Number(values[0]) === 701 && Number(values[1]) === 41;
            return {
                    rowCount: authorized ? 1 : 0,
                    rows: authorized ? [{ program_id: 701, status: values[3] }] : []
            };
        }
        if (sql.includes("FOR UPDATE OF verification, application")) {
            const verificationId = Number(values[0]);
            const type = values[1];
            const scopeId = Number(values[2]);
            const task = verificationScopes.get(verificationId);
            const authorized =
                task?.type === type &&
                task.scopeId === scopeId &&
                !this.missingWorkflowTask;
            return {
                rowCount: authorized ? 1 : 0,
                rows: authorized
                    ? [{
                        verification_id: verificationId,
                        application_id: 9001 + verificationId,
                        status: this.verificationStatus || "pending",
                        application_status: {
                            barangay: "barangay_verification",
                            registrar: "registrar_verification",
                            lgu: "lgu_review"
                        }[type],
                        program_id: 701
                    }]
                    : []
            };
        }
        if (sql.startsWith('UPDATE "Application_Verifications"')) {
            this.updatedVerification = {
                verification_id: values[3],
                status: values[0],
                reviewed_by: values[2]
            };
            return { rowCount: 1, rows: [this.updatedVerification] };
        }
        if (sql.startsWith('INSERT INTO "Scholarship_Awards"')) {
            this.insertedAward = {
                award_id: 8001,
                award_amount: values[2]
            };
            return { rowCount: 1, rows: [this.insertedAward] };
        }
        if (sql === "SELECT approve_award($1, $2)") {
            if (this.awardFailure) {
                throw Object.assign(new Error("private funding failure"), {
                    code: "P0001"
                });
            }
            this.approvedAwardValues = values;
            return { rowCount: 1, rows: [{}] };
        }
        if (sql.startsWith('INSERT INTO "Audit_Logs"')) {
            return { rowCount: 1, rows: [] };
        }
        if (sql.includes("FOR UPDATE OF application, student, registrar")) {
            const [applicationId, userId, schoolId] = values.map(Number);
            const registrarOwnsApplication =
                userId === fixtureUsers.registrarA.user_id &&
                schoolId === fixtureUsers.registrarA.registrar_school_id &&
                applicationId === 5001;
            return {
                rowCount: registrarOwnsApplication ? 1 : 0,
                rows: registrarOwnsApplication
                    ? [{ application_id: applicationId, student_id: 101, registrar_id: 401 }]
                    : []
            };
        }
        if (sql.startsWith('INSERT INTO "Grade_Reports"')) {
            this.gradeReportValues = values;
            return {
                rowCount: 1,
                rows: [{
                    grade_report_id: 31,
                    school_year: values[2],
                    semester: values[3],
                    gpa: values[4],
                    remarks: values[5]
                }]
            };
        }
        if (sql.startsWith('INSERT INTO "Eligibility_Checks"')) {
            this.eligibilityValues = values;
            return {
                rowCount: 1,
                rows: [{
                    eligibility_id: 32,
                    check_type: values[2],
                    result: values[3],
                    remarks: values[4]
                }]
            };
        }
        return super.query(query, values);
    }
}

const fakePool = new FakePool();
const app = createApp({
    pool: fakePool,
    initializeDatabase: async () => true,
    enableTestRegistration: true,
    env: {
        NODE_ENV: "test",
        FRONTEND_ORIGIN
    },
    logger: { error() {} }
});

before(async () => {
    loginPasswordHash = await argon2.hash("correct horse battery staple", {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1
    });
});

function authenticatedGet(path, token) {
    return request(app)
        .get(path)
        .set("Cookie", `${SESSION_COOKIE}=${token}`);
}

test("rejects unauthenticated access to a protected resource", async () => {
    const response = await request(app).get("/api/student/profile");
    assert.equal(response.status, 401);
});

test("rejects malformed session cookies before querying session records", async () => {
    const lookupsBefore = fakePool.sessionLookupCount || 0;
    const response = await authenticatedGet(
        "/api/student/profile",
        "not-a-valid-session-token"
    );
    assert.equal(response.status, 401);
    assert.equal(fakePool.sessionLookupCount || 0, lookupsBefore);
});

test("rejects expired sessions", async () => {
    const expiredToken = createToken("studentA");
    invalidSessionHashes.add(
        crypto.createHash("sha256").update(expiredToken).digest("hex")
    );

    const response = await authenticatedGet("/api/student/profile", expiredToken);
    assert.equal(response.status, 401);
});

test("rejects revoked sessions", async () => {
    const revokedToken = createToken("studentA");
    invalidSessionHashes.add(
        crypto.createHash("sha256").update(revokedToken).digest("hex")
    );

    const response = await authenticatedGet("/api/student/profile", revokedToken);
    assert.equal(response.status, 401);
});

test("rejects sessions for inactive users", async () => {
    const response = await authenticatedGet(
        "/api/student/profile",
        tokens.inactiveStudent
    );
    assert.equal(response.status, 401);
});

test("rejects accounts without a valid server-side role assignment", async () => {
    const missingAssignment = await authenticatedGet(
        "/api/student/profile",
        tokens.studentWithoutAssignment
    );
    assert.equal(missingAssignment.status, 403);

    const unsupportedRole = await authenticatedGet(
        "/api/student/profile",
        tokens.unsupportedRole
    );
    assert.equal(unsupportedRole.status, 403);
});

test("student cannot read another student's application", async () => {
    const response = await authenticatedGet(
        "/api/student/applications/5002?userId=11&studentId=101&role=Scholar&scopeId=101",
        tokens.studentA
    ).send({ userId: 11, studentId: 101, role: "Scholar", scopeId: 101 });
    assert.equal(response.status, 404);
});

test("coordinator cannot read a verification from another barangay", async () => {
    const response = await authenticatedGet(
        "/api/coordinator/verifications/602",
        tokens.coordinatorA
    );
    assert.equal(response.status, 404);
});

test("registrar cannot read a verification from another school", async () => {
    const response = await authenticatedGet(
        "/api/registrar/verifications/612",
        tokens.registrarA
    );
    assert.equal(response.status, 404);
});

test("LGU admin cannot read a verification from another funding unit", async () => {
    const response = await authenticatedGet(
        "/api/admin/verifications/622",
        tokens.adminA
    );
    assert.equal(response.status, 404);
});

test("authorized student can read their own application", async () => {
    const response = await authenticatedGet(
        "/api/student/applications/5001",
        tokens.studentA
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.application.application_id, 5001);
});

test("public program listings include public schedule and funding-unit fields only", async () => {
    const response = await request(app).get("/api/programs");

    assert.equal(response.status, 200);
    assert.equal(response.body.programs.length, 1);
    assert.equal(response.body.programs[0].program_id, 701);
    assert.equal(response.body.programs[0].availability, "open");
    assert.equal(response.body.applicationSubmissionEnabled, true);
    assert.equal("remaining_budget" in response.body.programs[0], false);
    assert.equal("total_budget" in response.body.programs[0], false);
});

test("legacy program schema lists real public columns and disables unsupported submission", async () => {
    const legacyPool = new FakePool();
    legacyPool.legacyProgramSchema = true;
    const legacyApp = createApp({
        pool: legacyPool,
        env: { NODE_ENV: "test", FRONTEND_ORIGIN },
        logger: { error() {} }
    });

    const response = await request(legacyApp).get("/api/programs");

    assert.equal(response.status, 200);
    assert.equal(response.body.programs[0].program_id, 702);
    assert.equal(response.body.programs[0].cycle_code, "2025-2026");
    assert.equal("funding_unit_name" in response.body.programs[0], false);
    assert.equal(response.body.applicationSubmissionEnabled, false);

    const unavailable = await request(legacyApp)
        .post("/api/student/applications")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.studentA}`)
        .send({ programId: 702 });
    assert.equal(unavailable.status, 503);
    assert.equal(legacyPool.connectCount || 0, 0);
});

test("legacy student application status reads do not require missing cycle or verification tables", async () => {
    const legacyApp = createApp({
        pool: Object.assign(new FakePool(), { legacyProgramSchema: true }),
        env: { NODE_ENV: "test", FRONTEND_ORIGIN },
        logger: { error() {} }
    });

    const list = await request(legacyApp)
        .get("/api/student/applications")
        .set("Cookie", `${SESSION_COOKIE}=${tokens.studentA}`);
    assert.equal(list.status, 200);
    assert.deepEqual(
        list.body.applications.map(({ application_id }) => application_id),
        [5001]
    );

    const detail = await request(legacyApp)
        .get("/api/student/applications/5001")
        .set("Cookie", `${SESSION_COOKIE}=${tokens.studentA}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.application.application_id, 5001);
    assert.deepEqual(detail.body.verifications, []);
});

test("program listing returns a generic error when the database query fails", async () => {
    const errors = [];
    const brokenPool = {
        async query() {
            throw Object.assign(new Error("private database detail"), {
                code: "ENOTFOUND"
            });
        }
    };
    const brokenApp = createApp({
        pool: brokenPool,
        env: { NODE_ENV: "test", FRONTEND_ORIGIN },
        logger: { error: (...args) => errors.push(args) }
    });

    const response = await request(brokenApp).get("/api/programs");

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { message: "An internal error occurred." });
    assert.equal(JSON.stringify(response.body).includes("private database detail"), false);
    assert.equal(errors.length, 1);
});

test("student can submit an open application through the database workflow", async () => {
    const applicationPool = new FakePool();
    const applicationApp = createApp({
        pool: applicationPool,
        env: { NODE_ENV: "test", FRONTEND_ORIGIN },
        logger: { error() {} }
    });

    const response = await request(applicationApp)
        .post("/api/student/applications")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.studentA}`)
        .send({ programId: 701 });

    assert.equal(response.status, 201);
    assert.deepEqual(response.body.application, {
        application_id: 7001,
        application_status: "barangay_verification",
        submitted_at: "2026-01-01T00:00:00.000Z"
    });
    assert.deepEqual(applicationPool.createdApplicationValues, [101, 701, 7]);
    assert.equal(applicationPool.applicationSubmitted, true);
});

test("application submission rejects unauthenticated, invalid, non-student, and duplicate requests", async () => {
    const applicationApp = createApp({
        pool: new FakePool(),
        env: { NODE_ENV: "test", FRONTEND_ORIGIN },
        logger: { error() {} }
    });
    const base = request(applicationApp).post("/api/student/applications")
        .set("Origin", FRONTEND_ORIGIN);

    assert.equal((await base.send({ programId: 701 })).status, 401);
    assert.equal((await request(applicationApp)
        .post("/api/student/applications")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.studentA}`)
        .send({ programId: "701", studentId: 202 })).status, 400);
    assert.equal((await request(applicationApp)
        .post("/api/student/applications")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`)
        .send({ programId: 701 })).status, 403);

    const duplicatePool = new FakePool();
    duplicatePool.existingApplication = true;
    const duplicateApp = createApp({
        pool: duplicatePool,
        env: { NODE_ENV: "test", FRONTEND_ORIGIN },
        logger: { error() {} }
    });
    const duplicateResponse = await request(duplicateApp)
        .post("/api/student/applications")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.studentA}`)
        .send({ programId: 701 });
    assert.equal(duplicateResponse.status, 409);

    const unavailablePool = new FakePool();
    unavailablePool.applicationProgramUnavailable = true;
    const unavailableApp = createApp({
        pool: unavailablePool,
        env: { NODE_ENV: "test", FRONTEND_ORIGIN },
        logger: { error() {} }
    });
    const unavailableResponse = await request(unavailableApp)
        .post("/api/student/applications")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.studentA}`)
        .send({ programId: 701 });
    assert.equal(unavailableResponse.status, 400);
});

test("student application list excludes other students despite caller-supplied scope", async () => {
    const response = await authenticatedGet(
        "/api/student/applications?userId=22&studentId=202&role=LGU%20Admin",
        tokens.studentA
    ).send({
        userId: 22,
        studentId: 202,
        role: "LGU Admin",
        scopeId: 42
    });

    assert.equal(response.status, 200);
    assert.deepEqual(
        response.body.applications.map(({ application_id }) => application_id),
        [5001]
    );
});

test("student cannot list documents for another student's application", async () => {
    const response = await authenticatedGet(
        "/api/student/applications/5002/documents",
        tokens.studentA
    );
    assert.equal(response.status, 404);
});

test("all staff roles can access only their assigned verification scope", async () => {
    const scopedStaff = [
        {
            role: "Barangay Coordinator",
            token: tokens.coordinatorA,
            path: "/api/coordinator/verifications",
            verificationId: 601,
            outOfScopeId: 602
        },
        {
            role: "Registrar",
            token: tokens.registrarA,
            path: "/api/registrar/verifications",
            verificationId: 611,
            outOfScopeId: 612
        },
        {
            role: "LGU Admin",
            token: tokens.adminA,
            path: "/api/admin/verifications",
            verificationId: 621,
            outOfScopeId: 622
        }
    ];

    for (const staff of scopedStaff) {
        const list = await authenticatedGet(
            `${staff.path}?scopeId=999&role=Scholar&userId=22`,
            staff.token
        ).send({ scopeId: 999, role: "Scholar", userId: 22 });
        assert.equal(list.status, 200, `${staff.role} list`);
        assert.deepEqual(
            list.body.verifications.map(({ verification_id }) => verification_id),
            [staff.verificationId],
            `${staff.role} list must contain only its assignment`
        );

        const ownDetail = await authenticatedGet(
            `${staff.path}/${staff.verificationId}?scopeId=999&role=Scholar`,
            staff.token
        ).send({ scopeId: 999, role: "Scholar" });
        assert.equal(ownDetail.status, 200, `${staff.role} own detail`);

        const otherDetail = await authenticatedGet(
            `${staff.path}/${staff.outOfScopeId}?scopeId=999&role=${encodeURIComponent(staff.role)}`,
            staff.token
        ).send({ scopeId: 999, role: staff.role });
        assert.equal(otherDetail.status, 404, `${staff.role} cross-scope detail`);
    }
});

function staffTestApp(pool) {
    return createApp({
        pool,
        env: { NODE_ENV: "test", FRONTEND_ORIGIN },
        logger: { error: (...args) => (pool.errors ||= []).push(args) }
    });
}

test("staff dashboards require a session and the matching server-side role", async () => {
    const dashboardApp = staffTestApp(new StaffPortalPool());

    assert.equal(
        (await request(dashboardApp).get("/api/admin/dashboard")).status,
        401
    );
    assert.equal(
        (await request(dashboardApp)
            .get("/api/admin/dashboard")
            .set("Cookie", `${SESSION_COOKIE}=${tokens.studentA}`)
            .send({ role: "LGU Admin", fundingUnitId: 41 })).status,
        403
    );

    const coordinator = await request(dashboardApp)
        .get("/api/coordinator/dashboard?barangayId=8")
        .set("Cookie", `${SESSION_COOKIE}=${tokens.coordinatorA}`)
        .send({ barangayId: 8 });
    assert.equal(coordinator.status, 200, JSON.stringify(dashboardApp.locals));
    assert.equal(coordinator.body.summary.pending_count, 2, JSON.stringify(coordinator.body));
});

test("developers can preview scoped staff dashboards read-only", async () => {
    const pool = new StaffPortalPool();
    const previewApp = staffTestApp(pool);

    const preview = await request(previewApp)
        .get("/api/coordinator/dashboard?previewRole=Barangay%20Coordinator&previewScopeId=8")
        .set("Cookie", `${SESSION_COOKIE}=${tokens.developerA}`);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(pool.lastQueueScope, 8);

    const mismatchedRole = await request(previewApp)
        .get("/api/coordinator/dashboard?previewRole=Registrar&previewScopeId=31")
        .set("Cookie", `${SESSION_COOKIE}=${tokens.developerA}`);
    assert.equal(mismatchedRole.status, 403);

    const mutation = await request(previewApp)
        .patch("/api/coordinator/verifications/601?previewRole=Barangay%20Coordinator&previewScopeId=8")
        .set("Cookie", `${SESSION_COOKIE}=${tokens.developerA}`)
        .send({ status: "approved" });
    assert.equal(mutation.status, 403);

    const previewOptions = await request(previewApp)
        .get("/api/system-admin/portal-previews")
        .set("Cookie", `${SESSION_COOKIE}=${tokens.developerA}`);
    assert.equal(previewOptions.status, 200);
    assert.equal(previewOptions.body.previews[0].scope_name, "Taloto");
});

test("LGU summaries and program details are restricted to the assigned funding unit", async () => {
    const pool = new StaffPortalPool();
    const adminApp = staffTestApp(pool);

    const dashboard = await request(adminApp)
        .get("/api/admin/dashboard?fundingUnitId=42")
        .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`);
    assert.equal(dashboard.status, 200, JSON.stringify({
        body: dashboard.body,
        errors: pool.errors || [],
        queries: pool.queries
    }));
    assert.equal(pool.lastDashboardScope, 41);
    assert.equal(dashboard.body.summary.total_budget, "5000.00");

    const programs = await request(adminApp)
        .get("/api/admin/programs?fundingUnitId=42&limit=200")
        .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`);
    assert.equal(programs.status, 400);

    const ownProgram = await request(adminApp)
        .get("/api/admin/programs/701")
        .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`);
    assert.equal(ownProgram.status, 200);
    const otherUnitProgram = await request(adminApp)
        .get("/api/admin/programs/999")
        .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`);
    assert.equal(otherUnitProgram.status, 404);
});

test("LGU administrators can create and update permitted program fields only in their unit", async () => {
    const pool = new StaffPortalPool();
    const adminApp = staffTestApp(pool);
    const programRequest = (method, path, body) =>
        request(adminApp)
            [method](path)
            .set("Origin", FRONTEND_ORIGIN)
            .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`)
            .send(body);

    const invalid = await programRequest("post", "/api/admin/programs", {
        programName: "Test Grant",
        fundingCycleId: 901,
        totalBudget: 100,
        fundingUnitId: 42
    });
    assert.equal(invalid.status, 400);

    const created = await programRequest("post", "/api/admin/programs", {
        programName: "Test Grant",
        fundingCycleId: 901,
        totalBudget: 100,
        startDate: "2026-01-01",
        endDate: "2026-12-31"
    });
    assert.equal(created.status, 201);
    assert.equal(pool.createdProgramValues[1], fixtureUsers.adminA.funding_unit_id);
    assert.equal(pool.createdProgramValues[2], 901);
    assert.equal(pool.createdProgramValues[3], 100);

    const updated = await programRequest(
        "patch",
        "/api/admin/programs/701",
        { status: "inactive" }
    );
    assert.equal(updated.status, 200);
    assert.equal(pool.updatedProgramValues[0], 701);
    assert.equal(pool.updatedProgramValues[1], fixtureUsers.adminA.funding_unit_id);

    const crossUnit = await programRequest(
        "patch",
        "/api/admin/programs/999",
        { status: "inactive" }
    );
    assert.equal(crossUnit.status, 404);
});

test("LGU administrators can replace barangay allocations within the program budget", async () => {
    const pool = new StaffPortalPool();
    const adminApp = staffTestApp(pool);
    const updateAllocations = (programId, allocations) =>
        request(adminApp)
            .put(`/api/admin/programs/${programId}/barangay-allocations`)
            .set("Origin", FRONTEND_ORIGIN)
            .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`)
            .send({ allocations });

    const duplicateBarangay = await updateAllocations(701, [
        { barangayId: 1, allocatedAmount: 100 },
        { barangayId: 1, allocatedAmount: 200 }
    ]);
    assert.equal(duplicateBarangay.status, 400);

    const overBudget = await updateAllocations(701, [
        { barangayId: 1, allocatedAmount: 600 },
        { barangayId: 2, allocatedAmount: 500 }
    ]);
    assert.equal(overBudget.status, 400);
    assert.equal(pool.savedAllocationValues, undefined);

    const saved = await updateAllocations(701, [
        { barangayId: 1, allocatedAmount: 600 },
        { barangayId: 2, allocatedAmount: 400 }
    ]);
    assert.equal(saved.status, 200);
    assert.equal(pool.savedAllocationValues.length, 2);
    assert.deepEqual(pool.savedAllocationValues.map((row) => row[0]), [701, 701]);

    const crossUnit = await updateAllocations(999, [
        { barangayId: 1, allocatedAmount: 10 }
    ]);
    assert.equal(crossUnit.status, 404);
});

test("staff verification actions reject invalid and cross-scope requests", async () => {
    const pool = new StaffPortalPool();
    const coordinatorApp = staffTestApp(pool);

    const invalid = await request(coordinatorApp)
        .patch("/api/coordinator/verifications/601")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.coordinatorA}`)
        .send({ status: "approved", reviewedBy: 999 });
    assert.equal(invalid.status, 400);

    const crossScope = await request(coordinatorApp)
        .patch("/api/coordinator/verifications/602")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.coordinatorA}`)
        .send({ status: "approved", remarks: "checked" });
    assert.equal(crossScope.status, 404);

    pool.verificationStatus = "approved";
    const invalidTransition = await request(coordinatorApp)
        .patch("/api/coordinator/verifications/601")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.coordinatorA}`)
        .send({ status: "rejected" });
    assert.equal(invalidTransition.status, 409);
});

test("coordinators can record a scoped verification decision", async () => {
    const pool = new StaffPortalPool();
    const coordinatorApp = staffTestApp(pool);
    const response = await request(coordinatorApp)
        .patch("/api/coordinator/verifications/601")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.coordinatorA}`)
        .send({ status: "approved", remarks: "Residency confirmed." });

    assert.equal(response.status, 200);
    assert.equal(response.body.verification.status, "approved");
    assert.equal(pool.updatedVerification.reviewed_by, fixtureUsers.coordinatorA.user_id);
});

test("registrars can add only schema-supported academic records for their school queue", async () => {
    const pool = new StaffPortalPool();
    const registrarApp = staffTestApp(pool);
    const ownSchool = await request(registrarApp)
        .post("/api/registrar/applications/5001/grade-reports")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.registrarA}`)
        .send({
            schoolYear: "2026-2027",
            semester: "First",
            gpa: 3.5,
            remarks: "Verified against school record."
        });
    assert.equal(ownSchool.status, 201);
    assert.equal(pool.gradeReportValues[0], 101);
    assert.equal(pool.gradeReportValues[1], 401);

    const otherSchool = await request(registrarApp)
        .post("/api/registrar/applications/5002/eligibility-checks")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.registrarA}`)
        .send({ checkType: "enrollment", result: "eligible" });
    assert.equal(otherSchool.status, 404);
    assert.equal(pool.eligibilityValues, undefined);

    const unsupportedField = await request(registrarApp)
        .post("/api/registrar/applications/5001/eligibility-checks")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.registrarA}`)
        .send({ checkType: "attendance", result: "eligible", attendance: 100 });
    assert.equal(unsupportedField.status, 400);
});

test("LGU award approval requires valid input and delegates funding checks to the transaction", async () => {
    const pool = new StaffPortalPool();
    const adminApp = staffTestApp(pool);
    const patchApproval = (body, verificationId = 621) =>
        request(adminApp)
            .patch(`/api/admin/verifications/${verificationId}`)
            .set("Origin", FRONTEND_ORIGIN)
            .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`)
            .send(body);

    assert.equal((await patchApproval({ status: "approved" })).status, 400);
    assert.equal((await patchApproval({
        status: "approved",
        awardAmount: 100
    }, 622)).status, 404);

    const approved = await patchApproval({
        status: "approved",
        awardAmount: 250.25,
        remarks: "Funding checks complete."
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.award.award_status, "approved");
    assert.deepEqual(pool.approvedAwardValues, [8001, fixtureUsers.adminA.user_id]);

    const insufficientFundingPool = new StaffPortalPool();
    insufficientFundingPool.awardFailure = true;
    const insufficientFundingApp = staffTestApp(insufficientFundingPool);
    const blocked = await request(insufficientFundingApp)
        .patch("/api/admin/verifications/621")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`)
        .send({ status: "approved", awardAmount: 250 });
    assert.equal(blocked.status, 409);
    assert.equal(
        blocked.body.message.includes("private funding failure"),
        false
    );
});

test("staff dashboards remain disabled when required workflow objects are absent", async () => {
    const legacyPool = new FakePool();
    legacyPool.legacyProgramSchema = true;
    const legacyApp = staffTestApp(legacyPool);
    const response = await request(legacyApp)
        .get("/api/coordinator/verifications")
        .set("Cookie", `${SESSION_COOKIE}=${tokens.coordinatorA}`);
    assert.equal(response.status, 503);
    assert.equal(legacyPool.connectCount || 0, 0);

    const admin = await request(legacyApp)
        .get("/api/admin/dashboard")
        .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`);
    assert.equal(admin.status, 503);
});

test("authenticated students cannot switch roles through request data", async () => {
    const response = await authenticatedGet(
        "/api/admin/verifications?role=LGU%20Admin&scopeId=41",
        tokens.studentA
    ).send({ role: "LGU Admin", scopeId: 41 });
    assert.equal(response.status, 403);
});

test("login issues an HttpOnly session cookie and logout revokes it", async () => {
    const login = await request(app)
        .post("/api/auth/login")
        .set("Origin", FRONTEND_ORIGIN)
        .send({ email: "one@gmail.com", password: "correct horse battery staple" });

    assert.equal(login.status, 200);
    assert.equal(login.body.user.email, "one@gmail.com");
    assert.equal(login.body.user.role, "Scholar");
    assert.equal(login.body.user.scopeId, 101);
    assert.equal(login.body.user.dashboardPath, "/portal/student");
    assert.equal(login.body.emailVerification.enabled, false);
    assert.equal(login.body.emailVerification.verified, false);
    assert.equal(JSON.stringify(login.body).includes("token"), false);
    const cookie = login.headers["set-cookie"].find((value) =>
        value.startsWith(`${SESSION_COOKIE}=`)
    );
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);

    const me = await request(app)
        .get("/api/auth/me")
        .set("Cookie", cookie.split(";")[0]);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.role, "Scholar");
    assert.equal(me.body.user.scopeId, 101);
    assert.equal(me.body.user.dashboardPath, "/portal/student");
    assert.equal(me.body.emailVerification.verified, false);

    const logout = await request(app)
        .post("/api/auth/logout")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", cookie.split(";")[0]);
    assert.equal(logout.status, 200);

    const afterLogout = await request(app)
        .get("/api/auth/me")
        .set("Cookie", cookie.split(";")[0]);
    assert.equal(afterLogout.status, 401);
});

test("login rejects invalid credentials with the same generic response", async () => {
    const responses = [];
    for (const credentials of [
        { email: "one@gmail.com", password: "wrong password" },
        { email: "missing@gmail.com", password: "wrong password" },
        { email: "inactive@gmail.com", password: "correct horse battery staple" }
    ]) {
        responses.push(
            await request(app)
                .post("/api/auth/login")
                .set("Origin", FRONTEND_ORIGIN)
                .send(credentials)
        );
    }

    for (const response of responses) {
        assert.equal(response.status, 401);
        assert.deepEqual(response.body, { message: "Email or password is invalid." });
        assert.equal(response.headers["set-cookie"], undefined);
    }
});

test("login and registration reject invalid input before database writes", async () => {
    const writesBefore = fakePool.registrationWriteCount || 0;
    const invalidLogin = await request(app)
        .post("/api/auth/login")
        .set("Origin", FRONTEND_ORIGIN)
        .send({ email: "not-an-email", password: "" });
    assert.equal(invalidLogin.status, 400);

    const invalidRegistration = await request(app)
        .post("/api/auth/register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            firstName: "",
            lastName: "Student",
            email: "not-an-email",
            password: "short",
            barangayId: -1,
            schoolId: 0,
            studentNumber: "",
            course: ""
        });
    assert.equal(invalidRegistration.status, 400);
    assert.equal(fakePool.registrationWriteCount || 0, writesBefore);
});

test("registration rejects client-selected roles and privilege escalation fields", async () => {
    for (const extraPayload of [
        { role: "LGU Admin" },
        { role: "Registrar" },
        { role: "Barangay Coordinator" },
        { roleId: 1 },
        { isAdmin: true },
        { fundingUnitId: 41 },
        { scopeId: 41 }
    ]) {
        const response = await request(app)
            .post("/api/auth/register")
            .set("Origin", FRONTEND_ORIGIN)
            .send({
                firstName: "New",
                lastName: "Student",
                email: "new.student@gmail.com",
                password: "a sufficiently long password",
                barangayId: 1,
                schoolId: 1,
                studentNumber: "NEW-1",
                course: "Education",
                ...extraPayload
            });

        assert.equal(response.status, 400);
    }
});

test("registration hashes the password, normalizes email, and assigns only the Scholar role", async () => {
    const password = "a sufficiently long password";
    const response = await request(app)
        .post("/api/auth/register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            firstName: "New",
            lastName: "Student",
            email: "  New.Student@Gmail.COM  ",
            password,
            barangayId: 1,
            schoolId: 1,
            studentNumber: "NEW-1",
            course: "Education"
        });

    assert.equal(response.status, 201);
    assert.equal(fakePool.insertedUserValues[0], 4);
    assert.equal(fakePool.insertedUserValues[4], "new.student@gmail.com");
    assert.notEqual(fakePool.insertedUserValues[5], password);
    assert.equal(
        await argon2.verify(fakePool.insertedUserValues[5], password),
        true
    );
    assert.equal(fakePool.insertedStudentValues[0], 88);
    assert.equal(response.body.emailVerification.enabled, false);
    assert.equal(response.body.emailVerification.verified, false);
    assert.equal(response.body.emailVerification.verificationEmailSent, false);
    assert.equal(JSON.stringify(response.body).includes(password), false);
});

test("student registration accepts school-issued email accounts and never grants staff roles from email suffix or prefix", async () => {
    const password = "a sufficiently long password";
    const response = await request(app)
        .post("/api/auth/register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            firstName: "Maria",
            lastName: "Santos",
            email: "registrar.admin@hnu.edu.ph",
            password,
            barangayId: 1,
            schoolId: 1,
            studentNumber: "HNU-2026-01",
            course: "BS Information Technology"
        });

    assert.equal(response.status, 201);
    // Role ID 4 is Scholar — never Registrar or LGU Admin despite email text/suffix
    assert.equal(fakePool.insertedUserValues[0], 4);
    assert.equal(fakePool.insertedUserValues[4], "registrar.admin@hnu.edu.ph");
});

test("student registration rejects non-Gmail consumer domains, arbitrary domains, and LGU government domains", async () => {
    const writesBefore = fakePool.registrationWriteCount || 0;
    const rejectedEmails = [
        "student@yahoo.com",
        "student@outlook.com",
        "student@hotmail.com",
        "student@icloud.com",
        "student@googlemail.com",
        "student@example.test",
        "admin@tagbilaran.gov.ph",
        "User <student@gmail.com>",
        "student..name@gmail.com"
    ];

    for (const invalidEmail of rejectedEmails) {
        const response = await request(app)
            .post("/api/auth/register")
            .set("Origin", FRONTEND_ORIGIN)
            .send({
                firstName: "Invalid",
                lastName: "Email",
                email: invalidEmail,
                password: "a sufficiently long password",
                barangayId: 1,
                schoolId: 1,
                studentNumber: "INV-1",
                course: "Education"
            });

        assert.equal(response.status, 400, `Expected 400 for ${invalidEmail}`);
        assert.equal(
            response.body.errors.some(({ field }) => field === "email"),
            true,
            `Expected email field error for ${invalidEmail}`
        );
    }

    assert.equal(fakePool.registrationWriteCount || 0, writesBefore);
});

test("registration reports duplicate account details case-insensitively without writing records", async () => {
    const duplicatePool = new FakePool();
    duplicatePool.duplicateEmail = true;
    const duplicateApp = createApp({
        pool: duplicatePool,
        enableTestRegistration: true,
        env: { NODE_ENV: "test", FRONTEND_ORIGIN },
        logger: { error() {} }
    });

    const response = await request(duplicateApp)
        .post("/api/auth/register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            firstName: "Existing",
            lastName: "Student",
            email: "  EXISTING.STUDENT@GMAIL.COM ",
            password: "a sufficiently long password",
            barangayId: 1,
            schoolId: 1,
            studentNumber: "EXISTING-1",
            course: "Education"
        });

    assert.equal(response.status, 409);
    assert.match(response.body.message, /email or student number already exists/);
    assert.equal(duplicatePool.registrationWriteCount || 0, 0);
});

test("shared login authenticates all four roles and returns backend-verified role, scopeId, and dashboard redirect path", async () => {
    const roleExpectations = [
        {
            email: "  ONE@GMAIL.COM ",
            expectedEmail: "one@gmail.com",
            expectedRole: "Scholar",
            expectedScopeId: 101,
            expectedScopeType: "student",
            expectedDashboardPath: "/portal/student"
        },
        {
            email: "coordinator@gmail.com",
            expectedEmail: "coordinator@gmail.com",
            expectedRole: "Barangay Coordinator",
            expectedScopeId: 7,
            expectedScopeType: "barangay",
            expectedDashboardPath: "/portal/barangay-coordinator"
        },
        {
            email: "registrar@hnu.edu.ph",
            expectedEmail: "registrar@hnu.edu.ph",
            expectedRole: "Registrar",
            expectedScopeId: 31,
            expectedScopeType: "school",
            expectedDashboardPath: "/portal/school-registrar"
        },
        {
            email: "admin@lgu-tagbilaran.example",
            expectedEmail: "admin@lgu-tagbilaran.example",
            expectedRole: "LGU Admin",
            expectedScopeId: 41,
            expectedScopeType: "funding_unit",
            expectedDashboardPath: "/portal/lgu-admin"
        }
    ];

    for (const item of roleExpectations) {
        const login = await request(app)
            .post("/api/auth/login")
            .set("Origin", FRONTEND_ORIGIN)
            .send({
                email: item.email,
                password: "correct horse battery staple"
            });

        assert.equal(login.status, 200, `login for ${item.expectedRole}`);
        assert.equal(login.body.user.email, item.expectedEmail);
        assert.equal(login.body.user.role, item.expectedRole);
        assert.equal(login.body.user.scopeId, item.expectedScopeId);
        assert.equal(login.body.user.scopeType, item.expectedScopeType);
        assert.equal(login.body.user.dashboardPath, item.expectedDashboardPath);

        const cookie = login.headers["set-cookie"]
            .find((value) => value.startsWith(`${SESSION_COOKIE}=`))
            .split(";")[0];

        const me = await request(app)
            .get("/api/auth/me")
            .set("Cookie", cookie);
        assert.equal(me.status, 200);
        assert.equal(me.body.user.role, item.expectedRole);
        assert.equal(me.body.user.scopeId, item.expectedScopeId);
        assert.equal(me.body.user.dashboardPath, item.expectedDashboardPath);
    }
});

test("LGU Admin email policy rejects personal Gmail and enforces configured ALLOWED_LGU_EMAIL_DOMAINS when set", async () => {
    const configuredPool = new StaffPortalPool();
    const configuredApp = createApp({
        pool: configuredPool,
        env: {
            NODE_ENV: "test",
            FRONTEND_ORIGIN,
            ALLOWED_LGU_EMAIL_DOMAINS: "tagbilaran-lgu.gov.ph",
            ALLOWED_SCHOOL_EMAIL_DOMAINS: "hnu.edu.ph,bisu.edu.ph"
        },
        logger: { error() {} }
    });

    // adminA has email admin@lgu-tagbilaran.example, which does not match ALLOWED_LGU_EMAIL_DOMAINS=tagbilaran-lgu.gov.ph
    const mismatchLogin = await request(configuredApp)
        .post("/api/auth/login")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            email: "admin@lgu-tagbilaran.example",
            password: "correct horse battery staple"
        });
    assert.equal(mismatchLogin.status, 403);
    assert.match(mismatchLogin.body.message, /official LGU/i);
});

test("privileged staff provisioning requires LGU Admin authentication and enforces role-specific email policies", async () => {
    const unconfiguredPool = new StaffPortalPool();
    const unconfiguredApp = createApp({
        pool: unconfiguredPool,
        env: {
            NODE_ENV: "test",
            FRONTEND_ORIGIN
        },
        logger: { error() {} }
    });

    // Unauthenticated caller cannot provision staff
    const unauth = await request(unconfiguredApp)
        .post("/api/admin/staff-accounts")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            role: "Registrar",
            firstName: "Reg",
            lastName: "One",
            email: "registrar2@hnu.edu.ph",
            password: "a sufficiently long password",
            schoolId: 1
        });
    assert.equal(unauth.status, 401);

    // Student, Coordinator, and Registrar cannot provision staff accounts
    for (const nonAdminToken of [tokens.studentA, tokens.coordinatorA, tokens.registrarA]) {
        const forbidden = await request(unconfiguredApp)
            .post("/api/admin/staff-accounts")
            .set("Origin", FRONTEND_ORIGIN)
            .set("Cookie", `${SESSION_COOKIE}=${nonAdminToken}`)
            .send({
                role: "Registrar",
                firstName: "Reg",
                lastName: "One",
                email: "registrar2@hnu.edu.ph",
                password: "a sufficiently long password",
                schoolId: 1
            });
        assert.equal(forbidden.status, 403);
    }

    // LGU Admin cannot use personal Gmail
    const gmailAdmin = await request(unconfiguredApp)
        .post("/api/admin/staff-accounts")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`)
        .send({
            role: "LGU Admin",
            firstName: "Admin",
            lastName: "Gmail",
            email: "lgu.admin@gmail.com",
            password: "a sufficiently long password",
            fundingUnitId: 41
        });
    assert.equal(gmailAdmin.status, 400);

    // Provisioning a new LGU Admin without confirmed ALLOWED_LGU_EMAIL_DOMAINS fails closed (503) rather than inventing a domain
    const unconfirmedLguDomain = await request(unconfiguredApp)
        .post("/api/admin/staff-accounts")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`)
        .send({
            role: "LGU Admin",
            firstName: "Admin",
            lastName: "Unconfirmed",
            email: "officer@unconfirmed-lgu.org",
            password: "a sufficiently long password",
            fundingUnitId: 41
        });
    assert.equal(unconfirmedLguDomain.status, 503);
    assert.match(unconfirmedLguDomain.body.message, /ALLOWED_LGU_EMAIL_DOMAINS/);

    // Barangay Coordinator accepts personal Gmail and rejects Yahoo or school .edu.ph
    const invalidCoordYahoo = await request(unconfiguredApp)
        .post("/api/admin/staff-accounts")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`)
        .send({
            role: "Barangay Coordinator",
            firstName: "Brgy",
            lastName: "Coord",
            email: "coord@yahoo.com",
            password: "a sufficiently long password",
            barangayId: 1
        });
    assert.equal(invalidCoordYahoo.status, 400);

    const validCoordGmail = await request(unconfiguredApp)
        .post("/api/admin/staff-accounts")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`)
        .send({
            role: "Barangay Coordinator",
            firstName: "Brgy",
            lastName: "Coord",
            email: "  Brgy.Coord@GMAIL.COM ",
            password: "a sufficiently long password",
            barangayId: 1
        });
    assert.equal(validCoordGmail.status, 201);
    assert.equal(validCoordGmail.body.staffAccount.email, "brgy.coord@gmail.com");
    assert.equal(validCoordGmail.body.staffAccount.role, "Barangay Coordinator");
    assert.equal(validCoordGmail.body.staffAccount.scopeId, 1);
    assert.equal(validCoordGmail.body.staffAccount.dashboardPath, "/portal/barangay-coordinator");

    // Registrar accepts personal Gmail or official school email, and rejects .gov.ph or Yahoo
    const invalidRegistrarGov = await request(unconfiguredApp)
        .post("/api/admin/staff-accounts")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`)
        .send({
            role: "Registrar",
            firstName: "School",
            lastName: "Reg",
            email: "registrar@tagbilaran.gov.ph",
            password: "a sufficiently long password",
            schoolId: 1
        });
    assert.equal(invalidRegistrarGov.status, 400);

    const validRegistrarSchool = await request(unconfiguredApp)
        .post("/api/admin/staff-accounts")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.adminA}`)
        .send({
            role: "Registrar",
            firstName: "School",
            lastName: "Reg",
            email: "Records.Office@HNU.EDU.PH",
            password: "a sufficiently long password",
            schoolId: 1
        });
    assert.equal(validRegistrarSchool.status, 201);
    assert.equal(validRegistrarSchool.body.staffAccount.email, "records.office@hnu.edu.ph");
    assert.equal(validRegistrarSchool.body.staffAccount.role, "Registrar");
    assert.equal(validRegistrarSchool.body.staffAccount.scopeId, 1);
    assert.equal(validRegistrarSchool.body.staffAccount.dashboardPath, "/portal/school-registrar");
});

test("lookups return only barangays and approved schools", async () => {
    const response = await request(app).get("/api/lookups");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
        barangays: [{ barangay_id: 1, barangay_name: "Fixture Barangay" }],
        schools: [{ school_id: 1, school_name: "Fixture School" }]
    });
});

test("state-changing authentication requests reject untrusted origins", async () => {
    const response = await request(app)
        .post("/api/auth/login")
        .set("Origin", "https://unexpected.example")
        .send({ email: "one@gmail.com", password: "wrong password" });

    assert.equal(response.status, 403);
});

test("state-changing authentication requests reject a missing Origin", async () => {
    const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "one@gmail.com", password: "wrong password" });
    assert.equal(response.status, 403);
});

test("authentication rate limiter rejects attempts after its configured threshold", async () => {
    const rateLimitedApp = createApp({
        pool: fakePool,
        env: {
            NODE_ENV: "development",
            FRONTEND_ORIGIN
        },
        logger: { error() {} }
    });
    const responses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
        responses.push(
            await request(rateLimitedApp)
                .post("/api/auth/login")
                .set("Origin", FRONTEND_ORIGIN)
                .send({})
        );
    }

    assert.equal(responses.slice(0, 10).every(({ status }) => status === 400), true);
    assert.equal(responses[10].status, 429);
    assert.match(responses[10].body.message, /Too many authentication attempts/);
});

test("database initialization route is not registered in production", async () => {
    const productionApp = createApp({
        pool: fakePool,
        initializeDatabase: async () => {
            throw new Error("Must not run in production.");
        },
        env: {
            NODE_ENV: "production",
            FRONTEND_ORIGIN
        },
        logger: { error() {} }
    });

    for (const nodeEnv of ["production", undefined, "prodution", "staging", "test"]) {
        const appForEnvironment = nodeEnv === "production"
            ? productionApp
            : createApp({
                pool: fakePool,
                initializeDatabase: async () => {
                    throw new Error("Must not run outside explicit development.");
                },
                env: {
                    ...(nodeEnv ? { NODE_ENV: nodeEnv } : {}),
                    FRONTEND_ORIGIN
                },
                logger: { error() {} }
            });
        const response = await request(appForEnvironment)
            .post("/api/init-db")
            .set("Origin", FRONTEND_ORIGIN);
        assert.equal(response.status, 404, `NODE_ENV=${nodeEnv}`);

        const registration = await request(appForEnvironment)
            .post("/api/auth/register")
            .set("Origin", FRONTEND_ORIGIN)
            .send({});
        assert.equal(registration.status, 404, `registration NODE_ENV=${nodeEnv}`);
    }

    const developmentApp = createApp({
        pool: fakePool,
        initializeDatabase: async () => true,
        env: { NODE_ENV: "development", FRONTEND_ORIGIN },
        logger: { error() {} }
    });
    const developmentInit = await request(developmentApp)
        .post("/api/init-db")
        .set("Origin", FRONTEND_ORIGIN);
    assert.equal(developmentInit.status, 200);
});


// ============================================================================
// PART 11.2 — 30 COMPREHENSIVE STAFF AUTHORIZATION, INVITATION, SCHOOL SCOPE,
// BARANGAY SCOPE, STUDENT EMAIL VERIFICATION & SECURITY TESTS
// ============================================================================

class StaffAuthStatefulPool {
    constructor() {
        this.nextUserId = 1000;
        this.nextStudentId = 2000;
        this.nextAuthId = 3000;
        this.nextDomainId = 4000;
        this.nextTokenId = 5000;
        this.nextAuditId = 6000;

        this.roles = new Map([
            ["LGU Admin", 1],
            ["Barangay Coordinator", 2],
            ["Registrar", 3],
            ["Scholar", 4],
            ["System Admin", 5]
        ]);

        this.fundingUnits = new Map([
            [41, { funding_unit_id: 41, funding_unit_code: "CITY-MAYOR", funding_unit_name: "Office of the City Mayor", status: "active" }],
            [42, { funding_unit_id: 42, funding_unit_code: "SP-SCHOLAR", funding_unit_name: "Sangguniang Panlungsod Scholarship Office", status: "active" }]
        ]);

        this.barangays = new Map([
            [1, { barangay_id: 1, barangay_name: "Bool" }],
            [2, { barangay_id: 2, barangay_name: "Booy" }],
            [3, { barangay_id: 3, barangay_name: "Cabawan" }],
            [4, { barangay_id: 4, barangay_name: "Cogon" }],
            [5, { barangay_id: 5, barangay_name: "Dao" }],
            [6, { barangay_id: 6, barangay_name: "Dampas" }],
            [7, { barangay_id: 7, barangay_name: "Manga" }],
            [8, { barangay_id: 8, barangay_name: "Mansasa" }],
            [9, { barangay_id: 9, barangay_name: "Poblacion I" }],
            [10, { barangay_id: 10, barangay_name: "Poblacion II" }],
            [11, { barangay_id: 11, barangay_name: "Poblacion III" }],
            [12, { barangay_id: 12, barangay_name: "San Isidro" }],
            [13, { barangay_id: 13, barangay_name: "Taloto" }],
            [14, { barangay_id: 14, barangay_name: "Tiptip" }],
            [15, { barangay_id: 15, barangay_name: "Ubujan" }]
        ]);

        this.schools = new Map([
            [1, { school_id: 1, school_name: "Holy Name University", is_approved: true }],
            [2, { school_id: 2, school_name: "Bohol Island State University", is_approved: true }],
            [3, { school_id: 3, school_name: "University of Bohol", is_approved: true }],
            [4, { school_id: 4, school_name: "Tagbilaran City College", is_approved: true }],
            [5, { school_id: 5, school_name: "PMI Colleges Bohol", is_approved: true }]
        ]);

        this.schoolDomains = [
            { domain_id: 1, school_id: 1, domain: "hnu.edu.ph", domain_status: "verified", is_primary: true, notes: "HNU" },
            { domain_id: 2, school_id: 2, domain: "bisu.edu.ph", domain_status: "verified", is_primary: true, notes: "BISU" },
            { domain_id: 3, school_id: 3, domain: "universityofbohol.edu.ph", domain_status: "verified", is_primary: true, notes: "UB" },
            { domain_id: 4, school_id: 3, domain: "ub.edu.ph", domain_status: "verified", is_primary: false, notes: "UB short" },
            { domain_id: 5, school_id: 4, domain: "tagbilarancitycollege.edu.ph", domain_status: "verified", is_primary: true, notes: "TCC" },
            { domain_id: 6, school_id: 4, domain: "tcc.edu.ph", domain_status: "verified", is_primary: false, notes: "TCC short" },
            { domain_id: 7, school_id: 5, domain: "pmicollegesbohol.edu.ph", domain_status: "verified", is_primary: true, notes: "PMI" },
            { domain_id: 8, school_id: 5, domain: "pmi-bohol.edu.ph", domain_status: "verified", is_primary: false, notes: "PMI alias" }
        ];

        this.users = new Map();
        this.students = new Map();
        this.lguAdmins = new Map();
        this.coordinators = new Map();
        this.registrars = new Map();
        this.sessions = new Map();
        this.staffAuthorizations = new Map();
        this.emailVerificationTokens = [];
        this.auditLogs = [];

        this.verifications = new Map([
            // Barangay verifications: 801 = Taloto (13), 802 = Bool (1)
            [801, { verification_id: 801, application_id: 9001, verification_type: "barangay", barangay_id: 13, status: "pending", application_status: "barangay_verification", first_name: "Ana", last_name: "Taloto", student_number: "2026-TAL", school_name: "Holy Name University", barangay_name: "Taloto", program_name: "City Grant" }],
            [802, { verification_id: 802, application_id: 9002, verification_type: "barangay", barangay_id: 1, status: "pending", application_status: "barangay_verification", first_name: "Ben", last_name: "Bool", student_number: "2026-BOOL", school_name: "Holy Name University", barangay_name: "Bool", program_name: "City Grant" }],
            // School Registrar verifications for schools 1..6
            [811, { verification_id: 811, application_id: 9011, verification_type: "registrar", school_id: 1, status: "pending", application_status: "registrar_verification", first_name: "HNU", last_name: "Scholar", student_number: "HNU-01", school_name: "Holy Name University", course: "BSIT", year_level: "4th Year", program_name: "City Grant" }],
            [812, { verification_id: 812, application_id: 9012, verification_type: "registrar", school_id: 2, status: "pending", application_status: "registrar_verification", first_name: "BISU", last_name: "Scholar", student_number: "BISU-01", school_name: "Bohol Island State University", course: "BSCS", year_level: "3rd Year", program_name: "City Grant" }],
            [813, { verification_id: 813, application_id: 9013, verification_type: "registrar", school_id: 3, status: "pending", application_status: "registrar_verification", first_name: "UB", last_name: "Scholar", student_number: "UB-01", school_name: "University of Bohol", course: "BSED", year_level: "2nd Year", program_name: "City Grant" }],
            [814, { verification_id: 814, application_id: 9014, verification_type: "registrar", school_id: 4, status: "pending", application_status: "registrar_verification", first_name: "TCC", last_name: "Scholar", student_number: "TCC-01", school_name: "Tagbilaran City College", course: "BSBA", year_level: "1st Year", program_name: "City Grant" }],
            [815, { verification_id: 815, application_id: 9015, verification_type: "registrar", school_id: 5, status: "pending", application_status: "registrar_verification", first_name: "PMI", last_name: "Scholar", student_number: "PMI-01", school_name: "PMI Colleges Bohol", course: "BSMT", year_level: "3rd Year", program_name: "City Grant" }],
            [816, { verification_id: 816, application_id: 9016, verification_type: "registrar", school_id: 6, status: "pending", application_status: "registrar_verification", first_name: "DCPNHS", last_name: "Scholar", student_number: "HS-01", school_name: "Dr. Cecilio Putong National High School", course: "STEM", year_level: "Grade 12", program_name: "High School Grant" }],
            // LGU verification for funding unit 41
            [821, { verification_id: 821, application_id: 9021, verification_type: "lgu", funding_unit_id: 41, status: "pending", application_status: "for_final_approval", first_name: "LGU", last_name: "Applicant", student_number: "LGU-01", school_name: "Holy Name University", barangay_name: "Taloto", program_name: "City Grant", remaining_budget: "500000.00" }]
        ]);
    }

    seedUser({
        email,
        roleName,
        firstName = "Seed",
        lastName = "User",
        passwordHash = loginPasswordHash,
        isActive = true,
        emailVerifiedAt = "2026-10-20T00:00:00.000Z",
        studentId = null,
        schoolId = null,
        barangayId = null,
        fundingUnitId = null,
        lguPermissions = null,
        staffAuthStatus = null
    }) {
        const userId = this.nextUserId++;
        const normalized = email.trim().toLowerCase();
        const roleId = this.roles.get(roleName) || 4;
        this.users.set(userId, {
            user_id: userId,
            role_id: roleId,
            role_name: roleName,
            barangay_id: barangayId,
            first_name: firstName,
            last_name: lastName,
            email: normalized,
            password_hash: passwordHash,
            is_active: isActive,
            email_verified_at: emailVerifiedAt
        });
        if (roleName === "Scholar") {
            const sid = studentId || this.nextStudentId++;
            this.students.set(userId, {
                student_id: sid,
                user_id: userId,
                school_id: schoolId || 1,
                student_number: `STU-${sid}`,
                course: "BSIT",
                year_level: "4th Year",
                is_active: true
            });
        } else if (roleName === "LGU Admin" && fundingUnitId) {
            this.lguAdmins.set(userId, {
                user_id: userId,
                funding_unit_id: fundingUnitId,
                position_title: "Program Admin",
                permissions: lguPermissions || {
                    read_only_reports: true,
                    program_management: true,
                    application_review: true,
                    award_approval: true,
                    disbursement_release: false
                },
                is_active: true
            });
        } else if (roleName === "Barangay Coordinator" && barangayId) {
            this.coordinators.set(userId, {
                user_id: userId,
                barangay_id: barangayId,
                position_title: "Barangay Coordinator",
                is_current: true
            });
        } else if (roleName === "Registrar" && schoolId) {
            this.registrars.set(userId, {
                user_id: userId,
                school_id: schoolId,
                position_title: "School Registrar",
                is_active: true
            });
        }
        if (staffAuthStatus) {
            const authId = this.nextAuthId++;
            this.staffAuthorizations.set(authId, {
                authorization_id: authId,
                email: normalized,
                role_name: roleName,
                funding_unit_id: fundingUnitId,
                barangay_id: barangayId,
                school_id: schoolId,
                status: staffAuthStatus,
                activated_user_id: userId,
                updated_at: new Date().toISOString()
            });
        }
        return userId;
    }

    issueSessionToken(userId) {
        const raw = crypto.randomBytes(32).toString("base64url");
        const hash = crypto.createHash("sha256").update(raw).digest("hex");
        this.sessions.set(hash, {
            user_id: userId,
            token_hash: hash,
            revoked_at: null,
            expires_at: new Date(Date.now() + 86400 * 1000).toISOString()
        });
        return raw;
    }

    buildUserSessionRow(user) {
        const student = this.students.get(user.user_id);
        const admin = this.lguAdmins.get(user.user_id);
        const coordinator = this.coordinators.get(user.user_id);
        const registrar = this.registrars.get(user.user_id);
        const staffAuth = [...this.staffAuthorizations.values()]
            .filter((sa) => sa.email.toLowerCase() === user.email.toLowerCase())
            .sort((a, b) => b.authorization_id - a.authorization_id)[0];

        const verifiedSchoolDomains =
            user.role_name === "Registrar" && registrar?.is_active
                ? this.schoolDomains
                    .filter((sd) => sd.school_id === registrar.school_id && sd.domain_status === "verified")
                    .map((sd) => sd.domain)
                : null;

        return {
            user_id: user.user_id,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            password_hash: user.password_hash,
            is_active: user.is_active,
            role_name: user.role_name,
            email_verified_at: user.email_verified_at,
            student_id: student?.is_active ? student.student_id : undefined,
            funding_unit_id: admin?.is_active ? admin.funding_unit_id : undefined,
            lgu_permissions: admin?.is_active ? admin.permissions : undefined,
            coordinator_barangay_id: coordinator?.is_current ? coordinator.barangay_id : undefined,
            registrar_school_id: registrar?.is_active ? registrar.school_id : undefined,
            staff_auth_status: staffAuth ? staffAuth.status : null,
            verified_school_domains: verifiedSchoolDomains && verifiedSchoolDomains.length > 0 ? verifiedSchoolDomains : null
        };
    }

    async connect() {
        return this;
    }

    release() {}

    async query(query, values = []) {
        const sql = query.replace(/\s+/g, " ").trim();

        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.startsWith("SELECT pg_advisory_xact_lock")) {
            return { rowCount: 0, rows: [] };
        }

        if (sql.startsWith("SELECT ( to_regclass(")) {
            return {
                rowCount: 1,
                rows: [{
                    relational_program_schema: true,
                    application_workflow_schema: true,
                    has_verification_table: true,
                    has_admin_funding_unit_assignment: true,
                    has_program_budget_balances: true,
                    has_award_approval_function: true,
                    has_staff_admin_workflow: true,
                    has_staff_authorizations: true,
                    has_school_email_domains: true,
                    has_email_verification_tokens: true,
                    has_user_email_verified_at: true,
                    has_lgu_admin_permissions: true
                }]
            };
        }

        // Lookups
        if (sql.startsWith('SELECT funding_unit_id, funding_unit_code, funding_unit_name, status FROM "Funding_Units"')) {
            const rows = [...this.fundingUnits.values()];
            return { rowCount: rows.length, rows };
        }
        if (sql.startsWith('SELECT funding_unit_id, funding_unit_name FROM "Funding_Units"')) {
            const unit = this.fundingUnits.get(Number(values[0]));
            return unit && unit.status === "active"
                ? { rowCount: 1, rows: [unit] }
                : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT barangay_id, barangay_name FROM "Barangays"')) {
            const rows = [...this.barangays.values()];
            return { rowCount: rows.length, rows };
        }
        if (sql.startsWith('SELECT 1 FROM "Barangays" WHERE barangay_id = $1')) {
            return this.barangays.has(Number(values[0]))
                ? { rowCount: 1, rows: [{}] }
                : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT school_id, school_name, is_approved FROM "Schools" WHERE school_id = $1')) {
            const s = this.schools.get(Number(values[0]));
            return s ? { rowCount: 1, rows: [s] } : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT school_id, school_name, is_approved FROM "Schools"')) {
            const rows = [...this.schools.values()];
            return { rowCount: rows.length, rows };
        }
        if (sql.startsWith('SELECT school_id, school_name FROM "Schools"')) {
            const rows = [...this.schools.values()].filter((s) => s.is_approved);
            return { rowCount: rows.length, rows };
        }
        if (sql.startsWith('SELECT 1 FROM "Schools" WHERE school_id = $1 AND is_approved = TRUE')) {
            const s = this.schools.get(Number(values[0]));
            if (!s || !s.is_approved) return { rowCount: 0, rows: [] };
            const verifiedDomains = this.schoolDomains
                .filter((d) => d.school_id === s.school_id && d.domain_status === "verified")
                .map((d) => d.domain);
            return {
                rowCount: 1,
                rows: [{
                    verified_domains: verifiedDomains.length > 0 ? verifiedDomains : null
                }]
            };
        }
        if (sql.startsWith('INSERT INTO "Schools" (school_name, is_approved)')) {
            const schoolName = values[0];
            let existing = [...this.schools.values()].find(
                (s) => s.school_name.toLowerCase() === schoolName.toLowerCase()
            );
            if (!existing) {
                const newId = this.schools.size + 1;
                existing = { school_id: newId, school_name: schoolName, is_approved: true };
                this.schools.set(newId, existing);
            }
            return { rowCount: 1, rows: [existing] };
        }

        // School_Email_Domains
        if (sql.startsWith('SELECT domain FROM "School_Email_Domains" WHERE school_id = $1')) {
            const rows = this.schoolDomains
                .filter((d) => d.school_id === Number(values[0]) && d.domain_status === "verified")
                .map((d) => ({ domain: d.domain }));
            return { rowCount: rows.length, rows };
        }
        if (sql.includes('FROM "School_Email_Domains" sd JOIN "Schools" s')) {
            const rows = this.schoolDomains.map((sd) => ({
                ...sd,
                school_name: this.schools.get(sd.school_id)?.school_name || "School",
                is_approved: true
            }));
            return { rowCount: rows.length, rows };
        }
        if (sql.startsWith('INSERT INTO "School_Email_Domains"')) {
            const [schoolId, domain, domainStatus, isPrimary, configuredBy, notes] = values;
            const record = {
                domain_id: this.nextDomainId++,
                school_id: Number(schoolId),
                domain,
                domain_status: domainStatus,
                is_primary: isPrimary,
                configured_by: configuredBy,
                notes
            };
            this.schoolDomains.push(record);
            return { rowCount: 1, rows: [record] };
        }
        if (sql.startsWith('UPDATE "School_Email_Domains"')) {
            const domainId = Number(values[0]);
            const record = this.schoolDomains.find((d) => d.domain_id === domainId);
            if (!record) return { rowCount: 0, rows: [] };
            if (sql.includes("domain_status =")) {
                record.domain_status = values[1];
            }
            return { rowCount: 1, rows: [record] };
        }

        // Roles & Users
        if (sql.startsWith('SELECT role_id FROM "Roles" WHERE role_name = $1')) {
            const id = this.roles.get(values[0]);
            return id ? { rowCount: 1, rows: [{ role_id: id }] } : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT 1 FROM "Users" WHERE lower(email) = $1')) {
            const found = [...this.users.values()].some(
                (u) => u.email.toLowerCase() === String(values[0]).toLowerCase()
            );
            return found ? { rowCount: 1, rows: [{}] } : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT 1 FROM "Students" WHERE student_number = $1')) {
            const found = [...this.students.values()].some(
                (s) => s.student_number === values[0]
            );
            return found ? { rowCount: 1, rows: [{}] } : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO "Users"')) {
            const [roleId, barangayId, firstName, lastName, email, passwordHash, phoneNumber] = values;
            const roleName = [...this.roles.entries()].find(([, id]) => id === Number(roleId))?.[0] || "Scholar";
            const userId = this.nextUserId++;
            const emailVerifiedAt = sql.includes("email_verified_at") ? new Date().toISOString() : null;
            this.users.set(userId, {
                user_id: userId,
                role_id: Number(roleId),
                role_name: roleName,
                barangay_id: barangayId ? Number(barangayId) : null,
                first_name: firstName,
                last_name: lastName,
                email: email.toLowerCase(),
                password_hash: passwordHash,
                phone_number: phoneNumber,
                is_active: true,
                email_verified_at: emailVerifiedAt
            });
            return { rowCount: 1, rows: [{ user_id: userId }] };
        }
        if (sql.startsWith('INSERT INTO "Students"')) {
            const [userId, schoolId, studentNumber, course, yearLevel] = values;
            const studentId = this.nextStudentId++;
            this.students.set(Number(userId), {
                student_id: studentId,
                user_id: Number(userId),
                school_id: Number(schoolId),
                student_number: studentNumber,
                course,
                year_level: yearLevel,
                is_active: true
            });
            return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('INSERT INTO "LGU_Admins"')) {
            const [userId, fundingUnitId, positionTitle, permissionsJson] = values;
            this.lguAdmins.set(Number(userId), {
                user_id: Number(userId),
                funding_unit_id: Number(fundingUnitId),
                position_title: positionTitle,
                permissions: typeof permissionsJson === "string" ? JSON.parse(permissionsJson) : permissionsJson,
                is_active: true
            });
            return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('INSERT INTO "Barangay_Coordinators"')) {
            const [userId, barangayId, positionTitle] = values;
            this.coordinators.set(Number(userId), {
                user_id: Number(userId),
                barangay_id: Number(barangayId),
                position_title: positionTitle,
                is_current: true
            });
            return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('INSERT INTO "Registrars"')) {
            const [userId, schoolId, positionTitle] = values;
            this.registrars.set(Number(userId), {
                user_id: Number(userId),
                school_id: Number(schoolId),
                position_title: positionTitle,
                is_active: true
            });
            return { rowCount: 1, rows: [] };
        }

        // Email verification tokens
        if (sql.startsWith('SELECT user_id, email, email_verified_at FROM "Users" WHERE lower(email) = $1')) {
            const user = [...this.users.values()].find(
                (u) => u.email.toLowerCase() === String(values[0]).toLowerCase() && u.is_active
            );
            return user ? { rowCount: 1, rows: [user] } : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO "Email_Verification_Tokens"')) {
            const [userId, email, hash] = values;
            const record = {
                verification_token_id: this.nextTokenId++,
                user_id: Number(userId),
                email: email.toLowerCase(),
                token_hash: hash,
                purpose: "account_verification",
                expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
                consumed_at: null,
                created_at: new Date().toISOString()
            };
            this.emailVerificationTokens.push(record);
            return { rowCount: 1, rows: [record] };
        }
        if (sql.includes('FROM "Email_Verification_Tokens" WHERE lower(email) = $1')) {
            const matching = this.emailVerificationTokens
                .filter((t) => t.email.toLowerCase() === String(values[0]).toLowerCase() && t.purpose === "account_verification")
                .sort((a, b) => b.verification_token_id - a.verification_token_id);
            return matching.length > 0 ? { rowCount: 1, rows: [matching[0]] } : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE "Email_Verification_Tokens" SET consumed_at = NOW()')) {
            const tokenRecord = this.emailVerificationTokens.find(
                (t) => t.verification_token_id === Number(values[0])
            );
            if (tokenRecord) tokenRecord.consumed_at = new Date().toISOString();
            return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE "Users" SET email_verified_at = NOW() WHERE user_id = $1')) {
            const user = this.users.get(Number(values[0]));
            if (user) user.email_verified_at = new Date().toISOString();
            return { rowCount: 1, rows: [] };
        }

        // Staff_Email_Authorizations
        if (sql.includes('FROM "Staff_Email_Authorizations" WHERE lower(email) = $1 AND status IN (\'pending\', \'active\')')) {
            const found = [...this.staffAuthorizations.values()].find(
                (sa) => sa.email.toLowerCase() === String(values[0]).toLowerCase() && ["pending", "active"].includes(sa.status)
            );
            return found ? { rowCount: 1, rows: [found] } : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO "Staff_Email_Authorizations"')) {
            const [
                email, roleName, fundingUnitId, barangayId, schoolId,
                positionTitle, lguPermissionsJson, invitationTokenHash,
                expiresInHours, authorizedBy, notes
            ] = values;
            const authId = this.nextAuthId++;
            const expiresAt = new Date(Date.now() + Number(expiresInHours) * 3600 * 1000).toISOString();
            const row = {
                authorization_id: authId,
                email: email.toLowerCase(),
                role_name: roleName,
                funding_unit_id: fundingUnitId ? Number(fundingUnitId) : null,
                barangay_id: barangayId ? Number(barangayId) : null,
                school_id: schoolId ? Number(schoolId) : null,
                position_title: positionTitle,
                lgu_permissions: lguPermissionsJson ? JSON.parse(lguPermissionsJson) : null,
                invitation_token_hash: invitationTokenHash,
                status: "pending",
                expires_at: expiresAt,
                authorized_by: Number(authorizedBy),
                authorized_at: new Date().toISOString(),
                activated_user_id: null,
                activated_at: null,
                revoked_by: null,
                revoked_at: null,
                revocation_reason: null,
                notes,
                updated_at: new Date().toISOString()
            };
            this.staffAuthorizations.set(authId, row);
            return { rowCount: 1, rows: [row] };
        }
        if (sql.includes('FROM "Staff_Email_Authorizations" sa') && sql.includes("WHERE lower(sa.email) = $1")) {
            const matches = [...this.staffAuthorizations.values()]
                .filter((sa) => sa.email.toLowerCase() === String(values[0]).toLowerCase())
                .sort((a, b) => b.authorization_id - a.authorization_id);
            if (matches.length === 0) return { rowCount: 0, rows: [] };
            const sa = matches[0];
            return {
                rowCount: 1,
                rows: [{
                    ...sa,
                    funding_unit_name: sa.funding_unit_id ? this.fundingUnits.get(sa.funding_unit_id)?.funding_unit_name : null,
                    barangay_name: sa.barangay_id ? this.barangays.get(sa.barangay_id)?.barangay_name : null,
                    school_name: sa.school_id ? this.schools.get(sa.school_id)?.school_name : null
                }]
            };
        }
        if (sql.includes('FROM "Staff_Email_Authorizations" sa') && sql.includes("ORDER BY sa.authorized_at DESC")) {
            const rows = [...this.staffAuthorizations.values()].map((sa) => ({
                ...sa,
                funding_unit_name: sa.funding_unit_id ? this.fundingUnits.get(sa.funding_unit_id)?.funding_unit_name : null,
                barangay_name: sa.barangay_id ? this.barangays.get(sa.barangay_id)?.barangay_name : null,
                school_name: sa.school_id ? this.schools.get(sa.school_id)?.school_name : null
            }));
            return { rowCount: rows.length, rows };
        }
        if (sql.startsWith('UPDATE "Staff_Email_Authorizations" SET status = \'active\'')) {
            const [activatedUserId, authorizationId] = values;
            const sa = this.staffAuthorizations.get(Number(authorizationId));
            if (sa) {
                sa.status = "active";
                sa.activated_user_id = Number(activatedUserId);
                sa.activated_at = new Date().toISOString();
                sa.invitation_token_hash = null;
                sa.updated_at = new Date().toISOString();
            }
            return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE "Staff_Email_Authorizations" SET status = \'expired\'')) {
            const sa = this.staffAuthorizations.get(Number(values[0]));
            if (sa) sa.status = "expired";
            return { rowCount: 1, rows: [] };
        }
        if (sql.includes('FROM "Staff_Email_Authorizations" WHERE authorization_id = $1 FOR UPDATE')) {
            const sa = this.staffAuthorizations.get(Number(values[0]));
            return sa ? { rowCount: 1, rows: [sa] } : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE "Staff_Email_Authorizations" SET status = \'revoked\'')) {
            const [revokedBy, reason, authorizationId] = values;
            const sa = this.staffAuthorizations.get(Number(authorizationId));
            if (!sa) return { rowCount: 0, rows: [] };
            sa.status = "revoked";
            sa.revoked_by = Number(revokedBy);
            sa.revoked_at = new Date().toISOString();
            sa.revocation_reason = reason;
            sa.invitation_token_hash = null;
            return { rowCount: 1, rows: [sa] };
        }
        if (sql.startsWith('SELECT user_id FROM "Users" WHERE user_id = $1 OR lower(email) = lower($2)')) {
            const user =
                this.users.get(Number(values[0])) ||
                [...this.users.values()].find((u) => u.email.toLowerCase() === String(values[1]).toLowerCase());
            return user ? { rowCount: 1, rows: [{ user_id: user.user_id }] } : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('UPDATE "Users" SET is_active = FALSE WHERE user_id = $1')) {
            const u = this.users.get(Number(values[0]));
            if (u) u.is_active = false;
            return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE "LGU_Admins" SET is_active = FALSE WHERE user_id = $1')) {
            const a = this.lguAdmins.get(Number(values[0]));
            if (a) a.is_active = false;
            return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE "Barangay_Coordinators" SET is_current = FALSE')) {
            const c = this.coordinators.get(Number(values[0]));
            if (c) c.is_current = false;
            return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE "Registrars" SET is_active = FALSE WHERE user_id = $1')) {
            const r = this.registrars.get(Number(values[0]));
            if (r) r.is_active = false;
            return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE "Login_Sessions" SET revoked_at = NOW() WHERE user_id = $1')) {
            let count = 0;
            for (const session of this.sessions.values()) {
                if (session.user_id === Number(values[0]) && !session.revoked_at) {
                    session.revoked_at = new Date().toISOString();
                    count++;
                }
            }
            return { rowCount: count, rows: [] };
        }

        // Login & Session resolution
        if (sql.includes('FROM "Users" u JOIN "Roles" r ON r.role_id = u.role_id')) {
            const user = [...this.users.values()].find(
                (u) => u.email.toLowerCase() === String(values[0]).toLowerCase()
            );
            if (!user) return { rowCount: 0, rows: [] };
            return { rowCount: 1, rows: [this.buildUserSessionRow(user)] };
        }
        if (sql.startsWith('INSERT INTO "Login_Sessions"')) {
            const [userId, hash] = values;
            this.sessions.set(hash, {
                user_id: Number(userId),
                token_hash: hash,
                revoked_at: null,
                expires_at: new Date(Date.now() + 86400 * 1000).toISOString()
            });
            return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('UPDATE "Login_Sessions" SET revoked_at = NOW() WHERE token_hash = $1')) {
            const session = this.sessions.get(values[0]);
            if (session) session.revoked_at = new Date().toISOString();
            return { rowCount: 1, rows: [] };
        }
        if (sql.includes('FROM "Login_Sessions" session JOIN "Users" u')) {
            const session = this.sessions.get(values[0]);
            if (!session || session.revoked_at) return { rowCount: 0, rows: [] };
            const user = this.users.get(session.user_id);
            if (!user || !user.is_active) return { rowCount: 0, rows: [] };
            return { rowCount: 1, rows: [this.buildUserSessionRow(user)] };
        }

        // Audit logs
        if (sql.startsWith('INSERT INTO "Audit_Logs"')) {
            const actionMatch = sql.match(/VALUES \(\$1, '([^']+)', '([^']+)'/);
            this.auditLogs.push({
                log_id: this.nextAuditId++,
                user_id: values[0],
                action_type: actionMatch ? actionMatch[1] : "audit_action",
                entity_type: actionMatch ? actionMatch[2] : "Entity",
                entity_id: values[1],
                details: values.slice(2),
                created_at: new Date().toISOString()
            });
            return { rowCount: 1, rows: [] };
        }
        if (sql.includes('FROM "Audit_Logs" log')) {
            return { rowCount: this.auditLogs.length, rows: this.auditLogs };
        }

        // LGU Admin Dashboard & Programs
        if (sql.includes('FROM "Funding_Programs" program WHERE program.funding_unit_id = $1')) {
            return {
                rowCount: 1,
                rows: [{
                    program_count: 1,
                    active_program_count: 1,
                    total_budget: "500000.00",
                    remaining_budget: "500000.00",
                    reserved_budget: "0.00",
                    released_budget: "0.00"
                }]
            };
        }
        if (sql.includes('FROM "Applications" application JOIN "Funding_Programs" program')) {
            return {
                rowCount: 1,
                rows: [{
                    application_count: 1,
                    in_review_count: 1,
                    approved_count: 0,
                    rejected_count: 0
                }]
            };
        }

        // Verification Queue Summary, Queue List, Detail, and Mutation (Barangay / Registrar / LGU)
        if (sql.includes("AS pending_count") && sql.includes('FROM "Application_Verifications" verification')) {
            const type = values[0];
            const scopeId = Number(values[1]);
            const list = [...this.verifications.values()].filter((v) => {
                if (v.verification_type !== type) return false;
                if (type === "barangay") return v.barangay_id === scopeId;
                if (type === "registrar") return v.school_id === scopeId;
                return v.funding_unit_id === scopeId;
            });
            return {
                rowCount: 1,
                rows: [{ pending_count: list.length, needs_information_count: 0 }]
            };
        }

        if (sql.includes("FOR UPDATE OF verification, application")) {
            const verificationId = Number(values[0]);
            const type = values[1];
            const scopeId = Number(values[2]);
            const v = this.verifications.get(verificationId);
            const scopeMatch =
                type === "barangay"
                    ? v?.barangay_id === scopeId
                    : type === "registrar"
                        ? v?.school_id === scopeId
                        : v?.funding_unit_id === scopeId;
            if (!v || v.verification_type !== type || !scopeMatch) {
                return { rowCount: 0, rows: [] };
            }
            return {
                rowCount: 1,
                rows: [{
                    ...v,
                    program_id: 701
                }]
            };
        }

        if (
            sql.includes('FROM "Application_Verifications" verification') &&
            !sql.includes("verification.verification_id = $1")
        ) {
            const type = values[0];
            const scopeId = Number(values[1]);
            const rows = [...this.verifications.values()].filter((v) => {
                if (v.verification_type !== type) return false;
                if (type === "barangay") return v.barangay_id === scopeId;
                if (type === "registrar") return v.school_id === scopeId;
                return v.funding_unit_id === scopeId;
            });
            return { rowCount: rows.length, rows };
        }

        if (sql.includes('FROM "Application_Verifications" verification')) {
            const verificationId = Number(values[0]);
            const type = values[1];
            const scopeId = Number(values[2]);
            const v = this.verifications.get(verificationId);
            const scopeMatch =
                type === "barangay"
                    ? v?.barangay_id === scopeId
                    : type === "registrar"
                        ? v?.school_id === scopeId
                        : v?.funding_unit_id === scopeId;
            if (!v || v.verification_type !== type || !scopeMatch) {
                return { rowCount: 0, rows: [] };
            }
            return { rowCount: 1, rows: [v] };
        }

        if (sql.startsWith('UPDATE "Application_Verifications"')) {
            const verificationId = Number(values[3] || values[0]);
            const v = this.verifications.get(verificationId);
            if (v) v.status = values[0];
            return { rowCount: 1, rows: [] };
        }
        if (sql.startsWith('SELECT verification_id, verification_type, status, reviewed_by, reviewed_at, remarks FROM "Application_Verifications"')) {
            const v = this.verifications.get(Number(values[0]));
            return v ? { rowCount: 1, rows: [v] } : { rowCount: 0, rows: [] };
        }

        return { rowCount: 0, rows: [] };
    }
}

function createStatefulTestApp(statefulPool) {
    return createApp({
        pool: statefulPool,
        enableTestRegistration: true,
        env: {
            NODE_ENV: "test",
            FRONTEND_ORIGIN,
            DEVELOPER_ALLOWLIST_EMAILS: "cuevas.sharee_angela@hnu.edu.ph,medrina.nina_marie@hnu.edu.ph,palaca.szarina@hnu.edu.ph",
            ALLOWED_LGU_EMAIL_DOMAINS: "tagbilaran.gov.ph,admin.com"
        },
        logger: { error() {} }
    });
}

// ---------------------------------------------------------------------------
// Developer Authorization Tests (1–4)
// ---------------------------------------------------------------------------

test("1. Proposed developer email cannot gain developer access or register through public registration", async () => {
    const pool = new StaffAuthStatefulPool();
    const testApp = createStatefulTestApp(pool);

    for (const devEmail of [
        "cuevas.sharee_angela@hnu.edu.ph",
        "medrina.nina_marie@hnu.edu.ph",
        "palaca.szarina@hnu.edu.ph"
    ]) {
        const res = await request(testApp)
            .post("/api/auth/register")
            .set("Origin", FRONTEND_ORIGIN)
            .send({
                firstName: "Sharee",
                lastName: "Cuevas",
                email: devEmail,
                password: "StrongPassword#2026",
                barangayId: 13,
                schoolId: 1,
                studentNumber: "2026-DEV-01",
                course: "BSIT"
            });
        assert.equal(res.status, 403);
        assert.match(res.body.message, /developer configuration directory/i);
    }
});

test("2. Verified developer (System Admin) can access Staff Access Management endpoints", async () => {
    const pool = new StaffAuthStatefulPool();
    const devUserId = pool.seedUser({
        email: "cuevas.sharee_angela@hnu.edu.ph",
        roleName: "System Admin",
        firstName: "Sharee Angela",
        lastName: "Cuevas"
    });
    const devSession = pool.issueSessionToken(devUserId);
    const testApp = createStatefulTestApp(pool);

    const meRes = await request(testApp)
        .get("/api/auth/me")
        .set("Cookie", `${SESSION_COOKIE}=${devSession}`);
    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.user.role, "System Admin");
    assert.equal(meRes.body.user.dashboardPath, "/portal/system-admin");

    const lookupsRes = await request(testApp)
        .get("/api/system-admin/lookups")
        .set("Cookie", `${SESSION_COOKIE}=${devSession}`);
    assert.equal(lookupsRes.status, 200);
    assert.equal(Array.isArray(lookupsRes.body.proposedDirectories.developers), true);
    assert.equal(lookupsRes.body.proposedDirectories.barangayCoordinators.length, 15);
    assert.equal(lookupsRes.body.proposedDirectories.schoolRegistrars.length, 5);

    const authListRes = await request(testApp)
        .get("/api/system-admin/staff-authorizations")
        .set("Cookie", `${SESSION_COOKIE}=${devSession}`);
    assert.equal(authListRes.status, 200);
});

test("3. Ordinary student, registrar, coordinator, or LGU admin cannot access developer-only routes", async () => {
    const pool = new StaffAuthStatefulPool();
    const studentToken = pool.issueSessionToken(pool.seedUser({ email: "student@gmail.com", roleName: "Scholar", schoolId: 1 }));
    const coordToken = pool.issueSessionToken(pool.seedUser({ email: "coord.taloto@gmail.com", roleName: "Barangay Coordinator", barangayId: 13, staffAuthStatus: "active" }));
    const regToken = pool.issueSessionToken(pool.seedUser({ email: "registrar@hnu.edu.ph", roleName: "Registrar", schoolId: 1, staffAuthStatus: "active" }));
    const lguToken = pool.issueSessionToken(pool.seedUser({ email: "shareerizal@admin.com", roleName: "LGU Admin", fundingUnitId: 41, staffAuthStatus: "active" }));
    const testApp = createStatefulTestApp(pool);

    for (const [token, role] of [
        [studentToken, "Scholar"],
        [coordToken, "Barangay Coordinator"],
        [regToken, "Registrar"],
        [lguToken, "LGU Admin"]
    ]) {
        const getRes = await request(testApp)
            .get("/api/system-admin/staff-authorizations")
            .set("Cookie", `${SESSION_COOKIE}=${token}`);
        assert.equal(getRes.status, 403);

        const previewOptionsRes = await request(testApp)
            .get("/api/system-admin/portal-previews")
            .set("Cookie", `${SESSION_COOKIE}=${token}`);
        assert.equal(previewOptionsRes.status, 403);

        const dashboardPreviewRes = await request(testApp)
            .get("/api/coordinator/dashboard?previewRole=Barangay%20Coordinator&previewScopeId=2")
            .set("Cookie", `${SESSION_COOKIE}=${token}`);
        if (role === "Barangay Coordinator") {
            assert.equal(dashboardPreviewRes.status, 200);
            assert.equal(dashboardPreviewRes.body.summary.pending_count, 1);
        } else {
            assert.equal(dashboardPreviewRes.status, 403);
        }

        const postRes = await request(testApp)
            .post("/api/system-admin/staff-authorizations")
            .set("Origin", FRONTEND_ORIGIN)
            .set("Cookie", `${SESSION_COOKIE}=${token}`)
            .send({
                email: "newstaff@admin.com",
                role: "LGU Admin",
                fundingUnitId: 41
            });
        assert.equal(postRes.status, 403);
    }
});

test("4. Unauthenticated user cannot access developer-only routes", async () => {
    const pool = new StaffAuthStatefulPool();
    const testApp = createStatefulTestApp(pool);

    const getRes = await request(testApp).get("/api/system-admin/lookups");
    assert.equal(getRes.status, 401);

    const postRes = await request(testApp)
        .post("/api/system-admin/staff-authorizations")
        .set("Origin", FRONTEND_ORIGIN)
        .send({ email: "shareerizal@admin.com", role: "LGU Admin", fundingUnitId: 41 });
    assert.equal(postRes.status, 401);
});

// ---------------------------------------------------------------------------
// Staff Invitation Tests (5–10)
// ---------------------------------------------------------------------------

test("5. Developer can create a valid staff invitation for shareerizal@admin.com", async () => {
    const pool = new StaffAuthStatefulPool();
    const devSession = pool.issueSessionToken(
        pool.seedUser({ email: "cuevas.sharee_angela@hnu.edu.ph", roleName: "System Admin" })
    );
    const testApp = createStatefulTestApp(pool);

    const createRes = await request(testApp)
        .post("/api/system-admin/staff-authorizations")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${devSession}`)
        .send({
            email: "  ShareeRizal@ADMIN.com ",
            role: "LGU Admin",
            fundingUnitId: 41,
            positionTitle: "City Scholarship Program Admin",
            expiresInHours: 72
        });

    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.authorization.email, "shareerizal@admin.com");
    assert.equal(createRes.body.authorization.role_name, "LGU Admin");
    assert.equal(createRes.body.authorization.funding_unit_id, 41);
    assert.equal(createRes.body.authorization.status, "pending");
    assert.equal(typeof createRes.body.invitationToken, "string");
    assert.equal(createRes.body.emailDelivery.emailSent, false);
});

test("6. Invited staff email (shareerizal@admin.com) can register, verify email ownership via invitation token, and receive approved role and scope", async () => {
    const pool = new StaffAuthStatefulPool();
    const devSession = pool.issueSessionToken(
        pool.seedUser({ email: "cuevas.sharee_angela@hnu.edu.ph", roleName: "System Admin" })
    );
    const testApp = createStatefulTestApp(pool);

    const inviteRes = await request(testApp)
        .post("/api/system-admin/staff-authorizations")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${devSession}`)
        .send({
            email: "shareerizal@admin.com",
            role: "LGU Admin",
            fundingUnitId: 41,
            positionTitle: "LGU Program Officer"
        });
    assert.equal(inviteRes.status, 201);
    const invitationToken = inviteRes.body.invitationToken;

    const inspectRes = await request(testApp)
        .post("/api/auth/staff-invitations/inspect")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            email: "shareerizal@admin.com",
            invitationToken
        });
    assert.equal(inspectRes.status, 200);
    assert.equal(inspectRes.body.invitation.role, "LGU Admin");
    assert.equal(inspectRes.body.invitation.scopeId, 41);

    const registerRes = await request(testApp)
        .post("/api/auth/staff-register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            email: "shareerizal@admin.com",
            invitationToken,
            firstName: "Sharee",
            lastName: "Rizal",
            password: "SecureStaffPassword#2026"
        });
    assert.equal(registerRes.status, 201);
    assert.equal(registerRes.body.staffAccount.email, "shareerizal@admin.com");
    assert.equal(registerRes.body.staffAccount.role, "LGU Admin");
    assert.equal(registerRes.body.staffAccount.scopeId, 41);
    assert.equal(registerRes.body.staffAccount.dashboardPath, "/portal/lgu-admin");
});

test("7. Uninvited email (joserizal@admin.com) cannot register as LGU Admin or access LGU dashboard", async () => {
    const pool = new StaffAuthStatefulPool();
    const testApp = createStatefulTestApp(pool);

    const uninvitedReg = await request(testApp)
        .post("/api/auth/staff-register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            email: "joserizal@admin.com",
            invitationToken: "0123456789abcdef0123456789abcdef0123456789abcdef",
            firstName: "Jose",
            lastName: "Rizal",
            password: "SecureStaffPassword#2026"
        });
    assert.equal(uninvitedReg.status, 403);
    assert.match(uninvitedReg.body.message, /not authorized on the staff allowlist/i);

    // Even if an uninvited LGU Admin user row existed with unauthorized status, dashboard access is blocked
    const unauthorizedUserId = pool.seedUser({
        email: "joserizal@admin.com",
        roleName: "LGU Admin",
        fundingUnitId: 41,
        staffAuthStatus: "unauthorized"
    });
    const unauthorizedSession = pool.issueSessionToken(unauthorizedUserId);
    const dashboardRes = await request(testApp)
        .get("/api/admin/dashboard")
        .set("Cookie", `${SESSION_COOKIE}=${unauthorizedSession}`);
    assert.equal(dashboardRes.status, 403);
});

test("8. Expired invitation cannot be redeemed", async () => {
    const pool = new StaffAuthStatefulPool();
    const devSession = pool.issueSessionToken(
        pool.seedUser({ email: "cuevas.sharee_angela@hnu.edu.ph", roleName: "System Admin" })
    );
    const testApp = createStatefulTestApp(pool);

    const inviteRes = await request(testApp)
        .post("/api/system-admin/staff-authorizations")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${devSession}`)
        .send({
            email: "expired.staff@admin.com",
            role: "LGU Admin",
            fundingUnitId: 41
        });
    assert.equal(inviteRes.status, 201);

    // Force expiration in the past
    const authRecord = pool.staffAuthorizations.get(inviteRes.body.authorization.authorization_id);
    authRecord.expires_at = new Date(Date.now() - 3600 * 1000).toISOString();

    const redeemRes = await request(testApp)
        .post("/api/auth/staff-register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            email: "expired.staff@admin.com",
            invitationToken: inviteRes.body.invitationToken,
            firstName: "Expired",
            lastName: "Staff",
            password: "SecureStaffPassword#2026"
        });
    assert.equal(redeemRes.status, 403);
    assert.match(redeemRes.body.message, /expired/i);
});

test("9. Revoked invitation cannot be redeemed and revoking an active authorization terminates sessions immediately", async () => {
    const pool = new StaffAuthStatefulPool();
    const devSession = pool.issueSessionToken(
        pool.seedUser({ email: "cuevas.sharee_angela@hnu.edu.ph", roleName: "System Admin" })
    );
    const testApp = createStatefulTestApp(pool);

    // Create and redeem invitation
    const inviteRes = await request(testApp)
        .post("/api/system-admin/staff-authorizations")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${devSession}`)
        .send({
            email: "revocable@admin.com",
            role: "LGU Admin",
            fundingUnitId: 41
        });
    const authId = inviteRes.body.authorization.authorization_id;

    const regRes = await request(testApp)
        .post("/api/auth/staff-register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            email: "revocable@admin.com",
            invitationToken: inviteRes.body.invitationToken,
            firstName: "Revocable",
            lastName: "Admin",
            password: "SecureStaffPassword#2026"
        });
    assert.equal(regRes.status, 201);

    const staffSession = pool.issueSessionToken(regRes.body.staffAccount.userId);
    const beforeRevoke = await request(testApp)
        .get("/api/admin/dashboard")
        .set("Cookie", `${SESSION_COOKIE}=${staffSession}`);
    assert.equal(beforeRevoke.status, 200);

    // System Admin revokes the authorization
    const revokeRes = await request(testApp)
        .post(`/api/system-admin/staff-authorizations/${authId}/revoke`)
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${devSession}`)
        .send({ reason: "End of assignment" });
    assert.equal(revokeRes.status, 200);
    assert.equal(revokeRes.body.sessionsRevoked, true);
    assert.equal(revokeRes.body.revokedSessionCount, 1);

    // Subsequent request with previously issued session fails immediately
    const afterRevoke = await request(testApp)
        .get("/api/admin/dashboard")
        .set("Cookie", `${SESSION_COOKIE}=${staffSession}`);
    assert.equal(afterRevoke.status, 401);
});

test("10. Ordinary staff cannot create/revoke invitations and LGU granular permissions restrict actions", async () => {
    const pool = new StaffAuthStatefulPool();
    const readOnlyLguUserId = pool.seedUser({
        email: "readonly.lgu@admin.com",
        roleName: "LGU Admin",
        fundingUnitId: 41,
        staffAuthStatus: "active",
        lguPermissions: {
            read_only_reports: true,
            program_management: false,
            application_review: false,
            award_approval: false,
            disbursement_release: false
        }
    });
    const readOnlySession = pool.issueSessionToken(readOnlyLguUserId);
    const testApp = createStatefulTestApp(pool);

    // Can view read-only dashboard
    const dashRes = await request(testApp)
        .get("/api/admin/dashboard")
        .set("Cookie", `${SESSION_COOKIE}=${readOnlySession}`);
    assert.equal(dashRes.status, 200);

    // Cannot create programs without program_management permission
    const createProgRes = await request(testApp)
        .post("/api/admin/programs")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${readOnlySession}`)
        .send({
            programName: "Unauthorized Program",
            fundingCycleId: 1,
            totalBudget: 100000
        });
    assert.equal(createProgRes.status, 403);
    assert.match(createProgRes.body.message, /program_management/);

    // Cannot approve awards without award_approval permission
    const approveRes = await request(testApp)
        .patch("/api/admin/verifications/821")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${readOnlySession}`)
        .send({ status: "approved", awardAmount: 10000 });
    assert.equal(approveRes.status, 403);
    assert.match(approveRes.body.message, /award_approval/);
});

// ---------------------------------------------------------------------------
// Barangay Access Tests (11–13)
// ---------------------------------------------------------------------------

test("11. Barangay Coordinator for Taloto (barangay_id=13) can access Taloto records", async () => {
    const pool = new StaffAuthStatefulPool();
    const talotoSession = pool.issueSessionToken(
        pool.seedUser({
            email: "barangay.taloto.coordinator@gmail.com",
            roleName: "Barangay Coordinator",
            barangayId: 13,
            staffAuthStatus: "active"
        })
    );
    const testApp = createStatefulTestApp(pool);

    const queueRes = await request(testApp)
        .get("/api/coordinator/verifications")
        .set("Cookie", `${SESSION_COOKIE}=${talotoSession}`);
    assert.equal(queueRes.status, 200);
    assert.equal(queueRes.body.verifications.length, 1);
    assert.equal(queueRes.body.verifications[0].barangay_name, "Taloto");

    const patchRes = await request(testApp)
        .patch("/api/coordinator/verifications/801")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${talotoSession}`)
        .send({ status: "approved", remarks: "Confirmed resident of Taloto" });
    assert.equal(patchRes.status, 200);
});

test("12. Barangay Coordinator for Taloto cannot access Bool (barangay_id=1) records", async () => {
    const pool = new StaffAuthStatefulPool();
    const talotoSession = pool.issueSessionToken(
        pool.seedUser({
            email: "barangay.taloto.coordinator@gmail.com",
            roleName: "Barangay Coordinator",
            barangayId: 13,
            staffAuthStatus: "active"
        })
    );
    const testApp = createStatefulTestApp(pool);

    // Verification 802 belongs to Barangay Bool (barangay_id = 1)
    const crossBarangayRes = await request(testApp)
        .patch("/api/coordinator/verifications/802")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${talotoSession}`)
        .send({ status: "approved", remarks: "Attempt cross-barangay approval" });
    assert.equal(crossBarangayRes.status, 404);
});

test("13. Tampered barangay_id in request body or query is rejected or ignored", async () => {
    const pool = new StaffAuthStatefulPool();
    const talotoSession = pool.issueSessionToken(
        pool.seedUser({
            email: "barangay.taloto.coordinator@gmail.com",
            roleName: "Barangay Coordinator",
            barangayId: 13,
            staffAuthStatus: "active"
        })
    );
    const testApp = createStatefulTestApp(pool);

    // Strict schema rejects unexpected barangayId in PATCH body
    const tamperedBodyRes = await request(testApp)
        .patch("/api/coordinator/verifications/802")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${talotoSession}`)
        .send({ status: "approved", barangayId: 1 });
    assert.equal(tamperedBodyRes.status, 400);

    // Query parameter tampering on GET /api/coordinator/verifications is ignored; only Taloto (13) is returned
    const tamperedQueryRes = await request(testApp)
        .get("/api/coordinator/verifications?barangayId=1&barangay_id=1")
        .set("Cookie", `${SESSION_COOKIE}=${talotoSession}`);
    assert.equal(tamperedQueryRes.status, 200);
    assert.equal(
        tamperedQueryRes.body.verifications.every((v) => v.barangay_id === 13),
        true
    );
});

// ---------------------------------------------------------------------------
// School Access Tests (14–20)
// ---------------------------------------------------------------------------

test("14. HNU Registrar can access HNU student records", async () => {
    const pool = new StaffAuthStatefulPool();
    const hnuSession = pool.issueSessionToken(
        pool.seedUser({
            email: "registrar@hnu.edu.ph",
            roleName: "Registrar",
            schoolId: 1,
            staffAuthStatus: "active"
        })
    );
    const testApp = createStatefulTestApp(pool);

    const detailRes = await request(testApp)
        .get("/api/registrar/verifications/811")
        .set("Cookie", `${SESSION_COOKIE}=${hnuSession}`);
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.body.verification.school_name, "Holy Name University");
});

test("15. HNU Registrar cannot access BISU, UB, TCC, PMI, or High School records", async () => {
    const pool = new StaffAuthStatefulPool();
    const hnuSession = pool.issueSessionToken(
        pool.seedUser({
            email: "registrar@hnu.edu.ph",
            roleName: "Registrar",
            schoolId: 1,
            staffAuthStatus: "active"
        })
    );
    const testApp = createStatefulTestApp(pool);

    for (const otherSchoolVerificationId of [812, 813, 814, 815, 816]) {
        const res = await request(testApp)
            .get(`/api/registrar/verifications/${otherSchoolVerificationId}`)
            .set("Cookie", `${SESSION_COOKIE}=${hnuSession}`);
        assert.equal(res.status, 404);
    }
});

test("16. BISU Registrar can access only BISU records", async () => {
    const pool = new StaffAuthStatefulPool();
    const bisuSession = pool.issueSessionToken(
        pool.seedUser({
            email: "registrar.tagbilaran@bisu.edu.ph",
            roleName: "Registrar",
            schoolId: 2,
            staffAuthStatus: "active"
        })
    );
    const testApp = createStatefulTestApp(pool);

    const ownRes = await request(testApp)
        .get("/api/registrar/verifications/812")
        .set("Cookie", `${SESSION_COOKIE}=${bisuSession}`);
    assert.equal(ownRes.status, 200);
    assert.equal(ownRes.body.verification.school_id, 2);

    for (const otherId of [811, 813, 814, 815, 816]) {
        const otherRes = await request(testApp)
            .get(`/api/registrar/verifications/${otherId}`)
            .set("Cookie", `${SESSION_COOKIE}=${bisuSession}`);
        assert.equal(otherRes.status, 404);
    }
});

test("17. UB Registrar can access only UB records", async () => {
    const pool = new StaffAuthStatefulPool();
    const ubSession = pool.issueSessionToken(
        pool.seedUser({
            email: "registrar@universityofbohol.edu.ph",
            roleName: "Registrar",
            schoolId: 3,
            staffAuthStatus: "active"
        })
    );
    const testApp = createStatefulTestApp(pool);

    const ownRes = await request(testApp)
        .get("/api/registrar/verifications/813")
        .set("Cookie", `${SESSION_COOKIE}=${ubSession}`);
    assert.equal(ownRes.status, 200);
    assert.equal(ownRes.body.verification.school_id, 3);

    for (const otherId of [811, 812, 814, 815, 816]) {
        const otherRes = await request(testApp)
            .get(`/api/registrar/verifications/${otherId}`)
            .set("Cookie", `${SESSION_COOKIE}=${ubSession}`);
        assert.equal(otherRes.status, 404);
    }
});

test("18. TCC Registrar can access only TCC records", async () => {
    const pool = new StaffAuthStatefulPool();
    const tccSession = pool.issueSessionToken(
        pool.seedUser({
            email: "registrar@tagbilarancitycollege.edu.ph",
            roleName: "Registrar",
            schoolId: 4,
            staffAuthStatus: "active"
        })
    );
    const testApp = createStatefulTestApp(pool);

    const ownRes = await request(testApp)
        .get("/api/registrar/verifications/814")
        .set("Cookie", `${SESSION_COOKIE}=${tccSession}`);
    assert.equal(ownRes.status, 200);
    assert.equal(ownRes.body.verification.school_id, 4);

    for (const otherId of [811, 812, 813, 815, 816]) {
        const otherRes = await request(testApp)
            .get(`/api/registrar/verifications/${otherId}`)
            .set("Cookie", `${SESSION_COOKIE}=${tccSession}`);
        assert.equal(otherRes.status, 404);
    }
});

test("19. PMI Registrar can access only PMI records", async () => {
    const pool = new StaffAuthStatefulPool();
    const pmiSession = pool.issueSessionToken(
        pool.seedUser({
            email: "registrar@pmicollegesbohol.edu.ph",
            roleName: "Registrar",
            schoolId: 5,
            staffAuthStatus: "active"
        })
    );
    const testApp = createStatefulTestApp(pool);

    const ownRes = await request(testApp)
        .get("/api/registrar/verifications/815")
        .set("Cookie", `${SESSION_COOKIE}=${pmiSession}`);
    assert.equal(ownRes.status, 200);
    assert.equal(ownRes.body.verification.school_id, 5);

    for (const otherId of [811, 812, 813, 814, 816]) {
        const otherRes = await request(testApp)
            .get(`/api/registrar/verifications/${otherId}`)
            .set("Cookie", `${SESSION_COOKIE}=${pmiSession}`);
        assert.equal(otherRes.status, 404);
    }
});

test("20. High school Registrar (configured without inventing a domain) can access only the assigned high school's records", async () => {
    const pool = new StaffAuthStatefulPool();
    const devSession = pool.issueSessionToken(
        pool.seedUser({ email: "cuevas.sharee_angela@hnu.edu.ph", roleName: "System Admin" })
    );
    const testApp = createStatefulTestApp(pool);

    // Configure a Tagbilaran high school without inventing an official domain
    const addSchoolRes = await request(testApp)
        .post("/api/system-admin/school-domains")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${devSession}`)
        .send({
            schoolName: "Dr. Cecilio Putong National High School",
            notes: "Tagbilaran City public high school — no invented domain"
        });
    assert.equal(addSchoolRes.status, 201);
    assert.equal(addSchoolRes.body.school.school_id, 6);
    assert.equal(addSchoolRes.body.schoolDomain, null);

    const hsRegistrarSession = pool.issueSessionToken(
        pool.seedUser({
            email: "dcpnhs.registrar@gmail.com",
            roleName: "Registrar",
            schoolId: 6,
            staffAuthStatus: "active"
        })
    );

    const ownRes = await request(testApp)
        .get("/api/registrar/verifications/816")
        .set("Cookie", `${SESSION_COOKIE}=${hsRegistrarSession}`);
    assert.equal(ownRes.status, 200);
    assert.equal(ownRes.body.verification.school_id, 6);

    for (const collegeVerificationId of [811, 812, 813, 814, 815]) {
        const otherRes = await request(testApp)
            .get(`/api/registrar/verifications/${collegeVerificationId}`)
            .set("Cookie", `${SESSION_COOKIE}=${hsRegistrarSession}`);
        assert.equal(otherRes.status, 404);
    }
});

// ---------------------------------------------------------------------------
// Student Email Verification Tests (21–25)
// ---------------------------------------------------------------------------

test("21. Student registering with a valid school email receives verification token and can verify ownership", async () => {
    const pool = new StaffAuthStatefulPool();
    const testApp = createStatefulTestApp(pool);

    const regRes = await request(testApp)
        .post("/api/auth/register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            firstName: "Maria",
            lastName: "Santos",
            email: "maria.santos@hnu.edu.ph",
            password: "StudentStrongPassword#2026",
            barangayId: 13,
            schoolId: 1,
            studentNumber: "HNU-2026-101",
            course: "BS Nursing"
        });
    assert.equal(regRes.status, 201);
    assert.equal(regRes.body.emailVerification.verified, false);

    const resendRes = await request(testApp)
        .post("/api/auth/resend-verification")
        .set("Origin", FRONTEND_ORIGIN)
        .send({ email: "maria.santos@hnu.edu.ph" });
    assert.equal(resendRes.status, 201);
    const verificationToken = resendRes.body.emailVerification.verificationToken;
    assert.equal(typeof verificationToken, "string");

    const verifyRes = await request(testApp)
        .post("/api/auth/verify-email")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            email: "maria.santos@hnu.edu.ph",
            verificationToken
        });
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.emailVerification.verified, true);
    assert.equal(verifyRes.body.emailVerification.enrollmentVerified, false);
});

test("22. Student registering with a mismatched school domain (e.g. @bisu.edu.ph for HNU) is rejected", async () => {
    const pool = new StaffAuthStatefulPool();
    const testApp = createStatefulTestApp(pool);

    const mismatchRes = await request(testApp)
        .post("/api/auth/register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            firstName: "Pedro",
            lastName: "Penduko",
            email: "pedro@bisu.edu.ph",
            password: "StudentStrongPassword#2026",
            barangayId: 1,
            schoolId: 1, // HNU selected, but email is @bisu.edu.ph
            studentNumber: "HNU-2026-999",
            course: "BSIT"
        });
    assert.equal(mismatchRes.status, 400);
    assert.match(mismatchRes.body.errors[0].message, /hnu\.edu\.ph/i);
});

test("23. Lookalike domain (student@fakehnu.edu.ph) is rejected", async () => {
    const pool = new StaffAuthStatefulPool();
    const testApp = createStatefulTestApp(pool);

    const lookalikeRes = await request(testApp)
        .post("/api/auth/register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            firstName: "Fake",
            lastName: "Domain",
            email: "student@fakehnu.edu.ph",
            password: "StudentStrongPassword#2026",
            barangayId: 1,
            schoolId: 1,
            studentNumber: "HNU-FAKE-001",
            course: "BSIT"
        });
    assert.equal(lookalikeRes.status, 400);
});

test("24. Invalid, expired, or already-used student email verification token is rejected", async () => {
    const pool = new StaffAuthStatefulPool();
    pool.seedUser({
        email: "unverified.student@hnu.edu.ph",
        roleName: "Scholar",
        schoolId: 1,
        emailVerifiedAt: null
    });
    const testApp = createStatefulTestApp(pool);

    const resendRes = await request(testApp)
        .post("/api/auth/resend-verification")
        .set("Origin", FRONTEND_ORIGIN)
        .send({ email: "unverified.student@hnu.edu.ph" });
    const validToken = resendRes.body.emailVerification.verificationToken;

    // Wrong token fails with 403
    const wrongTokenRes = await request(testApp)
        .post("/api/auth/verify-email")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            email: "unverified.student@hnu.edu.ph",
            verificationToken: "wrong_token_value_0123456789abcdef"
        });
    assert.equal(wrongTokenRes.status, 403);

    // Valid token succeeds once
    const firstUseRes = await request(testApp)
        .post("/api/auth/verify-email")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            email: "unverified.student@hnu.edu.ph",
            verificationToken: validToken
        });
    assert.equal(firstUseRes.status, 200);

    // Reusing the same single-use token fails with 403
    const replayRes = await request(testApp)
        .post("/api/auth/verify-email")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            email: "unverified.student@hnu.edu.ph",
            verificationToken: validToken
        });
    assert.equal(replayRes.status, 403);
});

test("25. Student email verification does not mark School Registrar enrollment verification as verified", async () => {
    const pool = new StaffAuthStatefulPool();
    pool.seedUser({
        email: "hnu.applicant@hnu.edu.ph",
        roleName: "Scholar",
        schoolId: 1,
        emailVerifiedAt: null
    });
    const testApp = createStatefulTestApp(pool);

    const resendRes = await request(testApp)
        .post("/api/auth/resend-verification")
        .set("Origin", FRONTEND_ORIGIN)
        .send({ email: "hnu.applicant@hnu.edu.ph" });

    const verifyRes = await request(testApp)
        .post("/api/auth/verify-email")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            email: "hnu.applicant@hnu.edu.ph",
            verificationToken: resendRes.body.emailVerification.verificationToken
        });
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.emailVerification.enrollmentVerified, false);
    // Registrar verification 811 remains pending
    assert.equal(pool.verifications.get(811).status, "pending");
});

// ---------------------------------------------------------------------------
// Regression & Security Tests (26–30)
// ---------------------------------------------------------------------------

test("26. Existing login and logout continue working across roles", async () => {
    const pool = new StaffAuthStatefulPool();
    pool.seedUser({
        email: "active.scholar@gmail.com",
        roleName: "Scholar",
        schoolId: 1
    });
    const testApp = createStatefulTestApp(pool);

    const loginRes = await request(testApp)
        .post("/api/auth/login")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            email: "active.scholar@gmail.com",
            password: "correct horse battery staple"
        });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body.user.role, "Scholar");
    const cookieHeader = loginRes.headers["set-cookie"]?.[0];
    assert.equal(Boolean(cookieHeader), true);

    const logoutRes = await request(testApp)
        .post("/api/auth/logout")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", cookieHeader.split(";")[0]);
    assert.equal(logoutRes.status, 200);
});

test("27. Existing student registration and application flow continue working", async () => {
    const regRes = await request(app)
        .post("/api/auth/register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            firstName: "Continuing",
            lastName: "Scholar",
            email: "continuing.scholar@gmail.com",
            password: "ValidStudentPassword#123",
            barangayId: 1,
            schoolId: 1,
            studentNumber: "2026-CONT-01",
            course: "BS Computer Science"
        });
    assert.equal(regRes.status, 201);

    const appRes = await request(app)
        .post("/api/student/applications")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${tokens.studentA}`)
        .send({ programId: 701 });
    assert.equal(appRes.status, 201);
});

test("28. Direct URL/API access to another role's dashboard fails with 403", async () => {
    const pool = new StaffAuthStatefulPool();
    const scholarSession = pool.issueSessionToken(
        pool.seedUser({ email: "scholar@gmail.com", roleName: "Scholar", schoolId: 1 })
    );
    const registrarSession = pool.issueSessionToken(
        pool.seedUser({ email: "registrar@hnu.edu.ph", roleName: "Registrar", schoolId: 1, staffAuthStatus: "active" })
    );
    const testApp = createStatefulTestApp(pool);

    const scholarToAdmin = await request(testApp)
        .get("/api/admin/dashboard")
        .set("Cookie", `${SESSION_COOKIE}=${scholarSession}`);
    assert.equal(scholarToAdmin.status, 403);

    const registrarToCoordinator = await request(testApp)
        .get("/api/coordinator/dashboard")
        .set("Cookie", `${SESSION_COOKIE}=${registrarSession}`);
    assert.equal(registrarToCoordinator.status, 403);

    const registrarToSystemAdmin = await request(testApp)
        .get("/api/system-admin/lookups")
        .set("Cookie", `${SESSION_COOKIE}=${registrarSession}`);
    assert.equal(registrarToSystemAdmin.status, 403);
});

test("29. Client-supplied role or scope manipulation fails", async () => {
    const pool = new StaffAuthStatefulPool();
    const devSession = pool.issueSessionToken(
        pool.seedUser({ email: "cuevas.sharee_angela@hnu.edu.ph", roleName: "System Admin" })
    );
    const testApp = createStatefulTestApp(pool);

    // Public student registration rejects role/roleId injection
    const injectedRoleReg = await request(testApp)
        .post("/api/auth/register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            firstName: "Attacker",
            lastName: "User",
            email: "attacker@gmail.com",
            password: "ValidStudentPassword#123",
            barangayId: 1,
            schoolId: 1,
            studentNumber: "ATK-001",
            course: "BSIT",
            role: "System Admin"
        });
    assert.equal(injectedRoleReg.status, 400);

    // Staff invitation registration rejects client-supplied role/scope overrides
    const inviteRes = await request(testApp)
        .post("/api/system-admin/staff-authorizations")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${devSession}`)
        .send({
            email: "scoped.registrar@hnu.edu.ph",
            role: "Registrar",
            schoolId: 1
        });

    const tamperedStaffReg = await request(testApp)
        .post("/api/auth/staff-register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            email: "scoped.registrar@hnu.edu.ph",
            invitationToken: inviteRes.body.invitationToken,
            firstName: "Scoped",
            lastName: "Registrar",
            password: "SecureStaffPassword#2026",
            role: "System Admin",
            schoolId: 2
        });
    assert.equal(tamperedStaffReg.status, 400);
});

test("30. Audit log entries are created for staff authorization creation, invitation redemption, revocation, and school domain changes", async () => {
    const pool = new StaffAuthStatefulPool();
    const devSession = pool.issueSessionToken(
        pool.seedUser({ email: "cuevas.sharee_angela@hnu.edu.ph", roleName: "System Admin" })
    );
    const testApp = createStatefulTestApp(pool);

    // 1. Create staff authorization
    const createRes = await request(testApp)
        .post("/api/system-admin/staff-authorizations")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${devSession}`)
        .send({
            email: "audited.staff@admin.com",
            role: "LGU Admin",
            fundingUnitId: 41
        });
    assert.equal(createRes.status, 201);

    // 2. Redeem staff invitation
    const redeemRes = await request(testApp)
        .post("/api/auth/staff-register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            email: "audited.staff@admin.com",
            invitationToken: createRes.body.invitationToken,
            firstName: "Audited",
            lastName: "Staff",
            password: "SecureStaffPassword#2026"
        });
    assert.equal(redeemRes.status, 201);

    // 3. Revoke staff authorization
    const revokeRes = await request(testApp)
        .post(`/api/system-admin/staff-authorizations/${createRes.body.authorization.authorization_id}/revoke`)
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${devSession}`)
        .send({ reason: "Audit test revocation" });
    assert.equal(revokeRes.status, 200);

    // 4. Configure school domain
    const domainRes = await request(testApp)
        .post("/api/system-admin/school-domains")
        .set("Origin", FRONTEND_ORIGIN)
        .set("Cookie", `${SESSION_COOKIE}=${devSession}`)
        .send({
            schoolId: 1,
            domain: "scholars.hnu.edu.ph",
            domainStatus: "verified",
            isPrimary: false
        });
    assert.equal(domainRes.status, 201);

    // 5. Verify audit logs via GET /api/system-admin/audit-logs
    const logsRes = await request(testApp)
        .get("/api/system-admin/audit-logs")
        .set("Cookie", `${SESSION_COOKIE}=${devSession}`);
    assert.equal(logsRes.status, 200);
    const actionTypes = logsRes.body.auditLogs.map((l) => l.action_type);
    assert.equal(actionTypes.includes("staff_authorization_created"), true);
    assert.equal(actionTypes.includes("staff_invitation_redeemed"), true);
    assert.equal(actionTypes.includes("staff_authorization_revoked"), true);
    assert.equal(actionTypes.includes("school_domain_configured"), true);
});
