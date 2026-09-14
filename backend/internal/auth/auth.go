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
var ErrPasswordTooShort = errors.New("new password must be at least 12 characters")

const sessionTTL = 30 * 24 * time.Hour
const minPasswordLength = 12

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

// ChangePassword verifies currentPassword against the stored hash, then
// replaces it with a hash of newPassword and signs the user out of every
// other session (the caller's own token, passed as currentToken, is kept).
func ChangePassword(ctx context.Context, pool *pgxpool.Pool, userID int64, currentToken, currentPassword, newPassword string) error {
	if len(newPassword) < minPasswordLength {
		return ErrPasswordTooShort
	}
	var hash string
	if err := pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&hash); err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(currentPassword)) != nil {
		return ErrInvalidCredentials
	}
	newHash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET password_hash = $1 WHERE id = $2`, newHash, userID); err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1 AND token != $2`, userID, currentToken)
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
