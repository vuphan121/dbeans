# dbeans — Deploying to Vercel

Two separate Vercel projects, from the same repo: one for `frontend/`, one for `backend/`. They're different runtimes (a static Vite build vs. a Go server) and end up on different domains, so they can't be one project. **Verified live** using this exact process.

**Live:** https://dbeans.vercel.app (frontend) → https://dbeans-api.vercel.app (backend).

## 1. Backend (`backend/`)

1. **New Vercel project** → import this repo → **Root Directory: `backend`**. Do this in the dashboard (Project Settings → General → Root Directory) even if you're about to deploy via CLI — see the gotcha below for why this matters regardless of how you deploy.
2. Framework preset: **Go** (auto-detected from the root `go.mod`). `backend/vercel.json` pins this explicitly (`"framework": "go"`). This runs `backend/main.go` directly as a real Go server — Vercel's Go Framework Preset, not the older per-file `/api/*.go` serverless-function model — so nothing about the existing chi router needed to change.
3. **Region:** set `"regions": [...]` in `backend/vercel.json` to whatever Vercel region is closest to your operator database. This matters more than it sounds like it should — see the latency gotcha below.
4. Build/output settings: leave default; Vercel runs `go build` itself.
5. **Environment variables** (Project Settings → Environment Variables, or `vercel env add <NAME> production`):
   - `DATABASE_URL` — your operator Postgres connection string (Neon or similar). This is dbeans' *own* account/session/jobs database, not a database you're browsing.
   - `ALLOWED_ORIGINS` — the frontend's deployed URL (set this *after* step 2, once you know it — see below). Comma-separate if you have more than one.
   - `CRON_SECRET` — a random secret (`openssl rand -hex 32`). Gates `GET /api/jobs/tick`.
   - `SEED_USERNAME` / `SEED_PASSWORD` — creates this login on first run if it doesn't exist yet. Safe to leave set (no-ops once the user exists).
   - `CONNECTION_ENCRYPTION_KEY` — required. A random 32-byte key (`openssl rand -hex 32`) that encrypts every saved connection's credentials at rest, independent of any user's login password. The server refuses to start without it. **Never rotate or lose this value once connections exist** — there's no re-encryption/rotation tooling yet, so losing it makes every saved connection's credentials unrecoverable (you'd have to delete and re-add them).
   - Do **not** set `PORT` — Vercel injects its own; the server already reads whatever it provides.
6. Deploy by pushing to the connected Git branch (see the Root Directory gotcha below for why this is the recommended path over `vercel deploy` from inside `backend/`). Note the resulting URL — the frontend needs it. Verify with `curl https://<backend-url>/api/health` → `{"ok":true}`.

**Known limitation:** a job's retry delay (`retryDelaySeconds`) sleeps synchronously inside the tick request, so a due job with a long delay (or several due jobs retrying in the same tick) risks whatever execution-time ceiling applies to your Vercel plan/config. Keep retry delays short for jobs run this way, or use the traditional-host path below, which has no such ceiling.

## 2. Frontend (`frontend/`)

1. **New Vercel project** → import the same repo → **Root Directory: `frontend`**.
2. Framework preset: **Vite** (auto-detected). Build command `npm run build`, output directory `dist` — defaults are already correct.
3. **`frontend/vercel.json` must exist with a SPA rewrite** — without it, a reload or direct link to any client-side route (e.g. `/connections`, `/jobs`) 404s, since Vercel serves static output literally and there's no file at that path:
   ```json
   { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
   ```
4. **Environment variable:** `VITE_API_URL` — the backend URL from step 1.6, **no trailing slash**.
5. Deploy (push to the connected Git branch — see the Root Directory gotcha below).
6. Go back to the backend project and set `ALLOWED_ORIGINS` to this frontend's URL (it couldn't be known until now), then redeploy the backend once more so CORS actually allows it.

Once both are live, open the frontend URL, sign in with `SEED_USERNAME`/`SEED_PASSWORD`, and you're running. **Scheduled jobs:** open **Settings** — it shows the exact tick URL (with the secret baked in) to paste into [cron-job.org](https://cron-job.org) (or any scheduler that can hit a URL on an interval) as a `GET` request. cron-job.org's own free-tier minimum interval is a practical floor; this project runs it every 5 minutes in practice with no issues. You only ever configure **one** external cron entry, regardless of how many query or HTTP request jobs you add.

## Alternative: traditional host for the backend

The backend is also just a normal Go binary (`go build ./backend && ./dbeans-server`, reading the same env vars plus `PORT`) — it works unmodified on Railway, Fly.io, Render, or a small VPS, with no execution-time ceiling and no retry-delay caveat. If you go this route, only the frontend needs Vercel; point `VITE_API_URL` at wherever that host puts the backend instead.

