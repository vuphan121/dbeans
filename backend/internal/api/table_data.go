package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"dbeans/backend/internal/analytics"
	"dbeans/backend/internal/auth"
)

type dataFilter struct {
	Column   string  `json:"column"`
	Operator string  `json:"operator"`
	Value    *string `json:"value"`
}

type browseTableRequest struct {
	Schema   string       `json:"schema"`
	Table    string       `json:"table"`
	Filters  []dataFilter `json:"filters"`
	Page     int          `json:"page"`
	PageSize int          `json:"pageSize"`
	Sorts    []dataSort   `json:"sorts"`
	// CountMode is "auto" (the default: pick the cheapest honest row count) or
	// "skip" (don't count at all — the caller already has a count for this
	// exact table + filter set, e.g. when only the page or sort changed).
	CountMode string `json:"countMode"`
	// RequestID tags this load's statements so an explicit cancel (see
	// request_cancel.go) can find and stop them. Optional.
	RequestID string `json:"requestId"`
}

type dataSort struct {
	Column    string `json:"column"`
	Direction string `json:"direction"`
}

type tableDataResponse struct {
	Columns []ColumnInfo `json:"columns"`
	Rows    [][]*string  `json:"rows"`
	// Total is the best row count available and TotalKind says how far to
	// trust it: "exact", "estimated" (planner statistics), "lower-bound" (at
	// least this many — the bounded count hit its cap), "unknown" (the bounded
	// count timed out), or "skipped" (CountMode "skip"; Total is 0).
	Total     int64  `json:"total"`
	TotalKind string `json:"totalKind"`
	// HasMore is always exact, independent of Total: whether any row exists
	// past this page. It's what keeps Next/Previous correct when Total isn't.
	HasMore  bool `json:"hasMore"`
	Page     int  `json:"page"`
	PageSize int  `json:"pageSize"`
}

type tableRowMutation struct {
	Schema string             `json:"schema"`
	Table  string             `json:"table"`
	Values map[string]*string `json:"values"`
	Key    map[string]*string `json:"key"`
}

type bulkDeleteRequest struct {
	Schema string               `json:"schema"`
	Table  string               `json:"table"`
	Keys   []map[string]*string `json:"keys"`
}

type schemaChangeRequest struct {
	SQL string `json:"sql"`
}

