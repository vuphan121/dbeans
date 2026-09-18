package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

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
}

type dataSort struct {
	Column    string `json:"column"`
	Direction string `json:"direction"`
}

type tableDataResponse struct {
	Columns  []ColumnInfo `json:"columns"`
	Rows     [][]*string  `json:"rows"`
	Total    int64        `json:"total"`
	Page     int          `json:"page"`
	PageSize int          `json:"pageSize"`
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
		columns, known, _, err := tableMetadata(ctx, conn, req.Schema, req.Table)
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
		var total int64
		if err := conn.QueryRow(ctx, "SELECT count(*) FROM "+qualified+where, args...).Scan(&total); err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		// RawValues returns bytes in the server-selected wire format. Force text
		// for every result column so integers, timestamps, UUIDs, and other
		// binary-capable Postgres types reach the generic frontend as readable
		// strings, matching RunConnectionQuery's contract.
		queryArgs := []any{pgx.QueryResultFormats{pgx.TextFormatCode}}
		queryArgs = append(queryArgs, args...)
		queryArgs = append(queryArgs, req.PageSize, req.Page*req.PageSize)
		order, err := buildDataOrder(req.Sorts, known, columns)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		query := fmt.Sprintf("SELECT * FROM %s%s%s LIMIT $%d OFFSET $%d", qualified, where, order, len(args)+1, len(args)+2)
		rows, err := conn.Query(ctx, query, queryArgs...)
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
		writeJSON(w, http.StatusOK, tableDataResponse{Columns: columns, Rows: data, Total: total, Page: req.Page, PageSize: req.PageSize})
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
	s.withTableConnection(w, r, true, func(ctx context.Context, conn *pgx.Conn, _ sqlConnFields) {
		_, known, tableType, err := tableMetadata(ctx, conn, req.Schema, req.Table)
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
		if len(req.Values) == 0 {
			tag, err := conn.Exec(ctx, "INSERT INTO "+pgx.Identifier{req.Schema, req.Table}.Sanitize()+" DEFAULT VALUES")
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "rowsAffected": tag.RowsAffected()})
			return
		}
		cols, placeholders, args := []string{}, []string{}, []any{}
		for col, value := range req.Values {
			cols = append(cols, pgx.Identifier{col}.Sanitize())
			args = append(args, value)
			placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
		}
		stmt := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", pgx.Identifier{req.Schema, req.Table}.Sanitize(), strings.Join(cols, ", "), strings.Join(placeholders, ", "))
		tag, err := conn.Exec(ctx, stmt, args...)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "rowsAffected": tag.RowsAffected()})
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
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "rowsAffected": tag.RowsAffected()})
	})
}

func (s *Server) DeleteTableRow(w http.ResponseWriter, r *http.Request) {
	var req tableRowMutation
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
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
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "rowsAffected": tag.RowsAffected()})
	})
}

func (s *Server) BulkDeleteTableRows(w http.ResponseWriter, r *http.Request) {
	var req bulkDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Schema == "" || req.Table == "" || len(req.Keys) == 0 || len(req.Keys) > 500 {
		writeError(w, http.StatusBadRequest, "schema, table, and 1-500 row keys are required")
		return
	}
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
	s.withTableConnection(w, r, true, func(ctx context.Context, conn *pgx.Conn, _ sqlConnFields) {
		if _, err := conn.Exec(ctx, sql); err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
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
