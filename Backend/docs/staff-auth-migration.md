# Staff Email Authorization, Developer Role, and School Email Verification Migration

## Overview

[`Backend/migrations/20261020_staff_auth_and_email_verification.sql`](../migrations/20261020_staff_auth_and_email_verification.sql) introduces the additive database objects required for:

1. **Developer / System Administrator Role (`System Admin`)**:
   - Added to `"Roles"` (`ON CONFLICT (role_name) DO NOTHING`).
   - Never granted via public registration; requires the auditable developer bootstrap procedure (`Backend/scripts/bootstrap-developer.js`).
   - Can open active LGU Admin, Barangay Coordinator, and Registrar dashboards in read-only, scope-specific preview mode. Student portal access is not included.
   - The bootstrap prompts for a developer password; seeded non-student demo accounts require a private `DEMO_STAFF_PASSWORD` value before running `npm run init-db`.
2. **Normalized & Verified User Emails**:
   - Adds `email_verified_at TIMESTAMPTZ` to `"Users"`.
   - Enforces `chk_users_email_normalized` and `uq_users_lower_email` (`LOWER(BTRIM(email))`).
3. **Granular LGU Permissions (`"LGU_Admins".permissions`)**:
   - Adds `permissions JSONB` to `"LGU_Admins"` (`read_only_reports`, `program_management`, `application_review`, `award_approval`, `disbursement_release`).
4. **Database-Backed School Domain Configuration (`"School_Email_Domains"`)**:
   - Maps approved partner schools in `"Schools"` to their verified or candidate institutional domains (`hnu.edu.ph`, `bisu.edu.ph`, `ub.edu.ph`, `tcc.edu.ph`, `pmi-bohol.edu.ph`).
5. **Developer-Controlled Staff Email Allowlist & Invitations (`"Staff_Email_Authorizations"`)**:
   - Enforces one organizational scope per staff role via `chk_staff_auth_single_scope` and trigger `trg_validate_staff_authorization_role_scope`.
   - Enforces unique active/pending email authorizations (`uq_staff_auth_open_email`) and unique active/pending barangay coordinator assignments (`uq_staff_auth_open_barangay`).
   - Stores only SHA-256 digests (`invitation_token_hash`) of single-use invitation tokens.
   - Backfills existing active staff accounts so existing database records remain valid without fabricating placeholder accounts.
6. **Single-Use Verification Tokens (`"Email_Verification_Tokens"`)**:
   - Stores SHA-256 token digests (`token_hash`) with expiration (`expires_at`) and single-use consumption (`consumed_at`) for `student_email_verification` and `developer_bootstrap`.

## Reversible Rollback

A commented down-migration block is included at the bottom of `20261020_staff_auth_and_email_verification.sql` to safely remove only the new tables, trigger, and columns if rollback is required before production use.
