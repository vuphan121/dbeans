package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"dbeans/backend/internal/auth"
)

const (
	maxSavedViewNameLen    = 100
	maxSavedViewConfigSize = 32 << 10
)

// SavedView is a named Data-browser preset for one table of one connection.
// Config is the frontend's own JSON (filters, sort, page size, column layout);
// the server stores it verbatim after checking it is a JSON object.
type SavedView struct {
	ID        string          `json:"id"`
	Schema    string          `json:"schema"`
	Table     string          `json:"table"`
	Name      string          `json:"name"`
	Config    json.RawMessage `json:"config"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

func validateSavedViewName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("name is required")
	}
	if len(name) > maxSavedViewNameLen {
		return "", errors.New("name is too long")
	}
	return name, nil
}

// validateSavedViewConfig accepts only a JSON object of a sane size — the
// server doesn't interpret it, but it shouldn't store an arbitrary blob.
func validateSavedViewConfig(config json.RawMessage) error {
	if len(config) == 0 || len(config) > maxSavedViewConfigSize {
		return errors.New("config is required and must be under 32 KB")
	}
	var object map[string]json.RawMessage
	// A JSON null unmarshals into a nil map without error, so check for it too.
	if err := json.Unmarshal(config, &object); err != nil || object == nil {
		return errors.New("config must be a JSON object")
	}
	return nil
}

// ownsConnection reports whether the connection exists and belongs to the
// user. saved_views' foreign key only proves the connection exists.
func (s *Server) ownsConnection(ctx context.Context, userID int64, connID string) bool {
	var one int
	return s.Pool.QueryRow(ctx, `SELECT 1 FROM connections WHERE id = $1 AND user_id = $2`, connID, userID).Scan(&one) == nil
}

func (s *Server) ListSavedViews(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	connID := chi.URLParam(r, "id")
	if !s.ownsConnection(r.Context(), user.ID, connID) {
		writeError(w, http.StatusNotFound, "connection not found")
		return
	}
	rows, err := s.Pool.Query(r.Context(), `
		SELECT id, schema_name, table_name, name, config, updated_at FROM saved_views
		WHERE user_id = $1 AND connection_id = $2 ORDER BY schema_name, table_name, created_at ASC`, user.ID, connID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list saved views")
		return
	}
	defer rows.Close()
	views := []SavedView{}
	for rows.Next() {
		var v SavedView
		if err := rows.Scan(&v.ID, &v.Schema, &v.Table, &v.Name, &v.Config, &v.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read saved views")
			return
		}
		views = append(views, v)
	}
	writeJSON(w, http.StatusOK, views)
}

type createSavedViewRequest struct {
	ID     string          `json:"id"`
	Schema string          `json:"schema"`
	Table  string          `json:"table"`
	Name   string          `json:"name"`
	Config json.RawMessage `json:"config"`
}

func (s *Server) CreateSavedView(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	connID := chi.URLParam(r, "id")
	var req createSavedViewRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2*maxSavedViewConfigSize)).Decode(&req); err != nil || req.ID == "" || req.Schema == "" || req.Table == "" {
		writeError(w, http.StatusBadRequest, "id, schema, table, name, and config are required")
		return
	}
	name, err := validateSavedViewName(req.Name)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateSavedViewConfig(req.Config); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !s.ownsConnection(r.Context(), user.ID, connID) {
		writeError(w, http.StatusNotFound, "connection not found")
		return
	}
	var v SavedView
	err = s.Pool.QueryRow(r.Context(), `
		INSERT INTO saved_views (id, user_id, connection_id, schema_name, table_name, name, config)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, schema_name, table_name, name, config, updated_at`,
		req.ID, user.ID, connID, req.Schema, req.Table, name, []byte(req.Config)).Scan(&v.ID, &v.Schema, &v.Table, &v.Name, &v.Config, &v.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "a view with this name already exists for this table")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to save view")
		return
	}
	writeJSON(w, http.StatusCreated, v)
}

type updateSavedViewRequest struct {
	Name   *string         `json:"name"`
	Config json.RawMessage `json:"config"`
}

// UpdateSavedView renames a view and/or overwrites its config with the
// browser's current state ("Update view").
func (s *Server) UpdateSavedView(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req updateSavedViewRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2*maxSavedViewConfigSize)).Decode(&req); err != nil || (req.Name == nil && len(req.Config) == 0) {
		writeError(w, http.StatusBadRequest, "name or config is required")
		return
	}
	var name *string
	if req.Name != nil {
		trimmed, err := validateSavedViewName(*req.Name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		name = &trimmed
	}
	var config []byte
	if len(req.Config) > 0 {
		if err := validateSavedViewConfig(req.Config); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		config = req.Config
	}
	tag, err := s.Pool.Exec(r.Context(), `
		UPDATE saved_views
		SET name = COALESCE($4, name), config = COALESCE($5::jsonb, config), updated_at = now()
		WHERE id = $1 AND user_id = $2 AND connection_id = $3`,
		chi.URLParam(r, "viewId"), user.ID, chi.URLParam(r, "id"), name, config)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "a view with this name already exists for this table")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update view")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "view not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) DeleteSavedView(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if _, err := s.Pool.Exec(r.Context(), `
		DELETE FROM saved_views WHERE id = $1 AND user_id = $2 AND connection_id = $3`,
		chi.URLParam(r, "viewId"), user.ID, chi.URLParam(r, "id")); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete view")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
