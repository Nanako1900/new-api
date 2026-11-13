package controller

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func channelUserAgentTestDB(t *testing.T, kind, dsn string) *gorm.DB {
	t.Helper()
	db := modelManagementDB(t, kind, dsn)
	previousGroupRatio := ratio_setting.GroupRatio2JSONString()
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousGroupRatio)) })
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`))
	return db
}

func TestChannelUserAgentMatching(t *testing.T) {
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	previousLogs := constant.ErrorLogEnabled
	constant.ErrorLogEnabled = false
	t.Cleanup(func() { constant.ErrorLogEnabled = previousLogs })
	for _, tc := range []struct {
		name, ua                     string
		rules                        []dto.ChannelUserAgentRule
		disabled, duplicate, allowed bool
	}{
		{name: "legacy channel", disabled: true, allowed: true},
		{name: "interactive CLI", ua: "claude-cli/2.1.141 (external, cli)", allowed: true},
		{name: "print mode", ua: "claude-cli/2.1.141 (external, sdk-cli)", allowed: true},
		{name: "IDE version suffix", ua: "claude-cli/3.0.0-beta.1 (external, vscode, client-app/test)", allowed: true},
		{name: "missing header"},
		{name: "blank header", ua: "  "},
		{name: "different client", ua: "curl/8.0"},
		{name: "substring spoof", ua: "curl/8.0 (claude-cli/2.1.141)"},
		{name: "invalid version", ua: "claude-cli/not-a-version"},
		{name: "duplicate headers", ua: "claude-cli/2.1.141", duplicate: true},
		{name: "control characters", ua: "claude-cli/2.1.141\nforged log"},
		{name: "oversized header", ua: "claude-cli/2.1.141 (" + strings.Repeat("x", 1024) + ")"},
		{name: "exact allowlist", ua: "MyClient/1.0", rules: []dto.ChannelUserAgentRule{{Match: "exact", Value: "MyClient/1.0"}}, allowed: true},
		{name: "exact rejects suffix", ua: "MyClient/1.0-extra", rules: []dto.ChannelUserAgentRule{{Match: "exact", Value: "MyClient/1.0"}}},
		{name: "prefix allowlist OR", ua: "MyClient/2.0", rules: []dto.ChannelUserAgentRule{{Match: "exact", Value: "other"}, {Match: "prefix", Value: "MyClient/"}}, allowed: true},
		{name: "case sensitive", ua: "myclient/2.0", rules: []dto.ChannelUserAgentRule{{Match: "prefix", Value: "MyClient/"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newPinRetryContext()
			c.Request.Header.Set("User-Agent", tc.ua)
			// Client headers cannot turn a relay request into an internal call.
			c.Request.Header.Set("X-Skip-User-Agent-Check", "true")
			if tc.duplicate {
				c.Request.Header.Add("User-Agent", "curl/8.0")
			}
			policy := &dto.ChannelUserAgentPolicy{Enabled: !tc.disabled, Profile: "claude_code"}
			if tc.rules != nil {
				policy.Profile, policy.Rules = "custom", tc.rules
			}
			channel := &model.Channel{Id: 91, Type: constant.ChannelTypeOpenAI, Key: "test-only-key"}
			channel.SetSetting(dto.ChannelSettings{UserAgentPolicy: policy})
			apiErr := middleware.SetupContextForSelectedChannel(c, channel, "ua-test")
			if tc.allowed {
				require.Nil(t, apiErr)
				assert.Equal(t, "test-only-key", common.GetContextKeyString(c, constant.ContextKeyChannelKey))
				return
			}
			require.NotNil(t, apiErr)
			assert.Equal(t, http.StatusForbidden, apiErr.StatusCode)
			assert.Equal(t, types.ErrorCodeUserAgentNotAllowed, apiErr.GetErrorCode())
			assert.Equal(t, "permission_error", apiErr.ToClaudeError().Type)
			assert.False(t, service.ShouldRetryRelayError(c, apiErr, 5))
			assert.False(t, service.ShouldDisableChannel(apiErr))
			assert.Empty(t, common.GetContextKeyString(c, constant.ContextKeyChannelKey))
		})
	}
	t.Run("retry uses ingress header after override", func(t *testing.T) {
		c := newPinRetryContext()
		c.Request.Header.Set("User-Agent", "curl/8.0")
		service.CaptureChannelUserAgent(c)
		c.Request.Header.Set("User-Agent", "claude-cli/2.1.141")
		channel := &model.Channel{Id: 92, Type: constant.ChannelTypeOpenAI, Key: "test-only-key"}
		channel.SetSetting(dto.ChannelSettings{UserAgentPolicy: &dto.ChannelUserAgentPolicy{Enabled: true, Profile: "claude_code"}})
		require.NotNil(t, middleware.SetupContextForSelectedChannel(c, channel, "ua-test"))
		require.Nil(t, middleware.SetupContextForInternalChannel(c, channel, "ua-test"), "server-created health checks have an explicit internal entrypoint")
	})
}

func TestChannelUserAgentConfigurationValidation(t *testing.T) {
	for _, tc := range []struct {
		name, setting string
		valid         bool
	}{
		{"legacy", `{}`, true},
		{"preset", `{"user_agent_policy":{"enabled":true,"profile":"claude_code"}}`, true},
		{"disabled draft", `{"user_agent_policy":{"enabled":false,"profile":"custom"}}`, true},
		{"empty allowlist", `{"user_agent_policy":{"enabled":true,"profile":"custom"}}`, false},
		{"unknown profile", `{"user_agent_policy":{"enabled":true,"profile":"typo"}}`, false},
		{"unknown matcher", `{"user_agent_policy":{"enabled":true,"profile":"custom","rules":[{"match":"contains","value":"claude"}]}}`, false},
		{"blank prefix", `{"user_agent_policy":{"enabled":true,"profile":"custom","rules":[{"match":"prefix","value":" "}]}}`, false},
		{"newline", `{"user_agent_policy":{"enabled":true,"profile":"custom","rules":[{"match":"exact","value":"bad\nUA"}]}}`, false},
		{"corrupt setting", `{"user_agent_policy":`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			channel := &model.Channel{Setting: &tc.setting}
			if tc.valid {
				require.NoError(t, channel.ValidateSettings())
			} else {
				require.Error(t, channel.ValidateSettings())
			}
		})
	}
	tooMany := &dto.ChannelUserAgentPolicy{Enabled: true, Profile: "custom", Rules: make([]dto.ChannelUserAgentRule, 21)}
	require.Error(t, tooMany.Validate())
	oversized := &dto.ChannelUserAgentPolicy{Enabled: true, Profile: "custom", Rules: []dto.ChannelUserAgentRule{{Match: "exact", Value: strings.Repeat("x", 1025)}}}
	require.Error(t, oversized.Validate())
}

func TestChannelUserAgentDatabaseMatrix(t *testing.T) {
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			if dialect.env != "" && os.Getenv(dialect.env) == "" {
				t.Skip("set " + dialect.env)
			}
			db := channelUserAgentTestDB(t, dialect.kind, os.Getenv(dialect.env))
			logDB, _ := newAuditTestDatabase(t, dialect.kind, os.Getenv(dialect.env))
			require.NoError(t, logDB.AutoMigrate(&model.Log{}))
			model.LOG_DB = logDB
			previousLogs, previousWriter := constant.ErrorLogEnabled, gin.DefaultErrorWriter
			constant.ErrorLogEnabled = true
			var serverLogs bytes.Buffer
			gin.DefaultErrorWriter = &serverLogs
			t.Cleanup(func() { constant.ErrorLogEnabled = previousLogs; gin.DefaultErrorWriter = previousWriter })
			user := model.User{Username: "ua-owner", Group: "default", Quota: 100000, Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&user).Error)
			channel := model.Channel{Name: "restricted", Type: constant.ChannelTypeOpenAI, Key: "private-upstream-key", Status: common.ChannelStatusEnabled, Models: "ua-test", Group: "default", Priority: common.GetPointer(int64(10))}
			channel.SetSetting(dto.ChannelSettings{UserAgentPolicy: &dto.ChannelUserAgentPolicy{Enabled: true, Profile: "claude_code"}})
			require.NoError(t, channel.ValidateSettings())
			require.NoError(t, db.Create(&channel).Error)
			require.NoError(t, channel.AddAbilities(db))
			fallback := model.Channel{Name: "unrestricted", Type: constant.ChannelTypeOpenAI, Key: "unused-key", Status: common.ChannelStatusEnabled, Models: "ua-test", Group: "default", Priority: common.GetPointer(int64(0))}
			require.NoError(t, db.Create(&fallback).Error)
			require.NoError(t, fallback.AddAbilities(db))
			var reached atomic.Int32
			engine := gin.New()
			engine.Use(func(c *gin.Context) {
				c.Set("id", user.Id)
				c.Set("username", user.Username)
				c.Set("token_id", 17)
				c.Set("token_name", "ua-test-token")
				common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
				common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
				c.Set(common.RequestIdKey, c.GetHeader("X-Request-Id"))
			}, middleware.Distribute())
			for _, path := range []string{"/v1/chat/completions", "/v1/messages", "/v1/messages/count_tokens"} {
				engine.POST(path, func(c *gin.Context) { reached.Add(1); c.Status(http.StatusNoContent) })
			}
			for _, cached := range []bool{false, true} {
				common.MemoryCacheEnabled = cached
				model.InitChannelCache()
				for _, path := range []string{"/v1/chat/completions", "/v1/messages", "/v1/messages/count_tokens"} {
					requestID := fmt.Sprintf("ua-%t-%s", cached, path)
					request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"model":"ua-test","messages":[]}`))
					request.Header.Set("Content-Type", "application/json")
					request.Header.Set("User-Agent", "curl/8.0")
					request.Header.Set("Authorization", "Bearer private-client-key")
					request.Header.Set("X-Request-Id", requestID)
					recorder := httptest.NewRecorder()
					engine.ServeHTTP(recorder, request)
					require.Equal(t, http.StatusForbidden, recorder.Code, recorder.Body.String())
					if strings.HasPrefix(path, "/v1/messages") {
						assert.Contains(t, recorder.Body.String(), `"permission_error"`)
					}
					var log model.Log
					require.NoError(t, logDB.Where("request_id = ?", requestID).First(&log).Error)
					assert.Equal(t, channel.Id, log.ChannelId)
					assert.Zero(t, log.Quota)
					assert.Contains(t, log.Other, "user_agent_not_allowed")
					assert.Contains(t, log.Other, "curl/8.0")
					var details struct {
						ContentParts []*common.Message `json:"content_parts"`
					}
					require.NoError(t, common.UnmarshalJsonStr(log.Other, &details))
					require.Len(t, details.ContentParts, 1)
					assert.Equal(t, log.Content, details.ContentParts[0].Key, "the console must translate the denial in the viewer's language")
					assert.NotContains(t, model.FormatUserLogView(log).Other, "user_agent_policy")
					assert.NotContains(t, log.Other, "private-client-key")
					assert.NotContains(t, log.Other, "private-upstream-key")
				}
			}
			assert.Zero(t, reached.Load(), "blocked requests must never enter relay or fallback")
			assert.Contains(t, serverLogs.String(), "user_agent_rejected")
			assert.NotContains(t, serverLogs.String(), "private-client-key")
			var stored model.Channel
			require.NoError(t, db.First(&stored, channel.Id).Error)
			assert.Equal(t, channel.GetSetting().UserAgentPolicy, stored.GetSetting().UserAgentPolicy)
			assert.Equal(t, common.ChannelStatusEnabled, stored.Status)
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, 100000, user.Quota)

			// A cached selected channel is checked again on retry, before its key
			// is installed, even if the previous channel had no restriction.
			ctx := newPinRetryContext()
			ctx.Set("id", user.Id)
			ctx.Request.Header.Set("User-Agent", "curl/8.0")
			info := &relaycommon.RelayInfo{OriginModelName: "ua-test", ChannelMeta: &relaycommon.ChannelMeta{}, UserGroup: "default", UsingGroup: "default"}
			selected, retryErr := getChannel(ctx, info, &service.RetryParam{Ctx: ctx, TokenGroup: "default", ModelName: "ua-test", RequestPath: "/v1/chat/completions", Retry: common.GetPointer(0)})
			require.Nil(t, selected)
			require.NotNil(t, retryErr)
			assert.Equal(t, types.ErrorCodeUserAgentNotAllowed, retryErr.GetErrorCode())

			// Corrupt stored settings survive reads and fail closed on each request.
			corrupt := `{"user_agent_policy":`
			require.NoError(t, db.Model(&channel).Update("setting", corrupt).Error)
			for range 2 {
				require.NoError(t, db.First(&stored, channel.Id).Error)
				_ = stored.GetSetting()
				assert.Equal(t, corrupt, *stored.Setting)
				apiErr := service.EnforceChannelUserAgent(ctx, &stored, "ua-test")
				require.NotNil(t, apiErr)
				assert.Equal(t, http.StatusServiceUnavailable, apiErr.StatusCode)
			}
			// Updating and disabling the policy survives persistence and cache refresh.
			channel.SetSetting(dto.ChannelSettings{UserAgentPolicy: &dto.ChannelUserAgentPolicy{Enabled: false, Profile: "claude_code"}})
			require.NoError(t, db.Model(&channel).Update("setting", channel.Setting).Error)
			model.InitChannelCache()
			request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"ua-test"}`))
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			assert.Equal(t, http.StatusNoContent, recorder.Code, recorder.Body.String())
			assert.EqualValues(t, 1, reached.Load())
		})
	}
}

// Keep the end-to-end upstream fixture close to the admission regressions.
func TestChannelUserAgentAllowsUpstream(t *testing.T) {
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	db := channelUserAgentTestDB(t, "sqlite", "")
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.Token{}))
	user := model.User{Username: "ua-relay-owner", Group: "default", Quota: 100000, Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(&user).Error)
	cache, err := model.GetUserCache(user.Id)
	require.NoError(t, err)
	token := model.Token{UserId: user.Id, Key: strings.Repeat("a", 48), Name: "ua-allowed-token", RemainQuota: 100000}
	require.NoError(t, db.Create(&token).Error)
	previousLogs := constant.ErrorLogEnabled
	constant.ErrorLogEnabled = false
	t.Cleanup(func() { constant.ErrorLogEnabled = previousLogs })
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"ua-completion","object":"chat.completion","model":"ua-free","choices":[{"index":0,"message":{"role":"assistant","content":"allowed"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`)
	}))
	defer upstream.Close()
	service.InitHttpClient()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"ua-free":0}`))
	channel := model.Channel{Name: "allowed", Type: constant.ChannelTypeOpenAI, Key: "test-only", BaseURL: &upstream.URL, Status: common.ChannelStatusEnabled, Models: "ua-free", Group: "default"}
	channel.SetSetting(dto.ChannelSettings{UserAgentPolicy: &dto.ChannelUserAgentPolicy{Enabled: true, Profile: "claude_code"}})
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, channel.AddAbilities(db))
	engine := gin.New()
	engine.POST("/v1/chat/completions", func(c *gin.Context) {
		cache.WriteContext(c)
		c.Set("id", user.Id)
		common.SetContextKey(c, constant.ContextKeyTokenId, token.Id)
		common.SetContextKey(c, constant.ContextKeyTokenKey, token.Key)
		common.SetContextKey(c, constant.ContextKeyUserSetting, dto.UserSetting{BillingPreference: "wallet_only"})
		common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
		common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
	}, middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAI) })
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"ua-free","messages":[{"role":"user","content":"hello"}]}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "claude-cli/2.1.141 (external, cli)")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	assert.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Contains(t, recorder.Body.String(), "allowed")
	assert.EqualValues(t, 1, calls.Load())
}

func TestChannelUserAgentRetryRejectionRefundsReservation(t *testing.T) {
	require.NoError(t, i18n.Init())
	db := channelUserAgentTestDB(t, "sqlite", "")
	require.NoError(t, db.AutoMigrate(&model.Token{}, &model.Log{}))
	previousRetry, previousBatch, previousLogs := common.RetryTimes, common.BatchUpdateEnabled, constant.ErrorLogEnabled
	quotaSettings := operation_setting.GetQuotaSetting()
	previousTrust := quotaSettings.TrustQuotaUSD
	common.RetryTimes, common.BatchUpdateEnabled, constant.ErrorLogEnabled = 2, false, true
	quotaSettings.TrustQuotaUSD = 1e9
	t.Cleanup(func() {
		common.RetryTimes, common.BatchUpdateEnabled, constant.ErrorLogEnabled = previousRetry, previousBatch, previousLogs
		quotaSettings.TrustQuotaUSD = previousTrust
	})
	const initialQuota = 100000
	user := model.User{Username: "ua-refund-owner", Group: "default", Quota: initialQuota, Status: common.UserStatusEnabled, Setting: `{"billing_preference":"wallet_only"}`}
	require.NoError(t, db.Create(&user).Error)
	token := model.Token{UserId: user.Id, Key: strings.Repeat("u", 48), Name: "ua-refund-token", RemainQuota: initialQuota}
	require.NoError(t, db.Create(&token).Error)
	cache, err := model.GetUserCache(user.Id)
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"ua-refund":0.01}`))
	var upstreamCalls, reserved atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls.Add(1)
		var loaded model.User
		if db.First(&loaded, user.Id).Error == nil {
			reserved.Store(int32(initialQuota - loaded.Quota))
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, `{"error":{"message":"upstream temporarily unavailable","type":"server_error"}}`)
	}))
	defer upstream.Close()
	service.InitHttpClient()
	for _, spec := range []struct {
		priority   int64
		restricted bool
	}{{10, false}, {0, true}, {-10, false}} {
		channel := model.Channel{Name: fmt.Sprintf("ua-refund-%d", spec.priority), Type: constant.ChannelTypeOpenAI, Key: "test-only", BaseURL: &upstream.URL, Status: common.ChannelStatusEnabled, Models: "ua-refund", Group: "default", Priority: &spec.priority, AutoBan: common.GetPointer(0)}
		if spec.restricted {
			channel.SetSetting(dto.ChannelSettings{UserAgentPolicy: &dto.ChannelUserAgentPolicy{Enabled: true, Profile: "claude_code"}})
		}
		require.NoError(t, db.Create(&channel).Error)
		require.NoError(t, channel.AddAbilities(db))
	}
	engine := gin.New()
	engine.POST("/v1/chat/completions", func(c *gin.Context) {
		cache.WriteContext(c)
		c.Set("id", user.Id)
		c.Set("token_quota", initialQuota)
		common.SetContextKey(c, constant.ContextKeyTokenId, token.Id)
		common.SetContextKey(c, constant.ContextKeyTokenKey, token.Key)
		common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
		common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
		common.SetContextKey(c, constant.ContextKeyUserSetting, dto.UserSetting{BillingPreference: "wallet_only"})
	}, middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAI) })
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"ua-refund","messages":[{"role":"user","content":"hello"}]}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "curl/8.0")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusForbidden, recorder.Code, recorder.Body.String())
	assert.Contains(t, recorder.Body.String(), "user_agent_not_allowed")
	assert.EqualValues(t, 1, upstreamCalls.Load(), "neither the restricted retry nor the lower-priority fallback may reach upstream")
	assert.Positive(t, reserved.Load(), "the original attempt must actually reserve quota")
	// Refund is asynchronous. Wait for its observable database result before
	// restoring globals or closing the database used by the worker.
	require.Eventually(t, func() bool {
		var refundedUser model.User
		var refundedToken model.Token
		return db.First(&refundedUser, user.Id).Error == nil && db.First(&refundedToken, token.Id).Error == nil && refundedUser.Quota == initialQuota && refundedToken.RemainQuota == initialQuota && refundedToken.UsedQuota == 0
	}, 3*time.Second, 10*time.Millisecond)
}
