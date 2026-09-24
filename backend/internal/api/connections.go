package api

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"dbeans/backend/internal/auth"
	"dbeans/backend/internal/crypto"
)

type Connection struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	Engine        string          `json:"engine"`
	DSN           string          `json:"dsn"`
	Fields        json.RawMessage `json:"fields"`
	Layout        json.RawMessage `json:"layout"`
	LastUsed      string          `json:"lastUsed"`
	Status        string          `json:"status"`
	LastCheckedAt *time.Time      `json:"lastCheckedAt,omitempty"`
}

func (s *Server) ListConnections(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	rows, err := s.Pool.Query(r.Context(), `
		SELECT id, name, engine, dsn_enc, fields_enc, layout, last_used, status, last_checked_at
		FROM connections
		WHERE user_id = $1
		ORDER BY created_at ASC`, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list connections")
		return
	}
	defer rows.Close()

	conns := []Connection{}
	for rows.Next() {
		var c Connection
		var dsnEnc, fieldsEnc []byte
		if err := rows.Scan(&c.ID, &c.Name, &c.Engine, &dsnEnc, &fieldsEnc, &c.Layout, &c.LastUsed, &c.Status, &c.LastCheckedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read connections")
			return
		}
		dsn, dsnErr := crypto.Decrypt(dsnEnc)
		fields, fieldsErr := crypto.Decrypt(fieldsEnc)
		if dsnErr != nil || fieldsErr != nil {
			// Don't let one row with an undecryptable secret (e.g. mid
			// CONNECTION_ENCRYPTION_KEY rotation) take down the whole list —
			// skip it; the rest of the user's connections still load.
			log.Printf("connection %s: failed to decrypt, skipping: dsn=%v fields=%v", c.ID, dsnErr, fieldsErr)
			continue
		}
		c.DSN = string(dsn)
		c.Fields = fields
		conns = append(conns, c)
	}
	writeJSON(w, http.StatusOK, conns)
}

func (s *Server) CreateConnection(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var c Connection
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil || c.ID == "" || c.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid connection")
		return
	}
	if c.LastUsed == "" {
		c.LastUsed = "just now"
	}

	dsnEnc, err := crypto.Encrypt([]byte(c.DSN))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save connection")
		return
	}
	fieldsEnc, err := crypto.Encrypt(c.Fields)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save connection")
		return
	}

	tag, err := s.Pool.Exec(r.Context(), `
		INSERT INTO connections (id, user_id, name, engine, dsn_enc, fields_enc, layout, last_used)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			engine = EXCLUDED.engine,
			dsn_enc = EXCLUDED.dsn_enc,
			fields_enc = EXCLUDED.fields_enc,
			layout = EXCLUDED.layout,
			last_used = EXCLUDED.last_used
		WHERE connections.user_id = $2`,
		c.ID, user.ID, c.Name, c.Engine, dsnEnc, fieldsEnc, c.Layout, c.LastUsed)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save connection")
		return
	}
	if tag.RowsAffected() == 0 {
		// id is a global primary key (not scoped per user), so the only way
		// the WHERE clause above filters out both the insert and the update
		// is that id already belongs to a different user — a client-side id
		// collision, not this user retrying their own request.
		writeError(w, http.StatusConflict, "a connection with this id already exists")
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

type updateConnectionRequest struct {
	Layout   json.RawMessage `json:"layout,omitempty"`
	LastUsed *string         `json:"lastUsed,omitempty"`
}

func (s *Server) UpdateConnection(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	id := chi.URLParam(r, "id")
	var req updateConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	if req.Layout != nil {
		if _, err := s.Pool.Exec(r.Context(),
			`UPDATE connections SET layout = $1 WHERE id = $2 AND user_id = $3`,
			req.Layout, id, user.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update connection")
			return
		}
	}
	if req.LastUsed != nil {
		if _, err := s.Pool.Exec(r.Context(),
			`UPDATE connections SET last_used = $1 WHERE id = $2 AND user_id = $3`,
			*req.LastUsed, id, user.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update connection")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) DeleteConnection(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	id := chi.URLParam(r, "id")
	if _, err := s.Pool.Exec(r.Context(),
		`DELETE FROM connections WHERE id = $1 AND user_id = $2`, id, user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete connection")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
