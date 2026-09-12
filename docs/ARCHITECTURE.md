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
 │            query execution, history, snippets)
 ├─ Driver abstraction layer
 │    ├─ database/sql compatible ── pgx (PostgreSQL) · go-sql-driver (MySQL/MariaDB) · modernc sqlite (SQLite)
 │    ├─ go-redis                 (Redis: key browse/edit)
 │    └─ segmentio/kafka-go       (Kafka: topic/message browse + produce)
 └─ Operator DB (Postgres, e.g. Neon) — DATABASE_URL from env
      - users, sessions               (real auth, not a demo)
      - analytics_events              (sign-ins, query runs, ...)
      - connections                   (saved connections + canvas layout + reachability status)
      - query history, snippets, app settings (planned — see §4)
                      │
                      ▼
   User's target sources: Postgres / MySQL / SQLite / Redis / Kafka
```

## 2. Backend (Go)

- **Language/runtime:** Go, compiled to a single static binary.
- **HTTP framework:** a small router (chi or equivalent) — no need for a heavy framework given the API surface is modest.
- **Driver abstraction:** all target-database access goes through Go's standard `database/sql` interface, with an internal `Driver` abstraction on top that normalizes:
  - schema introspection (tables, columns, indexes, constraints) per engine, since `information_schema` support and quirks differ across Postgres/MySQL/SQLite.
  - query execution + cancellation + streaming of large result sets (paginate server-side rather than loading an entire result set into memory).
  - identifier quoting / SQL dialect differences for generated `UPDATE` statements (inline cell editing).
- This abstraction is the extension point for adding engines later (MSSQL, etc.) without touching the API or frontend contracts.
- **Frontend embedding:** the built React app (static JS/CSS/HTML) is embedded into the Go binary via `go:embed`, so `docker run dbeans` (or a single copied binary) serves both API and UI on one port.
- **Realtime/streaming:** a WebSocket (or SSE) connection per active query tab, used to push query status (running/done/error), elapsed time, and cancellation support without polling.

## 3. Frontend (React + TypeScript)

- **Build tooling:** Vite.
- **Connections canvas:** the home screen (`/connections`) is a pannable/zoomable 2D board built on `@xyflow/react` (React Flow) — each saved connection is a draggable, resizable card (`ConnectionCard`). Position/size snap to a 40px grid that's aligned to the background dot pattern (`frontend/src/lib/canvasBounds.ts` — React Flow centers each dot within its cell rather than at the flow origin, so the snap grid is offset by half a cell to actually land on the dots, not between them). New cards are placed outward from the center of a bounded field (`CANVAS_BOUNDS`) rather than stacking in a corner.
- **SQL editor component:** CodeMirror 6 (schema-aware autocomplete, SQL syntax highlighting, good performance on large documents) — Monaco is a fallback option if CodeMirror's SQL tooling proves insufficient.
- **Data grid:** a virtualized grid component (for large result sets) supporting inline cell editing, sort/filter on the loaded page, pagination (rows-per-page + prev/next, BigQuery-style), and a resizable split against the editor pane.
- **State/data fetching:** plain `fetch` wrappers (`frontend/src/lib/api.ts`) + Zustand stores per domain (`state/connections.ts`, `state/auth.ts`, `state/workbench.ts`, ...) — connections are fetched from the backend on login and cached in the store, not persisted to `localStorage` (the backend is the source of truth now). A React Query-based data layer is still the plan once real query execution lands and caching/invalidation gets more complex.
- **Styling/component system:** Tailwind CSS + headless primitives (Radix UI) as the base, with a small custom design-token layer on top (see [DESIGN.md](DESIGN.md)) — not a heavy prebuilt component library, to keep the UI distinctive rather than looking like a generic admin template.

## 4. dbeans' own operator data

dbeans needs to persist things about itself, separate from the databases/streams it manages. **Current state:** `users`, `sessions`, `analytics_events`, and `connections` are implemented and live in the operator Postgres DB (`backend/internal/db`, migrated with plain `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — no migration framework needed at this scale). The `connections` table holds each saved connection's engine-specific `fields` (JSONB), its canvas `layout` (JSONB — x/y/width/height), and a cached reachability `status` + `last_checked_at` (see §5 below). **Not yet implemented:** query history and snippets still live client-side only (Zustand, mock-seeded) — moving them into Postgres, scoped per user, is the next backend milestone.

## 5. Security model

