package router

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/monitorstream"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const (
	monitorTestOrigin   = "https://my.meowapi.dev"
	monitorTestCallback = monitorTestOrigin + "/auth/callback"
	// RFC 7636 Appendix B.
	monitorTestVerifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	monitorTestChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
)

type monitorTestEnv struct {
	engine         *gin.Engine
	user           *model.User
	dashboardToken string
	dashboardSID   string
}

func setupMonitorRouterTest(t *testing.T) *monitorTestEnv {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, i18n.Init())
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.AuthFlow{}, &model.Log{}, &model.AuditLog{}, &model.UserAccessToken{}, &model.Option{}))

	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis, previousSecret, previousSecure := common.RedisEnabled, common.SessionSecret, common.SessionCookieSecure
	previousEnabled, previousURIs, previousOrigins := common.MonitorSSOEnabled, common.MonitorRedirectURIs, common.MonitorOrigins
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		common.RedisEnabled, common.SessionSecret, common.SessionCookieSecure = previousRedis, previousSecret, previousSecure
		common.MonitorSSOEnabled, common.MonitorRedirectURIs, common.MonitorOrigins = previousEnabled, previousURIs, previousOrigins
		_ = sqlDB.Close()
	})
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.SessionSecret = "monitor-router-test-secret-with-enough-entropy"
	common.SessionCookieSecure = false
	common.MonitorSSOEnabled = true
	common.MonitorRedirectURIs = []string{monitorTestCallback}
	common.MonitorOrigins = []string{monitorTestOrigin}

	user := &model.User{Username: "monitor-user", Password: "placeholder", Email: "monitor@example.com", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "monitor-user", Quota: 5000}
	require.NoError(t, db.Create(user).Error)
	bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "router-test")
	require.NoError(t, err)

	engine := gin.New()
	SetApiRouter(engine)
	SetMonitorRouter(engine)
	SetRelayRouter(engine)
	return &monitorTestEnv{engine: engine, user: user, dashboardToken: bundle.AccessToken, dashboardSID: bundle.Session.SID}
}

type monitorTestRequest struct {
	method, path, body, origin, bearer string
	cookies                            []*http.Cookie
	headers                            map[string]string
}

func (env *monitorTestEnv) do(request monitorTestRequest) *httptest.ResponseRecorder {
	httpRequest := httptest.NewRequest(request.method, request.path, strings.NewReader(request.body))
	httpRequest.RemoteAddr = "192.0.2.10:5000"
	if request.body != "" {
		httpRequest.Header.Set("Content-Type", "application/json")
	}
	if request.origin != "" {
		httpRequest.Header.Set("Origin", request.origin)
	}
	if request.bearer != "" {
		httpRequest.Header.Set("Authorization", "Bearer "+request.bearer)
	}
	for name, value := range request.headers {
		httpRequest.Header.Set(name, value)
	}
	for _, cookie := range request.cookies {
		httpRequest.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	env.engine.ServeHTTP(response, httpRequest)
	return response
}

func responseJSON(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body), response.Body.String())
	return body
}

func responseCookie(response *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}

// signIn runs authorize and token exchange; it returns the monitor access token
// and refresh cookie.
func (env *monitorTestEnv) signIn(t *testing.T) (string, *http.Cookie) {
	t.Helper()
	authorize := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/user/monitor/authorize", bearer: env.dashboardToken,
		body: `{"redirect_uri":"` + monitorTestCallback + `","code_challenge":"` + monitorTestChallenge + `","code_challenge_method":"S256"}`})
	require.Equal(t, http.StatusOK, authorize.Code, authorize.Body.String())
	code := responseJSON(t, authorize)["data"].(map[string]any)["code"].(string)
	binding := responseCookie(authorize, service.MonitorBindingCookieName)
	require.NotNil(t, binding, "authorize binds the code to the requesting browser")

	token := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/monitor/auth/token", origin: monitorTestOrigin,
		cookies: []*http.Cookie{binding},
		body:    `{"code":"` + code + `","code_verifier":"` + monitorTestVerifier + `","redirect_uri":"` + monitorTestCallback + `"}`})
	require.Equal(t, http.StatusOK, token.Code, token.Body.String())
	data := responseJSON(t, token)["data"].(map[string]any)
	cookie := responseCookie(token, service.MonitorRefreshCookieName)
	require.NotNil(t, cookie)
	return data["access_token"].(string), cookie
}

