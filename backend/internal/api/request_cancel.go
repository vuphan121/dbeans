package api

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"

	"github.com/jackc/pgx/v5"
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

type cancelRequest struct {
	RequestID string `json:"requestId"`
}

// CancelRequest is the "stop that request" call. It runs against the same
// connection (same credentials) as the request it cancels, so it can only ever
// terminate sessions the caller could already have terminated themselves.
// Best-effort by nature: a cancel that arrives before the tagged statement has
// started terminates nothing (the client retries shortly after). Terminating a
// session rolls back its open transaction, so a cancelled write leaves nothing
// half-applied — but a statement that had already committed is not undone.
func (s *Server) CancelRequest(w http.ResponseWriter, r *http.Request) {
	var req cancelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || !validRequestID(req.RequestID) {
		writeError(w, http.StatusBadRequest, "a valid requestId is required")
		return
	}
	s.withTableConnection(w, r, false, func(ctx context.Context, conn *pgx.Conn, _ sqlConnFields) {
		n, err := terminateRequest(ctx, conn, req.RequestID)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"terminated": n})
	})
}
