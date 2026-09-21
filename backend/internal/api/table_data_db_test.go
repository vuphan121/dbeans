package api

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// These tests exercise the count and import logic against a real PostgreSQL.
// They skip unless DBEANS_TEST_DATABASE_URL points at a database that is safe
// to create (and drop) schemas in — every test works inside its own throwaway
// schema and removes it afterward. For example:
//
//	DBEANS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch go test ./internal/api

// testSchema connects to the test database and creates an empty schema for one
// test, returning the connection and the schema's name.
func testSchema(t *testing.T) (context.Context, *pgx.Conn, string) {
	t.Helper()
	url := os.Getenv("DBEANS_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("DBEANS_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	schema := fmt.Sprintf("dbeans_test_%d", time.Now().UnixNano())
	if _, err := conn.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	t.Cleanup(func() {
		_, _ = conn.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		_ = conn.Close(ctx)
	})
	return ctx, conn, schema
}

func mustExec(t *testing.T, ctx context.Context, conn *pgx.Conn, sql string) {
	t.Helper()
	if _, err := conn.Exec(ctx, sql); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func countRows(t *testing.T, ctx context.Context, conn *pgx.Conn, table string) int {
	t.Helper()
	var n int
	if err := conn.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func str(s string) *string { return &s }

func usersTable(t *testing.T, ctx context.Context, conn *pgx.Conn, schema string) (table, stmt string) {
	t.Helper()
	mustExec(t, ctx, conn, fmt.Sprintf(`CREATE TABLE %s.users (id serial PRIMARY KEY, email text NOT NULL UNIQUE, score int)`, schema))
	return schema + ".users", importInsertSQL(schema, "users", []string{"email", "score"})
}

func TestRunImportCommitsEveryRow(t *testing.T) {
	ctx, conn, schema := testSchema(t)
	table, stmt := usersTable(t, ctx, conn, schema)
	rows := [][]*string{{str("a@x"), str("1")}, {str("b@x"), nil}, {str("c@x"), str("3")}}
	resp, err := runImport(ctx, conn, stmt, rows, true)
	if err != nil || !resp.OK || resp.DryRun || resp.RowsInserted != 3 {
		t.Fatalf("unexpected result: %+v, %v", resp, err)
	}
	if got := countRows(t, ctx, conn, table); got != 3 {
		t.Fatalf("expected 3 committed rows, got %d", got)
	}
}

func TestRunImportDryRunWritesNothing(t *testing.T) {
	ctx, conn, schema := testSchema(t)
	table, stmt := usersTable(t, ctx, conn, schema)
	resp, err := runImport(ctx, conn, stmt, [][]*string{{str("a@x"), str("1")}}, false)
	if err != nil || !resp.OK || !resp.DryRun || resp.RowsInserted != 1 {
		t.Fatalf("unexpected result: %+v, %v", resp, err)
	}
	if got := countRows(t, ctx, conn, table); got != 0 {
		t.Fatalf("a dry run must not write, found %d rows", got)
	}
}

func TestRunImportIsAtomic(t *testing.T) {
	ctx, conn, schema := testSchema(t)
	table, stmt := usersTable(t, ctx, conn, schema)
	rows := [][]*string{{str("a@x"), str("1")}, {str("b@x"), str("2")}, {str("c@x"), str("not-a-number")}, {str("d@x"), str("4")}}
	resp, err := runImport(ctx, conn, stmt, rows, true)
	if err != nil || resp.OK || len(resp.Errors) != 1 || resp.Errors[0].Row != 3 {
		t.Fatalf("expected a single failure at row 3, got %+v, %v", resp, err)
	}
	if got := countRows(t, ctx, conn, table); got != 0 {
		t.Fatalf("a failing import must leave nothing behind, found %d rows", got)
	}
	// The connection must still be usable for the next request.
	if got := countRows(t, ctx, conn, table); got != 0 {
		t.Fatalf("connection unusable after failed import")
	}
}

func TestRunImportReportsEveryFailingRow(t *testing.T) {
	ctx, conn, schema := testSchema(t)
	_, stmt := usersTable(t, ctx, conn, schema)
	mustExec(t, ctx, conn, fmt.Sprintf(`INSERT INTO %s.users (email) VALUES ('taken@x')`, schema))
	rows := [][]*string{
		{str("g@x"), str("1")},     // ok
		{str("taken@x"), str("2")}, // duplicates an existing row
		{str("h@x"), str("x")},     // bad integer
		{str("i@x"), str("3")},     // ok
		{str("g@x"), str("4")},     // duplicates row 1 within the file
		{str("j@x"), str("y")},     // bad integer
	}
	resp, err := runImport(ctx, conn, stmt, rows, false)
	if err != nil || resp.OK {
		t.Fatalf("expected failures, got %+v, %v", resp, err)
	}
	var got []int
	for _, e := range resp.Errors {
		got = append(got, e.Row)
	}
	want := []int{2, 3, 5, 6}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("expected failing rows %v, got %v (%+v)", want, got, resp.Errors)
	}
	if resp.MoreErrors {
		t.Fatal("every failing row was found, so MoreErrors should be false")
	}
}

func TestRunImportCapsReportedErrors(t *testing.T) {
	ctx, conn, schema := testSchema(t)
	_, stmt := usersTable(t, ctx, conn, schema)
	mustExec(t, ctx, conn, fmt.Sprintf(`INSERT INTO %s.users (email) VALUES ('taken@x')`, schema))
	rows := make([][]*string, maxImportErrors+30)
	for i := range rows {
		rows[i] = []*string{str("taken@x"), nil}
	}
	resp, err := runImport(ctx, conn, stmt, rows, false)
	if err != nil || resp.OK {
		t.Fatalf("expected failures, got %+v, %v", resp, err)
	}
	if len(resp.Errors) != maxImportErrors || !resp.MoreErrors {
		t.Fatalf("expected exactly %d errors and MoreErrors, got %d (more=%v)", maxImportErrors, len(resp.Errors), resp.MoreErrors)
	}
}

func TestAutoRowCount(t *testing.T) {
	ctx, conn, schema := testSchema(t)
	// autovacuum could analyze the big table mid-test and change which path is
	// taken, so it is disabled for the table.
	mustExec(t, ctx, conn, fmt.Sprintf(`CREATE TABLE %s.big (id serial PRIMARY KEY, kind text) WITH (autovacuum_enabled = false)`, schema))
	mustExec(t, ctx, conn, fmt.Sprintf(`INSERT INTO %s.big (kind) SELECT 'k' || (g %% 10) FROM generate_series(1, %d) g`, schema, countCap+10_000))
	mustExec(t, ctx, conn, fmt.Sprintf(`CREATE TABLE %s.small (id serial PRIMARY KEY)`, schema))
	mustExec(t, ctx, conn, fmt.Sprintf(`INSERT INTO %s.small SELECT g FROM generate_series(1, 10) g`, schema))

	big := pgx.Identifier{schema, "big"}.Sanitize()
	small := pgx.Identifier{schema, "small"}.Sanitize()
	count := func(table, name, where string, args ...any) rowCount {
		t.Helper()
		got, err := autoRowCount(ctx, conn, schema, name, "BASE TABLE", where == "", table, where, args)
		if err != nil {
			t.Fatalf("autoRowCount: %v", err)
		}
		return got
	}

	if got := count(small, "small", ""); got != (rowCount{Total: 10, Kind: countExact}) {
		t.Fatalf("small table should count exactly, got %+v", got)
	}
	// Never analyzed: no estimate to use, so the bounded count runs and reports
	// its cap as a lower bound instead of scanning the whole table.
	if got := count(big, "big", ""); got != (rowCount{Total: countCap, Kind: countLowerBound}) {
		t.Fatalf("un-analyzed big table should report a lower bound, got %+v", got)
	}
	// A selective filter is well under the cap, so it is exact.
	if got := count(big, "big", ` WHERE "kind" = $1`, "k1"); got.Kind != countExact || got.Total != int64((countCap+10_000)/10) {
		t.Fatalf("selective filter should count exactly, got %+v", got)
	}
	mustExec(t, ctx, conn, fmt.Sprintf(`ANALYZE %s.big`, schema))
	got := count(big, "big", "")
	if got.Kind != countEstimated || got.Total < int64(countCap) {
		t.Fatalf("analyzed big table should use the planner estimate, got %+v", got)
	}
	// An estimate is only ever used for an unfiltered base table.
	if got := count(big, "big", ` WHERE "kind" = $1`, "k1"); got.Kind != countExact {
		t.Fatalf("a filtered count must not use the table-wide estimate, got %+v", got)
	}
}

func TestCountWithTimeoutIsScopedToItsTransaction(t *testing.T) {
	ctx, conn, schema := testSchema(t)
	mustExec(t, ctx, conn, fmt.Sprintf(`CREATE VIEW %s.slow AS SELECT g AS id FROM generate_series(1, 1000) g WHERE pg_sleep(0.01) IS NOT NULL`, schema))
	slow := pgx.Identifier{schema, "slow"}.Sanitize()

	_, err := countWithTimeout(ctx, conn, slow, "", nil, 0, 200)
	if !isStatementTimeout(err) {
		t.Fatalf("expected a statement timeout, got %v", err)
	}
	// The timeout was SET LOCAL to the counting transaction: it must not linger
	// on the connection, and the connection must still work.
	var timeout string
	if err := conn.QueryRow(ctx, "SHOW statement_timeout").Scan(&timeout); err != nil {
		t.Fatalf("connection unusable after a timed-out count: %v", err)
	}
	if timeout != "0" {
		t.Fatalf("statement_timeout leaked onto the connection: %q", timeout)
	}
	// And a bounded count over the same view stops at its cap rather than scanning it all.
	if n, err := countWithTimeout(ctx, conn, slow, "", nil, 5, 5000); err != nil || n != 6 {
		t.Fatalf("expected the bounded count to stop at limit+1 rows, got %d, %v", n, err)
	}
}
