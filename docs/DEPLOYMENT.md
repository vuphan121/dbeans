# dbeans — Deploying to Vercel

Two separate Vercel projects, from the same repo: one for `frontend/`, one for `backend/`. They're different runtimes (a static Vite build vs. a Go server) and end up on different domains, so they can't be one project. **Verified live** using this exact process.

## 1. Backend (`backend/`)

1. **New Vercel project** → import this repo → **Root Directory: `backend`**.
2. Framework preset: **Go** (auto-detected from the root `go.mod`). `backend/vercel.json` pins this explicitly (`"framework": "go"`). This runs `backend/main.go` directly as a real Go server — Vercel's Go Framework Preset, not the older per-file `/api/*.go` serverless-function model — so nothing about the existing chi router needed to change.
3. Build/output settings: leave default; Vercel runs `go build` itself.
4. **Environment variables** (Project Settings → Environment Variables, or `vercel env add <NAME> production`):
   - `DATABASE_URL` — your operator Postgres connection string (Neon or similar). This is dbeans' *own* account/session/jobs database, not a database you're browsing.
   - `ALLOWED_ORIGINS` — the frontend's deployed URL (set this *after* step 2, once you know it — see below). Comma-separate if you have more than one.
   - `CRON_SECRET` — a random secret (`openssl rand -hex 32`). Gates `GET /api/jobs/tick`.
   - `SEED_USERNAME` / `SEED_PASSWORD` — creates this login on first run if it doesn't exist yet. Safe to leave set (no-ops once the user exists).
   - Do **not** set `PORT` — Vercel injects its own; the server already reads whatever it provides.
5. Deploy (`vercel deploy --prod` from `backend/`, or push to the connected Git branch). Note the resulting URL — the frontend needs it. Verify with `curl https://<backend-url>/api/health` → `{"ok":true}`.

**Known limitation:** a job's retry delay (`retryDelaySeconds`) sleeps synchronously inside the tick request, so a due job with a long delay (or several due jobs retrying in the same tick) risks whatever execution-time ceiling applies to your Vercel plan/config. Keep retry delays short for jobs run this way, or use the traditional-host path below, which has no such ceiling.

## 2. Frontend (`frontend/`)

1. **New Vercel project** → import the same repo → **Root Directory: `frontend`**.
2. Framework preset: **Vite** (auto-detected). Build command `npm run build`, output directory `dist` — defaults are already correct.
3. **Environment variable:** `VITE_API_URL` — the backend URL from step 1.5, **no trailing slash**.
4. Deploy.
5. Go back to the backend project and set `ALLOWED_ORIGINS` to this frontend's URL (it couldn't be known until now), then redeploy the backend once more so CORS actually allows it.

Once both are live, open the frontend URL, sign in with `SEED_USERNAME`/`SEED_PASSWORD`, and you're running. **Scheduled queries:** open **Settings** — it shows the exact tick URL (with the secret baked in) to paste into [cron-job.org](https://cron-job.org) (or any scheduler that can hit a URL on an interval) as a `GET` request, minimum every 15 minutes. You only ever configure **one** external cron entry, regardless of how many scheduled queries you add.

## Alternative: traditional host for the backend

The backend is also just a normal Go binary (`go build ./backend && ./dbeans-server`, reading the same env vars plus `PORT`) — it works unmodified on Railway, Fly.io, Render, or a small VPS, with no execution-time ceiling and no retry-delay caveat. If you go this route, only the frontend needs Vercel; point `VITE_API_URL` at wherever that host puts the backend instead.
