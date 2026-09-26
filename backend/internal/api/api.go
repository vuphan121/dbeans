package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"dbeans/backend/internal/analytics"
	"dbeans/backend/internal/auth"
)

type Server struct {
	Pool       *pgxpool.Pool
	CronSecret string
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return ""
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "username and password are required")
		return
	}

	session, err := auth.Login(r.Context(), s.Pool, req.Username, req.Password)
	if err != nil {
		if err == auth.ErrInvalidCredentials {
			writeError(w, http.StatusUnauthorized, "invalid username or password")
			return
		}
		writeError(w, http.StatusInternalServerError, "login failed")
		return
	}

	uid := session.UserID
	_ = analytics.LogEvent(r.Context(), s.Pool, session.Token, &uid, "login", map[string]string{"username": req.Username})

	writeJSON(w, http.StatusOK, map[string]any{
		"token":    session.Token,
		"username": req.Username,
	})
}

func (s *Server) Logout(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token != "" {
		_ = analytics.LogEvent(r.Context(), s.Pool, token, nil, "logout", nil)
		_ = auth.Logout(r.Context(), s.Pool, token)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) Me(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"username": user.Username})
}

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (s *Server) ChangePassword(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	user, err := auth.Resolve(r.Context(), s.Pool, token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req changePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.CurrentPassword == "" || req.NewPassword == "" {
		writeError(w, http.StatusBadRequest, "current and new password are required")
		return
	}
	if err := auth.ChangePassword(r.Context(), s.Pool, user.ID, token, req.CurrentPassword, req.NewPassword); err != nil {
		switch err {
		case auth.ErrInvalidCredentials:
			writeError(w, http.StatusBadRequest, "current password is incorrect")
		case auth.ErrPasswordTooShort:
			writeError(w, http.StatusBadRequest, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, "failed to change password")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type eventRequest struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

// TrackEvent accepts analytics events from the authenticated frontend
// (sign-in sessions, query runs, etc). Best-effort: a logging failure never
// fails the caller's underlying action, so this handler is generous about
// what it accepts.
func (s *Server) TrackEvent(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	user, err := auth.Resolve(r.Context(), s.Pool, token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req eventRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Type == "" {
		writeError(w, http.StatusBadRequest, "invalid event")
		return
	}
	uid := user.ID
	// Best-effort per this handler's own doc comment: a logging failure is
	// logged server-side, not surfaced to the caller (matches Login/Logout/
	// logTableMutation, which all discard this same LogEvent error too).
	if err := analytics.LogEvent(r.Context(), s.Pool, token, &uid, req.Type, req.Payload); err != nil {
		log.Printf("log event %q: %v", req.Type, err)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
