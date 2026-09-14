// Package server builds the fully wired dbeans API handler: connects to the
// operator database, runs migrations, seeds the optional dev user, and
// registers every route. Shared by the local `go run .` binary (main.go,
// which wraps it in http.ListenAndServe) and the Vercel serverless
// entrypoint (api/index.go, which calls ServeHTTP per invocation instead)
// so the two deployment targets can never drift out of sync on routes.
package server

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"dbeans/backend/internal/api"
	"dbeans/backend/internal/auth"
	"dbeans/backend/internal/crypto"
	"dbeans/backend/internal/db"
)

// New reads configuration from the environment, connects to the operator
// database, migrates it, and returns the ready-to-serve HTTP handler plus
// the underlying pool (so the caller decides when/whether to close it —
// main.go's long-running process can defer Close; the serverless entrypoint
// keeps the pool alive across warm invocations instead).
func New(ctx context.Context) (http.Handler, *pgxpool.Pool, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return nil, nil, fmt.Errorf("DATABASE_URL is not set")
	}

	allowedOrigins := strings.Split(getenvDefault("ALLOWED_ORIGINS", "http://localhost:5183"), ",")

	if err := crypto.Init(os.Getenv("CONNECTION_ENCRYPTION_KEY")); err != nil {
		return nil, nil, fmt.Errorf("CONNECTION_ENCRYPTION_KEY: %w", err)
	}

	pool, err := db.Connect(ctx, databaseURL)
	if err != nil {
		return nil, nil, fmt.Errorf("db connect: %w", err)
	}

	if err := db.Migrate(ctx, pool); err != nil {
		pool.Close()
		return nil, nil, fmt.Errorf("db migrate: %w", err)
	}
	if err := db.EncryptLegacyConnections(ctx, pool); err != nil {
		pool.Close()
		return nil, nil, fmt.Errorf("db encrypt legacy connections: %w", err)
	}
	log.Println("database ready")

	if seedUser := os.Getenv("SEED_USERNAME"); seedUser != "" {
		if seedPass := os.Getenv("SEED_PASSWORD"); seedPass != "" {
			if err := auth.SeedUser(ctx, pool, seedUser, seedPass); err != nil {
				log.Printf("seed user %q: %v", seedUser, err)
			} else {
				log.Printf("seed user %q ready", seedUser)
			}
		}
	}

	cronSecret := os.Getenv("CRON_SECRET")
	if cronSecret == "" {
		log.Println("warning: CRON_SECRET is not set — /api/jobs/tick will reject every request until it is")
	}

	s := &api.Server{Pool: pool, CronSecret: cronSecret}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	// Must be comfortably above every handler's own internal timeout
	// (query/job execution use a 20s context) — otherwise this middleware
	// cancels the request context before that inner timeout is ever reached.
	r.Use(middleware.Timeout(25 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Get("/api/health", s.Health)
	r.Post("/api/auth/login", s.Login)
	r.Post("/api/auth/logout", s.Logout)
	r.Get("/api/auth/me", s.Me)
	r.Post("/api/auth/change-password", s.ChangePassword)
	r.Post("/api/analytics/event", s.TrackEvent)

	r.Get("/api/connections", s.ListConnections)
	r.Post("/api/connections", s.CreateConnection)
	r.Patch("/api/connections/{id}", s.UpdateConnection)
	r.Delete("/api/connections/{id}", s.DeleteConnection)
	r.Post("/api/connections/{id}/ping", s.PingConnection)
	r.Get("/api/connections/{id}/schema", s.GetConnectionSchema)
	r.Post("/api/connections/{id}/query", s.RunConnectionQuery)
	r.Get("/api/connections/{id}/redis/keys", s.ListRedisKeys)
	r.Post("/api/connections/{id}/redis/keys", s.SaveRedisKey)
	r.Put("/api/connections/{id}/redis/keys", s.SaveRedisKey)
	r.Patch("/api/connections/{id}/redis/keys/ttl", s.SetRedisTTL)
	r.Delete("/api/connections/{id}/redis/keys", s.DeleteRedisKey)
	r.Get("/api/connections/{id}/kafka/topics", s.ListKafkaTopics)
	r.Get("/api/connections/{id}/kafka/messages", s.ListKafkaMessages)
	r.Post("/api/connections/{id}/kafka/messages", s.ProduceKafkaMessage)

	r.Get("/api/jobs", s.ListJobs)
	r.Post("/api/jobs", s.CreateJob)
	r.Put("/api/jobs/{id}", s.UpdateJob)
	r.Patch("/api/jobs/{id}", s.UpdateJobLayout)
	r.Delete("/api/jobs/{id}", s.DeleteJob)
	r.Post("/api/jobs/{id}/run", s.RunJobNow)
	r.Get("/api/jobs/{id}/runs", s.ListJobRuns)
	r.Get("/api/jobs/{id}/runs/calendar", s.JobRunCalendar)
	r.Get("/api/jobs/tick", s.JobsTick)
	r.Get("/api/jobs/tick-info", s.JobsTickInfo)

	return r, pool, nil
}

func getenvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
