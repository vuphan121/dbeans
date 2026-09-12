package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"

	"dbeans/backend/internal/api"
	"dbeans/backend/internal/auth"
	"dbeans/backend/internal/db"
)

func main() {
	// .env is only present in local dev; in production the platform injects
	// real environment variables and this is a no-op.
	_ = godotenv.Load()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is not set")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	allowedOrigins := strings.Split(getenvDefault("ALLOWED_ORIGINS", "http://localhost:5183"), ",")

	ctx := context.Background()
	pool, err := db.Connect(ctx, databaseURL)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	if err := db.Migrate(ctx, pool); err != nil {
		log.Fatalf("db migrate: %v", err)
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

	s := &api.Server{Pool: pool}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(15 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Get("/api/health", s.Health)
	r.Post("/api/auth/login", s.Login)
	r.Post("/api/auth/logout", s.Logout)
	r.Get("/api/auth/me", s.Me)
	r.Post("/api/analytics/event", s.TrackEvent)

	r.Get("/api/connections", s.ListConnections)
	r.Post("/api/connections", s.CreateConnection)
	r.Patch("/api/connections/{id}", s.UpdateConnection)
	r.Delete("/api/connections/{id}", s.DeleteConnection)

	log.Printf("dbeans backend listening on :%s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatal(err)
	}
}

func getenvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
