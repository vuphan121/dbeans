# dbeans — Architecture

## 1. Overview

dbeans is a Go backend (JSON API) plus a React frontend. Unlike the original plan, dbeans now depends on one external service by design: a Postgres database (currently [Neon](https://neon.tech)) that owns **dbeans' own account/session/analytics data** — it is not a target database the user browses, it's dbeans' operator database. Target databases (the ones the user actually inspects) are configured separately per connection and support SQL engines plus Redis and Kafka.

```
Browser (React SPA)
      │  HTTPS
      ▼
Go backend
 ├─ Auth (bcrypt password hash + bearer session tokens, stored in Postgres)
 ├─ REST API (auth, analytics events, connections, schema, query execution, history, snippets)
 ├─ Driver abstraction layer
 │    ├─ database/sql compatible ── pgx (PostgreSQL) · go-sql-driver (MySQL/MariaDB) · modernc sqlite (SQLite)
 │    ├─ go-redis                 (Redis: key browse/edit)
 │    └─ segmentio/kafka-go       (Kafka: topic/message browse + produce)
 └─ Operator DB (Postgres, e.g. Neon) — DATABASE_URL from env
      - users, sessions               (real auth, not a demo)
      - analytics_events              (sign-ins, query runs, ...)
      - saved connections, query history, snippets, app settings (planned — see §4)
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
- **SQL editor component:** CodeMirror 6 (schema-aware autocomplete, SQL syntax highlighting, good performance on large documents) — Monaco is a fallback option if CodeMirror's SQL tooling proves insufficient.
- **Data grid:** a virtualized grid component (for large result sets) supporting inline cell editing, sort/filter on the loaded page, and column resize.
- **State/data fetching:** React Query (server state: schema, results, history) + a small client-state store (Zustand) for UI state (open tabs, panel sizes, theme).
- **Styling/component system:** Tailwind CSS + headless primitives (Radix UI) as the base, with a small custom design-token layer on top (see [DESIGN.md](DESIGN.md)) — not a heavy prebuilt component library, to keep the UI distinctive rather than looking like a generic admin template.

## 4. dbeans' own operator data

dbeans needs to persist things about itself, separate from the databases/streams it manages. **Current state:** `users`, `sessions`, and `analytics_events` are implemented and live in the operator Postgres DB (`backend/internal/db`, migrated with plain `CREATE TABLE IF NOT EXISTS` — no migration framework needed at this scale). **Not yet implemented:** saved connections, query history, and snippets currently live client-side only (Zustand + `localStorage`, seeded with mock data) — moving them into the same Postgres tables, scoped per user, is the next backend milestone so they survive a cleared browser and work from more than one device.

## 5. Security model

- **Accounts:** real username/password accounts, not a single shared master password. Passwords are hashed with bcrypt (`golang.org/x/crypto/bcrypt`) before ever touching the database — `backend/internal/auth`. There is no self-serve signup; accounts are seeded server-side (`SEED_USERNAME`/`SEED_PASSWORD` env vars, applied once on startup, safe to leave set — it no-ops if the user already exists).
- **Sessions:** login returns an opaque random 32-byte token (hex-encoded), stored in the `sessions` table with an expiry (30 days) and sent back as a `Bearer` token on subsequent requests — no server-side JWT signing secret to manage, revocation is just a row delete (`/api/auth/logout`). Tokens are currently kept in the frontend's persisted Zustand state (`localStorage`); moving to an `HttpOnly` cookie is a follow-up hardening step once the frontend and backend are deployed behind the same origin.
- **Secrets:** `DATABASE_URL` (and any seed credentials) are read from environment variables only — `backend/.env` for local dev (gitignored, never committed) via `godotenv`, real platform env vars in production. `backend/.env.example` documents the shape without real values.
- **Brute-force protection:** the frontend enforces a client-side attempt counter and lockout window on failed logins; the backend itself does not yet rate-limit `/api/auth/login` — that's an open item before this is exposed beyond a trusted network.
- **Transport security:** dbeans assumes TLS termination happens in front of it (reverse proxy such as Caddy/nginx/Cloudflare Tunnel, or the PaaS's own edge) for any real deployment; the Go server itself speaks plain HTTP.
- **CORS:** the backend only allows the configured `ALLOWED_ORIGINS` (the frontend's own origin) — see `main.go`.
- **Query execution safety:** once real query execution against target databases is wired up, generated SQL (e.g. from inline cell editing) must be parameterized, never string-interpolated. Not yet built — see [PRD.md](PRD.md).

## 6. Deployment

- **Backend:** a Go binary reading `DATABASE_URL`, `PORT`, `ALLOWED_ORIGINS` from the environment (see `backend/.env.example`). No local disk state required — everything durable lives in the operator Postgres DB.
- **Frontend:** currently a separate Vite dev server / static build (`VITE_API_URL` pointing at the backend). The original single-binary plan (`go:embed` of `frontend/dist`) still stands as the target packaging for a real release — not yet wired up.
- **Operator database:** any reachable Postgres works (developed against Neon); the backend runs its own `CREATE TABLE IF NOT EXISTS` migration on startup, so pointing at a fresh database is enough.

## 7. Key architectural decisions & rationale

| Decision | Rationale |
|---|---|
| Go backend | Good concurrency for query execution/streaming, no runtime dependency hell, matches the original plan. |
| `database/sql` + driver abstraction for SQL engines, separate clients for Redis/Kafka | Postgres/MySQL/SQLite share one API/query-execution path; Redis and Kafka aren't SQL, so they get their own thin driver interfaces instead of being forced into `database/sql`. |
| Real accounts (bcrypt + Postgres) instead of a single shared master password | User-requested pivot from the original single-password-vault plan; also unlocks per-user analytics and, later, per-user saved connections. |
| Operator data in Postgres (Neon) rather than local SQLite | Chosen when auth moved to real accounts — a hosted Postgres instance was already the natural home for `users`/`sessions`, and keeping analytics there too avoids a second storage system. |
| Bearer tokens instead of cookies (for now) | Simplest thing that works across the current separate-origin dev setup (Vite on one port, Go on another); revisit as an `HttpOnly` cookie once frontend and backend share an origin in production. |
| React + CodeMirror + Tailwind/Radix + cmdk | Modern, fast editor and command-palette experience; unstyled primitives keep the UI from looking like a generic admin template. |

## 8. Open questions

- Migrating saved connections/snippets/history from client-side mock storage into the operator Postgres DB, scoped per user.
- Rate limiting `/api/auth/login` server-side (currently only client-side attempt counting).
- Moving the session token from `localStorage` to an `HttpOnly` cookie once frontend/backend share an origin.
- Whether query cancellation needs WebSockets or whether SSE is sufficient (leaning WebSocket for bidirectional cancel + status) — relevant once real query execution against target databases is built.
- How much schema-introspection metadata to cache vs. re-fetch on each schema-tree expand (perf vs. staleness tradeoff, revisit once real usage patterns are known).
