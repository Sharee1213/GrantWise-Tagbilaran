-- Additive staff-portal prerequisites for the legacy database.
-- Review and reconcile legacy program/admin mappings before applying.
BEGIN;

DO $$
BEGIN
    IF to_regclass('"Users"') IS NULL
       OR to_regclass('"Roles"') IS NULL
       OR to_regclass('"LGU_Admins"') IS NULL
       OR to_regclass('"Barangay_Coordinators"') IS NULL
       OR to_regclass('"Registrars"') IS NULL
       OR to_regclass('"Funding_Programs"') IS NULL
       OR to_regclass('"Applications"') IS NULL
       OR to_regclass('"Scholarship_Awards"') IS NULL
       OR to_regclass('"Grade_Reports"') IS NULL
       OR to_regclass('"Eligibility_Checks"') IS NULL
       OR to_regclass('"Student_Funding_Records"') IS NULL
       OR to_regclass('"Funding_Duplicate_Checks"') IS NULL
       OR to_regclass('"Audit_Logs"') IS NULL
       OR to_regprocedure('approve_award(integer,integer)') IS NULL THEN
        RAISE EXCEPTION 'Staff portal migration prerequisites are missing; no changes were applied.';
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "Funding_Units" (
    funding_unit_id SERIAL PRIMARY KEY,
    funding_unit_name VARCHAR(200) NOT NULL UNIQUE,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO "Funding_Units" (funding_unit_name, description)
VALUES
    ('City Scholarship Office', 'City-level scholarship funding unit'),
    ('Sangguniang Panlungsod / District Fund', 'City council or district scholarship funding unit'),
    ('Barangay Educational Assistance Programs', 'Barangay educational assistance funding unit')
ON CONFLICT (funding_unit_name) DO NOTHING;

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

ALTER TABLE "LGU_Admins"
    ADD COLUMN IF NOT EXISTS funding_unit_id INTEGER
        REFERENCES "Funding_Units"(funding_unit_id);
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

CREATE TABLE IF NOT EXISTS "Application_Verifications" (
    verification_id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL
        REFERENCES "Applications"(application_id) ON DELETE CASCADE,
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_application_verifications_one_pending
    ON "Application_Verifications" (application_id)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_application_verifications_type_status
    ON "Application_Verifications" (verification_type, status);
CREATE INDEX IF NOT EXISTS idx_program_barangay_allocations_barangay
    ON "Program_Barangay_Allocations" (barangay_id, program_id);
CREATE INDEX IF NOT EXISTS idx_funding_programs_unit_cycle
    ON "Funding_Programs" (funding_unit_id, funding_cycle_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '"Funding_Programs"'::regclass
          AND conname = 'chk_program_budget_reservations'
    ) THEN
        ALTER TABLE "Funding_Programs"
            ADD CONSTRAINT chk_program_budget_reservations
            CHECK (remaining_budget >= 0 AND reserved_budget >= 0
                AND released_budget >= 0 AND reserved_budget <= remaining_budget)
            NOT VALID;
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

CREATE OR REPLACE FUNCTION validate_application_status_transition()
RETURNS TRIGGER AS $$
DECLARE
    allowed_transition BOOLEAN := FALSE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.application_status <> 'draft' THEN
            RAISE EXCEPTION 'Applications must be created as drafts.';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.application_status = OLD.application_status THEN
        RETURN NEW;
    END IF;
    IF OLD.application_status = 'draft' AND NEW.application_status = 'submitted' THEN
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
       AND NEW.application_status IN ('approved', 'rejected')
       AND EXISTS (
           SELECT 1 FROM "Application_Verifications"
           WHERE application_id = OLD.application_id
             AND verification_type = 'lgu'
             AND status = CASE NEW.application_status
                 WHEN 'approved' THEN 'approved' ELSE 'rejected' END
       ) THEN
        allowed_transition := TRUE;
    ELSIF OLD.application_status IN ('draft', 'submitted')
       AND NEW.application_status = 'withdrawn' THEN
        allowed_transition := TRUE;
    END IF;
    IF NOT allowed_transition THEN
        RAISE EXCEPTION 'Invalid application status transition.';
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_application_barangay()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Users" user_record
        JOIN "Students" student ON student.user_id = user_record.user_id
        WHERE student.student_id = NEW.student_id
          AND user_record.barangay_id IS DISTINCT FROM NEW.barangay_id
    ) THEN
        RAISE EXCEPTION 'Application barangay must match the student residency barangay.';
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
        FROM "Users" user_record
        JOIN "Roles" role_record ON role_record.role_id = user_record.role_id
        WHERE user_record.user_id = NEW.user_id
          AND role_record.role_name = 'LGU Admin'
    ) THEN
        RAISE EXCEPTION 'Funding-unit assignments are only valid for LGU Admin accounts.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_award_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.award_status <> 'pending' THEN
        RAISE EXCEPTION 'Scholarship awards must begin in pending status.';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.award_status IS DISTINCT FROM OLD.award_status THEN
        IF OLD.award_status = 'approved' THEN
            RAISE EXCEPTION 'Approved awards cannot be changed without a reservation-release workflow.';
        END IF;
        IF NEW.award_status = 'approved'
           AND current_setting('grantwise.internal_award_approval', TRUE)
               IS DISTINCT FROM 'on' THEN
            RAISE EXCEPTION 'Awards can only be approved through approve_award().';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_application_funding_unit_scope()
