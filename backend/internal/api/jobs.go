package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/robfig/cron/v3"

	"dbeans/backend/internal/auth"
)

var cronParser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)

const (
	maxRetryLimit        = 5
	maxRetryDelaySeconds = 300
)

type Job struct {
	ID                string          `json:"id"`
	ConnectionID      string          `json:"connectionId"`
	Name              string          `json:"name"`
	JobType           string          `json:"jobType"`
	SQL               string          `json:"sql"`
	Config            json.RawMessage `json:"config"`
	CronExpr          string          `json:"cronExpr"`
	Enabled           bool            `json:"enabled"`
	DependsOn         []string        `json:"dependsOn"`
	RetryLimit        int             `json:"retryLimit"`
	RetryDelaySeconds int             `json:"retryDelaySeconds"`
	CheckMode         string          `json:"checkMode"` // "none" | "fail_if_no_rows" | "fail_if_rows"
	Layout            json.RawMessage `json:"layout"`
	NextRunAt         *time.Time      `json:"nextRunAt,omitempty"`
	LastRunAt         *time.Time      `json:"lastRunAt,omitempty"`
	LastStatus        string          `json:"lastStatus"`
}

func scanJob(row interface {
	Scan(dest ...any) error
}) (Job, error) {
	var j Job
	var dependsOnJSON []byte
	err := row.Scan(
		&j.ID, &j.ConnectionID, &j.Name, &j.JobType, &j.SQL, &j.Config, &j.CronExpr, &j.Enabled,
		&dependsOnJSON, &j.RetryLimit, &j.RetryDelaySeconds, &j.CheckMode,
		&j.Layout, &j.NextRunAt, &j.LastRunAt, &j.LastStatus,
	)
	if err != nil {
		return Job{}, err
	}
	j.DependsOn = []string{}
	_ = json.Unmarshal(dependsOnJSON, &j.DependsOn)
	return j, nil
}

const jobColumns = `id, COALESCE(connection_id, ''), name, job_type, COALESCE(sql, ''), config, cron_expr, enabled, depends_on, retry_limit, retry_delay_seconds, check_mode, layout, next_run_at, last_run_at, last_status`

func (s *Server) ListJobs(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	rows, err := s.Pool.Query(r.Context(), `SELECT `+jobColumns+` FROM jobs WHERE user_id = $1 ORDER BY created_at ASC`, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list jobs")
		return
	}
	defer rows.Close()

	jobs := []Job{}
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read jobs")
			return
		}
		jobs = append(jobs, j)
	}
	writeJSON(w, http.StatusOK, jobs)
}

type jobRequest struct {
	ID                string          `json:"id"`
	ConnectionID      string          `json:"connectionId"`
	Name              string          `json:"name"`
	JobType           string          `json:"jobType"`
	SQL               string          `json:"sql"`
	Config            json.RawMessage `json:"config"`
	CronExpr          string          `json:"cronExpr"`
	Enabled           *bool           `json:"enabled"`
	DependsOn         []string        `json:"dependsOn"`
	RetryLimit        int             `json:"retryLimit"`
	RetryDelaySeconds int             `json:"retryDelaySeconds"`
	CheckMode         string          `json:"checkMode"`
	Layout            json.RawMessage `json:"layout"`
}

func clampInt(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

type httpRequestJobConfig struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
	// FailOnNonEmptyArrayField, if set, additionally fails an otherwise-2xx
	// response when this top-level JSON field in the response body is an
	// array with at least one element — e.g. a batch endpoint that returns
	// 200 with a body like {"failed": [...]} to report partial failures
	// alongside its overall success.
	FailOnNonEmptyArrayField string `json:"failOnNonEmptyArrayField,omitempty"`
	// TimeoutSeconds overrides the default request timeout (queryTimeout) for
	// this job. Some webhooks — e.g. one fronted by a cold-starting free-tier
	// host — legitimately need longer than the default query timeout allows.
	// 0 (the zero value, and every pre-existing job's config) means "use the
	// default".
	TimeoutSeconds int `json:"timeoutSeconds,omitempty"`
}

const maxHTTPRequestTimeoutSeconds = 280

