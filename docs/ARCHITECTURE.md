# dbeans — Architecture

## 1. Overview

dbeans is a Go backend (JSON API) plus a React frontend. Unlike the original plan, dbeans now depends on one external service by design: a Postgres database (currently [Neon](https://neon.tech)) that owns **dbeans' own account/session/analytics data** — it is not a target database the user browses, it's dbeans' operator database. Target databases (the ones the user actually inspects) are configured separately per connection and support SQL engines plus Redis and Kafka.

```
Browser (React SPA)
      │  HTTPS
      ▼
Go backend
 ├─ Auth (bcrypt password hash + bearer session tokens, stored in Postgres)
 ├─ REST API (auth, analytics events, connections + reachability ping, schema,
 │            query execution, scheduled jobs + tick endpoint)
 ├─ Driver abstraction layer
 │    ├─ database/sql compatible ── pgx (PostgreSQL, real — see §2) · go-sql-driver (MySQL/MariaDB, planned) · modernc sqlite (SQLite, planned)
 │    ├─ go-redis                 (Redis: key browse/edit)
 │    └─ segmentio/kafka-go       (Kafka: topic/message browse + produce)
 └─ Operator DB (Postgres, e.g. Neon) — DATABASE_URL from env
      - users, sessions               (real auth, not a demo)
      - analytics_events              (sign-ins, query runs, ...)
      - connections                   (saved connections + canvas layout + reachability status)
      - jobs, job_runs                (scheduled queries + their run history)
      - query history, saved queries, app settings (history planned; saved queries still client-side — see §4)
                      │
                      ▼
   User's target sources: Postgres / MySQL / SQLite / Redis / Kafka
```

## 2. Backend (Go)

- **Language/runtime:** Go, compiled to a single static binary.
- **HTTP framework:** a small router (chi or equivalent) — no need for a heavy framework given the API surface is modest.
- **Driver abstraction (partially built):** the original plan is a `database/sql`-based abstraction shared across Postgres/MySQL/SQLite. **Current state:** only Postgres is wired up, directly via `pgx` (`backend/internal/api/query.go`), not yet behind a generic `Driver` interface — `GetConnectionSchema` introspects `information_schema` for tables/columns/views, `RunConnectionQuery` executes arbitrary SQL and returns up to 1000 rows (decoded via Postgres' text wire format so every cell is a plain string, avoiding pgtype-decoding edge cases). MySQL/SQLite connections can be created and pinged but fail at query/schema time with an explicit "not wired up yet" error rather than silently returning nothing. **Not yet built:** query cancellation, server-side pagination/streaming for very large result sets (the 1000-row cap is a blunt stand-in), and identifier-quoting for generated `UPDATE` statements (inline cell editing itself isn't built either).
- Generalizing today's Postgres-only code into a real multi-engine `Driver` interface is the extension point for adding MySQL/SQLite/MSSQL etc. without touching the API or frontend contracts.
- **Frontend embedding:** the built React app (static JS/CSS/HTML) is embedded into the Go binary via `go:embed`, so `docker run dbeans` (or a single copied binary) serves both API and UI on one port.
- **Realtime/streaming:** a WebSocket (or SSE) connection per active query tab, used to push query status (running/done/error), elapsed time, and cancellation support without polling.

## 3. Frontend (React + TypeScript)

- **Build tooling:** Vite.
- **Connections canvas:** the home screen (`/connections`) is a pannable/zoomable 2D board built on `@xyflow/react` (React Flow) — each saved connection is a draggable, resizable card (`ConnectionCard`). Position/size snap to a 40px grid that's aligned to the background dot pattern (`frontend/src/lib/canvasBounds.ts` — React Flow centers each dot within its cell rather than at the flow origin, so the snap grid is offset by half a cell to actually land on the dots, not between them). New cards are placed outward from the center of a bounded field (`CANVAS_BOUNDS`) rather than stacking in a corner.
- **SQL editor component:** CodeMirror 6 (schema-aware autocomplete, SQL syntax highlighting, good performance on large documents) — Monaco is a fallback option if CodeMirror's SQL tooling proves insufficient.
- **Data grid:** a virtualized grid component (for large result sets) supporting inline cell editing, sort/filter on the loaded page, pagination (rows-per-page + prev/next, BigQuery-style), and a resizable split against the editor pane.
- **State/data fetching:** plain `fetch` wrappers (`frontend/src/lib/api.ts`) + Zustand stores per domain (`state/connections.ts`, `state/auth.ts`, `state/workbench.ts`, `state/jobs.ts`, `state/schema.ts`, ...) — connections and jobs are fetched from the backend on login and cached in the store, not persisted to `localStorage` (the backend is the source of truth for those). A React Query-based data layer is still the plan if caching/invalidation gets more complex than the current fetch-on-load-and-optimistically-update pattern handles well.
- **Styling/component system:** Tailwind CSS + headless primitives (Radix UI) as the base, with a small custom design-token layer on top (see [DESIGN.md](DESIGN.md)) — not a heavy prebuilt component library, to keep the UI distinctive rather than looking like a generic admin template.
- **App-wide nav:** a collapsible left rail (`AppNavRail`, `@radix-ui/react-collapsible`) wraps every authenticated page — Connections, Workbench, Scheduled queries, Settings — showing icon-only by default and expanding to icons+labels; expanded/collapsed state persists (`state/settings.ts`). Replaces the old per-page header icon buttons for cross-page navigation.

## 4. dbeans' own operator data

dbeans needs to persist things about itself, separate from the databases/streams it manages. **Current state:** `users`, `sessions`, `analytics_events`, `connections`, `jobs`, and `job_runs` are implemented and live in the operator Postgres DB (`backend/internal/db`, migrated with plain `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — no migration framework needed at this scale). The `connections` table holds each saved connection's engine-specific `fields` (JSONB), its canvas `layout` (JSONB — x/y/width/height), and a cached reachability `status` + `last_checked_at` (see §5 below); `jobs` holds each scheduled query's SQL, cron expression, `depends_on` (JSONB array of job ids), retry policy, check mode, and canvas layout, with `job_runs` recording each execution's status/attempts/error/duration. **Not yet implemented:** query history and saved queries (formerly "snippets") still live client-side only (Zustand + `localStorage`, empty by default — no longer mock-seeded) — moving them into Postgres, scoped per user, is the next backend milestone.

## 5. Security model

- **Accounts:** real username/password accounts, not a single shared master password. Passwords are hashed with bcrypt (`golang.org/x/crypto/bcrypt`) before ever touching the database — `backend/internal/auth`. There is no self-serve signup; accounts are seeded server-side (`SEED_USERNAME`/`SEED_PASSWORD` env vars, applied once on startup, safe to leave set — it no-ops if the user already exists).
- **Sessions:** login returns an opaque random 32-byte token (hex-encoded), stored in the `sessions` table with an expiry (30 days) and sent back as a `Bearer` token on subsequent requests — no server-side JWT signing secret to manage, revocation is just a row delete (`/api/auth/logout`). Tokens are currently kept in the frontend's persisted Zustand state (`localStorage`); moving to an `HttpOnly` cookie is a follow-up hardening step once the frontend and backend are deployed behind the same origin.
- **Secrets:** `DATABASE_URL` (and any seed credentials) are read from environment variables only — `backend/.env` for local dev (gitignored, never committed) via `godotenv`, real platform env vars in production. `backend/.env.example` documents the shape without real values.
- **Brute-force protection:** the frontend enforces a client-side attempt counter and lockout window on failed logins; the backend itself does not yet rate-limit `/api/auth/login` — that's an open item before this is exposed beyond a trusted network.
- **Transport security:** dbeans assumes TLS termination happens in front of it (reverse proxy such as Caddy/nginx/Cloudflare Tunnel, or the PaaS's own edge) for any real deployment; the Go server itself speaks plain HTTP.
- **CORS:** the backend only allows the configured `ALLOWED_ORIGINS` (the frontend's own origin) — see `main.go`.
- **Query execution safety:** the workbench and scheduled jobs run the user's own literal, hand-authored SQL text directly (`conn.Query`, no string-interpolation of *other* input into it) — expected for a SQL client, not a vulnerability, since it's the authenticated single-user's own credentials and own query. The still-open concern is generated SQL from a not-yet-built feature (inline cell editing's `UPDATE` statements), which must be parameterized once that ships — see [PRD.md](PRD.md).
- **Connection reachability is a TCP check, not a login check:** `POST /api/connections/{id}/ping` (`backend/internal/api/ping.go`) dials the connection's `host:port` with a short timeout and records `online`/`offline`/`unknown` (SQLite is a local file path, not a host, so it's always `unknown`). This confirms something is listening, **not** that the stored credentials are valid — that requires the real per-engine driver connection this doc already flags as unbuilt. Results are cached server-side for 60s per connection (`last_checked_at`), so the frontend can safely ping on every page load without hammering the target — worth reusing this exact cache pattern for the scheduled-job "ping" trigger described below.

## 6. Deployment

- **Backend:** deployed and verified live via Vercel's **Go Framework Preset** (`backend/vercel.json` sets `"framework": "go"`) — this runs `backend/main.go` directly as a real Go server (`http.ListenAndServe`, reading `PORT` from the environment Vercel provides), *not* the older per-file `/api/*.go` serverless-function model. No request wrapper or rewrites needed; the existing chi router just works. The route/DB-setup wiring lives in `backend/internal/server` so the exact same code path also runs as a plain local binary (`go run .`) or on any traditional always-on host (Railway/Fly.io/a VPS), unchanged. Reads `DATABASE_URL`, `ALLOWED_ORIGINS`, `CRON_SECRET`, `SEED_USERNAME`/`SEED_PASSWORD` from the environment (see `backend/.env.example`). No local disk state — everything durable lives in the operator Postgres DB. See [DEPLOYMENT.md](DEPLOYMENT.md) for exact setup steps.
- **Frontend:** a separate Vite static build (`VITE_API_URL` pointing at wherever the backend is deployed), deployed as its own Vercel project (or any static host) — verified live, pointed at the Vercel-deployed backend above. The original single-binary plan (`go:embed` of `frontend/dist` into the Go binary) still stands as an alternative packaging for a non-Vercel, single-host deployment — not wired up, since the two-project Vercel split covers the current target.
- **Operator database:** any reachable Postgres works (developed against Neon); the backend runs its own migration on startup, so pointing at a fresh database is enough.
- **Scheduled jobs on Vercel:** there's still no persistent in-process scheduler once deployed there — one shared, secret-token-gated endpoint (`GET /api/jobs/tick?secret=...`, checked against `CRON_SECRET`) is hit by an external scheduler ([cron-job.org](https://cron-job.org)) on a fixed interval; the backend stores each job's own cron schedule (parsed with `github.com/robfig/cron/v3`) in Postgres and decides what's due on every tick, running each due job through dependency checks, retries, and its check — see [PRD.md](PRD.md). This means exactly **one** external cron entry ever needs to be configured by hand, not one per job; the exact tick URL is surfaced in Settings. **Caveat:** a job's retry delay sleeps synchronously inside the tick request, so a due job with a long `retryDelaySeconds` (or several due jobs in one tick, each retrying) risks the request's execution-time ceiling, whatever that ends up being for your specific Vercel plan/config — keep retry delays short if the job actually relies on retrying, or use the traditional-host path instead, which has no such ceiling.
- **Dependency-driven jobs don't use their own cron to trigger — they're driven by a persistent queue (`job_queue`).** The tick's due-jobs query only ever matches jobs with an empty `depends_on` (root jobs); anything with a dependency is excluded from cron matching entirely; its `cron_expr` is stored but purely informational. Instead, whenever a job succeeds, every job that depends on it gets a `job_queue` row for that same `run_date`, and every tick drains the queue: an entry runs the moment *all* of that job's dependencies have a recorded success for that exact `run_date` (stricter than the "most recent status, any date" check `executeJob` uses for a plain manual run), cascading through as many dependency levels as are ready and persisting across tick invocations if a chain doesn't fully resolve in one. This replaced an earlier design where a dependent job had its own cron entry offset a few minutes after its dependency's — that worked by spacing, not by actually waiting, since the tick's due-jobs query has no `ORDER BY` and two jobs due in the same tick could be evaluated in either order.
- **Cron scheduling is explicitly UTC-anchored** (`schedule.Next(time.Now().UTC())`, not bare `time.Now()`) — found the hard way running the backend locally on a non-UTC dev machine, where `next_run_at` silently got computed against the OS's local timezone instead. Vercel's containers happen to run in UTC by default, which is the only reason this wasn't visible in production, but relying on that implicitly was a latent bug.

## 7. Key architectural decisions & rationale

| Decision | Rationale |
|---|---|
| Go backend | Good concurrency for query execution/streaming, no runtime dependency hell, matches the original plan. |
| `database/sql` + driver abstraction for SQL engines, separate clients for Redis/Kafka | Postgres/MySQL/SQLite share one API/query-execution path; Redis and Kafka aren't SQL, so they get their own thin driver interfaces instead of being forced into `database/sql`. |
| Real accounts (bcrypt + Postgres) instead of a single shared master password | User-requested pivot from the original single-password-vault plan; also unlocks per-user analytics and, later, per-user saved connections. |
| Operator data in Postgres (Neon) rather than local SQLite | Chosen when auth moved to real accounts — a hosted Postgres instance was already the natural home for `users`/`sessions`, and keeping analytics there too avoids a second storage system. |
| Bearer tokens instead of cookies (for now) | Simplest thing that works across the current separate-origin dev setup (Vite on one port, Go on another); revisit as an `HttpOnly` cookie once frontend and backend share an origin in production. |
| React + CodeMirror + Tailwind/Radix + cmdk | Modern, fast editor and command-palette experience; unstyled primitives keep the UI from looking like a generic admin template. |
| `@xyflow/react` for the connections canvas | Pan/zoom/drag/resize on a 2D board is a well-trodden problem; reusing a mature library (with a custom node component + our own grid-snap math layered on top) beat hand-rolling pointer-drag physics. |
| Connection reachability = TCP dial, not a real driver ping | Gives a genuinely real (not fake) status signal today without pulling in every engine's driver before query execution exists — see §5. Revisit once real per-engine connections are built; a real `Ping()` per driver would be strictly better. |
| One shared cron-triggered endpoint instead of one URL per job | Vercel has no persistent scheduler; an external trigger (cron-job.org) is required regardless, but a single shared "tick" endpoint means the *user* only ever configures one external cron entry, and all job scheduling logic/state lives in dbeans itself. |

## 8. Open questions

- Migrating saved queries/query history from client-side storage into the operator Postgres DB, scoped per user (connections and jobs already made this move — see §4).
- Rate limiting `/api/auth/login` server-side (currently only client-side attempt counting).
- Moving the session token from `localStorage` to an `HttpOnly` cookie once frontend/backend share an origin.
- Whether query cancellation needs WebSockets or whether SSE is sufficient (leaning WebSocket for bidirectional cancel + status) — real query execution now exists (Postgres only), so this is no longer blocked on that, just not built yet.
- How much schema-introspection metadata to cache vs. re-fetch on each schema-tree expand (perf vs. staleness tradeoff — the frontend currently caches per connection for the session and only re-fetches on an explicit refresh click).
- Generalizing `backend/internal/api/query.go`'s Postgres-only introspection/execution into the multi-engine `Driver` abstraction described in §2, so MySQL/SQLite connections and jobs can actually run instead of erroring.
- Real per-engine job retry delays currently block the tick request itself (`time.Sleep` between attempts) — fine at personal-project scale, but worth revisiting (background workers / async retry) if job volume or retry counts grow.