func tableMetadata(ctx context.Context, conn *pgx.Conn, schema, table string) ([]ColumnInfo, map[string]bool, string, error) {
	rows, err := conn.Query(ctx, `
		SELECT c.column_name, c.data_type, c.is_nullable = 'YES', c.column_default,
		       c.is_identity = 'YES', c.is_generated <> 'NEVER', t.table_type,
		       EXISTS (
		         SELECT 1 FROM information_schema.table_constraints tc
		         JOIN information_schema.key_column_usage kcu
		           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
		         WHERE tc.constraint_type = 'PRIMARY KEY'
		           AND tc.table_schema = c.table_schema AND tc.table_name = c.table_name
		           AND kcu.column_name = c.column_name
		       ),
		       COALESCE((
		         SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[]
		         FROM pg_type pt JOIN pg_namespace pn ON pn.oid = pt.typnamespace
		         JOIN pg_enum e ON e.enumtypid = pt.oid
		         WHERE pn.nspname = c.udt_schema AND pt.typname = c.udt_name
		       ), ARRAY[]::text[]),
		       fk.to_schema, fk.to_table, fk.to_column
		FROM information_schema.columns c
		JOIN information_schema.tables t
		  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
		LEFT JOIN LATERAL (
		  SELECT ccu.table_schema AS to_schema, ccu.table_name AS to_table, ccu.column_name AS to_column
		  FROM information_schema.table_constraints tc
		  JOIN information_schema.key_column_usage kcu
		    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
		  JOIN information_schema.constraint_column_usage ccu
		    ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
		  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = c.table_schema
		    AND tc.table_name = c.table_name AND kcu.column_name = c.column_name
		  LIMIT 1
		) fk ON true
		WHERE c.table_schema = $1 AND c.table_name = $2 AND t.table_type IN ('BASE TABLE', 'VIEW')
		ORDER BY c.ordinal_position`, schema, table)
	if err != nil {
		return nil, nil, "", err
	}
	defer rows.Close()
	columns := []ColumnInfo{}
	known := map[string]bool{}
	tableType := ""
	for rows.Next() {
		var col ColumnInfo
		var refSchema, refTable, refColumn *string
		if err := rows.Scan(&col.Name, &col.Type, &col.Nullable, &col.DefaultValue, &col.IsIdentity, &col.IsGenerated, &tableType, &col.IsPrimaryKey, &col.EnumValues, &refSchema, &refTable, &refColumn); err != nil {
			return nil, nil, "", err
		}
		if refSchema != nil && refTable != nil && refColumn != nil {
			col.References = &ColumnReference{Schema: *refSchema, Table: *refTable, Column: *refColumn}
		}
		col.SourceSchema, col.SourceTable = schema, table
		columns = append(columns, col)
		known[col.Name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, nil, "", err
	}
	if len(columns) == 0 {
		return nil, nil, "", fmt.Errorf("table or view not found")
	}
	return columns, known, tableType, nil
}

func buildDataWhere(filters []dataFilter, known map[string]bool) (string, []any, error) {
	parts := []string{}
	args := []any{}
	for _, filter := range filters {
		if !known[filter.Column] {
			return "", nil, fmt.Errorf("unknown filter column %q", filter.Column)
		}
		col := pgx.Identifier{filter.Column}.Sanitize()
		switch filter.Operator {
		case "is-null":
			parts = append(parts, col+" IS NULL")
		case "not-null":
			parts = append(parts, col+" IS NOT NULL")
		case "eq", "neq", "gt", "gte", "lt", "lte":
			if filter.Value == nil {
				return "", nil, fmt.Errorf("filter value is required")
			}
			args = append(args, *filter.Value)
			op := map[string]string{"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[filter.Operator]
			parts = append(parts, fmt.Sprintf("%s %s $%d", col, op, len(args)))
		case "contains", "starts-with", "ends-with":
			if filter.Value == nil {
				return "", nil, fmt.Errorf("filter value is required")
			}
			value := *filter.Value
			if filter.Operator == "contains" {
				value = "%" + value + "%"
			}
			if filter.Operator == "starts-with" {
				value += "%"
			}
			if filter.Operator == "ends-with" {
				value = "%" + value
			}
			args = append(args, value)
			parts = append(parts, fmt.Sprintf("%s::text ILIKE $%d", col, len(args)))
		default:
			return "", nil, fmt.Errorf("unsupported filter operator %q", filter.Operator)
		}
	}
	if len(parts) == 0 {
		return "", args, nil
	}
	return " WHERE " + strings.Join(parts, " AND "), args, nil
}

func buildDataOrder(sorts []dataSort, known map[string]bool, columns []ColumnInfo) (string, error) {
	parts := []string{}
	sortedColumns := map[string]bool{}
	for _, sort := range sorts {
		if !known[sort.Column] || (sort.Direction != "asc" && sort.Direction != "desc") {
			return "", fmt.Errorf("invalid sort")
		}
		parts = append(parts, pgx.Identifier{sort.Column}.Sanitize()+" "+strings.ToUpper(sort.Direction))
		sortedColumns[sort.Column] = true
	}
	// Primary-key columns break ties after any explicit sort so that pages
	// stay stable across requests: Postgres does not guarantee a consistent
	// order among rows with equal values in the requested sort column(s).
	for _, col := range columns {
		if col.IsPrimaryKey && !sortedColumns[col.Name] {
			parts = append(parts, pgx.Identifier{col.Name}.Sanitize())
		}
	}
	if len(parts) == 0 {
		return "", nil
	}
	return " ORDER BY " + strings.Join(parts, ", "), nil
}

const (
	// countCap is the most rows the bounded count will scan before giving up
	// and reporting "N+". It is also the size a table's planner estimate must
	// reach before that estimate replaces counting altogether.
	countCap = 50_000
	// boundedCountTimeoutMs keeps the count that runs on every table open from
	// stalling the page on a huge, unindexed filter; exactCountTimeoutMs is the
	// budget for the count the user explicitly asks for.
	boundedCountTimeoutMs = 3_000
	exactCountTimeoutMs   = 15_000
)

const (
	countExact      = "exact"
	countEstimated  = "estimated"
	countLowerBound = "lower-bound"
	countUnknown    = "unknown"
	countSkipped    = "skipped"
)

type rowCount struct {
	Total int64
	Kind  string
}

// isStatementTimeout reports whether err is Postgres cancelling a statement
// for exceeding statement_timeout (SQLSTATE 57014, query_canceled).
func isStatementTimeout(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "57014"
}

// countWithTimeout runs a count query inside a transaction so the
// statement_timeout is SET LOCAL — scoped to that transaction and gone once it
// rolls back, never leaking onto the connection's later queries. limit <= 0
// means an unbounded count(*); otherwise at most limit+1 matching rows are
// ever scanned. requestID, if valid, tags the statement so it can be cancelled.
func countWithTimeout(ctx context.Context, conn *pgx.Conn, qualified, where string, args []any, limit int, timeoutMs int, requestID string) (int64, error) {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL statement_timeout = %d", timeoutMs)); err != nil {
		return 0, err
	}
	stmt := "SELECT count(*) FROM " + qualified + where
	if limit > 0 {
		stmt = fmt.Sprintf("SELECT count(*) FROM (SELECT 1 FROM %s%s LIMIT %d) AS capped", qualified, where, limit+1)
	}
	var total int64
	if err := tx.QueryRow(ctx, tagSQL(requestID, stmt), args...).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

// estimatedRowCount reads the planner's own row estimate (pg_class.reltuples)
// for an ordinary or partitioned table — free, but only as fresh as the last
// ANALYZE. ok is false when there's no usable estimate (never analyzed
// reports -1 on PG14+, 0 before that; both are handled by the caller falling
// back to a bounded count).
func estimatedRowCount(ctx context.Context, conn *pgx.Conn, schema, table string) (int64, bool) {
	var estimate int64
	err := conn.QueryRow(ctx, `
		SELECT c.reltuples::bigint
		FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'p')`, schema, table).Scan(&estimate)
	if err != nil || estimate <= 0 {
		return 0, false
	}
	return estimate, true
}

// autoRowCount picks the cheapest count that is still honest about what it is,
// so opening a multi-million-row table never begins with a full count(*):
//   - an unfiltered table whose planner estimate is already large reports that
//     estimate ("estimated") without touching the table;
//   - everything else counts at most countCap rows under a short statement
//     timeout: exact below the cap, "lower-bound" (N+) at it, "unknown" if
//     even that bounded scan timed out (an unindexed filter on a huge table).
func autoRowCount(ctx context.Context, conn *pgx.Conn, schema, table, tableType string, unfiltered bool, qualified, where string, args []any, requestID string) (rowCount, error) {
	if unfiltered && tableType == "BASE TABLE" {
		if estimate, ok := estimatedRowCount(ctx, conn, schema, table); ok && estimate >= countCap {
			return rowCount{Total: estimate, Kind: countEstimated}, nil
		}
	}
	n, err := countWithTimeout(ctx, conn, qualified, where, args, countCap, boundedCountTimeoutMs, requestID)
	if err != nil {
		if isStatementTimeout(err) {
			return rowCount{Kind: countUnknown}, nil
		}
		return rowCount{}, err
	}
	if n > countCap {
		return rowCount{Total: countCap, Kind: countLowerBound}, nil
	}
	return rowCount{Total: n, Kind: countExact}, nil
}

// logTableMutation records one Data-editor mutation to the analytics_events
// audit trail — the same table RunConnectionQuery's frontend caller logs
// query runs into (event_type "query_run"), read back by
// ListConnectionHistory. Best-effort like analytics.LogEvent itself: a
// logging failure never fails the request whose mutation already committed.
func (s *Server) logTableMutation(ctx context.Context, r *http.Request, user *auth.User, eventType string, payload map[string]any) {
	_ = analytics.LogEvent(ctx, s.Pool, bearerToken(r), &user.ID, eventType, payload)
}

func columnNames(columns []ColumnInfo) []string {
	names := make([]string, len(columns))
	for i, c := range columns {
		names[i] = c.Name
	}
	return names
}

// rowMap pairs a RETURNING row's positional values back up with their
// column names, so an audit-log payload reads as {"email": "...", ...}
// rather than a bare positional array.
func rowMap(columns []ColumnInfo, row []*string) map[string]*string {
	m := make(map[string]*string, len(columns))
	for i, c := range columns {
		if i < len(row) {
			m[c.Name] = row[i]
		}
	}
	return m
}

// execReturningRow runs a statement expected to return exactly one row (an
// INSERT ... RETURNING *) and decodes it the same way BrowseTableData
// decodes query results — forcing text format so every value round-trips as
// a generic string. Returns a nil row if the statement affected no rows.
func execReturningRow(ctx context.Context, conn *pgx.Conn, stmt string, args ...any) ([]*string, int64, error) {
	queryArgs := append([]any{pgx.QueryResultFormats{pgx.TextFormatCode}}, args...)
	rows, err := conn.Query(ctx, stmt, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var row []*string
	var count int64
	for rows.Next() {
		raw := rows.RawValues()
		row = make([]*string, len(raw))
		for i, v := range raw {
			if v != nil {
				str := string(v)
				row[i] = &str
			}
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return row, count, nil
}

func (s *Server) withTableConnection(w http.ResponseWriter, r *http.Request, mutate bool, fn func(context.Context, *pgx.Conn, sqlConnFields)) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	engine, fields, err := s.loadTargetConnection(r.Context(), user.ID, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "connection not found")
		return
	}
	if mutate && fields.ReadOnly {
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
	fn(ctx, conn, fields)
}

func (s *Server) BrowseTableData(w http.ResponseWriter, r *http.Request) {
	var req browseTableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Schema == "" || req.Table == "" {
		writeError(w, http.StatusBadRequest, "schema and table are required")
		return
	}
	if req.Page < 0 {
		req.Page = 0
	}
	if req.PageSize <= 0 || req.PageSize > 500 {
		req.PageSize = 100
	}
	s.withTableConnection(w, r, false, func(ctx context.Context, conn *pgx.Conn, _ sqlConnFields) {
		if userID, connID, ok := s.resolveRequestOwner(ctx, r); ok {
			s.recordRequestOwner(ctx, userID, connID, req.RequestID)
		}
		columns, known, tableType, err := tableMetadata(ctx, conn, req.Schema, req.Table)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		where, args, err := buildDataWhere(req.Filters, known)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		qualified := pgx.Identifier{req.Schema, req.Table}.Sanitize()
		count := rowCount{Kind: countSkipped}
		if req.CountMode != "skip" {
			count, err = autoRowCount(ctx, conn, req.Schema, req.Table, tableType, len(req.Filters) == 0, qualified, where, args, req.RequestID)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
		}
		// RawValues returns bytes in the server-selected wire format. Force text
		// for every result column so integers, timestamps, UUIDs, and other
		// binary-capable Postgres types reach the generic frontend as readable
		// strings, matching RunConnectionQuery's contract.
		queryArgs := []any{pgx.QueryResultFormats{pgx.TextFormatCode}}
		queryArgs = append(queryArgs, args...)
		// One row past the page: whether it exists is HasMore, which stays exact
		// even when the total is only an estimate.
		queryArgs = append(queryArgs, req.PageSize+1, req.Page*req.PageSize)
		order, err := buildDataOrder(req.Sorts, known, columns)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		query := fmt.Sprintf("SELECT * FROM %s%s%s LIMIT $%d OFFSET $%d", qualified, where, order, len(args)+1, len(args)+2)
		rows, err := conn.Query(ctx, tagSQL(req.RequestID, query), queryArgs...)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		defer rows.Close()
		data := [][]*string{}
		for rows.Next() {
			raw := rows.RawValues()
			record := make([]*string, len(raw))
			for i, value := range raw {
				if value != nil {
					v := string(value)
					record[i] = &v
				}
			}
			data = append(data, record)
		}
		if err := rows.Err(); err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		hasMore := len(data) > req.PageSize
		if hasMore {
			data = data[:req.PageSize]
		}
		writeJSON(w, http.StatusOK, tableDataResponse{Columns: columns, Rows: data, Total: count.Total, TotalKind: count.Kind, HasMore: hasMore, Page: req.Page, PageSize: req.PageSize})
	})
}

type countTableRequest struct {
	Schema    string       `json:"schema"`
	Table     string       `json:"table"`
	Filters   []dataFilter `json:"filters"`
	RequestID string       `json:"requestId"`
}

// CountTableData is the explicit "count exactly" the Data view offers when the
// row total it opened with is only an estimate or a lower bound. It's its own
// endpoint (rather than a flag on table-data) so the count can run, and be
// cancelled, independently of loading a page — and it reports a timeout as an
// error instead of silently degrading, since the caller asked for exactness.
func (s *Server) CountTableData(w http.ResponseWriter, r *http.Request) {
	var req countTableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Schema == "" || req.Table == "" {
		writeError(w, http.StatusBadRequest, "schema and table are required")
		return
	}
	s.withTableConnection(w, r, false, func(ctx context.Context, conn *pgx.Conn, _ sqlConnFields) {
		if userID, connID, ok := s.resolveRequestOwner(ctx, r); ok {
			s.recordRequestOwner(ctx, userID, connID, req.RequestID)
		}
		_, known, _, err := tableMetadata(ctx, conn, req.Schema, req.Table)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		where, args, err := buildDataWhere(req.Filters, known)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		total, err := countWithTimeout(ctx, conn, pgx.Identifier{req.Schema, req.Table}.Sanitize(), where, args, 0, exactCountTimeoutMs, req.RequestID)
		if err != nil {
			if isStatementTimeout(err) {
				writeError(w, http.StatusGatewayTimeout, "Counting every row took too long. Add a filter to narrow it down.")
				return
			}
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"total": total, "totalKind": countExact})
	})
}

func validateMutation(req tableRowMutation, known map[string]bool, requireKey bool) error {
	if req.Schema == "" || req.Table == "" {
		return fmt.Errorf("schema and table are required")
	}
	for col := range req.Values {
		if !known[col] {
			return fmt.Errorf("unknown column %q", col)
		}
	}
	if requireKey && len(req.Key) == 0 {
		return fmt.Errorf("primary key is required")
	}
	for col := range req.Key {
		if !known[col] {
			return fmt.Errorf("unknown key column %q", col)
		}
	}
	return nil
}

func (s *Server) InsertTableRow(w http.ResponseWriter, r *http.Request) {
	var req tableRowMutation
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	connID := chi.URLParam(r, "id")
	s.withTableConnection(w, r, true, func(ctx context.Context, conn *pgx.Conn, _ sqlConnFields) {
		columns, known, tableType, err := tableMetadata(ctx, conn, req.Schema, req.Table)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if tableType != "BASE TABLE" {
			writeError(w, http.StatusBadRequest, "views are read-only")
			return
		}
		if err := validateMutation(req, known, false); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		// RETURNING * hands back the row exactly as the database committed
		// it — including generated/identity defaults the request never sent
		// a value for — so both the audit log and the frontend's Undo can
		// address the new row by its real primary key, not a guessed one.
		var stmt string
		var args []any
		if len(req.Values) == 0 {
			stmt = "INSERT INTO " + pgx.Identifier{req.Schema, req.Table}.Sanitize() + " DEFAULT VALUES RETURNING *"
		} else {
			cols, placeholders := []string{}, []string{}
			for col, value := range req.Values {
				cols = append(cols, pgx.Identifier{col}.Sanitize())
				args = append(args, value)
				placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
			}
			stmt = fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) RETURNING *", pgx.Identifier{req.Schema, req.Table}.Sanitize(), strings.Join(cols, ", "), strings.Join(placeholders, ", "))
		}
		row, count, err := execReturningRow(ctx, conn, stmt, args...)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		s.logTableMutation(ctx, r, user, "row_insert", map[string]any{
			"connectionId": connID, "schema": req.Schema, "table": req.Table, "row": rowMap(columns, row), "rowsAffected": count,
		})
		writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "rowsAffected": count, "columns": columnNames(columns), "row": row})
	})
}

