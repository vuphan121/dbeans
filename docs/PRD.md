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

### Schema browser
- Tree view of databases → schemas → tables/views → columns/indexes/constraints.
- Quick metadata on hover/click: column types, nullability, defaults, keys.
- Search/filter within the tree.

### SQL editor
- Multi-tab editor, one tab per query/session.
- Syntax highlighting, schema-aware autocomplete (table/column names).
- Run selection or full statement; cancel a running query.
- Keyboard-first: run query, new tab, command palette, etc. all reachable without a mouse.

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

### Scheduled queries / data orchestration
- A job = a saved SQL query, a connection to run it against, and a cron schedule, with optional dependencies on other jobs, a retry policy, and a post-run check against the query's own result (fail if it returns/doesn't return rows) — a simple orchestrator, not just a cron trigger.
- Deployment target is Vercel, which has no persistent scheduler — jobs are triggered by an external service ([cron-job.org](https://cron-job.org)) hitting one shared, secret-gated endpoint (`GET /api/jobs/tick`) on a fixed interval (15 minutes minimum in practice); dbeans itself decides what's due each tick and runs it. The user configures **one** external cron entry total, not one per job — see ARCHITECTURE.md §6. The exact tick URL (with secret) is shown in Settings.
- Job SQL supports `{{date}}` / `{{date-1}}` / `{{date+N}}` / `{{datetime}}` placeholders, substituted (UTC) right before each run.
- Own canvas UI (`/jobs`), mirroring the connections board — a card per job, create/edit/run-now/pause/delete from there.
- **Built and executing for real** against Postgres connections (not stubbed) — MySQL/SQLite connections can be attached to a job but fail at run time until those drivers are wired up (see ARCHITECTURE.md §2).

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
- Whether inline data editing ships in v1 or slips to a fast-follow if the SQL editor + results grid alone take longer than expected.
