package api

import (
	"context"
	"encoding/json"
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
