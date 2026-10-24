const argon2 = require("argon2");
const fs = require("fs");
const path = require("path");
const pool = require("./db");

const { STAFF_ACCOUNTS } = require("./staff-accounts");
const { STAFF_SEED_PASSWORDS } = require("./staff-seed-credentials");

// Shared demo password was removed: each whitelisted staff account has its own
// password (staff-seed-credentials.js). Kept as an export for compatibility.
const DEMO_DEFAULT_PASSWORD = "";

const STAFF_ROLE_NAMES = [
  "System Admin",
  "LGU Admin",
  "Barangay Coordinator",
  "Registrar",
];
const LEGACY_DEMO_SCHOLAR_EMAIL = "scholar.demo@grantwise.local";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const SEED_PROGRAMS = [
  {
    programName: "Tagbilaran City Merit & Academic Excellence Scholarship",
    unitName: "City Scholarship Office",
    cycleCode: "2026-2027",
    totalBudget: 4500000,
    perBarangayBudget: 250000,
    startDate: "2026-06-01",
    endDate: "2027-03-31",
  },
  {
    programName: "Tagbilaran Tertiary Educational Assistance Grant",
    unitName: "City Scholarship Office",
    cycleCode: "2026-2027",
    totalBudget: 6000000,
    perBarangayBudget: 350000,
    startDate: "2026-06-01",
    endDate: "2027-05-31",
  },
  {
    programName: "Sangguniang Panlungsod Youth Leadership & Study Grant",
    unitName: "Sangguniang Panlungsod / District Fund",
    cycleCode: "2026-2027",
    totalBudget: 3000000,
    perBarangayBudget: 180000,
    startDate: "2026-07-01",
    endDate: "2027-04-30",
  },
  {
    programName: "Barangay Community Scholars Support Program",
    unitName: "Barangay Educational Assistance Programs",
    cycleCode: "2026-2027",
    totalBudget: 2250000,
    perBarangayBudget: 150000,
    startDate: "2026-06-15",
    endDate: "2027-05-15",
  },
];

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

