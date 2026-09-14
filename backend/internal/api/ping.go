package api

import (
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"dbeans/backend/internal/auth"
	"dbeans/backend/internal/crypto"
)

// Repeated visits within this window get the cached result instead of
// triggering a new network check.
const pingCacheTTL = 60 * time.Second

const dialTimeout = 4 * time.Second

type pingTarget struct {
	host string
	port int
}

// extractPingTarget pulls a host:port out of a connection's engine-specific
// fields JSON. Returns ok=false for engines/shapes we can't meaningfully
// reach over TCP (e.g. SQLite, which is a local file path, not a host).
func extractPingTarget(engine string, fieldsJSON []byte) (pingTarget, bool) {
	if engine == "sqlite" {
		return pingTarget{}, false
	}

	var raw map[string]any
	if err := json.Unmarshal(fieldsJSON, &raw); err != nil {
		return pingTarget{}, false
	}

	if engine == "kafka" {
		brokers, _ := raw["brokers"].(string)
		first := strings.TrimSpace(strings.Split(brokers, ",")[0])
		host, portStr, err := net.SplitHostPort(first)
		if err != nil {
			return pingTarget{}, false
		}
		port, err := strconv.Atoi(portStr)
		if err != nil {
			return pingTarget{}, false
		}
		return pingTarget{host: host, port: port}, true
	}

	host, _ := raw["host"].(string)
	portF, _ := raw["port"].(float64)
	if host == "" || portF == 0 {
		return pingTarget{}, false
	}
	return pingTarget{host: host, port: int(portF)}, true
}

func isReachable(target pingTarget) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(target.host, strconv.Itoa(target.port)), dialTimeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// PingConnection checks whether a saved connection's host is reachable.
// This is a TCP reachability check only — it confirms something is
// listening on the host:port, not that the credentials are valid or that
// dbeans can actually query it. That's honest given there's no real query
// engine wired up yet (see docs/ARCHITECTURE.md).
func (s *Server) PingConnection(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	id := chi.URLParam(r, "id")

	var engine, status string
	var fieldsEnc []byte
	var lastCheckedAt *time.Time
	err = s.Pool.QueryRow(r.Context(), `
		SELECT engine, fields_enc, status, last_checked_at
		FROM connections
		WHERE id = $1 AND user_id = $2`,
		id, user.ID).Scan(&engine, &fieldsEnc, &status, &lastCheckedAt)
	if err != nil {
		writeError(w, http.StatusNotFound, "connection not found")
		return
	}
	fieldsJSON, err := crypto.Decrypt(fieldsEnc)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to decrypt connection")
		return
	}

	if lastCheckedAt != nil && time.Since(*lastCheckedAt) < pingCacheTTL {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":        status,
			"lastCheckedAt": lastCheckedAt,
			"cached":        true,
		})
		return
	}

	newStatus := "unknown"
	if target, ok := extractPingTarget(engine, fieldsJSON); ok {
		if isReachable(target) {
			newStatus = "online"
		} else {
			newStatus = "offline"
		}
	}

	now := time.Now()
	if _, err := s.Pool.Exec(r.Context(),
		`UPDATE connections SET status = $1, last_checked_at = $2 WHERE id = $3 AND user_id = $4`,
		newStatus, now, id, user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record status")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":        newStatus,
		"lastCheckedAt": now,
		"cached":        false,
	})
}
