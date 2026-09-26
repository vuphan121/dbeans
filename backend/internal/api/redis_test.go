package api

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestRedisZSetValueJSONRoundTrip(t *testing.T) {
	original := redisValue{Type: "zset", ZValues: []redisZMember{{Member: "alpha", Score: 1.5}}}
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	var decoded redisValue
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Type != "zset" || len(decoded.ZValues) != 1 || decoded.ZValues[0].Member != "alpha" || decoded.ZValues[0].Score != 1.5 {
		t.Fatalf("unexpected round trip: %#v", decoded)
	}
}

func TestWriteReadAndReplaceRedisValue(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	ctx := context.Background()
	ttl := int64(60)
	entry := redisKeyEntry{Key: "user:1", TTL: &ttl, Value: redisValue{Type: "hash", Fields: []redisHashField{{Field: "name", Value: "Ada"}}}}
	if err := writeRedisValue(ctx, client, entry, false); err != nil {
		t.Fatal(err)
	}
	read, err := readRedisEntry(ctx, client, entry.Key)
	if err != nil {
		t.Fatal(err)
	}
	if read.Value.Type != "hash" || len(read.Value.Fields) != 1 || read.TTL == nil {
		t.Fatalf("unexpected entry: %#v", read)
	}

	replacement := redisKeyEntry{Key: entry.Key, Value: redisValue{Type: "string", Value: "updated"}}
	if err := writeRedisValue(ctx, client, replacement, true); err != nil {
		t.Fatal(err)
	}
	read, err = readRedisEntry(ctx, client, entry.Key)
	if err != nil {
		t.Fatal(err)
	}
	if read.Value.Type != "string" || read.Value.Value != "updated" {
		t.Fatalf("unexpected replacement: %#v", read)
	}
}

// TestReplaceCleansUpTempKeyOnPartialFailure guards against a regression of
// the bug where writeRedisValue's replace path left an orphaned
// __dbeans_tmp:* key behind when the value write succeeded but the
// subsequent TTL set failed.
func TestReplaceCleansUpTempKeyOnPartialFailure(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	ctx := context.Background()

	badTTL := int64(-5) // writeRedisValue rejects TTL < 1 after the value write already ran
	entry := redisKeyEntry{Key: "will-fail", TTL: &badTTL, Value: redisValue{Type: "string", Value: "x"}}
	if err := writeRedisValue(ctx, client, entry, true); err == nil {
		t.Fatal("expected an error from the invalid TTL")
	}

	for _, key := range server.Keys() {
		if strings.HasPrefix(key, "__dbeans_tmp:") {
			t.Fatalf("orphaned temp key left behind: %q", key)
		}
	}
}

// TestReadRedisEntriesMatchesReadRedisEntry guards the pipelined batch
// reader (used by ListRedisKeys) against drifting from the single-key
// reader's behavior for every supported type, plus an unsupported one that
// should be silently omitted.
func TestReadRedisEntriesMatchesReadRedisEntry(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	ctx := context.Background()

	entries := []redisKeyEntry{
		{Key: "k:string", Value: redisValue{Type: "string", Value: "hello"}},
		{Key: "k:hash", Value: redisValue{Type: "hash", Fields: []redisHashField{{Field: "a", Value: "1"}}}},
		{Key: "k:list", Value: redisValue{Type: "list", Items: []string{"a", "b"}}},
		{Key: "k:set", Value: redisValue{Type: "set", Members: []string{"m1"}}},
		{Key: "k:zset", Value: redisValue{Type: "zset", ZValues: []redisZMember{{Member: "z1", Score: 2.5}}}},
	}
	keys := make([]string, 0, len(entries)+1)
	for _, e := range entries {
		if err := writeRedisValue(ctx, client, e, false); err != nil {
			t.Fatalf("seed %s: %v", e.Key, err)
		}
		keys = append(keys, e.Key)
	}
	// A stream isn't one of readRedisEntry's supported types — both readers
	// must silently omit it rather than error the whole batch.
	if _, err := client.XAdd(ctx, &redis.XAddArgs{Stream: "k:unsupported", Values: map[string]any{"f": "v"}}).Result(); err != nil {
		t.Fatalf("seed stream: %v", err)
	}
	keys = append(keys, "k:unsupported")

	batch := readRedisEntries(ctx, client, keys)
	if len(batch) != len(entries) {
		t.Fatalf("expected %d entries (unsupported type omitted), got %d: %#v", len(entries), len(batch), batch)
	}
	byKey := map[string]redisKeyEntry{}
	for _, e := range batch {
		byKey[e.Key] = e
	}
	for _, want := range entries {
		single, err := readRedisEntry(ctx, client, want.Key)
		if err != nil {
			t.Fatalf("readRedisEntry(%s): %v", want.Key, err)
		}
		got, ok := byKey[want.Key]
		if !ok {
			t.Fatalf("readRedisEntries omitted %s", want.Key)
		}
		gotJSON, _ := json.Marshal(got.Value)
		singleJSON, _ := json.Marshal(single.Value)
		if string(gotJSON) != string(singleJSON) {
			t.Errorf("%s: batch reader = %s, single reader = %s", want.Key, gotJSON, singleJSON)
		}
	}

	if empty := readRedisEntries(ctx, client, nil); empty == nil || len(empty) != 0 {
		t.Fatalf("expected an empty (non-nil) slice for no keys, got %#v", empty)
	}
}
