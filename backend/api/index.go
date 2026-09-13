// Package handler is dbeans' single Vercel serverless entrypoint. Vercel
// invokes Handler for every request; vercel.json's catch-all rewrite routes
// every path to this one function, which then delegates to the same chi
// router used by the local binary (main.go) via internal/server — see that
// package for the actual route table.
//
// Known limitation on Vercel specifically: a job's retry delay
// (retryDelaySeconds, up to 300s) sleeps synchronously inside this request
// (see internal/api/jobs.go executeJob), and a single /api/jobs/tick call
// can process multiple due jobs in a loop. That can exceed a serverless
// function's max execution duration (configured below, but still capped by
// your Vercel plan) well before a long retry chain finishes — harmless on
// the traditional-host deployment, where there's no such ceiling, but worth
// keeping retry delays short if you're relying on the Vercel deployment's
// tick endpoint for jobs that actually need retries.
package handler

import (
	"context"
	"net/http"
	"sync"

	"dbeans/backend/internal/server"
)

var (
	mu      sync.Mutex
	handler http.Handler
)

// getHandler lazily builds the router on first invocation and reuses it for
// every subsequent request to the same warm container. If initialization
// previously failed (e.g. the database was briefly unreachable), it retries
// on the next request rather than staying broken for the container's life.
func getHandler() (http.Handler, error) {
	mu.Lock()
	defer mu.Unlock()
	if handler != nil {
		return handler, nil
	}
	h, _, err := server.New(context.Background())
	if err != nil {
		return nil, err
	}
	handler = h
	return handler, nil
}

func Handler(w http.ResponseWriter, r *http.Request) {
	h, err := getHandler()
	if err != nil {
		http.Error(w, "server failed to initialize: "+err.Error(), http.StatusInternalServerError)
		return
	}
	h.ServeHTTP(w, r)
}
