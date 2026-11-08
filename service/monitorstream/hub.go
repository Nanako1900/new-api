package monitorstream

import (
	"errors"
	"sync"
)

const subscriberBuffer = 256

// ErrStreamLimit means this node already serves the most streams it allows,
// for the user or in total.
var ErrStreamLimit = errors.New("monitor stream limit reached")

// Subscriber is one open monitor stream.
type Subscriber struct {
	userID   int
	events   chan Event
	overflow chan struct{}
	done     chan struct{}
	doneOnce sync.Once
}

// Events delivers the subscriber's log events in order.
func (s *Subscriber) Events() <-chan Event { return s.events }

// Overflow fires when events were dropped because the stream fell behind; the
// client must re-read its logs.
func (s *Subscriber) Overflow() <-chan struct{} { return s.overflow }

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
	total       int
	maxPerUser  int
	maxTotal    int
	closed      bool
}

func NewHub(maxPerUser, maxTotal int) *Hub {
	return &Hub{subscribers: map[int]map[*Subscriber]struct{}{}, maxPerUser: maxPerUser, maxTotal: maxTotal}
}

// Subscribe opens a stream for userID within the node's stream limits.
func (h *Hub) Subscribe(userID int) (*Subscriber, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.total >= h.maxTotal || len(h.subscribers[userID]) >= h.maxPerUser {
		return nil, ErrStreamLimit
	}
	subscriber := &Subscriber{
		userID:   userID,
		events:   make(chan Event, subscriberBuffer),
		overflow: make(chan struct{}, 1),
		done:     make(chan struct{}),
	}
	if h.subscribers[userID] == nil {
		h.subscribers[userID] = map[*Subscriber]struct{}{}
	}
	h.subscribers[userID][subscriber] = struct{}{}
	h.total++
	return subscriber, nil
}

func (h *Hub) Unsubscribe(subscriber *Subscriber) {
	h.mu.Lock()
	defer h.mu.Unlock()
	streams := h.subscribers[subscriber.userID]
	if _, ok := streams[subscriber]; !ok {
		return
	}
	delete(streams, subscriber)
	h.total--
	if len(streams) == 0 {
		delete(h.subscribers, subscriber.userID)
	}
}

// HasSubscribers reports whether userID has an open stream on this node.
func (h *Hub) HasSubscribers(userID int) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subscribers[userID]) > 0
}

// Users lists the users with an open stream on this node.
func (h *Hub) Users() []int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	users := make([]int, 0, len(h.subscribers))
	for userID := range h.subscribers {
		users = append(users, userID)
	}
	return users
}

// Deliver hands an event to every stream of its user on this node without
// blocking. A stream whose buffer is full is told to resync instead.
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
}

// SignalOverflow tells every stream of userID on this node that it missed
// events.
func (h *Hub) SignalOverflow(userID int) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for subscriber := range h.subscribers[userID] {
		subscriber.signalOverflow()
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
}
