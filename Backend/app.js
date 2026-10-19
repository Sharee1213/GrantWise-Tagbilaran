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
    firstName: z.string({ required_error: "First name is required." })
        .trim()
        .min(1, "First name is required.")
        .max(100, "First name must be 100 characters or fewer."),
    lastName: z.string({ required_error: "Last name is required." })
        .trim()
        .min(1, "Last name is required.")
        .max(100, "Last name must be 100 characters or fewer."),
    email: z.string({ required_error: "Email address is required." })
        .trim()
        .min(1, "Email address is required.")
        .email("Enter a valid email address.")
        .max(255, "Email address must be 255 characters or fewer.")
        .transform((value) => value.toLowerCase()),
    password: z.string({ required_error: "Password is required." })
        .min(12, "Password must be at least 12 characters long.")
        .max(128, "Password must be 128 characters or fewer.")
        .refine((value) => value.trim().length > 0, {
            message: "Password cannot contain only whitespace."
        }),
    phoneNumber: z.string()
        .trim()
        .max(30, "Phone number must be 30 characters or fewer.")
        .regex(/^[0-9+()\-\s]*$/, "Enter a valid phone number.")
        .optional()
        .nullable(),
    barangayId: z.number({ required_error: "Select your barangay." })
        .int("Select a valid barangay.")
        .positive("Select a valid barangay."),
    schoolId: z.number({ required_error: "Select your school." })
        .int("Select an approved school.")
        .positive("Select an approved school."),
    studentNumber: z.string({ required_error: "Student number is required." })
        .trim()
        .min(1, "Student number is required.")
        .max(50, "Student number must be 50 characters or fewer."),
    course: z.string({ required_error: "Course or degree program is required." })
        .trim()
        .min(1, "Course or degree program is required.")
        .max(100, "Course must be 100 characters or fewer."),
    yearLevel: z.string()
        .trim()
        .max(50, "Year level must be 50 characters or fewer.")
        .optional()
        .nullable()
}).strict();

const loginSchema = z.object({
    email: z.string({ required_error: "Email address is required." })
        .trim()
        .min(1, "Email address is required.")
        .email("Enter a valid email address.")
        .max(255, "Email address must be 255 characters or fewer.")
        .transform((value) => value.toLowerCase()),
    password: z.string({ required_error: "Password is required." })
        .min(1, "Password is required.")
        .max(128, "Password must be 128 characters or fewer.")
        .refine((value) => value.trim().length > 0, {
            message: "Password cannot contain only whitespace."
        })
}).strict();

const applicationSchema = z.object({
    programId: z.number().int().positive()
}).strict();

const verificationDecisionSchema = z.object({
    status: z.enum(["approved", "rejected", "needs_information", "pending"]),
    remarks: z.string().trim().max(2000).optional().nullable()
}).strict();

const applicationDecisionSchema = z.object({
    status: z.enum(["approved", "rejected", "needs_information"]),
    awardAmount: z.number().finite().positive().max(9999999999.99)
        .refine((value) => Number.isInteger(value * 100), "Use no more than two decimal places.")
        .optional(),
    remarks: z.string().trim().max(2000).optional().nullable()
}).strict().refine(
    (value) => value.status !== "approved" || value.awardAmount !== undefined,
    { message: "An award amount is required for approval.", path: ["awardAmount"] }
).refine(
    (value) => value.status === "approved" || value.awardAmount === undefined,
    { message: "An award amount is only valid when approving.", path: ["awardAmount"] }
);

const isoDateSchema = z.string().refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(date.valueOf()) &&
        date.toISOString().slice(0, 10) === value;
}, "Use a valid calendar date in YYYY-MM-DD format.");

const programCreateSchema = z.object({
    programName: z.string().trim().min(1).max(200),
    fundingCycleId: z.number().int().positive(),
    totalBudget: z.number().finite().positive().max(999999999999.99)
        .refine((value) => Number.isInteger(value * 100), "Use no more than two decimal places."),
    startDate: isoDateSchema.nullable().optional(),
    endDate: isoDateSchema.nullable().optional()
}).strict().refine(
    (value) => !value.startDate || !value.endDate || value.endDate >= value.startDate,
    { message: "End date must be on or after the start date.", path: ["endDate"] }
);

