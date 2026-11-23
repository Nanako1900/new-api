package contentsafety

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/samber/hot"
)

// forceSyncTTL is how long an account whose background reviews were dropped
// or over its quota has every request reviewed synchronously.
const forceSyncTTL = 10 * time.Minute

var (
	slotMu sync.Mutex
	slots  chan struct{}

	limiterOnce  sync.Once
	syncLimiter  common.InMemoryRateLimiter
	asyncLimiter common.InMemoryRateLimiter

	forceSyncOnce  sync.Once
	forceSyncUsers *hot.HotCache[int, bool]
)

// AcquireSlot waits for one of capacity concurrent synchronous review slots
// until ctx ends. Background reviews never take these slots. A capacity
// change starts a new pool; calls holding slots of the old pool release into
// it. The returned release is idempotent; call it when the review call has
// truly returned.
func AcquireSlot(ctx context.Context, capacity int) (func(), error) {
	capacity = max(1, capacity)
	slotMu.Lock()
	if cap(slots) != capacity {
		slots = make(chan struct{}, capacity)
	}
	pool := slots
	slotMu.Unlock()
	select {
	case pool <- struct{}{}:
		var once sync.Once
		return func() { once.Do(func() { <-pool }) }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// AllowReview counts one synchronous review of userId against perMinute.
// Without Redis the count is per node. A Redis failure denies the review, so
// the request fails closed.
func AllowReview(ctx context.Context, userId int, perMinute int) bool {
	return allowPerMinute(ctx, "content_safety:review_rate", &syncLimiter, userId, perMinute)
}

// AllowEnqueue counts one background review of userId against perMinute, so
// one account cannot fill the shared queue.
func AllowEnqueue(ctx context.Context, userId int, perMinute int) bool {
	return allowPerMinute(ctx, "content_safety:enqueue_rate", &asyncLimiter, userId, perMinute)
}

func allowPerMinute(ctx context.Context, prefix string, local *common.InMemoryRateLimiter, userId int, perMinute int) bool {
	if common.RedisEnabled && common.RDB != nil {
		key := fmt.Sprintf("%s:%d:%d", prefix, userId, time.Now().Unix()/60)
		pipe := common.RDB.TxPipeline()
		pipe.SetNX(ctx, key, 0, 2*time.Minute)
		incr := pipe.Incr(ctx, key)
		if _, err := pipe.Exec(ctx); err != nil {
			common.SysError(common.LogText("content safety rate limit check failed: %s", err.Error()))
			return false
		}
		return incr.Val() <= int64(perMinute)
	}
	limiterOnce.Do(func() {
		syncLimiter.Init(5 * time.Minute)
		asyncLimiter.Init(5 * time.Minute)
	})
	return local.Request(strconv.Itoa(userId), perMinute, 60)
}

func getForceSyncUsers() *hot.HotCache[int, bool] {
	forceSyncOnce.Do(func() {
		forceSyncUsers = hot.NewHotCache[int, bool](hot.LRU, 100000).WithTTL(forceSyncTTL).WithJanitor().Build()
	})
	return forceSyncUsers
}

// ForceSync makes every request of userId wait for its review for a while.
// It is set when a background review of the account was dropped, so an
// account cannot flood the queue to slip a request past the reviewer.
func ForceSync(userId int) {
	if common.RedisEnabled && common.RDB != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		err := common.RDB.Set(ctx, fmt.Sprintf("content_safety:force_sync:%d", userId), 1, forceSyncTTL).Err()
		if err == nil {
			return
		}
		common.SysError(common.LogText("content safety force sync write failed: %s", err.Error()))
	}
	getForceSyncUsers().Set(userId, true)
}

// SyncForced reports whether ForceSync is in effect for userId. A Redis
// failure reads as forced, which only makes the account's review wait.
func SyncForced(ctx context.Context, userId int) bool {
	if forced, ok, _ := getForceSyncUsers().Get(userId); ok && forced {
		return true
	}
	if !common.RedisEnabled || common.RDB == nil {
		return false
	}
	count, err := common.RDB.Exists(ctx, fmt.Sprintf("content_safety:force_sync:%d", userId)).Result()
	if err != nil {
		common.SysError(common.LogText("content safety force sync read failed: %s", err.Error()))
		return true
	}
	return count > 0
}
