const argon2 = require("argon2");
const crypto = require("node:crypto");
const readline = require("node:readline");
const defaultPool = require("../db");

const DEFAULT_DEVELOPER_ALLOWLIST = Object.freeze([
    "cuevas.sharee_angela@hnu.edu.ph",
    "medrina.nina_marie@hnu.edu.ph",
    "palaca.szarina@hnu.edu.ph"
]);
function normalizeEmail(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function hashToken(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function getAllowedDeveloperEmails(env = process.env) {
    const raw = env.INITIAL_DEVELOPER_ALLOWLIST || env.AUTHORIZED_DEVELOPER_EMAILS;
    if (!raw || typeof raw !== "string" || !raw.trim()) {
        return new Set(DEFAULT_DEVELOPER_ALLOWLIST);
    }
    return new Set(
        raw
            .split(",")
            .map((entry) => normalizeEmail(entry))
            .filter(Boolean)
    );
}

async function initiateDeveloperBootstrap({
    pool = defaultPool,
    email,
    initiatedBy = "cli_operator",
    env = process.env
}) {
    const normalizedEmail = normalizeEmail(email);
    const allowlist = getAllowedDeveloperEmails(env);
    if (!normalizedEmail || !allowlist.has(normalizedEmail)) {
        const error = new Error(
            "Email is not in the configured developer allowlist (INITIAL_DEVELOPER_ALLOWLIST)."
        );
        error.code = "DEVELOPER_EMAIL_NOT_ALLOWLISTED";
        throw error;
    }

    const verificationToken = crypto.randomBytes(32).toString("base64url");
    const tokenDigest = hashToken(verificationToken);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        await client.query(
            `INSERT INTO "Roles" (role_name, description)
             VALUES ('System Admin', 'Developer or explicitly authorized system administrator for staff access and domain management')
             ON CONFLICT (role_name) DO NOTHING`
        );

        await client.query(
            `UPDATE "Email_Verification_Tokens"
             SET consumed_at = NOW()
             WHERE LOWER(BTRIM(email)) = $1
               AND purpose = 'developer_bootstrap'
               AND consumed_at IS NULL`,
            [normalizedEmail]
        );

        const inserted = await client.query(
            `INSERT INTO "Email_Verification_Tokens" (
                email, purpose, token_hash, expires_at
             ) VALUES ($1, 'developer_bootstrap', $2, NOW() + INTERVAL '30 minutes')
             RETURNING verification_token_id, expires_at`,
            [normalizedEmail, tokenDigest]
        );

        await client.query(
            `INSERT INTO "Audit_Logs" (
                user_id, action_type, entity_type, entity_id, details
             ) VALUES (
                NULL,
                'developer_bootstrap_initiated',
                'Email_Verification_Tokens',
                $1,
                jsonb_build_object(
                    'email', $2::TEXT,
                    'initiated_by', $3::TEXT
                )
             )`,
            [inserted.rows[0].verification_token_id, normalizedEmail, initiatedBy]
        );

        await client.query("COMMIT");
        return {
            email: normalizedEmail,
            verificationToken,
            expiresAt: inserted.rows[0].expires_at
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function completeDeveloperBootstrap({
    pool = defaultPool,
    email,
    verificationToken,
    firstName,
    lastName,
    password,
    phoneNumber = null,
    grantedByDescription = "authorized_cli_bootstrap",
    env = process.env
}) {
    const normalizedEmail = normalizeEmail(email);
    const allowlist = getAllowedDeveloperEmails(env);
    if (!normalizedEmail || !allowlist.has(normalizedEmail)) {
        const error = new Error(
            "Email is not in the configured developer allowlist."
        );
        error.code = "DEVELOPER_EMAIL_NOT_ALLOWLISTED";
        throw error;
    }

    if (!verificationToken || typeof verificationToken !== "string" || verificationToken.trim().length < 16) {
        const error = new Error("A valid developer bootstrap verification token is required.");
        error.code = "INVALID_BOOTSTRAP_TOKEN";
        throw error;
    }

    const cleanFirstName = typeof firstName === "string" ? firstName.trim() : "";
    const cleanLastName = typeof lastName === "string" ? lastName.trim() : "";
    if (!cleanFirstName || !cleanLastName) {
        const error = new Error("First name and last name are required.");
        error.code = "INVALID_DEVELOPER_PROFILE";
        throw error;
    }

    if (typeof password !== "string" || password.trim().length === 0 || password.length < 12 || password.length > 128) {
        const error = new Error("Developer password must be between 12 and 128 characters.");
        error.code = "INVALID_DEVELOPER_PASSWORD";
        throw error;
    }

    const submittedDigest = hashToken(verificationToken.trim());
    const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1
    });

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const tokenRes = await client.query(
            `SELECT verification_token_id, token_hash, expires_at, consumed_at
             FROM "Email_Verification_Tokens"
             WHERE LOWER(BTRIM(email)) = $1
               AND purpose = 'developer_bootstrap'
               AND consumed_at IS NULL
               AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1
             FOR UPDATE`,
            [normalizedEmail]
        );

        if (tokenRes.rowCount === 0) {
            await client.query("ROLLBACK");
            const error = new Error("Bootstrap verification token is invalid, expired, or already used.");
            error.code = "INVALID_BOOTSTRAP_TOKEN";
            throw error;
        }

        const expectedBuffer = Buffer.from(tokenRes.rows[0].token_hash, "hex");
        const submittedBuffer = Buffer.from(submittedDigest, "hex");
        if (
            expectedBuffer.length !== submittedBuffer.length ||
            !crypto.timingSafeEqual(expectedBuffer, submittedBuffer)
        ) {
            await client.query("ROLLBACK");
            const error = new Error("Bootstrap verification token is invalid, expired, or already used.");
            error.code = "INVALID_BOOTSTRAP_TOKEN";
            throw error;
        }

        await client.query(
            `UPDATE "Email_Verification_Tokens"
             SET consumed_at = NOW()
             WHERE verification_token_id = $1`,
            [tokenRes.rows[0].verification_token_id]
        );

        const roleRes = await client.query(
            `SELECT role_id FROM "Roles" WHERE role_name = 'System Admin' LIMIT 1`
        );
        if (roleRes.rowCount === 0) {
            throw new Error("The System Admin role is not installed. Run the database migration first.");
        }
        const systemAdminRoleId = roleRes.rows[0].role_id;

        const userRes = await client.query(
            `INSERT INTO "Users" (
                role_id, first_name, last_name, email, password_hash,
                phone_number, email_verified_at, is_active
             ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), TRUE)
             ON CONFLICT (email) DO UPDATE
             SET role_id = EXCLUDED.role_id,
                 first_name = EXCLUDED.first_name,
                 last_name = EXCLUDED.last_name,
                 password_hash = EXCLUDED.password_hash,
                 phone_number = COALESCE(EXCLUDED.phone_number, "Users".phone_number),
                 email_verified_at = NOW(),
                 is_active = TRUE,
                 updated_at = NOW()
             RETURNING user_id, email`,
            [
                systemAdminRoleId,
                cleanFirstName,
                cleanLastName,
                normalizedEmail,
                passwordHash,
                phoneNumber ? phoneNumber.trim() : null
            ]
        );

        const userId = userRes.rows[0].user_id;

        await client.query(
            `INSERT INTO "Audit_Logs" (
                user_id, action_type, entity_type, entity_id, details
             ) VALUES (
                $1,
                'developer_account_bootstrapped',
                'Users',
                $1,
                jsonb_build_object(
                    'email', $2::TEXT,
                    'role', 'System Admin',
                    'granted_by', $3::TEXT,
                    'email_verified', TRUE
                )
             )`,
            [userId, normalizedEmail, grantedByDescription]
        );

        await client.query("COMMIT");
        return {
            userId,
            email: normalizedEmail,
            role: "System Admin"
        };
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch {
            // ignore rollback error
        }
        throw error;
    } finally {
        client.release();
    }
}

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--init") args.mode = "init";
        else if (arg === "--complete") args.mode = "complete";
        else if (arg === "--email") args.email = argv[++i];
        else if (arg === "--token") args.token = argv[++i];
        else if (arg === "--first-name") args.firstName = argv[++i];
        else if (arg === "--last-name") args.lastName = argv[++i];
        else if (arg === "--phone") args.phone = argv[++i];
    }
    return args;
}

