package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/joho/godotenv"

	"dbeans/backend/internal/server"
)

func main() {
	// .env is only present in local dev; in production the platform injects
	// real environment variables and this is a no-op.
	_ = godotenv.Load()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	handler, pool, err := server.New(context.Background())
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	log.Printf("dbeans backend listening on :%s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal(err)
	}
}
