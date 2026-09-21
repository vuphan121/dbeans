package api

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestValidRequestID(t *testing.T) {
	for _, ok := range []string{"a1b2c3d4", "3f2504e0-4f89-11d3-9a0c-0305e82c3301", strings.Repeat("x", 64)} {
		if !validRequestID(ok) {
			t.Errorf("expected %q to be accepted", ok)
		}
	}
	// Anything that could break out of a SQL comment, or is too short/long, is refused.
	for _, bad := range []string{"", "short", strings.Repeat("x", 65), "abcd*/ DROP TABLE", "abcd1234 ", "abcd1234\n", "abcd_1234", "abcd%1234", "abcd'1234"} {
		if validRequestID(bad) {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
}

func TestTagSQL(t *testing.T) {
	if got := tagSQL("3f2504e0-4f89", "SELECT 1"); got != "/* dbeans-req:3f2504e0-4f89 */ SELECT 1" {
		t.Fatalf("unexpected tagged SQL: %q", got)
	}
	// A missing or malformed id leaves the statement exactly as it was.
	for _, id := range []string{"", "bad id", "x*/y-12345"} {
		if got := tagSQL(id, "SELECT 1"); got != "SELECT 1" {
			t.Errorf("id %q should not tag the statement, got %q", id, got)
		}
	}
}

// sleeper runs a tagged (or untagged) long statement on its own connection and
// reports how it ended.
type sleeper struct {
	done chan error
	took chan time.Duration
}

func startSleeper(ctx context.Context, t *testing.T, url, sql string) *sleeper {
	t.Helper()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	s := &sleeper{done: make(chan error, 1), took: make(chan time.Duration, 1)}
	go func() {
		defer conn.Close(context.Background())
		start := time.Now()
		_, err := conn.Exec(ctx, sql)
		s.took <- time.Since(start)
		s.done <- err
	}()
	return s
}

// waitActive blocks until a session's statement text contains marker, so the
// test doesn't race the goroutine that starts it.
func waitActive(ctx context.Context, t *testing.T, conn *pgx.Conn, marker string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		if err := conn.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid() AND query LIKE '%' || $1 || '%'`, marker).Scan(&n); err == nil && n > 0 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("no active session running %q", marker)
}

func TestTerminateRequestStopsOnlyTheTaggedSession(t *testing.T) {
	ctx, conn, _ := testSchema(t)
	url := testDatabaseURL()

	target, otherTag := "aaaa1111-tagged-target", "bbbb2222-other-request"
	tagged := startSleeper(ctx, t, url, tagSQL(target, "SELECT pg_sleep(30) /* target-marker */"))
	other := startSleeper(ctx, t, url, tagSQL(otherTag, "SELECT pg_sleep(4) /* other-marker */"))
	plain := startSleeper(ctx, t, url, "SELECT pg_sleep(4) /* plain-marker */")
	waitActive(ctx, t, conn, "target-marker")
	waitActive(ctx, t, conn, "other-marker")
	waitActive(ctx, t, conn, "plain-marker")

	n, err := terminateRequest(ctx, conn, target)
	if err != nil || n != 1 {
		t.Fatalf("expected exactly one session terminated, got %d, %v", n, err)
	}
	select {
	case err := <-tagged.done:
		if err == nil {
			t.Fatal("the tagged statement should have failed after its session was terminated")
		}
		if took := <-tagged.took; took > 3*time.Second {
			t.Fatalf("the tagged 30s statement should end promptly, took %s", took)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the tagged statement was still running after termination")
	}
	// The other tagged request and the untagged one must be left running to
	// completion (they end on their own after ~4s, successfully).
	for name, s := range map[string]*sleeper{"other tagged request": other, "untagged statement": plain} {
		if err := <-s.done; err != nil {
			t.Errorf("%s should not have been terminated: %v", name, err)
		}
	}
	// Terminating again finds nothing.
	if n, err := terminateRequest(ctx, conn, target); err != nil || n != 0 {
		t.Fatalf("a second cancel should be a no-op, got %d, %v", n, err)
	}
}

func TestTerminateRequestLeavesIdleAndUnknownAlone(t *testing.T) {
	ctx, conn, _ := testSchema(t)
	if n, err := terminateRequest(ctx, conn, "cccc3333-never-ran"); err != nil || n != 0 {
		t.Fatalf("an id that matches nothing should terminate nothing, got %d, %v", n, err)
	}
	// This session must not have killed itself or anything else.
	var one int
	if err := conn.QueryRow(ctx, "SELECT 1").Scan(&one); err != nil {
		t.Fatalf("connection unusable: %v", err)
	}
}
