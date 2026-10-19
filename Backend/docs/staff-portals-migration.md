# Proposed staff-portal schema migration

This migration is a draft for older database installations only. It was not
applied by this task. A read-only inspection of the currently configured Neon
database found the required portal tables, columns, functions, triggers, and
active staff assignments already present. Do not run this draft against that
database without a fresh schema review and explicit approval.

## Why the migration is required

This migration is intended for a legacy database that lacks the staff workflow
objects. The currently configured Neon database already reports the funding
unit/cycle relationships, barangay allocations, application verifications,
award function, required workflow triggers, and active staff assignments.
Those facts were checked read-only during this task; the migration was not
applied here. Staff reads or writes must never infer missing relationships or
bypass the database workflow.

## Objects affected

[`20261019_staff_portals.sql`](../migrations/20261019_staff_portals.sql) adds:

- `"Funding_Units"` and `"Funding_Cycles"` with their key, status, and
  date-range constraints. It seeds only the three funding-unit names already
  defined by the project's source schema; it does not invent funding cycles.
- `funding_unit_id` on `"LGU_Admins"` and
  `funding_unit_id`, `funding_cycle_id`, `reserved_budget`, and
  `released_budget` on `"Funding_Programs"`.
- `"Program_Barangay_Allocations"` and
  `"Application_Verifications"` with foreign keys, uniqueness, status and
  amount constraints, and supporting indexes.
- Additive `NOT VALID` constraints for existing program budgets, statuses,
  and application statuses. PostgreSQL will enforce these constraints on
  future writes; legacy rows must be reconciled before those rows are edited.
- Trigger functions and triggers that enforce application verification
  stages, active reviewer assignment scope, unit/cycle mappings, program
  budget invariants, and award approval through the existing
  `approve_award(integer, integer)` function.

The SQL does not guess legacy program or administrator mappings and does not
create staff accounts or funding cycles. On a legacy target, an authorized
operator must reconcile program rows, assign each active LGU administrator to
a funding unit, create an active funding cycle, and provision active
coordinator/registrar assignments through the approved process. Recheck the
target's current schema and records before considering this migration; do not
infer that the currently configured Neon database needs it.

## Validation and rollout

1. Take a restorable backup and review the target database's exact schema and
   row counts; do not expose student or credential data in logs.
2. Apply this file only to a separate legacy target after confirming it lacks
   the required objects. Do not apply it to the currently configured Neon
   database, which already has those objects. Use a disposable PostgreSQL copy
   with representative
   legacy rows. Verify constraint behavior, trigger transitions, scope
   isolation, award budget reservations, and all staff API tests.
3. Review the resulting catalog objects and reconcile program, cycle, and
   staff assignments using approved records.
4. Only after explicit approval, schedule the reviewed migration for the
   intended database. Do not use the generic `init-db` route as a production
   migration mechanism.

The migration was not validated against a disposable PostgreSQL server in this
environment. The automated backend staff tests use isolated mocks and do not
replace PostgreSQL migration/trigger testing.

## Rollback considerations

The script is transactional and additive, but once operators populate new
assignments, verification tasks, allocations, or budget balances, dropping
the new tables/columns would destroy operational data and may break the
application workflow. There is intentionally no automatic rollback script.
If rollback is needed before the new workflow is used, first stop writes,
restore or verify a backup, and prepare a separately reviewed reverse
migration that removes only objects introduced here. If the workflow has
already been used, prefer a forward repair; do not drop the new records or
columns as a routine rollback.