RETURNS TRIGGER AS $$
DECLARE
    unit_id INTEGER;
BEGIN
    SELECT funding_unit_id INTO unit_id
    FROM "Funding_Programs"
    WHERE program_id = NEW.program_id;
    IF unit_id IS NULL THEN
        RAISE EXCEPTION 'Application program requires an explicit funding-unit mapping.';
    END IF;
    IF NEW.assigned_reviewer_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "LGU_Admins" admin
        JOIN "Users" user_record ON user_record.user_id = admin.user_id
        JOIN "Roles" role_record ON role_record.role_id = user_record.role_id
        WHERE admin.user_id = NEW.assigned_reviewer_id
          AND admin.funding_unit_id = unit_id
          AND admin.is_active = TRUE AND user_record.is_active = TRUE
          AND role_record.role_name = 'LGU Admin'
    ) THEN
        RAISE EXCEPTION 'Application reviewer is outside the program funding unit.';
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

CREATE OR REPLACE FUNCTION validate_application_verification_scope()
RETURNS TRIGGER AS $$
DECLARE
    app_record RECORD;
    unit_id INTEGER;
    actor_matches BOOLEAN := FALSE;
BEGIN
    IF NEW.reviewed_by IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT app.barangay_id, student.school_id, app.program_id
    INTO app_record
    FROM "Applications" app
    JOIN "Students" student ON student.student_id = app.student_id
    WHERE app.application_id = NEW.application_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application not found for verification.';
    END IF;

    IF NEW.verification_type = 'barangay' THEN
        SELECT EXISTS (
            SELECT 1 FROM "Barangay_Coordinators" coordinator
            JOIN "Users" user_record ON user_record.user_id = coordinator.user_id
            JOIN "Roles" role_record ON role_record.role_id = user_record.role_id
            WHERE coordinator.user_id = NEW.reviewed_by
              AND coordinator.barangay_id = app_record.barangay_id
              AND coordinator.is_current = TRUE
              AND coordinator.term_start <= CURRENT_DATE
              AND (coordinator.term_end IS NULL OR coordinator.term_end >= CURRENT_DATE)
              AND user_record.is_active = TRUE
              AND role_record.role_name = 'Barangay Coordinator'
        ) INTO actor_matches;
    ELSIF NEW.verification_type = 'registrar' THEN
        SELECT EXISTS (
            SELECT 1 FROM "Registrars" registrar
            JOIN "Users" user_record ON user_record.user_id = registrar.user_id
            JOIN "Roles" role_record ON role_record.role_id = user_record.role_id
            WHERE registrar.user_id = NEW.reviewed_by
              AND registrar.school_id = app_record.school_id
              AND registrar.is_active = TRUE AND user_record.is_active = TRUE
              AND role_record.role_name = 'Registrar'
        ) INTO actor_matches;
    ELSE
        SELECT funding_unit_id INTO unit_id
        FROM "Funding_Programs"
        WHERE program_id = app_record.program_id;
        SELECT EXISTS (
            SELECT 1 FROM "LGU_Admins" admin
            JOIN "Users" user_record ON user_record.user_id = admin.user_id
            JOIN "Roles" role_record ON role_record.role_id = user_record.role_id
            WHERE admin.user_id = NEW.reviewed_by
              AND admin.funding_unit_id = unit_id
              AND admin.is_active = TRUE AND user_record.is_active = TRUE
              AND role_record.role_name = 'LGU Admin'
        ) INTO actor_matches;
    END IF;
    IF NOT actor_matches THEN
        RAISE EXCEPTION 'Reviewer is outside the verification assignment scope.';
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
                SELECT 1 FROM "Applications" application
                JOIN "Application_Verifications" previous
                  ON previous.application_id = application.application_id
                WHERE application.application_id = NEW.application_id
                  AND application.application_status = 'registrar_verification'
                  AND previous.verification_type = 'barangay'
                  AND previous.status = 'approved'
            ))
            OR (NEW.verification_type = 'lgu' AND EXISTS (
                SELECT 1 FROM "Applications" application
                JOIN "Application_Verifications" previous
                  ON previous.application_id = application.application_id
                WHERE application.application_id = NEW.application_id
                  AND application.application_status = 'lgu_review'
                  AND previous.verification_type = 'registrar'
                  AND previous.status = 'approved'
            ))
        ) THEN
            RAISE EXCEPTION 'Verification tasks cannot skip workflow stages.';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;
    IF OLD.status NOT IN ('pending', 'needs_information')
       OR NEW.status NOT IN ('approved', 'rejected', 'needs_information', 'pending') THEN
        RAISE EXCEPTION 'Invalid verification status transition.';
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
            THEN (SELECT coordinator_id FROM "Barangay_Coordinators"
                  WHERE user_id = NEW.reviewed_by)
            ELSE endorsed_by
        END,
        reviewed_at = COALESCE(NEW.reviewed_at, NOW())
    WHERE application_id = NEW.application_id;
    IF NEW.status = 'approved' AND NEW.verification_type IN ('barangay', 'registrar') THEN
        INSERT INTO "Application_Verifications" (
            application_id, verification_type, status
        ) VALUES (
            NEW.application_id,
            CASE NEW.verification_type
                WHEN 'barangay' THEN 'registrar' ELSE 'lgu' END,
            'pending'
        ) ON CONFLICT (application_id, verification_type) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_program_funding_scope()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.funding_unit_id IS NULL OR NEW.funding_cycle_id IS NULL THEN
        RAISE EXCEPTION 'Every funding program must have a unit and cycle mapping.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_program_budget_totals()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.total_budget <> NEW.remaining_budget + NEW.released_budget THEN
        RAISE EXCEPTION 'Program total budget must equal remaining plus released budget.';
    END IF;
    IF NEW.reserved_budget > NEW.remaining_budget THEN
        RAISE EXCEPTION 'Reserved budget cannot exceed remaining budget.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_program_barangay_allocation()
