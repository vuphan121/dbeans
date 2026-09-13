package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
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
	SQL               string          `json:"sql"`
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
		&j.ID, &j.ConnectionID, &j.Name, &j.SQL, &j.CronExpr, &j.Enabled,
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

const jobColumns = `id, connection_id, name, sql, cron_expr, enabled, depends_on, retry_limit, retry_delay_seconds, check_mode, layout, next_run_at, last_run_at, last_status`

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
	SQL               string          `json:"sql"`
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

func (s *Server) CreateJob(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var req jobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" || req.Name == "" || req.SQL == "" || req.ConnectionID == "" {
		writeError(w, http.StatusBadRequest, "id, name, connectionId and sql are required")
		return
	}
	schedule, err := cronParser.Parse(req.CronExpr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid cron expression: "+err.Error())
		return
	}

	var connOwner string
	if err := s.Pool.QueryRow(r.Context(), `SELECT id FROM connections WHERE id = $1 AND user_id = $2`, req.ConnectionID, user.ID).Scan(&connOwner); err != nil {
		writeError(w, http.StatusBadRequest, "connection not found")
		return
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
	nextRunAt := schedule.Next(time.Now())

	_, err = s.Pool.Exec(r.Context(), `
		INSERT INTO jobs (id, user_id, connection_id, name, sql, cron_expr, enabled, depends_on, retry_limit, retry_delay_seconds, check_mode, layout, next_run_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
		req.ID, user.ID, req.ConnectionID, req.Name, req.SQL, req.CronExpr, enabled, dependsOnJSON, retryLimit, retryDelay, checkMode, req.Layout, nextRunAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save job")
		return
	}

	writeJSON(w, http.StatusCreated, Job{
		ID: req.ID, ConnectionID: req.ConnectionID, Name: req.Name, SQL: req.SQL, CronExpr: req.CronExpr,
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
	if req.Name == "" || req.SQL == "" || req.ConnectionID == "" || req.CronExpr == "" {
		writeError(w, http.StatusBadRequest, "name, connectionId, sql and cronExpr are required")
		return
	}
	schedule, err := cronParser.Parse(req.CronExpr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid cron expression: "+err.Error())
		return
	}
	var connOwner string
	if err := s.Pool.QueryRow(r.Context(), `SELECT id FROM connections WHERE id = $1 AND user_id = $2`, req.ConnectionID, user.ID).Scan(&connOwner); err != nil {
		writeError(w, http.StatusBadRequest, "connection not found")
		return
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
	nextRunAt := schedule.Next(time.Now())

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
		UPDATE jobs SET connection_id = $1, name = $2, sql = $3, cron_expr = $4, enabled = $5,
			depends_on = $6, retry_limit = $7, retry_delay_seconds = $8, check_mode = $9,
			layout = $10, next_run_at = $11
		WHERE id = $12 AND user_id = $13`,
		req.ConnectionID, req.Name, req.SQL, req.CronExpr, enabled, dependsOnJSON, retryLimit, retryDelay, checkMode,
		layout, nextRunAt, id, user.ID)
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
			rowCount, execErr := s.executeJobQuery(ctx, userID, j, runDate)
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
		next := schedule.Next(finished)
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
// external caller has no login. It finds every enabled job across every
// user that is due, and runs each one through the dependency/retry/check
// pipeline.
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
		WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= now()`)
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
			&j.ID, &j.ConnectionID, &j.Name, &j.SQL, &j.CronExpr, &j.Enabled,
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
	for _, d := range due {
		run := s.executeJob(r.Context(), d.userID, d.job, "tick", now)
		results = append(results, tickResult{JobID: d.job.ID, Name: d.job.Name, Status: run.Status})
	}

	writeJSON(w, http.StatusOK, map[string]any{"ran": len(results), "results": results})
}
