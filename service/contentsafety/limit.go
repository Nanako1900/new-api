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
// pool release into it. The returned release must run exactly once, when the
// review call has truly returned.
func AcquireSlot(ctx context.Context, capacity int) (func(), error) {
	slotMu.Lock()
	if cap(slots) != capacity {
		slots = make(chan struct{}, capacity)
	}
	pool := slots
	slotMu.Unlock()
	select {
	case pool <- struct{}{}:
		return func() { <-pool }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// AllowReview counts one AI review call for userId against perMinute. With
// Redis it is a shared fixed one-minute window; a Redis error denies the
// call, matching the fail-closed review policy.
func AllowReview(ctx context.Context, userId int, perMinute int) bool {
	if common.RedisEnabled && common.RDB != nil {
		key := fmt.Sprintf("content_safety:review_rate:%d:%d", userId, time.Now().Unix()/60)
		count, err := common.RDB.Incr(ctx, key).Result()
		if err != nil {
			common.SysError(common.LogText("content safety rate limit check failed: %s", err.Error()))
			return false
		}
		if count == 1 {
			common.RDB.Expire(ctx, key, 2*time.Minute)
		}
		return count <= int64(perMinute)
	}
	userLimiterOnce.Do(func() { userLimiter.Init(5 * time.Minute) })
	return userLimiter.Request(strconv.Itoa(userId), perMinute, 60)
}
