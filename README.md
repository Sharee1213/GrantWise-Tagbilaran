# GrantWise Tagbilaran

Multi-unit scholarship and educational grant disbursement engine for Tagbilaran
City. The repository keeps the React frontend separate from the Express and
PostgreSQL backend.

## Project structure

- `Frontend/` — React, Vite, React Router, and Tailwind CSS.
- `Backend/` — Express API, PostgreSQL connection, and database schema.

## Frontend pages

| Page | Route | Current state |
| --- | --- | --- |
| Public home | `/` | Responsive information site with program overview, general preparation guidance, and eligibility caveats. |
| Scholarship programs | `/programs` | Reads active programs from the backend; shows a real empty state when none are available. |
| Application instructions | `/application-guide` | Preparation checklist; explains that eligibility rules and document uploads are not stored by GrantWise. |
| Login | `/login` | Authenticates with the backend session cookie. |
| Portal directory | `/portals` | Opens student and role-checked staff workspaces. |
| Student application portal | `/portal/student` | Authenticated students can submit supported applications and track their own application statuses. |
| LGU program admin | `/portal/lgu-admin` | Funding-unit scoped programs, summaries, application review, and guarded award approval. |
| Barangay coordinator | `/portal/barangay-coordinator` | Barangay-scoped verification queue, details, and verification actions. |
| School registrar | `/portal/school-registrar` | School-scoped verification queue, supported academic records, and verification actions. |
| System status | `/status` | Calls the existing API root to report whether the backend is reachable. |

The frontend does not fabricate programs, application records, eligibility
rules, funding totals, or successful submissions. The schema includes funding
units, programs and cycles; student, school, and barangay associations;
applications and verification stages; awards; disbursements; and audit-related
records. The database's seeded roles are `LGU Admin`, `Barangay Coordinator`,
`Registrar`, and `Scholar`.

## Verified backend integration

The frontend uses the public program endpoint, signup/login, student-owned
application and status endpoints, and protected staff endpoints below. The
System Status page checks only the API root.

| Method | Route | Purpose | Frontend use |
| --- | --- | --- | --- |
| `GET` | `/` | API availability response | Used by System Status. |
| `GET` | `/api/test-db` | Database connection test | Not called by the frontend. |
| `POST` | `/api/init-db` | Runs schema initialization in non-production only | Not called by the frontend. |
| `GET` | `/api/lookups` | Approved schools and barangays for signup | Signup page. |
| `GET` | `/api/programs` | Public active program list and application-workflow readiness | Programs page and student portal. |
| `POST` | `/api/auth/register` | Development-only: creates a Scholar account and student profile | Signup page. |
| `POST` | `/api/auth/login` | Verifies password and sets an opaque session cookie | Login page. |
| `GET` | `/api/auth/me` | Returns the authenticated user's public identity and role | Login and student portal. |
| `POST` | `/api/auth/logout` | Revokes the current session | Backend route; no logout UI yet. |
| `GET` | `/api/student/profile` | Current student's own profile | Not connected. |
| `GET` | `/api/student/applications` | Current student's applications | Student portal. |
| `POST` | `/api/student/applications` | Submits an application through the database workflow when required schema is installed | Student portal. |
| `GET` | `/api/student/applications/:applicationId` | Owned application and verification status history | Student portal. |
| `GET` | `/api/student/applications/:applicationId/documents` | Owned application document metadata (no file path/content) | Not connected. |
| `GET` | `/api/coordinator/dashboard` | Barangay-scoped pending and information-request counts | Barangay portal. |
| `GET` | `/api/coordinator/verifications[/:verificationId]` | Current coordinator's barangay-scoped queue/detail | Barangay portal. |
| `PATCH` | `/api/coordinator/verifications/:verificationId` | Records an allowed barangay verification decision and notes | Barangay portal. |
| `GET` | `/api/registrar/dashboard` | School-scoped pending and information-request counts | Registrar portal. |
| `GET` | `/api/registrar/verifications[/:verificationId]` | Current registrar's school-scoped queue/detail and available academic records | Registrar portal. |
| `PATCH` | `/api/registrar/verifications/:verificationId` | Records an allowed registrar verification decision and notes | Registrar portal. |
| `POST` | `/api/registrar/applications/:applicationId/grade-reports` | Adds a schema-supported GPA/semester grade report for an application in the registrar's queue | Registrar portal. |
| `POST` | `/api/registrar/applications/:applicationId/eligibility-checks` | Records a schema-supported eligibility check for an application in the registrar's queue | Registrar portal. |
| `GET` | `/api/admin/dashboard` | Summary of programs, applications, and budget balances in the admin's assigned unit | LGU admin portal. |
| `GET` | `/api/admin/funding-cycles` | Active funding cycles available for program creation | LGU admin portal. |
| `GET` | `/api/admin/programs[/:programId]` | Funding-unit scoped program list/detail and allocations | LGU admin portal. |
| `POST` | `/api/admin/programs` | Creates a program in the authenticated admin's funding unit | LGU admin portal. |
| `PATCH` | `/api/admin/programs/:programId` | Updates permitted program name, status, or dates in that funding unit | LGU admin portal. |
| `PUT` | `/api/admin/programs/:programId/barangay-allocations` | Replaces that program's barangay allocations within the unit and budget | LGU admin portal. |
| `GET` | `/api/admin/applications[/:applicationId]` | Funding-unit scoped application list/detail | LGU admin portal. |
| `GET` | `/api/admin/verifications[/:verificationId]` | Current LGU Admin's funding-unit-scoped review queue/detail | LGU admin portal. |
| `PATCH` | `/api/admin/verifications/:verificationId` | Records the LGU decision and, on approval, creates and approves an award through the database reservation function | LGU admin portal. |

