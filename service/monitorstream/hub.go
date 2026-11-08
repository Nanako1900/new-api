package monitorstream

import (
	"errors"
	"sync"
	"sync/atomic"
)

const subscriberBuffer = 256

// ErrStreamLimit means this node already serves the most streams it allows,
// for the user or in total.
var ErrStreamLimit = errors.New("monitor stream limit reached")

// Subscriber is one open monitor stream: a user's own rows, or every user's
// rows for a site-wide stream.
type Subscriber struct {
	userID   int
	global   bool
	events   chan Event
	overflow chan struct{}
	dropped  atomic.Int64
	done     chan struct{}
	doneOnce sync.Once
}

// Events delivers the subscriber's log events in order.
func (s *Subscriber) Events() <-chan Event { return s.events }

// Overflow fires when events were dropped because the stream fell behind; the
// client must re-read its logs. Site-wide streams count dropped rows instead.
func (s *Subscriber) Overflow() <-chan struct{} { return s.overflow }

// TakeDropped returns how many rows a site-wide stream missed since the last
// call, and resets the count.
func (s *Subscriber) TakeDropped() int64 { return s.dropped.Swap(0) }

// Done is closed when the hub shuts down.
func (s *Subscriber) Done() <-chan struct{} { return s.done }

func (s *Subscriber) signalOverflow() {
	select {
	case s.overflow <- struct{}{}:
	default:
	}
}

// Hub fans log events out to the open streams on this node.
type Hub struct {
	mu          sync.RWMutex
	subscribers map[int]map[*Subscriber]struct{}
	global      map[*Subscriber]struct{}
	perUser     map[int]int
	globalCount atomic.Int32 // len(global), read without the lock on the relay path
	total       int
	maxPerUser  int
	maxTotal    int
	closed      bool
}

func NewHub(maxPerUser, maxTotal int) *Hub {
	return &Hub{
		subscribers: map[int]map[*Subscriber]struct{}{},
		global:      map[*Subscriber]struct{}{},
		perUser:     map[int]int{},
		maxPerUser:  maxPerUser,
		maxTotal:    maxTotal,
	}
}

// Subscribe opens a stream of userID's own rows within the node's limits.
func (h *Hub) Subscribe(userID int) (*Subscriber, error) {
	return h.subscribe(userID, false)
}

// SubscribeGlobal opens a stream of every user's rows for userID. The caller
// has checked that userID may see the whole site. It counts toward the same
// limits as the user's own streams.
func (h *Hub) SubscribeGlobal(userID int) (*Subscriber, error) {
	return h.subscribe(userID, true)
}

func (h *Hub) subscribe(userID int, global bool) (*Subscriber, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.total >= h.maxTotal || h.perUser[userID] >= h.maxPerUser {
		return nil, ErrStreamLimit
	}
	subscriber := &Subscriber{
		userID:   userID,
		global:   global,
		events:   make(chan Event, subscriberBuffer),
		overflow: make(chan struct{}, 1),
		done:     make(chan struct{}),
	}
	if global {
		h.global[subscriber] = struct{}{}
		h.globalCount.Store(int32(len(h.global)))
	} else {
		if h.subscribers[userID] == nil {
			h.subscribers[userID] = map[*Subscriber]struct{}{}
		}
		h.subscribers[userID][subscriber] = struct{}{}
	}
	h.perUser[userID]++
	h.total++
	return subscriber, nil
}

func (h *Hub) Unsubscribe(subscriber *Subscriber) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if subscriber.global {
		if _, ok := h.global[subscriber]; !ok {
			return
		}
		delete(h.global, subscriber)
		h.globalCount.Store(int32(len(h.global)))
	} else {
		streams := h.subscribers[subscriber.userID]
		if _, ok := streams[subscriber]; !ok {
			return
		}
		delete(streams, subscriber)
		if len(streams) == 0 {
			delete(h.subscribers, subscriber.userID)
		}
	}
	h.total--
	if h.perUser[subscriber.userID]--; h.perUser[subscriber.userID] <= 0 {
		delete(h.perUser, subscriber.userID)
	}
}

// HasSubscribers reports whether userID has an open stream of their own rows
// on this node.
func (h *Hub) HasSubscribers(userID int) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subscribers[userID]) > 0
}

// HasGlobalSubscribers reports whether a site-wide stream is open on this
// node. It takes no lock: the hook calls it for every stored row.
func (h *Hub) HasGlobalSubscribers() bool {
	return h.globalCount.Load() > 0
}

// Users lists the users with an open stream of their own rows on this node.
func (h *Hub) Users() []int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	users := make([]int, 0, len(h.subscribers))
	for userID := range h.subscribers {
		users = append(users, userID)
	}
	return users
}

// Deliver hands an event to every stream of its user on this node, and its
// site-wide view to every site-wide stream, without blocking. A user stream
// whose buffer is full is told to resync; a site-wide stream counts the row as
// dropped.
func (h *Hub) Deliver(event Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for subscriber := range h.subscribers[event.UserID] {
		select {
		case subscriber.events <- event:
		default:
			subscriber.signalOverflow()
		}
	}
	if event.Global == nil {
		return
	}
	global := event.siteWide()
	for subscriber := range h.global {
		select {
		case subscriber.events <- global:
		default:
			subscriber.dropped.Add(1)
		}
	}
}

// SignalOverflow tells every stream of userID's own rows on this node that it
// missed events.
func (h *Hub) SignalOverflow(userID int) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for subscriber := range h.subscribers[userID] {
		subscriber.signalOverflow()
	}
}

// AddGlobalDropped counts request rows every site-wide stream on this node
// missed (left out by a publisher's budget or a full queue, on any node).
func (h *Hub) AddGlobalDropped(rows int64) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for subscriber := range h.global {
		subscriber.dropped.Add(rows)
	}
}

// Close ends every stream and refuses new ones.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	for _, streams := range h.subscribers {
		for subscriber := range streams {
			subscriber.doneOnce.Do(func() { close(subscriber.done) })
		}
	}
	for subscriber := range h.global {
		subscriber.doneOnce.Do(func() { close(subscriber.done) })
	}
}