func normalizeJobRequest(req *jobRequest) error {
	if req.JobType == "" {
		req.JobType = "query"
	}
	switch req.JobType {
	case "query":
		if strings.TrimSpace(req.ConnectionID) == "" || strings.TrimSpace(req.SQL) == "" {
			return errors.New("connectionId and sql are required for query jobs")
		}
		if len(req.Config) == 0 {
			req.Config = json.RawMessage(`{}`)
		}
	case "http_request":
		var config httpRequestJobConfig
		if err := json.Unmarshal(req.Config, &config); err != nil {
			return errors.New("invalid HTTP request configuration")
		}
		config.URL = strings.TrimSpace(config.URL)
		parsed, err := url.Parse(config.URL)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return errors.New("HTTP request URL must be an absolute http or https URL")
		}
		config.Method = strings.ToUpper(strings.TrimSpace(config.Method))
		if config.Method == "" {
			config.Method = http.MethodPost
		}
		switch config.Method {
		case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		default:
			return errors.New("HTTP request method must be GET, POST, PUT, PATCH, or DELETE")
		}
		if config.Headers == nil {
			config.Headers = map[string]string{}
		}
		config.FailOnNonEmptyArrayField = strings.TrimSpace(config.FailOnNonEmptyArrayField)
		if config.TimeoutSeconds > 0 {
			config.TimeoutSeconds = clampInt(config.TimeoutSeconds, 5, maxHTTPRequestTimeoutSeconds)
		}
		req.Config, _ = json.Marshal(config)
		req.ConnectionID = ""
		req.SQL = ""
		req.CheckMode = "none"
	default:
		return fmt.Errorf("unsupported job type %q", req.JobType)
	}
	return nil
}