func TestMonitorSSORoundTripThroughRoutes(t *testing.T) {
	env := setupMonitorRouterTest(t)
	accessToken, refreshCookie := env.signIn(t)

	assert.True(t, refreshCookie.HttpOnly)
	assert.Equal(t, http.SameSiteStrictMode, refreshCookie.SameSite)
	assert.Equal(t, "/api/monitor/auth", refreshCookie.Path)
	assert.Empty(t, refreshCookie.Domain, "the refresh cookie must stay host-only")

	self := env.do(monitorTestRequest{method: http.MethodGet, path: "/api/monitor/self", origin: monitorTestOrigin, bearer: accessToken})
	require.Equal(t, http.StatusOK, self.Code, self.Body.String())
	assert.Equal(t, monitorTestOrigin, self.Header().Get("Access-Control-Allow-Origin"))
	user := responseJSON(t, self)["data"].(map[string]any)
	assert.EqualValues(t, env.user.Id, user["id"])
	assert.EqualValues(t, 5000, user["quota"])
	assert.NotContains(t, user, "email", "the monitor projection must not expose account details")
	logs := env.do(monitorTestRequest{method: http.MethodGet, path: "/api/monitor/logs?p=1&page_size=10", bearer: accessToken})
	assert.Equal(t, http.StatusOK, logs.Code, logs.Body.String())

	refresh := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/monitor/auth/refresh", origin: monitorTestOrigin, cookies: []*http.Cookie{refreshCookie}})
	require.Equal(t, http.StatusOK, refresh.Code, refresh.Body.String())
	rotated := responseCookie(refresh, service.MonitorRefreshCookieName)
	require.NotNil(t, rotated)
	assert.NotEqual(t, refreshCookie.Value, rotated.Value)

	logout := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/monitor/auth/logout", origin: monitorTestOrigin, cookies: []*http.Cookie{rotated}})
	require.Equal(t, http.StatusOK, logout.Code, logout.Body.String())
	afterLogout := env.do(monitorTestRequest{method: http.MethodGet, path: "/api/monitor/self", bearer: accessToken})
	assert.Equal(t, http.StatusUnauthorized, afterLogout.Code)
	assert.Equal(t, "MONITOR_AUTH_INVALID", responseJSON(t, afterLogout)["code"])
	dashboard := env.do(monitorTestRequest{method: http.MethodGet, path: "/api/user/self", bearer: env.dashboardToken})
	assert.Equal(t, http.StatusOK, dashboard.Code, "monitor logout must leave the main site signed in")
}

func TestMonitorAndDashboardCredentialsDoNotCross(t *testing.T) {
	env := setupMonitorRouterTest(t)
	accessToken, refreshCookie := env.signIn(t)

	for _, path := range []string{"/api/user/self", "/api/log/self", "/api/token/"} {
		response := env.do(monitorTestRequest{method: http.MethodGet, path: path, bearer: accessToken})
		assert.Equal(t, http.StatusUnauthorized, response.Code, "a monitor token must be rejected on %s", path)
	}
	mint := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/user/monitor/authorize", bearer: accessToken,
		body: `{"redirect_uri":"` + monitorTestCallback + `","code_challenge":"` + monitorTestChallenge + `","code_challenge_method":"S256"}`})
	assert.Equal(t, http.StatusUnauthorized, mint.Code, "a monitor session must not issue monitor codes")

	dashboardOnMonitor := env.do(monitorTestRequest{method: http.MethodGet, path: "/api/monitor/self", bearer: env.dashboardToken})
	assert.Equal(t, http.StatusUnauthorized, dashboardOnMonitor.Code)
	assert.Equal(t, "MONITOR_AUTH_INVALID", responseJSON(t, dashboardOnMonitor)["code"])

	escalate := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/user/auth/refresh",
		cookies: []*http.Cookie{{Name: service.RefreshCookieName, Value: refreshCookie.Value}}})
	assert.Equal(t, http.StatusUnauthorized, escalate.Code, "a monitor refresh token must not mint a dashboard session")
	assert.NotContains(t, escalate.Body.String(), "access_token")
}