function promptHiddenPassword(promptText) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(promptText, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

if (require.main === module) {
    (async () => {
        const args = parseArgs(process.argv.slice(2));
        try {
            if (args.mode === "init") {
                const res = await initiateDeveloperBootstrap({
                    email: args.email
                });
                console.log("Developer bootstrap initiated for:", res.email);
                console.log("Single-use verification token (valid 30 minutes):", res.verificationToken);
                console.log("Deliver this token to the developer mailbox owner to verify ownership, then run --complete.");
            } else if (args.mode === "complete") {
                const password =
                    process.env.BOOTSTRAP_DEVELOPER_PASSWORD ||
                    (await promptHiddenPassword("Enter developer password (min 12 chars): "));
                const res = await completeDeveloperBootstrap({
                    email: args.email,
                    verificationToken: args.token,
                    firstName: args.firstName,
                    lastName: args.lastName,
                    phoneNumber: args.phone,
                    password
                });
                console.log("Developer account verified and activated:", res);
            } else {
                console.error(
                    "Usage:\n" +
                    "  Step 1: node scripts/bootstrap-developer.js --init --email <allowlisted-email>\n" +
                    "  Step 2: node scripts/bootstrap-developer.js --complete --email <allowlisted-email> --token <token> --first-name <firstName> --last-name <lastName>"
                );
                process.exitCode = 1;
            }
        } catch (error) {
            console.error("Developer bootstrap error:", error.message);
            process.exitCode = 1;
        } finally {
            await defaultPool.end();
        }
    })();
}

module.exports = {
    DEFAULT_DEVELOPER_ALLOWLIST,
    getAllowedDeveloperEmails,
    initiateDeveloperBootstrap,
    completeDeveloperBootstrap
};
