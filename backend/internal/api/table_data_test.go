package api

import (
	"reflect"
	"testing"
)

func TestBuildDataWhere(t *testing.T) {
	value := "ada"
	where, args, err := buildDataWhere([]dataFilter{
		{Column: "name", Operator: "contains", Value: &value},
		{Column: "deleted_at", Operator: "is-null"},
	}, map[string]bool{"name": true, "deleted_at": true})
	if err != nil {
		t.Fatal(err)
	}
	if where != ` WHERE "name"::text ILIKE $1 AND "deleted_at" IS NULL` {
		t.Fatalf("unexpected where clause: %s", where)
	}
	if len(args) != 1 || args[0] != "%ada%" {
		t.Fatalf("unexpected args: %#v", args)
	}
}

func TestBuildDataWhereRejectsUnknownColumn(t *testing.T) {
	value := "x"
	if _, _, err := buildDataWhere([]dataFilter{{Column: "missing", Operator: "eq", Value: &value}}, map[string]bool{"id": true}); err == nil {
		t.Fatal("expected an unknown-column error")
	}
}

func TestValidatePrimaryKeyRequiresEveryPart(t *testing.T) {
	columns := []ColumnInfo{{Name: "tenant_id", IsPrimaryKey: true}, {Name: "id", IsPrimaryKey: true}}
	value := "1"
	if err := validatePrimaryKey(map[string]*string{"id": &value}, columns); err == nil {
		t.Fatal("expected a partial composite key to be rejected")
	}
	if err := validatePrimaryKey(map[string]*string{"tenant_id": &value, "id": &value}, columns); err != nil {
		t.Fatalf("expected a complete composite key to pass: %v", err)
	}
}

func TestBuildDataOrder(t *testing.T) {
	columns := []ColumnInfo{{Name: "tenant_id", IsPrimaryKey: true}, {Name: "id", IsPrimaryKey: true}}
	// An explicit sort on part of a composite key still gets the remaining
	// key column appended as a tiebreaker, so paging stays stable even when
	// the sorted column alone has duplicate values.
	order, err := buildDataOrder([]dataSort{{Column: "id", Direction: "desc"}}, map[string]bool{"id": true}, columns)
	if err != nil || order != ` ORDER BY "id" DESC, "tenant_id"` {
		t.Fatalf("unexpected explicit order: %q, %v", order, err)
	}
	// Sorting by the full primary key needs no extra tiebreaker.
	order, err = buildDataOrder([]dataSort{{Column: "tenant_id", Direction: "asc"}, {Column: "id", Direction: "asc"}}, map[string]bool{"tenant_id": true, "id": true}, columns)
	if err != nil || order != ` ORDER BY "tenant_id" ASC, "id" ASC` {
		t.Fatalf("unexpected full-key explicit order: %q, %v", order, err)
	}
	order, err = buildDataOrder(nil, map[string]bool{"tenant_id": true, "id": true}, columns)
	if err != nil || order != ` ORDER BY "tenant_id", "id"` {
		t.Fatalf("unexpected primary-key order: %q, %v", order, err)
	}
	if _, err := buildDataOrder([]dataSort{{Column: "missing", Direction: "asc"}}, map[string]bool{"id": true}, columns); err == nil {
		t.Fatal("expected unknown sort column to be rejected")
	}
}

func TestRowMapPairsColumnsWithReturningValues(t *testing.T) {
	columns := []ColumnInfo{{Name: "id"}, {Name: "email"}}
	id, email := "1", "ada@example.test"
	got := rowMap(columns, []*string{&id, &email})
	want := map[string]*string{"id": &id, "email": &email}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected row map: %#v", got)
	}
	// A row shorter than the column list (e.g. a malformed RETURNING result)
	// must not panic — later columns are simply omitted.
	if got := rowMap(columns, []*string{&id}); len(got) != 1 || got["id"] != &id {
		t.Fatalf("expected a short row to be handled safely: %#v", got)
	}
}

func TestColumnNames(t *testing.T) {
	got := columnNames([]ColumnInfo{{Name: "id"}, {Name: "email"}})
	if !reflect.DeepEqual(got, []string{"id", "email"}) {
		t.Fatalf("unexpected column names: %#v", got)
	}
}

func TestValidateSchemaChangeSQL(t *testing.T) {
	valid := `ALTER TABLE "public"."users" ADD COLUMN "active" boolean;`
	if sql, err := validateSchemaChangeSQL(valid); err != nil || sql == "" {
		t.Fatalf("expected generated DDL to pass: %q, %v", sql, err)
	}
	for _, invalid := range []string{
		`DROP TABLE users`,
		`ALTER TABLE users DROP COLUMN email`,
		`ALTER TABLE users RENAME COLUMN email TO old_email`,
		`ALTER TABLE users ADD COLUMN ok text; DROP TABLE users;`,
		`ALTER TABLE users ADD COLUMN ok text -- hidden`,
	} {
		if _, err := validateSchemaChangeSQL(invalid); err == nil {
			t.Fatalf("expected unsafe schema SQL to be rejected: %s", invalid)
		}
	}
}