func TestMonitorCORSAndOriginGuard(t *testing.T) {
	env := setupMonitorRouterTest(t)
	accessToken, refreshCookie := env.signIn(t)
	preflightHeaders := map[string]string{"Access-Control-Request-Method": http.MethodGet, "Access-Control-Request-Headers": "authorization"}

	preflight := env.do(monitorTestRequest{method: http.MethodOptions, path: "/api/monitor/self", origin: monitorTestOrigin, headers: preflightHeaders})
	assert.Equal(t, http.StatusNoContent, preflight.Code)
	assert.Equal(t, monitorTestOrigin, preflight.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "true", preflight.Header().Get("Access-Control-Allow-Credentials"))
	assert.Contains(t, preflight.Header().Get("Access-Control-Allow-Headers"), "Authorization")

	foreignPreflight := env.do(monitorTestRequest{method: http.MethodOptions, path: "/api/monitor/self", origin: "https://evil.example", headers: preflightHeaders})
	assert.Empty(t, foreignPreflight.Header().Get("Access-Control-Allow-Origin"), "a foreign origin must not get CORS, not even the wildcard")
	foreignRead := env.do(monitorTestRequest{method: http.MethodGet, path: "/api/monitor/self", origin: "https://evil.example", bearer: accessToken})
	assert.Empty(t, foreignRead.Header().Get("Access-Control-Allow-Origin"))

	for _, origin := range []string{"https://evil.example", ""} {
		refresh := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/monitor/auth/refresh", origin: origin, cookies: []*http.Cookie{refreshCookie}})
		assert.Equal(t, http.StatusForbidden, refresh.Code, "origin %q", origin)
		assert.Equal(t, "AUTH_ORIGIN_FORBIDDEN", responseJSON(t, refresh)["code"])
	}

	common.MonitorSSOEnabled = false
	disabled := env.do(monitorTestRequest{method: http.MethodGet, path: "/api/monitor/self", bearer: accessToken})
	assert.Equal(t, http.StatusNotFound, disabled.Code)
	assert.Equal(t, "MONITOR_DISABLED", responseJSON(t, disabled)["code"])
	authorize := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/user/monitor/authorize", bearer: env.dashboardToken,
		body: `{"redirect_uri":"` + monitorTestCallback + `","code_challenge":"` + monitorTestChallenge + `","code_challenge_method":"S256"}`})
	assert.Equal(t, http.StatusNotFound, authorize.Code)
}

func TestMonitorSignOutFollowsTheMainSite(t *testing.T) {
	env := setupMonitorRouterTest(t)
	accessToken, refreshCookie := env.signIn(t)

	logout := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/user/auth/logout", bearer: env.dashboardToken})
	require.Equal(t, http.StatusOK, logout.Code, logout.Body.String())

	read := env.do(monitorTestRequest{method: http.MethodGet, path: "/api/monitor/self", bearer: accessToken})
	assert.Equal(t, http.StatusUnauthorized, read.Code)
	refresh := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/monitor/auth/refresh", origin: monitorTestOrigin, cookies: []*http.Cookie{refreshCookie}})
	assert.Equal(t, http.StatusUnauthorized, refresh.Code)
	assert.Equal(t, "MONITOR_SESSION_INVALID", responseJSON(t, refresh)["code"])
	cleared := responseCookie(refresh, service.MonitorRefreshCookieName)
	require.NotNil(t, cleared)
	assert.True(t, cleared.MaxAge < 0 || cleared.Expires.Before(time.Now()), "an invalid monitor cookie is cleared")
}