func (s *Server) CreateJob(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var req jobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" || strings.TrimSpace(req.Name) == "" {
		writeError(w, http.StatusBadRequest, "id and name are required")
		return
	}
	if err := normalizeJobRequest(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	schedule, err := cronParser.Parse(req.CronExpr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid cron expression: "+err.Error())
		return
	}

	if req.JobType == "query" {
		var connOwner string
		if err := s.Pool.QueryRow(r.Context(), `SELECT id FROM connections WHERE id = $1 AND user_id = $2`, req.ConnectionID, user.ID).Scan(&connOwner); err != nil {
			writeError(w, http.StatusBadRequest, "connection not found")
			return
		}
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	if req.DependsOn == nil {
		req.DependsOn = []string{}
	}
	dependsOnJSON, _ := json.Marshal(req.DependsOn)
	if req.Layout == nil {
		req.Layout = json.RawMessage(`{}`)
	}
	checkMode := req.CheckMode
	if checkMode == "" {
		checkMode = "none"
	}
	retryLimit := clampInt(req.RetryLimit, 0, maxRetryLimit)
	retryDelay := clampInt(req.RetryDelaySeconds, 0, maxRetryDelaySeconds)
	// Anchored to UTC regardless of the server process's own OS timezone —
	// otherwise "0 17 * * *" means something different running locally
	// (wherever the dev machine's TZ is set) than it does on Vercel (UTC),
	// silently corrupting next_run_at if a job is ever created/edited from
	// a non-UTC host.
	nextRunAt := schedule.Next(time.Now().UTC())

	_, err = s.Pool.Exec(r.Context(), `
		INSERT INTO jobs (id, user_id, connection_id, name, job_type, sql, config, cron_expr, enabled, depends_on, retry_limit, retry_delay_seconds, check_mode, layout, next_run_at)
		VALUES ($1, $2, NULLIF($3, ''), $4, $5, NULLIF($6, ''), $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
		req.ID, user.ID, req.ConnectionID, req.Name, req.JobType, req.SQL, req.Config, req.CronExpr, enabled, dependsOnJSON, retryLimit, retryDelay, checkMode, req.Layout, nextRunAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save job")
		return
	}

	writeJSON(w, http.StatusCreated, Job{
		ID: req.ID, ConnectionID: req.ConnectionID, Name: req.Name, JobType: req.JobType, SQL: req.SQL, Config: req.Config, CronExpr: req.CronExpr,
		Enabled: enabled, DependsOn: req.DependsOn, RetryLimit: retryLimit, RetryDelaySeconds: retryDelay,
		CheckMode: checkMode, Layout: req.Layout, NextRunAt: &nextRunAt, LastStatus: "never_run",
	})
}

func (s *Server) UpdateJob(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id := chi.URLParam(r, "id")

	var req jobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.CronExpr) == "" {
		writeError(w, http.StatusBadRequest, "name and cronExpr are required")
		return
	}
	if err := normalizeJobRequest(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	schedule, err := cronParser.Parse(req.CronExpr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid cron expression: "+err.Error())
		return
	}
	if req.JobType == "query" {
		var connOwner string
		if err := s.Pool.QueryRow(r.Context(), `SELECT id FROM connections WHERE id = $1 AND user_id = $2`, req.ConnectionID, user.ID).Scan(&connOwner); err != nil {
			writeError(w, http.StatusBadRequest, "connection not found")
			return
		}
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	if req.DependsOn == nil {
		req.DependsOn = []string{}
	}
	dependsOnJSON, _ := json.Marshal(req.DependsOn)
	checkMode := req.CheckMode
	if checkMode == "" {
		checkMode = "none"
	}
	retryLimit := clampInt(req.RetryLimit, 0, maxRetryLimit)
	retryDelay := clampInt(req.RetryDelaySeconds, 0, maxRetryDelaySeconds)
	nextRunAt := schedule.Next(time.Now().UTC()) // see CreateJob's comment on why .UTC() matters here

	// This is a full-body update (the edit form always resubmits the whole
	// job, layout included) — UpdateJobLayout below handles layout-only
	// drag/resize patches from the canvas without needing the rest of the body.
	var layout json.RawMessage
	if req.Layout != nil {
		layout = req.Layout
	} else {
		if err := s.Pool.QueryRow(r.Context(), `SELECT layout FROM jobs WHERE id = $1 AND user_id = $2`, id, user.ID).Scan(&layout); err != nil {
			writeError(w, http.StatusNotFound, "job not found")
			return
		}
	}

	tag, err := s.Pool.Exec(r.Context(), `
		UPDATE jobs SET connection_id = NULLIF($1, ''), name = $2, job_type = $3, sql = NULLIF($4, ''), config = $5,
			cron_expr = $6, enabled = $7, depends_on = $8, retry_limit = $9, retry_delay_seconds = $10,
			check_mode = $11, layout = $12, next_run_at = $13
		WHERE id = $14 AND user_id = $15`,
		req.ConnectionID, req.Name, req.JobType, req.SQL, req.Config, req.CronExpr, enabled, dependsOnJSON,
		retryLimit, retryDelay, checkMode, layout, nextRunAt, id, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update job")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// UpdateJobLayout is a lightweight patch used for canvas drag/resize, mirroring
// UpdateConnection's layout-only PATCH so the jobs board doesn't need to
// resend the full job body on every drag.
func (s *Server) UpdateJobLayout(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	var req struct {
		Layout json.RawMessage `json:"layout"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Layout == nil {
		writeError(w, http.StatusBadRequest, "layout is required")
		return
	}
	if _, err := s.Pool.Exec(r.Context(), `UPDATE jobs SET layout = $1 WHERE id = $2 AND user_id = $3`, req.Layout, id, user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update job layout")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) DeleteJob(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	if _, err := s.Pool.Exec(r.Context(), `DELETE FROM jobs WHERE id = $1 AND user_id = $2`, id, user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete job")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type JobRun struct {
	ID           int64      `json:"id"`
	JobID        string     `json:"jobId"`
	Status       string     `json:"status"`
	Attempts     int        `json:"attempts"`
	RowsAffected *int       `json:"rowsAffected,omitempty"`
	Error        *string    `json:"error,omitempty"`
	TriggeredBy  string     `json:"triggeredBy"` // "tick" | "manual" | "backfill"
	RunDate      string     `json:"runDate"`     // "2006-01-02" — the logical date this run represents
	StartedAt    time.Time  `json:"startedAt"`
	FinishedAt   *time.Time `json:"finishedAt,omitempty"`
	DurationMs   *int64     `json:"durationMs,omitempty"`
}

func (s *Server) ListJobRuns(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id := chi.URLParam(r, "id")

	var owner string
	if err := s.Pool.QueryRow(r.Context(), `SELECT id FROM jobs WHERE id = $1 AND user_id = $2`, id, user.ID).Scan(&owner); err != nil {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}

	rows, err := s.Pool.Query(r.Context(), `
		SELECT id, job_id, status, attempts, rows_affected, error, triggered_by, run_date, started_at, finished_at, duration_ms
		FROM job_runs WHERE job_id = $1 ORDER BY started_at DESC LIMIT 50`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list job runs")
		return
	}
	defer rows.Close()

	runs := []JobRun{}
	for rows.Next() {
		var jr JobRun
		var runDate time.Time
		if err := rows.Scan(&jr.ID, &jr.JobID, &jr.Status, &jr.Attempts, &jr.RowsAffected, &jr.Error, &jr.TriggeredBy, &runDate, &jr.StartedAt, &jr.FinishedAt, &jr.DurationMs); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read job runs")
			return
		}
		jr.RunDate = runDate.Format("2006-01-02")
		runs = append(runs, jr)
	}
	writeJSON(w, http.StatusOK, runs)
}

// dateOnlyLayout is used for both parsing the backfill request's date and
// formatting run_date in responses — kept as one constant so the two never
// drift apart.
const dateOnlyLayout = "2006-01-02"

// JobRunCalendarDay summarizes every run recorded for one logical date, for
// rendering an Airflow/Dagster-style calendar of which dates succeeded,
// failed, or haven't run at all.
type JobRunCalendarDay struct {
	Date     string `json:"date"`
	Status   string `json:"status"` // latest run's status for that date
	RunCount int    `json:"runCount"`
}

// JobRunCalendar returns one summary row per distinct run_date over the
// requested window (default 60 days), so the frontend doesn't need to fetch
// and group potentially thousands of individual runs for a frequently
// scheduled job just to render a calendar.
func (s *Server) JobRunCalendar(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id := chi.URLParam(r, "id")

	var owner string
	if err := s.Pool.QueryRow(r.Context(), `SELECT id FROM jobs WHERE id = $1 AND user_id = $2`, id, user.ID).Scan(&owner); err != nil {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}

	days := 60
	if d := r.URL.Query().Get("days"); d != "" {
		if n, err := strconv.Atoi(d); err == nil {
			days = clampInt(n, 1, 365)
		}
	}
	since := time.Now().UTC().AddDate(0, 0, -days)

	rows, err := s.Pool.Query(r.Context(), `
		SELECT run_date, (array_agg(status ORDER BY started_at DESC))[1] AS latest_status, count(*)
		FROM job_runs
		WHERE job_id = $1 AND run_date >= $2
		GROUP BY run_date
		ORDER BY run_date`, id, since)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load run calendar")
		return
	}
	defer rows.Close()

	results := []JobRunCalendarDay{}
	for rows.Next() {
		var runDate time.Time
		var day JobRunCalendarDay
		if err := rows.Scan(&runDate, &day.Status, &day.RunCount); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read run calendar")
			return
		}
		day.Date = runDate.Format(dateOnlyLayout)
		results = append(results, day)
	}
	writeJSON(w, http.StatusOK, results)
}