RETURNS TRIGGER AS $$
DECLARE
    program_budget NUMERIC(14,2);
    other_allocations NUMERIC(14,2);
BEGIN
    SELECT total_budget INTO program_budget
    FROM "Funding_Programs"
    WHERE program_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.program_id ELSE NEW.program_id END
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Funding program not found for barangay allocation.';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF OLD.reserved_amount <> 0 OR OLD.released_amount <> 0 THEN
            RAISE EXCEPTION 'An allocation with reserved or released funds cannot be deleted.';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT COALESCE(SUM(allocated_amount), 0) INTO other_allocations
        FROM "Program_Barangay_Allocations" WHERE program_id = NEW.program_id;
    ELSE
        IF NEW.program_id IS DISTINCT FROM OLD.program_id
           OR NEW.barangay_id IS DISTINCT FROM OLD.barangay_id THEN
            RAISE EXCEPTION 'Program and barangay cannot change on an allocation.';
        END IF;
        SELECT COALESCE(SUM(allocated_amount), 0) INTO other_allocations
        FROM "Program_Barangay_Allocations"
        WHERE program_id = NEW.program_id AND allocation_id <> OLD.allocation_id;
    END IF;
    IF other_allocations + NEW.allocated_amount > program_budget THEN
        RAISE EXCEPTION 'Barangay allocations cannot exceed the program budget.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_application_barangay_check') THEN
        CREATE TRIGGER trg_application_barangay_check
        BEFORE INSERT OR UPDATE OF student_id, barangay_id ON "Applications"
        FOR EACH ROW EXECUTE FUNCTION validate_application_barangay();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_application_status_transition') THEN
        CREATE TRIGGER trg_application_status_transition
        BEFORE INSERT OR UPDATE OF application_status ON "Applications"
        FOR EACH ROW EXECUTE FUNCTION validate_application_status_transition();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_application_funding_unit_scope') THEN
        CREATE TRIGGER trg_application_funding_unit_scope
        BEFORE INSERT OR UPDATE OF program_id, assigned_reviewer_id ON "Applications"
        FOR EACH ROW EXECUTE FUNCTION validate_application_funding_unit_scope();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_initialize_application_verification') THEN
        CREATE TRIGGER trg_initialize_application_verification
        AFTER INSERT OR UPDATE OF application_status ON "Applications"
        FOR EACH ROW WHEN (NEW.application_status = 'submitted')
        EXECUTE FUNCTION initialize_application_verification();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_application_verification_scope') THEN
        CREATE TRIGGER trg_validate_application_verification_scope
        BEFORE INSERT OR UPDATE OF reviewed_by, status ON "Application_Verifications"
        FOR EACH ROW EXECUTE FUNCTION validate_application_verification_scope();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_application_verification_transition') THEN
        CREATE TRIGGER trg_validate_application_verification_transition
        BEFORE INSERT OR UPDATE OF status ON "Application_Verifications"
        FOR EACH ROW EXECUTE FUNCTION validate_application_verification_transition();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_advance_application_verification') THEN
        CREATE TRIGGER trg_advance_application_verification
        AFTER UPDATE OF status ON "Application_Verifications"
        FOR EACH ROW EXECUTE FUNCTION advance_application_verification();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_program_funding_scope') THEN
        CREATE TRIGGER trg_validate_program_funding_scope
        BEFORE INSERT OR UPDATE OF funding_unit_id, funding_cycle_id ON "Funding_Programs"
        FOR EACH ROW EXECUTE FUNCTION validate_program_funding_scope();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_program_budget_totals') THEN
        CREATE TRIGGER trg_validate_program_budget_totals
        BEFORE INSERT OR UPDATE OF total_budget, remaining_budget,
            reserved_budget, released_budget ON "Funding_Programs"
        FOR EACH ROW EXECUTE FUNCTION validate_program_budget_totals();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_lgu_admin_funding_unit') THEN
        CREATE TRIGGER trg_validate_lgu_admin_funding_unit
        BEFORE INSERT OR UPDATE OF funding_unit_id ON "LGU_Admins"
        FOR EACH ROW EXECUTE FUNCTION validate_lgu_admin_funding_unit();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_award_status_transition') THEN
        CREATE TRIGGER trg_validate_award_status_transition
        BEFORE INSERT OR UPDATE OF award_status ON "Scholarship_Awards"
        FOR EACH ROW EXECUTE FUNCTION validate_award_status_transition();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_program_barangay_allocation') THEN
        CREATE TRIGGER trg_validate_program_barangay_allocation
        BEFORE INSERT OR UPDATE OF allocated_amount, program_id, barangay_id
        ON "Program_Barangay_Allocations"
        FOR EACH ROW EXECUTE FUNCTION validate_program_barangay_allocation();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_program_barangay_allocation_delete') THEN
        CREATE TRIGGER trg_validate_program_barangay_allocation_delete
        BEFORE DELETE ON "Program_Barangay_Allocations"
        FOR EACH ROW EXECUTE FUNCTION validate_program_barangay_allocation();
    END IF;
END;
$$;

COMMIT;

-- No legacy program/admin unit or cycle mapping is guessed by this migration.
-- Populate those assignments, add at least one active Funding_Cycles row, and
-- provision active staff assignments through the approved administrative process
-- before enabling staff portal access.
