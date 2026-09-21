# Data editor testing guide

This guide is the acceptance-test contract for the connection Data view. It is written for coding agents and maintainers who need to verify the feature without touching real application data.

## 1. Scope and safety rules

The feature currently supports PostgreSQL only. MySQL/MariaDB and SQLite connections may be saved, but schema inspection, queries, and Data-view operations intentionally return a not-supported error.

Use a disposable local database or a dedicated test schema. Never test add, edit, delete, bulk delete, or **Review & run** against a production table. Reading production metadata is not enough reason to perform a write. If only a production connection is available, restrict the test to browsing, sorting, filtering, column controls, DDL preview, and **Open in query**.

The fixture below creates everything under `dbeans_agent_test`. Cleanup drops that schema only. Before cleanup, verify the exact schema name; do not replace it with `public` or another shared schema.

## 2. Preflight

From the repository root, confirm the intended feature branch and a clean understanding of any existing user changes:

```powershell
git branch --show-current
git status --short
```

Expected branch for this feature: `codex/data-editor`.

Configure `backend/.env` from `backend/.env.example`. The operator database in `DATABASE_URL` stores dbeans users and saved connections; it does not have to be the disposable target database. The target PostgreSQL connection is added through the app.

Start the backend and frontend in separate terminals:

```powershell
cd backend
go run .
```

```powershell
cd frontend
npm install
npm run dev
```

Default local URLs:

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:8080/api/health`

The health endpoint should return `{"ok":true}`. `ALLOWED_ORIGINS` must include the exact frontend origin; the checked-in example uses port `5173`.

## 3. Automated checks

Run these before manual testing:

```powershell
cd backend
go test ./...
```

```powershell
cd frontend
npm run build
npm run lint
```

The database-backed Go tests (CSV import atomicity, the row-count strategy, count timeouts) skip themselves unless `DBEANS_TEST_DATABASE_URL` points at a database that is safe to create and drop schemas in. Each test works inside its own throwaway schema and removes it. Run them against the disposable database, never a real one:

```powershell
cd backend
$env:DBEANS_TEST_DATABASE_URL = "postgres://postgres@127.0.0.1:5432/scratch?sslmode=disable"
go test ./internal/api
```

The CSV parser and view-config helpers have pure-Node tests (Node 24+, no extra dependencies):

```powershell
cd frontend
npm test
```

Acceptance criteria:

- All Go tests pass, including the database-backed ones with `DBEANS_TEST_DATABASE_URL` set.
- `npm test` passes in `frontend`.
- TypeScript and the Vite production build complete successfully.
- No new lint warnings originate from `DataBrowser.tsx` or other files changed for the feature. The repository may still report documented pre-existing warnings elsewhere.
- `git diff --check` reports no whitespace errors. Line-ending conversion notices on Windows are informational.

The focused backend tests in `backend/internal/api/table_data_test.go` cover filter parameterization, rejection of unknown columns, complete composite-primary-key enforcement, explicit/fallback ordering, and rejection of unsafe schema statements.

## 4. Disposable PostgreSQL fixture

Add a writable PostgreSQL connection that targets a disposable database. Open Query and run this fixture once:

```sql
CREATE SCHEMA IF NOT EXISTS dbeans_agent_test;