type runJobNowRequest struct {
	// Date, if given, backfills the job for that logical date instead of
	// today — {{date}} etc. in the SQL resolve to this instead of "now".
	Date string `json:"date,omitempty"`
	// Downstream mirrors Airflow's "Downstream" clear option: also (re)run
	// every job that depends on this one, and transitively theirs, instead
	// of just this job in isolation. Stops cascading past any job that
	// doesn't succeed, since its own downstream jobs would just report
	// "blocked" anyway.
	Downstream bool `json:"downstream,omitempty"`
}

// RunJobNow executes a job immediately, outside its schedule — used by the
// "Run now" and "Backfill" actions in the UI (an empty/omitted body runs for
// today; a "date" backfills that specific date instead). Still goes through
// the same dependency/retry/check pipeline as a scheduled tick. With
// "downstream" set, cascades through every job that (transitively) depends
// on this one, in dependency order, stopping a branch as soon as something
// in it doesn't succeed.
func (s *Server) RunJobNow(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id := chi.URLParam(r, "id")

	var j Job
	row := s.Pool.QueryRow(r.Context(), `SELECT `+jobColumns+` FROM jobs WHERE id = $1 AND user_id = $2`, id, user.ID)
	j, err = scanJob(row)
	if err != nil {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}

	var req runJobNowRequest
	_ = json.NewDecoder(r.Body).Decode(&req) // empty body is valid — plain "run now"

	runDate := time.Now().UTC()
	triggeredBy := "manual"
	if req.Date != "" {
		parsed, err := time.Parse(dateOnlyLayout, req.Date)
		if err != nil {
			writeError(w, http.StatusBadRequest, "date must be YYYY-MM-DD")
			return
		}
		runDate = parsed
		triggeredBy = "backfill"
	}

	if !req.Downstream {
		run := s.executeJob(r.Context(), user.ID, j, triggeredBy, runDate)
		writeJSON(w, http.StatusOK, run)
		return
	}

	allJobs, err := s.loadUserJobs(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load jobs")
		return
	}
	runs := s.runJobDownstream(r.Context(), user.ID, j, triggeredBy, runDate, allJobs, map[string]bool{})
	writeJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

// executeJob runs one job through dependency checking, retries, and the
// post-run check, records a job_runs row, and updates the job's schedule
// bookkeeping. Shared by the tick endpoint and "Run now"/"Backfill" actions.
// runDate is the logical date {{date}} etc. resolve to — "now" for a normal
// run, or a past/future date for a backfill.
func (s *Server) executeJob(ctx context.Context, userID int64, j Job, triggeredBy string, runDate time.Time) JobRun {
	started := time.Now()
	run := JobRun{JobID: j.ID, TriggeredBy: triggeredBy, RunDate: runDate.Format(dateOnlyLayout), StartedAt: started, Attempts: 0}

	blocked := false
	for _, depID := range j.DependsOn {
		var lastStatus string
		err := s.Pool.QueryRow(ctx, `SELECT last_status FROM jobs WHERE id = $1 AND user_id = $2`, depID, userID).Scan(&lastStatus)
		if err != nil || lastStatus != "success" {
			blocked = true
			break
		}
	}

	if blocked {
		run.Status = "blocked"
		errMsg := "a dependency job has not succeeded yet"
		run.Error = &errMsg
	} else {
		maxAttempts := j.RetryLimit + 1
		var lastErr error
		for attempt := 1; attempt <= maxAttempts; attempt++ {
			run.Attempts = attempt
			rowCount, execErr := s.executeJobAction(ctx, userID, j, runDate)
			if execErr == nil {
				if j.CheckMode == "fail_if_no_rows" && rowCount == 0 {
					execErr = errCheckFailed("check failed: expected at least one row, got 0")
				} else if j.CheckMode == "fail_if_rows" && rowCount > 0 {
					execErr = errCheckFailed("check failed: expected no rows, got " + strconv.Itoa(rowCount))
				}
			}
			if execErr == nil {
				run.Status = "success"
				run.RowsAffected = &rowCount
				lastErr = nil
				break
			}
			lastErr = execErr
			if attempt < maxAttempts && j.RetryDelaySeconds > 0 {
				select {
				case <-time.After(time.Duration(j.RetryDelaySeconds) * time.Second):
				case <-ctx.Done():
					attempt = maxAttempts
				}
			}
		}
		if lastErr != nil {
			run.Status = "failed"
			msg := lastErr.Error()
			run.Error = &msg
		}
	}

	finished := time.Now()
	run.FinishedAt = &finished
	durationMs := finished.Sub(started).Milliseconds()
	run.DurationMs = &durationMs

	schedule, scheduleErr := cronParser.Parse(j.CronExpr)
	var nextRunAt *time.Time
	if scheduleErr == nil {
		next := schedule.Next(finished.UTC()) // see CreateJob's comment on why .UTC() matters here
		nextRunAt = &next
	}

	err := s.Pool.QueryRow(ctx, `
		INSERT INTO job_runs (job_id, status, attempts, rows_affected, error, triggered_by, run_date, started_at, finished_at, duration_ms)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
		run.JobID, run.Status, run.Attempts, run.RowsAffected, run.Error, run.TriggeredBy, runDate, run.StartedAt, run.FinishedAt, run.DurationMs,
	).Scan(&run.ID)
	if err != nil {
		run.Error = ptrString("run executed but failed to record history: " + err.Error())
	}

	_, _ = s.Pool.Exec(ctx, `UPDATE jobs SET last_run_at = $1, last_status = $2, next_run_at = $3 WHERE id = $4`,
		finished, run.Status, nextRunAt, j.ID)

	return run
}

// loadUserJobs fetches every job owned by a user — used by the downstream
// cascade below to find dependents without a query per level.
func (s *Server) loadUserJobs(ctx context.Context, userID int64) ([]Job, error) {
	rows, err := s.Pool.Query(ctx, `SELECT `+jobColumns+` FROM jobs WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	jobs := []Job{}
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, j)
	}
	return jobs, rows.Err()
}

