package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return pool, nil
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
	id BIGSERIAL PRIMARY KEY,
	username TEXT UNIQUE NOT NULL,
	password_hash TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
	token TEXT PRIMARY KEY,
	user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
	id BIGSERIAL PRIMARY KEY,
	session_token TEXT REFERENCES sessions(token) ON DELETE SET NULL,
	user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
	event_type TEXT NOT NULL,
	payload JSONB,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connections (
	id TEXT PRIMARY KEY,
	user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	engine TEXT NOT NULL,
	dsn TEXT NOT NULL,
	fields JSONB NOT NULL,
	layout JSONB NOT NULL,
	last_used TEXT NOT NULL DEFAULT 'just now',
	status TEXT NOT NULL DEFAULT 'unknown',
	last_checked_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ADD COLUMN IF NOT EXISTS so this stays idempotent for databases that
-- already had the connections table before status tracking existed.
ALTER TABLE connections ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE connections ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

-- A job = a saved SQL query + a target connection + a cron schedule, with
-- optional dependencies on other jobs, retry policy, and a post-run check
-- against the query's own result. See docs/PRD.md "Scheduled jobs".
CREATE TABLE IF NOT EXISTS jobs (
	id TEXT PRIMARY KEY,
	user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	sql TEXT NOT NULL,
	cron_expr TEXT NOT NULL,
	enabled BOOLEAN NOT NULL DEFAULT true,
	depends_on JSONB NOT NULL DEFAULT '[]',
	retry_limit INT NOT NULL DEFAULT 0,
	retry_delay_seconds INT NOT NULL DEFAULT 30,
	check_mode TEXT NOT NULL DEFAULT 'none',
	layout JSONB NOT NULL,
	next_run_at TIMESTAMPTZ,
	last_run_at TIMESTAMPTZ,
	last_status TEXT NOT NULL DEFAULT 'never_run',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_runs (
	id BIGSERIAL PRIMARY KEY,
	job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
	status TEXT NOT NULL,
	attempts INT NOT NULL DEFAULT 1,
	rows_affected INT,
	error TEXT,
	triggered_by TEXT NOT NULL DEFAULT 'tick',
	started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	finished_at TIMESTAMPTZ,
	duration_ms BIGINT
);

-- run_date is the *logical* date a run represents — what {{date}} resolved
-- to for that run — separate from started_at's real wall-clock time. For a
-- normal scheduled/manual run these are the same day; a backfill run sets
-- run_date to whatever past (or future) date the user picked while actually
-- executing "now". Backfilled for pre-existing rows from started_at.
ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS run_date DATE;
UPDATE job_runs SET run_date = started_at::date WHERE run_date IS NULL;
ALTER TABLE job_runs ALTER COLUMN run_date SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_next_run_at ON jobs(next_run_at) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON job_runs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_run_date ON job_runs(job_id, run_date DESC);
`

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, schema)
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	return nil
}
