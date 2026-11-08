package contentsafety

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

var (
	slotMu sync.Mutex
	slots  chan struct{}

	userLimiterOnce sync.Once
	userLimiter     common.InMemoryRateLimiter
)

// AcquireSlot waits for one of capacity concurrent review slots until ctx
// ends. A capacity change starts a new pool; calls holding slots of the old
// pool release into it. The returned release is idempotent; call it when the
// review call has truly returned.
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

// AllowReview counts one AI review call for userId against perMinute. With
// Redis it is a shared fixed one-minute window (bursts of up to 2x perMinute
// can pass across a window boundary), while the in-memory path is a sliding
// window. A Redis error denies the call, matching the fail-closed review policy.
func AllowReview(ctx context.Context, userId int, perMinute int) bool {
	if common.RedisEnabled && common.RDB != nil {
		key := fmt.Sprintf("content_safety:review_rate:%d:%d", userId, time.Now().Unix()/60)
		// SETNX writes the expiry only when the window starts and INCR keeps it;
		// one transaction never leaves a counter without a TTL.
		pipe := common.RDB.TxPipeline()
		pipe.SetNX(ctx, key, 0, 2*time.Minute)
		incr := pipe.Incr(ctx, key)
		if _, err := pipe.Exec(ctx); err != nil {
			common.SysError(common.LogText("content safety rate limit check failed: %s", err.Error()))
			return false
		}
		return incr.Val() <= int64(perMinute)
	}
	userLimiterOnce.Do(func() { userLimiter.Init(5 * time.Minute) })
	return userLimiter.Request(strconv.Itoa(userId), perMinute, 60)
}
