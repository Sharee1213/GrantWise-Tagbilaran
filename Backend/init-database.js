const argon2 = require("argon2");
const fs = require("fs");
const path = require("path");
const pool = require("./db");

const DEMO_DEFAULT_PASSWORD = "GrantWise#2026!";

const SEED_PROGRAMS = [
    {
        programName: "Tagbilaran City Merit & Academic Excellence Scholarship",
        unitName: "City Scholarship Office",
        cycleCode: "2026-2027",
        totalBudget: 4500000,
        perBarangayBudget: 250000,
        startDate: "2026-06-01",
        endDate: "2027-03-31"
    },
    {
        programName: "Tagbilaran Tertiary Educational Assistance Grant",
        unitName: "City Scholarship Office",
        cycleCode: "2026-2027",
        totalBudget: 6000000,
        perBarangayBudget: 350000,
        startDate: "2026-06-01",
        endDate: "2027-05-31"
    },
    {
        programName: "Sangguniang Panlungsod Youth Leadership & Study Grant",
        unitName: "Sangguniang Panlungsod / District Fund",
        cycleCode: "2026-2027",
        totalBudget: 3000000,
        perBarangayBudget: 180000,
        startDate: "2026-07-01",
        endDate: "2027-04-30"
    },
    {
        programName: "Barangay Community Scholars Support Program",
        unitName: "Barangay Educational Assistance Programs",
        cycleCode: "2026-2027",
        totalBudget: 2250000,
        perBarangayBudget: 150000,
        startDate: "2026-06-15",
        endDate: "2027-05-15"
    }
];

function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.+|\.+$/g, "");
}

