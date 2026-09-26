package api

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl/plain"

	"dbeans/backend/internal/auth"
	"dbeans/backend/internal/crypto"
)

const maxKafkaMessages = 100

// maxKafkaConcurrency bounds how many partitions' leader connections are
// dialed at once — high enough to turn a wide topic's per-partition latency
// from additive (one dial after another) into roughly one round trip's
// worth, without opening an unbounded number of TCP connections to the
// broker for a topic with hundreds of partitions.
const maxKafkaConcurrency = 8

// forEachPartition runs fn once per partition, up to maxKafkaConcurrency at
// a time, and waits for all of them to finish. fn is responsible for its own
// synchronization if it mutates shared state.
func forEachPartition(partitions []kafka.Partition, fn func(kafka.Partition)) {
	sem := make(chan struct{}, maxKafkaConcurrency)
	var wg sync.WaitGroup
	for _, p := range partitions {
		wg.Add(1)
		sem <- struct{}{}
		go func(p kafka.Partition) {
			defer wg.Done()
			defer func() { <-sem }()
			fn(p)
		}(p)
	}
	wg.Wait()
}

type kafkaConnFields struct {
	Brokers      string `json:"brokers"`
	SASLUsername string `json:"saslUsername"`
	SASLPassword string `json:"saslPassword"`
	TLS          bool   `json:"tls"`
}

type kafkaTopic struct {
	Name           string `json:"name"`
	Partitions     int    `json:"partitions"`
	ApproxMessages int64  `json:"approxMessages"`
}

type kafkaMessageResponse struct {
	Partition int               `json:"partition"`
	Offset    int64             `json:"offset"`
	Timestamp string            `json:"timestamp"`
	Key       *string           `json:"key"`
	Value     string            `json:"value"`
	Headers   map[string]string `json:"headers"`
}

