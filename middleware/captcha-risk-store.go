package middleware

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/go-redis/redis/v8"
)

const (
	// captchaRiskMaxMembers caps every event set to its newest members. The
	// largest limit is far below it, so the cap never hides a risk signal.
	captchaRiskMaxMembers = 256
	// captchaRiskMaxMemoryKeys bounds the memory store of a node without Redis.
	captchaRiskMaxMemoryKeys = 100_000
	captchaRiskPruneInterval = time.Minute
)

var errCaptchaRiskStoreFull = errors.New("captcha risk memory store is full")

// captchaRiskStore keeps sliding-window event sets for the risk-based GeeTest
// gate. A member is an event (unique member) or a subject such as a username
// hash (the score is then its latest event). Times are kept as unix
// milliseconds.
type captchaRiskStore interface {
	// Reserve records member at now in one atomic step: it drops members
	// older than window, reports how many members the window held before the
	// call and whether member was one of them, adds or refreshes member, and
	// keeps the key for window after now.
	Reserve(ctx context.Context, key, member string, now time.Time, window time.Duration) (prior int, present bool, err error)
	// Remove withdraws member from key.
	Remove(ctx context.Context, key, member string) error
	// SetHold starts a hold until the given time unless one is active at now,
	// and reports whether this call started it.
	SetHold(ctx context.Context, key string, now, until time.Time) (bool, error)
	HoldActive(ctx context.Context, key string, now time.Time) (bool, error)
}

// captchaRiskMemory is the store of a node without Redis. Every node counts
// on its own in that setup.
var captchaRiskMemory = newMemoryCaptchaRiskStore(captchaRiskMaxMemoryKeys)

func currentCaptchaRiskStore() (captchaRiskStore, error) {
	if !common.RedisEnabled {
		return captchaRiskMemory, nil
	}
	if common.RDB == nil {
		return nil, errors.New("Redis client is not initialized")
	}
	return redisCaptchaRiskStore{client: common.RDB}, nil
}

type redisCaptchaRiskStore struct {
	client *redis.Client
}

// redisCaptchaRiskReserveScript implements Reserve. KEYS[1] is the event set;
// ARGV is now (ms), the oldest score kept (ms), member, the key TTL (ms) and
// the member cap.
const redisCaptchaRiskReserveScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', '(' .. ARGV[2])
local prior = redis.call('ZCARD', KEYS[1])
local present = redis.call('ZSCORE', KEYS[1], ARGV[3])
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -tonumber(ARGV[5]) - 1)
redis.call('PEXPIRE', KEYS[1], ARGV[4])
if present then
  return {prior, 1}
end
return {prior, 0}
`

func (store redisCaptchaRiskStore) Reserve(ctx context.Context, key, member string, now time.Time, window time.Duration) (int, bool, error) {
	nowMs := now.UnixMilli()
	values, err := store.client.Eval(ctx, redisCaptchaRiskReserveScript, []string{key},
		nowMs, nowMs-window.Milliseconds(), member, window.Milliseconds(), captchaRiskMaxMembers).Slice()
	if err != nil {
		return 0, false, err
	}
	if len(values) != 2 {
		return 0, false, fmt.Errorf("unexpected Redis risk reply length %d", len(values))
	}
	prior, err := redisReplyInteger(values[0])
	if err != nil {
		return 0, false, err
	}
	present, err := redisReplyInteger(values[1])
	if err != nil {
		return 0, false, err
	}
	return int(prior), present == 1, nil
}

func (store redisCaptchaRiskStore) Remove(ctx context.Context, key, member string) error {
	return store.client.ZRem(ctx, key, member).Err()
}

func (store redisCaptchaRiskStore) SetHold(ctx context.Context, key string, now, until time.Time) (bool, error) {
	ttl := until.Sub(now)
	if ttl <= 0 {
		return false, nil
	}
	return store.client.SetNX(ctx, key, until.UnixMilli(), ttl).Result()
}

func (store redisCaptchaRiskStore) HoldActive(ctx context.Context, key string, now time.Time) (bool, error) {
	until, err := store.client.Get(ctx, key).Int64()
	if errors.Is(err, redis.Nil) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return until > now.UnixMilli(), nil
}

type captchaRiskEntry struct {
	members   map[string]int64 // member -> unix ms of its latest event; nil for a hold
	expiresAt time.Time
}

// memoryCaptchaRiskStore holds at most maxKeys keys. When it is full of live
// keys it cannot tell whether an unknown key would have been recorded, so
// reads of unknown keys fail and the gate requires the check.
type memoryCaptchaRiskStore struct {
	mu         sync.Mutex
	entries    map[string]*captchaRiskEntry
	maxKeys    int
	lastPruned time.Time
}

func newMemoryCaptchaRiskStore(maxKeys int) *memoryCaptchaRiskStore {
	return &memoryCaptchaRiskStore{entries: make(map[string]*captchaRiskEntry), maxKeys: maxKeys}
}

// knownEntry returns the entry of key, nil for a key that is certainly clean,
// or an error when key is unknown and the store is full. The caller holds mu.
func (store *memoryCaptchaRiskStore) knownEntry(key string, now time.Time) (*captchaRiskEntry, error) {
	if now.Sub(store.lastPruned) >= captchaRiskPruneInterval {
		store.lastPruned = now
		for entryKey, entry := range store.entries {
			if !entry.expiresAt.After(now) {
				delete(store.entries, entryKey)
			}
		}
	}
	if entry, ok := store.entries[key]; ok {
		return entry, nil
	}
	if len(store.entries) >= store.maxKeys {
		return nil, errCaptchaRiskStoreFull
	}
	return nil, nil
}

func (store *memoryCaptchaRiskStore) Reserve(_ context.Context, key, member string, now time.Time, window time.Duration) (int, bool, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	entry, err := store.knownEntry(key, now)
	if err != nil {
		return 0, false, err
	}
	if entry == nil || entry.members == nil {
		entry = &captchaRiskEntry{members: make(map[string]int64)}
		store.entries[key] = entry
	}
	nowMs := now.UnixMilli()
	oldestKept := nowMs - window.Milliseconds()
	for existing, score := range entry.members {
		if score < oldestKept {
			delete(entry.members, existing)
		}
	}
	prior := len(entry.members)
	_, present := entry.members[member]
	entry.members[member] = nowMs
	for len(entry.members) > captchaRiskMaxMembers {
		oldest, oldestScore := "", int64(0)
		for existing, score := range entry.members {
			if oldest == "" || score < oldestScore {
				oldest, oldestScore = existing, score
			}
		}
		delete(entry.members, oldest)
	}
	if expiresAt := now.Add(window); expiresAt.After(entry.expiresAt) {
		entry.expiresAt = expiresAt
	}
	return prior, present, nil
}

func (store *memoryCaptchaRiskStore) Remove(_ context.Context, key, member string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if entry, ok := store.entries[key]; ok {
		delete(entry.members, member)
	}
	return nil
}

func (store *memoryCaptchaRiskStore) SetHold(_ context.Context, key string, now, until time.Time) (bool, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	entry, err := store.knownEntry(key, now)
	if err != nil {
		return false, err
	}
	if entry != nil && entry.expiresAt.After(now) {
		return false, nil
	}
	store.entries[key] = &captchaRiskEntry{expiresAt: until}
	return true, nil
}

func (store *memoryCaptchaRiskStore) HoldActive(_ context.Context, key string, now time.Time) (bool, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	entry, err := store.knownEntry(key, now)
	if err != nil || entry == nil {
		return false, err
	}
	return entry.expiresAt.After(now), nil
}
