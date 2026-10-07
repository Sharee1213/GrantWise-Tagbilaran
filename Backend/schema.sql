BEGIN;

CREATE TABLE IF NOT EXISTS "Roles" (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE IF NOT EXISTS "Barangays" (
    barangay_id SERIAL PRIMARY KEY,
    barangay_name VARCHAR(100) NOT NULL UNIQUE,
    remaining_allocated_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
    allocated_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
    slot_quota INTEGER NOT NULL DEFAULT 0,
    remaining_slots INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Schools" (
    school_id SERIAL PRIMARY KEY,
    school_name VARCHAR(255) NOT NULL UNIQUE,
    is_approved BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Funding_Units" (
    funding_unit_id SERIAL PRIMARY KEY,
    funding_unit_name VARCHAR(200) NOT NULL UNIQUE,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Users" (
    user_id SERIAL PRIMARY KEY,
    role_id INTEGER NOT NULL REFERENCES "Roles"(role_id),
    barangay_id INTEGER REFERENCES "Barangays"(barangay_id),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    phone_number VARCHAR(30),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Login_Sessions" (
    session_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "Users"(user_id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    device_info TEXT,
    login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "LGU_Admins" (
    admin_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES "Users"(user_id) ON DELETE CASCADE,
    funding_unit_id INTEGER REFERENCES "Funding_Units"(funding_unit_id),
    position_title VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "LGU_Admins"
    ADD COLUMN IF NOT EXISTS funding_unit_id INTEGER
        REFERENCES "Funding_Units"(funding_unit_id);

-- Existing admin rows remain nullable until explicitly mapped to a funding unit.
CREATE TABLE IF NOT EXISTS "Barangay_Coordinators" (
    coordinator_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES "Users"(user_id) ON DELETE CASCADE,
    barangay_id INTEGER NOT NULL REFERENCES "Barangays"(barangay_id),
    position_title VARCHAR(100) NOT NULL,
    term_start DATE NOT NULL,
    term_end DATE,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (term_end IS NULL OR term_end >= term_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_current_barangay_coordinator
ON "Barangay_Coordinators" (barangay_id)
WHERE is_current = TRUE;

CREATE TABLE IF NOT EXISTS "Registrars" (
    registrar_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES "Users"(user_id) ON DELETE CASCADE,
    school_id INTEGER NOT NULL REFERENCES "Schools"(school_id),
    position_title VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Students" (
    student_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES "Users"(user_id) ON DELETE CASCADE,
    school_id INTEGER NOT NULL REFERENCES "Schools"(school_id),
    student_number VARCHAR(50) NOT NULL UNIQUE,
    course VARCHAR(100) NOT NULL,
    year_level VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Funding_Cycles" (
    funding_cycle_id SERIAL PRIMARY KEY,
    cycle_code VARCHAR(9) NOT NULL UNIQUE
        CHECK (cycle_code ~ '^[0-9]{4}-[0-9]{4}$'),
    start_date DATE,
    end_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS "Funding_Programs" (
    program_id SERIAL PRIMARY KEY,
    program_name VARCHAR(200) NOT NULL,
    funding_cycle VARCHAR(50),
    funding_unit_id INTEGER REFERENCES "Funding_Units"(funding_unit_id),
    funding_cycle_id INTEGER REFERENCES "Funding_Cycles"(funding_cycle_id),
    total_budget NUMERIC(14,2) NOT NULL CHECK (total_budget >= 0),
    remaining_budget NUMERIC(14,2) NOT NULL CHECK (remaining_budget >= 0),
    reserved_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
    released_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date IS NULL OR end_date >= start_date)
);

ALTER TABLE "Funding_Programs"
    ADD COLUMN IF NOT EXISTS funding_unit_id INTEGER
        REFERENCES "Funding_Units"(funding_unit_id);
ALTER TABLE "Funding_Programs"
    ADD COLUMN IF NOT EXISTS funding_cycle_id INTEGER
        REFERENCES "Funding_Cycles"(funding_cycle_id);
ALTER TABLE "Funding_Programs"
    ADD COLUMN IF NOT EXISTS reserved_budget NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Funding_Programs"
    ADD COLUMN IF NOT EXISTS released_budget NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Legacy program unit/cycle mappings and historical budget balances require
-- explicit reconciliation before budget operations can safely use those rows.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"Funding_Programs"'::regclass
          AND conname = 'uq_funding_program_unit_cycle'
    ) THEN
        ALTER TABLE "Funding_Programs"
            ADD CONSTRAINT uq_funding_program_unit_cycle
            UNIQUE (program_id, funding_unit_id, funding_cycle_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"Funding_Programs"'::regclass
          AND conname = 'chk_program_budget_reservations'
    ) THEN
        ALTER TABLE "Funding_Programs"
            ADD CONSTRAINT chk_program_budget_reservations
            CHECK (remaining_budget >= 0 AND reserved_budget >= 0
                AND released_budget >= 0 AND reserved_budget <= remaining_budget) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"Funding_Programs"'::regclass
          AND conname = 'chk_program_budget_total_consistency'
    ) THEN
        ALTER TABLE "Funding_Programs"
            ADD CONSTRAINT chk_program_budget_total_consistency
            CHECK (total_budget = remaining_budget + released_budget) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"Funding_Programs"'::regclass
          AND conname = 'chk_program_status'
    ) THEN
        ALTER TABLE "Funding_Programs"
            ADD CONSTRAINT chk_program_status
            CHECK (status IN ('active', 'inactive', 'closed')) NOT VALID;
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "Program_Barangay_Allocations" (
    allocation_id SERIAL PRIMARY KEY,
    program_id INTEGER NOT NULL REFERENCES "Funding_Programs"(program_id),
    barangay_id INTEGER NOT NULL REFERENCES "Barangays"(barangay_id),
    allocated_amount NUMERIC(14,2) NOT NULL CHECK (allocated_amount >= 0),
    reserved_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0),
    released_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (released_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (program_id, barangay_id),
    CHECK (reserved_amount + released_amount <= allocated_amount)
);

CREATE INDEX IF NOT EXISTS idx_program_barangay_allocations_barangay
ON "Program_Barangay_Allocations" (barangay_id, program_id);

CREATE INDEX IF NOT EXISTS idx_lgu_admins_funding_unit
ON "LGU_Admins" (funding_unit_id);

CREATE TABLE IF NOT EXISTS "Applications" (
    application_id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES "Students"(student_id) ON DELETE CASCADE,
    program_id INTEGER NOT NULL REFERENCES "Funding_Programs"(program_id),
    barangay_id INTEGER NOT NULL REFERENCES "Barangays"(barangay_id),
    assigned_reviewer_id INTEGER REFERENCES "Users"(user_id),
    endorsed_by INTEGER REFERENCES "Barangay_Coordinators"(coordinator_id),
    application_status VARCHAR(50) NOT NULL DEFAULT 'draft',
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"Applications"'::regclass
          AND conname = 'uq_applications_application_program'
    ) THEN
        ALTER TABLE "Applications"
            ADD CONSTRAINT uq_applications_application_program
            UNIQUE (application_id, program_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"Applications"'::regclass
          AND conname = 'chk_application_status'
    ) THEN
        ALTER TABLE "Applications"
            ADD CONSTRAINT chk_application_status
            CHECK (application_status IN (
                'draft', 'submitted', 'barangay_verification',
                'registrar_verification', 'lgu_review',
                'approved', 'rejected', 'withdrawn'
            )) NOT VALID;
    END IF;
END;
$$;
CREATE TABLE IF NOT EXISTS "Documents" (
    document_id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES "Applications"(application_id) ON DELETE CASCADE,
    document_type VARCHAR(100) NOT NULL,
    file_path TEXT NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Grade_Reports" (
    grade_report_id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES "Students"(student_id) ON DELETE CASCADE,
    registrar_id INTEGER NOT NULL REFERENCES "Registrars"(registrar_id),
    school_year VARCHAR(20) NOT NULL,
    semester VARCHAR(20) NOT NULL,
    gpa NUMERIC(4,2) NOT NULL CHECK (gpa >= 0),
    remarks TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Disbursements" (
    disbursement_id SERIAL PRIMARY KEY,
    award_id INTEGER NOT NULL,
    semester_id VARCHAR(20) NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    disbursement_date DATE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (award_id, semester_id)
);

CREATE TABLE IF NOT EXISTS "Notifications" (
    notification_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "Users"(user_id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Audit_Logs" (
    log_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "Users"(user_id),
    action_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id INTEGER,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Scholarship_Awards" (
    award_id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL UNIQUE REFERENCES "Applications"(application_id) ON DELETE CASCADE,
    program_id INTEGER NOT NULL REFERENCES "Funding_Programs"(program_id),
    award_amount NUMERIC(12,2) NOT NULL CHECK (award_amount > 0),
    award_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    approved_by INTEGER REFERENCES "Users"(user_id),
    award_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"Scholarship_Awards"'::regclass
          AND conname = 'fk_award_application_program'
    ) THEN
        ALTER TABLE "Scholarship_Awards"
            ADD CONSTRAINT fk_award_application_program
            FOREIGN KEY (application_id, program_id)
            REFERENCES "Applications"(application_id, program_id) NOT VALID;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"Scholarship_Awards"'::regclass
          AND conname = 'uq_award_id_program'
    ) THEN
        ALTER TABLE "Scholarship_Awards"
            ADD CONSTRAINT uq_award_id_program UNIQUE (award_id, program_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"Scholarship_Awards"'::regclass
          AND conname = 'chk_award_status'
    ) THEN
        ALTER TABLE "Scholarship_Awards"
            ADD CONSTRAINT chk_award_status
            CHECK (award_status IN ('pending', 'approved', 'rejected', 'cancelled')) NOT VALID;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.contype = 'f'
          AND c.conrelid = '"Disbursements"'::regclass
          AND c.confrelid = '"Scholarship_Awards"'::regclass
          AND ARRAY(
              SELECT a.attname::TEXT
              FROM unnest(c.conkey) WITH ORDINALITY AS key_col(attnum, ordinal)
              JOIN pg_attribute a
                ON a.attrelid = c.conrelid AND a.attnum = key_col.attnum
              ORDER BY key_col.ordinal
          ) = ARRAY['award_id']::TEXT[]
          AND ARRAY(
              SELECT a.attname::TEXT
              FROM unnest(c.confkey) WITH ORDINALITY AS key_col(attnum, ordinal)
              JOIN pg_attribute a
                ON a.attrelid = c.confrelid AND a.attnum = key_col.attnum
              ORDER BY key_col.ordinal
          ) = ARRAY['award_id']::TEXT[]
    ) THEN
        ALTER TABLE "Disbursements"
            ADD CONSTRAINT fk_disbursement_award
            FOREIGN KEY (award_id)
            REFERENCES "Scholarship_Awards"(award_id)
            ON DELETE CASCADE;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"Disbursements"'::regclass
          AND conname = 'chk_disbursement_status'
    ) THEN
        ALTER TABLE "Disbursements"
            ADD CONSTRAINT chk_disbursement_status
            CHECK (status IN ('pending', 'eligible', 'released', 'cancelled')) NOT VALID;
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "Eligibility_Checks" (
    eligibility_id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES "Students"(student_id) ON DELETE CASCADE,
    registrar_id INTEGER NOT NULL REFERENCES "Registrars"(registrar_id),
    check_type VARCHAR(50) NOT NULL,
    result VARCHAR(30) NOT NULL CHECK (result IN ('eligible', 'ineligible', 'pending')),
    remarks TEXT,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Student_Funding_Records" (
    funding_record_id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES "Students"(student_id) ON DELETE CASCADE,
    funding_cycle_id INTEGER NOT NULL REFERENCES "Funding_Cycles"(funding_cycle_id),
    funding_unit_id INTEGER REFERENCES "Funding_Units"(funding_unit_id),
    program_id INTEGER,
    award_id INTEGER,
    source_type VARCHAR(20) NOT NULL
        CHECK (source_type IN ('grantwise', 'external')),
    record_status VARCHAR(20) NOT NULL
        CHECK (record_status IN ('reported', 'committed', 'released', 'reversed')),
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    released_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    source_name VARCHAR(200),
    reference_details TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (program_id, funding_unit_id, funding_cycle_id)
        REFERENCES "Funding_Programs"(program_id, funding_unit_id, funding_cycle_id),
    FOREIGN KEY (award_id, program_id)
        REFERENCES "Scholarship_Awards"(award_id, program_id),
    CHECK (
        (source_type = 'grantwise' AND program_id IS NOT NULL
            AND funding_unit_id IS NOT NULL AND award_id IS NOT NULL)
        OR (source_type = 'external' AND award_id IS NULL)
    )
);

ALTER TABLE "Student_Funding_Records"
    ADD COLUMN IF NOT EXISTS released_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"Student_Funding_Records"'::regclass
          AND conname = 'chk_student_funding_released_amount'
    ) THEN
        ALTER TABLE "Student_Funding_Records"
            ADD CONSTRAINT chk_student_funding_released_amount
            CHECK (released_amount >= 0 AND released_amount <= amount) NOT VALID;
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_funding_record_award
ON "Student_Funding_Records" (award_id)
WHERE award_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_funding_records_student_cycle
ON "Student_Funding_Records" (student_id, funding_cycle_id, record_status);

