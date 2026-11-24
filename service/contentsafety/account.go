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

// sightingTTL is how long a user's earlier sight of a flagged unit is
// remembered, so history resent on every turn is recorded once.
const sightingTTL = 7 * 24 * time.Hour

var (
	accountOnce   sync.Once
	userSightings *hot.HotCache[string, bool]
)

func accountCaches() {
	accountOnce.Do(func() {
		userSightings = hot.NewHotCache[string, bool](hot.LRU, 200000).WithTTL(sightingTTL).WithJanitor().Build()
	})
}

// FirstSighting reports whether userId sends the unit with key for the first
// time within sightingTTL. A conversation resends its history on every turn;
// this keeps one earlier flagged message from being recorded on each of
// them. A Redis failure reads as a first sighting, so nothing is missed.
func FirstSighting(ctx context.Context, userId int, key string) bool {
	if common.RedisEnabled && common.RDB != nil {
		fresh, err := common.RDB.SetNX(ctx, fmt.Sprintf("content_safety:sighting:%d:%s", userId, key), 1, sightingTTL).Result()
		if err != nil {
			warnRedisFailure("sighting check", err)
			return true
		}
		return fresh
	}
	accountCaches()
	local := strconv.Itoa(userId) + ":" + key
	if seen, ok, _ := userSightings.Get(local); ok && seen {
		return false
	}
	userSightings.Set(local, true)
	return true
}
