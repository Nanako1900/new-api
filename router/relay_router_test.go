package router

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/plugins"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/contentsafety"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListModelsSupportsOpenAIAndGeminiAuthentication(t *testing.T) {
	setupRelayRouterTestDB(t)

	user := model.User{
		Username: "models-user",
		Status:   common.UserStatusEnabled,
		Group:    "default",
		Quota:    100,
	}
	require.NoError(t, model.DB.Create(&user).Error)
	require.NoError(t, model.DB.Create(&model.Token{
		UserId:         user.Id,
		Key:            "modelstestkey",
		Status:         common.TokenStatusEnabled,
		ExpiredTime:    -1,
		UnlimitedQuota: true,
	}).Error)

	engine := gin.New()
	SetRelayRouter(engine)

	tests := []struct {
		name           string
		path           string
		headerName     string
		expectedObject string
		expectedField  string
	}{
		{
			name:           "OpenAI bearer token",
			path:           "/v1/models",
			headerName:     "Authorization",
			expectedObject: "list",
			expectedField:  "data",
		},
		{
			name:          "Gemini API key header",
			path:          "/v1/models",
			headerName:    "x-goog-api-key",
			expectedField: "models",
		},
		{
			name:          "Gemini API key query",
			path:          "/v1/models?key=modelstestkey",
			expectedField: "models",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			if test.headerName != "" {
				value := "modelstestkey"
				if test.headerName == "Authorization" {
					value = "Bearer " + value
				}
				request.Header.Set(test.headerName, value)
			}

			engine.ServeHTTP(recorder, request)

			require.Equal(t, http.StatusOK, recorder.Code)
			var payload map[string]any
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
			assert.Contains(t, payload, test.expectedField)
			assert.NotContains(t, payload, "error")
			if test.expectedObject != "" {
				assert.Equal(t, test.expectedObject, payload["object"])
			}
		})
	}
}

func TestGeminiRelayHandsLongRunningPredictionToPluginRoute(t *testing.T) {
	setupRelayRouterTestDB(t)
	require.NoError(t, i18n.Init())
	user := model.User{Username: "veo-user", Status: common.UserStatusEnabled, Group: "default", Quota: 100}
	require.NoError(t, model.DB.Create(&user).Error)
	require.NoError(t, model.DB.Create(&model.Token{UserId: user.Id, Key: "veotestkey", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true}).Error)

	engine := gin.New()
	SetRelayRouter(engine)
	source, err := plugins.Source("google")
	require.NoError(t, err)
	registry := jsplugin.NewRegistry()
	_, err = registry.RegisterFactory(source, jsplugin.Options{Key: "google"})
	require.NoError(t, err)
	// The plugin route authenticates as in production, then names itself.
	handlers := func(generation *jsplugin.RoutingGeneration, group jsplugin.RouteGroup) []gin.HandlerFunc {
		production := productionPluginRouteHandlers(generation, group)
		return []gin.HandlerFunc{production[0], production[1], production[2], func(c *gin.Context) {
			c.String(http.StatusOK, "plugin %s for user %d", group.Bindings[0].Plugin.Meta.Key, c.GetInt("id"))
		}}
	}
	require.NoError(t, registry.SetGenerationPreparer(newPluginGenerationBuilder(engine.Routes(), nil, handlers).prepare))
	require.Empty(t, registry.RoutingErrors())
	previousRegistry := defaultPluginDispatcher.registry
	defaultPluginDispatcher.registry = registry
	t.Cleanup(func() { defaultPluginDispatcher.registry = previousRegistry })
	engine.NoRoute(defaultPluginDispatcher.dispatch)

	for _, testCase := range []struct {
		method   string
		path     string
		toPlugin bool
	}{
		{method: http.MethodPost, path: "/v1beta/models/veo-3.1-generate-preview:predictLongRunning", toPlugin: true},
		{method: http.MethodGet, path: "/v1beta/models/veo-3.1-generate-preview/operations/task_sample", toPlugin: true},
		{method: http.MethodPost, path: "/v1beta/models/gemini-2.5-flash:generateContent"},
	} {
		t.Run(testCase.path, func(t *testing.T) {
			request := httptest.NewRequest(testCase.method, testCase.path, strings.NewReader(`{}`))
			request.Header.Set("x-goog-api-key", "veotestkey")
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)

			if testCase.toPlugin {
				assert.Equal(t, fmt.Sprintf("plugin google for user %d", user.Id), recorder.Body.String())
				return
			}
			// The relay looks for a Gemini channel serving the model; there is none.
			assert.Equal(t, http.StatusServiceUnavailable, recorder.Code)
			assert.Contains(t, recorder.Body.String(), `"code":"model_not_found"`)
		})
	}
}

