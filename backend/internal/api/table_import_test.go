package api

import (
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func importColumns() []ColumnInfo {
	def := "now()"
	return []ColumnInfo{
		{Name: "id", IsPrimaryKey: true, IsIdentity: true},
		{Name: "email", Nullable: false},
		{Name: "plan", Nullable: true},
		{Name: "created_at", Nullable: false, DefaultValue: &def},
		{Name: "score_x2", Nullable: true, IsGenerated: true},
	}
}

func TestValidateImport(t *testing.T) {
	a, b := "ada@example.test", "free"
	row := []*string{&a, &b}
	valid := importRequest{Schema: "public", Table: "users", Columns: []string{"email", "plan"}, Rows: [][]*string{row}}
	if err := validateImport(valid, importColumns()); err != nil {
		t.Fatalf("expected a well-formed import to pass: %v", err)
	}

	cases := map[string]importRequest{
		"no schema":            {Table: "users", Columns: []string{"email"}, Rows: [][]*string{{&a}}},
		"no columns":           {Schema: "public", Table: "users", Rows: [][]*string{{&a}}},
		"no rows":              {Schema: "public", Table: "users", Columns: []string{"email"}},
		"unknown column":       {Schema: "public", Table: "users", Columns: []string{"nope"}, Rows: [][]*string{{&a}}},
		"identity column":      {Schema: "public", Table: "users", Columns: []string{"id", "email"}, Rows: [][]*string{{&a, &a}}},
		"generated column":     {Schema: "public", Table: "users", Columns: []string{"email", "score_x2"}, Rows: [][]*string{{&a, &a}}},
		"duplicate mapping":    {Schema: "public", Table: "users", Columns: []string{"email", "email"}, Rows: [][]*string{{&a, &a}}},
		"required unmapped":    {Schema: "public", Table: "users", Columns: []string{"plan"}, Rows: [][]*string{{&b}}},
		"ragged row":           {Schema: "public", Table: "users", Columns: []string{"email", "plan"}, Rows: [][]*string{{&a}}},
		"identifier injection": {Schema: "public", Table: "users", Columns: []string{`email"); DROP TABLE users; --`}, Rows: [][]*string{{&a}}},
	}
	for name, req := range cases {
		if err := validateImport(req, importColumns()); err == nil {
			t.Errorf("%s: expected the import to be rejected", name)
		}
	}
}

func TestValidateImportRowLimit(t *testing.T) {
	v := "x"
	rows := make([][]*string, maxImportRows+1)
	for i := range rows {
		rows[i] = []*string{&v}
	}
	err := validateImport(importRequest{Schema: "public", Table: "users", Columns: []string{"email"}, Rows: rows}, importColumns())
	if err == nil || !strings.Contains(err.Error(), "at most") {
		t.Fatalf("expected the row limit to be enforced, got %v", err)
	}
}

func TestImportInsertSQLQuotesIdentifiers(t *testing.T) {
	got := importInsertSQL("my schema", `we"ird`, []string{"a", `b"c`})
	want := `INSERT INTO "my schema"."we""ird" ("a", "b""c") VALUES ($1, $2)`
	if got != want {
		t.Fatalf("unexpected insert SQL:\n got %s\nwant %s", got, want)
	}
}

func TestImportErrorMessageIncludesDetail(t *testing.T) {
	err := &pgconn.PgError{Message: "duplicate key value violates unique constraint", Detail: "Key (id)=(3) already exists."}
	if got := importErrorMessage(err); got != "duplicate key value violates unique constraint — Key (id)=(3) already exists." {
		t.Fatalf("unexpected message: %q", got)
	}
	if got := importErrorMessage(&pgconn.PgError{Message: "invalid input syntax for type integer"}); got != "invalid input syntax for type integer" {
		t.Fatalf("unexpected message without detail: %q", got)
	}
	if got := importErrorMessage(errors.New("connection reset")); got != "connection reset" {
		t.Fatalf("unexpected message for a non-Postgres error: %q", got)
	}
}
