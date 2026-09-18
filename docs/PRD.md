# dbeans — Product Requirements

## 1. Vision

DBeaver, pgAdmin, and similar tools are powerful but heavy: desktop-only, dated UI, cluttered with enterprise-oriented features most personal-project developers never touch. dbeans is a **web-based, self-hosted, single-user** database tool that does far less, but does it with a genuinely clean, fast, modern interface — something you'd actually enjoy opening every day.

The bar for success isn't feature parity with DBeaver. It's: *"I reach for dbeans instead of DBeaver/TablePlus for my personal projects because it feels better to use."*

## 2. Target user

One person: the developer running this for their own side projects, home lab, or personal servers. Design for a single user with a handful of saved connections — not a team, not a multi-tenant SaaS.

## 3. Goals

- Connect to and browse personal databases (schemas, tables, views, columns, indexes) from any browser.
- Write and run SQL with a genuinely good editor experience (syntax highlighting, autocomplete, keyboard-driven).
- View, sort, filter, and edit query results in a spreadsheet-like grid.
- Keep a history of run queries and let the user save/organize frequently used ones.
- Be trivially self-hostable: one container, minimal config, works well on a small VPS or home server.
- Feel fast and uncluttered — see [DESIGN.md](DESIGN.md) for the UX bar this needs to clear.

## 4. Non-goals (v1)

- Multi-tenant / team accounts with roles or permissions — dbeans has real accounts (username + password), but it's sized for one person having one or a few personal logins, not an org.
- Feature parity with DBeaver (no plugin ecosystem, no BI/reporting, no data modeling suite).
- Full NoSQL/streaming administration — Redis and Kafka are supported as **read + basic-write inspectors** (browse/edit Redis keys, browse Kafka topics and produce test messages), not full admin tools. No topic/key lifecycle management, no consumer-group administration, no schema registry.
- High-availability / multi-tenant SaaS deployment.
- Managing the lifecycle of the databases themselves (provisioning, backups, monitoring) — dbeans is a client, not infrastructure.
- Mobile-optimized UI (responsive enough not to break, but designed for desktop-width browser use).

## 5. Core features (v1 scope)