async function seedOperationalData(dbPool = pool) {
    const passwordHash = await argon2.hash(DEMO_DEFAULT_PASSWORD, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1
    });

    const client = await dbPool.connect();
    try {
        await client.query("BEGIN");

        await client.query(
            `INSERT INTO "Funding_Cycles" (cycle_code, start_date, end_date, status)
             VALUES ('2026-2027', '2026-06-01', '2027-05-31', 'active')
             ON CONFLICT (cycle_code) DO UPDATE
             SET status = 'active',
                 start_date = COALESCE("Funding_Cycles".start_date, EXCLUDED.start_date),
                 end_date = COALESCE("Funding_Cycles".end_date, EXCLUDED.end_date)`
        );

        const cyclesRes = await client.query(
            'SELECT funding_cycle_id, cycle_code FROM "Funding_Cycles"'
        );
        const cycleMap = new Map(
            cyclesRes.rows.map((row) => [row.cycle_code, row.funding_cycle_id])
        );

        const unitsRes = await client.query(
            'SELECT funding_unit_id, funding_unit_name FROM "Funding_Units"'
        );
        const unitMap = new Map(
            unitsRes.rows.map((row) => [row.funding_unit_name, row.funding_unit_id])
        );

        const barangaysRes = await client.query(
            'SELECT barangay_id, barangay_name FROM "Barangays" ORDER BY barangay_id'
        );
        const schoolsRes = await client.query(
            'SELECT school_id, school_name FROM "Schools" WHERE is_approved = TRUE ORDER BY school_id'
        );
        const rolesRes = await client.query(
            'SELECT role_id, role_name FROM "Roles"'
        );
        const roleMap = new Map(
            rolesRes.rows.map((row) => [row.role_name, row.role_id])
        );

        for (const spec of SEED_PROGRAMS) {
            const unitId = unitMap.get(spec.unitName);
            const cycleId = cycleMap.get(spec.cycleCode);
            if (!unitId || !cycleId) continue;

            const existingProg = await client.query(
                `SELECT program_id
                 FROM "Funding_Programs"
                 WHERE program_name = $1`,
                [spec.programName]
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
                        spec.endDate
                    ]
                );
                programId = insertedProg.rows[0].program_id;
            } else {
                programId = existingProg.rows[0].program_id;
                await client.query(
                    `UPDATE "Funding_Programs"
                     SET funding_unit_id = COALESCE(funding_unit_id, $2),
                         funding_cycle_id = COALESCE(funding_cycle_id, $3),
                         funding_cycle = COALESCE(funding_cycle, $4),
                         status = 'active',
                         end_date = GREATEST(COALESCE(end_date, $5::date), $5::date)
                     WHERE program_id = $1`,
                    [programId, unitId, cycleId, spec.cycleCode, spec.endDate]
                );
            }

            for (const barangay of barangaysRes.rows) {
                await client.query(
                    `INSERT INTO "Program_Barangay_Allocations" (
                        program_id, barangay_id, allocated_amount, reserved_amount, released_amount
                     ) VALUES ($1, $2, $3, 0, 0)
                     ON CONFLICT (program_id, barangay_id) DO NOTHING`,
                    [programId, barangay.barangay_id, spec.perBarangayBudget]
                );
            }
        }

        const adminRoleId = roleMap.get("LGU Admin");
        const coordinatorRoleId = roleMap.get("Barangay Coordinator");
        const registrarRoleId = roleMap.get("Registrar");
        const scholarRoleId = roleMap.get("Scholar");

        const adminSpecs = [
            {
                email: "admin.cso@grantwise.local",
                firstName: "Elena",
                lastName: "Marquez",
                unitName: "City Scholarship Office",
                positionTitle: "Chief Scholarship Administrator"
            },
            {
                email: "admin.sp@grantwise.local",
                firstName: "Marco",
                lastName: "Villarin",
                unitName: "Sangguniang Panlungsod / District Fund",
                positionTitle: "District Fund Administrator"
            },
            {
                email: "admin.beap@grantwise.local",
                firstName: "Lorna",
                lastName: "Ceballos",
                unitName: "Barangay Educational Assistance Programs",
                positionTitle: "Barangay Assistance Program Officer"
            }
        ];

        for (const adminSpec of adminSpecs) {
            const unitId = unitMap.get(adminSpec.unitName);
            if (!unitId || !adminRoleId) continue;

            const userRes = await client.query(
                `INSERT INTO "Users" (
                    role_id, first_name, last_name, email, password_hash, phone_number, is_active
                 ) VALUES ($1, $2, $3, $4, $5, '09171001001', TRUE)
                 ON CONFLICT (email) DO UPDATE
                 SET role_id = EXCLUDED.role_id,
                     is_active = TRUE
                 RETURNING user_id`,
                [
                    adminRoleId,
                    adminSpec.firstName,
                    adminSpec.lastName,
                    adminSpec.email,
                    passwordHash
                ]
            );
            const userId = userRes.rows[0].user_id;

            await client.query(
                `INSERT INTO "LGU_Admins" (
                    user_id, funding_unit_id, position_title, is_active
                 ) VALUES ($1, $2, $3, TRUE)
                 ON CONFLICT (user_id) DO UPDATE
                 SET funding_unit_id = EXCLUDED.funding_unit_id,
                     is_active = TRUE`,
                [userId, unitId, adminSpec.positionTitle]
            );
        }

        for (const barangay of barangaysRes.rows) {
            if (!coordinatorRoleId) break;
            const activeCoord = await client.query(
                `SELECT coordinator_id
                 FROM "Barangay_Coordinators"
                 WHERE barangay_id = $1 AND is_current = TRUE`,
                [barangay.barangay_id]
            );
            if (activeCoord.rowCount > 0) continue;

            const slug = slugify(barangay.barangay_name);
            const email = `coordinator.${slug}@grantwise.local`;
            const userRes = await client.query(
                `INSERT INTO "Users" (
                    role_id, barangay_id, first_name, last_name, email, password_hash, phone_number, is_active
                 ) VALUES ($1, $2, $3, $4, $5, $6, '09172002002', TRUE)
                 ON CONFLICT (email) DO UPDATE
                 SET role_id = EXCLUDED.role_id,
                     barangay_id = EXCLUDED.barangay_id,
                     is_active = TRUE
                 RETURNING user_id`,
                [
                    coordinatorRoleId,
                    barangay.barangay_id,
                    `Brgy. ${barangay.barangay_name}`,
                    "Coordinator",
                    email,
                    passwordHash
                ]
            );
            const userId = userRes.rows[0].user_id;

            await client.query(
                `INSERT INTO "Barangay_Coordinators" (
                    user_id, barangay_id, position_title, term_start, is_current
                 ) VALUES ($1, $2, 'Barangay Education Coordinator', '2025-01-01', TRUE)
                 ON CONFLICT (user_id) DO UPDATE
                 SET barangay_id = EXCLUDED.barangay_id,
                     is_current = TRUE`,
                [userId, barangay.barangay_id]
            );
        }

        const schoolShortSlugs = new Map([
            ["Holy Name University", "hnu"],
            ["BISU-Tagbilaran", "bisu"],
            ["University of Bohol", "ub"],
            ["Tagbilaran City College", "tcc"],
            ["PMI Colleges Main Branch", "pmi"]
        ]);

        for (const school of schoolsRes.rows) {
            if (!registrarRoleId) break;
            const slug =
                schoolShortSlugs.get(school.school_name) ||
                slugify(school.school_name);
            const email = `registrar.${slug}@grantwise.local`;

            const userRes = await client.query(
                `INSERT INTO "Users" (
                    role_id, first_name, last_name, email, password_hash, phone_number, is_active
                 ) VALUES ($1, $2, 'Registrar', $3, $4, '09173003003', TRUE)
                 ON CONFLICT (email) DO UPDATE
                 SET role_id = EXCLUDED.role_id,
                     is_active = TRUE
                 RETURNING user_id`,
                [registrarRoleId, school.school_name, email, passwordHash]
            );
            const userId = userRes.rows[0].user_id;

            await client.query(
                `INSERT INTO "Registrars" (
                    user_id, school_id, position_title, is_active
                 ) VALUES ($1, $2, 'University Registrar', TRUE)
                 ON CONFLICT (user_id) DO UPDATE
                 SET school_id = EXCLUDED.school_id,
                     is_active = TRUE`,
                [userId, school.school_id]
            );
        }

        if (scholarRoleId && barangaysRes.rowCount > 0 && schoolsRes.rowCount > 0) {
            const taloto =
                barangaysRes.rows.find((b) => b.barangay_name === "Taloto") ||
                barangaysRes.rows[0];
            const hnu =
                schoolsRes.rows.find((s) => s.school_name === "Holy Name University") ||
                schoolsRes.rows[0];

            const scholarUser = await client.query(
                `INSERT INTO "Users" (
                    role_id, barangay_id, first_name, last_name, email, password_hash, phone_number, is_active
                 ) VALUES ($1, $2, 'Juan', 'Dela Cruz', 'scholar.demo@grantwise.local', $3, '09174004004', TRUE)
                 ON CONFLICT (email) DO UPDATE
                 SET role_id = EXCLUDED.role_id,
                     barangay_id = EXCLUDED.barangay_id,
                     is_active = TRUE
                 RETURNING user_id`,
                [scholarRoleId, taloto.barangay_id, passwordHash]
            );

            await client.query(
                `INSERT INTO "Students" (
                    user_id, school_id, student_number, course, year_level, is_active
                 ) VALUES ($1, $2, '2026-00101', 'BS Information Technology', '3rd Year', TRUE)
                 ON CONFLICT (user_id) DO NOTHING`,
                [scholarUser.rows[0].user_id, hnu.school_id]
            );
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
    console.log("GrantWise database schema and operational seed data initialized successfully.");
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
    DEMO_DEFAULT_PASSWORD
};