func mutationWhere(key map[string]*string, known map[string]bool, start int) (string, []any, error) {
	parts, args := []string{}, []any{}
	for col, value := range key {
		if !known[col] {
			return "", nil, fmt.Errorf("unknown key column %q", col)
		}
		name := pgx.Identifier{col}.Sanitize()
		if value == nil {
			parts = append(parts, name+" IS NULL")
		} else {
			args = append(args, value)
			parts = append(parts, fmt.Sprintf("%s = $%d", name, start+len(args)))
		}
	}
	if len(parts) == 0 {
		return "", nil, fmt.Errorf("primary key is required")
	}
	return " WHERE " + strings.Join(parts, " AND "), args, nil
}

func validatePrimaryKey(key map[string]*string, columns []ColumnInfo) error {
	pkCount := 0
	for _, col := range columns {
		if !col.IsPrimaryKey {
			continue
		}
		pkCount++
		if _, ok := key[col.Name]; !ok {
			return fmt.Errorf("all primary-key columns are required")
		}
	}
	if pkCount == 0 || len(key) != pkCount {
		return fmt.Errorf("row key must contain exactly the primary-key columns")
	}
	return nil
}

func (s *Server) UpdateTableRow(w http.ResponseWriter, r *http.Request) {
	var req tableRowMutation
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	connID := chi.URLParam(r, "id")
	s.withTableConnection(w, r, true, func(ctx context.Context, conn *pgx.Conn, _ sqlConnFields) {
		columns, known, tableType, err := tableMetadata(ctx, conn, req.Schema, req.Table)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if tableType != "BASE TABLE" {
			writeError(w, http.StatusBadRequest, "views are read-only")
			return
		}
		if err := validateMutation(req, known, true); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if len(req.Values) == 0 {
			writeError(w, http.StatusBadRequest, "at least one value is required")
			return
		}
		if err := validatePrimaryKey(req.Key, columns); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		sets, args := []string{}, []any{}
		for col, value := range req.Values {
			args = append(args, value)
			sets = append(sets, fmt.Sprintf("%s = $%d", pgx.Identifier{col}.Sanitize(), len(args)))
		}
		where, keyArgs, err := mutationWhere(req.Key, known, len(args))
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		args = append(args, keyArgs...)
		stmt := fmt.Sprintf("UPDATE %s SET %s%s", pgx.Identifier{req.Schema, req.Table}.Sanitize(), strings.Join(sets, ", "), where)
		tag, err := conn.Exec(ctx, stmt, args...)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		s.logTableMutation(ctx, r, user, "row_update", map[string]any{
			"connectionId": connID, "schema": req.Schema, "table": req.Table, "key": req.Key, "values": req.Values, "rowsAffected": tag.RowsAffected(),
		})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "rowsAffected": tag.RowsAffected()})
	})
}