async function seedOperationalData(dbPool = pool) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO "Funding_Cycles" (cycle_code, start_date, end_date, status)
             VALUES ('2026-2027', '2026-06-01', '2027-05-31', 'active')
             ON CONFLICT (cycle_code) DO UPDATE
             SET status = 'active',
                 start_date = COALESCE("Funding_Cycles".start_date, EXCLUDED.start_date),
                 end_date = COALESCE("Funding_Cycles".end_date, EXCLUDED.end_date)`,
    );

    const cyclesRes = await client.query(
      'SELECT funding_cycle_id, cycle_code FROM "Funding_Cycles"',
    );
    const cycleMap = new Map(
      cyclesRes.rows.map((row) => [row.cycle_code, row.funding_cycle_id]),
    );

    const unitsRes = await client.query(
      'SELECT funding_unit_id, funding_unit_name FROM "Funding_Units"',
    );
    const unitMap = new Map(
      unitsRes.rows.map((row) => [row.funding_unit_name, row.funding_unit_id]),
    );

    const barangaysRes = await client.query(
      'SELECT barangay_id, barangay_name FROM "Barangays" ORDER BY barangay_id',
    );
    const schoolsRes = await client.query(
      'SELECT school_id, school_name FROM "Schools" WHERE is_approved = TRUE ORDER BY school_id',
    );
    const rolesRes = await client.query(
      'SELECT role_id, role_name FROM "Roles"',
    );
    const roleMap = new Map(
      rolesRes.rows.map((row) => [row.role_name, row.role_id]),
    );

    for (const spec of SEED_PROGRAMS) {
      const unitId = unitMap.get(spec.unitName);
      const cycleId = cycleMap.get(spec.cycleCode);
      if (!unitId || !cycleId) continue;

      const existingProg = await client.query(
        `SELECT program_id
                 FROM "Funding_Programs"
                 WHERE program_name = $1`,
        [spec.programName],
      );

      let programId;
      if (existingProg.rowCount === 0) {
        const insertedProg = await client.query(
          `INSERT INTO "Funding_Programs" (
                        program_name, funding_cycle, funding_unit_id, funding_cycle_id,
                        total_budget, remaining_budget, reserved_budget, released_budget,
                        status, start_date, end_date
                     ) VALUES ($1, $2, $3, $4, $5, $5, 0, 0, 'active', $6, $7)
                     RETURNING program_id`,
          [
            spec.programName,
            spec.cycleCode,
            unitId,
            cycleId,
            spec.totalBudget,
            spec.startDate,
            spec.endDate,
          ],
        );
        programId = insertedProg.rows[0].program_id;
      } else {
        programId = existingProg.rows[0].program_id;
        await client.query(
          `UPDATE "Funding_Programs"
                     SET funding_unit_id = COALESCE(funding_unit_id, $2),
                         funding_cycle_id = COALESCE(funding_cycle_id, $3),
                         funding_cycle = COALESCE(funding_cycle, $4),
                         total_budget = GREATEST(total_budget, $6::numeric),
                         remaining_budget = GREATEST(total_budget, $6::numeric) - reserved_budget - released_budget,
                         status = 'active',
                         end_date = GREATEST(COALESCE(end_date, $5::date), $5::date)
                     WHERE program_id = $1`,
          [
            programId,
            unitId,
            cycleId,
            spec.cycleCode,
            spec.endDate,
            spec.totalBudget,
          ],
        );
      }

      const existingAllocSum = await client.query(
        `SELECT COALESCE(SUM(allocated_amount), 0)::numeric AS total_allocated
                 FROM "Program_Barangay_Allocations"
                 WHERE program_id = $1`,
        [programId],
      );
      let runningAllocated = Number(
        existingAllocSum.rows[0]?.total_allocated || 0,
      );
      const safePerBarangayBudget = Math.min(
        spec.perBarangayBudget,
        Math.floor(spec.totalBudget / Math.max(1, barangaysRes.rows.length)),
      );

      for (const barangay of barangaysRes.rows) {
        if (runningAllocated + safePerBarangayBudget > spec.totalBudget) {
          break;
        }
        const insertedAlloc = await client.query(
          `INSERT INTO "Program_Barangay_Allocations" (
                        program_id, barangay_id, allocated_amount, reserved_amount, released_amount
                     ) VALUES ($1, $2, $3, 0, 0)
                     ON CONFLICT (program_id, barangay_id) DO NOTHING
                     RETURNING allocation_id`,
          [programId, barangay.barangay_id, safePerBarangayBudget],
        );
        if (insertedAlloc.rowCount > 0) {
          runningAllocated += safePerBarangayBudget;
        }
      }
    }

    // ---- Staff accounts: ONLY the whitelist in staff-accounts.js exists ----
    const whitelist = STAFF_ACCOUNTS.map((account) =>
      account.email.toLowerCase(),
    );

    // 1. Drop authorizations for any email that is not whitelisted.
    await client.query(
      `DELETE FROM "Staff_Email_Authorizations"
             WHERE LOWER(BTRIM(email)) <> ALL($1::text[])`,
      [whitelist],
    );

    // 2. Remove every other staff user (and the legacy demo scholar).
    const strayUsers = await client.query(
      `SELECT u.user_id, u.email
             FROM "Users" u
             JOIN "Roles" r ON r.role_id = u.role_id
             WHERE (r.role_name = ANY($1::text[]) AND LOWER(BTRIM(u.email)) <> ALL($2::text[]))
                OR LOWER(BTRIM(u.email)) = $3`,
      [STAFF_ROLE_NAMES, whitelist, LEGACY_DEMO_SCHOLAR_EMAIL],
    );
    let removed = 0;
    let deactivated = 0;
    for (const stray of strayUsers.rows) {
      await client.query("SAVEPOINT remove_user");
      try {
        await client.query('DELETE FROM "Users" WHERE user_id = $1', [
          stray.user_id,
        ]);
        await client.query("RELEASE SAVEPOINT remove_user");
        removed += 1;
      } catch (error) {
        // Still referenced by other records: cannot be erased, so lock it out.
        await client.query("ROLLBACK TO SAVEPOINT remove_user");
        await client.query(
          'UPDATE "Users" SET is_active = FALSE WHERE user_id = $1',
          [stray.user_id],
        );
        await client.query('DELETE FROM "Login_Sessions" WHERE user_id = $1', [
          stray.user_id,
        ]);
        await client.query(
          'UPDATE "LGU_Admins" SET is_active = FALSE WHERE user_id = $1',
          [stray.user_id],
        );
        await client.query(
          'UPDATE "Registrars" SET is_active = FALSE WHERE user_id = $1',
          [stray.user_id],
        );
        await client.query(
          'UPDATE "Barangay_Coordinators" SET is_current = FALSE WHERE user_id = $1',
          [stray.user_id],
        );
        await client.query(
          'UPDATE "Students" SET is_active = FALSE WHERE user_id = $1',
          [stray.user_id],
        );
        deactivated += 1;
      }
    }
    if (removed || deactivated) {
      console.log(
        `Removed ${removed} and deactivated ${deactivated} non-whitelisted account(s).`,
      );
    }

    // 3. Create / refresh the whitelisted accounts.
    const schoolsAll = await client.query(
      'SELECT school_id, school_name FROM "Schools"',
    );
    const schoolMap = new Map(
      schoolsAll.rows.map((row) => [row.school_name, row.school_id]),
    );
    const barangayMap = new Map(
      barangaysRes.rows.map((row) => [row.barangay_name, row.barangay_id]),
    );

    for (const account of STAFF_ACCOUNTS) {
      const roleId = roleMap.get(account.role);
      const plainPassword = STAFF_SEED_PASSWORDS[account.email];
      if (!roleId) throw new Error(`Role "${account.role}" is not configured.`);
      if (!plainPassword)
        throw new Error(`No seed password configured for ${account.email}.`);

      let scopeId = null;
      if (account.role === "LGU Admin")
        scopeId = unitMap.get(account.scope.name);
      if (account.role === "Barangay Coordinator")
        scopeId = barangayMap.get(account.scope.name);
      if (account.role === "Registrar")
        scopeId = schoolMap.get(account.scope.name);
      if (account.role !== "System Admin" && !scopeId) {
        throw new Error(
          `Scope "${account.scope.name}" not found for ${account.email}.`,
        );
      }

      const passwordHash = await argon2.hash(plainPassword, ARGON2_OPTIONS);
      const barangayForUser =
        account.role === "Barangay Coordinator" ? scopeId : null;

      const userRes = await client.query(
        `INSERT INTO "Users" (
                    role_id, barangay_id, first_name, last_name, email, password_hash, email_verified_at, is_active
                 ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), TRUE)
                 ON CONFLICT (email) DO UPDATE
                 SET role_id = EXCLUDED.role_id,
                     barangay_id = EXCLUDED.barangay_id,
                     first_name = EXCLUDED.first_name,
                     last_name = EXCLUDED.last_name,
                     password_hash = EXCLUDED.password_hash,
                     email_verified_at = COALESCE("Users".email_verified_at, NOW()),
                     is_active = TRUE
                 RETURNING user_id`,
        [
          roleId,
          barangayForUser,
          account.firstName,
          account.lastName,
          account.email,
          passwordHash,
        ],
      );
      const userId = userRes.rows[0].user_id;

      if (account.role === "LGU Admin") {
        await client.query(
          `INSERT INTO "LGU_Admins" (user_id, funding_unit_id, position_title, is_active)
                     VALUES ($1, $2, $3, TRUE)
                     ON CONFLICT (user_id) DO UPDATE
                     SET funding_unit_id = EXCLUDED.funding_unit_id,
                         position_title = EXCLUDED.position_title,
                         is_active = TRUE`,
          [userId, scopeId, account.positionTitle],
        );
      } else if (account.role === "Barangay Coordinator") {
        await client.query(
          `UPDATE "Barangay_Coordinators" SET is_current = FALSE
                     WHERE barangay_id = $1 AND user_id <> $2 AND is_current = TRUE`,
          [scopeId, userId],
        );
        await client.query(
          `INSERT INTO "Barangay_Coordinators" (user_id, barangay_id, position_title, term_start, is_current)
                     VALUES ($1, $2, $3, '2025-01-01', TRUE)
                     ON CONFLICT (user_id) DO UPDATE
                     SET barangay_id = EXCLUDED.barangay_id,
                         position_title = EXCLUDED.position_title,
                         term_end = NULL,
                         is_current = TRUE`,
          [userId, scopeId, account.positionTitle],
        );
      } else if (account.role === "Registrar") {
        await client.query(
          `INSERT INTO "Registrars" (user_id, school_id, position_title, is_active)
                     VALUES ($1, $2, $3, TRUE)
                     ON CONFLICT (user_id) DO UPDATE
                     SET school_id = EXCLUDED.school_id,
                         position_title = EXCLUDED.position_title,
                         is_active = TRUE`,
          [userId, scopeId, account.positionTitle],
        );
      }

      // System Admins are not stored in Staff_Email_Authorizations (its role check excludes them).
      if (account.role !== "System Admin") {
        const scopeColumn =
          account.role === "LGU Admin"
            ? "funding_unit_id"
            : account.role === "Barangay Coordinator"
              ? "barangay_id"
              : "school_id";
        await client.query(
          'DELETE FROM "Staff_Email_Authorizations" WHERE LOWER(BTRIM(email)) = $1',
          [account.email.toLowerCase()],
        );
        await client.query(
          `INSERT INTO "Staff_Email_Authorizations" (
                        email, role_name, ${scopeColumn}, position_title, status,
                        activated_at, activated_user_id, notes
                     ) VALUES ($1, $2, $3, $4, 'active', NOW(), $5, 'whitelisted_staff_account')`,
          [account.email, account.role, scopeId, account.positionTitle, userId],
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function initDatabase() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");

  await pool.query(schemaSql);
  await seedOperationalData(pool);
  console.log(
    "GrantWise database schema and operational seed data initialized successfully.",
  );
  return true;
}

if (require.main === module) {
  initDatabase()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Database initialization failed:", error);
      process.exit(1);
    });
}

module.exports = {
  initDatabase,
  seedOperationalData,
  DEMO_DEFAULT_PASSWORD,
};
