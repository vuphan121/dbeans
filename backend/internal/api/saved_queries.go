package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"dbeans/backend/internal/auth"
)

const (
	maxSavedQueryNameLen = 200
	maxSavedQuerySQLLen  = 200_000
	maxSavedQueryImports = 500
	// maxSavedQueryBodyBytes covers one import's worth of maximal queries.
	maxSavedQueryBodyBytes = 8 << 20
)

// SavedQuery is a named query saved from the workbench's tab strip. They are
// per user and deliberately not tied to one connection, matching how they
// behaved while they lived in the browser's localStorage.
type SavedQuery struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	SQL       string    `json:"sql"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func validateSavedQueryName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("name is required")
	}
	if len(name) > maxSavedQueryNameLen {
		return "", errors.New("name is too long")
	}
	return name, nil
}

func validateSavedQuerySQL(sql string) error {
	if strings.TrimSpace(sql) == "" {
		return errors.New("sql is required")
	}
	if len(sql) > maxSavedQuerySQLLen {
		return errors.New("query is too long to save")
	}
	return nil
}

func (s *Server) ListSavedQueries(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	queries, err := s.loadSavedQueries(r, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list saved queries")
		return
	}
	writeJSON(w, http.StatusOK, queries)
}

func (s *Server) loadSavedQueries(r *http.Request, userID int64) ([]SavedQuery, error) {
	rows, err := s.Pool.Query(r.Context(), `
		SELECT id, name, sql, updated_at FROM saved_queries
		WHERE user_id = $1 ORDER BY created_at ASC, id ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	queries := []SavedQuery{}
	for rows.Next() {
		var q SavedQuery
		if err := rows.Scan(&q.ID, &q.Name, &q.SQL, &q.UpdatedAt); err != nil {
			return nil, err
		}
		queries = append(queries, q)
	}
	return queries, rows.Err()
}

type createSavedQueryRequest struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	SQL  string `json:"sql"`
}

func (s *Server) CreateSavedQuery(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req createSavedQueryRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSavedQueryBodyBytes)).Decode(&req); err != nil || req.ID == "" {
		writeError(w, http.StatusBadRequest, "id, name, and sql are required")
		return
	}
	name, err := validateSavedQueryName(req.Name)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateSavedQuerySQL(req.SQL); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var q SavedQuery
	err = s.Pool.QueryRow(r.Context(), `
		INSERT INTO saved_queries (id, user_id, name, sql) VALUES ($1, $2, $3, $4)
		RETURNING id, name, sql, updated_at`, req.ID, user.ID, name, req.SQL).Scan(&q.ID, &q.Name, &q.SQL, &q.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "a saved query with this id already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to save query")
		return
	}
	writeJSON(w, http.StatusCreated, q)
}

type updateSavedQueryRequest struct {
	Name *string `json:"name"`
	SQL  *string `json:"sql"`
}

// UpdateSavedQuery renames and/or rewrites a saved query — whichever of name
// and sql the request carries. Editing a tab never reaches this on its own;
// the client only sends it for an explicit Save or Rename.
func (s *Server) UpdateSavedQuery(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req updateSavedQueryRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSavedQueryBodyBytes)).Decode(&req); err != nil || (req.Name == nil && req.SQL == nil) {
		writeError(w, http.StatusBadRequest, "name or sql is required")
		return
	}
	var name *string
	if req.Name != nil {
		trimmed, err := validateSavedQueryName(*req.Name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		name = &trimmed
	}
	if req.SQL != nil {
		if err := validateSavedQuerySQL(*req.SQL); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	tag, err := s.Pool.Exec(r.Context(), `
		UPDATE saved_queries
		SET name = COALESCE($3, name), sql = COALESCE($4, sql), updated_at = now()
		WHERE id = $1 AND user_id = $2`, chi.URLParam(r, "id"), user.ID, name, req.SQL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update saved query")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "saved query not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) DeleteSavedQuery(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if _, err := s.Pool.Exec(r.Context(), `DELETE FROM saved_queries WHERE id = $1 AND user_id = $2`, chi.URLParam(r, "id"), user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete saved query")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type importSavedQueriesRequest struct {
	Queries []createSavedQueryRequest `json:"queries"`
}

// ImportSavedQueries is the one-time move of queries that were saved in this
// browser's localStorage before saved queries lived on the server. Idempotent
// by design (an id that already exists is skipped, not overwritten), so a
// client that crashed or lost its connection halfway can simply send the same
// list again. Returns the user's full list afterward.
func (s *Server) ImportSavedQueries(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req importSavedQueriesRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSavedQueryBodyBytes)).Decode(&req); err != nil || len(req.Queries) > maxSavedQueryImports {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to import saved queries")
		return
	}
	defer tx.Rollback(r.Context())
	for _, q := range req.Queries {
		name, nameErr := validateSavedQueryName(q.Name)
		// A malformed legacy entry is skipped rather than failing the whole
		// import — losing one bad row beats never migrating the good ones.
		if q.ID == "" || nameErr != nil || validateSavedQuerySQL(q.SQL) != nil {
			continue
		}
		// clock_timestamp() (unlike now()) advances within the transaction, so
		// the imported queries keep their original relative order.
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO saved_queries (id, user_id, name, sql, created_at, updated_at)
			VALUES ($1, $2, $3, $4, clock_timestamp(), clock_timestamp())
			ON CONFLICT (user_id, id) DO NOTHING`, q.ID, user.ID, name, q.SQL); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to import saved queries")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to import saved queries")
		return
	}
	queries, err := s.loadSavedQueries(r, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list saved queries")
		return
	}
	writeJSON(w, http.StatusOK, queries)
}