### Accounts & sign-in
- Real username/password accounts (bcrypt-hashed, stored in dbeans' own Postgres operator database), not a single shared master password.
- No self-serve signup in v1 — accounts are seeded server-side; this is a personal tool with a small, known set of users.
- Sign-in and query activity are logged as analytics events (see §5 Settings) for the user's own visibility into their usage.

### Connections
- Add/edit/delete saved connections (host, port, database, credentials, SSL options). Name is required — the home screen always shows the name you gave a connection, never a raw connection string.
- Support PostgreSQL, MySQL/MariaDB, SQLite, Redis, and Kafka.
- Test-connection before saving (client-side form check for now — see the reachability status below for the real server-side check).
- Home screen is a pannable/zoomable 2D board (not a list) — each connection is a card you can drag and resize; position/size snap to the background grid.
- Each connection shows a live reachability indicator (green/red/gray dot) — a real TCP check against the host:port, cached ~60s, refreshed on page visits. This is *not* a credentials/auth check yet (see ARCHITECTURE.md §5).
- **Not yet implemented:** credentials are stored as plain JSONB in the operator database, not encrypted at rest — flagged as a known gap, not a v1 claim.

### Redis & Kafka inspection
- **Redis:** browse keys (pattern search), view/edit values by type (string, hash, list, set, zset), edit TTL, delete/create keys.
- **Kafka:** browse topics, view messages (partition/offset/timestamp/key/value/headers, optional live tail), produce a test message. No topic administration.
- **Implementation status:** both inspectors use the real configured Redis/Kafka source. Redis loads at most 500 keys and 500 collection members per value; Kafka loads the latest 100 messages and live-tail refreshes every three seconds.

### Schema browser
- Tree view of databases → schemas → tables/views → columns/indexes/constraints.
- Quick metadata on hover/click: column types, nullability, defaults, keys.
- Search/filter within the tree.

### SQL editor
- Multi-tab editor, one tab per query/session.
- Syntax highlighting, schema-aware autocomplete (table/column names).
- Run selection or full statement; cancel a running query.
- Keyboard-first: run query, new tab, command palette, etc. all reachable without a mouse.

### Table data browser
- Agent and maintainer verification is specified in [DATA_EDITOR_TESTING.md](DATA_EDITOR_TESTING.md), including a disposable PostgreSQL fixture, negative API cases, mutation safety boundaries, and cleanup.
- A dedicated **Data** view sits beside Query in the connection workbench. It uses the same live schema metadata and lets the user choose any real table without writing SQL; **Open in query** turns the selected table into an editable `SELECT *` query tab when more control is needed.
- Rows are loaded with server-side pagination (50, 100, or 250 per page), a total row count, stable primary-key ordering, and server-side single-column sorting. The browser never loads an unbounded table into frontend memory.
- Filters can be combined across columns and are applied server-side. Supported operators are equals/not-equals, contains/starts-with/ends-with, greater/greater-or-equal, less/less-or-equal, and is-null/is-not-null. Filter values are bound parameters; schema, table, and column identifiers are validated against live metadata and safely quoted.
- Writable connections can add rows, edit a complete row, set explicit `NULL` values, or delete a row. Each field explicitly chooses **Default**, **Value**, or **NULL**; generated/identity columns stay on their database-generated value. Editors adapt to booleans, numbers, dates/timestamps, JSON, enums, and foreign-key metadata.
- Edit and delete target the row by its complete primary key, including every column of a composite key. Tables without a primary key remain browsable and insertable, but existing-row edit/delete actions are disabled because they cannot be targeted safely. Row selection supports transaction-backed bulk deletion and CSV/JSON export; destructive and multi-row writes require confirmation.
- The grid supports hide/reorder/resize controls, keyboard focus with Enter-to-edit, and visible type/PK/FK metadata. Views appear in the same selector but remain read-only.
- Guarded schema tools create a table, add a column, create an index, or add a foreign-key relationship. They show the exact generated DDL, require an explicit review step, and can open that DDL in a normal query tab instead. The guarded backend accepts only one `CREATE TABLE`, `ALTER TABLE`, or `CREATE [UNIQUE] INDEX` statement and honors the connection's read-only setting.
- Current implementation is Postgres-only, matching schema/query execution support; MySQL and SQLite data browsing follows the future driver abstraction.

#### Recommended follow-ups (Supabase/Railway parity)
1. **Import:** CSV import with column mapping, validation preview, and a transaction-backed commit. Export of the visible page or selected rows is implemented; exporting every row matching a server-side filter still needs a streaming endpoint.
2. **Fast navigation and saved views:** searchable/favorited tables, persisted last table/filter/sort/column layout per connection, URL-addressable views, and saved named filter sets.
3. **Large-table performance:** cancellable requests, stale-response protection, index-aware sort warnings, and estimated/optional exact row counts so opening a multi-million-row table does not begin with an expensive `count(*)`.
4. **Production safety:** per-connection write mode, optional session-level “unlock writes,” stronger visual distinction for production connections, optimistic-concurrency checks, and an audit trail of Data-view mutations.
5. **Live data:** opt-in polling or Postgres change streaming that keeps the visible page current without resetting selection, scroll position, or draft edits.

### Connection graphs
- A connection-level view beside Query and Data, selected from the "Query" / "Data" / "Graphs" / "ERD" switcher in the workbench's top bar.
- A date-range control sits at the top: **This week** (Monday-start, not a rolling 7 days), **This month** (calendar month-to-date), or **Custom** — start/end date fields are always visible for all three. Clicking This week/This month recomputes and overwrites the fields; editing a field by hand switches to Custom automatically. The chosen range drives both bar charts and the query-latency sparkline, and persists per connection (localStorage) so it's remembered next time this connection's graphs are opened. Switching ranges doesn't blank/reload the whole view — only the first-ever load shows a full-page spinner; a range switch shows a small inline one next to the range control while the previous chart stays on screen.
- Below that: connections-used and storage-usage bar charts, then a quiet divided strip for cache hit ratio, rollback rate, longest-running query, and query latency (all from whatever "Connection stats" scheduled query has been collecting hourly into that connection's own database — see `dbeans_connection_stats` in ARCHITECTURE.md §4). A borderless recent-failed-runs list sits at the bottom, drawn from that connection's own job run history; clicking a row opens a dialog with that run's timing, attempts, trigger source, and its recorded error message.
- No separate Status/Reachability card here (2026-09-17) — it's shown elsewhere (the connection canvas card), so repeating it in the graphs view was redundant. Authentication, TLS mode, and "last successful check" were tried earlier as their own status cards and cut before that — they either duplicated Status or weren't real/actionable signals. See ARCHITECTURE.md §4 for the metric rationale and the stats-collection SQL.
- If no stats job has ever run for a connection (or an existing one hasn't been updated with the newer columns), this just shows an empty state pointing at setting one up — nothing is auto-provisioned. A connection with only a few days of real history simply renders a shorter chart for a range like "this month" that extends before the data starts — no crash, no placeholder data.

### ERD / relationship diagram
- A connection-level view alongside Query, Data, and Graphs — one card per table (name, columns, primary/foreign key markers) and an arrow per foreign key, introspected live from the connection's own `information_schema` (real constraints, not inferred from column-naming conventions).
- Auto-laid-out by dependency depth (a table nothing else points at sits leftmost; anything referencing it sits further right) so the diagram reads as an actual hierarchy instead of an arbitrary scatter — nodes stay draggable for the session but nothing about the layout is persisted, since it's a live snapshot of the schema, not a user-curated board like the connections/jobs canvases.
- Handles a "hub" schema gracefully — a table referenced directly by most others (a `users` table every other table points at, say) doesn't produce one absurdly long column or a tangle of arrows funneling through a single point: long columns wrap into a grid, and each arrow attaches wherever it naturally lands on the two tables' borders rather than a fixed side (see ARCHITECTURE.md §3).
- Reflects reality exactly: a connection whose tables have no real foreign keys defined (an app that never added them, or one built on convention over constraints) correctly shows a diagram with no relationship lines, rather than guessing relationships from naming.

### Results grid
- Paginated, virtualized grid for large result sets.
- Sort/filter client-side for the loaded page.
- Inline cell editing that generates and runs an `UPDATE`, with a confirm step before committing.
- Export visible results to CSV/JSON.

### Query history & saved queries
- Manually save a query (from any editor tab, saved or not) for reuse; rename or delete it later, from the tab itself.
- **Not yet implemented:** automatic history of executed queries — still just manually-saved queries, no auto-logged run history yet.

### Settings
- Theme (light/dark/system).
- Change account password (planned — see ARCHITECTURE.md §8 open questions).
- Manage saved connections and snippets in one place.
- Sign out.

### Scheduled jobs / data orchestration
- A job = a typed action and a cron schedule, with optional dependencies on other jobs and a retry policy — a simple, extensible orchestrator rather than just a SQL cron trigger. The creation screen starts with a job-type choice so new action types can be added without redesigning the canvas.
- **Query jobs** run saved SQL against a saved connection. They may also apply a post-run check to the query result (fail if it returns/doesn't return rows).
- **HTTP request jobs** call an API on schedule. The user chooses GET/POST/PUT/PATCH/DELETE and can provide headers, a request body, and an optional per-job timeout override (for a slow or cold-starting endpoint — default 20s, up to 280s). Any 2xx response is success by default, and the response body is otherwise discarded rather than imported as data — except for one opt-in check (`failOnNonEmptyArrayField`): also fail the job when a named top-level array field in a 2xx JSON response is non-empty, for an endpoint that reports partial failures (e.g. `{"failed": [...]}`) inside an otherwise-successful response. (This is more precise than “webhook,” which usually means an event-triggered callback.)
- Deployment target is Vercel, which has no persistent scheduler — jobs are triggered by an external service ([cron-job.org](https://cron-job.org)) hitting one shared, secret-gated endpoint (`GET /api/jobs/tick`) on a fixed interval (running every 5 minutes in practice); dbeans itself decides what's due each tick and runs it. The user configures **one** external cron entry total, not one per job — see ARCHITECTURE.md §6. The exact tick URL (with secret) is shown in Settings.
- Query SQL and HTTP request URLs, headers, and bodies support `{{date}}` / `{{date-1}}` / `{{date+N}}` / `{{datetime}}` placeholders, substituted (UTC) right before each run.
- **Secrets** (`/secrets`, its own section separate from Connections/Jobs) is a per-user vault of named values — set `CHESSLAB_BACKEND_URL` once, then any job references it the same way as a date placeholder: `{{CHESSLAB_BACKEND_URL}}`. Write-only: a saved value is never shown again, only its name; editing means renaming and/or overwriting. Resolved everywhere `{{date}}` already is (query SQL, HTTP url/headers/body), plus the job editor's "Test query" button. The SQL/HTTP editors color a date placeholder and a secret reference differently, so it's visible at a glance which is which.
- Own canvas UI (`/jobs`), mirroring the connections board — a card per job, create/edit/pause/delete from there. Dependency arrows between jobs are drawn automatically on the canvas from each job's configured dependencies (no manual arrow-drawing).
- "Depends on" is a searchable, multi-select dropdown over the other jobs (not a fixed checkbox list), so it stays usable as the number of jobs grows.
- Running a job on demand (today or a backfill for a past/future logical date) and reviewing run history happens from the job's edit panel, via a Dagster/Airflow-style calendar of the last ~9 weeks (colored by that date's latest run status) plus a recent-runs list — not from the canvas card's context menu, which only has Edit/Pause/Remove.
- A backfill can optionally cascade **downstream** (Airflow's term for it) — a checkbox next to the Backfill button also (re)runs every job that transitively depends on the one being backfilled, in dependency order, stopping a branch as soon as something in it doesn't succeed.
- A dependency is a real wait, not a timing coincidence: a job with `dependsOn` set doesn't trigger off its own cron at all (that field becomes informational) — it's queued the moment every one of its dependencies has actually succeeded for that cycle, and only runs once all of them have, however differently they're each scheduled (hourly feeding into a daily job, etc.) — see ARCHITECTURE.md §6.
- **Built and executing for real:** query jobs run against Postgres connections and HTTP request jobs call HTTP(S) endpoints. MySQL/SQLite connections can be attached to a query job but fail at run time until those drivers are wired up (see ARCHITECTURE.md §2). A query job's connection can be any saved Postgres connection, including one pointed at dbeans' own operator database — useful for meta jobs (e.g. logging other jobs' run history into a table of its own).
- Since a job's SQL only ever runs against its own single connection (no cross-database queries), a job that needs to track something *about* a connection (size, table count, row counts, etc., for a future per-connection graph) writes its own small history table into that same connection's database, rather than into a shared table elsewhere — one hourly "Connection stats" job per connection being tracked.

## 6. Explicitly deferred (possible future phases)

- ER diagrams / visual schema explorer.
- Additional engines (MSSQL, MongoDB, etc.) — architecture should make this easy to add later, but not built in v1.
- Query plan visualization (`EXPLAIN` output as a diagram).
- Import wizards (CSV → table).

## 7. Success criteria for v1

- Can add a Postgres, a MySQL, and a SQLite connection, browse their schemas, and run/edit queries against all three without leaving the browser.
- A cold self-host (`docker run` + one env var) gets to a working login screen in under 5 minutes.
- The UI has no unstyled/default-browser-looking elements, no layout jank, and no screen that feels like a "developer tool default" rather than a designed product.

## 8. Open questions (to revisit during design/build)

- Exact password/session model details (session length, "remember me") — see ARCHITECTURE.md for the current proposal.
