package middleware

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	testCaptchaID        = "test-captcha-id"
	testCaptchaKey       = "test-captcha-key"
	testCaptchaLotNumber = "4dc3cfc2cdff448cad8d13107198d473"
	// HMAC-SHA256 of testCaptchaLotNumber keyed by testCaptchaKey, hex encoded.
	testCaptchaSignToken = "2e398b8d77179145c4f7886db8fd3812ae7d9ff2596c925b063dc62dfd1082ad"
	testCaptchaToken     = `{"lot_number":"` + testCaptchaLotNumber + `","captcha_output":"output","pass_token":"pass","gen_time":"1700000000"}`
)

type captchaCheckResult struct {
	reachedHandler bool
	code           string
	success        bool
}

// setupCaptchaCheck enables GeeTest in always mode with a fresh memory risk
// store; geetest answers the second validation when it is not nil.
func setupCaptchaCheck(t *testing.T, enabled bool, geetest http.HandlerFunc) {
	t.Helper()
	previousEnabled := common.GeetestCheckEnabled
	previousMode := common.GeetestCheckMode
	previousID := common.GeetestCaptchaId
	previousKey := common.GeetestCaptchaKey
	previousURL := geetestValidateURL
	previousClient := geetestHTTPClient
	previousStore := captchaRiskMemory
	previousRedis := common.RedisEnabled
	t.Cleanup(func() {
		common.GeetestCheckEnabled = previousEnabled
		common.GeetestCheckMode = previousMode
		common.GeetestCaptchaId = previousID
		common.GeetestCaptchaKey = previousKey
		geetestValidateURL = previousURL
		geetestHTTPClient = previousClient
		captchaRiskMemory = previousStore
		common.RedisEnabled = previousRedis
	})
	common.GeetestCheckEnabled = enabled
	common.GeetestCheckMode = common.GeetestCheckModeAlways
	common.GeetestCaptchaId = testCaptchaID
	common.GeetestCaptchaKey = testCaptchaKey
	captchaRiskMemory = newMemoryCaptchaRiskStore(captchaRiskMaxMemoryKeys)
	common.RedisEnabled = false
	if geetest != nil {
		server := httptest.NewServer(geetest)
		t.Cleanup(server.Close)
		geetestValidateURL = server.URL + "/validate"
	}
}

func runCaptchaCheck(t *testing.T, token string) captchaCheckResult {
	t.Helper()
	return runCaptchaGate(t, newCaptchaGateRouter(t), "192.0.2.1", token)
}

// newCaptchaGateRouter serves the email gate at /email.
func newCaptchaGateRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	require.NoError(t, router.SetTrustedProxies(nil))
	router.POST("/email", CaptchaGate(CaptchaScopeEmail), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"success": true, "code": "REACHED"})
	})
	return router
}

