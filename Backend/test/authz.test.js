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
    adminA: createToken("adminA")
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
