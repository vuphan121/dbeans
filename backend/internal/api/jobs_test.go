package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNormalizeJobRequestDefaultsLegacyQuery(t *testing.T) {
	req := jobRequest{ConnectionID: "connection-1", SQL: "select 1"}
	if err := normalizeJobRequest(&req); err != nil {
		t.Fatalf("normalizeJobRequest() error = %v", err)
	}
	if req.JobType != "query" {
		t.Fatalf("JobType = %q, want query", req.JobType)
	}
	if string(req.Config) != "{}" {
		t.Fatalf("Config = %s, want {}", req.Config)
	}
}

func TestNormalizeHTTPRequestJobRequest(t *testing.T) {
	req := jobRequest{
		JobType:      "http_request",
		ConnectionID: "unused-connection",
		SQL:          "select 1",
		CheckMode:    "fail_if_no_rows",
		Config:       json.RawMessage(`{"url":" https://example.com/run ","headers":{}}`),
	}
	if err := normalizeJobRequest(&req); err != nil {
		t.Fatalf("normalizeJobRequest() error = %v", err)
	}
	if req.ConnectionID != "" || req.SQL != "" || req.CheckMode != "none" {
		t.Fatalf("query-only fields were not cleared: connection=%q sql=%q check=%q", req.ConnectionID, req.SQL, req.CheckMode)
	}
	var config httpRequestJobConfig
	if err := json.Unmarshal(req.Config, &config); err != nil {
		t.Fatal(err)
	}
	if config.URL != "https://example.com/run" || config.Method != http.MethodPost {
		t.Fatalf("normalized config = %#v", config)
	}
}

func TestExecuteHTTPRequestJobSendsTemplatedRequestAndDiscardsResponse(t *testing.T) {
	var received bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = true
		if r.Method != http.MethodPatch {
			t.Errorf("method = %s, want PATCH", r.Method)
		}
		if r.URL.Query().Get("day") != "2026-09-13" {
			t.Errorf("day = %q, want 2026-09-13", r.URL.Query().Get("day"))
		}
		if r.Header.Get("X-Run-Date") != "2026-09-14" {
			t.Errorf("X-Run-Date = %q, want 2026-09-14", r.Header.Get("X-Run-Date"))
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		if string(body) != `{"runAt":"2026-09-14 01:30:00"}` {
			t.Errorf("body = %q", body)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	config, err := json.Marshal(httpRequestJobConfig{
		URL:    server.URL + "/run?day={{date-1}}",
		Method: http.MethodPatch,
		Headers: map[string]string{
			"X-Run-Date": "{{date}}",
		},
		Body: `{"runAt":"{{datetime}}"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	runDate := time.Date(2026, time.September, 14, 8, 30, 0, 0, time.FixedZone("test", 7*60*60))
	if err := executeHTTPRequestJob(context.Background(), config, runDate); err != nil {
		t.Fatalf("executeHTTPRequestJob() error = %v", err)
	}
	if !received {
		t.Fatal("HTTP test server did not receive a request")
	}
}

func TestExecuteHTTPRequestJobFailsOnNonEmptyArrayField(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"refreshed":[{"id":"a"}],"failed":[{"id":"b","reason":"boom"}]}`))
	}))
	defer server.Close()

	config, err := json.Marshal(httpRequestJobConfig{
		URL: server.URL, Method: http.MethodPost, FailOnNonEmptyArrayField: "failed",
	})
	if err != nil {
		t.Fatal(err)
	}
	err = executeHTTPRequestJob(context.Background(), config, time.Now())
	if err == nil || !strings.Contains(err.Error(), "b: boom") {
		t.Fatalf("error = %v, want it to mention the failed item", err)
	}
}

func TestExecuteHTTPRequestJobIgnoresEmptyArrayField(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"refreshed":[{"id":"a"}],"failed":[]}`))
	}))
	defer server.Close()

	config, err := json.Marshal(httpRequestJobConfig{
		URL: server.URL, Method: http.MethodPost, FailOnNonEmptyArrayField: "failed",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := executeHTTPRequestJob(context.Background(), config, time.Now()); err != nil {
		t.Fatalf("executeHTTPRequestJob() error = %v, want nil for empty failed[]", err)
	}
}

func TestExecuteHTTPRequestJobRejectsNon2xx(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	config, err := json.Marshal(httpRequestJobConfig{URL: server.URL, Method: http.MethodPost})
	if err != nil {
		t.Fatal(err)
	}
	err = executeHTTPRequestJob(context.Background(), config, time.Now())
	if err == nil || !strings.Contains(err.Error(), "404 Not Found") {
		t.Fatalf("error = %v, want 404 status", err)
	}
}
