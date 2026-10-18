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
| Scholarship programs | `/programs` | Clearly marked catalog placeholder; no program-list API exists. |
| Application instructions | `/application-guide` | General preparation checklist; directs applicants to official notices for current requirements. |
| Login | `/login` | Authentication-unavailable notice; no credentials are collected. |
| Portal directory | `/portals` | Links to role previews; it does not grant access. |
| Student application portal | `/portal/student` | Placeholder pending authentication and student-owned application APIs. |
| LGU program admin | `/portal/lgu-admin` | Placeholder pending funding-unit-scoped APIs and server-side authorization. |
| Barangay coordinator | `/portal/barangay-coordinator` | Placeholder pending barangay-scoped APIs and server-side authorization. |
| School registrar | `/portal/school-registrar` | Placeholder pending school-scoped APIs and server-side authorization. |
| System status | `/status` | Calls the existing API root to report whether the backend is reachable. |

The frontend does not fabricate programs, application records, eligibility
rules, funding totals, or successful submissions. The schema includes funding
units, programs and cycles; student, school, and barangay associations;
applications and verification stages; awards; disbursements; and audit-related
records. The database's seeded roles are `LGU Admin`, `Barangay Coordinator`,
`Registrar`, and `Scholar`.

## Verified backend integration

The frontend currently calls only the API root from **System Status**.
Authenticated endpoints below are implemented in the backend but are not yet
connected to the portal previews.

| Method | Route | Purpose | Frontend use |
| --- | --- | --- | --- |
| `GET` | `/` | API availability response | Used by System Status. |
| `GET` | `/api/test-db` | Database connection test | Not called by the frontend. |
| `POST` | `/api/init-db` | Runs schema initialization in non-production only | Not called by the frontend. |
| `POST` | `/api/auth/register` | Development-only: creates a Scholar account and student profile | Not connected. |
| `POST` | `/api/auth/login` | Verifies password and sets an opaque session cookie | Not connected. |
| `GET` | `/api/auth/me` | Returns the authenticated user's public identity and role | Not connected. |
| `POST` | `/api/auth/logout` | Revokes the current session | Not connected. |
| `GET` | `/api/student/profile` | Current student's own profile | Not connected. |
| `GET` | `/api/student/applications` | Current student's applications | Not connected. |
| `GET` | `/api/student/applications/:applicationId` | Owned application and verification status history | Not connected. |
| `GET` | `/api/student/applications/:applicationId/documents` | Owned application document metadata (no file path/content) | Not connected. |
| `GET` | `/api/coordinator/verifications[/:verificationId]` | Current coordinator's barangay-scoped verification queue/detail | Not connected. |
| `GET` | `/api/registrar/verifications[/:verificationId]` | Current registrar's school-scoped verification queue/detail | Not connected. |
| `GET` | `/api/admin/verifications[/:verificationId]` | Current LGU Admin's funding-unit-scoped verification queue/detail | Not connected. |

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
profile association. Queue/detail queries filter by the coordinator's
barangay, registrar's school, or admin's funding unit; client-supplied role,
user, or scope IDs do not authorize access. Student application and document
metadata queries are bound to the authenticated student's `Users.user_id`.
Cross-scope detail requests return not found. These route-level checks do not
replace the database's existing workflow triggers.

The backend still does **not** provide public program listings, application
creation/submission/withdrawal, verification decisions, document upload or
download, award/disbursement APIs, password reset/change, or staff provisioning.
The frontend portal previews remain placeholders. Document metadata is
available only to the owning student; `Documents.file_path` is not exposed.
Private file storage and safe download authorization must be designed before
upload/download routes are added.

The existing schema also contains funding duplicate tracking and database
logic that blocks award approval until a duplicate determination is resolved.
No API exposes duplicate records or evidence. There is not yet an application
submission endpoint that invokes this full process, so duplicate prevention is
not represented as a complete application workflow.

No database schema change was made. `Login_Sessions.token_hash` currently has
no unique constraint/index although authentication and logout query it. A
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
4. Start the API with `npm run dev` (or `npm start`).

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
