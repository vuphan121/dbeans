package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"dbeans/backend/internal/auth"
)

const queryTimeout = 20 * time.Second
const maxResultRows = 1000

type sqlConnFields struct {
	Host                  string `json:"host"`
	Port                  int    `json:"port"`
	Database              string `json:"database"`
	User                  string `json:"user"`
	Password              string `json:"password"`
	SSLMode               string `json:"sslMode"`
	ConnectTimeoutSeconds int    `json:"connectTimeoutSeconds"`
}

func postgresDSN(f sqlConnFields) string {
	u := url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(f.User, f.Password),
		Host:   fmt.Sprintf("%s:%d", f.Host, f.Port),
		Path:   "/" + f.Database,
	}
	sslMode := f.SSLMode
	if sslMode == "" {
		sslMode = "prefer"
	}
	timeout := f.ConnectTimeoutSeconds
	if timeout <= 0 {
		timeout = 10
	}
	q := u.Query()
	q.Set("sslmode", sslMode)
	q.Set("connect_timeout", strconv.Itoa(timeout))
	u.RawQuery = q.Encode()
	return u.String()
}

// loadTargetConnection resolves a saved connection owned by the user and
// returns its engine-specific fields so a real connection can be opened
// against it (as opposed to dbeans' own operator database, s.Pool).
func (s *Server) loadTargetConnection(ctx context.Context, userID int64, id string) (engine string, fields sqlConnFields, err error) {
	var fieldsJSON []byte
	err = s.Pool.QueryRow(ctx, `
		SELECT engine, fields FROM connections WHERE id = $1 AND user_id = $2`,
		id, userID).Scan(&engine, &fieldsJSON)
	if err != nil {
		return "", sqlConnFields{}, err
	}
	_ = json.Unmarshal(fieldsJSON, &fields)
	return engine, fields, nil
}

// connectTarget opens a real connection to the user's target database. Only
// Postgres is wired up to an actual driver so far — MySQL/SQLite report a
// clear "not supported yet" error instead of pretending, since those drivers
// aren't in go.mod yet (see docs/ARCHITECTURE.md §2).
func (s *Server) connectTarget(ctx context.Context, engine string, fields sqlConnFields) (*pgx.Conn, error) {
	if engine != "postgres" {
		return nil, fmt.Errorf("%s connections aren't wired up to a real query engine yet", engine)
	}
	connectCtx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	conn, err := pgx.Connect(connectCtx, postgresDSN(fields))
	if err != nil {
		return nil, fmt.Errorf("could not connect: %w", err)
	}
	return conn, nil
}

type ColumnInfo struct {
	Name         string `json:"name"`
	Type         string `json:"type"`
	IsPrimaryKey bool   `json:"isPrimaryKey,omitempty"` // only meaningful for schema introspection, always false on query results
}

type TableInfo struct {
	Name    string       `json:"name"`
	Kind    string       `json:"kind"` // "table" | "view"
	Columns []ColumnInfo `json:"columns"`
}

type SchemaInfo struct {
	Name   string      `json:"name"`
	Tables []TableInfo `json:"tables"`
}

// ForeignKeyInfo is one edge of the schema's relationship graph — used by
// the frontend's ERD view (PRD.md "Connection graphs" section) to draw an
// arrow from the referencing table/column to the referenced one.
type ForeignKeyInfo struct {
	FromSchema string `json:"fromSchema"`
	FromTable  string `json:"fromTable"`
	FromColumn string `json:"fromColumn"`
	ToSchema   string `json:"toSchema"`
	ToTable    string `json:"toTable"`
	ToColumn   string `json:"toColumn"`
}

type SchemaResponse struct {
	Database    string           `json:"database"`
	Schemas     []SchemaInfo     `json:"schemas"`
	ForeignKeys []ForeignKeyInfo `json:"foreignKeys"`
}

