package analytics

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

// LogEvent is best-effort: callers should not fail a request just because
// analytics logging failed.
func LogEvent(ctx context.Context, pool *pgxpool.Pool, sessionToken string, userID *int64, eventType string, payload any) error {
	var payloadJSON []byte
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		payloadJSON = b
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO analytics_events (session_token, user_id, event_type, payload)
		VALUES ($1, $2, $3, $4)`, sessionToken, userID, eventType, payloadJSON)
	return err
}
