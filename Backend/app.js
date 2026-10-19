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

const SESSION_COOKIE = "grantwise_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const SESSION_DURATION_SECONDS = SESSION_DURATION_MS / 1000;
const MAX_QUEUE_SIZE = 50;

const registrationSchema = z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(128),
    phoneNumber: z.string().trim().max(30).optional().nullable(),
    barangayId: z.number().int().positive(),
    schoolId: z.number().int().positive(),
    studentNumber: z.string().trim().min(1).max(50),
    course: z.string().trim().min(1).max(100),
    yearLevel: z.string().trim().max(50).optional().nullable()
}).strict();

const loginSchema = z.object({
    email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(128)
}).strict();

const applicationSchema = z.object({
    programId: z.number().int().positive()
}).strict();

function tokenHash(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function getAllowedOrigins(env) {
    const configured = env.FRONTEND_ORIGINS || env.FRONTEND_ORIGIN;
    const values = configured
        ? configured.split(",").map((origin) => origin.trim()).filter(Boolean)
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
                AS has_verification_table`
    );
    const capabilities = result.rows[0];
    return {
        relationalProgramSchema: capabilities.relational_program_schema,
        applicationWorkflowEnabled: capabilities.application_workflow_schema,
        hasVerificationTable: capabilities.has_verification_table,
        applicationSubmissionEnabled:
            capabilities.relational_program_schema &&
            capabilities.application_workflow_schema
    };
}

function setSessionCookie(res, token, secure) {
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure,
        sameSite: "strict",
        path: "/api",
        maxAge: SESSION_DURATION_MS
    });
}

function clearSessionCookie(res, secure) {
    res.clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        secure,
        sameSite: "strict",
        path: "/api"
    });
}

function createApp({
    pool = defaultPool,
    initializeDatabase = initDatabase,
    enableTestRegistration = false,
    env = process.env,
    logger = console
} = {}) {
    const app = express();
    const allowedOrigins = getAllowedOrigins(env);
    const secureCookies = env.NODE_ENV === "production";
    const allowDevelopmentRoutes = env.NODE_ENV === "development";
    const allowRegistration =
        allowDevelopmentRoutes || (env.NODE_ENV === "test" && enableTestRegistration);

    app.disable("x-powered-by");
    app.use(helmet());
    app.use(cors({
        credentials: true,
        origin(origin, callback) {
            callback(null, !origin || allowedOrigins.has(origin));
        }
    }));
    app.use(express.json({ limit: "32kb", strict: true }));
    app.use(cookieParser());

    const authRateLimit = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        skip: () => env.NODE_ENV === "test",
        message: { message: "Too many authentication attempts. Try again later." }
    });

    function requireTrustedOrigin(req, res, next) {
        if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
            return next();
        }

        const origin = req.get("origin");
        if (!origin || !allowedOrigins.has(origin)) {
            return res.status(403).json({ message: "Request origin is not allowed." });
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
                'SELECT barangay_id, barangay_name FROM "Barangays" ORDER BY barangay_name'
            );
            const schools = await pool.query(
                'SELECT school_id, school_name FROM "Schools" WHERE is_approved = TRUE ORDER BY school_name'
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
                              program.program_name`
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
                     ORDER BY start_date, program_name`
                );
            return res.json({
                programs: result.rows,
                applicationSubmissionEnabled: capabilities.applicationSubmissionEnabled
            });
        } catch (error) {
            return next(error);
        }
    });

    if (allowDevelopmentRoutes) {
        app.post("/api/init-db", async (req, res) => {
            try {
                await initializeDatabase();
                res.json({ message: "GrantWise database schema initialized successfully." });
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
                return res.status(400).json({
                    message: "Registration details are invalid.",
                    errors: input.error.issues.map(({ path, message }) => ({
                        field: path.join("."),
                        message
                    }))
                });
            }

            const data = input.data;
            const passwordHash = await argon2.hash(data.password, {
                type: argon2.argon2id,
                memoryCost: 19456,
                timeCost: 2,
                parallelism: 1
            });
            const client = await pool.connect();

            try {
                await client.query("BEGIN");
                await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
                    data.email
                ]);

                const existingUser = await client.query(
                    'SELECT 1 FROM "Users" WHERE lower(email) = $1 LIMIT 1',
                    [data.email]
                );
                const existingStudent = await client.query(
                    'SELECT 1 FROM "Students" WHERE student_number = $1 LIMIT 1',
                    [data.studentNumber]
                );
                const approvedSchool = await client.query(
                    'SELECT 1 FROM "Schools" WHERE school_id = $1 AND is_approved = TRUE',
                    [data.schoolId]
                );
                const existingBarangay = await client.query(
                    'SELECT 1 FROM "Barangays" WHERE barangay_id = $1',
                    [data.barangayId]
                );

                if (existingUser.rowCount > 0 || existingStudent.rowCount > 0) {
                    await client.query("ROLLBACK");
                    return res.status(409).json({
                        message: "An account with this email or student number already exists."
                    });
                }
                if (approvedSchool.rowCount === 0 || existingBarangay.rowCount === 0) {
                    await client.query("ROLLBACK");
                    return res.status(400).json({
                        message: "Select a valid barangay and an approved school."
                    });
                }

                const role = await client.query(
                    'SELECT role_id FROM "Roles" WHERE role_name = $1',
                    ["Scholar"]
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
                        data.phoneNumber || null
                    ]
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
                        data.yearLevel || null
                    ]
                );
                await client.query("COMMIT");
                return res.status(201).json({
                    message: "Account created. Sign in to continue."
                });
            } catch (error) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
                    logger.error("Registration transaction rollback failed", {
                        code: rollbackError.code
                    });
                }
                if (error.code === "23505") {
                    return res.status(409).json({
                        message: "An account with this email or student number already exists."
                    });
                }
                throw error;
            } finally {
                client.release();
            }
        });
    }

    app.post("/api/auth/login", authRateLimit, async (req, res) => {
        const input = loginSchema.safeParse(req.body);
        if (!input.success) {
            return res.status(400).json({ message: "Email or password is invalid." });
        }

        const result = await pool.query(
            `SELECT u.user_id, u.first_name, u.last_name, u.email,
                    u.password_hash, u.is_active, r.role_name
             FROM "Users" u
             JOIN "Roles" r ON r.role_id = u.role_id
             WHERE lower(u.email) = $1
             LIMIT 1`,
            [input.data.email]
        );
        const user = result.rows[0];
        let validPassword = false;

        if (user) {
            try {
                validPassword = await argon2.verify(user.password_hash, input.data.password);
            } catch {
                validPassword = false;
            }
        } else {
            await argon2.hash(input.data.password, {
                type: argon2.argon2id,
                memoryCost: 19456,
                timeCost: 2,
                parallelism: 1
            });
        }

        if (!user || !user.is_active || !validPassword) {
            return res.status(401).json({ message: "Email or password is invalid." });
        }

        const token = crypto.randomBytes(32).toString("base64url");
        await pool.query(
            `INSERT INTO "Login_Sessions" (user_id, token_hash, expires_at)
             VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'))`,
            [user.user_id, tokenHash(token), SESSION_DURATION_SECONDS]
        );
        setSessionCookie(res, token, secureCookies);
        return res.json({
            user: {
                userId: user.user_id,
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.email,
                role: user.role_name
            }
        });
    });

    async function requireAuthentication(req, res, next) {
        const token = req.cookies[SESSION_COOKIE];
        if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
            return res.status(401).json({ message: "Authentication is required." });
        }

        try {
            const result = await pool.query(
                `SELECT u.user_id, u.first_name, u.last_name, u.email,
                        r.role_name,
                        student.student_id,
                        admin.funding_unit_id,
                        coordinator.barangay_id AS coordinator_barangay_id,
                        registrar.school_id AS registrar_school_id
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
                   ON registrar.user_id = u.user_id AND registrar.is_active = TRUE
                 WHERE session.token_hash = $1
                   AND session.revoked_at IS NULL
                   AND session.expires_at > NOW()
                   AND u.is_active = TRUE
                 LIMIT 1`,
                [tokenHash(token)]
            );
            const row = result.rows[0];

            if (!row) {
                clearSessionCookie(res, secureCookies);
                return res.status(401).json({ message: "Authentication is required." });
            }

            let scopeId = null;
            if (row.role_name === "Scholar") scopeId = row.student_id;
            if (row.role_name === "LGU Admin") scopeId = row.funding_unit_id;
            if (row.role_name === "Barangay Coordinator") {
                scopeId = row.coordinator_barangay_id;
            }
            if (row.role_name === "Registrar") scopeId = row.registrar_school_id;

            if (!scopeId) {
                return res.status(403).json({
                    message: "This account does not have an active role assignment."
                });
            }

            req.auth = {
                userId: row.user_id,
                firstName: row.first_name,
                lastName: row.last_name,
                email: row.email,
                role: row.role_name,
                scopeId
            };
            return next();
        } catch (error) {
            return next(error);
        }
    }

    function requireRole(...roles) {
        return (req, res, next) => {
            if (!roles.includes(req.auth.role)) {
                return res.status(403).json({ message: "This account is not authorized for this resource." });
            }
            return next();
        };
    }

    app.post("/api/auth/logout", requireAuthentication, async (req, res) => {
        await pool.query(
            `UPDATE "Login_Sessions"
             SET revoked_at = NOW()
             WHERE token_hash = $1 AND revoked_at IS NULL`,
            [tokenHash(req.cookies[SESSION_COOKIE])]
        );
        clearSessionCookie(res, secureCookies);
        return res.json({ message: "Signed out." });
    });

    app.get("/api/auth/me", requireAuthentication, (req, res) => {
        res.json({
            user: {
                userId: req.auth.userId,
                firstName: req.auth.firstName,
                lastName: req.auth.lastName,
                email: req.auth.email,
                role: req.auth.role
            }
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
                [req.auth.userId]
            );
            if (result.rowCount === 0) {
                return res.status(404).json({ message: "Student profile not found." });
            }
            return res.json({ profile: result.rows[0] });
        }
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
                    [req.auth.userId, MAX_QUEUE_SIZE]
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
                    [req.auth.userId, MAX_QUEUE_SIZE]
                );
            return res.json({ applications: result.rows });
        }
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
                        message
                    }))
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
                    message: "Online applications are unavailable until the required funding and verification database schema is installed."
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
                    [req.auth.userId, req.auth.scopeId]
                );
                if (student.rowCount !== 1 || !student.rows[0].barangay_id) {
                    await client.query("ROLLBACK");
                    return res.status(403).json({
                        message: "An active student profile with a barangay is required to apply."
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
                    [input.data.programId, student.rows[0].barangay_id]
                );
                if (program.rowCount !== 1) {
                    await client.query("ROLLBACK");
                    return res.status(400).json({
                        message: "This program is not currently accepting applications for your barangay."
                    });
                }

                const existingApplication = await client.query(
                    `SELECT application_id
                     FROM "Applications"
                     WHERE student_id = $1
                       AND program_id = $2
                       AND application_status <> 'withdrawn'
                     LIMIT 1`,
                    [student.rows[0].student_id, input.data.programId]
                );
                if (existingApplication.rowCount > 0) {
                    await client.query("ROLLBACK");
                    return res.status(409).json({
                        message: "You already have an active application for this program."
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
                        student.rows[0].barangay_id
                    ]
                );
                await client.query(
                    `UPDATE "Applications"
                     SET application_status = 'submitted'
                     WHERE application_id = $1`,
                    [application.rows[0].application_id]
                );
                const submitted = await client.query(
                    `SELECT application.application_id,
                            application.application_status,
                            application.submitted_at
                     FROM "Applications" application
                     WHERE application.application_id = $1`,
                    [application.rows[0].application_id]
                );
                await client.query("COMMIT");
                return res.status(201).json({ application: submitted.rows[0] });
            } catch (error) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
                    logger.error("Application transaction rollback failed", {
                        code: rollbackError.code
                    });
                }
                if (error.code === "23505") {
                    return res.status(409).json({
                        message: "You already have an active application for this program."
                    });
                }
                return next(error);
            } finally {
                client.release();
            }
        }
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
                    [applicationId, req.auth.userId]
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
                    [applicationId, req.auth.userId]
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
                    [applicationId]
                )
                : { rows: [] };
            return res.json({
                application: result.rows[0],
                verifications: verifications.rows
            });
        }
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
                [applicationId, req.auth.userId]
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
                [applicationId, req.auth.userId]
            );
            return res.json({ documents: result.rows });
        }
    );

    const verificationRoles = [
        {
            path: "/api/coordinator/verifications",
            role: "Barangay Coordinator",
            verificationType: "barangay",
            scopeColumn: "application.barangay_id"
        },
        {
            path: "/api/registrar/verifications",
            role: "Registrar",
            verificationType: "registrar",
            scopeColumn: "student.school_id"
        },
        {
            path: "/api/admin/verifications",
            role: "LGU Admin",
            verificationType: "lgu",
            scopeColumn: "program.funding_unit_id"
        }
    ];

    for (const config of verificationRoles) {
        const { path, role, verificationType, scopeColumn } = config;
        const roleMiddleware = [
            requireAuthentication,
            requireRole(role)
        ];

        app.get(path, ...roleMiddleware, async (req, res) => {
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
                [verificationType, req.auth.scopeId, MAX_QUEUE_SIZE]
            );
            return res.json({ verifications: result.rows });
        });

        app.get(`${path}/:verificationId`, ...roleMiddleware, async (req, res) => {
            const verificationId = Number(req.params.verificationId);
            if (!Number.isSafeInteger(verificationId) || verificationId < 1) {
                return res.status(400).json({ message: "Verification ID is invalid." });
            }
            const result = await pool.query(
                `SELECT verification.verification_id, verification.application_id,
                        verification.verification_type, verification.status,
                        verification.activated_at, verification.reviewed_at,
                        application.application_status,
                        program.program_name,
                        student.student_id, student.student_number, student.course, student.year_level,
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
                [verificationId, verificationType, req.auth.scopeId]
            );
            if (result.rowCount === 0) {
                return res.status(404).json({ message: "Verification task not found." });
            }
            return res.json({ verification: result.rows[0] });
        });
    }

    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
            return res.status(400).json({ message: "Request body must be valid JSON." });
        }
        logger.error("Request failed", {
            method: req.method,
            path: req.path,
            code: error.code,
            name: error.name
        });
        return res.status(500).json({ message: "An internal error occurred." });
    });

    return app;
}

module.exports = {
    createApp,
    SESSION_COOKIE
};