// GetConnectionSchema introspects the target database's real tables/views
// and columns via information_schema. Replaces the previous hardcoded mock
// schema tree entirely — an empty database now correctly shows no tables.
func (s *Server) GetConnectionSchema(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	id := chi.URLParam(r, "id")
	engine, fields, err := s.loadTargetConnection(r.Context(), user.ID, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "connection not found")
		return
	}

	conn, err := s.connectTarget(r.Context(), engine, fields)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer conn.Close(r.Context())

	ctx, cancel := context.WithTimeout(r.Context(), queryTimeout)
	defer cancel()

	type tableKey struct{ schema, name string }
	order := []tableKey{}
	kinds := map[tableKey]string{}

	rows, err := conn.Query(ctx, `
		SELECT table_schema, table_name,
		       CASE table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END
		FROM information_schema.tables
		WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
		ORDER BY table_schema, table_name`)
	if err != nil {
		writeError(w, http.StatusBadGateway, "schema introspection failed: "+err.Error())
		return
	}
	for rows.Next() {
		var k tableKey
		var kind string
		if err := rows.Scan(&k.schema, &k.name, &kind); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "failed to read schema")
			return
		}
		order = append(order, k)
		kinds[k] = kind
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusBadGateway, "schema introspection failed: "+err.Error())
		return
	}

	pkColumns := map[tableKey]map[string]bool{}
	pkRows, err := conn.Query(ctx, `
		SELECT tc.table_schema, tc.table_name, kcu.column_name
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
			ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
		WHERE tc.constraint_type = 'PRIMARY KEY'
			AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')`)
	if err != nil {
		writeError(w, http.StatusBadGateway, "primary key introspection failed: "+err.Error())
		return
	}
	for pkRows.Next() {
		var k tableKey
		var col string
		if err := pkRows.Scan(&k.schema, &k.name, &col); err != nil {
			pkRows.Close()
			writeError(w, http.StatusInternalServerError, "failed to read primary keys")
			return
		}
		if pkColumns[k] == nil {
			pkColumns[k] = map[string]bool{}
		}
		pkColumns[k][col] = true
	}
	pkRows.Close()
	if err := pkRows.Err(); err != nil {
		writeError(w, http.StatusBadGateway, "primary key introspection failed: "+err.Error())
		return
	}

	columns := map[tableKey][]ColumnInfo{}
	colRows, err := conn.Query(ctx, `
		SELECT table_schema, table_name, column_name, data_type
		FROM information_schema.columns
		WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
		ORDER BY table_schema, table_name, ordinal_position`)
	if err != nil {
		writeError(w, http.StatusBadGateway, "column introspection failed: "+err.Error())
		return
	}
	for colRows.Next() {
		var k tableKey
		var col ColumnInfo
		if err := colRows.Scan(&k.schema, &k.name, &col.Name, &col.Type); err != nil {
			colRows.Close()
			writeError(w, http.StatusInternalServerError, "failed to read columns")
			return
		}
		col.IsPrimaryKey = pkColumns[k][col.Name]
		columns[k] = append(columns[k], col)
	}
	colRows.Close()
	if err := colRows.Err(); err != nil {
		writeError(w, http.StatusBadGateway, "column introspection failed: "+err.Error())
		return
	}

	foreignKeys := []ForeignKeyInfo{}
	fkRows, err := conn.Query(ctx, `
		SELECT tc.table_schema, tc.table_name, kcu.column_name,
		       ccu.table_schema, ccu.table_name, ccu.column_name
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
			ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
		JOIN information_schema.constraint_column_usage ccu
			ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
		WHERE tc.constraint_type = 'FOREIGN KEY'
			AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')`)
	if err != nil {
		writeError(w, http.StatusBadGateway, "foreign key introspection failed: "+err.Error())
		return
	}
	for fkRows.Next() {
		var fk ForeignKeyInfo
		if err := fkRows.Scan(&fk.FromSchema, &fk.FromTable, &fk.FromColumn, &fk.ToSchema, &fk.ToTable, &fk.ToColumn); err != nil {
			fkRows.Close()
			writeError(w, http.StatusInternalServerError, "failed to read foreign keys")
			return
		}
		foreignKeys = append(foreignKeys, fk)
	}
	fkRows.Close()
	if err := fkRows.Err(); err != nil {
		writeError(w, http.StatusBadGateway, "foreign key introspection failed: "+err.Error())
		return
	}

	resp := SchemaResponse{Database: fields.Database, Schemas: []SchemaInfo{}, ForeignKeys: foreignKeys}
	schemaIndex := map[string]int{}
	for _, k := range order {
		idx, ok := schemaIndex[k.schema]
		if !ok {
			idx = len(resp.Schemas)
			schemaIndex[k.schema] = idx
			resp.Schemas = append(resp.Schemas, SchemaInfo{Name: k.schema, Tables: []TableInfo{}})
		}
		resp.Schemas[idx].Tables = append(resp.Schemas[idx].Tables, TableInfo{
			Name:    k.name,
			Kind:    kinds[k],
			Columns: columns[k],
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

type runQueryRequest struct {
	SQL string `json:"sql"`
}

// QueryResult carries every cell as either a string or null, decoded from
// Postgres' text wire format (via QueryResultFormats), rather than trying to
// map every possible pgtype into a JSON-native type. That keeps the grid's
// rendering generic and avoids silently mangling numerics/timestamps/UUIDs.
type QueryResult struct {
	Columns    []ColumnInfo `json:"columns"`
	Rows       [][]*string  `json:"rows"`
	RowCount   int          `json:"rowCount"`
	Truncated  bool         `json:"truncated"`
	DurationMs int64        `json:"durationMs"`
	Command    string       `json:"command"`
}

// RunConnectionQuery executes arbitrary SQL the user wrote in the workbench
// against their own target connection. This is the feature the whole SQL
// editor exists for, so no parameterization/allowlisting is applied to the
// statement itself — it runs with the credentials the user stored for their
// own database, same as any SQL client would.
func (s *Server) RunConnectionQuery(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var req runQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.SQL) == "" {
		writeError(w, http.StatusBadRequest, "sql is required")
		return
	}

	id := chi.URLParam(r, "id")
	engine, fields, err := s.loadTargetConnection(r.Context(), user.ID, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "connection not found")
		return
	}

	conn, err := s.connectTarget(r.Context(), engine, fields)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer conn.Close(r.Context())

	ctx, cancel := context.WithTimeout(r.Context(), queryTimeout)
	defer cancel()

	start := time.Now()
	rows, err := conn.Query(ctx, req.SQL, pgx.QueryResultFormats{pgx.TextFormatCode})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	fieldDescs := rows.FieldDescriptions()
	typeMap := conn.TypeMap()
	columns := make([]ColumnInfo, len(fieldDescs))
	for i, fd := range fieldDescs {
		typeName := "unknown"
		if t, ok := typeMap.TypeForOID(fd.DataTypeOID); ok {
			typeName = t.Name
		}
		columns[i] = ColumnInfo{Name: fd.Name, Type: typeName}
	}

	resultRows := [][]*string{}
	truncated := false
	for rows.Next() {
		if len(resultRows) >= maxResultRows {
			truncated = true
			break
		}
		raw := rows.RawValues()
		record := make([]*string, len(raw))
		for i, v := range raw {
			if v == nil {
				continue
			}
			str := string(v)
			record[i] = &str
		}
		resultRows = append(resultRows, record)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	tag := rows.CommandTag()
	durationMs := time.Since(start).Milliseconds()

	rowCount := len(resultRows)
	if len(columns) == 0 {
		rowCount = int(tag.RowsAffected())
	}

	writeJSON(w, http.StatusOK, QueryResult{
		Columns:    columns,
		Rows:       resultRows,
		RowCount:   rowCount,
		Truncated:  truncated,
		DurationMs: durationMs,
		Command:    tag.String(),
	})
}
