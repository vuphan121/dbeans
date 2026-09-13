# dbeans — Deploying to Vercel

Two separate Vercel projects, from the same repo: one for `frontend/`, one for `backend/`. They're different runtimes (a static Vite build vs. a Go serverless function) and end up on different domains, so they can't be one project.

## 1. Backend (`backend/`)

1. **New Vercel project** → import this repo → **Root Directory: `backend`**.
2. Framework preset: **Other** (there's no Go framework preset — Vercel's Go builder picks up `api/index.go` automatically because of `backend/vercel.json`).
3. Build/output settings: leave default. Nothing to build client-side; Vercel compiles the Go function itself.
4. **Environment variables** (Project Settings → Environment Variables):
   - `DATABASE_URL` — your operator Postgres connection string (Neon or similar). This is dbeans' *own* account/session/jobs database, not a database you're browsing.
   - `ALLOWED_ORIGINS` — the frontend's deployed URL, e.g. `https://dbeans-frontend.vercel.app` (comma-separate if you have more than one, e.g. also a preview URL).
   - `CRON_SECRET` — a random secret (`openssl rand -hex 32`). Gates `GET /api/jobs/tick`.
   - `SEED_USERNAME` / `SEED_PASSWORD` — creates this login on first run if it doesn't exist yet. Safe to leave set (no-ops once the user exists), or remove after the first deploy.
   - Do **not** set `PORT` — that's only for the local binary; Vercel manages its own port.
5. Deploy. Note the resulting URL (e.g. `https://dbeans-backend.vercel.app`) — the frontend needs it.
6. **Scheduled queries:** once deployed, sign in and open **Settings** — it shows the exact tick URL (with the secret baked in) to paste into [cron-job.org](https://cron-job.org) (or any scheduler that can hit a URL on an interval) as a `GET` request, minimum every 15 minutes. You only ever configure **one** external cron entry, regardless of how many scheduled queries you add.

**Known limitation:** a job's retry delay (`retryDelaySeconds`) sleeps synchronously inside the tick request. `backend/vercel.json` requests a 30s max duration for the function, but your Vercel plan may cap that lower, and several due jobs retrying in the same tick can still add up past it. Keep retry delays short (a few seconds) for jobs deployed this way; there's no such ceiling if you instead run the backend as a normal process (§2 below).

## 2. Frontend (`frontend/`)

1. **New Vercel project** → import the same repo → **Root Directory: `frontend`**.
2. Framework preset: **Vite** (auto-detected). Build command `npm run build`, output directory `dist` — defaults are already correct.
3. **Environment variables:**
   - `VITE_API_URL` — the backend URL from step 1.6 above (e.g. `https://dbeans-backend.vercel.app`), **no trailing slash**.
4. Deploy.

Once both are live, open the frontend URL, sign in with `SEED_USERNAME`/`SEED_PASSWORD`, and you're running.

## Alternative: traditional host for the backend

The backend is also just a normal Go binary (`go build ./backend && ./dbeans-server`, reading the same env vars plus `PORT`) — it works unmodified on Railway, Fly.io, Render, or a small VPS, with no execution-time ceiling and no retry-delay caveat. If you go this route, only the frontend needs Vercel; point `VITE_API_URL` at wherever that host puts the backend instead.
