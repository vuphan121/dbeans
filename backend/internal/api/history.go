package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"dbeans/backend/internal/auth"
)

// historyEventTypes is every event kind the workbench's History panel reads
// back — the frontend's own "query_run" trackEvent call, plus every event
// table_data.go's mutation handlers write via logTableMutation.
var historyEventTypes = []string{"query_run", "row_insert", "row_update", "row_delete", "bulk_row_delete", "schema_change", "table_import"}

type historyEntry struct {
	ID        int64           `json:"id"`
	EventType string          `json:"eventType"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt string          `json:"createdAt"`
}

// ListConnectionHistory returns the requesting user's own recent query runs
// and Data-editor mutations against one connection, newest first — the read
// side of the analytics_events audit trail. Scoped by user_id rather than
// separately re-verifying connection ownership, since every matching event
// only exists because this same user generated it. analytics_events has no
// connection_id column, so filtering goes through the payload JSONB that
// every writer here already includes a connectionId in.
func (s *Server) ListConnectionHistory(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 500 {
			limit = parsed
		}
	}
	rows, err := s.Pool.Query(r.Context(), `
		SELECT id, event_type, payload, created_at
		FROM analytics_events
		WHERE user_id = $1 AND event_type = ANY($2) AND payload->>'connectionId' = $3
		ORDER BY created_at DESC
		LIMIT $4`, user.ID, historyEventTypes, id, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load history")
		return
	}
	defer rows.Close()
	entries := []historyEntry{}
	for rows.Next() {
		var e historyEntry
		var createdAt time.Time
		if err := rows.Scan(&e.ID, &e.EventType, &e.Payload, &createdAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read history")
			return
		}
		e.CreatedAt = createdAt.Format(time.RFC3339)
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read history")
		return
	}
	writeJSON(w, http.StatusOK, entries)
}