func (s *Server) kafkaSettings(ctx context.Context, userID int64, id string) (kafkaConnFields, *kafka.Dialer, []string, error) {
	var engine string
	var rawEnc []byte
	if err := s.Pool.QueryRow(ctx, `SELECT engine, fields_enc FROM connections WHERE id = $1 AND user_id = $2`, id, userID).Scan(&engine, &rawEnc); err != nil {
		return kafkaConnFields{}, nil, nil, fmt.Errorf("connection not found")
	}
	if engine != "kafka" {
		return kafkaConnFields{}, nil, nil, fmt.Errorf("connection is not Kafka")
	}
	raw, err := crypto.Decrypt(rawEnc)
	if err != nil {
		return kafkaConnFields{}, nil, nil, fmt.Errorf("decrypt connection fields: %w", err)
	}
	var f kafkaConnFields
	if err := json.Unmarshal(raw, &f); err != nil {
		return f, nil, nil, fmt.Errorf("invalid Kafka connection settings")
	}
	brokers := []string{}
	for _, broker := range strings.Split(f.Brokers, ",") {
		if value := strings.TrimSpace(broker); value != "" {
			brokers = append(brokers, value)
		}
	}
	if len(brokers) == 0 {
		return f, nil, nil, fmt.Errorf("at least one Kafka broker is required")
	}
	dialer := &kafka.Dialer{Timeout: 8 * time.Second, DualStack: true}
	if f.TLS {
		dialer.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	if f.SASLUsername != "" {
		dialer.SASLMechanism = plain.Mechanism{Username: f.SASLUsername, Password: f.SASLPassword}
	}
	return f, dialer, brokers, nil
}

func (s *Server) ListKafkaTopics(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	_, dialer, brokers, err := s.kafkaSettings(r.Context(), user.ID, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	conn, err := dialer.DialContext(r.Context(), "tcp", brokers[0])
	if err != nil {
		writeError(w, http.StatusBadGateway, "could not connect to Kafka: "+err.Error())
		return
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(8 * time.Second))
	partitions, err := conn.ReadPartitions()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	byName := map[string]*kafkaTopic{}
	for _, partition := range partitions {
		if partition.Topic == "" {
			continue
		}
		topic := byName[partition.Topic]
		if topic == nil {
			topic = &kafkaTopic{Name: partition.Topic}
			byName[partition.Topic] = topic
		}
		topic.Partitions++
	}
	// Approximate message counts are independent per partition — dialing
	// each leader and reading its offsets one after another turns a
	// many-partition topic into a many-dial wait; do them concurrently
	// instead so total latency is close to one dial's worth.
	var mu sync.Mutex
	forEachPartition(partitions, func(partition kafka.Partition) {
		if partition.Topic == "" {
			return
		}
		leader, dialErr := dialer.DialLeader(r.Context(), "tcp", brokers[0], partition.Topic, partition.ID)
		if dialErr != nil {
			return
		}
		_ = leader.SetDeadline(time.Now().Add(8 * time.Second))
		first, firstErr := leader.ReadFirstOffset()
		last, lastErr := leader.ReadLastOffset()
		_ = leader.Close()
		if firstErr != nil || lastErr != nil || last <= first {
			return
		}
		mu.Lock()
		byName[partition.Topic].ApproxMessages += last - first
		mu.Unlock()
	})
	topics := make([]kafkaTopic, 0, len(byName))
	for _, topic := range byName {
		topics = append(topics, *topic)
	}
	sort.Slice(topics, func(i, j int) bool { return topics[i].Name < topics[j].Name })
	writeJSON(w, http.StatusOK, topics)
}

func (s *Server) ListKafkaMessages(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	topic := strings.TrimSpace(r.URL.Query().Get("topic"))
	if topic == "" {
		writeError(w, http.StatusBadRequest, "topic is required")
		return
	}
	_, dialer, brokers, err := s.kafkaSettings(r.Context(), user.ID, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	conn, err := dialer.DialContext(r.Context(), "tcp", brokers[0])
	if err != nil {
		writeError(w, http.StatusBadGateway, "could not connect to Kafka: "+err.Error())
		return
	}
	_ = conn.SetDeadline(time.Now().Add(8 * time.Second))
	partitions, err := conn.ReadPartitions(topic)
	_ = conn.Close()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	result := []kafkaMessageResponse{}
	var resultMu sync.Mutex
	perPartition := maxKafkaMessages / max(1, len(partitions))
	// Independent per partition — dialing each leader, seeking, and reading
	// one partition after another turns a many-partition topic into a
	// many-dial wait; do them concurrently instead. Each still reads at most
	// its own perPartition share, and the final sort+cap below already
	// enforces the maxKafkaMessages total regardless of arrival order, so
	// concurrency doesn't change what's ultimately returned.
	forEachPartition(partitions, func(partition kafka.Partition) {
		leader, dialErr := dialer.DialLeader(r.Context(), "tcp", brokers[0], topic, partition.ID)
		if dialErr != nil {
			return
		}
		defer leader.Close()
		_ = leader.SetDeadline(time.Now().Add(8 * time.Second))
		first, firstErr := leader.ReadFirstOffset()
		last, lastErr := leader.ReadLastOffset()
		if firstErr != nil || lastErr != nil {
			return
		}
		start := last - int64(perPartition)
		if start < first {
			start = first
		}
		if _, err := leader.Seek(start, io.SeekStart); err != nil {
			return
		}
		_ = leader.SetReadDeadline(time.Now().Add(2 * time.Second))
		partitionResult := make([]kafkaMessageResponse, 0, perPartition)
		for int64(len(partitionResult)) < int64(perPartition) {
			message, readErr := leader.ReadMessage(1024 * 1024)
			if readErr != nil {
				break
			}
			var key *string
			if message.Key != nil {
				value := string(message.Key)
				key = &value
			}
			headers := map[string]string{}
			for _, header := range message.Headers {
				headers[header.Key] = string(header.Value)
			}
			partitionResult = append(partitionResult, kafkaMessageResponse{Partition: message.Partition, Offset: message.Offset, Timestamp: message.Time.UTC().Format("2006-01-02 15:04:05.000"), Key: key, Value: string(message.Value), Headers: headers})
			if message.Offset+1 >= last {
				break
			}
		}
		resultMu.Lock()
		result = append(result, partitionResult...)
		resultMu.Unlock()
	})
	sort.Slice(result, func(i, j int) bool { return result[i].Timestamp > result[j].Timestamp })
	if len(result) > maxKafkaMessages {
		result = result[:maxKafkaMessages]
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) ProduceKafkaMessage(w http.ResponseWriter, r *http.Request) {
	user, err := auth.Resolve(r.Context(), s.Pool, bearerToken(r))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req struct {
		Topic     string            `json:"topic"`
		Partition int               `json:"partition"`
		Key       *string           `json:"key"`
		Value     string            `json:"value"`
		Headers   map[string]string `json:"headers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Topic) == "" {
		writeError(w, http.StatusBadRequest, "topic is required")
		return
	}
	_, dialer, brokers, err := s.kafkaSettings(r.Context(), user.ID, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	conn, err := dialer.DialLeader(r.Context(), "tcp", brokers[0], req.Topic, req.Partition)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer conn.Close()
	_ = conn.SetWriteDeadline(time.Now().Add(8 * time.Second))
	message := kafka.Message{Value: []byte(req.Value)}
	if req.Key != nil {
		message.Key = []byte(*req.Key)
	}
	for key, value := range req.Headers {
		message.Headers = append(message.Headers, kafka.Header{Key: key, Value: []byte(value)})
	}
	if _, err := conn.WriteMessages(message); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
