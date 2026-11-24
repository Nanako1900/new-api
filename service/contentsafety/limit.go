package contentsafety

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/samber/hot"
)

// forceSyncTTL is how long an account whose background reviews were dropped
// or over its quota has every request reviewed synchronously.
const forceSyncTTL = 10 * time.Minute

// MaxAccountSyncReviews bounds the synchronous reviews of one account in
// flight on a node, so one account's requests cannot take every slot.
const MaxAccountSyncReviews = 8

var (
	slotMu             sync.Mutex
	slots              chan struct{}
	syncSlotsByAccount = map[int]*accountSlots{}

	limiterOnce  sync.Once
	syncLimiter  common.InMemoryRateLimiter
	asyncLimiter common.InMemoryRateLimiter

	forceSyncOnce  sync.Once
	forceSyncUsers *hot.HotCache[int, bool]

	// redisWarned is when a Redis failure was last written, in Unix
	// nanoseconds.
	redisWarned atomic.Int64
)

// accountSlots are one account's synchronous review slots on this node.
// users counts the reviews holding or waiting for one; the entry is dropped
// with the last of them.
type accountSlots struct {
	slots chan struct{}
	users int
}

// leave drops one review holding or waiting for a slot of the account.
func (a *accountSlots) leave(userId int) {
	slotMu.Lock()
	defer slotMu.Unlock()
	a.users--
	if a.users == 0 {
		delete(syncSlotsByAccount, userId)
	}
}

// AcquireSlot waits until ctx ends for one of MaxAccountSyncReviews slots of
// userId and then for one of capacity concurrent synchronous review slots of
// the node. Background reviews never take these slots. A capacity change
// starts a new pool; calls holding slots of the old pool release into it.
// The returned release is idempotent; call it when the review call has truly
// returned.
func AcquireSlot(ctx context.Context, userId, capacity int) (func(), error) {
	capacity = max(1, capacity)
	slotMu.Lock()
	if cap(slots) != capacity {
		slots = make(chan struct{}, capacity)
	}
	pool := slots
	account := syncSlotsByAccount[userId]
	if account == nil {
		account = &accountSlots{slots: make(chan struct{}, MaxAccountSyncReviews)}
		syncSlotsByAccount[userId] = account
	}
	account.users++
	slotMu.Unlock()
	select {
	case account.slots <- struct{}{}:
	case <-ctx.Done():
		account.leave(userId)
		return nil, ctx.Err()
	}
	select {
	case pool <- struct{}{}:
		var once sync.Once
		return func() {
			once.Do(func() {
				<-pool
				<-account.slots
				account.leave(userId)
			})
		}, nil
	case <-ctx.Done():
		<-account.slots
		account.leave(userId)
		return nil, ctx.Err()
	}
}

// AllowReview counts units synchronous reviews of userId against perMinute.
// Without Redis, or while Redis fails, the count is per node.
func AllowReview(ctx context.Context, userId, perMinute, units int) bool {
	return allowPerMinute(ctx, "content_safety:review_rate", &syncLimiter, userId, perMinute, units)
}

// AllowEnqueue counts units background reviews of userId against perMinute,
// so one account cannot fill the shared queue.
func AllowEnqueue(ctx context.Context, userId, perMinute, units int) bool {
	return allowPerMinute(ctx, "content_safety:enqueue_rate", &asyncLimiter, userId, perMinute, units)
}

func allowPerMinute(ctx context.Context, prefix string, local *common.InMemoryRateLimiter, userId, perMinute, units int) bool {
	if common.RedisEnabled && common.RDB != nil {
		key := fmt.Sprintf("%s:%d:%d", prefix, userId, time.Now().Unix()/60)
		pipe := common.RDB.TxPipeline()
		pipe.SetNX(ctx, key, 0, 2*time.Minute)
		incr := pipe.IncrBy(ctx, key, int64(units))
		_, err := pipe.Exec(ctx)
		if err == nil {
			return incr.Val() <= int64(perMinute)
		}
		// A Redis outage must not stop every review; the node keeps counting.
		warnRedisFailure("rate limit check", err)
	}
	limiterOnce.Do(func() {
		syncLimiter.Init(5 * time.Minute)
		asyncLimiter.Init(5 * time.Minute)
	})
	for range units {
		if !local.Request(strconv.Itoa(userId), perMinute, 60) {
			return false
		}
	}
	return true
}

// warnRedisFailure writes a failed Redis call of the content check at most
// once a minute; during an outage every request would write one.
func warnRedisFailure(call string, err error) {
	now, last := time.Now().UnixNano(), redisWarned.Load()
	if now-last < int64(time.Minute) || !redisWarned.CompareAndSwap(last, now) {
		return
	}
	common.SysError(common.LogText("content safety %s failed: %s", call, err.Error()))
}

func getForceSyncUsers() *hot.HotCache[int, bool] {
	forceSyncOnce.Do(func() {
		forceSyncUsers = hot.NewHotCache[int, bool](hot.LRU, 100000).WithTTL(forceSyncTTL).WithJanitor().Build()
	})
	return forceSyncUsers
}

// ForceSync makes every request of userId wait for its review for a while.
// It is set when a background review of the account was dropped or left
// text unread, so an account cannot flood the queue or pad its requests to
// slip a message past the reviewer.
func ForceSync(userId int) {
	if common.RedisEnabled && common.RDB != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		err := common.RDB.Set(ctx, fmt.Sprintf("content_safety:force_sync:%d", userId), 1, forceSyncTTL).Err()
		if err == nil {
			return
		}
		warnRedisFailure("force sync write", err)
	}
	getForceSyncUsers().Set(userId, true)
}

// SyncForced reports whether ForceSync is in effect for userId. The flag is
// best effort: a Redis failure reads as not forced, so an outage does not
// hold every account's requests for review.
func SyncForced(ctx context.Context, userId int) bool {
	if forced, ok, _ := getForceSyncUsers().Get(userId); ok && forced {
		return true
	}
	if !common.RedisEnabled || common.RDB == nil {
		return false
	}
	count, err := common.RDB.Exists(ctx, fmt.Sprintf("content_safety:force_sync:%d", userId)).Result()
	if err != nil {
		warnRedisFailure("force sync read", err)
		return false
	}
	return count > 0
}