// runJobDownstream runs job, then — only if it succeeded — every other job
// that lists it in dependsOn, recursively. visited guards against a cycle
// (dependsOn isn't validated to be acyclic) sending this into a loop, and
// against a diamond dependency (two branches sharing a downstream job)
// running that shared job twice.
func (s *Server) runJobDownstream(
	ctx context.Context, userID int64, job Job, triggeredBy string, runDate time.Time,
	allJobs []Job, visited map[string]bool,
) []JobRun {
	if visited[job.ID] {
		return nil
	}
	visited[job.ID] = true

	run := s.executeJob(ctx, userID, job, triggeredBy, runDate)
	runs := []JobRun{run}
	if run.Status != "success" {
		return runs
	}

	for _, candidate := range allJobs {
		dependsOnThis := false
		for _, depID := range candidate.DependsOn {
			if depID == job.ID {
				dependsOnThis = true
				break
			}
		}
		if dependsOnThis {
			runs = append(runs, s.runJobDownstream(ctx, userID, candidate, triggeredBy, runDate, allJobs, visited)...)
		}
	}
	return runs
}

// renderJobTemplate substitutes Jinja-style {{ placeholder }} date variables
// in a job's SQL before it runs, so e.g. a nightly report job can write
// `where day = '{{date}}'` or `where day = '{{date-1}}'` (yesterday, or
// '{{date+7}}' for a week out) instead of a hardcoded date. Substitution
// happens right before execution (both scheduled ticks and manual "Run now"
// go through here), always in UTC to match the rest of the backend.
var jobTemplateVarPattern = regexp.MustCompile(`\{\{\s*(\w+)\s*([+-]\s*\d+)?\s*\}\}`)

