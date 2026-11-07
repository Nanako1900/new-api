package middleware

import (
	"fmt"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
)

const (
	EmailVerificationRateLimitMark = "EV"
	EmailVerificationMaxRequests   = 2  // 30秒内最多2次
	EmailVerificationDuration      = 30 // 30秒时间窗口
)

func redisEmailVerificationRateLimiter(c *gin.Context) {
	allowed, _, ttlSeconds, err := redisFixedWindowTake(
		c.Request.Context(),
		redisIPRateLimitKey(EmailVerificationRateLimitMark, c.ClientIP()),
		EmailVerificationMaxRequests,
		EmailVerificationDuration,
	)
	if err != nil {
		memoryEmailVerificationRateLimiter(c)
		return
	}
	if allowed {
		c.Next()
		return
	}

	waitSeconds := int64(EmailVerificationDuration)
	if ttlSeconds > 0 {
		waitSeconds = ttlSeconds
	}

	common.ApiErrorStatus(c, http.StatusTooManyRequests, common.NewMessage("Please wait {{seconds}} seconds before requesting another verification code.", map[string]any{"seconds": waitSeconds}))
	c.Abort()
}

func memoryEmailVerificationRateLimiter(c *gin.Context) {
	key := EmailVerificationRateLimitMark + ":" + c.ClientIP()

	if !inMemoryRateLimiter.Request(key, EmailVerificationMaxRequests, EmailVerificationDuration) {
		common.ApiErrorStatus(c, http.StatusTooManyRequests, common.NewMessage("Please wait before requesting another verification code."))
		c.Abort()
		return
	}

	c.Next()
}

func EmailVerificationRateLimit() gin.HandlerFunc {
	// Keep the fallback ready before requests arrive so a concurrent Redis
	// outage cannot race the in-memory limiter's first initialization.
	inMemoryRateLimiter.Init(common.RateLimitKeyExpirationDuration)
	return func(c *gin.Context) {
		if common.RedisEnabled {
			redisEmailVerificationRateLimiter(c)
		} else {
			memoryEmailVerificationRateLimiter(c)
		}
	}
}

// emailAddressRateLimitWindows limit verification mail per recipient: one per
// minute and five per hour, whatever IP addresses the requests come from.
var emailAddressRateLimitWindows = []struct {
	mark        string
	maxRequests int
	duration    int64
}{
	{mark: "EVA:minute", maxRequests: 1, duration: 60},
	{mark: "EVA:hour", maxRequests: 5, duration: 3600},
}

// emailAddressRateLimitRetention must cover the longest window above. The
// shared in-memory limiter forgets keys idle for 20 minutes, which would reset
// the hourly cap early, so per-address history lives in its own limiter.
const emailAddressRateLimitRetention = time.Hour

var emailAddressRateLimiter common.InMemoryRateLimiter

// AllowEmailVerificationAddress records a verification email to address and
// reports whether it is within the per-address limits. The key is an HMAC of
// the normalized address so neither Redis nor memory holds the address itself.
// Callers apply it identically to registered and unregistered addresses.
func AllowEmailVerificationAddress(c *gin.Context, address string) bool {
	emailAddressRateLimiter.Init(emailAddressRateLimitRetention)
	addressKey := common.GenerateHMACWithKey([]byte("email-verification-address-v1:"+common.SessionSecret), address)
	for _, window := range emailAddressRateLimitWindows {
		key := window.mark + ":" + addressKey
		if common.RedisEnabled {
			allowed, _, _, err := redisFixedWindowTake(c.Request.Context(), fmt.Sprintf("%s:email:%s", redisRateLimitNamespace, key), window.maxRequests, window.duration)
			if err == nil {
				if !allowed {
					return false
				}
				continue
			}
			// Fall back to this node's limiter, as the per-IP limiter does.
		}
		if !emailAddressRateLimiter.Request(key, window.maxRequests, window.duration) {
			return false
		}
	}
	return true
}
