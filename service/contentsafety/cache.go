package contentsafety

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/cachex"
	"github.com/samber/hot"
)

const (
	verdictCacheNamespace  = "new-api:content_safety:verdict:v2"
	verdictCacheCapacity   = 100000
	verdictCacheDefaultTTL = 7 * 24 * time.Hour
	// localVerdictTTL bounds how long a node keeps a verdict it read from
	// Redis. A verdict never changes for its key, so this only bounds memory
	// and how long a lowered cache TTL takes to apply.
	localVerdictTTL      = 10 * time.Minute
	verdictReadTimeout   = 2 * time.Second
	localVerdictCapacity = 50000
)

// CachedVerdict is a stored review conclusion for one unit text.
type CachedVerdict struct {
	Level    string `json:"level"`
	Category string `json:"category"`
	Reason   string `json:"reason"`
}

var (
	verdictCacheOnce sync.Once
	verdictCache     *cachex.HybridCache[CachedVerdict]
	localVerdicts    *hot.HotCache[string, CachedVerdict]
)

func getVerdictCache() *cachex.HybridCache[CachedVerdict] {
	verdictCacheOnce.Do(func() {
		verdictCache = cachex.NewHybridCache[CachedVerdict](cachex.HybridCacheConfig[CachedVerdict]{
			Namespace: cachex.Namespace(verdictCacheNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.JSONCodec[CachedVerdict]{},
			Memory: func() *hot.HotCache[string, CachedVerdict] {
				return hot.NewHotCache[string, CachedVerdict](hot.LRU, verdictCacheCapacity).
					WithTTL(verdictCacheDefaultTTL).
					WithJanitor().
					Build()
			},
		})
		localVerdicts = hot.NewHotCache[string, CachedVerdict](hot.LRU, localVerdictCapacity).
			WithTTL(localVerdictTTL).
			WithJanitor().
			Build()
	})
	return verdictCache
}

func redisVerdicts() bool {
	return common.RedisEnabled && common.RDB != nil
}

// CacheKey identifies a verdict by everything that decides it: the review
// engine and model, the prompt, the reply contract and the unit text.
func CacheKey(engine, prompt, text string) string {
	sum := sha256.Sum256([]byte(engine + "\x00" + prompt + "\x00" + outputContract + "\x00" + text))
	return hex.EncodeToString(sum[:])
}

// LoadVerdicts returns the cached verdicts among keys. A node's own copy is
// read first; the rest come from Redis in one round trip, or from the memory
// cache without Redis. A failed read finds nothing, so the unit is reviewed.
func LoadVerdicts(keys []string, ttlSeconds int) map[string]CachedVerdict {
	found := make(map[string]CachedVerdict, len(keys))
	if ttlSeconds <= 0 || len(keys) == 0 {
		return found
	}
	cache := getVerdictCache()
	missing := make([]string, 0, len(keys))
	for _, key := range keys {
		if verdict, ok, _ := localVerdicts.Get(key); ok {
			found[key] = verdict
			continue
		}
		missing = append(missing, key)
	}
	if len(missing) == 0 {
		return found
	}
	if !redisVerdicts() {
		for _, key := range missing {
			if verdict, ok, err := cache.Get(key); err == nil && ok {
				found[key] = verdict
			}
		}
		return found
	}
	fullKeys := make([]string, len(missing))
	for i, key := range missing {
		fullKeys[i] = cache.FullKey(key)
	}
	ctx, cancel := context.WithTimeout(context.Background(), verdictReadTimeout)
	defer cancel()
	values, err := common.RDB.MGet(ctx, fullKeys...).Result()
	if err != nil {
		common.SysError(common.LogText("content safety verdict cache read failed: %s", err.Error()))
		return found
	}
	for i, value := range values {
		raw, ok := value.(string)
		if !ok {
			continue
		}
		var verdict CachedVerdict
		if err := common.UnmarshalJsonStr(raw, &verdict); err != nil {
			continue
		}
		found[missing[i]] = verdict
		localVerdicts.SetWithTTL(missing[i], verdict, min(localVerdictTTL, time.Duration(ttlSeconds)*time.Second))
	}
	return found
}

// StoreVerdict remembers the verdict for key for ttlSeconds.
func StoreVerdict(key string, verdict CachedVerdict, ttlSeconds int) {
	if ttlSeconds <= 0 {
		return
	}
	ttl := time.Duration(ttlSeconds) * time.Second
	if err := getVerdictCache().SetWithTTL(key, verdict, ttl); err != nil {
		common.SysError(common.LogText("content safety verdict cache write failed: %s", err.Error()))
		return
	}
	localVerdicts.SetWithTTL(key, verdict, min(localVerdictTTL, ttl))
}
