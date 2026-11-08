package monitorstream

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type syncBuffer struct {
	mu      sync.Mutex
	builder strings.Builder
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.builder.Write(p)
}

type sseEvent struct {
	name string
	data map[string]any
}

// events parses the SSE frames written so far; a ping comment is ":ping".
func (b *syncBuffer) events(t *testing.T) []sseEvent {
	t.Helper()
	b.mu.Lock()
	raw := b.builder.String()
	b.mu.Unlock()
	var events []sseEvent
	for frame := range strings.SplitSeq(raw, "\n\n") {
		switch {
		case frame == "" || strings.HasPrefix(frame, "retry:"):
			continue
		case strings.HasPrefix(frame, ":"):
			events = append(events, sseEvent{name: ":ping"})
			continue
		}
		var event sseEvent
		for line := range strings.SplitSeq(frame, "\n") {
			if name, ok := strings.CutPrefix(line, "event: "); ok {
				event.name = name
			}
			if data, ok := strings.CutPrefix(line, "data: "); ok {
				require.NoError(t, common.UnmarshalJsonStr(data, &event.data))
			}
		}
		events = append(events, event)
	}
	return events
}

func eventNames(events []sseEvent) []string {
	names := make([]string, 0, len(events))
	for _, event := range events {
		names = append(names, event.name)
	}
	return names
}

func itemModels(t *testing.T, event sseEvent) []string {
	t.Helper()
	items, ok := event.data["items"].([]any)
	require.True(t, ok, "event %s carries items", event.name)
	models := make([]string, 0, len(items))
	for _, item := range items {
		models = append(models, item.(map[string]any)["model_name"].(string))
	}
	return models
}

type streamHarness struct {
	hub        *Hub
	subscriber *Subscriber
	out        *syncBuffer
	quota      atomic.Int64
	session    atomic.Int32
	cancel     context.CancelFunc
	done       chan error
}

// startStream serves a stream for user 7 inside the current synctest bubble.
func startStream(t *testing.T, since int64, replay []*model.Log) *streamHarness {
	t.Helper()
	h := &streamHarness{hub: NewHub(5, 10), out: &syncBuffer{}, done: make(chan error, 1)}
	subscriber, err := h.hub.Subscribe(7)
	require.NoError(t, err)
	h.subscriber = subscriber
	h.quota.Store(1000)
	source := StreamSource{
		SessionState: func() SessionState { return SessionState(h.session.Load()) },
		Quota:        func() (int, error) { return int(h.quota.Load()), nil },
		Replay:       func(int64, int) ([]*model.Log, error) { return replay, nil },
	}
	options := DefaultStreamOptions(0, time.Now())
	options.Since = since
	ctx, cancel := context.WithCancel(context.Background())
	h.cancel = cancel
	go func() { h.done <- Serve(ctx, h.out, func() error { return nil }, subscriber, source, options) }()
	synctest.Wait()
	return h
}

func consumeLog(id int, createdAt int64, modelName string) model.Log {
	return model.Log{Id: id, UserId: 7, CreatedAt: createdAt, Type: model.LogTypeConsume, ModelName: modelName}
}

func TestStreamReplaysThenStreamsEachLiveRowOnce(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		first, second := consumeLog(1, 100, "replayed-a"), consumeLog(2, 101, "replayed-b")
		h := startStream(t, 100, []*model.Log{&first, &second})

		h.hub.Deliver(NewEvent(second))
		h.hub.Deliver(NewEvent(consumeLog(3, 102, "live-c")))
		time.Sleep(time.Second)
		h.cancel()
		require.NoError(t, <-h.done)

		events := h.out.events(t)
		require.Equal(t, []string{"hello", "logs", "logs"}, eventNames(events))
		assert.EqualValues(t, 1000, events[0].data["quota"])
		assert.Equal(t, []string{"replayed-a", "replayed-b"}, itemModels(t, events[1]))
		assert.Equal(t, []string{"live-c"}, itemModels(t, events[2]), "a live row already replayed is not sent again")
	})
}

