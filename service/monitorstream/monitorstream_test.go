package monitorstream

import (
	"context"
	"strconv"
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
	return startStreamWith(t, false, since, replay)
}

// startStreamWith serves user 7's own stream, or a site-wide stream for user 7
// when global is set.
func startStreamWith(t *testing.T, global bool, since int64, replay []*model.Log) *streamHarness {
	t.Helper()
	h := &streamHarness{hub: NewHub(5, 10), out: &syncBuffer{}, done: make(chan error, 1)}
	subscribe := h.hub.Subscribe
	if global {
		subscribe = h.hub.SubscribeGlobal
	}
	subscriber, err := subscribe(7)
	require.NoError(t, err)
	h.subscriber = subscriber
	h.quota.Store(1000)
	source := StreamSource{
		SessionState: func() SessionState { return SessionState(h.session.Load()) },
		Quota:        func() (int, error) { return int(h.quota.Load()), nil },
		Replay:       func(int64, int) ([]*model.Log, error) { return replay, nil },
	}
	options := DefaultStreamOptions(0, time.Now())
	if global {
		options = GlobalStreamOptions(0, time.Now())
	}
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

	publisherB := &publisher{hub: hubB, bridge: bridgeB, queue: make(chan queuedLog, 8)}
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
	assert.False(t, publisherB.ownerWanted(6), "rows of users nobody streams are not queued")
	assert.False(t, publisherB.globalWanted(model.Log{UserId: 6, Type: model.LogTypeConsume}))
}

// siteWideEvent is the event the publisher makes for a request row while a
// site-wide stream is open.
func siteWideEvent(stored model.Log) Event {
	return NewEvent(stored).WithGlobalView(stored, "channel-"+stored.ModelName)
}

func TestGlobalStreamCapsEachBatchAndCountsWhatItLeftOut(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := startStreamWith(t, true, 0, nil)

		h.quota.Store(10)
		for i := range 30 {
			stored := consumeLog(100+i, 300, "m"+strconv.Itoa(i))
			stored.UserId = 50 + i
			h.hub.Deliver(siteWideEvent(stored))
		}
		h.hub.Deliver(NewEvent(consumeLog(200, 300, "owner-view-only")))
		time.Sleep(10 * time.Second)
		h.cancel()
		require.NoError(t, <-h.done)

		events := h.out.events(t)
		require.Equal(t, []string{"hello", "logs"}, eventNames(events), "a site-wide stream sends no balance events")
		models := itemModels(t, events[1])
		require.Len(t, models, GlobalStreamMaxBatch)
		assert.Equal(t, "m5", models[0], "the newest rows are kept")
		assert.Equal(t, "m29", models[len(models)-1])
		assert.EqualValues(t, 5, events[1].data["dropped"])
		first := events[1].data["items"].([]any)[0].(map[string]any)
		assert.Equal(t, "channel-m5", first["channel_name"], "items are the site-wide view")
		assert.EqualValues(t, 55, first["user_id"])
	})
}

func TestGlobalStreamIsRevokedWhenTheUserIsNoLongerRoot(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := startStreamWith(t, true, 0, nil)

		h.session.Store(int32(SessionForbidden))
		time.Sleep(31 * time.Second)

		require.NoError(t, <-h.done)
		events := h.out.events(t)
		last := events[len(events)-1]
		assert.Equal(t, "revoked", last.name)
		assert.Equal(t, "forbidden", last.data["reason"])
	})
}

func TestHubSendsTheSiteWideViewOnlyToSiteWideStreams(t *testing.T) {
	hub := NewHub(2, 10)
	global, err := hub.SubscribeGlobal(1)
	require.NoError(t, err)
	owner, err := hub.Subscribe(2)
	require.NoError(t, err)

	stored := model.Log{Id: 9, UserId: 2, Type: model.LogTypeConsume, ModelName: "m", Ip: "203.0.113.9"}
	hub.Deliver(siteWideEvent(stored))
	hub.Deliver(NewEvent(model.Log{Id: 10, UserId: 3, Type: model.LogTypeTopup}))

	require.Len(t, owner.Events(), 1)
	assert.Empty(t, (<-owner.Events()).Log.ChannelName, "the owner gets the owner's view")
	require.Len(t, global.Events(), 1, "a row without a site-wide view is not sent to site-wide streams")
	received := <-global.Events()
	assert.Equal(t, "channel-m", received.Log.ChannelName)
	assert.Empty(t, received.Log.Ip)
	assert.Nil(t, received.Global)

	_, err = hub.Subscribe(1)
	require.NoError(t, err)
	_, err = hub.SubscribeGlobal(1)
	assert.ErrorIs(t, err, ErrStreamLimit, "site-wide streams count toward the per-user limit")
	hub.Unsubscribe(global)
	assert.False(t, hub.HasGlobalSubscribers())
	_, err = hub.SubscribeGlobal(1)
	assert.NoError(t, err, "closing a site-wide stream frees its slot")
}