// contentRiskAccount creates an account with an API key and, unless risk is
// nil, a risk profile shaped by it, and drops any cached risk state of it.
func contentRiskAccount(t *testing.T, id, role int, risk func(userId int)) string {
	t.Helper()
	user := model.User{Id: id, Username: fmt.Sprintf("risk-%d", id), Role: role, Status: common.UserStatusEnabled, Group: "default", Quota: 100, AuthVersion: 1, AffCode: fmt.Sprintf("risk-%d", id)}
	require.NoError(t, model.DB.Create(&user).Error)
	key := fmt.Sprintf("riskgatekey%d", id)
	require.NoError(t, model.DB.Create(&model.Token{UserId: id, Key: key, Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true}).Error)
	if risk != nil {
		risk(id)
	}
	contentsafety.ForgetRiskState(id)
	return key
}

// The content risk gate runs inside TokenAuth, so a blocked account is
// denied on every route family that authenticates with an API key, and on the
// playground, which mounts the gate after the console session check. Root
// accounts and trusted accounts pass; a restricted account is throttled; an
// administrator's reset takes effect on the next request.
func TestContentRiskGateCoversEveryTokenAuthRouteFamily(t *testing.T) {
	setupRelayRouterTestDB(t)
	require.NoError(t, i18n.Init())
	require.NoError(t, model.DB.AutoMigrate(&model.UserRiskProfile{}, &model.UserSession{}, &model.Option{}, &model.Task{}, &model.Midjourney{}))
	cfg := operation_setting.GetContentSafetySetting()
	previous := *cfg
	cfg.ReviewMode, cfg.RiskRestrictRPM = operation_setting.ContentReviewModeEnforce, 1
	t.Cleanup(func() { *cfg = previous })
	thresholds := contentsafety.RiskThresholds(cfg.Bounded())
	event := func(points int, zeroTolerance bool) func(int) {
		return func(userId int) {
			_, err := model.RecordRiskEvent(model.RiskEvent{UserId: userId, Unsafe: true, Points: points, ZeroTolerance: zeroTolerance, Category: "sexual_minors", Now: time.Now().Unix(), Thresholds: thresholds})
			require.NoError(t, err)
		}
	}
	blocked := event(40, true)
	// Ids unique per run: the risk state cache and limiter outlive the database.
	base := 7000000 + int(time.Now().UnixMicro()%100000)*10
	blockedKey := contentRiskAccount(t, base+1, common.RoleCommonUser, blocked)
	normalKey := contentRiskAccount(t, base+2, common.RoleCommonUser, nil)
	rootKey := contentRiskAccount(t, base+3, common.RoleRootUser, blocked)
	trustedKey := contentRiskAccount(t, base+4, common.RoleCommonUser, func(userId int) {
		blocked(userId)
		require.NoError(t, model.SetUserRiskTrusted(userId, true))
	})
	restrictedKey := contentRiskAccount(t, base+5, common.RoleCommonUser, event(60, false))

	engine := gin.New()
	SetRelayRouter(engine)
	SetDashboardRouter(engine)
	SetVideoRouter(engine)
	SetTaskRouter(engine)
	SetTaskPluginProtocolRouter(engine)
	send := func(method, path, header, value string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(`{"model":"gpt-test","prompt":"hello","messages":[{"role":"user","content":"hello"}]}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set(header, value)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		return recorder
	}
	routes := []struct{ family, method, path, header string }{
		{family: "relay", method: http.MethodPost, path: "/v1/chat/completions"},
		{family: "models", method: http.MethodGet, path: "/v1/models"},
		{family: "gemini", method: http.MethodPost, path: "/v1beta/models/gemini-2.5-flash:generateContent", header: "x-goog-api-key"},
		{family: "midjourney", method: http.MethodPost, path: "/mj/submit/imagine"},
		{family: "task submit", method: http.MethodPost, path: "/v1/tasks/some-plugin"},
		{family: "task read", method: http.MethodGet, path: "/v1/tasks/task_1"},
		{family: "video", method: http.MethodGet, path: "/v1/video/generations/task_1"},
		{family: "task plugin protocol", method: http.MethodPost, path: "/v1/videos"},
		{family: "dashboard", method: http.MethodGet, path: "/dashboard/billing/usage"},
	}
	for _, route := range routes {
		t.Run(route.family, func(t *testing.T) {
			header, credential := "Authorization", func(key string) string { return "Bearer sk-" + key }
			if route.header != "" {
				header, credential = route.header, func(key string) string { return key }
			}
			denied := send(route.method, route.path, header, credential(blockedKey))
			assert.Equal(t, http.StatusForbidden, denied.Code, denied.Body.String())
			assert.Contains(t, denied.Body.String(), `"code":"content_risk_blocked"`)
			for name, key := range map[string]string{"normal": normalKey, "root": rootKey, "trusted": trustedKey} {
				assert.NotContains(t, send(route.method, route.path, header, credential(key)).Body.String(), "content_risk", name)
			}
		})
	}

	t.Run("playground", func(t *testing.T) {
		session := func(userId int) string {
			bundle, err := service.CreateLoginSession(userId, "password", "127.0.0.1", "content-risk-gate-test")
			require.NoError(t, err)
			return "Bearer " + bundle.AccessToken
		}
		denied := send(http.MethodPost, "/pg/chat/completions", "Authorization", session(base+1))
		assert.Equal(t, http.StatusForbidden, denied.Code, denied.Body.String())
		assert.Contains(t, denied.Body.String(), `"code":"content_risk_blocked"`)
		assert.NotContains(t, send(http.MethodPost, "/pg/chat/completions", "Authorization", session(base+2)).Body.String(), "content_risk")
	})

	t.Run("restricted accounts are throttled", func(t *testing.T) {
		assert.Equal(t, http.StatusOK, send(http.MethodGet, "/v1/models", "Authorization", "Bearer sk-"+restrictedKey).Code)
		throttled := send(http.MethodGet, "/v1/models", "Authorization", "Bearer sk-"+restrictedKey)
		assert.Equal(t, http.StatusTooManyRequests, throttled.Code)
		assert.Contains(t, throttled.Body.String(), `"code":"content_risk_throttled"`)
	})

	t.Run("a reset applies on the next request", func(t *testing.T) {
		require.Equal(t, http.StatusForbidden, send(http.MethodGet, "/v1/models", "Authorization", "Bearer sk-"+blockedKey).Code)
		require.NoError(t, model.ResetUserRiskProfile(base+1))
		assert.Equal(t, http.StatusForbidden, send(http.MethodGet, "/v1/models", "Authorization", "Bearer sk-"+blockedKey).Code, "the cached state still applies")
		contentsafety.ForgetRiskState(base + 1)
		assert.Equal(t, http.StatusOK, send(http.MethodGet, "/v1/models", "Authorization", "Bearer sk-"+blockedKey).Code)
	})

	t.Run("nothing is gated unless reviews are enforced", func(t *testing.T) {
		cfg.ReviewMode = operation_setting.ContentReviewModeShadow
		assert.Equal(t, http.StatusOK, send(http.MethodGet, "/v1/models", "Authorization", "Bearer sk-"+trustedKey).Code)
		require.NoError(t, model.SetUserRiskTrusted(base+4, false))
		contentsafety.ForgetRiskState(base + 4)
		assert.Equal(t, http.StatusOK, send(http.MethodGet, "/v1/models", "Authorization", "Bearer sk-"+trustedKey).Code)
		cfg.ReviewMode = operation_setting.ContentReviewModeEnforce
		assert.Equal(t, http.StatusForbidden, send(http.MethodGet, "/v1/models", "Authorization", "Bearer sk-"+trustedKey).Code, "an account no longer trusted is blocked again")
	})
}

func setupRelayRouterTestDB(t *testing.T) {
	t.Helper()

	gin.SetMode(gin.TestMode)
	originalIsMasterNode := common.IsMasterNode
	originalRedisEnabled := common.RedisEnabled
	originalSQLitePath := common.SQLitePath
	originalMainDatabaseType := common.MainDatabaseType()
	originalLogDatabaseType := common.LogDatabaseType()
	originalSQLDSN, hadSQLDSN := os.LookupEnv("SQL_DSN")

	common.IsMasterNode = false
	common.RedisEnabled = false
	common.SQLitePath = fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, os.Setenv("SQL_DSN", "local"))
	require.NoError(t, model.InitDB())
	model.LOG_DB = model.DB
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Token{}, &model.Ability{}))

	t.Cleanup(func() {
		if sqlDB, err := model.DB.DB(); err == nil {
			_ = sqlDB.Close()
		}
		common.IsMasterNode = originalIsMasterNode
		common.RedisEnabled = originalRedisEnabled
		common.SQLitePath = originalSQLitePath
		common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
		if hadSQLDSN {
			require.NoError(t, os.Setenv("SQL_DSN", originalSQLDSN))
		} else {
			require.NoError(t, os.Unsetenv("SQL_DSN"))
		}
	})
}
