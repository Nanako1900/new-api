package router

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// accessTokenExemptRoutes are /api routes that never reach dashboard
// authentication, so a personal access token has no rule to satisfy there.
var accessTokenExemptRoutes = []string{
	// Anonymous pages and setup.
	"GET /api/setup",
	"POST /api/setup",
	"GET /api/status",
	"GET /api/status/claude",
	"GET /api/uptime/status",
	"GET /api/notice",
	"GET /api/user-agreement",
	"GET /api/privacy-policy",
	"GET /api/about",
	"GET /api/home_page_content",
	"GET /api/ratio_config",
	"GET /api/user/groups",

	// Anonymous account entry points.
	"POST /api/user/register/email/start",
	"POST /api/user/register/email/verify",
	"POST /api/user/password-reset/start",
	"POST /api/user/password-reset/verify",
	"POST /api/user/password-reset/complete",
	"POST /api/user/register",
	"GET /api/user/login/encryption-key",
	"POST /api/user/login",
	"POST /api/user/login/2fa",
	"POST /api/user/login/verify",
	"POST /api/user/login/passkey/begin",
	"POST /api/user/login/passkey/finish",
	"POST /api/user/passkey/login/begin",
	"POST /api/user/passkey/login/finish",
	"GET /api/oauth/wechat",
	"GET /api/oauth/telegram/login",
	"GET /api/oauth/telegram/bind/:flow_token",

	// Browser session cookie endpoints.
	"POST /api/user/auth/refresh",
	"POST /api/user/auth/logout",

	// Payment callbacks.
	"POST /api/stripe/webhook",
	"POST /api/creem/webhook",
	"POST /api/waffo/webhook",
	"POST /api/waffo-pancake/webhook/:env",
	"POST /api/nanako-pay/webhook",
	"GET /api/user/epay/notify",
	"POST /api/user/epay/notify",
	"GET /api/subscription/epay/notify",
	"POST /api/subscription/epay/notify",
	"GET /api/subscription/epay/return",
	"POST /api/subscription/epay/return",

	// API key authentication (TokenAuthReadOnly).
	"GET /api/usage/token/",
	"GET /api/log/token",

	// Monitor console API: monitor-session authentication only (MonitorAuth,
	// or the monitor refresh cookie); dashboard credentials never apply.
	"OPTIONS /api/monitor/*path",
	"POST /api/monitor/auth/token",
	"POST /api/monitor/auth/refresh",
	"POST /api/monitor/auth/logout",
	"GET /api/monitor/self",
	"GET /api/monitor/logs",
	"GET /api/monitor/logs/stat",
	"GET /api/monitor/quota_dates",
	"GET /api/monitor/models",
	"GET /api/monitor/subscription",
	"GET /api/monitor/perf-metrics/summary",
	"GET /api/monitor/status",
	"GET /api/monitor/stream",
	"GET /api/monitor/preferences",
	"PUT /api/monitor/preferences",
	"GET /api/monitor/global/overview",
	"GET /api/monitor/global/logs",
}

// accessTokenHelperRoutes are declared through handlePermissionRoute outside
// channelPermissionRoutes.
var accessTokenHelperRoutes = map[string]authz.Permission{
	"GET /api/task_plugin_options":                          authz.TaskPluginBind,
	"GET /api/audit":                                        authz.AuditRead,
	"GET /api/content_safety/logs":                          authz.AuditRead,
	"GET /api/content_safety/stats":                         authz.AuditRead,
	"GET /api/content_safety/risk_profiles":                 authz.AuditRead,
	"GET /api/content_safety/risk_profiles/:user_id":        authz.AuditRead,
	"POST /api/content_safety/risk_profiles/:user_id/reset": authz.AuditRead,
	"POST /api/content_safety/risk_profiles/:user_id/trust": authz.AuditRead,
}