CREATE TABLE IF NOT EXISTS "Funding_Duplicate_Checks" (
    duplicate_check_id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES "Students"(student_id) ON DELETE CASCADE,
    funding_cycle_id INTEGER NOT NULL REFERENCES "Funding_Cycles"(funding_cycle_id),
    result VARCHAR(30) NOT NULL
        CHECK (result IN ('no_duplicate', 'possible_duplicate', 'confirmed_duplicate')),
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    evidence TEXT,
    reviewed_by INTEGER REFERENCES "Users"(user_id),
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_funding_duplicate_check_current
ON "Funding_Duplicate_Checks" (student_id, funding_cycle_id)
WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_funding_duplicate_checks_cycle_result
ON "Funding_Duplicate_Checks" (funding_cycle_id, result);

CREATE TABLE IF NOT EXISTS "Application_Verifications" (
    verification_id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES "Applications"(application_id) ON DELETE CASCADE,
    verification_type VARCHAR(20) NOT NULL
        CHECK (verification_type IN ('barangay', 'registrar', 'lgu')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'needs_information')),
    reviewed_by INTEGER REFERENCES "Users"(user_id),
    remarks TEXT,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (application_id, verification_type)
);

CREATE INDEX IF NOT EXISTS idx_applications_program_status
ON "Applications" (program_id, application_status);

