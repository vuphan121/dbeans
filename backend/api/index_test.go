package handler

import (
	"net/http/httptest"
	"os"
	"testing"

	"github.com/joho/godotenv"
)

// Exercises the actual Vercel entrypoint (Handler, including the
// lazy-init/caching wrapper) against a real request, using the same local
// .env the dev binary uses. Confirms the serverless wiring itself works,
// not just the shared server.New() codepath main.go also happens to use.
func TestHandlerHealth(t *testing.T) {
	_ = godotenv.Load("../.env")
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL not set — skipping (no local .env in this environment)")
	}

	req := httptest.NewRequest("GET", "/api/health", nil)
	rec := httptest.NewRecorder()

	Handler(rec, req)

	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != `{"ok":true}`+"\n" {
		t.Fatalf("unexpected body: %q", got)
	}

	// A second invocation must reuse the cached router (warm-container
	// behavior) rather than reconnecting to the database every request.
	cached := handler
	req2 := httptest.NewRequest("GET", "/api/health", nil)
	rec2 := httptest.NewRecorder()
	Handler(rec2, req2)
	if rec2.Code != 200 {
		t.Fatalf("second invocation: expected 200, got %d", rec2.Code)
	}
	if handler != cached {
		t.Fatal("expected the router to be reused across invocations, got a new one")
	}
}