## Getting a clean `something.vercel.app` URL instead of the random one

By default each project's URL is `<project-name>-<random-hash>-<team>.vercel.app` — the plain `<project-name>.vercel.app` form is only assigned if that exact name isn't already taken by *any* Vercel user globally (these subdomains are shared across the whole platform, not scoped to your account). Two gotchas discovered getting this project onto `dbeans.vercel.app` / `dbeans-api.vercel.app`:

1. **`vercel alias set <deployment> <alias>` is a static, one-time pointer** — it does *not* automatically follow later deploys the way the project's default auto-generated alias does. Every time you redeploy, the custom alias keeps pointing at the *old* deployment until you explicitly re-run `vercel alias set` against the new one. Forgetting this looks exactly like a stale-env-var bug (the custom URL appears to ignore config changes that the default URL picks up fine). This applies to **both** projects independently — re-alias whichever one you just redeployed.

   **This isn't just cosmetic — it silently reverts already-shipped fixes (2026-09-17 incident):** several pushes landed and built successfully, but `dbeans.vercel.app`/`dbeans-api.vercel.app` kept serving a build from days earlier because nothing had re-run `vercel alias set` since. The frontend looked stale (missing UI for shipped features), but the real damage was on the backend: a scheduled job's tick fired against the *old* code mid-gap and failed on a timeout that a just-shipped fix (a longer configurable HTTP timeout) was supposed to have already solved — the fix was real and correct, it just wasn't live yet. **Don't trust `Last-Modified`/cache headers to tell you whether an alias is current** — Vercel's edge can make a stale response look plausible either way. The reliable check: hit a route that only exists in the new code and read its status. A `404` means the alias is still on the old deployment; getting anything else (e.g. `401` for an auth-gated route) confirms the new code is actually live. **Treat re-aliasing as part of the push itself, not a follow-up step** — verify with the route-status check immediately after every push, for both projects, before assuming a fix is live.
2. **New projects default to Vercel's SSO deployment protection** (`all_except_custom_domains`), which exempts the project's own auto-generated domain but *not* a plain `vercel alias set` alias — so a manually-aliased `.vercel.app` subdomain gets redirected to a Vercel login wall until you run `vercel project protection disable <project> --sso`. Fine for this app since real auth happens at the application layer (bearer tokens / `CRON_SECRET`), not via Vercel's own gate.

If you rename/re-alias either project, redo both steps and also update the *other* project's env var that points at it (`ALLOWED_ORIGINS` on the backend ↔ `VITE_API_URL` on the frontend), then redeploy both.

## Root Directory setting breaks `vercel deploy` run from inside that same subdirectory

Once a project's Root Directory is set (step 1 for both projects above — required for Git-triggered deploys to find the right code, since a push clones the *whole* repo and Vercel needs to know which subfolder to build), `vercel deploy` invoked **from within that subdirectory** starts failing with `The specified Root Directory "backend" does not exist` (or `"frontend"`) — it tries to apply the Root Directory setting on top of an upload that's already scoped to just that folder, looking for a nonexistent nested `backend/backend`. `--cwd` doesn't fix this; it has the same effect as `cd`-ing there first.

**Practical fix: deploy via `git push` to the connected branch, not `vercel deploy` from the subfolder.** A Git-triggered build clones the full repo and applies Root Directory correctly. After a push lands, re-run `vercel alias set` (see above) against the new deployment. This project's whole deploy workflow is now push → wait for the auto-deploy to go Ready → re-alias, for both projects — `vercel deploy` from inside `backend/` or `frontend/` is no longer part of the loop once Root Directory is set.

If you skip setting Root Directory to sidestep this, Git-triggered deploys fail instead (`vite: command not found` / `No Go entrypoint found`, depending on the project) since they clone the repo root and can't find either app's `package.json`/`go.mod` there. There isn't a configuration that makes both deploy paths work — pick the Git-push workflow.

## Backend region vs. operator database region

Every query the backend runs opens a brand-new database connection (no pooling), so the network round-trip between the backend's Vercel region and wherever the operator/target Postgres actually lives dominates every request's latency — full TCP+TLS+Postgres-auth handshake, every time. Left on Vercel's default region with a database on the other side of the world, this showed up as every job/query taking ~2000ms even for a trivial query against a handful of rows. Pinning `"regions": [...]` in `backend/vercel.json` to whatever Vercel region is closest to your database (e.g. `sin1` for a Neon `ap-southeast-1` database) cut that to ~30ms in this project — check where your operator/most-queried-target database actually lives and match the region, don't leave it on Vercel's default.
