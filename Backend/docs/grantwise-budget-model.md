# GrantWise Tagbilaran budget model

This document explains the current budget model as implemented in the database, application routes, and frontend displays. It reflects the behavior actually present in [Backend/schema.sql](../schema.sql), [Backend/app.js](../app.js), and the budget UI in [Frontend/src/components/FundingSummary.jsx](../../Frontend/src/components/FundingSummary.jsx) and [Frontend/src/pages/StaffPortalPage.jsx](../../Frontend/src/pages/StaffPortalPage.jsx).

## Scope and rule of thumb

The system uses a reservation model:

- total_budget is the authorized cap for the program.
- remaining_budget is the undistributed portion that has not yet been released.
- reserved_budget is approved but not yet released.
- released_budget is already disbursed.
- available budget is not "total - released". It is defined in practice as `remaining_budget - reserved_budget`.

This is the model the current implementation actually follows, and it is consistent with the database views and the dashboard UI.

## Confirmed balance meanings

### Program-level balances

From the database validation logic in [Backend/schema.sql](../schema.sql):

- `total_budget` = the program's maximum authorized budget
- `remaining_budget` = funds not yet released, including funds already reserved for approved awards
- `reserved_budget` = approved awards that are still awaiting release
- `released_budget` = funds already paid out to students

The trigger enforces:

- `total_budget = remaining_budget + released_budget`
- `reserved_budget <= remaining_budget`

This means the system is intentionally treating `reserved_budget` as a subset of `remaining_budget`, not as a separate top-level bucket in the total-budget equation.

### Available budget

The project UI explicitly defines available budget as:

- `available_budget = remaining_budget - reserved_budget`

This is the same rule used in [Frontend/src/components/FundingSummary.jsx](../../Frontend/src/components/FundingSummary.jsx):

- `const available = Math.max(0, remaining - reserved);`

This is also reflected in the staff portal summary card in [Frontend/src/pages/StaffPortalPage.jsx](../../Frontend/src/pages/StaffPortalPage.jsx), which displays:

- `remaining_budget - reserved_budget`

### Barangay allocation balances

The allocation table follows the same model:

- `allocated_amount` = the maximum barangay allocation under the program
- `reserved_amount` = approved but not yet disbursed at barangay level
- `released_amount` = already disbursed at barangay level

The effective available amount is:

- `allocated_amount - reserved_amount - released_amount`

This is consistent with the program-level interpretation: reserved funds sit inside the still-available pool, and released funds are already committed.

## Example

Suppose a program has:

- total_budget = 10,000
- remaining_budget = 7,000
- reserved_budget = 2,000
- released_budget = 3,000

Then:

- total_budget = remaining_budget + released_budget
- 10,000 = 7,000 + 3,000
- reserved_budget is still inside remaining_budget
- available budget = 7,000 - 2,000 = 5,000

This is a valid and internally coherent model, but it is easy to misread because `reserved_budget` is not part of the `total = remaining + released` formula as a separate term; it sits inside `remaining`.

## What happens when an award is approved

The award approval flow is implemented in `approve_award(p_award_id, p_approved_by)` in [Backend/schema.sql](../schema.sql).

### Confirmed behavior

Before approving an award, the function:

1. Locks the award row, application row, student row, program row, and barangay allocation row using `FOR UPDATE`.
2. Verifies the award is still pending and the application is approved.
3. Verifies the student barangay matches the program allocation.
4. Confirms the approving user is an active LGU admin for that funding unit.
5. Verifies there are no unresolved duplicate or active funding conflicts for the student and funding cycle.
6. Checks the following budget constraints:
   - `program_record.remaining_budget - program_record.reserved_budget >= award_amount`
   - `allocation_record.allocated_amount - allocation_record.reserved_amount - allocation_record.released_amount >= award_amount`

Only if all checks pass does the function update balances:

- `Funding_Programs.reserved_budget = reserved_budget + award_amount`
- `Program_Barangay_Allocations.reserved_amount = reserved_amount + award_amount`

The function does not reduce `remaining_budget` at approval time.

That is the key design point: approving an award creates a reservation, not an immediate disbursement.

### Example

If a program has:

- remaining_budget = 900
- reserved_budget = 100
- award_amount = 250

Then the system checks:

- available program funds = 900 - 100 = 800
- 250 is allowed

After approval:

- remaining_budget stays at 900
- reserved_budget becomes 350
- released_budget stays 0

The same pattern happens at the barangay allocation level.

## What happens when a disbursement is released

The release logic is implemented in `release_disbursement(p_disbursement_id, p_released_by)` in [Backend/schema.sql](../schema.sql).

### Confirmed behavior

Before releasing, the function:

1. Locks the disbursement row, award row, application row, student row, allocation row, and program row.
2. Verifies the award is approved.
3. Verifies the releaser is an active LGU admin for the program funding unit.
4. Checks:
   - `program_record.remaining_budget >= amount`
   - `program_record.reserved_budget >= amount`
   - `allocation_record.reserved_amount >= amount`
   - `released_before + amount <= award_record.award_amount`

