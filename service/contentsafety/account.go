package contentsafety

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/samber/hot"
)

const (
	accountAgeCacheTTL = 10 * time.Minute
	// sightingTTL is how long a user's earlier sight of a flagged unit is
	// remembered, so history resent on every turn is recorded once.
	sightingTTL = 7 * 24 * time.Hour
)

var (
	accountOnce      sync.Once
	accountCreatedAt *hot.HotCache[int, int64]
	userSightings    *hot.HotCache[string, bool]
)

func accountCaches() {
	accountOnce.Do(func() {
		accountCreatedAt = hot.NewHotCache[int, int64](hot.LRU, 100000).WithTTL(accountAgeCacheTTL).WithJanitor().Build()
		userSightings = hot.NewHotCache[string, bool](hot.LRU, 200000).WithTTL(sightingTTL).WithJanitor().Build()
	})
}

// AccountCreatedAt is when userId registered, in Unix seconds, or 0 when the
// account has no registration time, which callers read as an established
// account. It never changes, so each node reads it once per
// accountAgeCacheTTL.
func AccountCreatedAt(userId int) (int64, error) {
	accountCaches()
	if createdAt, ok, _ := accountCreatedAt.Get(userId); ok {
		return createdAt, nil
	}
	var createdAt int64
	if err := model.DB.Model(&model.User{}).Where("id = ?", userId).Select("COALESCE(created_at, 0)").Scan(&createdAt).Error; err != nil {
		return 0, err
	}
	accountCreatedAt.Set(userId, createdAt)
	return createdAt, nil
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
