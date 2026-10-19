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
        email: "one@example.test",
        role_name: "Scholar",
        student_id: 101
    },
    studentB: {
        user_id: 22,
        first_name: "Student",
        last_name: "Two",
        email: "two@example.test",
        role_name: "Scholar",
        student_id: 202
    },
    studentWithoutAssignment: {
        user_id: 23,
        first_name: "Unassigned",
        last_name: "Student",
        email: "unassigned@example.test",
        role_name: "Scholar"
    },
    unsupportedRole: {
        user_id: 24,
        first_name: "Unsupported",
        last_name: "Role",
        email: "unsupported@example.test",
        role_name: "Auditor"
    },
    inactiveStudent: {
        user_id: 25,
        first_name: "Inactive",
        last_name: "Student",
        email: "inactive@example.test",
        role_name: "Scholar",
        student_id: 303,
        is_active: false
    },
    coordinatorA: {
        user_id: 33,
        first_name: "Coordinator",
        last_name: "One",
        email: "coordinator@example.test",
        role_name: "Barangay Coordinator",
        coordinator_barangay_id: 7
    },
    registrarA: {
        user_id: 44,
        first_name: "Registrar",
        last_name: "One",
        email: "registrar@example.test",
        role_name: "Registrar",
        registrar_school_id: 31
    },
    adminA: {
        user_id: 55,
        first_name: "Admin",
        last_name: "One",
        email: "admin@example.test",
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
        return this;
    }

    release() {}

    async query(query, values = []) {
        const sql = query.replace(/\s+/g, " ").trim();

        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
            return { rowCount: 0, rows: [] };
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
            return { rowCount: 1, rows: [{ role_id: 4 }] };
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

        if (sql.includes('FROM "Users" WHERE lower(email) = $1')) {
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
                        is_active: user.is_active !== false
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
        .send({ email: "one@example.test", password: "correct horse battery staple" });

    assert.equal(login.status, 200);
    assert.equal(login.body.user.email, "one@example.test");
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
        { email: "one@example.test", password: "wrong password" },
        { email: "missing@example.test", password: "wrong password" },
        { email: "inactive@example.test", password: "correct horse battery staple" }
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

test("registration rejects client-selected roles", async () => {
    const response = await request(app)
        .post("/api/auth/register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            firstName: "New",
            lastName: "Student",
            email: "new@example.test",
            password: "a sufficiently long password",
            barangayId: 1,
            schoolId: 1,
            studentNumber: "NEW-1",
            course: "Education",
            role: "LGU Admin"
        });

    assert.equal(response.status, 400);
});

test("registration hashes the password and assigns only the Scholar role", async () => {
    const password = "a sufficiently long password";
    const response = await request(app)
        .post("/api/auth/register")
        .set("Origin", FRONTEND_ORIGIN)
        .send({
            firstName: "New",
            lastName: "Student",
            email: "new@example.test",
            password,
            barangayId: 1,
            schoolId: 1,
            studentNumber: "NEW-1",
            course: "Education"
        });

    assert.equal(response.status, 201);
    assert.equal(fakePool.insertedUserValues[0], 4);
    assert.notEqual(fakePool.insertedUserValues[5], password);
    assert.equal(
        await argon2.verify(fakePool.insertedUserValues[5], password),
        true
    );
    assert.equal(fakePool.insertedStudentValues[0], 88);
    assert.equal(JSON.stringify(response.body).includes(password), false);
});

test("registration reports duplicate account details without writing records", async () => {
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
            email: "existing@example.test",
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
        .send({ email: "one@example.test", password: "wrong password" });

    assert.equal(response.status, 403);
});

test("state-changing authentication requests reject a missing Origin", async () => {
    const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "one@example.test", password: "wrong password" });
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