func TestHubCountsDroppedRowsInsteadOfResyncingSiteWideStreams(t *testing.T) {
	hub := NewHub(5, 10)
	global, err := hub.SubscribeGlobal(1)
	require.NoError(t, err)

	for i := range subscriberBuffer + 3 {
		hub.Deliver(siteWideEvent(model.Log{Id: i + 1, UserId: 2, Type: model.LogTypeConsume}))
	}
	hub.AddGlobalDropped(10)

	assert.Len(t, global.Events(), subscriberBuffer)
	assert.Empty(t, global.Overflow(), "a busy site must not make the console re-read its logs over and over")
	assert.EqualValues(t, 13, global.TakeDropped())
	assert.Zero(t, global.TakeDropped())
}

func TestWithGlobalViewIsTheAdminViewWithoutTheIP(t *testing.T) {
	stored := model.Log{Id: 5, UserId: 1, CreatedAt: 10, Type: model.LogTypeConsume, ModelName: "m", Username: "alice", Ip: "203.0.113.9",
		Other: common.MapToJsonStr(map[string]any{"frt": 120, "admin_info": map[string]any{"use_channel": []any{"9"}}, "root_info": map[string]any{"upstream": "x"}})}

	event := NewEvent(stored).WithGlobalView(stored, "upstream-a")

	require.NotNil(t, event.Global)
	assert.Equal(t, NewEvent(stored).Key, event.Key)
	assert.Equal(t, NewEvent(stored).Log, event.Log, "the owner's view is unchanged")
	assert.Zero(t, event.Global.Id)
	assert.Empty(t, event.Global.Ip)
	assert.Equal(t, "alice", event.Global.Username)
	assert.Equal(t, "upstream-a", event.Global.ChannelName)
	assert.Contains(t, event.Global.Other, "admin_info")
	assert.NotContains(t, event.Global.Other, "root_info")
}

func startBridgedNodes(t *testing.T) (context.Context, *Hub, *bridge, *Hub, *bridge, func() *redis.Client) {
	t.Helper()
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
	go bridgeA.run(ctx)
	go bridgeB.run(ctx)
	return ctx, hubA, bridgeA, hubB, bridgeB, newClient
}

func TestBridgeForwardsRequestRowsToASiteWideStreamOnAnotherNode(t *testing.T) {
	ctx, hubA, bridgeA, hubB, bridgeB, _ := startBridgedNodes(t)
	global, err := hubA.SubscribeGlobal(1)
	require.NoError(t, err)
	require.Eventually(t, bridgeB.globalElsewhere, 2*time.Second, 5*time.Millisecond, "node B learns that node A streams the whole site")
	assert.False(t, bridgeA.globalElsewhere(), "a node does not count its own site-wide stream as remote")

	publisherB := &publisher{hub: hubB, bridge: bridgeB, queue: make(chan queuedLog, 8)}
	go publisherB.run(ctx)
	topUp := model.Log{Id: 41, UserId: 9, CreatedAt: 1, Type: model.LogTypeTopup, ModelName: "top-up"}
	assert.False(t, publisherB.globalWanted(topUp), "only request rows go to site-wide streams")
	publisherB.observe(topUp)
	publisherB.observe(model.Log{Id: 42, UserId: 9, CreatedAt: 1, Type: model.LogTypeConsume, ModelName: "remote-row", Username: "bob", Ip: "203.0.113.9"})

	select {
	case event := <-global.Events():
		assert.Equal(t, "remote-row", event.Log.ModelName)
		assert.Equal(t, "bob", event.Log.Username)
		assert.Empty(t, event.Log.Ip)
	case <-time.After(2 * time.Second):
		t.Fatal("a request row stored on node B must reach the site-wide stream on node A")
	}
	assert.Empty(t, global.Events(), "the top-up row is not forwarded")

	publisherB.globalDropped.Store(7)
	publisherB.reportGlobalDropped(ctx)
	require.Eventually(t, func() bool { return global.dropped.Load() == 7 }, 2*time.Second, 5*time.Millisecond,
		"rows node B left out are counted on node A's site-wide stream")

	hubA.Unsubscribe(global)
	require.Eventually(t, func() bool { return !bridgeB.globalElsewhere() }, 2*time.Second, 5*time.Millisecond,
		"closing the last site-wide stream withdraws its advertisement at once")
}