DO $$
BEGIN
  CREATE TYPE dbeans_agent_test.account_plan AS ENUM ('free', 'team', 'enterprise');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS dbeans_agent_test.accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  plan dbeans_agent_test.account_plan NOT NULL DEFAULT 'free',
  enabled boolean NOT NULL DEFAULT true,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  joined_on date,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dbeans_agent_test.projects (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES dbeans_agent_test.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  budget numeric,
  archived boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS dbeans_agent_test.composite_rows (
  tenant_id bigint NOT NULL,
  external_id text NOT NULL,
  note text,
  PRIMARY KEY (tenant_id, external_id)
);

CREATE TABLE IF NOT EXISTS dbeans_agent_test.no_primary_key (
  label text,
  amount integer
);

INSERT INTO dbeans_agent_test.accounts (email, plan, enabled, profile, joined_on)
VALUES
  ('ada@example.test', 'enterprise', true, '{"role":"owner"}', DATE '2026-01-10'),
  ('grace@example.test', 'team', false, '{"role":"member"}', NULL),
  ('linus@example.test', DEFAULT, true, DEFAULT, DATE '2026-03-15')
ON CONFLICT (email) DO NOTHING;

INSERT INTO dbeans_agent_test.projects (account_id, name, budget)
SELECT id, 'Migration', 2500.50 FROM dbeans_agent_test.accounts WHERE email = 'ada@example.test'
UNION ALL
SELECT id, 'Dashboard', NULL FROM dbeans_agent_test.accounts WHERE email = 'grace@example.test';

INSERT INTO dbeans_agent_test.composite_rows (tenant_id, external_id, note)
VALUES (1, 'a', 'first'), (1, 'b', 'second'), (2, 'a', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO dbeans_agent_test.no_primary_key (label, amount)
VALUES ('unaddressable', 10);

CREATE OR REPLACE VIEW dbeans_agent_test.active_accounts AS
SELECT id, email, plan, updated_at
FROM dbeans_agent_test.accounts
WHERE enabled = true;
```

Refresh the schema after creating the fixture. The Data selector should list all four tables and `active_accounts · view`.

## 5. Manual acceptance matrix

Record the observed result for every case. A failure should include the selected schema/table, request error text, browser console error if any, and the smallest reproduction.

### A. Browse and metadata

1. Open **Data** and select `dbeans_agent_test.accounts`.
2. Confirm three rows load and values are readable text, not binary-looking characters.
3. Confirm the header marks `id` as PK.
4. Select `projects`; confirm `account_id` is marked FK.
5. Open **Add row** on `accounts` and inspect controls without saving.

Expected:

- `id` is identified as generated/identity and remains database-owned.
- `plan` is an enum select with `free`, `team`, and `enterprise`.
- `enabled` is a boolean choice.
- `profile` uses a multiline JSON editor.
- `joined_on` uses a date input and `updated_at` uses a date/time input.
- Each writable field has an unambiguous **Default**, **Value**, or **NULL** state. `NULL` appears only for nullable columns.

### B. Pagination, sorting, and filters

1. Click the `email` header once, then again.
2. Confirm the order changes ascending then descending and that the sort survives a page request.
3. Add `email contains example`, apply it, and confirm all three fixture accounts remain.
4. Add `plan equals team`; confirm only `grace@example.test` remains.
5. Clear filters.
6. Test `joined_on is null`; confirm Grace is returned.
7. Test a numeric comparison on `projects.budget` such as `greater than 1000`.

Expected: filtering and sorting occur server-side, the total count describes the filtered result, and filter values containing quotes are treated as values rather than SQL.

### C. Column controls and keyboard behavior

1. Open **Columns**.
2. Hide `profile`, move `email` above `id`, and apply.
3. Drag a visible header resize handle.
4. Focus a data cell with Tab and press Enter.
5. Double-click a data cell.

Expected: column visibility/order update without refetching or changing data; the width changes in place; Enter and double-click open the row editor when the table is writable and has a primary key.

### D. Add, edit, NULL, and defaults

1. Add an account with `email = agent@example.test`.
2. Leave `plan`, `enabled`, `profile`, and `updated_at` on **Default**; set `joined_on` to **NULL**.
3. Confirm the inserted row receives database defaults.
4. Edit that row: set `plan = team`, `enabled = false`, and `profile = {"verified":true}`.
5. Save and refresh.

Expected: the row is inserted once, defaults are applied by PostgreSQL, JSON remains valid/readable, and the edit targets the exact primary key.

Also edit `composite_rows` row `(tenant_id=1, external_id='a')`. Confirm only that row changes. The backend must reject a request missing either primary-key component; this is also covered by the unit test.

### E. Selection, export, and delete confirmation

1. Select two fixture rows.
2. Confirm the toolbar reports `2 selected` and exposes **Delete**.
3. Export CSV and JSON; confirm only selected rows and currently visible columns are included.
4. Click **Delete**, verify the confirmation names two rows, then cancel.
5. Repeat and confirm deletion only for disposable fixture rows.

Expected: cancel changes nothing. Confirmed multi-row deletion is atomic—either every selected key is deleted or none are. Never perform this case on non-fixture data.

### F. Tables without keys, views, and read-only connections

1. Select `no_primary_key`.
2. Confirm browsing and **Add row** remain available, while edit/delete and row selection for mutation are disabled with an explanation.
3. Select `active_accounts · view`.
4. Confirm browsing, filters, sorting, and export work while all row mutations are disabled and the view is labeled read-only.
5. Repeat against a saved connection configured as read-only.

Expected: frontend controls are disabled and direct mutation API calls return HTTP 403 for a read-only connection. View mutation attempts return a validation error even if the connection itself is writable.

### G. Guarded schema tools

Use the fixture schema only.

1. Open **Schema** and test **Create table**, **Add column**, **Create index**, and **Add relationship** forms.
2. For each form, confirm the exact DDL updates live in **SQL preview**.
3. Use **Open in query** and confirm a new SQL tab contains the same statement without running it.
4. For an execution test, add nullable column `review_note text` to `accounts`, review the DDL, confirm **Run change**, and verify the refreshed grid includes the column.
5. Create index `accounts_plan_idx` on `plan` and verify it in PostgreSQL metadata.
6. Do not execute a relationship if it would duplicate the fixture's existing FK.

Expected: **Review & run** opens a second confirmation boundary. The backend accepts one generated `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, `ALTER TABLE ... ADD CONSTRAINT`, or `CREATE [UNIQUE] INDEX` statement. It rejects multiple statements, comments, `DROP`, `TRUNCATE`, and `ALTER ... DROP/RENAME`. Read-only connections receive HTTP 403.

### H. Audit trail, Undo, and query history (added 2026-09-18)

1. Add a fixture row, then open **History** (next to Data in the workbench switcher) and confirm a `Row added` entry appears at the top, timestamped just now.
2. Edit that row and confirm a `Row updated` entry appears; delete it (single) and confirm `Row deleted`; select two more fixture rows and bulk-delete them, confirming one `Rows deleted` entry naming both.
3. Run **Review & run** on a guarded schema change and confirm a `Schema change` entry appears with the exact executed SQL.
4. Run a query from the SQL editor and confirm a `Query` entry appears in the same History list, interleaved with the mutation entries by time; click it and confirm **Open in query** opens a new tab with that exact SQL, without running it.
5. Repeat add/edit/delete and, each time, click the **Undo** toast that follows (it auto-dismisses after a few seconds if ignored):
   - Undo after **add** deletes the exact new row, including when a primary-key column was left on Default (an identity/serial column) — the backend's `RETURNING *` on insert is what makes this possible even though the request itself never knew the generated key.
   - Undo after **edit** restores every prior value.
   - Undo after **delete** (single or bulk) reinserts the row(s) with identical content. Exception: for a table whose primary key is itself database-generated, the restored row gets a *new* key rather than its exact old one — confirm this is the only deviation, not a wider data mismatch.
   - Confirm Undo itself does not produce a further Undo toast.

Expected: every add/edit/delete/bulk-delete/schema-change appears in History without a page refresh; Undo reliably reverses the immediately preceding mutation via the same insert/update/delete endpoints (no separate "undo" API); History is scoped to the current connection and the signed-in user only.

### I. Row counts, cancellation, and stale responses (added 2026-09-21)

The fixture tables are tiny, so first add a table large enough to matter. Autovacuum is disabled on it so its statistics stay predictable:

```sql
CREATE TABLE dbeans_agent_test.big_events (id bigserial PRIMARY KEY, kind text NOT NULL, payload text) WITH (autovacuum_enabled = false);
INSERT INTO dbeans_agent_test.big_events (kind, payload) SELECT 'k' || (g % 50), md5(g::text) FROM generate_series(1, 200000) g;
-- Deliberately slow: ~10 ms per row, for the timeout and cancel cases.
CREATE VIEW dbeans_agent_test.slow_events AS SELECT id, (pg_sleep(0.01) IS NOT NULL) AS ok FROM dbeans_agent_test.big_events;
```

1. Open `big_events` before it has ever been analyzed. The footer shows **50,000+ rows** with a **Count exactly** button, and the page itself loads immediately with all its rows. It does not begin with a full `count(*)`.
2. Run `ANALYZE dbeans_agent_test.big_events;`, then refresh. The footer now shows **~200,000 rows** (a planner estimate; hover for the explanation) and the pager reads **1 of ~2,000**.
3. Click **Count exactly**. The footer becomes **200,000 rows** with no button, and the pager loses its `~`. While counting, the button reads **Counting… (cancel)** and clicking it stops the count.
4. Page forward, change rows-per-page, and sort a column. In the network log each `table-data` request carries `"countMode":"skip"` and the total stays put: paging and sorting never recount. Applying a filter, switching tables, refreshing, and adding or deleting rows do recount (`"auto"`).
5. Filter `kind` equals `k1`: the total is exactly **4,000**. Filter `kind` does not equal `zzz` (matches everything): **50,000+**, not a multi-second wait.
6. Next is disabled on the last page and enabled otherwise, even while the total is only an estimate. Confirm a deep page still loads (use the API with a large `page`, or many clicks of Next).
7. Open `slow_events`. The rows load after about a second; the footer shows **? rows** (the bounded count timed out at 3 s) with **Count exactly**. Clicking it fails after about 15 s with "Counting every row took too long…" and the grid is unaffected.
8. Cancel: with `slow_events` selected, click **Refresh** and, while it spins, click the same button (now an ✕, tooltip "Cancel loading"). The grid stops loading, an inline notice says loading was cancelled, and `SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query ILIKE '%slow_events%'` (run in another session) returns 0 within a second.
9. Stale responses: click **Refresh** on `slow_events` and, before it finishes, pick a small table. The small table's rows and columns must be what remains; the slow response must never replace them.

Expected: the page never blocks on a count it can't afford; the total is always labelled for what it is (exact, `~` estimate, `N+` lower bound, `?` unknown); superseded or cancelled requests leave nothing running in PostgreSQL.

### J. CSV import (added 2026-09-21)

Save this as `people.csv`. Any comma-, semicolon-, tab-, or pipe-separated file works; quoting and CRLF line endings are handled:

```csv
Email,Plan,Joined On,Ignore me
lovelace@example.test,team,2026-04-01,x
"hopper, grace@example.test",enterprise,,x
turing@example.test,,2026-05-09,x
```

1. On `accounts`, click **Import** and choose the file. The dialog shows the row count and detected delimiter and auto-maps `Email → email`, `Plan → plan`, `Joined On → joined_on` by name; `Ignore me` stays on **Skip this column**. `id` (identity) and other database-filled columns never appear as targets.
2. Break it: change one plan to `platinum` (not in the enum). Click **Validate**. It lists `Row 2: invalid input value for enum …` and writes nothing (`SELECT count(*) FROM dbeans_agent_test.accounts` is unchanged). Add a second bad row and confirm **both** are listed. Choose the corrected file; the old errors clear.
3. With the corrected file, **Validate** reports "All 3 rows passed. Nothing has been written yet." Then **Import 3 rows** and confirm. A toast reports the import, the grid refreshes, the total goes up by 3, and the comma inside the quoted email survives. Empty values become NULL because "Treat empty values as NULL" is ticked; untick it and import a fresh file to see empty strings sent instead.
4. Atomicity: import a file whose *last* row duplicates an existing email. The import fails, names that row, and **none** of the earlier rows were written.
5. Guards: unmap `Email` and the dialog explains it is required (NOT NULL, no default) and disables Validate and Import. Mapping two file columns to one target is blocked. A row with too many or too few values is blocked with its row number. A file with more than 10,000 rows is blocked with a message to split it. An unclosed quote gives a clear error, not a hang.
6. **Import** is disabled on views and on read-only connections; a direct `POST …/table-import` to either is refused (400 / 403).
7. Open **History**: each *committed* import has a `CSV import` entry with the table and row count, but no row contents. Dry runs and failed imports do not appear.

Expected: import is all-or-nothing; validation shows every problem in one pass (up to 20); nothing is written until the explicit confirm; undo is intentionally not offered (the confirm dialog says so).

### K. Remembered views, saved views, and the table picker (added 2026-09-21)

1. Open the Data view, choose `accounts`, sort by `email`, add a filter, hide a column and widen another, then reload the whole page and reopen the connection → Data. It returns to `accounts` with the same filter, sort, hidden column, and width. Repeat with a second table; each table remembers its own state, and another connection has separate memory.
2. Drop or rename a column that a remembered filter, sort, or hidden column refers to (or edit `localStorage["dbeans.dataview.v1"]` to reference a missing column). The Data view still opens: the stale part is dropped and nothing errors.
3. Click the table selector. Type part of a name (`proj`): results filter and rank as you type; arrow keys and Enter select; Escape closes; reopening starts with an empty search. With the search empty, tables you have opened appear under **Recent**; click the star on a row to pin it and it appears under **Pinned** first.
4. **Views → Save current view…** with a filter and sort applied; name it. The Views button shows a count. Change the sort and filter, open **Views**, and pick the saved view: the filters, sort, rows per page, and column layout come back. Saving a second view with the same name on the same table is rejected with a message; the same name on another table is fine.
5. Reload, or sign in from a different browser: the saved views are still there (they live on the server, per user and connection), while the remembered last state from step 1 is per browser. Delete a view with its trash icon.

### L. Saved queries live on the server (added 2026-09-21)

1. In the Query view, type SQL and right-click the tab → **Save**. Confirm the sidebar list grows and `SELECT id, name FROM saved_queries` in the dbeans operator database shows the row. Edit the text and **Rename**; close the tab and choose **Save** in the prompt; each change appears in that table.
2. Reload the page and sign in from another browser: the queries are present. **Delete** removes it from the list and the table.
3. Migration: an older browser may still hold queries in `localStorage["dbeans.snippets.v2"]`. Simulate it by setting that key to `{"state":{"snippets":[{"id":"snip_x","name":"legacy","sql":"select 1"}]},"version":0}` and reloading while signed in. The query appears in the sidebar and in `saved_queries`, and the localStorage key is removed. Reloading again does not duplicate it.

## 6. API contract checks

Agents may test through the UI or call the API with a valid bearer token. Do not put tokens or connection passwords in committed files, screenshots, logs, or final reports.

| Route | Purpose | Important checks |
|---|---|---|
| `POST /api/connections/{id}/table-data` | Browse | Validates schema/table/filter/sort columns; caps page size at 500; returns rich column metadata, rows, total, page, and page size. |
| `POST /api/connections/{id}/table-rows` | Insert | Omits Default fields; supports `DEFAULT VALUES`; rejects views/read-only connections. |
| `PATCH /api/connections/{id}/table-rows` | Update | Requires exactly the complete primary key and at least one value. |
| `DELETE /api/connections/{id}/table-rows` | Delete one | Requires exactly the complete primary key. |
| `POST /api/connections/{id}/table-rows/bulk-delete` | Delete many | Accepts 1–500 complete keys and deletes in one transaction. |
| `POST /api/connections/{id}/schema-change` | Guarded DDL | Accepts only one allow-listed create/add statement and enforces read-only mode. |
| `POST /api/connections/{id}/table-data` | Page of rows | Also returns `totalKind` (`exact`/`estimated`/`lower-bound`/`unknown`/`skipped`) and an always-exact `hasMore`. `countMode: "skip"` returns `skipped` with `total: 0`. |
| `POST /api/connections/{id}/table-data/count` | Explicit exact count | Same table and filters as a page load. Times out with HTTP 504 after 15 s. |
| `POST /api/connections/{id}/table-import` | Bulk insert mapped rows | `dryRun: true` always rolls back. Returns HTTP 200 with `ok` and per-row `errors` for data problems, HTTP 400 for a malformed request, 403 on read-only connections. |
| `GET/POST /api/connections/{id}/views`, `PATCH/DELETE …/views/{viewId}` | Saved Data views | Per user and connection; 409 on a duplicate name for the same table. |
| `GET/POST /api/saved-queries`, `POST …/import`, `PATCH/DELETE …/{id}` | Saved queries | Per user. `import` is the idempotent one-time localStorage migration. |
| `GET /api/connections/{id}/history` | Audit trail + query history | Returns the signed-in user's own `query_run`/`row_insert`/`row_update`/`row_delete`/`bulk_row_delete`/`schema_change`/`table_import` events for this connection, newest first, `limit` capped at 500 (default 100). |

Minimum negative API cases:

- Unknown filter column → HTTP 400.
- Unknown sort column or direction other than `asc`/`desc` → HTTP 400.
- Partial composite key → HTTP 400.
- Empty or more than 500 bulk-delete keys → HTTP 400.
- Mutation of a view → HTTP 400.
- Any mutation on a read-only connection → HTTP 403.
- `DROP TABLE`, a semicolon-separated second statement, or a SQL comment sent to `schema-change` → HTTP 400.
- Import: unknown column, identity or generated column, a column mapped twice, an unmapped required column, a ragged row, no rows, more than 10,000 rows, or a view target → HTTP 400. Read-only connection → HTTP 403. Another user's connection → HTTP 404.
- Count: unknown filter column or missing table → HTTP 400; another user's connection → HTTP 404.
- Saved queries and views: blank name, non-object view config, or missing id → HTTP 400; duplicate id or duplicate view name → HTTP 409; another user's query, view, or connection → HTTP 404 (or no effect for DELETE).

## 7. Cleanup

After confirming that `dbeans_agent_test` is the disposable fixture schema, run:

```sql
DROP SCHEMA dbeans_agent_test CASCADE;
```

This also removes `big_events` and `slow_events`. Refresh schema metadata and confirm the fixture objects disappear. Delete any saved views or queries created during sections K and L. Remove any temporary saved connection or temporary dbeans user created only for the test. Report what was removed and whether any cleanup step failed.

## 8. Test report template

An agent handoff should include:

- Branch and commit/worktree state tested.
- Backend and frontend commands run.
- Automated test/build/lint results.
- Target type: disposable local database, dedicated test schema, or read-only inspection only.
- Manual cases completed from sections A–L.
- Any skipped destructive case and why.
- Exact failures with reproduction and relevant response text.
- Cleanup result.
- Local frontend/backend URLs if servers were left running for the user.

Do not report “working” based only on a successful build. At minimum, verify one real browse request, sort, compound filter, typed add/edit round trip, confirmation cancellation, view/no-PK behavior, and DDL preview/Open-in-query flow against disposable data.