func TestStreamBatchesLiveRowsAndReportsTheNewBalance(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := startStream(t, 0, nil)

		h.quota.Store(940)
		for i, name := range []string{"a", "b", "c"} {
			h.hub.Deliver(NewEvent(consumeLog(10+i, 200, name)))
		}
		time.Sleep(time.Second)
		h.cancel()
		require.NoError(t, <-h.done)

		events := h.out.events(t)
		require.Equal(t, []string{"hello", "logs", "balance"}, eventNames(events))
		assert.Equal(t, []string{"a", "b", "c"}, itemModels(t, events[1]), "rows within the batch window share one event")
		assert.EqualValues(t, 940, events[2].data["quota"])
	})
}

func TestStreamPingsAndClosesWhenTheSessionEnds(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := startStream(t, 0, nil)

		time.Sleep(16 * time.Second)
		assert.Contains(t, eventNames(h.out.events(t)), ":ping")
		h.session.Store(int32(SessionEnded))
		time.Sleep(30 * time.Second)

		select {
		case err := <-h.done:
			require.NoError(t, err)
		default:
			t.Fatal("the stream must close once the session ended")
		}
		events := h.out.events(t)
		last := events[len(events)-1]
		assert.Equal(t, "revoked", last.name)
		assert.Equal(t, "session_revoked", last.data["reason"])
	})
}

func TestStreamReconnectsWhenTheSessionCannotBeVerified(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := startStream(t, 0, nil)
		h.session.Store(int32(SessionUnknown))

		time.Sleep(61 * time.Second)
		select {
		case <-h.done:
			t.Fatal("two failed checks in a row are tolerated")
		default:
		}
		time.Sleep(30 * time.Second)

		require.NoError(t, <-h.done)
		names := eventNames(h.out.events(t))
		assert.Equal(t, "reconnect", names[len(names)-1], "an unverifiable session ends the stream without claiming it was revoked")
	})
}

func TestStreamAsksToReconnectAtItsLifetimeOrOnShutdown(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := startStream(t, 0, nil)
		time.Sleep(30*time.Minute + time.Second)
		require.NoError(t, <-h.done)
		names := eventNames(h.out.events(t))
		assert.Equal(t, "reconnect", names[len(names)-1])
	})
	synctest.Test(t, func(t *testing.T) {
		h := startStream(t, 0, nil)
		h.hub.Close()
		synctest.Wait()
		require.NoError(t, <-h.done)
		names := eventNames(h.out.events(t))
		assert.Equal(t, "reconnect", names[len(names)-1])
	})
}

func TestStreamAsksForResyncWhenRowsMayBeMissing(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		replay := make([]*model.Log, 0, ReplayLimit)
		for i := range ReplayLimit {
			row := consumeLog(i+1, 300, "replayed")
			replay = append(replay, &row)
		}
		h := startStream(t, 300, replay)

		h.hub.SignalOverflow(7)
		synctest.Wait()
		h.cancel()
		require.NoError(t, <-h.done)

		assert.Equal(t, []string{"hello", "logs", "resync", "resync"}, eventNames(h.out.events(t)),
			"a full replay window and dropped live rows both ask the client to re-read")
	})
}

func TestDefaultStreamOptionsClampSinceToTheReplayWindow(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	assert.Equal(t, now.Add(-ReplayWindow).Unix(), DefaultStreamOptions(1, now).Since)
	assert.Equal(t, now.Unix()-30, DefaultStreamOptions(now.Unix()-30, now).Since)
	assert.Zero(t, DefaultStreamOptions(0, now).Since, "no since replays nothing")
}

func TestHubDeliversOnlyToTheRowOwner(t *testing.T) {
	hub := NewHub(5, 10)
	owner, err := hub.Subscribe(1)
	require.NoError(t, err)
	other, err := hub.Subscribe(2)
	require.NoError(t, err)

	hub.Deliver(NewEvent(model.Log{Id: 1, UserId: 1}))

	assert.Len(t, owner.Events(), 1)
	assert.Empty(t, other.Events())
}

func TestHubEnforcesStreamLimits(t *testing.T) {
	hub := NewHub(2, 3)
	first, err := hub.Subscribe(1)
	require.NoError(t, err)
	_, err = hub.Subscribe(1)
	require.NoError(t, err)
	_, err = hub.Subscribe(1)
	assert.ErrorIs(t, err, ErrStreamLimit, "per-user limit")
	_, err = hub.Subscribe(2)
	require.NoError(t, err)
	_, err = hub.Subscribe(3)
	assert.ErrorIs(t, err, ErrStreamLimit, "per-node limit")

	hub.Unsubscribe(first)
	_, err = hub.Subscribe(3)
	assert.NoError(t, err, "closing a stream frees its slot")
}