CREATE INDEX IF NOT EXISTS idx_applications_student_program
ON "Applications" (student_id, program_id);

CREATE INDEX IF NOT EXISTS idx_funding_programs_unit_cycle
ON "Funding_Programs" (funding_unit_id, funding_cycle_id);

CREATE INDEX IF NOT EXISTS idx_application_verifications_type_status
ON "Application_Verifications" (verification_type, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_application_verifications_one_pending
ON "Application_Verifications" (application_id)
WHERE status = 'pending';

CREATE OR REPLACE VIEW "Program_Budget_Balances" AS
SELECT
    program_id,
    total_budget,
    remaining_budget,
    reserved_budget,
    released_budget,
    remaining_budget - reserved_budget AS available_budget
FROM "Funding_Programs";

CREATE OR REPLACE VIEW "Program_Barangay_Allocation_Balances" AS
SELECT
    allocation_id,
    program_id,
    barangay_id,
    allocated_amount,
    reserved_amount,
    released_amount,
    allocated_amount - reserved_amount - released_amount AS available_amount
FROM "Program_Barangay_Allocations";

CREATE OR REPLACE VIEW "Potential_Funding_Duplicates" AS
SELECT
    student_id,
    funding_cycle_id,
    COUNT(*) AS funding_record_count,
    COUNT(DISTINCT program_id) AS distinct_program_count
FROM "Student_Funding_Records"
WHERE record_status IN ('reported', 'committed', 'released')
GROUP BY student_id, funding_cycle_id
HAVING COUNT(*) > 1;

CREATE OR REPLACE FUNCTION validate_application_barangay()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Users" u
        JOIN "Students" s ON s.user_id = u.user_id
        WHERE s.student_id = NEW.student_id
          AND u.barangay_id IS DISTINCT FROM NEW.barangay_id
    ) THEN
        RAISE EXCEPTION 'Applications.barangay_id must match the student''s residency barangay.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_registrar_school_scope()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Students" s
        JOIN "Registrars" r ON r.registrar_id = NEW.registrar_id
        WHERE s.student_id = NEW.student_id
          AND s.school_id IS DISTINCT FROM r.school_id
    ) THEN
        RAISE EXCEPTION 'Registrar actions must be limited to students from their own school.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_application_verification_scope()
RETURNS TRIGGER AS $$
DECLARE
    application_record RECORD;
    actor_matches BOOLEAN;
    program_unit_id INTEGER;
BEGIN
    IF NEW.reviewed_by IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT a.application_id, a.barangay_id, a.program_id, s.school_id
    INTO application_record
    FROM "Applications" a
    JOIN "Students" s ON s.student_id = a.student_id
    WHERE a.application_id = NEW.application_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application not found for verification.';
    END IF;

    IF NEW.verification_type = 'barangay' THEN
        SELECT EXISTS (
            SELECT 1
            FROM "Barangay_Coordinators" bc
            JOIN "Users" u ON u.user_id = bc.user_id
            JOIN "Roles" r ON r.role_id = u.role_id
            WHERE u.user_id = NEW.reviewed_by
              AND r.role_name = 'Barangay Coordinator'
              AND bc.barangay_id = application_record.barangay_id
              AND bc.is_current = TRUE
              AND u.is_active = TRUE
        ) INTO actor_matches;
    ELSIF NEW.verification_type = 'registrar' THEN
        SELECT EXISTS (
            SELECT 1
            FROM "Registrars" reg
            JOIN "Users" u ON u.user_id = reg.user_id
            JOIN "Roles" r ON r.role_id = u.role_id
            WHERE u.user_id = NEW.reviewed_by
              AND r.role_name = 'Registrar'
              AND reg.school_id = application_record.school_id
              AND reg.is_active = TRUE
              AND u.is_active = TRUE
        ) INTO actor_matches;
    ELSE
        SELECT funding_unit_id INTO program_unit_id
        FROM "Funding_Programs"
        WHERE program_id = application_record.program_id;

        SELECT EXISTS (
            SELECT 1
            FROM "LGU_Admins" admin
            JOIN "Users" u ON u.user_id = admin.user_id
            JOIN "Roles" r ON r.role_id = u.role_id
            WHERE u.user_id = NEW.reviewed_by
              AND r.role_name = 'LGU Admin'
              AND admin.funding_unit_id = program_unit_id
              AND admin.is_active = TRUE
              AND u.is_active = TRUE
        ) INTO actor_matches;
    END IF;

    IF NOT actor_matches THEN
        RAISE EXCEPTION 'Reviewer is not authorized for this application verification scope.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION initialize_application_verification()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.application_status = 'submitted' THEN
        INSERT INTO "Application_Verifications" (
            application_id, verification_type, status
        ) VALUES (NEW.application_id, 'barangay', 'pending')
        ON CONFLICT (application_id, verification_type) DO NOTHING;

        UPDATE "Applications"
        SET application_status = 'barangay_verification'
        WHERE application_id = NEW.application_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_application_status_transition()