func renderJobTemplate(sql string, now time.Time) string {
	now = now.UTC()
	return jobTemplateVarPattern.ReplaceAllStringFunc(sql, func(match string) string {
		groups := jobTemplateVarPattern.FindStringSubmatch(match)
		name := strings.ToLower(groups[1])
		offsetDays := 0
		if offsetStr := strings.ReplaceAll(groups[2], " ", ""); offsetStr != "" {
			if n, err := strconv.Atoi(offsetStr); err == nil {
				offsetDays = n
			}
		}
		t := now.AddDate(0, 0, offsetDays)
		switch name {
		case "date":
			return t.Format("2006-01-02")
		case "datetime":
			return t.Format("2006-01-02 15:04:05")
		default:
			return match
		}
	})
}

func (s *Server) executeJobAction(ctx context.Context, userID int64, j Job, runDate time.Time) (int, error) {
	switch j.JobType {
	case "", "query":
		return s.executeJobQuery(ctx, userID, j, runDate)
	case "http_request":
		return 0, executeHTTPRequestJob(ctx, j.Config, runDate)
	default:
		return 0, fmt.Errorf("unsupported job type %q", j.JobType)
	}
}

func (s *Server) executeJobQuery(ctx context.Context, userID int64, j Job, runDate time.Time) (int, error) {
	engine, fields, err := s.loadTargetConnection(ctx, userID, j.ConnectionID)
	if err != nil {
		return 0, err
	}
	conn, err := s.connectTarget(ctx, engine, fields)
	if err != nil {
		return 0, err
	}
	defer conn.Close(ctx)

	runCtx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	rows, err := conn.Query(runCtx, renderJobTemplate(j.SQL, runDate))
	if err != nil {
		return 0, err
	}
	rowCount := 0
	for rows.Next() {
		rowCount++
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	tag := rows.CommandTag()
	if len(rows.FieldDescriptions()) == 0 {
		rowCount = int(tag.RowsAffected())
	}
	return rowCount, nil
}

func executeHTTPRequestJob(ctx context.Context, rawConfig json.RawMessage, runDate time.Time) error {
	var config httpRequestJobConfig
	if err := json.Unmarshal(rawConfig, &config); err != nil {
		return fmt.Errorf("invalid HTTP request configuration: %w", err)
	}
	method := strings.ToUpper(strings.TrimSpace(config.Method))
	if method == "" {
		method = http.MethodPost
	}
	timeout := queryTimeout
	if config.TimeoutSeconds > 0 {
		timeout = time.Duration(config.TimeoutSeconds) * time.Second
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(
		runCtx,
		method,
		renderJobTemplate(config.URL, runDate),
		strings.NewReader(renderJobTemplate(config.Body, runDate)),
	)
	if err != nil {
		return err
	}
	for name, value := range config.Headers {
		req.Header.Set(name, renderJobTemplate(value, runDate))
	}
	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	// The response is deliberately not data for the job, beyond the optional
	// array-field check below. Read a bounded amount so it's available for
	// that check, then discard the rest so normal keep-alive connections can
	// still be reused.
	const maxInspectBytes = 64 * 1024
	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, maxInspectBytes))
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP request returned %s", resp.Status)
	}
	if config.FailOnNonEmptyArrayField != "" {
		if err := checkNonEmptyArrayField(bodyBytes, config.FailOnNonEmptyArrayField); err != nil {
			return err
		}
	}
	return nil
}

// checkNonEmptyArrayField fails the job if the named top-level field in a
// JSON response body is present and is an array with at least one element.
// A body that isn't a JSON object, or that doesn't have the field, or where
// the field isn't an array, is treated as nothing to report — this is an
// opt-in extra check layered on top of the status-code check, not a
// replacement for it.
func checkNonEmptyArrayField(body []byte, field string) error {
	var parsed map[string]json.RawMessage
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil
	}
	raw, ok := parsed[field]
	if !ok {
		return nil
	}
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil || len(items) == 0 {
		return nil
	}
	return fmt.Errorf("response field %q was non-empty (%d item(s)): %s", field, len(items), summarizeArrayItems(items))
}

// summarizeArrayItems renders a short, human-readable summary of failed
// entries for the job's error message — pulling out common "name"/"id" +
// "reason" shaped fields when present, falling back to the raw JSON element
// otherwise, and capping how many are listed so one giant array doesn't blow
// up the stored error message.
func summarizeArrayItems(items []json.RawMessage) string {
	const maxShown = 5
	parts := make([]string, 0, len(items))
	for i, raw := range items {
		if i >= maxShown {
			parts = append(parts, fmt.Sprintf("… +%d more", len(items)-maxShown))
			break
		}
		var obj map[string]any
		label := ""
		if err := json.Unmarshal(raw, &obj); err == nil {
			if v, ok := obj["name"]; ok {
				label = fmt.Sprint(v)
			} else if v, ok := obj["id"]; ok {
				label = fmt.Sprint(v)
			}
			if reason, ok := obj["reason"]; ok {
				if label != "" {
					label += ": " + fmt.Sprint(reason)
				} else {
					label = fmt.Sprint(reason)
				}
			}
		}
		if label == "" {
			label = string(raw)
		}
		parts = append(parts, label)
	}
	return strings.Join(parts, "; ")
}