func runCaptchaGate(t *testing.T, router *gin.Engine, ip, token string) captchaCheckResult {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/email", nil)
	request.RemoteAddr = net.JoinHostPort(ip, "40000")
	if token != "" {
		request.Header.Set(CaptchaTokenHeader, token)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code)

	var body struct {
		Success bool   `json:"success"`
		Code    string `json:"code"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
	return captchaCheckResult{reachedHandler: body.Code == "REACHED", code: body.Code, success: body.Success}
}

func geetestReply(body string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}
}

func TestCaptchaCheckDisabledPassesWithoutToken(t *testing.T) {
	setupCaptchaCheck(t, false, func(w http.ResponseWriter, _ *http.Request) {
		t.Error("GeeTest must not be called when the check is disabled")
	})

	result := runCaptchaCheck(t, "")

	assert.True(t, result.reachedHandler)
	assert.True(t, result.success)
}

func TestCaptchaCheckSendsSignedResultToGeetest(t *testing.T) {
	var received url.Values
	var receivedCaptchaID, receivedMethod, receivedContentType string
	var parseErr error
	setupCaptchaCheck(t, true, func(w http.ResponseWriter, r *http.Request) {
		// Runs on the server goroutine, so record instead of failing here.
		parseErr = r.ParseForm()
		receivedMethod = r.Method
		receivedContentType = r.Header.Get("Content-Type")
		receivedCaptchaID = r.URL.Query().Get("captcha_id")
		received = r.PostForm
		geetestReply(`{"status":"success","result":"success","reason":""}`)(w, r)
	})

	result := runCaptchaCheck(t, testCaptchaToken)

	require.NoError(t, parseErr)
	assert.True(t, result.reachedHandler)
	assert.Equal(t, http.MethodPost, receivedMethod)
	assert.Equal(t, "application/x-www-form-urlencoded", receivedContentType)
	assert.Equal(t, testCaptchaID, receivedCaptchaID)
	assert.Equal(t, testCaptchaLotNumber, received.Get("lot_number"))
	assert.Equal(t, "output", received.Get("captcha_output"))
	assert.Equal(t, "pass", received.Get("pass_token"))
	assert.Equal(t, "1700000000", received.Get("gen_time"))
	assert.Equal(t, testCaptchaSignToken, received.Get("sign_token"))
}

func TestCaptchaCheckRejectsMissingOrMalformedToken(t *testing.T) {
	tests := []struct {
		name  string
		token string
		code  string
	}{
		{name: "missing token", token: "", code: captchaRequiredCode},
		{name: "legacy turnstile token", token: "turnstile-token", code: captchaFailedCode},
		{name: "missing pass token", token: `{"lot_number":"lot","captcha_output":"output","gen_time":"1"}`, code: captchaFailedCode},
		{name: "oversized token", token: `{"lot_number":"` + strings.Repeat("a", maxCaptchaTokenLength) + `"}`, code: captchaFailedCode},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupCaptchaCheck(t, true, func(w http.ResponseWriter, _ *http.Request) {
				t.Error("GeeTest must not be called for an unusable token")
			})

			result := runCaptchaCheck(t, test.token)

			assert.False(t, result.reachedHandler)
			assert.False(t, result.success)
			assert.Equal(t, test.code, result.code)
		})
	}
}

func TestCaptchaCheckFailsClosedOnGeetestVerdict(t *testing.T) {
	tests := []struct {
		name    string
		geetest http.HandlerFunc
		code    string
	}{
		{
			name:    "verification failed",
			geetest: geetestReply(`{"status":"success","result":"fail","reason":"pass_token expire"}`),
			code:    captchaFailedCode,
		},
		{
			name:    "request rejected by GeeTest",
			geetest: geetestReply(`{"status":"error","code":"-50005","msg":"illegal gen_time"}`),
			code:    captchaFailedCode,
		},
		{
			name: "GeeTest server error",
			geetest: func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusBadGateway)
			},
			code: captchaUnavailableCode,
		},
		{
			name:    "reply without result",
			geetest: geetestReply(`{"status":"success"}`),
			code:    captchaUnavailableCode,
		},
		{
			name:    "reply is not json",
			geetest: geetestReply(`<html>gateway</html>`),
			code:    captchaUnavailableCode,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupCaptchaCheck(t, true, test.geetest)

			result := runCaptchaCheck(t, testCaptchaToken)

			assert.False(t, result.reachedHandler)
			assert.False(t, result.success)
			assert.Equal(t, test.code, result.code)
		})
	}
}

func TestCaptchaCheckFailsClosedWhenGeetestIsUnreachable(t *testing.T) {
	setupCaptchaCheck(t, true, nil)
	server := httptest.NewServer(http.NotFoundHandler())
	geetestValidateURL = server.URL + "/validate"
	server.Close()

	result := runCaptchaCheck(t, testCaptchaToken)

	assert.False(t, result.reachedHandler)
	assert.Equal(t, captchaUnavailableCode, result.code)
}

func TestCaptchaCheckFailsClosedWhenGeetestDoesNotAnswer(t *testing.T) {
	release := make(chan struct{})
	setupCaptchaCheck(t, true, func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-release:
		}
	})
	t.Cleanup(func() { close(release) })
	geetestHTTPClient = &http.Client{Timeout: 50 * time.Millisecond}

	result := runCaptchaCheck(t, testCaptchaToken)

	assert.False(t, result.reachedHandler)
	assert.Equal(t, captchaUnavailableCode, result.code)
}

// setupCaptchaRisk enables GeeTest in risk mode; GeeTest confirms every
// submitted result.
func setupCaptchaRisk(t *testing.T) *gin.Engine {
	t.Helper()
	setupCaptchaCheck(t, true, geetestReply(`{"status":"success","result":"success","reason":""}`))
	common.GeetestCheckMode = common.GeetestCheckModeRisk
	return newCaptchaGateRouter(t)
}

// setCaptchaRiskClock pins the risk clock; the returned function moves it.
func setCaptchaRiskClock(t *testing.T, start time.Time) func(time.Duration) {
	t.Helper()
	previous := captchaRiskNow
	t.Cleanup(func() { captchaRiskNow = previous })
	now := start
	captchaRiskNow = func() time.Time { return now }
	return func(offset time.Duration) { now = start.Add(offset) }
}

func captchaRiskContext(ip string) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	c.Request.RemoteAddr = net.JoinHostPort(ip, "40000")
	return c
}

func TestCaptchaRiskStoreContract(t *testing.T) {
	backends := []struct {
		name string
		open func(t *testing.T) captchaRiskStore
	}{
		{name: "memory", open: func(*testing.T) captchaRiskStore { return newMemoryCaptchaRiskStore(captchaRiskMaxMemoryKeys) }},
		{name: "redis", open: func(t *testing.T) captchaRiskStore {
			_, client := useRateLimitMiniRedis(t)
			return redisCaptchaRiskStore{client: client}
		}},
	}
	for _, backend := range backends {
		t.Run(backend.name, func(t *testing.T) {
			store := backend.open(t)
			ctx := context.Background()
			now := time.Now()
			window := 15 * time.Minute
			reserve := func(key, member string, at time.Time) (int, bool) {
				prior, present, err := store.Reserve(ctx, key, member, at, window)
				require.NoError(t, err)
				return prior, present
			}
			assertReserve := func(key, member string, at time.Time, wantPrior int, wantPresent bool) {
				prior, present := reserve(key, member, at)
				assert.Equal(t, wantPrior, prior, "%s %s", key, member)
				assert.Equal(t, wantPresent, present, "%s %s", key, member)
			}

			// Reserve reports what the window held before the call and drops
			// events older than the window.
			assertReserve("events", "old", now.Add(-window-2*time.Minute), 0, false)
			assertReserve("events", "recent", now.Add(-time.Minute), 0, false)
			assertReserve("events", "now", now, 1, false)
			assertReserve("events", "later", now, 2, false)

			// A subject member is counted once and keeps only its latest time.
			assertReserve("subjects", "alice", now.Add(-time.Hour), 0, false)
			assertReserve("subjects", "alice", now, 0, false)
			assertReserve("subjects", "alice", now, 1, true)
			assertReserve("subjects", "bob", now, 1, false)

			// Remove withdraws one member.
			require.NoError(t, store.Remove(ctx, "subjects", "bob"))
			require.NoError(t, store.Remove(ctx, "missing", "bob"))
			assertReserve("subjects", "carol", now, 1, false)

			// A key keeps its newest members only.
			for i := range captchaRiskMaxMembers + 10 {
				reserve("capped", "member-"+strconv.Itoa(i), now.Add(time.Duration(i-captchaRiskMaxMembers-10)*time.Millisecond))
			}
			assertReserve("capped", "member-"+strconv.Itoa(captchaRiskMaxMembers+9), now, captchaRiskMaxMembers, true)
			assertReserve("capped", "member-0", now, captchaRiskMaxMembers, false)

			held, err := store.HoldActive(ctx, "hold", now)
			require.NoError(t, err)
			assert.False(t, held)
			started, err := store.SetHold(ctx, "hold", now, now.Add(time.Minute))
			require.NoError(t, err)
			assert.True(t, started)
			started, err = store.SetHold(ctx, "hold", now, now.Add(time.Hour))
			require.NoError(t, err)
			assert.False(t, started, "an active hold is not restarted")
			held, err = store.HoldActive(ctx, "hold", now)
			require.NoError(t, err)
			assert.True(t, held)
			held, err = store.HoldActive(ctx, "hold", now.Add(2*time.Minute))
			require.NoError(t, err)
			assert.False(t, held)
		})
	}
}

// A full memory store cannot vouch for a key it does not hold, so the gate
// requires the check instead of treating the key as clean.
func TestCaptchaRiskMemoryStoreFailsClosedWhenFull(t *testing.T) {
	store := newMemoryCaptchaRiskStore(2)
	ctx := context.Background()
	now := time.Now()
	_, _, err := store.Reserve(ctx, "known", "event", now, time.Hour)
	require.NoError(t, err)
	_, _, err = store.Reserve(ctx, "expired", "event", now.Add(-2*time.Hour), time.Hour)
	require.NoError(t, err)

	_, _, err = store.Reserve(ctx, "unknown", "event", now, time.Hour)
	assert.ErrorIs(t, err, errCaptchaRiskStoreFull)
	_, err = store.HoldActive(ctx, "unknown", now)
	assert.ErrorIs(t, err, errCaptchaRiskStoreFull)
	_, err = store.SetHold(ctx, "unknown", now, now.Add(time.Hour))
	assert.ErrorIs(t, err, errCaptchaRiskStoreFull)
	prior, present, err := store.Reserve(ctx, "known", "event", now, time.Hour)
	require.NoError(t, err)
	assert.Equal(t, 1, prior)
	assert.True(t, present)

	// The next prune frees the expired key's slot.
	store.lastPruned = now.Add(-captchaRiskPruneInterval)
	_, _, err = store.Reserve(ctx, "unknown", "event", now, time.Hour)
	assert.NoError(t, err)
}

// Per-IP signals count an IPv4 address on its own and an IPv6 address by its
// /64, because one IPv6 host usually controls the whole /64.
func TestCaptchaRiskEmailRequiresCheckForThirdRequestFromNetwork(t *testing.T) {
	tests := []struct {
		name                 string
		first, second, third string
		otherNetwork         string
	}{
		{name: "IPv4", first: "198.51.100.1", second: "198.51.100.1", third: "198.51.100.1", otherNetwork: "198.51.100.2"},
		{name: "IPv6 /64", first: "2001:db8:1:2::1", second: "2001:db8:1:2::2", third: "2001:db8:1:2:ffff::3", otherNetwork: "2001:db8:1:3::1"},
		{name: "IPv4-mapped IPv6", first: "::ffff:198.51.100.1", second: "198.51.100.1", third: "::ffff:198.51.100.1", otherNetwork: "::ffff:198.51.100.2"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := setupCaptchaRisk(t)

			assert.True(t, runCaptchaGate(t, router, test.first, "").reachedHandler)
			assert.True(t, runCaptchaGate(t, router, test.second, "").reachedHandler)
			third := runCaptchaGate(t, router, test.third, "")
			assert.False(t, third.reachedHandler)
			assert.Equal(t, captchaRequiredCode, third.code)
			assert.True(t, runCaptchaGate(t, router, test.otherNetwork, "").reachedHandler, "another network is not affected")
			assert.True(t, runCaptchaGate(t, router, test.third, testCaptchaToken).reachedHandler, "a confirmed result passes")
		})
	}
}

// The policy of docs/authentication.md: the request after limit events inside
// the window needs the check, events older than the window stop counting, and
// a site-wide signal keeps the check on for its whole hold.
func TestCaptchaRiskPolicyLimitsWindowsAndHolds(t *testing.T) {
	distinctIP := func(i int) string { return "198.51.100." + strconv.Itoa(i+1) }
	tests := []struct {
		name   string
		scope  CaptchaScope
		limit  int
		window time.Duration
		hold   time.Duration
		// event names the client IP and subject of the i-th recorded event.
		event                 func(i int) (string, string)
		probeIP, probeSubject string
	}{
		{
			name: "login per username", scope: CaptchaScopeLogin, limit: 3, window: 15 * time.Minute,
			event: func(i int) (string, string) { return distinctIP(i), "victim" },
			// MySQL's default collations ignore case and accents, so these
			// spellings name the same account there.
			probeIP: "203.0.113.1", probeSubject: " VÍCTİM ",
		},
		{
			name: "login per IP", scope: CaptchaScopeLogin, limit: 5, window: 15 * time.Minute,
			event:   func(i int) (string, string) { return "198.51.100.1", []string{"user-a", "user-b"}[i%2] },
			probeIP: "198.51.100.1", probeSubject: "user-c",
		},
		{
			name: "login distinct usernames per IP", scope: CaptchaScopeLogin, limit: 3, window: 15 * time.Minute,
			event:   func(i int) (string, string) { return "198.51.100.1", "user-" + strconv.Itoa(i) },
			probeIP: "198.51.100.1", probeSubject: "user-x",
		},
		{
			name: "login site-wide", scope: CaptchaScopeLogin, limit: 30, window: 5 * time.Minute, hold: 15 * time.Minute,
			event:   func(i int) (string, string) { return distinctIP(i), "user-" + strconv.Itoa(i) },
			probeIP: "203.0.113.1", probeSubject: "fresh",
		},
		{
			name: "email per IP", scope: CaptchaScopeEmail, limit: 2, window: time.Hour,
			event:   func(int) (string, string) { return "198.51.100.1", "" },
			probeIP: "198.51.100.1",
		},
		{
			name: "email site-wide", scope: CaptchaScopeEmail, limit: 30, window: 10 * time.Minute, hold: 30 * time.Minute,
			event:   func(i int) (string, string) { return distinctIP(i), "" },
			probeIP: "203.0.113.1",
		},
		{
			name: "check-in other accounts per IP", scope: CaptchaScopeCheckin, limit: 1, window: 24 * time.Hour,
			event:   func(int) (string, string) { return "198.51.100.1", "1" },
			probeIP: "198.51.100.1", probeSubject: "2",
		},
		{
			name: "check-in site-wide", scope: CaptchaScopeCheckin, limit: 60, window: 10 * time.Minute, hold: 30 * time.Minute,
			event:   func(i int) (string, string) { return distinctIP(i), strconv.Itoa(i + 1) },
			probeIP: "203.0.113.1", probeSubject: "999",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupCaptchaRisk(t)
			moveClock := setCaptchaRiskClock(t, time.Now())
			gate := func(ip, subject string) bool {
				return RequireCaptcha(captchaRiskContext(ip), test.scope, subject)
			}
			probe := func(offset time.Duration) bool {
				moveClock(offset)
				return gate(test.probeIP, test.probeSubject)
			}

			for i := range test.limit {
				ip, subject := test.event(i)
				require.True(t, gate(ip, subject), "event %d is below the limit", i)
			}
			assert.False(t, probe(0), "the request after the limit needs the check")
			assert.False(t, probe(test.window-time.Second), "events inside the window still count")
			if test.hold == 0 {
				assert.True(t, probe(test.window+time.Second), "events older than the window stop counting")
				return
			}
			assert.False(t, probe(test.window+time.Second), "the hold outlasts the window")
			assert.False(t, probe(test.hold-time.Second), "the hold is still on")
			assert.True(t, probe(test.hold+time.Second), "the hold ends")
		})
	}
}

func TestCaptchaRiskModeStillValidatesSubmittedResult(t *testing.T) {
	setupCaptchaCheck(t, true, geetestReply(`{"status":"success","result":"fail","reason":"pass_token expire"}`))
	common.GeetestCheckMode = common.GeetestCheckModeRisk
	router := newCaptchaGateRouter(t)

	assert.True(t, runCaptchaGate(t, router, "198.51.100.1", "").reachedHandler, "a low-risk request needs no result")
	rejected := runCaptchaGate(t, router, "198.51.100.2", testCaptchaToken)
	assert.False(t, rejected.reachedHandler)
	assert.Equal(t, captchaFailedCode, rejected.code)
}

func TestCaptchaAlwaysModeIgnoresRiskPolicy(t *testing.T) {
	router := setupCaptchaRisk(t)
	common.GeetestCheckMode = common.GeetestCheckModeAlways

	for range 3 {
		assert.True(t, runCaptchaGate(t, router, "198.51.100.1", testCaptchaToken).reachedHandler)
	}
	assert.Equal(t, captchaRequiredCode, runCaptchaGate(t, router, "198.51.100.2", "").code)

	common.GeetestCheckMode = common.GeetestCheckModeRisk
	assert.True(t, runCaptchaGate(t, router, "198.51.100.1", "").reachedHandler, "always mode records no risk events")
}

// readOnlyRedisHook makes Redis refuse every write while reads still work, as
// a Redis at maxmemory with the noeviction policy does.
type readOnlyRedisHook struct{}

var errRedisOutOfMemory = errors.New("OOM command not allowed when used memory > 'maxmemory'")

func (readOnlyRedisHook) BeforeProcess(ctx context.Context, cmd redis.Cmder) (context.Context, error) {
	switch cmd.Name() {
	case "get", "zcard", "zcount", "zscore", "ping":
		return ctx, nil
	}
	return ctx, errRedisOutOfMemory
}

func (readOnlyRedisHook) AfterProcess(context.Context, redis.Cmder) error { return nil }

func (readOnlyRedisHook) BeforeProcessPipeline(ctx context.Context, _ []redis.Cmder) (context.Context, error) {
	return ctx, errRedisOutOfMemory
}

func (readOnlyRedisHook) AfterProcessPipeline(context.Context, []redis.Cmder) error { return nil }

func TestCaptchaRiskStoreErrorRequiresCheck(t *testing.T) {
	tests := []struct {
		name       string
		breakRedis func(redisServer *miniredis.Miniredis, client *redis.Client)
	}{
		{name: "Redis unreachable", breakRedis: func(redisServer *miniredis.Miniredis, _ *redis.Client) { redisServer.Close() }},
		{name: "Redis refuses writes", breakRedis: func(_ *miniredis.Miniredis, client *redis.Client) { client.AddHook(readOnlyRedisHook{}) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := setupCaptchaRisk(t)
			redisServer, client := useRateLimitMiniRedis(t)
			test.breakRedis(redisServer, client)

			blocked := runCaptchaGate(t, router, "198.51.100.1", "")
			assert.False(t, blocked.reachedHandler)
			assert.Equal(t, captchaRequiredCode, blocked.code)
			assert.True(t, runCaptchaGate(t, router, "198.51.100.1", testCaptchaToken).reachedHandler, "a confirmed result still passes")
		})
	}
}