func (s *Server) DeleteTableRow(w http.ResponseWriter, r *http.Request) {
	var req tableRowMutation
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	connID := chi.URLParam(r, "id")
	s.withTableConnection(w, r, true, func(ctx context.Context, conn *pgx.Conn, _ sqlConnFields) {
		columns, known, tableType, err := tableMetadata(ctx, conn, req.Schema, req.Table)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if tableType != "BASE TABLE" {
			writeError(w, http.StatusBadRequest, "views are read-only")
			return
		}
		if err := validateMutation(req, known, true); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := validatePrimaryKey(req.Key, columns); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		where, args, err := mutationWhere(req.Key, known, 0)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		tag, err := conn.Exec(ctx, "DELETE FROM "+pgx.Identifier{req.Schema, req.Table}.Sanitize()+where, args...)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		s.logTableMutation(ctx, r, user, "row_delete", map[string]any{
			"connectionId": connID, "schema": req.Schema, "table": req.Table, "key": req.Key, "rowsAffected": tag.RowsAffected(),
		})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "rowsAffected": tag.RowsAffected()})
	})
}

func (s *Server) BulkDeleteTableRows(w http.ResponseWriter, r *http.Request) {
	var req bulkDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Schema == "" || req.Table == "" || len(req.Keys) == 0 || len(req.Keys) > 500 {
		writeError(w, http.StatusBadRequest, "schema, table, and 1-500 row keys are required")
		return
	}
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	connID := chi.URLParam(r, "id")
	s.withTableConnection(w, r, true, func(ctx context.Context, conn *pgx.Conn, _ sqlConnFields) {
		columns, known, tableType, err := tableMetadata(ctx, conn, req.Schema, req.Table)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if tableType != "BASE TABLE" {
			writeError(w, http.StatusBadRequest, "views are read-only")
			return
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		defer tx.Rollback(ctx)
		var affected int64
		for _, key := range req.Keys {
			if err := validatePrimaryKey(key, columns); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			where, args, err := mutationWhere(key, known, 0)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			tag, err := tx.Exec(ctx, "DELETE FROM "+pgx.Identifier{req.Schema, req.Table}.Sanitize()+where, args...)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			affected += tag.RowsAffected()
		}
		if err := tx.Commit(ctx); err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		s.logTableMutation(ctx, r, user, "bulk_row_delete", map[string]any{
			"connectionId": connID, "schema": req.Schema, "table": req.Table, "keys": req.Keys, "rowsAffected": affected,
		})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "rowsAffected": affected})
	})
}

