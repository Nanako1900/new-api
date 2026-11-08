package contentsafety

import (
	"crypto/sha256"
	"encoding/hex"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/cachex"
	"github.com/samber/hot"
)

const (
	verdictCacheNamespace  = "new-api:content_safety:verdict:v1"
	verdictCacheCapacity   = 100000
	verdictCacheDefaultTTL = 7 * 24 * time.Hour
)

// CachedVerdict is a definitive conclusion kept for one window text.
type CachedVerdict struct {
	Safe     bool   `json:"safe"`
	Category string `json:"category"`
	Reason   string `json:"reason"`
}

var (
	verdictCacheOnce sync.Once
	verdictCache     *cachex.HybridCache[CachedVerdict]
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
	})
	return verdictCache
}

// CacheKey identifies a window text under one review model, prompt and reply
// contract, so changing any of them invalidates earlier conclusions.
func CacheKey(model, prompt, text string) string {
	sum := sha256.Sum256([]byte(model + "\x00" + prompt + "\x00" + outputContract + "\x00" + text))
	return hex.EncodeToString(sum[:])
}

// BatchCacheKey identifies a set of windows reviewed together, by their window
// keys in any order, under one review model and prompt. The marker after the
// model keeps it apart from the key of a single window, whose text a client
// chooses and could make spell out the window keys of a batch.
func BatchCacheKey(model, prompt string, windowKeys []string) string {
	return CacheKey(model+"\x00batch", prompt, strings.Join(slices.Sorted(slices.Values(windowKeys)), "\n"))
}

// LoadVerdict returns a cached conclusion. A zero ttlSeconds disables the cache.
func LoadVerdict(key string, ttlSeconds int) (CachedVerdict, bool) {
	if ttlSeconds <= 0 {
		return CachedVerdict{}, false
	}
	verdict, found, err := getVerdictCache().Get(key)
	if err != nil {
		common.SysError(common.LogText("content safety verdict cache read failed: %s", err.Error()))
		return CachedVerdict{}, false
	}
	return verdict, found
}

// StoreVerdict keeps a conclusion for ttlSeconds. A zero ttlSeconds disables the cache.
func StoreVerdict(key string, verdict CachedVerdict, ttlSeconds int) {
	if ttlSeconds <= 0 {
		return
	}
	if err := getVerdictCache().SetWithTTL(key, verdict, time.Duration(ttlSeconds)*time.Second); err != nil {
		common.SysError(common.LogText("content safety verdict cache write failed: %s", err.Error()))
	}
}
