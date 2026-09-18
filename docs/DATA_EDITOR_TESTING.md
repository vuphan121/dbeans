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

Acceptance criteria:

- All Go tests pass.
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

Minimum negative API cases:

- Unknown filter column → HTTP 400.
- Unknown sort column or direction other than `asc`/`desc` → HTTP 400.
- Partial composite key → HTTP 400.
- Empty or more than 500 bulk-delete keys → HTTP 400.
- Mutation of a view → HTTP 400.
- Any mutation on a read-only connection → HTTP 403.
- `DROP TABLE`, a semicolon-separated second statement, or a SQL comment sent to `schema-change` → HTTP 400.

## 7. Cleanup

After confirming that `dbeans_agent_test` is the disposable fixture schema, run:

```sql
DROP SCHEMA dbeans_agent_test CASCADE;
```

Refresh schema metadata and confirm the fixture objects disappear. Remove any temporary saved connection or temporary dbeans user created only for the test. Report what was removed and whether any cleanup step failed.

## 8. Test report template

An agent handoff should include:

- Branch and commit/worktree state tested.
- Backend and frontend commands run.
- Automated test/build/lint results.
- Target type: disposable local database, dedicated test schema, or read-only inspection only.
- Manual cases completed from sections A–G.
- Any skipped destructive case and why.
- Exact failures with reproduction and relevant response text.
- Cleanup result.
- Local frontend/backend URLs if servers were left running for the user.

Do not report “working” based only on a successful build. At minimum, verify one real browse request, sort, compound filter, typed add/edit round trip, confirmation cancellation, view/no-PK behavior, and DDL preview/Open-in-query flow against disposable data.