func newAccessTokenScopeTestEngine(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	// A permission route that is also in the static table panics here.
	require.NotPanics(t, func() {
		SetApiRouter(engine)
		SetMonitorRouter(engine)
		SetDashboardRouter(engine)
		SetRelayRouter(engine)
		SetTaskPluginProtocolRouter(engine)
		SetVideoRouter(engine)
		SetTaskRouter(engine)
	})
	return engine
}

func TestAccessTokenRouteRulesCoverEveryDashboardRoute(t *testing.T) {
	engine := newAccessTokenScopeTestEngine(t)
	exempt := map[string]bool{}
	for _, key := range accessTokenExemptRoutes {
		exempt[key] = true
	}
	registered := map[string]bool{}
	panel := map[string]bool{}
	for _, route := range engine.Routes() {
		if !strings.HasPrefix(route.Path, "/api/") && !strings.HasPrefix(route.Path, "/pg/") {
			continue
		}
		key := route.Method + " " + route.Path
		registered[key] = true
		if !exempt[key] {
			panel[key] = true
		}
	}
	for _, key := range accessTokenExemptRoutes {
		assert.True(t, registered[key], "exempt route %s is no longer registered", key)
	}

	declared := map[string]int{}
	for _, key := range middleware.AccessTokenRouteRuleKeys() {
		declared[key]++
	}
	for key := range panel {
		assert.Equal(t, 1, declared[key], "panel route %s must be declared exactly once", key)
	}
	for key := range declared {
		assert.True(t, panel[key], "declared route %s is not a registered panel route", key)
	}

	permissionRoutes := map[string]authz.Permission{}
	for _, route := range channelPermissionRoutes {
		permissionRoutes[route.method+" "+joinPaths("/api/channel", route.path)] = route.permission
	}
	for key, permission := range accessTokenHelperRoutes {
		permissionRoutes[key] = permission
	}
	for key, permission := range permissionRoutes {
		rule, ok := middleware.AccessTokenRouteRule(key)
		require.True(t, ok, key)
		assert.Equal(t, "scope", rule.Kind(), key)
		assert.Equal(t, service.AccessTokenScopeOf(permission), rule.Scope(), key)
	}
}

