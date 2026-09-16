package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"dbeans/backend/internal/crypto"
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

-- fields_enc/dsn_enc hold the AES-256-GCM-encrypted form of the old
-- plaintext fields/dsn columns (see internal/crypto). The plaintext columns
-- are left in place (now nullable) rather than dropped — server.go backfills
-- fields_enc/dsn_enc from them on every boot until every row is migrated;
-- dropping them is a manual follow-up once that's confirmed solid, never
-- automated, since they're the only copy of real credentials until then.
ALTER TABLE connections ADD COLUMN IF NOT EXISTS fields_enc BYTEA;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS dsn_enc BYTEA;
ALTER TABLE connections ALTER COLUMN fields DROP NOT NULL;
ALTER TABLE connections ALTER COLUMN dsn DROP NOT NULL;

-- A job is a typed scheduled action. Existing rows are query jobs; newer
-- types such as HTTP requests keep their own settings in config and do not need a
-- database connection. See docs/PRD.md "Scheduled jobs".
CREATE TABLE IF NOT EXISTS jobs (
	id TEXT PRIMARY KEY,
	user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	connection_id TEXT REFERENCES connections(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	job_type TEXT NOT NULL DEFAULT 'query',
	sql TEXT,
	config JSONB NOT NULL DEFAULT '{}',
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

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'query';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';
ALTER TABLE jobs ALTER COLUMN connection_id DROP NOT NULL;
ALTER TABLE jobs ALTER COLUMN sql DROP NOT NULL;

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

-- job_queue is the durable trigger for dependency-driven jobs: a job with
-- non-empty depends_on is no longer matched by its own cron (see
-- idx_jobs_next_run_at's WHERE clause below) — instead, whenever a job
-- succeeds, every job that depends on it gets a row here for the same
-- run_date, and JobsTick drains this table (running an entry as soon as
-- every one of that job's dependencies has a recorded success for that
-- exact run_date) every time it's invoked. That makes "wait for the
-- dependency to actually finish" durable and correct regardless of how the
-- dependency itself is scheduled — hourly, daily, whatever — instead of
-- relying on cron times happening to land far enough apart, which the
-- tick's unordered due-jobs query can't guarantee.
CREATE TABLE IF NOT EXISTS job_queue (
	id BIGSERIAL PRIMARY KEY,
	job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
	run_date DATE NOT NULL,
	enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	UNIQUE (job_id, run_date)
);

-- secrets is a per-user vault of named values (env-var-style: CHESSLAB_URL,
-- API_TOKEN, ...) referenced from query/HTTP job config as {{name}}, resolved
-- alongside {{date}} by renderJobTemplate at run time (see jobs.go). Values
-- are AES-256-GCM-encrypted with the same key as connections' credentials
-- (CONNECTION_ENCRYPTION_KEY, see internal/crypto) — this table just reuses
-- it rather than needing a key of its own. Deliberately write-only from the
-- API's point of view: value_enc is never decoded back into an API response,
-- only decrypted server-side when resolving a template.
CREATE TABLE IF NOT EXISTS secrets (
	id TEXT PRIMARY KEY,
	user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	value_enc BYTEA NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_next_run_at ON jobs(next_run_at) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON job_runs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_run_date ON job_runs(job_id, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_job_queue_job_id ON job_queue(job_id);
CREATE INDEX IF NOT EXISTS idx_secrets_user_id ON secrets(user_id);
`

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, schema)
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	return nil
}

// EncryptLegacyConnections encrypts fields/dsn into fields_enc/dsn_enc for
// any row that predates connection-credential encryption. Idempotent (only
// touches rows where fields_enc is still NULL) and safe to call on every
// boot — see the schema comment above fields_enc for why the plaintext
// columns aren't dropped once this has run.
func EncryptLegacyConnections(ctx context.Context, pool *pgxpool.Pool) error {
	rows, err := pool.Query(ctx, `SELECT id, fields, dsn FROM connections WHERE fields_enc IS NULL`)
	if err != nil {
		return fmt.Errorf("encrypt legacy connections: %w", err)
	}
	type legacyRow struct {
		id     string
		fields []byte
		dsn    string
	}
	var legacy []legacyRow
	for rows.Next() {
		var lr legacyRow
		if err := rows.Scan(&lr.id, &lr.fields, &lr.dsn); err != nil {
			rows.Close()
			return fmt.Errorf("encrypt legacy connections: %w", err)
		}
		legacy = append(legacy, lr)
	}
	rows.Close()

	for _, lr := range legacy {
		fieldsEnc, err := crypto.Encrypt(lr.fields)
		if err != nil {
			return fmt.Errorf("encrypt legacy connection %s fields: %w", lr.id, err)
		}
		dsnEnc, err := crypto.Encrypt([]byte(lr.dsn))
		if err != nil {
			return fmt.Errorf("encrypt legacy connection %s dsn: %w", lr.id, err)
		}
		if _, err := pool.Exec(ctx, `UPDATE connections SET fields_enc = $1, dsn_enc = $2 WHERE id = $3`,
			fieldsEnc, dsnEnc, lr.id); err != nil {
			return fmt.Errorf("encrypt legacy connection %s: %w", lr.id, err)
		}
	}
	return nil
}