func TestBridgeKeepsTheSiteWideViewOnItsNodeWhenOnlyTheOwnerStreamsElsewhere(t *testing.T) {
	ctx, hubA, _, hubB, bridgeB, _ := startBridgedNodes(t)
	owner, err := hubA.Subscribe(5)
	require.NoError(t, err)
	localGlobal, err := hubB.SubscribeGlobal(1)
	require.NoError(t, err)
	require.Eventually(t, func() bool { return bridgeB.streamsElsewhere(5) }, 2*time.Second, 5*time.Millisecond)

	publisherB := &publisher{hub: hubB, bridge: bridgeB, queue: make(chan queuedLog, 8)}
	go publisherB.run(ctx)
	publisherB.observe(model.Log{Id: 43, UserId: 5, CreatedAt: 1, Type: model.LogTypeConsume, ModelName: "owned-row"})

	select {
	case event := <-owner.Events():
		assert.Equal(t, "owned-row", event.Log.ModelName)
		assert.Nil(t, event.Global, "the site-wide view leaves node B only for a site-wide stream elsewhere")
	case <-time.After(2 * time.Second):
		t.Fatal("the owner's stream on node A must get the row")
	}
	require.Eventually(t, func() bool { return len(localGlobal.Events()) == 1 }, 2*time.Second, 5*time.Millisecond,
		"node B's own site-wide stream still gets it")
}

func TestPublisherGivesSiteWideViewsOnlyWithinItsBudget(t *testing.T) {
	hub := NewHub(5, 10)
	global, err := hub.SubscribeGlobal(1)
	require.NoError(t, err)
	_, err = hub.Subscribe(2)
	require.NoError(t, err)
	p := &publisher{hub: hub, queue: make(chan queuedLog, 100)}

	for i := range globalBudget + 10 {
		p.observe(model.Log{Id: i + 1, UserId: 3, Type: model.LogTypeConsume})
	}
	p.observe(model.Log{Id: 900, UserId: 2, Type: model.LogTypeConsume})
	p.observe(model.Log{Id: 901, UserId: 3, Type: model.LogTypeLogin})

	require.Len(t, p.queue, globalBudget+1, "rows past the budget are not queued unless their owner streams")
	var owned queuedLog
	for range globalBudget + 1 {
		owned = <-p.queue
	}
	assert.Equal(t, 900, owned.stored.Id, "an owner's row is queued even past the budget")
	assert.False(t, owned.global, "but without a site-wide view")

	p.reportGlobalDropped(context.Background())
	assert.EqualValues(t, 11, global.TakeDropped(), "every request row left out is reported; the login row is not one")

	p.globalSent.Store(0)
	p.observe(model.Log{Id: 902, UserId: 3, Type: model.LogTypeError})
	require.Len(t, p.queue, 1, "a new budget window takes rows again")
}

func TestGlobalStreamReplaysTheSiteWideViewByDefault(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		stored := consumeLog(1, 100, "replayed")
		stored.UserId, stored.Ip = 40, "203.0.113.5"
		h := startStreamWith(t, true, 100, []*model.Log{&stored})
		h.cancel()
		require.NoError(t, <-h.done)

		events := h.out.events(t)
		require.Equal(t, []string{"hello", "logs"}, eventNames(events))
		item := events[1].data["items"].([]any)[0].(map[string]any)
		assert.Empty(t, item["ip"], "a site-wide replay never falls back to the owner's view")
		assert.EqualValues(t, 40, item["user_id"])
	})
}
