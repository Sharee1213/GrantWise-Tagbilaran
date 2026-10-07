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
    position_title VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS "Funding_Programs" (
    program_id SERIAL PRIMARY KEY,
    program_name VARCHAR(200) NOT NULL,
    funding_cycle VARCHAR(50),
    total_budget NUMERIC(14,2) NOT NULL CHECK (total_budget >= 0),
    remaining_budget NUMERIC(14,2) NOT NULL CHECK (remaining_budget >= 0),
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date IS NULL OR end_date >= start_date)
);

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

ALTER TABLE "Disbursements"
    DROP CONSTRAINT IF EXISTS fk_disbursement_award;

ALTER TABLE "Disbursements"
    ADD CONSTRAINT fk_disbursement_award
    FOREIGN KEY (award_id) REFERENCES "Scholarship_Awards"(award_id) ON DELETE CASCADE;

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

CREATE OR REPLACE FUNCTION approve_award(p_award_id INTEGER, p_approved_by INTEGER)
RETURNS VOID AS $$
DECLARE
    award_record RECORD;
    application_record RECORD;
    program_record RECORD;
    barangay_id_value INTEGER;
    barangay_record RECORD;
BEGIN
    SELECT * INTO award_record
    FROM "Scholarship_Awards"
    WHERE award_id = p_award_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Award not found.';
    END IF;

    SELECT * INTO application_record
    FROM "Applications"
    WHERE application_id = award_record.application_id
    FOR UPDATE;

    SELECT * INTO program_record
    FROM "Funding_Programs"
    WHERE program_id = award_record.program_id
    FOR UPDATE;

    SELECT u.barangay_id INTO barangay_id_value
    FROM "Applications" a
    JOIN "Students" s ON s.student_id = a.student_id
    JOIN "Users" u ON u.user_id = s.user_id
    WHERE a.application_id = award_record.application_id;

    IF barangay_id_value IS NULL THEN
        RAISE EXCEPTION 'Student residency barangay is missing for this award.';
    END IF;

    SELECT * INTO barangay_record
    FROM "Barangays"
    WHERE barangay_id = barangay_id_value
    FOR UPDATE;

    IF program_record.remaining_budget < award_record.award_amount THEN
        RAISE EXCEPTION 'Not enough remaining program budget for award approval.';
    END IF;

    IF barangay_record.remaining_allocated_budget < award_record.award_amount THEN
        RAISE EXCEPTION 'Barangay budget allocation is insufficient for award approval.';
    END IF;

    UPDATE "Scholarship_Awards"
    SET award_status = 'approved',
        approved_by = p_approved_by,
        notes = COALESCE(notes, '')
    WHERE award_id = p_award_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION release_disbursement(p_disbursement_id INTEGER)
RETURNS VOID AS $$
DECLARE
    disbursement_record RECORD;
    award_record RECORD;
    application_record RECORD;
    program_record RECORD;
    barangay_id_value INTEGER;
    barangay_record RECORD;
BEGIN
    SELECT * INTO disbursement_record
    FROM "Disbursements"
    WHERE disbursement_id = p_disbursement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Disbursement not found.';
    END IF;

    SELECT * INTO award_record
    FROM "Scholarship_Awards"
    WHERE award_id = disbursement_record.award_id
    FOR UPDATE;

    SELECT * INTO application_record
    FROM "Applications"
    WHERE application_id = award_record.application_id
    FOR UPDATE;

    SELECT * INTO program_record
    FROM "Funding_Programs"
    WHERE program_id = award_record.program_id
    FOR UPDATE;

    SELECT u.barangay_id INTO barangay_id_value
    FROM "Applications" a
    JOIN "Students" s ON s.student_id = a.student_id
    JOIN "Users" u ON u.user_id = s.user_id
    WHERE a.application_id = award_record.application_id;

    IF barangay_id_value IS NULL THEN
        RAISE EXCEPTION 'Student residency barangay is missing for disbursement release.';
    END IF;

    SELECT * INTO barangay_record
    FROM "Barangays"
    WHERE barangay_id = barangay_id_value
    FOR UPDATE;

    IF program_record.remaining_budget < disbursement_record.amount THEN
        RAISE EXCEPTION 'Funding_Programs remaining budget is insufficient for disbursement release.';
    END IF;

    IF barangay_record.remaining_allocated_budget < disbursement_record.amount THEN
        RAISE EXCEPTION 'Barangays remaining_allocated_budget is insufficient for disbursement release.';
    END IF;

    UPDATE "Funding_Programs"
    SET remaining_budget = remaining_budget - disbursement_record.amount
    WHERE program_id = award_record.program_id;

    UPDATE "Barangays"
    SET remaining_allocated_budget = remaining_allocated_budget - disbursement_record.amount,
        allocated_budget = allocated_budget - disbursement_record.amount
    WHERE barangay_id = barangay_id_value;

    UPDATE "Disbursements"
    SET status = 'released',
        released_at = NOW()
    WHERE disbursement_id = p_disbursement_id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_application_barangay_check ON "Applications";
CREATE TRIGGER trg_application_barangay_check
BEFORE INSERT OR UPDATE OF student_id, barangay_id
ON "Applications"
FOR EACH ROW
EXECUTE FUNCTION validate_application_barangay();

DROP TRIGGER IF EXISTS trg_grade_report_school_scope ON "Grade_Reports";
CREATE TRIGGER trg_grade_report_school_scope
BEFORE INSERT OR UPDATE OF student_id, registrar_id
ON "Grade_Reports"
FOR EACH ROW
EXECUTE FUNCTION validate_registrar_school_scope();

DROP TRIGGER IF EXISTS trg_eligibility_check_school_scope ON "Eligibility_Checks";
CREATE TRIGGER trg_eligibility_check_school_scope
BEFORE INSERT OR UPDATE OF student_id, registrar_id
ON "Eligibility_Checks"
FOR EACH ROW
EXECUTE FUNCTION validate_registrar_school_scope();

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