- **Accounts:** real username/password accounts, not a single shared master password. Passwords are hashed with bcrypt (`golang.org/x/crypto/bcrypt`) before ever touching the database — `backend/internal/auth`. There is no self-serve signup; accounts are seeded server-side (`SEED_USERNAME`/`SEED_PASSWORD` env vars, applied once on startup, safe to leave set — it no-ops if the user already exists).
- **Sessions:** login returns an opaque random 32-byte token (hex-encoded), stored in the `sessions` table with an expiry (30 days) and sent back as a `Bearer` token on subsequent requests — no server-side JWT signing secret to manage, revocation is just a row delete (`/api/auth/logout`). Tokens are currently kept in the frontend's persisted Zustand state (`localStorage`); moving to an `HttpOnly` cookie is a follow-up hardening step once the frontend and backend are deployed behind the same origin.
- **Secrets:** `DATABASE_URL` (and any seed credentials) are read from environment variables only — `backend/.env` for local dev (gitignored, never committed) via `godotenv`, real platform env vars in production. `backend/.env.example` documents the shape without real values.
- **Brute-force protection:** the frontend enforces a client-side attempt counter and lockout window on failed logins; the backend itself does not yet rate-limit `/api/auth/login` — that's an open item before this is exposed beyond a trusted network.
- **Transport security:** dbeans assumes TLS termination happens in front of it (reverse proxy such as Caddy/nginx/Cloudflare Tunnel, or the PaaS's own edge) for any real deployment; the Go server itself speaks plain HTTP.
- **CORS:** the backend only allows the configured `ALLOWED_ORIGINS` (the frontend's own origin) — see `main.go`.
- **Query execution safety:** once real query execution against target databases is wired up, generated SQL (e.g. from inline cell editing) must be parameterized, never string-interpolated. Not yet built — see [PRD.md](PRD.md).
- **Connection reachability is a TCP check, not a login check:** `POST /api/connections/{id}/ping` (`backend/internal/api/ping.go`) dials the connection's `host:port` with a short timeout and records `online`/`offline`/`unknown` (SQLite is a local file path, not a host, so it's always `unknown`). This confirms something is listening, **not** that the stored credentials are valid — that requires the real per-engine driver connection this doc already flags as unbuilt. Results are cached server-side for 60s per connection (`last_checked_at`), so the frontend can safely ping on every page load without hammering the target — worth reusing this exact cache pattern for the scheduled-job "ping" trigger described below.

## 6. Deployment

- **Backend:** a Go binary reading `DATABASE_URL`, `PORT`, `ALLOWED_ORIGINS` from the environment (see `backend/.env.example`). No local disk state required — everything durable lives in the operator Postgres DB.
- **Frontend:** currently a separate Vite dev server / static build (`VITE_API_URL` pointing at the backend). The original single-binary plan (`go:embed` of `frontend/dist`) still stands as the target packaging for a real release — not yet wired up.
- **Operator database:** any reachable Postgres works (developed against Neon); the backend runs its own migration on startup, so pointing at a fresh database is enough.
- **Target platform: Vercel.** Vercel's serverless functions are stateless/ephemeral — no persistent in-process scheduler for cron-style jobs. Planned approach (not built yet — `github.com/robfig/cron/v3` is added to `go.mod` as prep, unused so far): one shared, secret-token-gated endpoint (`GET /api/jobs/tick`) that an external scheduler ([cron-job.org](https://cron-job.org)) hits on a fixed interval (e.g. every minute); the backend itself stores each job's own cron schedule in Postgres and decides what's due on every tick. This means exactly **one** external cron entry ever needs to be configured by hand, not one per job — see [PRD.md](PRD.md) for the job-orchestration feature scope.

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
| One shared cron-triggered endpoint instead of one URL per job (planned) | Vercel has no persistent scheduler; an external trigger (cron-job.org) is required regardless, but a single shared "tick" endpoint means the *user* only ever configures one external cron entry, and all job scheduling logic/state lives in dbeans itself. |

## 8. Open questions

- Migrating snippets/query history from client-side mock storage into the operator Postgres DB, scoped per user (connections already made this move — see §4).
- Rate limiting `/api/auth/login` server-side (currently only client-side attempt counting).
- Moving the session token from `localStorage` to an `HttpOnly` cookie once frontend/backend share an origin.
- Whether query cancellation needs WebSockets or whether SSE is sufficient (leaning WebSocket for bidirectional cancel + status) — relevant once real query execution against target databases is built.
- How much schema-introspection metadata to cache vs. re-fetch on each schema-tree expand (perf vs. staleness tradeoff, revisit once real usage patterns are known).
- Scheduled jobs / data orchestration (planned, not built): job model is "run this saved SQL against this connection on this cron schedule" — since real query execution doesn't exist yet, initial job runs will be stubbed (logged as "would have run against X", not actually executed) until that lands. Needs: `jobs` + `job_runs` tables, the `/api/jobs/tick` endpoint described in §6, a `CRON_SECRET` env var, and a way for the user to see the one tick URL they need to paste into cron-job.org.