const allocationSchema = z.object({
    allocations: z.array(z.object({
        barangayId: z.number().int().positive(),
        allocatedAmount: z.number().finite().nonnegative().max(999999999999.99)
            .refine((value) => Number.isInteger(value * 100), "Use no more than two decimal places.")
    }).strict()).min(1).max(MAX_QUEUE_SIZE)
}).strict().refine(
    ({ allocations }) =>
        new Set(allocations.map(({ barangayId }) => barangayId)).size === allocations.length,
    { message: "Each barangay may be listed only once.", path: ["allocations"] }
);

const programUpdateSchema = z.object({
    programName: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["active", "inactive", "closed"]).optional(),
    startDate: isoDateSchema.nullable().optional(),
    endDate: isoDateSchema.nullable().optional()
}).strict().refine(
    (value) => Object.keys(value).length > 0,
    { message: "At least one permitted program field is required." }
).refine(
    (value) => !value.startDate || !value.endDate || value.endDate >= value.startDate,
    { message: "End date must be on or after the start date.", path: ["endDate"] }
);

const gradeReportSchema = z.object({
    schoolYear: z.string().trim().min(1).max(20),
    semester: z.string().trim().min(1).max(20),
    gpa: z.number().finite().min(0).max(99.99)
        .refine((value) => Number.isInteger(value * 100), "Use no more than two decimal places."),
    remarks: z.string().trim().max(2000).optional().nullable()
}).strict();

