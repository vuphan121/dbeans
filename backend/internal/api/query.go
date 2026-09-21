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
	"dbeans/backend/internal/crypto"
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
	ReadOnly              bool   `json:"readOnly"`
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
	var fieldsEnc []byte
	err = s.Pool.QueryRow(ctx, `
		SELECT engine, fields_enc FROM connections WHERE id = $1 AND user_id = $2`,
		id, userID).Scan(&engine, &fieldsEnc)
	if err != nil {
		return "", sqlConnFields{}, err
	}
	fieldsJSON, err := crypto.Decrypt(fieldsEnc)
	if err != nil {
		return "", sqlConnFields{}, fmt.Errorf("decrypt connection fields: %w", err)
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
	Name         string           `json:"name"`
	Type         string           `json:"type"`
	IsPrimaryKey bool             `json:"isPrimaryKey,omitempty"`
	Nullable     bool             `json:"nullable"`
	DefaultValue *string          `json:"defaultValue,omitempty"`
	IsIdentity   bool             `json:"isIdentity,omitempty"`
	IsGenerated  bool             `json:"isGenerated,omitempty"`
	EnumValues   []string         `json:"enumValues,omitempty"`
	References   *ColumnReference `json:"references,omitempty"`
	// SourceSchema/SourceTable identify which real table a query-result
	// column came from (resolved from pgconn.FieldDescription's TableOID —
	// see RunConnectionQuery). Empty for computed expressions/aggregates,
	// and always empty for schema-introspection ColumnInfo values.
	SourceSchema string `json:"sourceSchema,omitempty"`
	SourceTable  string `json:"sourceTable,omitempty"`
}

type ColumnReference struct {
	Schema string `json:"schema"`
	Table  string `json:"table"`
	Column string `json:"column"`
}

// tableKey identifies a table by schema+name — shared between schema
// introspection (GetConnectionSchema) and query-result column provenance
// (RunConnectionQuery's resolveTableOID/fetchPrimaryKeyColumns).
type tableKey struct{ schema, name string }

// resolveTableOID looks up which real table a pgconn.FieldDescription's
// TableOID refers to. A zero OID (computed expression, aggregate, literal)
// is the caller's responsibility to skip before calling this.
func resolveTableOID(ctx context.Context, conn *pgx.Conn, oid uint32) (tableKey, error) {
	var k tableKey
	err := conn.QueryRow(ctx, `
		SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.oid = $1`, oid).Scan(&k.schema, &k.name)
	return k, err
}