// openMonitorStream opens a real HTTP SSE connection, so the test also proves
// that frames are flushed through gin instead of buffered.
func openMonitorStream(t *testing.T, ctx context.Context, server *httptest.Server, accessToken string) *http.Response {
	t.Helper()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/monitor/stream", nil)
	require.NoError(t, err)
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Accept", "text/event-stream")
	request.Header.Set("Origin", monitorTestOrigin)
	response, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	t.Cleanup(func() { _ = response.Body.Close() })
	return response
}

// readSSEEvent returns the next named event, skipping retry hints and pings.
func readSSEEvent(t *testing.T, reader *bufio.Reader) (string, string) {
	t.Helper()
	var name, data string
	for {
		line, err := reader.ReadString('\n')
		require.NoError(t, err)
		line = strings.TrimRight(line, "\n")
		switch {
		case line == "" && name != "":
			return name, data
		case strings.HasPrefix(line, "event: "):
			name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			data = strings.TrimPrefix(line, "data: ")
		}
	}
}

func startMonitorStreams(t *testing.T, maxPerUser int) context.Context {
	t.Helper()
	previousMax := common.MonitorStreamMaxPerUser
	common.MonitorStreamMaxPerUser = maxPerUser
	ctx, cancel := context.WithCancel(context.Background())
	monitorstream.Start(ctx)
	t.Cleanup(func() {
		monitorstream.Stop()
		cancel()
		common.MonitorStreamMaxPerUser = previousMax
	})
	return ctx
}

func TestMonitorStreamPushesNewLogsOverHTTP(t *testing.T) {
	env := setupMonitorRouterTest(t)
	ctx := startMonitorStreams(t, 5)
	accessToken, _ := env.signIn(t)
	server := httptest.NewServer(env.engine)
	t.Cleanup(server.Close)

	response := openMonitorStream(t, ctx, server, accessToken)
	require.Equal(t, http.StatusOK, response.StatusCode)
	assert.Equal(t, "text/event-stream", response.Header.Get("Content-Type"))
	assert.Equal(t, monitorTestOrigin, response.Header.Get("Access-Control-Allow-Origin"))
	reader := bufio.NewReader(response.Body)
	name, data := readSSEEvent(t, reader)
	require.Equal(t, "hello", name)
	assert.Contains(t, data, `"quota":5000`)

	model.RecordLog(env.user.Id, model.LogTypeTopup, common.NewMessage("monitor stream test top-up"))
	model.RecordLog(env.user.Id+1000, model.LogTypeTopup, common.NewMessage("another user's row"))

	name, data = readSSEEvent(t, reader)
	require.Equal(t, "logs", name)
	assert.Contains(t, data, "monitor stream test top-up")
	assert.NotContains(t, data, "another user's row")
	assert.Contains(t, data, `"key":`)
}

func TestMonitorStreamEnforcesThePerUserLimit(t *testing.T) {
	env := setupMonitorRouterTest(t)
	ctx := startMonitorStreams(t, 1)
	accessToken, _ := env.signIn(t)
	server := httptest.NewServer(env.engine)
	t.Cleanup(server.Close)

	first := openMonitorStream(t, ctx, server, accessToken)
	require.Equal(t, http.StatusOK, first.StatusCode)
	name, _ := readSSEEvent(t, bufio.NewReader(first.Body))
	require.Equal(t, "hello", name)

	second := openMonitorStream(t, ctx, server, accessToken)
	assert.Equal(t, http.StatusTooManyRequests, second.StatusCode)
}