func errCheckFailed(msg string) error { return errors.New(msg) }

func ptrString(s string) *string { return &s }

// JobsTickInfo hands the signed-in user their own tick secret so the
// Settings UI can show the exact URL to paste into cron-job.org, rather than
// making them go dig CRON_SECRET out of the server's environment by hand.
// Safe for a single-user tool: whoever is authenticated already has full
// control over this dbeans instance.
func (s *Server) JobsTickInfo(w http.ResponseWriter, r *http.Request) {
	if _, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r)); err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"secret": s.CronSecret, "path": "/api/jobs/tick"})
}

// JobsTick is hit by an external scheduler (cron-job.org) on a fixed
// interval, gated by a shared secret rather than a user session — the
// external caller has no login. It finds every enabled ROOT job (one with
// no dependencies) across every user that is due by cron, runs it, and on
// success enqueues that job's dependents into job_queue — which this same
// tick (and every tick after, until drained) also processes: a queued job
// runs the moment every one of its dependencies has a recorded success for
// that queue entry's run_date, cascading through as many levels as are
// ready. A job with dependencies is therefore never matched by its own
// next_run_at (see the WHERE clause below) — its cron is purely
// informational once it depends on something, since the queue is what
// actually decides when it's allowed to run.
func (s *Server) JobsTick(w http.ResponseWriter, r *http.Request) {
	secret := r.URL.Query().Get("secret")
	if secret == "" {
		secret = bearerToken(r)
	}
	if s.CronSecret == "" || secret != s.CronSecret {
		writeError(w, http.StatusUnauthorized, "invalid or missing secret")
		return
	}

	rows, err := s.Pool.Query(r.Context(), `
		SELECT `+jobColumns+`, user_id
		FROM jobs
		WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= now() AND depends_on = '[]'::jsonb`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load due jobs")
		return
	}
	type dueJob struct {
		job    Job
		userID int64
	}
	due := []dueJob{}
	for rows.Next() {
		var j Job
		var dependsOnJSON []byte
		var userID int64
		if err := rows.Scan(
			&j.ID, &j.ConnectionID, &j.Name, &j.JobType, &j.SQL, &j.Config, &j.CronExpr, &j.Enabled,
			&dependsOnJSON, &j.RetryLimit, &j.RetryDelaySeconds, &j.CheckMode,
			&j.Layout, &j.NextRunAt, &j.LastRunAt, &j.LastStatus, &userID,
		); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "failed to read due jobs")
			return
		}
		j.DependsOn = []string{}
		_ = json.Unmarshal(dependsOnJSON, &j.DependsOn)
		due = append(due, dueJob{job: j, userID: userID})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read due jobs")
		return
	}

	type tickResult struct {
		JobID  string `json:"jobId"`
		Name   string `json:"name"`
		Status string `json:"status"`
	}
	now := time.Now().UTC()
	results := make([]tickResult, 0, len(due))
	usersToDrain := map[int64]bool{}
	for _, d := range due {
		run := s.executeJob(r.Context(), d.userID, d.job, "tick", now)
		results = append(results, tickResult{JobID: d.job.ID, Name: d.job.Name, Status: run.Status})
		usersToDrain[d.userID] = true
		if run.Status == "success" {
			if allJobs, err := s.loadUserJobs(r.Context(), d.userID); err == nil {
				s.enqueueDependents(r.Context(), allJobs, d.job.ID, now)
			}
		}
	}

	// Also drain any user's queue left over from a previous tick (e.g. a
	// dependency that only just succeeded, or a chain that didn't finish
	// draining before this handler returned last time) even if nothing of
	// theirs was freshly due this tick.
	if queuedUsers, err := s.usersWithQueuedWork(r.Context()); err == nil {
		for userID := range queuedUsers {
			usersToDrain[userID] = true
		}
	}
	for userID := range usersToDrain {
		if allJobs, err := s.loadUserJobs(r.Context(), userID); err == nil {
			s.drainJobQueue(r.Context(), userID, allJobs)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"ran": len(results), "results": results})
}

// enqueueJob durably marks jobID as ready to be attempted for runDate —
// see job_queue's migration comment in internal/db for why this exists
// instead of just relying on cron timing.
func (s *Server) enqueueJob(ctx context.Context, jobID string, runDate time.Time) {
	_, _ = s.Pool.Exec(ctx, `
		INSERT INTO job_queue (job_id, run_date) VALUES ($1, $2)
		ON CONFLICT (job_id, run_date) DO NOTHING`,
		jobID, runDate.Format(dateOnlyLayout))
}

