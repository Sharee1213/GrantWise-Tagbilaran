# Proposed session-token index migration

This document proposes an operational migration; it does not change
`schema.sql`, create an executable migration, or authorize running SQL against
the live Neon database.

## Reason

Authentication lookup and logout filter `Login_Sessions` by `token_hash`, but
the current schema has no index on that column. A unique index enforces the
one-row-per-token-digest invariant and supports those lookups. Raw session
tokens are generated with 256 bits of randomness; only their SHA-256 digests
are stored.

## Proposed SQL

First check for duplicate groups without returning token digests:

```sql
SELECT COUNT(*) AS duplicate_digest_groups
FROM (
    SELECT 1
    FROM "Login_Sessions"
    GROUP BY token_hash
    HAVING COUNT(*) > 1
) duplicates;
```

If the count is zero, the proposed index is:

```sql
CREATE UNIQUE INDEX CONCURRENTLY uq_login_sessions_token_hash
ON "Login_Sessions" (token_hash);
```

`CREATE INDEX CONCURRENTLY` must be executed outside a transaction. Confirm
that the resulting index is valid and unique by checking PostgreSQL's catalog
metadata (for example `pg_index.indisvalid`, `pg_index.indisunique`, and
`pg_class.relname`). Do not print or log token hashes.

## Disposable PostgreSQL validation

1. Use a local or otherwise disposable PostgreSQL instance, not Neon and not a
   production backup containing real credentials or student data.
2. Initialize that empty test database using the existing schema in the
   controlled test setup. Insert synthetic users and session rows only.
3. Verify the duplicate preflight reports zero, run the concurrent index
   creation as a standalone statement, then verify catalog metadata and that
   `EXPLAIN` for a `token_hash = $1` lookup can use the index. A sequential scan
   on a tiny fixture table is not proof of a problem; use enough synthetic
   rows or inspect the planner's available indexes.
4. In a separate disposable database, insert two rows with the same synthetic
   digest and verify that the preflight reports a duplicate and index creation
   fails. Confirm the failure does not leave an invalid index behind; if it
   does, remove it only in that disposable database with
   `DROP INDEX CONCURRENTLY IF EXISTS uq_login_sessions_token_hash` and repeat.
5. Test application login, session lookup, expiry, revocation, and logout
   against the disposable database after adding the index.

## Rollout and rollback considerations

Before any live rollout, an authorized operator must run the duplicate
preflight and review the result without exposing digest values. If duplicates
exist, stop and investigate through an approved incident-safe process; do not
delete sessions as part of this proposal. Schedule the concurrent index build
and monitor database load. A failed concurrent build can leave an invalid
index that needs explicit cleanup and retry.

Rollback, if needed, is a separately approved standalone
`DROP INDEX CONCURRENTLY` operation. No live preflight, migration, rollback, or
database access was performed as part of this proposal.