func TestSelfAffiliateInviteesRequireWalletReadAndUseAuthenticatedOwner(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "affiliate-auth.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	oldDB, oldLogDB, oldRedis, oldType := model.DB, model.LOG_DB, common.RedisEnabled, common.MainDatabaseType()
	model.DB, model.LOG_DB, common.RedisEnabled = db, db, false
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB, model.LOG_DB, common.RedisEnabled = oldDB, oldLogDB, oldRedis
		common.SetMainDatabaseType(oldType)
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserAccessToken{}, &model.AffiliateOrder{}, &model.AuditLog{}))
	users := []model.User{
		{Id: 801, Username: "owner", AffCode: "owner", Role: common.RoleCommonUser, Status: common.UserStatusEnabled},
		{Id: 802, Username: "buyer-private-login", DisplayName: "Own invitee", Email: "test@example.invalid", AffCode: "own", InviterId: 801},
		{Id: 803, Username: "other-owner", AffCode: "other-owner"},
		{Id: 804, Username: "other-buyer", DisplayName: "Other invitee", AffCode: "other", InviterId: 803},
	}
	require.NoError(t, db.Create(&users).Error)
	require.NoError(t, db.Create(&model.AffiliateOrder{TradeNo: "own-paid", BuyerID: 802, InviterID: 801, Currency: "CNY", PaidCents: 505, SettledAt: 100}).Error)

	engine := newAccessTokenScopeTestEngine(t)
	for _, tc := range []struct {
		name, scope, path string
		status            int
	}{
		{"anonymous", "", "/api/user/affiliate/invitees", http.StatusUnauthorized},
		{"missing wallet scope", "profile:read", "/api/user/affiliate/invitees", http.StatusForbidden},
		{"other owner's admin route", "wallet:read", "/api/user/803/affiliate/invitees", http.StatusForbidden},
		{"wallet scope ignores supplied owner", "wallet:read", "/api/user/affiliate/invitees?user_id=803&inviter_id=803", http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			if tc.scope != "" {
				suffix, err := common.GenerateRandomCharsKey(43)
				require.NoError(t, err)
				raw := model.AccessTokenPrefix + suffix
				credential := &model.UserAccessToken{Name: tc.name, TokenHash: model.AccessTokenFingerprint(raw), TokenHint: model.AccessTokenHint(raw)}
				require.NoError(t, credential.SetScopes([]string{tc.scope}))
				require.NoError(t, model.CreateUserAccessToken(801, credential, service.AccessTokenMaxPerUser))
				req.Header.Set("Authorization", "Bearer "+raw)
			}
			resp := httptest.NewRecorder()
			engine.ServeHTTP(resp, req)
			require.Equal(t, tc.status, resp.Code, resp.Body.String())
			if tc.status != http.StatusOK {
				assert.NotContains(t, resp.Body.String(), "Own invitee")
				assert.NotContains(t, resp.Body.String(), "Other invitee")
				return
			}
			assert.Contains(t, resp.Header().Get("Cache-Control"), "no-store")
			var response struct {
				Success bool `json:"success"`
				Data    struct {
					Total int              `json:"total"`
					Items []map[string]any `json:"items"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(resp.Body.Bytes(), &response))
			assert.True(t, response.Success)
			assert.Equal(t, 1, response.Data.Total)
			require.Len(t, response.Data.Items, 1)
			assert.Equal(t, "Own invitee", response.Data.Items[0]["display_name"])
			assert.Equal(t, []any{map[string]any{"currency": "CNY", "paid_cents": "505"}}, response.Data.Items[0]["topup_totals"])
			assert.NotContains(t, response.Data.Items[0], "username")
			assert.NotContains(t, response.Data.Items[0], "email")
		})
	}
}

func TestAccessTokenCatalogCoversEveryPermission(t *testing.T) {
	catalog := service.AccessTokenCatalog(1, common.RoleRootUser)
	scopes := map[string]bool{}
	resources := map[string]int{}
	for _, group := range catalog {
		for _, resource := range group.Resources {
			resources[resource.Resource]++
			for _, action := range resource.Actions {
				scopes[resource.Resource+":"+action.Action] = true
			}
		}
	}
	for _, permission := range authz.AllPermissions() {
		assert.True(t, scopes[service.AccessTokenScopeOf(permission)], "root catalog lacks %s", service.AccessTokenScopeOf(permission))
	}
	for resource, count := range resources {
		assert.Equal(t, 1, count, "resource %s appears in more than one catalog entry", resource)
	}
}

func TestAccessTokenVerificationScopesAreAllListed(t *testing.T) {
	files, err := filepath.Glob("../service/*.go")
	require.NoError(t, err)
	fileSet := token.NewFileSet()
	var scopes []string
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		parsed, err := parser.ParseFile(fileSet, file, nil, 0)
		require.NoError(t, err)
		for _, declaration := range parsed.Decls {
			general, ok := declaration.(*ast.GenDecl)
			if !ok || general.Tok != token.CONST {
				continue
			}
			for _, spec := range general.Specs {
				value := spec.(*ast.ValueSpec)
				for i, name := range value.Names {
					if !strings.HasPrefix(name.Name, "VerificationScope") || i >= len(value.Values) {
						continue
					}
					literal, ok := value.Values[i].(*ast.BasicLit)
					require.True(t, ok, name.Name)
					scope, err := strconv.Unquote(literal.Value)
					require.NoError(t, err)
					scopes = append(scopes, scope)
				}
			}
		}
	}
	require.NotEmpty(t, scopes)
	for _, scope := range scopes {
		_, listed := service.AccessTokenVerificationScope(scope)
		assert.True(t, listed, "verification scope %s has no access token rule", scope)
	}
}
