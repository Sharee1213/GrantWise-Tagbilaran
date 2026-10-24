const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");
const { completeDeveloperBootstrap } = require("../scripts/bootstrap-developer");

function digest(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

test("developer bootstrap refuses to change an existing account", async () => {
    const verificationToken = "single-use-bootstrap-token";
    const statements = [];
    const client = {
        async query(statement) {
            statements.push(statement);
            if (statement === "BEGIN" || statement === "ROLLBACK") {
                return { rowCount: 0, rows: [] };
            }
            if (statement.includes('FROM "Email_Verification_Tokens"')) {
                return {
                    rowCount: 1,
                    rows: [{
                        verification_token_id: 1,
                        token_hash: digest(verificationToken),
                        expires_at: new Date(Date.now() + 60_000),
                        consumed_at: null
                    }]
                };
            }
            if (statement.includes('FROM "Users"')) {
                return { rowCount: 1, rows: [{ user_id: 10 }] };
            }
            throw new Error(`Unexpected query: ${statement}`);
        },
        release() {}
    };
    const pool = { async connect() { return client; } };

    await assert.rejects(
        completeDeveloperBootstrap({
            pool,
            email: "developer@example.edu",
            verificationToken,
            firstName: "Existing",
            lastName: "Developer",
            password: "a valid long passphrase",
            env: { INITIAL_DEVELOPER_ALLOWLIST: "developer@example.edu" }
        }),
        { code: "DEVELOPER_ACCOUNT_ALREADY_EXISTS" }
    );

    assert.equal(statements.includes("COMMIT"), false);
    assert.equal(statements.some((statement) => statement.includes('UPDATE "Users"')), false);
    assert.equal(statements.some((statement) => statement.includes('INSERT INTO "Users"')), false);
});

test("developer bootstrap rejects whitespace-only passwords", async () => {
    const pool = {
        async connect() {
            throw new Error("Password validation must happen before database access.");
        }
    };

    await assert.rejects(
        completeDeveloperBootstrap({
            pool,
            email: "developer@example.edu",
            verificationToken: "single-use-bootstrap-token",
            firstName: "Developer",
            lastName: "User",
            password: " ".repeat(12),
            env: { INITIAL_DEVELOPER_ALLOWLIST: "developer@example.edu" }
        }),
        { code: "INVALID_DEVELOPER_PASSWORD" }
    );
});