RETURNS TRIGGER AS $$
DECLARE
    allowed_transition BOOLEAN := FALSE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.application_status <> 'draft' THEN
            RAISE EXCEPTION 'Applications must be created as drafts and submitted through the workflow.';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.application_status = OLD.application_status THEN
        RETURN NEW;
    END IF;

    IF OLD.application_status = 'draft'
       AND NEW.application_status = 'submitted' THEN
        NEW.submitted_at := COALESCE(NEW.submitted_at, NOW());
        allowed_transition := TRUE;
    ELSIF OLD.application_status = 'submitted'
       AND NEW.application_status = 'barangay_verification'
       AND EXISTS (
           SELECT 1 FROM "Application_Verifications"
           WHERE application_id = OLD.application_id
             AND verification_type = 'barangay' AND status = 'pending'
       ) THEN
        allowed_transition := TRUE;
    ELSIF OLD.application_status = 'barangay_verification'
       AND NEW.application_status = 'registrar_verification'
       AND EXISTS (
           SELECT 1 FROM "Application_Verifications"
           WHERE application_id = OLD.application_id
             AND verification_type = 'barangay' AND status = 'approved'
       ) THEN
        allowed_transition := TRUE;
    ELSIF OLD.application_status = 'barangay_verification'
       AND NEW.application_status = 'rejected'
       AND EXISTS (
           SELECT 1 FROM "Application_Verifications"
           WHERE application_id = OLD.application_id
             AND verification_type = 'barangay' AND status = 'rejected'
       ) THEN
        allowed_transition := TRUE;
    ELSIF OLD.application_status = 'registrar_verification'
       AND NEW.application_status = 'lgu_review'
       AND EXISTS (
           SELECT 1 FROM "Application_Verifications"
           WHERE application_id = OLD.application_id
             AND verification_type = 'registrar' AND status = 'approved'
       ) THEN
        allowed_transition := TRUE;
    ELSIF OLD.application_status = 'registrar_verification'
       AND NEW.application_status = 'rejected'
       AND EXISTS (
           SELECT 1 FROM "Application_Verifications"
           WHERE application_id = OLD.application_id
             AND verification_type = 'registrar' AND status = 'rejected'
       ) THEN
        allowed_transition := TRUE;
    ELSIF OLD.application_status = 'lgu_review'
       AND NEW.application_status = 'approved'
       AND EXISTS (
           SELECT 1 FROM "Application_Verifications"
           WHERE application_id = OLD.application_id
             AND verification_type = 'lgu' AND status = 'approved'
       ) THEN
        allowed_transition := TRUE;
    ELSIF OLD.application_status = 'lgu_review'
       AND NEW.application_status = 'rejected'
       AND EXISTS (
           SELECT 1 FROM "Application_Verifications"
           WHERE application_id = OLD.application_id
             AND verification_type = 'lgu' AND status = 'rejected'
       ) THEN
        allowed_transition := TRUE;
    ELSIF OLD.application_status IN ('draft', 'submitted')
       AND NEW.application_status = 'withdrawn' THEN
        allowed_transition := TRUE;
    END IF;

    IF NOT allowed_transition THEN
        RAISE EXCEPTION 'Invalid application status transition from % to %.',
            OLD.application_status, NEW.application_status;
    END IF;

    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION advance_application_verification()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = OLD.status OR NEW.status NOT IN ('approved', 'rejected') THEN
        RETURN NEW;
    END IF;

    UPDATE "Applications"
    SET application_status = CASE
        WHEN NEW.status = 'rejected' THEN 'rejected'
        WHEN NEW.verification_type = 'barangay' THEN 'registrar_verification'
        WHEN NEW.verification_type = 'registrar' THEN 'lgu_review'
        ELSE 'approved'
    END,
    endorsed_by = CASE
        WHEN NEW.status = 'approved' AND NEW.verification_type = 'barangay'
        THEN (
            SELECT coordinator_id
            FROM "Barangay_Coordinators"
            WHERE user_id = NEW.reviewed_by
        )
        ELSE endorsed_by
    END,
    reviewed_at = COALESCE(NEW.reviewed_at, NOW())
    WHERE application_id = NEW.application_id;

    IF NEW.status = 'approved' AND NEW.verification_type = 'barangay' THEN
        INSERT INTO "Application_Verifications" (
            application_id, verification_type, status
        ) VALUES (NEW.application_id, 'registrar', 'pending')
        ON CONFLICT (application_id, verification_type) DO NOTHING;
    ELSIF NEW.status = 'approved' AND NEW.verification_type = 'registrar' THEN
        INSERT INTO "Application_Verifications" (
            application_id, verification_type, status
        ) VALUES (NEW.application_id, 'lgu', 'pending')
        ON CONFLICT (application_id, verification_type) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_application_verification_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'pending' OR NOT (
            (NEW.verification_type = 'barangay' AND EXISTS (
                SELECT 1 FROM "Applications"
                WHERE application_id = NEW.application_id
                  AND application_status = 'submitted'
            ))
            OR (NEW.verification_type = 'registrar' AND EXISTS (
                SELECT 1 FROM "Applications" a
                JOIN "Application_Verifications" v ON v.application_id = a.application_id
                WHERE a.application_id = NEW.application_id
                  AND a.application_status = 'registrar_verification'
                  AND v.verification_type = 'barangay' AND v.status = 'approved'
            ))
            OR (NEW.verification_type = 'lgu' AND EXISTS (
                SELECT 1 FROM "Applications" a
                JOIN "Application_Verifications" v ON v.application_id = a.application_id
                WHERE a.application_id = NEW.application_id
                  AND a.application_status = 'lgu_review'
                  AND v.verification_type = 'registrar' AND v.status = 'approved'
            ))
        ) THEN
            RAISE EXCEPTION 'Verification stage cannot be activated before the preceding workflow stage is approved.';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;
    IF OLD.status NOT IN ('pending', 'needs_information')
       OR NEW.status NOT IN ('approved', 'rejected', 'needs_information', 'pending') THEN
        RAISE EXCEPTION 'Invalid verification status transition from % to %.',
            OLD.status, NEW.status;
    END IF;
    IF NEW.status IN ('approved', 'rejected') AND NEW.reviewed_by IS NULL THEN
        RAISE EXCEPTION 'A reviewer is required to approve or reject a verification.';
    END IF;
    NEW.reviewed_at := CASE
        WHEN NEW.status IN ('approved', 'rejected') THEN COALESCE(NEW.reviewed_at, NOW())
        ELSE NULL
    END;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_user_residency_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.barangay_id IS DISTINCT FROM OLD.barangay_id
       AND EXISTS (
           SELECT 1
           FROM "Students" s
           JOIN "Applications" a ON a.student_id = s.student_id
           WHERE s.user_id = OLD.user_id
             AND a.barangay_id IS DISTINCT FROM NEW.barangay_id
             AND a.application_status <> 'withdrawn'
       ) THEN
        RAISE EXCEPTION 'Residency cannot be changed while it conflicts with an existing application.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_lgu_admin_funding_unit()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.funding_unit_id IS NULL THEN
        RAISE EXCEPTION 'Every LGU Admin must be assigned to one funding unit.';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM "Users" u
        JOIN "Roles" r ON r.role_id = u.role_id
        WHERE u.user_id = NEW.user_id
          AND r.role_name = 'LGU Admin'
    ) THEN
        RAISE EXCEPTION 'LGU_Admins profiles must belong to users with the LGU Admin role.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_program_budget_totals()
