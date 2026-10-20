-- ============================================================================
-- Migration: Staff Email Authorization, Developer Role, School Domains, and Email Verification
-- Reversible / Additive Migration
-- ============================================================================
BEGIN;

DO $$
BEGIN
    IF to_regclass('"Users"') IS NULL
       OR to_regclass('"Roles"') IS NULL
       OR to_regclass('"Schools"') IS NULL
       OR to_regclass('"Barangays"') IS NULL
       OR to_regclass('"Funding_Units"') IS NULL
       OR to_regclass('"LGU_Admins"') IS NULL
       OR to_regclass('"Barangay_Coordinators"') IS NULL
       OR to_regclass('"Registrars"') IS NULL
       OR to_regclass('"Audit_Logs"') IS NULL THEN
        RAISE EXCEPTION 'Prerequisite GrantWise tables are missing; migration aborted.';
    END IF;

    IF EXISTS (
        SELECT LOWER(BTRIM(email))
        FROM "Users"
        GROUP BY LOWER(BTRIM(email))
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate case-insensitive email addresses exist in "Users"; resolve duplicates before applying migration.';
    END IF;
END;
$$;

-- 1. Ensure System Admin (Developer) role exists
INSERT INTO "Roles" (role_name, description)
VALUES (
    'System Admin',
    'Developer or explicitly authorized system administrator for staff access and domain management'
)
ON CONFLICT (role_name) DO NOTHING;

-- 2. Normalize existing emails and add email verification column on "Users"
UPDATE "Users"
SET email = LOWER(BTRIM(email)),
    updated_at = NOW()
WHERE email IS DISTINCT FROM LOWER(BTRIM(email));

ALTER TABLE "Users"
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Backfill existing active accounts so legacy/existing users are not locked out
UPDATE "Users"
SET email_verified_at = COALESCE(email_verified_at, created_at)
WHERE is_active = TRUE AND email_verified_at IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = '"Users"'::regclass
          AND conname = 'chk_users_email_normalized'
    ) THEN
        ALTER TABLE "Users"
            ADD CONSTRAINT chk_users_email_normalized
            CHECK (email = LOWER(BTRIM(email)) AND POSITION(' ' IN email) = 0);
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_lower_email
    ON "Users" (LOWER(BTRIM(email)));

-- 3. Add granular permission set to "LGU_Admins"
ALTER TABLE "LGU_Admins"
    ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL
    DEFAULT '{"read_only_reports": true, "program_management": true, "application_review": true, "award_approval": true, "disbursement_release": false}'::JSONB;

