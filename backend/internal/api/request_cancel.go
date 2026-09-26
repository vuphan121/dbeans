package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"dbeans/backend/internal/auth"
)

// Explicit cancellation of in-flight requests that run user-visible SQL: Data-view
// page loads and counts, and the SQL editor's Run.
//
// Aborting the browser's fetch is not enough on serverless hosts: Vercel does
// not pass a client disconnect through to the Go handler, so the Postgres query
// it started keeps running to completion (measured on production: a cancelled
// 5-second query stayed active for its full duration). So each page load and
// count carries a client-chosen request id, the statements it runs are tagged
// with it, and cancelling calls CancelRequest, which terminates the
// matching session from a separate request.
//
// Tagging is a leading SQL comment rather than a session setting such as
// application_name on purpose: production databases sit behind a
// transaction-mode connection pooler, which does not reliably carry session
// state to the server connection actually running the statement — but the text
// of a running statement is always visible in pg_stat_activity.

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9-]{8,64}$`)

// validRequestID accepts only a short opaque token. Restricting the alphabet is
// what makes it safe to splice into a SQL comment: it cannot contain "*/".
func validRequestID(id string) bool { return requestIDPattern.MatchString(id) }

func requestTag(id string) string { return "/* dbeans-req:" + id + " */" }

// tagSQL prefixes a statement with its request's tag so it can be found (and
// cancelled) while it runs. A missing or malformed id leaves the statement
// untouched — such a request simply isn't cancellable.
func tagSQL(id, sql string) string {
	if !validRequestID(id) {
		return sql
	}
	return requestTag(id) + " " + sql
}

// terminateRequest terminates the session, if any, that is currently running a
// statement tagged with id, and reports how many it terminated. It only ever
// matches *active* sessions in the same database whose statement *starts with*
// the exact tag — never an idle pooled connection and never this query itself.
// Only the client backend is terminated: a parallel query's workers report the
// same statement text, but they exit on their own when their leader goes.
// Termination (rather than a query cancel) is deliberate: a handler is usually
// about to run its next statement, and a dead connection stops it, where a
// cancelled statement would just let the next one start.
func terminateRequest(ctx context.Context, conn *pgx.Conn, id string) (int, error) {
	tag := requestTag(id)
	rows, err := conn.Query(ctx, `
		SELECT pg_terminate_backend(pid)
		FROM pg_stat_activity
		WHERE pid <> pg_backend_pid()
		  AND datname = current_database()
		  AND state = 'active'
		  AND backend_type = 'client backend'
		  AND left(query, length($1::text)) = $1::text`, tag)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	terminated := 0
	for rows.Next() {
		var ok bool
		if err := rows.Scan(&ok); err != nil {
			return terminated, err
		}
		if ok {
			terminated++
		}
	}
	return terminated, rows.Err()
}

// requestOwnerTTL bounds how long a recorded owner row needs to live: only
// as long as the tagged statement it identifies could plausibly still be
// running and cancellable. Rows past this age are pruned opportunistically
// rather than needing a cron job of their own.
const requestOwnerTTL = 10 * time.Minute

// recordRequestOwner ties a cancellable requestId to the user and connection
// that tagged it, so CancelRequest can later refuse to terminate a session
// it didn't actually tag (see terminateRequest's comment on why matching by
// database name and tag alone isn't sufficient once two users' connections
// can point at the same physical database). Best-effort: a failure here
// only means that request won't be cancellable, never that the query it
// tags shouldn't run — callers ignore the return value's absence of error
// reporting by design, matching this endpoint's existing best-effort ethos.
func (s *Server) recordRequestOwner(ctx context.Context, userID int64, connectionID, requestID string) {
	if !validRequestID(requestID) {
		return
	}
	if _, err := s.Pool.Exec(ctx, `
		INSERT INTO request_owners (request_id, user_id, connection_id) VALUES ($1, $2, $3)
		ON CONFLICT (request_id) DO NOTHING`,
		requestID, userID, connectionID); err != nil {
		log.Printf("record request owner %s: %v", requestID, err)
		return
	}
	// Opportunistic cleanup, piggybacked on the same write instead of a
	// separate scheduled job — cheap given how few rows are ever live at once.
	if _, err := s.Pool.Exec(ctx, `DELETE FROM request_owners WHERE created_at < now() - $1::interval`,
		requestOwnerTTL.String()); err != nil {
		log.Printf("prune request owners: %v", err)
	}
}

type cancelRequest struct {
	RequestID string `json:"requestId"`
}

// CancelRequest is the "stop that request" call. It runs against the same
// connection (same credentials) as the request it cancels, and additionally
// requires that this exact requestId was tagged by this same user against
// this same connection (see recordRequestOwner) — otherwise it refuses,
// rather than relying solely on terminateRequest's database-name-and-tag
// match, which alone isn't safe when two users' connections can point at the
// same physical database. Best-effort by nature: a cancel that arrives before
// the tagged statement has started terminates nothing (the client retries
// shortly after). Terminating a session rolls back its open transaction, so a
// cancelled write leaves nothing half-applied — but a statement that had
// already committed is not undone.
func (s *Server) CancelRequest(w http.ResponseWriter, r *http.Request) {
	var req cancelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || !validRequestID(req.RequestID) {
		writeError(w, http.StatusBadRequest, "a valid requestId is required")
		return
	}
	s.withTableConnection(w, r, false, func(ctx context.Context, conn *pgx.Conn, _ sqlConnFields) {
		user, connID, ok := s.resolveRequestOwner(ctx, r)
		if !ok {
			writeError(w, http.StatusForbidden, "this request cannot be cancelled from here")
			return
		}
		var owned bool
		if err := s.Pool.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM request_owners WHERE request_id = $1 AND user_id = $2 AND connection_id = $3)`,
			req.RequestID, user, connID).Scan(&owned); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to verify request ownership")
			return
		}
		if !owned {
			writeError(w, http.StatusForbidden, "this request cannot be cancelled from here")
			return
		}
		n, err := terminateRequest(ctx, conn, req.RequestID)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		_, _ = s.Pool.Exec(ctx, `DELETE FROM request_owners WHERE request_id = $1`, req.RequestID)
		writeJSON(w, http.StatusOK, map[string]int{"terminated": n})
	})
}

// resolveRequestOwner re-derives the caller's user id and the connection id
// from the URL, the same way withTableConnection already validated them for
// this same request — cheap (an in-memory-cached session lookup, not a new
// round trip class) and avoids threading auth.User through withTableConnection
// just for this one check.
func (s *Server) resolveRequestOwner(ctx context.Context, r *http.Request) (userID int64, connectionID string, ok bool) {
	user, err := auth.Resolve(ctx, s.Pool, bearerToken(r))
	if err != nil {
		return 0, "", false
	}
	return user.ID, chi.URLParam(r, "id"), true
}
