package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestValidateSavedQuery(t *testing.T) {
	if name, err := validateSavedQueryName("  daily signups  "); err != nil || name != "daily signups" {
		t.Fatalf("expected the name to be trimmed: %q, %v", name, err)
	}
	for _, bad := range []string{"", "   ", strings.Repeat("x", maxSavedQueryNameLen+1)} {
		if _, err := validateSavedQueryName(bad); err == nil {
			t.Errorf("expected name %q to be rejected", bad)
		}
	}
	if err := validateSavedQuerySQL("select 1"); err != nil {
		t.Fatalf("expected valid sql to pass: %v", err)
	}
	for _, bad := range []string{"", " \n\t", strings.Repeat("x", maxSavedQuerySQLLen+1)} {
		if err := validateSavedQuerySQL(bad); err == nil {
			t.Errorf("expected sql of length %d to be rejected", len(bad))
		}
	}
}

func TestValidateSavedViewConfig(t *testing.T) {
	if err := validateSavedViewConfig(json.RawMessage(`{"sorts":[],"filters":[]}`)); err != nil {
		t.Fatalf("expected an object config to pass: %v", err)
	}
	for name, bad := range map[string]string{
		"empty":  ``,
		"array":  `[1,2]`,
		"string": `"x"`,
		"null":   `null`,
		"broken": `{"a":`,
		"huge":   fmt.Sprintf(`{"a":%q}`, strings.Repeat("x", maxSavedViewConfigSize)),
	} {
		if err := validateSavedViewConfig(json.RawMessage(bad)); err == nil {
			t.Errorf("%s: expected the config to be rejected", name)
		}
	}
}

func TestValidateSavedViewName(t *testing.T) {
	if name, err := validateSavedViewName(" Active users "); err != nil || name != "Active users" {
		t.Fatalf("expected the name to be trimmed: %q, %v", name, err)
	}
	if _, err := validateSavedViewName(" "); err == nil {
		t.Fatal("expected a blank name to be rejected")
	}
}

func TestIsStatementTimeout(t *testing.T) {
	if !isStatementTimeout(&pgconn.PgError{Code: "57014"}) {
		t.Fatal("expected SQLSTATE 57014 to count as a statement timeout")
	}
	// A wrapped error must still be recognised, and other codes must not be.
	if !isStatementTimeout(fmt.Errorf("count failed: %w", &pgconn.PgError{Code: "57014"})) {
		t.Fatal("expected a wrapped 57014 to be recognised")
	}
	if isStatementTimeout(&pgconn.PgError{Code: "42P01"}) || isStatementTimeout(errors.New("boom")) || isStatementTimeout(nil) {
		t.Fatal("expected non-timeout errors to be ignored")
	}
}
