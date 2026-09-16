package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"dbeans/backend/internal/auth"
	"dbeans/backend/internal/crypto"
)

// Secret is deliberately write-only: the API never echoes a value back once
// saved, only the name — see docs/ARCHITECTURE.md §4.
type Secret struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

var secretNamePattern = regexp.MustCompile(`^[A-Za-z_]\w*$`)

// reservedTemplateNames are the built-in placeholders renderJobTemplate
// already handles — a secret can't shadow them, since renderJobTemplate
// checks these first regardless of what's in the secrets map.
func isReservedTemplateName(name string) bool {
	switch strings.ToLower(name) {
	case "date", "datetime":
		return true
	default:
		return false
	}
}

func validateSecretName(name string) error {
	if !secretNamePattern.MatchString(name) {
		return errors.New("name must start with a letter or underscore and contain only letters, digits, and underscores")
	}
	if isReservedTemplateName(name) {
		return errors.New(`"` + name + `" is a reserved template name`)
	}
	return nil
}

func (s *Server) ListSecrets(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	rows, err := s.Pool.Query(r.Context(), `SELECT id, name, created_at FROM secrets WHERE user_id = $1 ORDER BY created_at ASC`, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list secrets")
		return
	}
	defer rows.Close()

	secrets := []Secret{}
	for rows.Next() {
		var sec Secret
		if err := rows.Scan(&sec.ID, &sec.Name, &sec.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read secrets")
			return
		}
		secrets = append(secrets, sec)
	}
	writeJSON(w, http.StatusOK, secrets)
}

type createSecretRequest struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Value string `json:"value"`
}

func (s *Server) CreateSecret(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var req createSecretRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" {
		writeError(w, http.StatusBadRequest, "id and name are required")
		return
	}
	if err := validateSecretName(req.Name); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Value == "" {
		writeError(w, http.StatusBadRequest, "value is required")
		return
	}

	valueEnc, err := crypto.Encrypt([]byte(req.Value))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save secret")
		return
	}

	createdAt := time.Now()
	_, err = s.Pool.Exec(r.Context(), `
		INSERT INTO secrets (id, user_id, name, value_enc, created_at)
		VALUES ($1, $2, $3, $4, $5)`,
		req.ID, user.ID, req.Name, valueEnc, createdAt)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusBadRequest, "a secret with this name already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to save secret")
		return
	}

	writeJSON(w, http.StatusCreated, Secret{ID: req.ID, Name: req.Name, CreatedAt: createdAt})
}

type updateSecretRequest struct {
	Name  string `json:"name"`
	Value string `json:"value,omitempty"`
}

// UpdateSecret renames and/or rotates a secret's value. An empty/omitted
// value keeps the existing encrypted value in place — the write-only
// counterpart to never exposing it for editing in the first place.
func (s *Server) UpdateSecret(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id := chi.URLParam(r, "id")

	var req updateSecretRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if err := validateSecretName(req.Name); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var tag pgconn.CommandTag
	if req.Value == "" {
		tag, err = s.Pool.Exec(r.Context(), `UPDATE secrets SET name = $1 WHERE id = $2 AND user_id = $3`, req.Name, id, user.ID)
	} else {
		var valueEnc []byte
		valueEnc, err = crypto.Encrypt([]byte(req.Value))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update secret")
			return
		}
		tag, err = s.Pool.Exec(r.Context(), `UPDATE secrets SET name = $1, value_enc = $2 WHERE id = $3 AND user_id = $4`, req.Name, valueEnc, id, user.ID)
	}
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusBadRequest, "a secret with this name already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update secret")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "secret not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) DeleteSecret(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	if _, err := s.Pool.Exec(r.Context(), `DELETE FROM secrets WHERE id = $1 AND user_id = $2`, id, user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete secret")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// loadUserSecrets fetches and decrypts every secret owned by userID, keyed
// by name — the lookup table renderJobTemplate resolves {{name}} against for
// query/HTTP jobs and the "Test query" preview. Loaded once per execution
// entry point rather than per job/per template call.
func loadUserSecrets(ctx context.Context, pool *pgxpool.Pool, userID int64) (map[string]string, error) {
	rows, err := pool.Query(ctx, `SELECT name, value_enc FROM secrets WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	secrets := map[string]string{}
	for rows.Next() {
		var name string
		var valueEnc []byte
		if err := rows.Scan(&name, &valueEnc); err != nil {
			return nil, err
		}
		value, err := crypto.Decrypt(valueEnc)
		if err != nil {
			return nil, err
		}
		secrets[name] = string(value)
	}
	return secrets, rows.Err()
}