// fetchPrimaryKeyColumns returns the primary-key column names of one table —
// the same information GetConnectionSchema's bulk pkRows query computes for
// every table at once, scoped here to a single table since a query result
// only ever needs it for the handful of tables its columns came from.
func fetchPrimaryKeyColumns(ctx context.Context, conn *pgx.Conn, k tableKey) (map[string]bool, error) {
	rows, err := conn.Query(ctx, `
		SELECT kcu.column_name
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
			ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
		WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
		k.schema, k.name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	pk := map[string]bool{}
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			return nil, err
		}
		pk[col] = true
	}
	return pk, rows.Err()
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
	// RenderTemplate opts into resolving {{date}}/{{secretName}} placeholders
	// (see jobs.go's renderJobTemplate) before running the SQL — used by the
	// job editor's "Test query" button so a job referencing a vault secret
	// can be tested with the real value, without ordinary workbench queries
	// ever having "{{" treated as anything but literal text.
	RenderTemplate bool `json:"renderTemplate,omitempty"`
	// RequestID tags the statement so an explicit cancel (see request_cancel.go)
	// can find and stop it while it runs. Optional; without one the query
	// simply isn't cancellable.
	RequestID string `json:"requestId,omitempty"`
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
	if req.RenderTemplate {
		secrets, err := loadUserSecrets(r.Context(), s.Pool, user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load secrets")
			return
		}
		req.SQL = renderJobTemplate(req.SQL, time.Now(), secrets)
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
	rows, err := conn.Query(ctx, tagSQL(req.RequestID, req.SQL), pgx.QueryResultFormats{pgx.TextFormatCode})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	// rows.FieldDescriptions() aliases the connection's own reusable read
	// buffer — it is silently overwritten by the *next* query issued on this
	// same *pgx.Conn (the provenance-resolution queries below), so every
	// field it's needed for once resolved. Name/TableOID must be copied out
	// now, not read again later.
	type fieldMeta struct {
		name     string
		tableOID uint32
	}
	fieldDescs := rows.FieldDescriptions()
	fieldMetas := make([]fieldMeta, len(fieldDescs))
	typeMap := conn.TypeMap()
	columns := make([]ColumnInfo, len(fieldDescs))
	for i, fd := range fieldDescs {
		typeName := "unknown"
		if t, ok := typeMap.TypeForOID(fd.DataTypeOID); ok {
			typeName = t.Name
		}
		columns[i] = ColumnInfo{Name: fd.Name, Type: typeName}
		fieldMetas[i] = fieldMeta{name: fd.Name, tableOID: fd.TableOID}
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

	// Column provenance (which real table/PK a column came from, for the
	// results grid's inline-edit feature) needs its own round trips against
	// pg_class/information_schema — only safe to run now that the query
	// above's result set has been fully read and closed, since pgx only
	// allows one query in flight per connection at a time.
	type resolvedTable struct {
		key tableKey
		pk  map[string]bool
	}
	resolvedByOID := map[uint32]resolvedTable{}
	for i, f := range fieldMetas {
		if f.tableOID == 0 {
			continue
		}
		resolved, ok := resolvedByOID[f.tableOID]
		if !ok {
			if key, rerr := resolveTableOID(ctx, conn, f.tableOID); rerr == nil {
				pk, _ := fetchPrimaryKeyColumns(ctx, conn, key)
				resolved = resolvedTable{key: key, pk: pk}
			}
			resolvedByOID[f.tableOID] = resolved
		}
		if resolved.key.name != "" {
			columns[i].SourceSchema = resolved.key.schema
			columns[i].SourceTable = resolved.key.name
			columns[i].IsPrimaryKey = resolved.pk[f.name]
		}
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

type updateCellRequest struct {
	Schema   string  `json:"schema"`
	Table    string  `json:"table"`
	Column   string  `json:"column"`
	Value    *string `json:"value"`
	PKColumn string  `json:"pkColumn"`
	PKValue  string  `json:"pkValue"`
}

// UpdateConnectionCell applies one inline result-grid edit as a parameterized
// UPDATE — a dedicated structured endpoint rather than letting the frontend
// string-build an UPDATE from an arbitrary typed cell value, so the actual
// value is always passed as a bind parameter, never interpolated into SQL.
// Identifiers (schema/table/column names) come from RunConnectionQuery's own
// column provenance, not free-typed user input, but are still passed through
// pgx.Identifier.Sanitize() rather than trusted as pre-quoted.
func (s *Server) UpdateConnectionCell(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var req updateCellRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil ||
		req.Schema == "" || req.Table == "" || req.Column == "" || req.PKColumn == "" {
		writeError(w, http.StatusBadRequest, "schema, table, column, and pkColumn are required")
		return
	}

	id := chi.URLParam(r, "id")
	engine, fields, err := s.loadTargetConnection(r.Context(), user.ID, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "connection not found")
		return
	}
	if fields.ReadOnly {
		writeError(w, http.StatusForbidden, "this connection is read-only")
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

	stmt := fmt.Sprintf(`UPDATE %s SET %s = $1 WHERE %s = $2`,
		pgx.Identifier{req.Schema, req.Table}.Sanitize(),
		pgx.Identifier{req.Column}.Sanitize(),
		pgx.Identifier{req.PKColumn}.Sanitize())

	tag, err := conn.Exec(ctx, stmt, req.Value, req.PKValue)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "rowsAffected": tag.RowsAffected()})
}