// ExecuteSchemaChange is the guarded execution path used by the visual schema
// tools. The UI shows the exact SQL and asks for confirmation first; this
// endpoint additionally enforces read-only connections and accepts only one
// CREATE/ALTER statement, keeping destructive DROP/TRUNCATE operations in the
// full query workbench where they remain explicit.
func (s *Server) ExecuteSchemaChange(w http.ResponseWriter, r *http.Request) {
	var req schemaChangeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	sql, err := validateSchemaChangeSQL(req.SQL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	connID := chi.URLParam(r, "id")
	s.withTableConnection(w, r, true, func(ctx context.Context, conn *pgx.Conn, _ sqlConnFields) {
		if _, err := conn.Exec(ctx, sql); err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		s.logTableMutation(ctx, r, user, "schema_change", map[string]any{"connectionId": connID, "sql": sql})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
}

func validateSchemaChangeSQL(input string) (string, error) {
	sql := strings.TrimSpace(input)
	sql = strings.TrimSpace(strings.TrimSuffix(sql, ";"))
	upper := strings.ToUpper(sql)
	normalized := strings.Join(strings.Fields(upper), " ")
	alterAddOnly := strings.HasPrefix(normalized, "ALTER TABLE ") &&
		(strings.Contains(normalized, " ADD COLUMN ") || strings.Contains(normalized, " ADD CONSTRAINT ")) &&
		!strings.Contains(normalized, " DROP ") && !strings.Contains(normalized, " RENAME ")
	allowed := strings.HasPrefix(normalized, "CREATE TABLE ") || alterAddOnly ||
		strings.HasPrefix(normalized, "CREATE INDEX ") || strings.HasPrefix(normalized, "CREATE UNIQUE INDEX ")
	if sql == "" || strings.Contains(sql, ";") || !allowed || strings.Contains(sql, "--") || strings.Contains(sql, "/*") {
		return "", fmt.Errorf("only one CREATE TABLE, ALTER TABLE, or CREATE INDEX statement is allowed")
	}
	return sql, nil
}