If all checks pass, the function executes:

- `remaining_budget = remaining_budget - amount`
- `reserved_budget = reserved_budget - amount`
- `released_budget = released_budget + amount`
- `reserved_amount = reserved_amount - amount`
- `released_amount = released_amount + amount`

The status of the disbursement is then changed to `released`, and the related student funding record is updated to `released` once the full award amount has been reached.

### Example

If:

- remaining_budget = 900
- reserved_budget = 350
- released_budget = 0
- disbursement amount = 125
- award total = 250

Then after release:

- remaining_budget = 775
- reserved_budget = 225
- released_budget = 125
- the awarded amount is now partially released

If the next disbursement is 125 as well, then:

- remaining_budget = 650
- reserved_budget = 100
- released_budget = 250

This exactly matches the implementation logic in the function.

## Program and barangay allocation budget checks

### Program checks

The database validation trigger `validate_program_budget_totals()` enforces:

- `NEW.total_budget = NEW.remaining_budget + NEW.released_budget`
- `NEW.reserved_budget <= NEW.remaining_budget`
- if `total_budget` changes, the sum of all barangay allocations cannot exceed the new program total

This protects the integrity of the program cap.

### Barangay allocation checks

`validate_program_barangay_allocation()` enforces:

- the program and barangay cannot be changed on an existing allocation
- a row with reserved or released amounts cannot be deleted
- the total sum of allocation amounts for a program cannot exceed the program total budget

### Award approval checks

`approve_award()` adds the final enforcement layer:

- program available funds check:
  - `remaining_budget - reserved_budget < award_amount`
- barangay available funds check:
  - `allocated_amount - reserved_amount - released_amount < award_amount`

This is the actual gate preventing over-approval.

### Release checks

`release_disbursement()` enforces:

- program funds must still be available and reserved for the release
- barangay reserved amount must cover the release
- cumulative released disbursements cannot exceed the award amount

This prevents double-release and over-release.

## Transaction safety and row locking

### Confirmed behavior in the app layer

The route in [Backend/app.js](../app.js) wraps award approval in a DB transaction:

- `BEGIN`
- fetch the verification and application rows with `FOR UPDATE OF verification, application`
- insert the award row
- call `SELECT approve_award($1, $2)`
- insert an audit log
- `COMMIT`

If any failure occurs, it runs `ROLLBACK`.

### Confirmed behavior in the DB functions

The SQL functions also use row locking to serialize writes:

- award approval locks the award, application, student, barangay allocation, program, and duplicate-check rows
- disbursement release locks the disbursement, award, application, student, barangay allocation, and program rows

This is important because the business rules depend on checking and updating multiple related tables atomically.

### What this protects against

This reduces the risk of:

- two admins approving the same budget at the same time
- one release overlapping with another release on the same award
- a program budget being exceeded due to race conditions

### What is not yet proven in this project

The current test suite in [Backend/test/authz.test.js](../test/authz.test.js) uses a fake in-memory pool and not a live PostgreSQL database. That means the code has strong contract-level validation, but actual Postgres concurrency behavior is not yet proven under a dedicated database test environment.

## What has been tested vs. what still needs a real PostgreSQL integration test

### Tested in the current suite

The current project tests verify the following behavior in the Node test harness:

- approval reserves without reducing `remaining_budget`
- release reduces `remaining_budget` and `reserved_budget` while increasing `released_budget`
- insufficient program funds are rejected
- insufficient barangay allocation funds are rejected
- release beyond the award ceiling is rejected
- concurrent fake approval attempts honor the same funds guard
- concurrent fake release attempts cannot exceed the award amount or double-release

### Still requiring real PostgreSQL integration tests

The following behaviors still need a dedicated Postgres-backed integration suite:

- true multi-session race conditions on `FOR UPDATE` behavior
- actual Postgres transaction serialization under concurrent approval/release requests
- trigger-level enforcement under real database load
- end-to-end validation of updated rows in live tables after concurrent release paths

These are realistic integration risks and are not considered confirmed defects in the current implementation; they are simply not yet proven under a real database environment.

## Risk classification

### Confirmed behavior

The following behaviors are confirmed by code inspection and the existing tests:

- award approval reserves funds without immediately reducing remaining budget
- release reduces reserved balances and increases released balances
- insufficient program or barangay availability blocks approval
- release beyond the award amount is blocked
- row locking and transaction boundaries are in place around these operations

### Unverified risk / assumptions to watch

The following remain assumptions unless validated in a dedicated PostgreSQL integration environment:

- the real DB still serializes concurrent approvals exactly as expected under live lock contention
- no legacy data issue or stale financial state is present in production tables
- the accounting model is understood consistently by all future maintainers

The biggest maintainability risk is not that the formulas are wrong; it is that the financial meaning is subtle and distributed across SQL, application logic, and UI code. The meaning should be preserved in documentation and tests as the system evolves.
