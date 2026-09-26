package api

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"

	"dbeans/backend/internal/auth"
	"dbeans/backend/internal/crypto"
)

const maxRedisKeys = 500
const maxRedisMembers = 500

type redisConnFields struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Password string `json:"password"`
	DBIndex  int    `json:"dbIndex"`
	TLS      bool   `json:"tls"`
}

type redisHashField struct {
	Field string `json:"field"`
	Value string `json:"value"`
}

type redisZMember struct {
	Member string  `json:"member"`
	Score  float64 `json:"score"`
}

type redisValue struct {
	Type    string           `json:"type"`
	Value   string           `json:"value,omitempty"`
	Fields  []redisHashField `json:"fields,omitempty"`
	Items   []string         `json:"items,omitempty"`
	Members []string         `json:"members,omitempty"`
	ZValues []redisZMember   `json:"-"`
}

func (v redisValue) MarshalJSON() ([]byte, error) {
	type alias redisValue
	if v.Type == "zset" {
		return json.Marshal(struct {
			Type    string         `json:"type"`
			Members []redisZMember `json:"members"`
		}{v.Type, v.ZValues})
	}
	return json.Marshal(alias(v))
}

func (v *redisValue) UnmarshalJSON(data []byte) error {
	var raw struct {
		Type    string           `json:"type"`
		Value   string           `json:"value"`
		Fields  []redisHashField `json:"fields"`
		Items   []string         `json:"items"`
		Members json.RawMessage  `json:"members"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	v.Type, v.Value, v.Fields, v.Items = raw.Type, raw.Value, raw.Fields, raw.Items
	if raw.Type == "zset" {
		return json.Unmarshal(raw.Members, &v.ZValues)
	}
	if len(raw.Members) > 0 {
		return json.Unmarshal(raw.Members, &v.Members)
	}
	return nil
}

type redisKeyEntry struct {
	Key   string     `json:"key"`
	TTL   *int64     `json:"ttl"`
	Value redisValue `json:"value"`
}

func (s *Server) redisClient(ctx context.Context, userID int64, id string) (*redis.Client, error) {
	var engine string
	var rawEnc []byte
	if err := s.Pool.QueryRow(ctx, `SELECT engine, fields_enc FROM connections WHERE id = $1 AND user_id = $2`, id, userID).Scan(&engine, &rawEnc); err != nil {
		return nil, fmt.Errorf("connection not found")
	}
	if engine != "redis" {
		return nil, fmt.Errorf("connection is not Redis")
	}
	raw, err := crypto.Decrypt(rawEnc)
	if err != nil {
		return nil, fmt.Errorf("decrypt connection fields: %w", err)
	}
	var f redisConnFields
	if err := json.Unmarshal(raw, &f); err != nil || f.Host == "" || f.Port <= 0 {
		return nil, fmt.Errorf("invalid Redis connection settings")
	}
	opts := &redis.Options{Addr: fmt.Sprintf("%s:%d", f.Host, f.Port), Password: f.Password, DB: f.DBIndex}
	if f.TLS {
		opts.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12, ServerName: f.Host}
	}
	client := redis.NewClient(opts)
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("could not connect to Redis: %w", err)
	}
	return client, nil
}

func readRedisEntry(ctx context.Context, client *redis.Client, key string) (redisKeyEntry, error) {
	typ, err := client.Type(ctx, key).Result()
	if err != nil {
		return redisKeyEntry{}, err
	}
	ttlDuration, err := client.TTL(ctx, key).Result()
	if err != nil {
		return redisKeyEntry{}, err
	}
	var ttl *int64
	if ttlDuration >= 0 {
		seconds := int64(ttlDuration.Seconds())
		ttl = &seconds
	}
	entry := redisKeyEntry{Key: key, TTL: ttl, Value: redisValue{Type: typ}}
	switch typ {
	case "string":
		entry.Value.Value, err = client.GetRange(ctx, key, 0, 1024*1024-1).Result()
	case "hash":
		var values map[string]string
		values, err = client.HGetAll(ctx, key).Result()
		for field, value := range values {
			entry.Value.Fields = append(entry.Value.Fields, redisHashField{Field: field, Value: value})
		}
	case "list":
		entry.Value.Items, err = client.LRange(ctx, key, 0, maxRedisMembers-1).Result()
	case "set":
		entry.Value.Members, err = client.SRandMemberN(ctx, key, maxRedisMembers).Result()
	case "zset":
		var values []redis.Z
		values, err = client.ZRangeWithScores(ctx, key, 0, maxRedisMembers-1).Result()
		for _, value := range values {
			entry.Value.ZValues = append(entry.Value.ZValues, redisZMember{Member: fmt.Sprint(value.Member), Score: value.Score})
		}
	default:
		return redisKeyEntry{}, fmt.Errorf("Redis type %q is not supported yet", typ)
	}
	return entry, err
}

// readRedisEntries reads TYPE/TTL/value for many keys using two pipelined
// round trips total (one for every key's TYPE+TTL, one for every key's
// type-specific value read) instead of readRedisEntry's ~3-4 sequential
// round trips *per key* — turns an O(keys) network-bound loop into O(1).
// Keys that fail to read (an unsupported type, a key that expired mid-scan)
// are silently omitted, matching readRedisEntry's per-key error handling in
// ListRedisKeys' previous sequential loop.
func readRedisEntries(ctx context.Context, client *redis.Client, keys []string) []redisKeyEntry {
	if len(keys) == 0 {
		return []redisKeyEntry{}
	}
	typePipe := client.Pipeline()
	typeCmds := make(map[string]*redis.StatusCmd, len(keys))
	ttlCmds := make(map[string]*redis.DurationCmd, len(keys))
	for _, key := range keys {
		typeCmds[key] = typePipe.Type(ctx, key)
		ttlCmds[key] = typePipe.TTL(ctx, key)
	}
	_, _ = typePipe.Exec(ctx)

	type pending struct {
		key  string
		typ  string
		ttl  *int64
		str  *redis.StringCmd
		hash *redis.MapStringStringCmd
		list *redis.StringSliceCmd
		set  *redis.StringSliceCmd
		zset *redis.ZSliceCmd
	}
	valuePipe := client.Pipeline()
	pendings := make([]*pending, 0, len(keys))
	for _, key := range keys {
		typ, err := typeCmds[key].Result()
		if err != nil {
			continue
		}
		var ttl *int64
		if d, err := ttlCmds[key].Result(); err == nil && d >= 0 {
			seconds := int64(d.Seconds())
			ttl = &seconds
		}
		p := &pending{key: key, typ: typ, ttl: ttl}
		switch typ {
		case "string":
			p.str = valuePipe.GetRange(ctx, key, 0, 1024*1024-1)
		case "hash":
			p.hash = valuePipe.HGetAll(ctx, key)
		case "list":
			p.list = valuePipe.LRange(ctx, key, 0, maxRedisMembers-1)
		case "set":
			p.set = valuePipe.SRandMemberN(ctx, key, maxRedisMembers)
		case "zset":
			p.zset = valuePipe.ZRangeWithScores(ctx, key, 0, maxRedisMembers-1)
		default:
			continue // unsupported type — same as readRedisEntry's error path
		}
		pendings = append(pendings, p)
	}
	_, _ = valuePipe.Exec(ctx)

	entries := make([]redisKeyEntry, 0, len(pendings))
	for _, p := range pendings {
		entry := redisKeyEntry{Key: p.key, TTL: p.ttl, Value: redisValue{Type: p.typ}}
		var err error
		switch p.typ {
		case "string":
			entry.Value.Value, err = p.str.Result()
		case "hash":
			var values map[string]string
			values, err = p.hash.Result()
			for field, value := range values {
				entry.Value.Fields = append(entry.Value.Fields, redisHashField{Field: field, Value: value})
			}
		case "list":
			entry.Value.Items, err = p.list.Result()
		case "set":
			entry.Value.Members, err = p.set.Result()
		case "zset":
			var values []redis.Z
			values, err = p.zset.Result()
			for _, value := range values {
				entry.Value.ZValues = append(entry.Value.ZValues, redisZMember{Member: fmt.Sprint(value.Member), Score: value.Score})
			}
		}
		if err == nil {
			entries = append(entries, entry)
		}
	}
	return entries
}

func (s *Server) ListRedisKeys(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	client, err := s.redisClient(r.Context(), user.ID, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer client.Close()
	pattern := strings.TrimSpace(r.URL.Query().Get("pattern"))
	if pattern == "" {
		pattern = "*"
	}
	keys := []string{}
	var cursor uint64
	for len(keys) < maxRedisKeys {
		batch, next, scanErr := client.Scan(r.Context(), cursor, pattern, 100).Result()
		if scanErr != nil {
			writeError(w, http.StatusBadGateway, scanErr.Error())
			return
		}
		keys = append(keys, batch...)
		cursor = next
		if cursor == 0 {
			break
		}
	}
	if len(keys) > maxRedisKeys {
		keys = keys[:maxRedisKeys]
	}
	entries := readRedisEntries(r.Context(), client, keys)
	writeJSON(w, http.StatusOK, entries)
}

func writeRedisValue(ctx context.Context, client *redis.Client, entry redisKeyEntry, replace bool) error {
	if strings.TrimSpace(entry.Key) == "" {
		return fmt.Errorf("key is required")
	}
	if entry.TTL != nil && *entry.TTL < 1 {
		return fmt.Errorf("TTL must be at least one second")
	}
	if entry.Value.Type != "string" && len(entry.Value.Fields)+len(entry.Value.Items)+len(entry.Value.Members)+len(entry.Value.ZValues) == 0 {
		return fmt.Errorf("a %s needs at least one item", entry.Value.Type)
	}
	if replace {
		// Build the replacement separately, then atomically swap it into place.
		// A validation or Redis error cannot destroy the existing value.
		random := make([]byte, 8)
		if _, err := rand.Read(random); err != nil {
			return err
		}
		temp := entry
		temp.Key = "__dbeans_tmp:" + hex.EncodeToString(random)
		if err := writeRedisValue(ctx, client, temp, false); err != nil {
			// The value write itself may have succeeded even though this
			// returned an error (e.g. the trailing Expire call failed) —
			// Del on a key that was never created is a harmless no-op, so
			// clean up unconditionally rather than leaving a possible
			// orphaned duplicate under the temp key.
			_ = client.Del(ctx, temp.Key).Err()
			return err
		}
		if err := client.Rename(ctx, temp.Key, entry.Key).Err(); err != nil {
			_ = client.Del(ctx, temp.Key).Err()
			return err
		}
		return nil
	}
	exists, err := client.Exists(ctx, entry.Key).Result()
	if err != nil {
		return err
	}
	if exists > 0 {
		return fmt.Errorf("key already exists")
	}
	switch entry.Value.Type {
	case "string":
		err = client.Set(ctx, entry.Key, entry.Value.Value, 0).Err()
	case "hash":
		if len(entry.Value.Fields) == 0 {
			return fmt.Errorf("a hash needs at least one field")
		}
		values := make([]any, 0, len(entry.Value.Fields)*2)
		for _, item := range entry.Value.Fields {
			values = append(values, item.Field, item.Value)
		}
		err = client.HSet(ctx, entry.Key, values...).Err()
	case "list":
		if len(entry.Value.Items) == 0 {
			return fmt.Errorf("a list needs at least one item")
		}
		values := make([]any, len(entry.Value.Items))
		for i := range entry.Value.Items {
			values[i] = entry.Value.Items[i]
		}
		err = client.RPush(ctx, entry.Key, values...).Err()
	case "set":
		if len(entry.Value.Members) == 0 {
			return fmt.Errorf("a set needs at least one member")
		}
		values := make([]any, len(entry.Value.Members))
		for i := range entry.Value.Members {
			values[i] = entry.Value.Members[i]
		}
		err = client.SAdd(ctx, entry.Key, values...).Err()
	case "zset":
		if len(entry.Value.ZValues) == 0 {
			return fmt.Errorf("a sorted set needs at least one member")
		}
		values := make([]redis.Z, len(entry.Value.ZValues))
		for i, item := range entry.Value.ZValues {
			values[i] = redis.Z{Member: item.Member, Score: item.Score}
		}
		err = client.ZAdd(ctx, entry.Key, values...).Err()
	default:
		return fmt.Errorf("unsupported Redis type %q", entry.Value.Type)
	}
	if err == nil && entry.TTL != nil {
		err = client.Expire(ctx, entry.Key, time.Duration(*entry.TTL)*time.Second).Err()
	}
	return err
}

func (s *Server) SaveRedisKey(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var entry redisKeyEntry
	if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
		writeError(w, http.StatusBadRequest, "invalid key")
		return
	}
	client, err := s.redisClient(r.Context(), user.ID, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer client.Close()
	if err := writeRedisValue(r.Context(), client, entry, r.Method == http.MethodPut); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	created, err := readRedisEntry(r.Context(), client, entry.Key)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, created)
}

func (s *Server) SetRedisTTL(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req struct {
		Key string `json:"key"`
		TTL *int64 `json:"ttl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Key == "" {
		writeError(w, http.StatusBadRequest, "invalid TTL request")
		return
	}
	if req.TTL != nil && *req.TTL < 1 {
		writeError(w, http.StatusBadRequest, "TTL must be at least one second")
		return
	}
	client, err := s.redisClient(r.Context(), user.ID, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer client.Close()
	if req.TTL == nil {
		err = client.Persist(r.Context(), req.Key).Err()
	} else {
		err = client.Expire(r.Context(), req.Key, time.Duration(*req.TTL)*time.Second).Err()
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) DeleteRedisKey(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	key := r.URL.Query().Get("key")
	if key == "" {
		writeError(w, http.StatusBadRequest, "key is required")
		return
	}
	client, err := s.redisClient(r.Context(), user.ID, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer client.Close()
	if err := client.Del(r.Context(), key).Err(); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