// enqueueDependents queues every job that directly depends on finishedJobID
// to (eventually) run for the same runDate, now that finishedJobID has
// succeeded.
func (s *Server) enqueueDependents(ctx context.Context, allJobs []Job, finishedJobID string, runDate time.Time) {
	for _, candidate := range allJobs {
		for _, depID := range candidate.DependsOn {
			if depID == finishedJobID {
				s.enqueueJob(ctx, candidate.ID, runDate)
				break
			}
		}
	}
}

// dependenciesSatisfied reports whether every job in dependsOn has a
// successful run recorded for the exact runDate. This is stricter than
// executeJob's own dependency check (which only looks at each dependency's
// most recent status, any date) — the queue needs the stronger version to
// actually be correct: it must wait for *this cycle's* success, not
// leftover status from a previous run.
func (s *Server) dependenciesSatisfied(ctx context.Context, dependsOn []string, userID int64, runDate time.Time) bool {
	for _, depID := range dependsOn {
		var exists bool
		err := s.Pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM job_runs jr
				JOIN jobs j ON j.id = jr.job_id
				WHERE jr.job_id = $1 AND j.user_id = $2 AND jr.run_date = $3 AND jr.status = 'success'
			)`, depID, userID, runDate.Format(dateOnlyLayout)).Scan(&exists)
		if err != nil || !exists {
			return false
		}
	}
	return true
}

// usersWithQueuedWork lists every user who currently has at least one
// pending job_queue entry, so JobsTick can drain it even for a user with
// nothing freshly due this tick.
func (s *Server) usersWithQueuedWork(ctx context.Context) (map[int64]bool, error) {
	rows, err := s.Pool.Query(ctx, `SELECT DISTINCT j.user_id FROM job_queue jq JOIN jobs j ON j.id = jq.job_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]bool{}
	for rows.Next() {
		var uid int64
		if err := rows.Scan(&uid); err != nil {
			return nil, err
		}
		out[uid] = true
	}
	return out, rows.Err()
}

// drainJobQueue repeatedly runs any queued job whose dependencies have all
// succeeded for its queued run_date, enqueueing further dependents as each
// one succeeds so a multi-level chain can finish in one pass. Bounded by
// len(allJobs)+1 passes — each pass can only newly unblock at most one
// "layer" of a dependency graph, so this is enough for any real DAG and
// keeps a mistaken dependency cycle (never validated against elsewhere)
// from looping forever.
func (s *Server) drainJobQueue(ctx context.Context, userID int64, allJobs []Job) {
	byID := make(map[string]Job, len(allJobs))
	for _, j := range allJobs {
		byID[j.ID] = j
	}

	type queueEntry struct {
		id      int64
		jobID   string
		runDate time.Time
	}

	for pass := 0; pass < len(allJobs)+1; pass++ {
		rows, err := s.Pool.Query(ctx, `
			SELECT jq.id, jq.job_id, jq.run_date
			FROM job_queue jq
			JOIN jobs j ON j.id = jq.job_id
			WHERE j.user_id = $1`, userID)
		if err != nil {
			return
		}
		entries := []queueEntry{}
		for rows.Next() {
			var e queueEntry
			if err := rows.Scan(&e.id, &e.jobID, &e.runDate); err != nil {
				rows.Close()
				return
			}
			entries = append(entries, e)
		}
		rows.Close()
		if len(entries) == 0 {
			return
		}

		progressed := false
		for _, e := range entries {
			job, ok := byID[e.jobID]
			if !ok || !job.Enabled {
				s.Pool.Exec(ctx, `DELETE FROM job_queue WHERE id = $1`, e.id)
				progressed = true
				continue
			}

			var alreadyRan bool
			_ = s.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM job_runs WHERE job_id = $1 AND run_date = $2)`,
				e.jobID, e.runDate.Format(dateOnlyLayout)).Scan(&alreadyRan)
			if alreadyRan {
				// Already executed for this date via some other path (a
				// manual run, an earlier drain pass) — nothing left to do.
				s.Pool.Exec(ctx, `DELETE FROM job_queue WHERE id = $1`, e.id)
				progressed = true
				continue
			}

			if !s.dependenciesSatisfied(ctx, job.DependsOn, userID, e.runDate) {
				continue // leave queued — try again next pass/tick
			}

			run := s.executeJob(ctx, userID, job, "tick", e.runDate)
			s.Pool.Exec(ctx, `DELETE FROM job_queue WHERE id = $1`, e.id)
			progressed = true
			if run.Status == "success" {
				s.enqueueDependents(ctx, allJobs, job.ID, e.runDate)
			}
		}
		if !progressed {
			return
		}
	}
}
