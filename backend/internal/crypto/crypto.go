// Package crypto encrypts saved connection credentials at rest, using a
// single server-side key independent of any user's login password (a
// password change therefore never needs to re-encrypt anything).
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
)

var gcm cipher.AEAD

// Init decodes a 32-byte (64 hex char) key from CONNECTION_ENCRYPTION_KEY —
// same "openssl rand -hex 32" convention as the existing CRON_SECRET — and
// must be called once before Encrypt/Decrypt are used.
func Init(hexKey string) error {
	key, err := hex.DecodeString(hexKey)
	if err != nil {
		return fmt.Errorf("CONNECTION_ENCRYPTION_KEY must be hex-encoded: %w", err)
	}
	if len(key) != 32 {
		return fmt.Errorf("CONNECTION_ENCRYPTION_KEY must decode to 32 bytes, got %d (generate one with: openssl rand -hex 32)", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err = cipher.NewGCM(block)
	return err
}

// Encrypt returns nonce||ciphertext, AES-256-GCM sealed.
func Encrypt(plaintext []byte) ([]byte, error) {
	if gcm == nil {
		return nil, errors.New("crypto: Init was not called")
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt reverses Encrypt.
func Decrypt(data []byte) ([]byte, error) {
	if gcm == nil {
		return nil, errors.New("crypto: Init was not called")
	}
	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return nil, errors.New("crypto: ciphertext too short")
	}
	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	return gcm.Open(nil, nonce, ciphertext, nil)
}
