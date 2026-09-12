package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

var ErrInvalidCredentials = errors.New("invalid username or password")

const sessionTTL = 30 * 24 * time.Hour

type User struct {
	ID       int64
	Username string
}

type Session struct {
	Token     string
	UserID    int64
	ExpiresAt time.Time
}

func HashPassword(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	return string(b), err
}

// SeedUser creates the user if it doesn't already exist. Safe to call on every startup.
func SeedUser(ctx context.Context, pool *pgxpool.Pool, username, plainPassword string) error {
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)`, username).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	hash, err := HashPassword(plainPassword)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `INSERT INTO users (username, password_hash) VALUES ($1, $2)`, username, hash)
	return err
}

func Login(ctx context.Context, pool *pgxpool.Pool, username, password string) (*Session, error) {
	var user User
	var hash string
	err := pool.QueryRow(ctx, `SELECT id, username, password_hash FROM users WHERE username = $1`, username).
		Scan(&user.ID, &user.Username, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, ErrInvalidCredentials
	}

	token, err := randomToken()
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().Add(sessionTTL)
	_, err = pool.Exec(ctx, `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`,
		token, user.ID, expiresAt)
	if err != nil {
		return nil, err
	}
	return &Session{Token: token, UserID: user.ID, ExpiresAt: expiresAt}, nil
}

func Logout(ctx context.Context, pool *pgxpool.Pool, token string) error {
	_, err := pool.Exec(ctx, `DELETE FROM sessions WHERE token = $1`, token)
	return err
}

// Resolve returns the user for a valid, non-expired session token.
func Resolve(ctx context.Context, pool *pgxpool.Pool, token string) (*User, error) {
	if token == "" {
		return nil, ErrInvalidCredentials
	}
	var u User
	var expiresAt time.Time
	err := pool.QueryRow(ctx, `
		SELECT u.id, u.username, s.expires_at
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token = $1`, token).Scan(&u.ID, &u.Username, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if time.Now().After(expiresAt) {
		return nil, ErrInvalidCredentials
	}
	return &u, nil
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