const eligibilityCheckSchema = z.object({
    checkType: z.string().trim().min(1).max(50),
    result: z.enum(["eligible", "ineligible", "pending"]),
    remarks: z.string().trim().max(2000).optional().nullable()
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
            ) AS has_staff_admin_workflow`
    );
    const capabilities = result.rows[0];
    return {
        relationalProgramSchema: capabilities.relational_program_schema,
        applicationWorkflowEnabled: capabilities.application_workflow_schema,
        hasVerificationTable: capabilities.has_verification_table,
        hasAdminFundingUnitAssignment: capabilities.has_admin_funding_unit_assignment,
        hasProgramBudgetBalances: capabilities.has_program_budget_balances,
        hasAwardApprovalFunction: capabilities.has_award_approval_function,
        hasStaffAdminWorkflow: capabilities.has_staff_admin_workflow,
        adminPortalEnabled:
            capabilities.relational_program_schema &&
            capabilities.application_workflow_schema &&
            capabilities.has_admin_funding_unit_assignment &&
            capabilities.has_program_budget_balances &&
            capabilities.has_award_approval_function &&
            capabilities.has_staff_admin_workflow,
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
                    const conflictErrors = [];
                    if (existingUser.rowCount > 0) {
                        conflictErrors.push({
                            field: "email",
                            message: "An account with this email address already exists."
                        });
                    }
                    if (existingStudent.rowCount > 0) {
                        conflictErrors.push({
                            field: "studentNumber",
                            message: "This student number is already registered."
                        });
                    }
                    return res.status(409).json({
                        message: "An account with this email or student number already exists.",
                        errors: conflictErrors
                    });
                }
                if (approvedSchool.rowCount === 0 || existingBarangay.rowCount === 0) {
                    await client.query("ROLLBACK");
                    const lookupErrors = [];
                    if (existingBarangay.rowCount === 0) {
                        lookupErrors.push({
                            field: "barangayId",
                            message: "Select a valid barangay."
                        });
                    }
                    if (approvedSchool.rowCount === 0) {
                        lookupErrors.push({
                            field: "schoolId",
                            message: "Select an approved school."
                        });
                    }
                    return res.status(400).json({
                        message: "Select a valid barangay and an approved school.",
                        errors: lookupErrors
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
            return res.status(400).json({
                message: "Email or password is invalid.",
                errors: input.error.issues.map(({ path, message }) => ({
                    field: path.join(".") || "form",
                    message
                }))
            });
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
            const capabilities = await getSchemaCapabilities(pool);
            const adminFundingUnit = capabilities.hasAdminFundingUnitAssignment
                ? "admin.funding_unit_id"
                : "NULL::INTEGER";
            const result = await pool.query(
                `SELECT u.user_id, u.first_name, u.last_name, u.email,
                        r.role_name,
                        student.student_id,
                        ${adminFundingUnit} AS funding_unit_id,
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
                if (
                    row.role_name === "LGU Admin" &&
                    !capabilities.hasAdminFundingUnitAssignment
                ) {
                    return res.status(503).json({
                        message: "The funding-unit assignment schema is not installed."
                    });
                }
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

    async function requireStaffSchema(res, { admin = false } = {}) {
        const capabilities = await getSchemaCapabilities(pool);
        const available = admin
            ? capabilities.adminPortalEnabled
            : capabilities.applicationWorkflowEnabled;
        if (!available) {
            res.status(503).json({
                message: admin
                    ? "The funding-unit assignment, budget, and verification workflow schema is not installed."
                    : "The application verification workflow schema is not installed."
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
            !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_QUEUE_SIZE ||
            !Number.isSafeInteger(offset) || offset < 0
        ) {
            res.status(400).json({ message: "Pagination values are outside the allowed range." });
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
        async (req, res) => {
            if (!await requireStaffSchema(res, { admin: true })) return;
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
                [req.auth.scopeId]
            );
            return res.json({ summary: result.rows[0] });
        }
    );

    app.get(
        "/api/admin/programs",
        requireAuthentication,
        requireRole("LGU Admin"),
        async (req, res) => {
            if (!await requireStaffSchema(res, { admin: true })) return;
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
                [req.auth.scopeId, page.limit, page.offset]
            );
            return res.json({ programs: result.rows, pagination: page });
        }
    );

    app.put(
        "/api/admin/programs/:programId/barangay-allocations",
        requireAuthentication,
        requireRole("LGU Admin"),
        async (req, res, next) => {
            if (!await requireStaffSchema(res, { admin: true })) return;
            const programId = parsePositiveId(req.params.programId, "Program ID", res);
            if (!programId) return;
            const input = allocationSchema.safeParse(req.body);
            if (!input.success) {
                return res.status(400).json({
                    message: "Barangay allocations are invalid.",
                    errors: input.error.issues.map(({ path, message }) => ({
                        field: path.join("."),
                        message
                    }))
                });
            }
            const barangayIds = input.data.allocations.map(({ barangayId }) => barangayId);
            const client = await pool.connect();
            try {
                await client.query("BEGIN");
                const scopedProgram = await client.query(
                    `SELECT program_id
                     FROM "Funding_Programs"
                     WHERE program_id = $1 AND funding_unit_id = $2`,
                    [programId, req.auth.scopeId]
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
                    [programId]
                );
                const program = await client.query(
                    `SELECT program_id, total_budget
                     FROM "Funding_Programs"
                     WHERE program_id = $1 AND funding_unit_id = $2
                     FOR UPDATE`,
                    [programId, req.auth.scopeId]
                );
                const requestedCents = input.data.allocations.reduce(
                    (total, allocation) => total + Math.round(allocation.allocatedAmount * 100),
                    0
                );
                if (requestedCents > Math.round(Number(program.rows[0].total_budget) * 100)) {
                    await client.query("ROLLBACK");
                    return res.status(400).json({
                        message: "Barangay allocations cannot exceed the program budget."
                    });
                }
                const knownBarangays = await client.query(
                    `SELECT barangay_id
                     FROM "Barangays"
                     WHERE barangay_id = ANY($1::INTEGER[])`,
                    [barangayIds]
                );
                if (knownBarangays.rowCount !== barangayIds.length) {
                    await client.query("ROLLBACK");
                    return res.status(400).json({
                        message: "One or more barangays do not exist."
                    });
                }
                await client.query(
                    `DELETE FROM "Program_Barangay_Allocations"
                     WHERE program_id = $1
                       AND NOT (barangay_id = ANY($2::INTEGER[]))`,
                    [programId, barangayIds]
                );
                for (const allocation of input.data.allocations) {
                    await client.query(
                        `INSERT INTO "Program_Barangay_Allocations" (
                            program_id, barangay_id, allocated_amount
                         ) VALUES ($1, $2, $3)
                         ON CONFLICT (program_id, barangay_id)
                         DO UPDATE SET allocated_amount = EXCLUDED.allocated_amount,
                                       updated_at = NOW()`,
                        [programId, allocation.barangayId, allocation.allocatedAmount]
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
                    [programId]
                );
                await client.query(
                    `INSERT INTO "Audit_Logs" (
                        user_id, action_type, entity_type, entity_id, details
                     ) VALUES ($1, 'program_barangay_allocations_updated',
                               'Funding_Programs', $2,
                               jsonb_build_object('allocation_count', $3))`,
                    [req.auth.userId, programId, allocations.rowCount]
                );
                await client.query("COMMIT");
                return res.json({ allocations: allocations.rows });
            } catch (error) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
                    logger.error("Program allocation rollback failed", {
                        code: rollbackError.code
                    });
                }
                if (["P0001", "23514"].includes(error.code)) {
                    return res.status(409).json({
                        message: "The allocations could not be saved because committed or released funding would be affected."
                    });
                }
                return next(error);
            } finally {
                client.release();
            }
        }
    );

    app.get(
        "/api/admin/programs/:programId",
        requireAuthentication,
        requireRole("LGU Admin"),
        async (req, res) => {
            if (!await requireStaffSchema(res, { admin: true })) return;
            const programId = parsePositiveId(req.params.programId, "Program ID", res);
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
                [programId, req.auth.scopeId]
            );
            if (result.rowCount === 0) {
                return res.status(404).json({ message: "Program not found." });
            }
            return res.json({ program: result.rows[0] });
        }
    );

    app.post(
        "/api/admin/programs",
        requireAuthentication,
        requireRole("LGU Admin"),
        async (req, res, next) => {
            if (!await requireStaffSchema(res, { admin: true })) return;
            const input = programCreateSchema.safeParse(req.body);
            if (!input.success) {
                return res.status(400).json({
                    message: "Program details are invalid.",
                    errors: input.error.issues.map(({ path, message }) => ({
                        field: path.join("."),
                        message
                    }))
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
                    [input.data.fundingCycleId]
                );
                if (cycle.rowCount === 0) {
                    await client.query("ROLLBACK");
                    return res.status(400).json({
                        message: "Choose an active funding cycle."
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
                        input.data.endDate || null
                    ]
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
                        input.data.fundingCycleId
                    ]
                );
                await client.query("COMMIT");
                return res.status(201).json({ program: result.rows[0] });
            } catch (error) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
                    logger.error("Program creation rollback failed", {
                        code: rollbackError.code
                    });
                }
                if (error.code === "23514") {
                    return res.status(400).json({
                        message: "Program dates or budget do not satisfy database constraints."
                    });
                }
                return next(error);
            } finally {
                client.release();
            }
        }
    );

    app.get(
        "/api/admin/funding-cycles",
        requireAuthentication,
        requireRole("LGU Admin"),
        async (req, res) => {
            if (!await requireStaffSchema(res, { admin: true })) return;
            const result = await pool.query(
                `SELECT funding_cycle_id, cycle_code, start_date, end_date
                 FROM "Funding_Cycles"
                 WHERE status = 'active'
                   AND (start_date IS NULL OR start_date <= CURRENT_DATE)
                   AND (end_date IS NULL OR end_date >= CURRENT_DATE)
                 ORDER BY start_date DESC NULLS LAST, cycle_code DESC
                 LIMIT $1`,
                [MAX_QUEUE_SIZE]
            );
            return res.json({ fundingCycles: result.rows });
        }
    );

    app.patch(
        "/api/admin/programs/:programId",
        requireAuthentication,
        requireRole("LGU Admin"),
        async (req, res, next) => {
            if (!await requireStaffSchema(res, { admin: true })) return;
            const programId = parsePositiveId(req.params.programId, "Program ID", res);
            if (!programId) return;
            const input = programUpdateSchema.safeParse(req.body);
            if (!input.success) {
                return res.status(400).json({
                    message: "Program updates are invalid.",
                    errors: input.error.issues.map(({ path, message }) => ({
                        field: path.join("."),
                        message
                    }))
                });
            }
            const fields = {
                programName: "program_name",
                status: "status",
                startDate: "start_date",
                endDate: "end_date"
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
                    values
                );
            } catch (error) {
                if (error.code === "23514") {
                    return res.status(400).json({
                        message: "Program dates or status do not satisfy database constraints."
                    });
                }
                return next(error);
            }
            if (result.rowCount === 0) {
                return res.status(404).json({ message: "Program not found." });
            }
            return res.json({ program: result.rows[0] });
        }
    );

    app.get(
        "/api/admin/applications",
        requireAuthentication,
        requireRole("LGU Admin"),
        async (req, res) => {
            if (!await requireStaffSchema(res, { admin: true })) return;
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
                [req.auth.scopeId, page.limit, page.offset]
            );
            return res.json({ applications: result.rows, pagination: page });
        }
    );

    app.get(
        "/api/admin/applications/:applicationId",
        requireAuthentication,
        requireRole("LGU Admin"),
        async (req, res) => {
            if (!await requireStaffSchema(res, { admin: true })) return;
            const applicationId = parsePositiveId(
                req.params.applicationId,
                "Application ID",
                res
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
                [applicationId, req.auth.scopeId]
            );
            if (result.rowCount === 0) {
                return res.status(404).json({ message: "Application not found." });
            }
            const verifications = await pool.query(
                `SELECT verification_type, status, remarks, activated_at, reviewed_at
                 FROM "Application_Verifications"
                 WHERE application_id = $1
                 ORDER BY activated_at`,
                [applicationId]
            );
            return res.json({
                application: result.rows[0],
                verifications: verifications.rows
            });
        }
    );

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

        if (role !== "LGU Admin") {
            app.get(`${path.replace("/verifications", "")}/dashboard`,
                ...roleMiddleware,
                async (req, res) => {
                    if (!await requireStaffSchema(res)) return;
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
                        [verificationType, req.auth.scopeId]
                    );
                    return res.json({ summary: result.rows[0] });
                }
            );
        }

        app.get(path, ...roleMiddleware, async (req, res) => {
            if (!await requireStaffSchema(res, { admin: role === "LGU Admin" })) return;
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
            if (!await requireStaffSchema(res, { admin: role === "LGU Admin" })) return;
            const verificationId = parsePositiveId(
                req.params.verificationId,
                "Verification ID",
                res
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
                [verificationId, verificationType, req.auth.scopeId]
            );
            if (result.rowCount === 0) {
                return res.status(404).json({ message: "Verification task not found." });
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
                    [result.rows[0].application_id, req.auth.scopeId, MAX_QUEUE_SIZE]
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
                    [result.rows[0].application_id, req.auth.scopeId, MAX_QUEUE_SIZE]
                );
                response.academicRecords = {
                    gradeReports: academicRecords.rows,
                    eligibilityChecks: eligibilityChecks.rows
                };
            }
            return res.json(response);
        });

        app.patch(
            `${path}/:verificationId`,
            ...roleMiddleware,
            async (req, res, next) => {
                const isAdmin = role === "LGU Admin";
                if (!await requireStaffSchema(res, { admin: isAdmin })) return;
                const verificationId = parsePositiveId(
                    req.params.verificationId,
                    "Verification ID",
                    res
                );
                if (!verificationId) return;
                const input = (isAdmin
                    ? applicationDecisionSchema
                    : verificationDecisionSchema).safeParse(req.body);
                if (!input.success) {
                    return res.status(400).json({
                        message: "Verification decision is invalid.",
                        errors: input.error.issues.map(({ path, message }) => ({
                            field: path.join("."),
                            message
                        }))
                    });
                }

                const expectedApplicationStatus = {
                    barangay: "barangay_verification",
                    registrar: "registrar_verification",
                    lgu: "lgu_review"
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
                        [verificationId, verificationType, req.auth.scopeId]
                    );
                    if (current.rowCount === 0) {
                        await client.query("ROLLBACK");
                        return res.status(404).json({
                            message: "Verification task not found."
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
                            message: "This verification is not in a state that allows the requested decision."
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
                            verificationId
                        ]
                    );
                    let award = null;
                    if (isAdmin && input.data.status === "approved") {
                        const insertedAward = await client.query(
                            `INSERT INTO "Scholarship_Awards" (
                                application_id, program_id, award_amount,
                                award_status, award_date
                             ) VALUES ($1, $2, $3, 'pending', CURRENT_DATE)
                             RETURNING award_id, award_amount`,
                            [
                                task.application_id,
                                task.program_id,
                                input.data.awardAmount
                            ]
                        );
                        await client.query(
                            "SELECT approve_award($1, $2)",
                            [insertedAward.rows[0].award_id, req.auth.userId]
                        );
                        award = {
                            award_id: insertedAward.rows[0].award_id,
                            award_amount: insertedAward.rows[0].award_amount,
                            award_status: "approved"
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
                            isAdmin ? "lgu_application_reviewed" : "staff_verification_recorded",
                            verificationId,
                            verificationType,
                            input.data.status
                        ]
                    );
                    await client.query("COMMIT");
                    return res.json({ verification: updated.rows[0], award });
                } catch (error) {
                    try {
                        await client.query("ROLLBACK");
                    } catch (rollbackError) {
                        logger.error("Verification decision rollback failed", {
                            code: rollbackError.code
                        });
                    }
                    if (isAdmin && ["P0001", "23505", "23514"].includes(error.code)) {
                        return res.status(409).json({
                            message: "The award could not be approved because workflow, eligibility, duplicate-funding, or budget requirements were not met."
                        });
                    }
                    if (["P0001", "23514"].includes(error.code)) {
                        return res.status(409).json({
                            message: "The requested verification status transition is not allowed."
                        });
                    }
                    return next(error);
                } finally {
                    client.release();
                }
            }
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
                            data.remarks || null
                        ];
                    },
                    responseKey: "gradeReport",
                    auditAction: "registrar_grade_report_recorded"
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
                            data.remarks || null
                        ];
                    },
                    responseKey: "eligibilityCheck",
                    auditAction: "registrar_eligibility_check_recorded"
                }
            ];

            for (const recordRoute of academicRecordRoutes) {
                app.post(
                    recordRoute.path,
                    ...roleMiddleware,
                    async (req, res, next) => {
                        if (!await requireStaffSchema(res)) return;
                        const applicationId = parsePositiveId(
                            req.params.applicationId,
                            "Application ID",
                            res
                        );
                        if (!applicationId) return;
                        const input = recordRoute.schema.safeParse(req.body);
                        if (!input.success) {
                            return res.status(400).json({
                                message: "Academic verification details are invalid.",
                                errors: input.error.issues.map(({ path, message }) => ({
                                    field: path.join("."),
                                    message
                                }))
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
                                [applicationId, req.auth.userId, req.auth.scopeId]
                            );
                            if (assignment.rowCount === 0) {
                                await client.query("ROLLBACK");
                                return res.status(404).json({
                                    message: "Application not found in your school's active verification queue."
                                });
                            }
                            const result = await client.query(
                                recordRoute.insertSql,
                                recordRoute.values(input.data, assignment.rows[0])
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
                                    req.auth.scopeId
                                ]
                            );
                            await client.query("COMMIT");
                            return res.status(201).json({
                                [recordRoute.responseKey]: result.rows[0]
                            });
                        } catch (error) {
                            try {
                                await client.query("ROLLBACK");
                            } catch (rollbackError) {
                                logger.error("Academic record rollback failed", {
                                    code: rollbackError.code
                                });
                            }
                            return next(error);
                        } finally {
                            client.release();
                        }
                    }
                );
            }
        }
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