-- 4. Database-backed School Email Domain configuration
CREATE TABLE IF NOT EXISTS "School_Email_Domains" (
    domain_id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES "Schools"(school_id) ON DELETE CASCADE,
    domain VARCHAR(253) NOT NULL UNIQUE
        CHECK (domain = LOWER(BTRIM(domain)) AND POSITION(' ' IN domain) = 0 AND POSITION('@' IN domain) = 0),
    domain_status VARCHAR(20) NOT NULL DEFAULT 'candidate'
        CHECK (domain_status IN ('candidate', 'verified', 'disabled')),
    is_primary BOOLEAN NOT NULL DEFAULT TRUE,
    configured_by INTEGER REFERENCES "Users"(user_id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_school_email_domains_school
    ON "School_Email_Domains" (school_id, domain_status);

-- Seed initial school domain mappings using actual school names in "Schools"
INSERT INTO "School_Email_Domains" (school_id, domain, domain_status, is_primary, notes)
SELECT s.school_id, v.domain, v.domain_status, v.is_primary, v.notes
FROM (
    VALUES
        ('Holy Name University', 'hnu.edu.ph', 'verified', TRUE, 'Configured official HNU institutional domain'),
        ('BISU-Tagbilaran', 'bisu.edu.ph', 'verified', TRUE, 'Configured official BISU institutional domain'),
        ('University of Bohol', 'universityofbohol.edu.ph', 'verified', TRUE, 'Configured official UB institutional domain'),
        ('University of Bohol', 'ub.edu.ph', 'candidate', FALSE, 'Candidate short domain ub.edu.ph subject to confirmation by the institution'),
        ('Tagbilaran City College', 'tagbilarancitycollege.edu.ph', 'verified', TRUE, 'Configured official TCC institutional domain'),
        ('Tagbilaran City College', 'tcc.edu.ph', 'candidate', FALSE, 'Candidate short domain tcc.edu.ph subject to confirmation by the institution'),
        ('PMI Colleges Main Branch', 'pmicollegesbohol.edu.ph', 'verified', TRUE, 'Configured official PMI Bohol institutional domain'),
        ('PMI Colleges Main Branch', 'pmi-bohol.edu.ph', 'candidate', FALSE, 'Candidate domain pmi-bohol.edu.ph subject to confirmation by the institution')
) AS v(school_name, domain, domain_status, is_primary, notes)
JOIN "Schools" s ON s.school_name = v.school_name
ON CONFLICT (domain) DO NOTHING;

-- 5. Staff Email Authorizations and Invitations table
CREATE TABLE IF NOT EXISTS "Staff_Email_Authorizations" (
    authorization_id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL
        CHECK (email = LOWER(BTRIM(email)) AND POSITION(' ' IN email) = 0),
    role_name VARCHAR(50) NOT NULL
        CHECK (role_name IN ('LGU Admin', 'Barangay Coordinator', 'Registrar')),
    funding_unit_id INTEGER REFERENCES "Funding_Units"(funding_unit_id),
    barangay_id INTEGER REFERENCES "Barangays"(barangay_id),
    school_id INTEGER REFERENCES "Schools"(school_id),
    position_title VARCHAR(100),
    lgu_permissions JSONB,
    invitation_token_hash TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'revoked', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '72 hours'),
    authorized_by INTEGER REFERENCES "Users"(user_id),
    authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_user_id INTEGER REFERENCES "Users"(user_id) ON DELETE SET NULL,
    activated_at TIMESTAMPTZ,
    revoked_by INTEGER REFERENCES "Users"(user_id),
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_staff_email_authorization_scope CHECK (
        (role_name = 'LGU Admin' AND funding_unit_id IS NOT NULL AND barangay_id IS NULL AND school_id IS NULL)
        OR (role_name = 'Barangay Coordinator' AND barangay_id IS NOT NULL AND funding_unit_id IS NULL AND school_id IS NULL)
        OR (role_name = 'Registrar' AND school_id IS NOT NULL AND funding_unit_id IS NULL AND barangay_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_auth_open_email
    ON "Staff_Email_Authorizations" (LOWER(BTRIM(email)))
    WHERE status IN ('pending', 'active');

CREATE INDEX IF NOT EXISTS idx_staff_auth_token_hash
    ON "Staff_Email_Authorizations" (invitation_token_hash)
    WHERE status = 'pending' AND invitation_token_hash IS NOT NULL;

-- Backfill existing active staff accounts so existing database records remain authorized
INSERT INTO "Staff_Email_Authorizations" (
    email, role_name, funding_unit_id, position_title, lgu_permissions,
    status, expires_at, activated_at, activated_user_id, notes
)
SELECT
    LOWER(BTRIM(u.email)),
    'LGU Admin',
    la.funding_unit_id,
    la.position_title,
    la.permissions,
    'active',
    NOW() + INTERVAL '365 days',
    COALESCE(u.email_verified_at, u.created_at),
    u.user_id,
    'existing_staff_backfilled'
FROM "LGU_Admins" la
JOIN "Users" u ON u.user_id = la.user_id
JOIN "Roles" r ON r.role_id = u.role_id
WHERE la.is_active = TRUE
  AND u.is_active = TRUE
  AND r.role_name = 'LGU Admin'
  AND la.funding_unit_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM "Staff_Email_Authorizations" sea
      WHERE LOWER(BTRIM(sea.email)) = LOWER(BTRIM(u.email))
        AND sea.status IN ('pending', 'active')
  );

INSERT INTO "Staff_Email_Authorizations" (
    email, role_name, barangay_id, position_title,
    status, expires_at, activated_at, activated_user_id, notes
)
SELECT
    LOWER(BTRIM(u.email)),
    'Barangay Coordinator',
    bc.barangay_id,
    bc.position_title,
    'active',
    NOW() + INTERVAL '365 days',
    COALESCE(u.email_verified_at, u.created_at),
    u.user_id,
    'existing_staff_backfilled'
FROM "Barangay_Coordinators" bc
JOIN "Users" u ON u.user_id = bc.user_id
JOIN "Roles" r ON r.role_id = u.role_id
WHERE bc.is_current = TRUE
  AND u.is_active = TRUE
  AND r.role_name = 'Barangay Coordinator'
  AND NOT EXISTS (
      SELECT 1 FROM "Staff_Email_Authorizations" sea
      WHERE LOWER(BTRIM(sea.email)) = LOWER(BTRIM(u.email))
        AND sea.status IN ('pending', 'active')
  );

INSERT INTO "Staff_Email_Authorizations" (
    email, role_name, school_id, position_title,
    status, expires_at, activated_at, activated_user_id, notes
)
SELECT
    LOWER(BTRIM(u.email)),
    'Registrar',
    reg.school_id,
    reg.position_title,
    'active',
    NOW() + INTERVAL '365 days',
    COALESCE(u.email_verified_at, u.created_at),
    u.user_id,
    'existing_staff_backfilled'
FROM "Registrars" reg
JOIN "Users" u ON u.user_id = reg.user_id
JOIN "Roles" r ON r.role_id = u.role_id
WHERE reg.is_active = TRUE
  AND u.is_active = TRUE
  AND r.role_name = 'Registrar'
  AND NOT EXISTS (
      SELECT 1 FROM "Staff_Email_Authorizations" sea
      WHERE LOWER(BTRIM(sea.email)) = LOWER(BTRIM(u.email))
        AND sea.status IN ('pending', 'active')
  );

-- 6. Email Verification Tokens table (for student school-email verification & developer bootstrap)
CREATE TABLE IF NOT EXISTS "Email_Verification_Tokens" (
    verification_token_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "Users"(user_id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL
        CHECK (email = LOWER(BTRIM(email)) AND POSITION(' ' IN email) = 0),
    purpose VARCHAR(40) NOT NULL
        CHECK (purpose IN ('account_verification', 'staff_invitation', 'developer_bootstrap')),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_lookup
    ON "Email_Verification_Tokens" (LOWER(BTRIM(email)), purpose)
    WHERE consumed_at IS NULL;

COMMIT;

-- ============================================================================
-- REVERSIBLE DOWN-MIGRATION (Reference Only — Do Not Run Automatically)
-- ============================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS "Email_Verification_Tokens";
-- DROP TABLE IF EXISTS "Staff_Email_Authorizations";
-- DROP TABLE IF EXISTS "School_Email_Domains";
-- ALTER TABLE "LGU_Admins" DROP COLUMN IF EXISTS permissions;
-- ALTER TABLE "Users" DROP COLUMN IF EXISTS email_verified_at;
-- DELETE FROM "Roles" WHERE role_name = 'System Admin' AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.role_id = "Roles".role_id);
-- COMMIT;