RETURNS TRIGGER AS $$
DECLARE
    allocated_total NUMERIC(14,2);
BEGIN
    IF NEW.total_budget <> NEW.remaining_budget + NEW.released_budget THEN
        RAISE EXCEPTION 'Program total_budget must equal remaining_budget plus released_budget.';
    END IF;
    IF NEW.reserved_budget > NEW.remaining_budget THEN
        RAISE EXCEPTION 'Program reserved budget cannot exceed undistributed remaining budget.';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.total_budget IS DISTINCT FROM OLD.total_budget THEN
        SELECT COALESCE(SUM(allocated_amount), 0)
        INTO allocated_total
        FROM "Program_Barangay_Allocations"
        WHERE program_id = NEW.program_id;
        IF allocated_total > NEW.total_budget THEN
            RAISE EXCEPTION 'Program total budget cannot be less than its barangay allocations.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_program_barangay_allocation()
RETURNS TRIGGER AS $$
DECLARE
    program_budget NUMERIC(14,2);
    existing_allocations NUMERIC(14,2);
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.program_id IS DISTINCT FROM OLD.program_id
            OR NEW.barangay_id IS DISTINCT FROM OLD.barangay_id) THEN
        RAISE EXCEPTION 'Program and barangay cannot be changed on an existing allocation.';
    END IF;

    SELECT total_budget
    INTO program_budget
    FROM "Funding_Programs"
    WHERE program_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.program_id ELSE NEW.program_id END
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Funding program not found for barangay allocation.';
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.reserved_amount <> 0 OR OLD.released_amount <> 0 THEN
            RAISE EXCEPTION 'An allocation with committed or released funds cannot be deleted.';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT COALESCE(SUM(allocated_amount), 0)
        INTO existing_allocations
        FROM "Program_Barangay_Allocations"
        WHERE program_id = NEW.program_id;
    ELSE
        SELECT COALESCE(SUM(allocated_amount), 0)
        INTO existing_allocations
        FROM "Program_Barangay_Allocations"
        WHERE program_id = NEW.program_id
          AND allocation_id <> OLD.allocation_id;
    END IF;

    IF existing_allocations + NEW.allocated_amount > program_budget THEN
        RAISE EXCEPTION 'Total barangay allocations cannot exceed the program total budget.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_student_funding_record()
RETURNS TRIGGER AS $$
DECLARE
    award_student_id INTEGER;
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.student_id IS DISTINCT FROM OLD.student_id
            OR NEW.funding_cycle_id IS DISTINCT FROM OLD.funding_cycle_id) THEN
        RAISE EXCEPTION 'Student and funding cycle cannot be changed on an existing funding record.';
    END IF;

    PERFORM 1
    FROM "Students"
    WHERE student_id = NEW.student_id
    FOR UPDATE;

    IF NEW.award_id IS NOT NULL THEN
        SELECT a.student_id
        INTO award_student_id
        FROM "Scholarship_Awards" award
        JOIN "Applications" a ON a.application_id = award.application_id
        WHERE award.award_id = NEW.award_id;

        IF award_student_id IS DISTINCT FROM NEW.student_id THEN
            RAISE EXCEPTION 'Funding record student must match the student on its linked award.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_application_funding_unit_scope()
RETURNS TRIGGER AS $$
DECLARE
    app_program_unit_id INTEGER;
BEGIN
    SELECT funding_unit_id
    INTO app_program_unit_id
    FROM "Funding_Programs"
    WHERE program_id = NEW.program_id;

    IF app_program_unit_id IS NULL THEN
        RAISE EXCEPTION 'Application program requires an explicit funding-unit mapping.';
    END IF;

    IF NEW.assigned_reviewer_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "LGU_Admins" admin
           JOIN "Users" u ON u.user_id = admin.user_id
           JOIN "Roles" r ON r.role_id = u.role_id
           WHERE admin.user_id = NEW.assigned_reviewer_id
             AND admin.funding_unit_id = app_program_unit_id
             AND admin.is_active = TRUE
             AND u.is_active = TRUE
             AND r.role_name = 'LGU Admin'
       ) THEN
        RAISE EXCEPTION 'Application reviewer is not an active admin for its funding unit.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_funding_duplicate_check()
RETURNS TRIGGER AS $$
DECLARE
    target_student_id INTEGER;
    target_cycle_id INTEGER;
    active_count INTEGER;
    current_check_id INTEGER;
    current_result VARCHAR(30);
    next_result VARCHAR(30);
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_student_id := OLD.student_id;
        target_cycle_id := OLD.funding_cycle_id;
    ELSE
        target_student_id := NEW.student_id;
        target_cycle_id := NEW.funding_cycle_id;
    END IF;

    SELECT COUNT(*)
    INTO active_count
    FROM "Student_Funding_Records"
    WHERE student_id = target_student_id
      AND funding_cycle_id = target_cycle_id
      AND record_status IN ('reported', 'committed', 'released');

    next_result := CASE WHEN active_count > 1
        THEN 'possible_duplicate' ELSE 'no_duplicate' END;

    SELECT duplicate_check_id, result
    INTO current_check_id, current_result
    FROM "Funding_Duplicate_Checks"
    WHERE student_id = target_student_id
      AND funding_cycle_id = target_cycle_id
      AND is_current = TRUE
    FOR UPDATE;

    IF FOUND AND current_result = 'confirmed_duplicate' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;
    IF FOUND AND current_result = next_result THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF FOUND THEN
        UPDATE "Funding_Duplicate_Checks"
        SET is_current = FALSE
        WHERE duplicate_check_id = current_check_id;
    END IF;

    INSERT INTO "Funding_Duplicate_Checks" (
        student_id, funding_cycle_id, result, evidence
    ) VALUES (
        target_student_id,
        target_cycle_id,
        next_result,
        CASE WHEN active_count > 1
            THEN 'Multiple active funding records exist for this student and cycle.'
            ELSE NULL
        END
    ) RETURNING duplicate_check_id INTO current_check_id;

    INSERT INTO "Audit_Logs" (
        action_type, entity_type, entity_id, details
    ) VALUES (
        'funding_duplicate_check_updated',
        'Funding_Duplicate_Checks',
        current_check_id,
        jsonb_build_object(
            'student_id', target_student_id,
            'funding_cycle_id', target_cycle_id,
            'result', next_result
        )
    );
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_program_funding_scope()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.funding_unit_id IS NULL OR NEW.funding_cycle_id IS NULL THEN
        RAISE EXCEPTION 'Every funding program must belong to one funding unit and funding cycle.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_award_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.award_status <> 'pending' THEN
            RAISE EXCEPTION 'Scholarship awards must be created in pending status.';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.award_status IS DISTINCT FROM OLD.award_status THEN
        IF OLD.award_status = 'approved' THEN
            RAISE EXCEPTION 'Approved awards cannot be changed without a dedicated reservation-release workflow.';
        END IF;
        IF NEW.award_status = 'approved'
           AND current_setting('grantwise.internal_award_approval', TRUE) IS DISTINCT FROM 'on' THEN
            RAISE EXCEPTION 'Awards can only be approved through approve_award().';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_disbursement_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'pending' THEN
            RAISE EXCEPTION 'Disbursements must be created in pending status.';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF OLD.status = 'released' THEN
            RAISE EXCEPTION 'Released disbursements cannot be reopened or changed.';
        END IF;
        IF NEW.status = 'released'
           AND current_setting('grantwise.internal_disbursement_release', TRUE) IS DISTINCT FROM 'on' THEN
            RAISE EXCEPTION 'Disbursements can only be released through release_disbursement().';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION approve_award(p_award_id INTEGER, p_approved_by INTEGER)
