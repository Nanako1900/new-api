package monitorstream

import (
	"context"
	"io"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const (
	// ReplayLimit and ReplayWindow bound what a reconnecting stream replays.
	ReplayLimit  = 200
	ReplayWindow = 10 * time.Minute
)

// StreamOptions are the timings of one stream.
type StreamOptions struct {
	// Since replays rows created at or after this unix second; 0 replays none.
	Since      int64
	Heartbeat  time.Duration
	Revalidate time.Duration
	// BalanceEvery 0 sends no balance events.
	BalanceEvery time.Duration
	BalanceDelay time.Duration
	BatchWindow  time.Duration
	// MaxBatch caps the live rows of one batch, keeping the newest; the batch
	// says how many it left out. 0 sends every row.
	MaxBatch    int
	MaxLifetime time.Duration
}

// DefaultStreamOptions clamps since to the replay window.
func DefaultStreamOptions(since int64, now time.Time) StreamOptions {
	if since > 0 {
		since = max(since, now.Add(-ReplayWindow).Unix())
	}
	return StreamOptions{
		Since:        since,
		Heartbeat:    15 * time.Second,
		Revalidate:   30 * time.Second,
		BalanceEvery: 5 * time.Second,
		BalanceDelay: 300 * time.Millisecond,
		BatchWindow:  200 * time.Millisecond,
		MaxLifetime:  30 * time.Minute,
	}
}

// GlobalStreamMaxBatch and GlobalStreamBatchWindow bound what a site-wide
// stream sends: at most 50 rows a second, however busy the site is.
const (
	GlobalStreamMaxBatch    = 25
	GlobalStreamBatchWindow = 500 * time.Millisecond
)

// GlobalStreamOptions are DefaultStreamOptions for a site-wide stream: capped
// batches and no balance events.
func GlobalStreamOptions(since int64, now time.Time) StreamOptions {
	options := DefaultStreamOptions(since, now)
	options.BalanceEvery = 0
	options.BatchWindow = GlobalStreamBatchWindow
	options.MaxBatch = GlobalStreamMaxBatch
	return options
}

// SessionState is the result of re-checking a stream's monitor session.
type SessionState int

const (
	SessionActive SessionState = iota
	SessionEnded
	// SessionUnknown means the check itself failed. A stream survives a few in
	// a row, then asks the client to reconnect rather than trust a session it
	// cannot verify.
	SessionUnknown
	// SessionForbidden means the session is valid but may no longer read this
	// stream (a site-wide stream of a user who is no longer the root user).
	SessionForbidden
)

const maxUnknownSessionChecks = 3

// StreamSource is what a stream reads from the rest of the system.
type StreamSource struct {
	SessionState func() SessionState
	Quota        func() (int, error)
	Replay       func(since int64, limit int) ([]*model.Log, error)
	// ReplayEvent turns a replayed row into what the stream sends. Nil means
	// the owner's view (NewEvent), or the site-wide view without channel
	// names on a site-wide stream.
	ReplayEvent func(stored model.Log) Event
}

type streamItem struct {
	model.Log
	Key string `json:"key"`
}

type stream struct {
	out        io.Writer
	flush      func() error
	subscriber *Subscriber
	source     StreamSource
	options    StreamOptions
	replayed   map[string]struct{}
	pending    []streamItem
	dropped    int64
	quota      int
	quotaKnown bool
}

// Serve writes one SSE stream until the client leaves, the session ends, the
// lifetime is reached or the hub closes. It returns the write error that ended
// the stream, or nil.
func Serve(ctx context.Context, out io.Writer, flush func() error, subscriber *Subscriber, source StreamSource, options StreamOptions) error {
	s := &stream{out: out, flush: flush, subscriber: subscriber, source: source, options: options, replayed: map[string]struct{}{}}
	if err := s.open(); err != nil {
		return err
	}
	return s.loop(ctx)
}

// open sends the retry hint, hello and the replay. The subscriber already
// buffers live rows, so a row stored during the replay query is not lost; the
// replayed keys drop it if it shows up twice.
func (s *stream) open() error {
	if err := s.write("retry: 3000\n\n"); err != nil {
		return err
	}
	if quota, err := s.source.Quota(); err == nil {
		s.quota, s.quotaKnown = quota, true
	}
	if err := s.send("hello", map[string]any{"server_time": time.Now().Unix(), "quota": s.quota}); err != nil {
		return err
	}
	if s.options.Since <= 0 {
		return nil
	}
	logs, err := s.source.Replay(s.options.Since, ReplayLimit)
	if err != nil {
		common.SysError(common.LogText("failed to replay monitor logs: %s", err.Error()))
		return s.send("resync", map[string]any{})
	}
	replayEvent := s.source.ReplayEvent
	switch {
	case replayEvent != nil:
	case s.subscriber.global:
		// Never the owner's view on a site-wide stream, even without channel names.
		replayEvent = func(stored model.Log) Event { return NewGlobalStreamEvent(stored, "") }
	default:
		replayEvent = NewEvent
	}
	items := make([]streamItem, 0, len(logs))
	for _, stored := range logs {
		event := replayEvent(*stored)
		s.replayed[event.Key] = struct{}{}
		items = append(items, streamItem{Log: event.Log, Key: event.Key})
	}
	if len(items) > 0 {
		if err := s.send("logs", map[string]any{"items": items}); err != nil {
			return err
		}
	}
	if len(logs) >= ReplayLimit {
		return s.send("resync", map[string]any{})
	}
	return nil
}

func (s *stream) loop(ctx context.Context) error {
	heartbeat := time.NewTicker(s.options.Heartbeat)
	defer heartbeat.Stop()
	revalidate := time.NewTicker(s.options.Revalidate)
	defer revalidate.Stop()
	var balance <-chan time.Time
	if s.options.BalanceEvery > 0 {
		ticker := time.NewTicker(s.options.BalanceEvery)
		defer ticker.Stop()
		balance = ticker.C
	}
	lifetime := time.NewTimer(s.options.MaxLifetime)
	defer lifetime.Stop()
	var batch, balanceSoon <-chan time.Time
	unknownChecks := 0
	for {
		var err error
		select {
		case <-ctx.Done():
			return nil
		case <-s.subscriber.Done():
			return s.send("reconnect", map[string]any{})
		case <-lifetime.C:
			return s.send("reconnect", map[string]any{})
		case <-revalidate.C:
			switch s.source.SessionState() {
			case SessionEnded:
				return s.send("revoked", map[string]any{"reason": "session_revoked"})
			case SessionForbidden:
				return s.send("revoked", map[string]any{"reason": "forbidden"})
			case SessionUnknown:
				if unknownChecks++; unknownChecks >= maxUnknownSessionChecks {
					return s.send("reconnect", map[string]any{})
				}
			default:
				unknownChecks = 0
			}
		case event := <-s.subscriber.Events():
			if _, replayed := s.replayed[event.Key]; replayed {
				continue
			}
			s.pending = append(s.pending, streamItem{Log: event.Log, Key: event.Key})
			if s.options.MaxBatch > 0 && len(s.pending) > s.options.MaxBatch {
				s.pending = slices.Delete(s.pending, 0, 1)
				s.dropped++
			}
			if batch == nil {
				batch = time.After(s.options.BatchWindow)
			}
			if balanceSoon == nil && balance != nil {
				balanceSoon = time.After(s.options.BalanceDelay)
			}
		case <-batch:
			batch = nil
			err = s.flushPending()
		case <-balanceSoon:
			balanceSoon = nil
			err = s.sendBalanceIfChanged()
		case <-balance:
			err = s.sendBalanceIfChanged()
		case <-s.subscriber.Overflow():
			s.pending, batch = nil, nil
			err = s.send("resync", map[string]any{})
		case <-heartbeat.C:
			err = s.write(": ping\n\n")
		}
		if err != nil {
			return err
		}
	}
}

func (s *stream) flushPending() error {
	dropped := s.dropped + s.subscriber.TakeDropped()
	if len(s.pending) == 0 && dropped == 0 {
		return nil
	}
	data := map[string]any{"items": s.pending}
	if s.pending == nil {
		data["items"] = []streamItem{}
	}
	if dropped > 0 {
		data["dropped"] = dropped
	}
	s.pending, s.dropped = nil, 0
	return s.send("logs", data)
}

func (s *stream) sendBalanceIfChanged() error {
	quota, err := s.source.Quota()
	if err != nil || (s.quotaKnown && quota == s.quota) {
		return nil
	}
	s.quota, s.quotaKnown = quota, true
	return s.send("balance", map[string]any{"quota": quota})
}

func (s *stream) send(event string, data any) error {
	payload, err := common.Marshal(data)
	if err != nil {
		return err
	}
	var frame strings.Builder
	frame.WriteString("event: ")
	frame.WriteString(event)
	frame.WriteString("\ndata: ")
	frame.Write(payload)
	frame.WriteString("\n\n")
	return s.write(frame.String())
}

func (s *stream) write(frame string) error {
	if _, err := io.WriteString(s.out, frame); err != nil {
		return err
	}
	return s.flush()
}