func TestHubSignalsOverflowWhenAStreamFallsBehind(t *testing.T) {
	hub := NewHub(5, 10)
	subscriber, err := hub.Subscribe(1)
	require.NoError(t, err)

	for i := range subscriberBuffer + 1 {
		hub.Deliver(NewEvent(model.Log{Id: i + 1, UserId: 1}))
	}

	assert.Len(t, subscriber.Events(), subscriberBuffer)
	assert.Len(t, subscriber.Overflow(), 1)
}

func TestNewEventShowsOnlyTheOwnersViewWithAStableKey(t *testing.T) {
	stored := model.Log{Id: 5, UserId: 1, CreatedAt: 10, ChannelName: "upstream", ModelName: "m",
		Other: common.MapToJsonStr(map[string]any{"frt": 120, "admin_info": map[string]any{"use_channel": []any{"9"}}})}

	event := NewEvent(stored)

	assert.Equal(t, 1, event.UserID)
	assert.Zero(t, event.Log.Id, "the stored id never leaves the server")
	assert.Empty(t, event.Log.ChannelName)
	assert.NotContains(t, event.Log.Other, "admin_info")
	assert.Contains(t, event.Log.Other, "frt")
	assert.Equal(t, event.Key, NewEvent(stored).Key)
	stored.Id = 6
	assert.NotEqual(t, event.Key, NewEvent(stored).Key)

	rowWithoutID := model.Log{UserId: 1, CreatedAt: 10, RequestId: "req-1", ModelName: "m"}
	assert.Equal(t, NewEvent(rowWithoutID).Key, NewEvent(rowWithoutID).Key, "ClickHouse rows key on their content")
	rowWithoutID.Quota = 3
	assert.NotEqual(t, NewEvent(model.Log{UserId: 1, CreatedAt: 10, RequestId: "req-1", ModelName: "m"}).Key, NewEvent(rowWithoutID).Key)
}

func TestBridgeForwardsRowsToStreamsOnAnotherNode(t *testing.T) {
	server := miniredis.RunT(t)
	newClient := func() *redis.Client {
		client := redis.NewClient(&redis.Options{Addr: server.Addr()})
		t.Cleanup(func() { _ = client.Close() })
		return client
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	hubA, hubB := NewHub(5, 10), NewHub(5, 10)
	bridgeA := newBridge(newClient(), hubA, 10*time.Millisecond, time.Minute)
	bridgeB := newBridge(newClient(), hubB, 10*time.Millisecond, time.Minute)
	subscriber, err := hubA.Subscribe(5)
	require.NoError(t, err)
	go bridgeA.run(ctx)
	go bridgeB.run(ctx)
	require.Eventually(t, func() bool { return bridgeB.streamsElsewhere(5) }, 2*time.Second, 5*time.Millisecond,
		"node B learns that node A streams user 5")
	assert.False(t, bridgeA.streamsElsewhere(5), "a node does not count its own streams as remote")

	forged, err := common.Marshal(bridgeMessage{Origin: "another-deployment", Event: `{"user_id":5,"key":"forged","log":{"model_name":"forged-row"}}`, MAC: "not-a-valid-signature"})
	require.NoError(t, err)
	require.NoError(t, newClient().Publish(ctx, bridgeA.topic, forged).Err())

	publisherB := &publisher{hub: hubB, bridge: bridgeB, queue: make(chan model.Log, 8)}
	go publisherB.run(ctx)
	publisherB.observe(model.Log{Id: 42, UserId: 5, CreatedAt: 1, ModelName: "remote-row"})
	publisherB.observe(model.Log{Id: 43, UserId: 6, CreatedAt: 1, ModelName: "nobody-streams"})

	select {
	case event := <-subscriber.Events():
		assert.Equal(t, "remote-row", event.Log.ModelName, "an unsigned event from another deployment is dropped")
		assert.Equal(t, NewEvent(model.Log{Id: 42, UserId: 5, CreatedAt: 1, ModelName: "remote-row"}).Key, event.Key)
	case <-time.After(2 * time.Second):
		t.Fatal("the row stored on node B must reach the stream on node A")
	}
	assert.False(t, publisherB.wanted(6), "rows of users nobody streams are not queued")
}
