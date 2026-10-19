-- ============================================================================
-- Migration: Normalized, Case-Insensitive Unique Email Constraints on "Users"
-- Status: Prepared for review/approval. Do NOT apply to live Neon without approval.
-- ============================================================================
BEGIN;

DO $$
BEGIN
    IF to_regclass('"Users"') IS NULL THEN
        RAISE EXCEPTION 'Prerequisite table "Users" is missing; migration aborted.';
    END IF;

    -- Refuse to normalize or index if existing rows would collide after lower(btrim(email))
    IF EXISTS (
        SELECT LOWER(BTRIM(email))
        FROM "Users"
        GROUP BY LOWER(BTRIM(email))
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate case-insensitive email addresses exist in "Users"; resolve duplicates before applying uq_users_lower_email.';
    END IF;
END;
$$;

-- Normalize any existing non-normalized emails before enforcing the check constraint
UPDATE "Users"
SET email = LOWER(BTRIM(email)),
    updated_at = NOW()
WHERE email IS DISTINCT FROM LOWER(BTRIM(email));

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

COMMIT;