func TestMonitorCodeOnlyWorksInTheBrowserThatRequestedIt(t *testing.T) {
	env := setupMonitorRouterTest(t)
	authorize := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/user/monitor/authorize", bearer: env.dashboardToken,
		body: `{"redirect_uri":"` + monitorTestCallback + `","code_challenge":"` + monitorTestChallenge + `","code_challenge_method":"S256"}`})
	require.Equal(t, http.StatusOK, authorize.Code, authorize.Body.String())
	code := responseJSON(t, authorize)["data"].(map[string]any)["code"].(string)
	binding := responseCookie(authorize, service.MonitorBindingCookieName)
	require.NotNil(t, binding)
	assert.True(t, binding.HttpOnly)
	assert.Equal(t, http.SameSiteStrictMode, binding.SameSite)
	assert.Equal(t, "/api/monitor/auth", binding.Path)
	assert.Equal(t, 60, binding.MaxAge)
	body := `{"code":"` + code + `","code_verifier":"` + monitorTestVerifier + `","redirect_uri":"` + monitorTestCallback + `"}`

	stolen := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/monitor/auth/token", origin: monitorTestOrigin, body: body})
	assert.Equal(t, http.StatusBadRequest, stolen.Code)
	assert.Equal(t, "MONITOR_GRANT_INVALID", responseJSON(t, stolen)["code"])

	planted := &http.Cookie{Name: service.MonitorBindingCookieName, Value: "planted-by-a-sibling-subdomain"}
	owner := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/monitor/auth/token", origin: monitorTestOrigin, body: body, cookies: []*http.Cookie{planted, binding}})
	assert.Equal(t, http.StatusOK, owner.Code, "neither the foreign attempt nor a planted binding cookie may block the owner: %s", owner.Body.String())
}

func TestMonitorRefreshRefusesAPlantedSecondCookie(t *testing.T) {
	env := setupMonitorRouterTest(t)
	_, refreshCookie := env.signIn(t)
	planted := &http.Cookie{Name: service.MonitorRefreshCookieName, Value: "00000000-0000-0000-0000-000000000000.planted"}

	for _, path := range []string{"/api/monitor/auth/refresh", "/api/monitor/auth/logout"} {
		response := env.do(monitorTestRequest{method: http.MethodPost, path: path, origin: monitorTestOrigin, cookies: []*http.Cookie{planted, refreshCookie}})
		assert.Equal(t, http.StatusBadRequest, response.Code, path)
		assert.Nil(t, responseCookie(response, service.MonitorRefreshCookieName), "%s must not clear the real cookie", path)
	}
	refresh := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/monitor/auth/refresh", origin: monitorTestOrigin, cookies: []*http.Cookie{refreshCookie}})
	assert.Equal(t, http.StatusOK, refresh.Code, "the real session survives the planted cookie")
}

func TestMonitorLogoutWithOnlyTheAccessToken(t *testing.T) {
	env := setupMonitorRouterTest(t)
	accessToken, _ := env.signIn(t)

	logout := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/monitor/auth/logout", origin: monitorTestOrigin, bearer: accessToken})
	require.Equal(t, http.StatusOK, logout.Code, logout.Body.String())

	read := env.do(monitorTestRequest{method: http.MethodGet, path: "/api/monitor/self", bearer: accessToken})
	assert.Equal(t, http.StatusUnauthorized, read.Code)
}

func TestMonitorLogoutWithAStaleCookieFallsBackToTheAccessToken(t *testing.T) {
	env := setupMonitorRouterTest(t)
	accessToken, refreshCookie := env.signIn(t)
	sid, _, _ := strings.Cut(refreshCookie.Value, ".")
	stale := &http.Cookie{Name: service.MonitorRefreshCookieName, Value: sid + ".a-secret-that-no-longer-matches"}

	logout := env.do(monitorTestRequest{method: http.MethodPost, path: "/api/monitor/auth/logout", origin: monitorTestOrigin, bearer: accessToken, cookies: []*http.Cookie{stale}})
	require.Equal(t, http.StatusOK, logout.Code, logout.Body.String())

	read := env.do(monitorTestRequest{method: http.MethodGet, path: "/api/monitor/self", bearer: accessToken})
	assert.Equal(t, http.StatusUnauthorized, read.Code, "logout must end the session even when the cookie is stale")
}