Authentication uses Argon2id password hashes and opaque random session tokens.
Only a SHA-256 hash of each session token is stored in the existing
`Login_Sessions` table. Cookies are HttpOnly, SameSite=Strict, scoped to `/api`,
and Secure in production. Session expiry and revocation are checked against the
database. Registration accepts only student profile fields and assigns the
existing `Scholar` role on the server. Registration is not mounted in
production: the project does not yet provide email verification or student
identity proof. Staff account provisioning is also not public. Existing
accounts must have Argon2id-compatible hashes or be migrated through a secure
credential reset/provisioning process before login.
Unsafe API requests require an allowed Origin and the API uses credentialed
CORS configured for the frontend origin.

Staff authorization derives scope from the authenticated account's active
profile association. Queue/detail queries and mutations filter by the
coordinator's barangay, registrar's school, or admin's funding unit;
client-supplied role, user, school, barangay, or unit IDs do not authorize
access. Staff lists are capped at 50 records per request, and staff decisions
are checked against the active workflow stage. Registrar records use only the
existing `Grade_Reports` and `Eligibility_Checks` fields; attendance and units
passed are not represented in the schema. Admin award approval runs in a
transaction and delegates eligibility, duplicate-funding, allocation, and
budget-reservation checks to `approve_award`. Student application and document
metadata queries remain bound to the authenticated student's `Users.user_id`.
Cross-scope detail requests return not found.

The staff pages check the signed-in role and show protected API errors rather
than fabricate records. Protected staff endpoints return `503` if the
funding-unit, cycle, allocation, verification, or required workflow-trigger
schema is absent. A read-only inspection during this task found those schema
objects and active staff assignments in the configured Neon database. The
public programs API returned four programs and reported application submission
as enabled; there were no application or award records at that time. No staff
credentials were used and no staff mutation was performed, so real staff
decisions have not been exercised against Neon.