RETURNS VOID AS $$
DECLARE
    award_record RECORD;
    application_record RECORD;
    program_record RECORD;
    barangay_id_value INTEGER;
    allocation_record RECORD;
    actor_authorized BOOLEAN;
    existing_funding_count INTEGER;
    duplicate_result VARCHAR(30);
BEGIN
    SELECT * INTO award_record
    FROM "Scholarship_Awards"
    WHERE award_id = p_award_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Award not found.';
    END IF;

    IF award_record.award_status = 'approved' THEN
        RETURN;
    END IF;
    IF award_record.award_status <> 'pending' THEN
        RAISE EXCEPTION 'Only a pending award can be approved.';
    END IF;

    SELECT * INTO application_record
    FROM "Applications"
    WHERE application_id = award_record.application_id
    FOR UPDATE;

    IF application_record.program_id IS DISTINCT FROM award_record.program_id THEN
        RAISE EXCEPTION 'Award program must match the application program.';
    END IF;

    IF application_record.application_status <> 'approved' THEN
        RAISE EXCEPTION 'The application must be approved before its award.';
    END IF;

    SELECT u.barangay_id INTO barangay_id_value
    FROM "Applications" a
    JOIN "Students" s ON s.student_id = a.student_id
    JOIN "Users" u ON u.user_id = s.user_id
    WHERE a.application_id = award_record.application_id;

    IF barangay_id_value IS NULL THEN
        RAISE EXCEPTION 'Student residency barangay is missing for this award.';
    END IF;
    IF application_record.barangay_id IS DISTINCT FROM barangay_id_value THEN
        RAISE EXCEPTION 'Application barangay does not match the student residency barangay.';
    END IF;

    PERFORM 1
    FROM "Students"
    WHERE student_id = application_record.student_id
    FOR UPDATE;

    SELECT * INTO allocation_record
    FROM "Program_Barangay_Allocations"
    WHERE program_id = award_record.program_id
      AND barangay_id = barangay_id_value
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No allocation exists for this program and student barangay.';
    END IF;

    SELECT * INTO program_record
    FROM "Funding_Programs"
    WHERE program_id = award_record.program_id
    FOR UPDATE;

    IF program_record.funding_unit_id IS NULL
       OR program_record.funding_cycle_id IS NULL THEN
        RAISE EXCEPTION 'Funding program unit and cycle require explicit legacy mapping.';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM "LGU_Admins" admin
        JOIN "Users" u ON u.user_id = admin.user_id
        JOIN "Roles" r ON r.role_id = u.role_id
        WHERE admin.user_id = p_approved_by
          AND admin.funding_unit_id = program_record.funding_unit_id
          AND admin.is_active = TRUE
          AND u.is_active = TRUE
          AND r.role_name = 'LGU Admin'
    ) INTO actor_authorized;
    IF NOT actor_authorized THEN
        RAISE EXCEPTION 'Approver is not an active admin for this funding unit.';
    END IF;

    SELECT COUNT(*)
    INTO existing_funding_count
    FROM "Student_Funding_Records"
    WHERE student_id = application_record.student_id
      AND funding_cycle_id = program_record.funding_cycle_id
      AND record_status IN ('reported', 'committed', 'released');

    IF existing_funding_count > 0 THEN
        RAISE EXCEPTION 'Existing funding records for this student and cycle must be resolved before approval.';
    END IF;

    SELECT result INTO duplicate_result
    FROM "Funding_Duplicate_Checks"
    WHERE student_id = application_record.student_id
      AND funding_cycle_id = program_record.funding_cycle_id
      AND is_current = TRUE
    FOR UPDATE;

    IF duplicate_result IN ('possible_duplicate', 'confirmed_duplicate') THEN
        RAISE EXCEPTION 'The current duplicate-funding determination must be resolved before approval.';
    END IF;

    IF program_record.remaining_budget - program_record.reserved_budget
       < award_record.award_amount THEN
        RAISE EXCEPTION 'Not enough available program budget for award approval.';
    END IF;
    IF allocation_record.allocated_amount - allocation_record.reserved_amount
       - allocation_record.released_amount < award_record.award_amount THEN
        RAISE EXCEPTION 'Barangay program allocation is insufficient for award approval.';
    END IF;

    UPDATE "Funding_Programs"
    SET reserved_budget = reserved_budget + award_record.award_amount
    WHERE program_id = award_record.program_id;

    UPDATE "Program_Barangay_Allocations"
    SET reserved_amount = reserved_amount + award_record.award_amount,
        updated_at = NOW()
    WHERE allocation_id = allocation_record.allocation_id;

    PERFORM set_config('grantwise.internal_award_approval', 'on', TRUE);
    UPDATE "Scholarship_Awards"
    SET award_status = 'approved',
        approved_by = p_approved_by,
        notes = COALESCE(notes, '')
    WHERE award_id = p_award_id;
    PERFORM set_config('grantwise.internal_award_approval', 'off', TRUE);

    INSERT INTO "Student_Funding_Records" (
        student_id, funding_cycle_id, funding_unit_id, program_id, award_id,
        source_type, record_status, amount, source_name
    ) VALUES (
        application_record.student_id, program_record.funding_cycle_id,
        program_record.funding_unit_id, award_record.program_id, p_award_id,
        'grantwise', 'committed', award_record.award_amount, program_record.program_name
    ) ON CONFLICT (award_id) WHERE award_id IS NOT NULL DO NOTHING;

    INSERT INTO "Audit_Logs" (
        user_id, action_type, entity_type, entity_id, details
    ) VALUES (
        p_approved_by, 'award_approved', 'Scholarship_Awards', p_award_id,
        jsonb_build_object(
            'program_id', award_record.program_id,
            'funding_unit_id', program_record.funding_unit_id,
            'barangay_id', barangay_id_value,
            'amount_reserved', award_record.award_amount
        )
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION release_disbursement(
    p_disbursement_id INTEGER,
    p_released_by INTEGER
)
RETURNS VOID AS $$
DECLARE
    disbursement_record RECORD;
    award_record RECORD;
    application_record RECORD;
    program_record RECORD;
    barangay_id_value INTEGER;
    allocation_record RECORD;
    released_before NUMERIC(14,2);
    actor_authorized BOOLEAN;
BEGIN
    SELECT * INTO disbursement_record
    FROM "Disbursements"
    WHERE disbursement_id = p_disbursement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Disbursement not found.';
    END IF;

    IF disbursement_record.status = 'released' THEN
        RETURN;
    END IF;
    IF disbursement_record.status NOT IN ('pending', 'eligible') THEN
        RAISE EXCEPTION 'Only a pending or eligible disbursement can be released.';
    END IF;

    SELECT * INTO award_record
    FROM "Scholarship_Awards"
    WHERE award_id = disbursement_record.award_id
    FOR UPDATE;

    SELECT * INTO application_record
    FROM "Applications"
    WHERE application_id = award_record.application_id
    FOR UPDATE;

    IF award_record.award_status <> 'approved' THEN
        RAISE EXCEPTION 'The award must be approved before disbursement.';
    END IF;

    PERFORM 1
    FROM "Students"
    WHERE student_id = application_record.student_id
    FOR UPDATE;

    SELECT u.barangay_id INTO barangay_id_value
    FROM "Applications" a
    JOIN "Students" s ON s.student_id = a.student_id
    JOIN "Users" u ON u.user_id = s.user_id
    WHERE a.application_id = award_record.application_id;

    IF barangay_id_value IS NULL THEN
        RAISE EXCEPTION 'Student residency barangay is missing for disbursement release.';
    END IF;

    SELECT * INTO allocation_record
    FROM "Program_Barangay_Allocations"
    WHERE program_id = award_record.program_id
      AND barangay_id = barangay_id_value
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No allocation exists for this program and student barangay.';
    END IF;

    SELECT * INTO program_record
    FROM "Funding_Programs"
    WHERE program_id = award_record.program_id
    FOR UPDATE;

    SELECT EXISTS (
        SELECT 1
        FROM "LGU_Admins" admin
        JOIN "Users" u ON u.user_id = admin.user_id
        JOIN "Roles" r ON r.role_id = u.role_id
        WHERE admin.user_id = p_released_by
          AND admin.funding_unit_id = program_record.funding_unit_id
          AND admin.is_active = TRUE
          AND u.is_active = TRUE
          AND r.role_name = 'LGU Admin'
    ) INTO actor_authorized;
    IF NOT actor_authorized THEN
        RAISE EXCEPTION 'Releaser is not an active admin for this funding unit.';
    END IF;

    IF program_record.remaining_budget < disbursement_record.amount
       OR program_record.reserved_budget < disbursement_record.amount THEN
        RAISE EXCEPTION 'Program funds are insufficient or not reserved for this release.';
    END IF;
    IF allocation_record.reserved_amount < disbursement_record.amount THEN
        RAISE EXCEPTION 'Barangay allocation funds are insufficient or not reserved for this release.';
    END IF;

    SELECT COALESCE(SUM(amount), 0)
    INTO released_before
    FROM "Disbursements"
    WHERE award_id = award_record.award_id
      AND status = 'released'
      AND disbursement_id <> p_disbursement_id;
    IF released_before + disbursement_record.amount > award_record.award_amount THEN
        RAISE EXCEPTION 'Cumulative disbursements cannot exceed the award amount.';
    END IF;

    UPDATE "Funding_Programs"
    SET remaining_budget = remaining_budget - disbursement_record.amount,
        reserved_budget = reserved_budget - disbursement_record.amount,
        released_budget = released_budget + disbursement_record.amount
    WHERE program_id = award_record.program_id;

    UPDATE "Program_Barangay_Allocations"
    SET reserved_amount = reserved_amount - disbursement_record.amount,
        released_amount = released_amount + disbursement_record.amount,
        updated_at = NOW()
    WHERE allocation_id = allocation_record.allocation_id;

    PERFORM set_config('grantwise.internal_disbursement_release', 'on', TRUE);
    UPDATE "Disbursements"
    SET status = 'released',
        released_at = NOW()
    WHERE disbursement_id = p_disbursement_id;
    PERFORM set_config('grantwise.internal_disbursement_release', 'off', TRUE);

    IF released_before + disbursement_record.amount >= award_record.award_amount THEN
        UPDATE "Student_Funding_Records"
        SET record_status = 'released',
            released_amount = amount,
            updated_at = NOW()
        WHERE award_id = award_record.award_id;
    ELSE
        UPDATE "Student_Funding_Records"
        SET released_amount = released_before + disbursement_record.amount,
            updated_at = NOW()
        WHERE award_id = award_record.award_id;
    END IF;

    INSERT INTO "Audit_Logs" (
        user_id, action_type, entity_type, entity_id, details
    ) VALUES (
        p_released_by, 'disbursement_released', 'Disbursements', p_disbursement_id,
        jsonb_build_object(
            'award_id', award_record.award_id,
            'program_id', award_record.program_id,
            'barangay_id', barangay_id_value,
            'amount_released', disbursement_record.amount
        )
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION release_disbursement(p_disbursement_id INTEGER)
RETURNS VOID AS $$
BEGIN
    RAISE EXCEPTION
        'Authorized release requires release_disbursement(disbursement_id, lgu_admin_user_id).';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_application_barangay_check ON "Applications";
CREATE TRIGGER trg_application_barangay_check
BEFORE INSERT OR UPDATE OF student_id, barangay_id
ON "Applications"
FOR EACH ROW
EXECUTE FUNCTION validate_application_barangay();

DROP TRIGGER IF EXISTS trg_application_status_transition ON "Applications";
CREATE TRIGGER trg_application_status_transition
BEFORE INSERT OR UPDATE OF application_status
ON "Applications"
FOR EACH ROW
EXECUTE FUNCTION validate_application_status_transition();

DROP TRIGGER IF EXISTS trg_application_funding_unit_scope ON "Applications";
CREATE TRIGGER trg_application_funding_unit_scope
BEFORE INSERT OR UPDATE OF program_id, assigned_reviewer_id
ON "Applications"
FOR EACH ROW
EXECUTE FUNCTION validate_application_funding_unit_scope();

DROP TRIGGER IF EXISTS trg_initialize_application_verification ON "Applications";
CREATE TRIGGER trg_initialize_application_verification
AFTER INSERT OR UPDATE OF application_status
ON "Applications"
FOR EACH ROW
WHEN (NEW.application_status = 'submitted')
EXECUTE FUNCTION initialize_application_verification();

DROP TRIGGER IF EXISTS trg_grade_report_school_scope ON "Grade_Reports";
CREATE TRIGGER trg_grade_report_school_scope
BEFORE INSERT OR UPDATE OF student_id, registrar_id
ON "Grade_Reports"
FOR EACH ROW
EXECUTE FUNCTION validate_registrar_school_scope();

DROP TRIGGER IF EXISTS trg_validate_application_verification_scope ON "Application_Verifications";
CREATE TRIGGER trg_validate_application_verification_scope
BEFORE INSERT OR UPDATE OF reviewed_by, status
ON "Application_Verifications"
FOR EACH ROW
EXECUTE FUNCTION validate_application_verification_scope();

DROP TRIGGER IF EXISTS trg_validate_application_verification_transition ON "Application_Verifications";
CREATE TRIGGER trg_validate_application_verification_transition
BEFORE INSERT OR UPDATE OF status
ON "Application_Verifications"
FOR EACH ROW
EXECUTE FUNCTION validate_application_verification_transition();

DROP TRIGGER IF EXISTS trg_advance_application_verification ON "Application_Verifications";
CREATE TRIGGER trg_advance_application_verification
AFTER UPDATE OF status
ON "Application_Verifications"
FOR EACH ROW
EXECUTE FUNCTION advance_application_verification();

DROP TRIGGER IF EXISTS trg_validate_award_status_transition ON "Scholarship_Awards";
CREATE TRIGGER trg_validate_award_status_transition
BEFORE INSERT OR UPDATE OF award_status
ON "Scholarship_Awards"
FOR EACH ROW
EXECUTE FUNCTION validate_award_status_transition();

DROP TRIGGER IF EXISTS trg_validate_disbursement_status_transition ON "Disbursements";
CREATE TRIGGER trg_validate_disbursement_status_transition
BEFORE INSERT OR UPDATE OF status
ON "Disbursements"
FOR EACH ROW
EXECUTE FUNCTION validate_disbursement_status_transition();

DROP TRIGGER IF EXISTS trg_eligibility_check_school_scope ON "Eligibility_Checks";
CREATE TRIGGER trg_eligibility_check_school_scope
BEFORE INSERT OR UPDATE OF student_id, registrar_id
ON "Eligibility_Checks"
FOR EACH ROW
EXECUTE FUNCTION validate_registrar_school_scope();

DROP TRIGGER IF EXISTS trg_validate_program_funding_scope ON "Funding_Programs";
CREATE TRIGGER trg_validate_program_funding_scope
BEFORE INSERT OR UPDATE OF funding_unit_id, funding_cycle_id
ON "Funding_Programs"
FOR EACH ROW
EXECUTE FUNCTION validate_program_funding_scope();

DROP TRIGGER IF EXISTS trg_validate_program_budget_totals ON "Funding_Programs";
CREATE TRIGGER trg_validate_program_budget_totals
BEFORE INSERT OR UPDATE OF total_budget, remaining_budget, reserved_budget, released_budget
ON "Funding_Programs"
FOR EACH ROW
EXECUTE FUNCTION validate_program_budget_totals();

DROP TRIGGER IF EXISTS trg_validate_program_barangay_allocation ON "Program_Barangay_Allocations";
CREATE TRIGGER trg_validate_program_barangay_allocation
BEFORE INSERT OR UPDATE OF allocated_amount, program_id, barangay_id
ON "Program_Barangay_Allocations"
FOR EACH ROW
EXECUTE FUNCTION validate_program_barangay_allocation();

DROP TRIGGER IF EXISTS trg_validate_program_barangay_allocation_delete ON "Program_Barangay_Allocations";
CREATE TRIGGER trg_validate_program_barangay_allocation_delete
BEFORE DELETE
ON "Program_Barangay_Allocations"
FOR EACH ROW
EXECUTE FUNCTION validate_program_barangay_allocation();

DROP TRIGGER IF EXISTS trg_validate_lgu_admin_funding_unit ON "LGU_Admins";
CREATE TRIGGER trg_validate_lgu_admin_funding_unit
BEFORE INSERT OR UPDATE OF funding_unit_id
ON "LGU_Admins"
FOR EACH ROW
EXECUTE FUNCTION validate_lgu_admin_funding_unit();

DROP TRIGGER IF EXISTS trg_validate_student_funding_record ON "Student_Funding_Records";
CREATE TRIGGER trg_validate_student_funding_record
BEFORE INSERT OR UPDATE OF student_id, program_id, funding_unit_id, funding_cycle_id, award_id, record_status
ON "Student_Funding_Records"
FOR EACH ROW
EXECUTE FUNCTION validate_student_funding_record();

DROP TRIGGER IF EXISTS trg_update_funding_duplicate_check ON "Student_Funding_Records";
CREATE TRIGGER trg_update_funding_duplicate_check
AFTER INSERT OR UPDATE OF record_status OR DELETE
ON "Student_Funding_Records"
FOR EACH ROW
EXECUTE FUNCTION update_funding_duplicate_check();

DROP TRIGGER IF EXISTS trg_validate_user_residency_change ON "Users";
CREATE TRIGGER trg_validate_user_residency_change
BEFORE UPDATE OF barangay_id
ON "Users"
FOR EACH ROW
EXECUTE FUNCTION validate_user_residency_change();

INSERT INTO "Funding_Units" (funding_unit_name, description)
VALUES
    ('City Scholarship Office', 'City-level scholarship funding unit'),
    ('Sangguniang Panlungsod / District Fund', 'City council or district scholarship funding unit'),
    ('Barangay Educational Assistance Programs', 'Barangay educational assistance funding unit')
ON CONFLICT (funding_unit_name) DO NOTHING;

INSERT INTO "Roles" (role_name, description)
VALUES
    ('LGU Admin', 'Local government scholarship administrator'),
    ('Barangay Coordinator', 'Barangay-linked coordinator for student verification and endorsements'),
    ('Registrar', 'School registrar responsible for validating student academic records'),
    ('Scholar', 'Approved scholarship applicant or awardee')
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO "Barangays" (barangay_name)
VALUES
    ('Bool'),
    ('Booy'),
    ('Cabawan'),
    ('Cogon'),
    ('Dampas'),
    ('Dao'),
    ('Manga'),
    ('Mansasa'),
    ('Poblacion I'),
    ('Poblacion II'),
    ('Poblacion III'),
    ('San Isidro'),
    ('Taloto'),
    ('Tiptip'),
    ('Ubujan')
ON CONFLICT (barangay_name) DO NOTHING;

INSERT INTO "Schools" (school_name)
VALUES
    ('Holy Name University'),
    ('BISU-Tagbilaran'),
    ('University of Bohol'),
    ('Tagbilaran City College'),
    ('PMI Colleges Main Branch')
ON CONFLICT (school_name) DO NOTHING;

COMMIT;