Application submission creates a draft and submits it through the existing
database status triggers, which initialize barangay verification. The API
checks student ownership, current program/cycle windows, duplicate applications,
and configured barangay allocations. The API checks for the required unit/cycle, allocation, verification, and
workflow-trigger schema before permitting application writes. If those objects
are absent, it returns `503` and performs no writes. The public API currently
returns live program records; an empty result is displayed honestly. No schema
migration is run automatically.

Program descriptions and program-specific eligibility rules are not columns in
the existing schema, so the public catalog does not invent or return those
fields. Document upload/download, application withdrawal, disbursement
release, password reset/change, and staff provisioning are not implemented.
Document metadata is available only to the owning student;
`Documents.file_path` is not exposed. Private file storage and safe download
authorization must be designed before upload/download routes are added.

The existing schema also contains funding duplicate tracking and database
logic that blocks award approval until a duplicate determination is resolved.
No API exposes duplicate records or evidence. Duplicate funding review remains
part of the existing award-approval workflow and is distinct from duplicate
applications to the same program.

No database schema change was made by this task. A draft additive migration
for older database installations is documented in
[Backend/docs/staff-portals-migration.md](./Backend/docs/staff-portals-migration.md)
and implemented in
[Backend/migrations/20261019_staff_portals.sql](./Backend/migrations/20261019_staff_portals.sql).
Do not apply it to the currently configured database without first rechecking
its schema; the required portal objects and active assignments were already
present during the read-only inspection. `Login_Sessions.token_hash` currently
has no unique constraint/index although authentication and logout query it. A
proposed unique-index migration and safe disposable-database test procedure are
documented in
[Backend/docs/session-token-index-migration.md](./Backend/docs/session-token-index-migration.md).
It has not been applied.
The session cookie uses `SameSite=Strict`; deploy the frontend and API on the
same site and configure the exact frontend origin in `FRONTEND_ORIGINS`.

### Database initialization endpoint warning

`POST /api/init-db` is mounted only when `NODE_ENV` is explicitly
`development`. An unset, `test`, or unrecognized `NODE_ENV` fails closed and
does not expose the initialization endpoint. Student registration is mounted
for local use only in `development`; tests must explicitly opt in to the
test-only registration route when constructing the app.
Production schema updates should be performed through a controlled deployment
process. The endpoint returns a generic error and does not expose database
error details.

## Local development

### Backend

1. Set `DATABASE_URL` in the local `Backend/.env` file. Never put the Neon
   connection string in frontend configuration.
2. Set `FRONTEND_ORIGINS=http://localhost:5173` in the local `Backend/.env`.
   `npm run dev` defaults an unset `NODE_ENV` to `development` for local-only
   database initialization and student registration. `npm start` does not set
   this default; configure `NODE_ENV=production` and the exact trusted frontend
   origin(s) in production.
3. From `Backend/`, install dependencies with `npm install`.
4. For local student signup, start the API with `npm run dev`. `npm start`
   (and `node server.js`) does not set `NODE_ENV`; registration remains disabled
   unless you explicitly start it with `NODE_ENV=development`. Production must
   set `NODE_ENV=production`.

The backend folder's `.gitignore` excludes `.env`. There is no backend
`.env.example` in the repository.

### Backend tests

Run `npm test` from `Backend/`. The current auth/authorization tests use an
injected fake pool and fixture identities; they do not connect to or modify
the Neon database. A dedicated PostgreSQL integration-test database and tests
against actual schema constraints are still needed before production use.

### Frontend

1. From `Frontend/`, install dependencies with `npm install`.
2. Set `VITE_API_BASE_URL=http://localhost:5000/api` in the local
   `Frontend/.env.local`. `Frontend/.env.example` contains the placeholder
   setting; Vite-prefixed variables are public and must never contain secrets.
3. Start Vite with `npm run dev`, then open `http://localhost:5173`.
4. Open **System status** and select **Check API connection** to check the API
   root response. This check does not test database connectivity or sign in.

The frontend `.gitignore` ignores local `.env*` files while allowing
`.env.example` to be tracked. The production bundle can be checked with
`npm run build`.
