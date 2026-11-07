package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type captchaRouteReply struct {
	Success bool   `json:"success"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func serveCaptchaRouteRequest(t *testing.T, engine *gin.Engine, method, target, body string) captchaRouteReply {
	t.Helper()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	var reply captchaRouteReply
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &reply), response.Body.String())
	return reply
}

func setGeetestOptions(t *testing.T, enabled bool, captchaID, captchaKey string) {
	t.Helper()
	previousEnabled := common.GeetestCheckEnabled
	previousID := common.GeetestCaptchaId
	previousKey := common.GeetestCaptchaKey
	t.Cleanup(func() {
		common.GeetestCheckEnabled = previousEnabled
		common.GeetestCaptchaId = previousID
		common.GeetestCaptchaKey = previousKey
	})
	common.GeetestCheckEnabled = enabled
	common.GeetestCaptchaId = captchaID
	common.GeetestCaptchaKey = captchaKey
}

// The anonymous account entry points must reach the GeeTest check before any
// account lookup or email is sent. The check-in route sits behind UserAuth and
// is covered by the web console's check-in flow test.
func TestAnonymousAccountRoutesRequireGeetest(t *testing.T) {
	setGeetestOptions(t, true, "captcha-id", "captcha-key")
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetApiRouter(engine)

	tests := []struct {
		method string
		target string
	}{
		{method: http.MethodPost, target: "/api/user/register/email/start"},
		{method: http.MethodPost, target: "/api/user/password-reset/start"},
		{method: http.MethodPost, target: "/api/user/login"},
	}
	for _, test := range tests {
		t.Run(test.method+" "+test.target, func(t *testing.T) {
			reply := serveCaptchaRouteRequest(t, engine, test.method, test.target, `{"username":"alice","password":"secret-password","email":"alice@example.com"}`)

			assert.False(t, reply.Success)
			assert.Equal(t, "CAPTCHA_REQUIRED", reply.Code)
		})
	}

	// Registration, email verification and password reset completion spend a
	// token that already passed the captcha when its email was requested.
	for _, target := range []string{"/api/user/register", "/api/user/register/email/verify", "/api/user/password-reset/verify", "/api/user/password-reset/complete"} {
		t.Run("no captcha "+target, func(t *testing.T) {
			reply := serveCaptchaRouteRequest(t, engine, http.MethodPost, target, `{}`)

			assert.False(t, reply.Success)
			assert.NotEqual(t, "CAPTCHA_REQUIRED", reply.Code)
		})
	}
}

// Saving settings that leave GeeTest on without a usable ID or key would make
// every login fail, administrators included, so the server refuses them.
func TestGeetestOptionUpdatesCannotLockOutLogin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.PUT("/api/option/", controller.UpdateOption)

	tests := []struct {
		name    string
		enabled bool
		id      string
		key     string
		body    string
		message string
	}{
		{
			name:    "enable without captcha key",
			id:      "captcha-id",
			body:    `{"key":"GeetestCheckEnabled","value":true}`,
			message: "Cannot enable GeeTest verification. Enter the GeeTest captcha ID and captcha key first.",
		},
		{
			name:    "enable without captcha ID",
			key:     "captcha-key",
			body:    `{"key":"GeetestCheckEnabled","value":true}`,
			message: "Cannot enable GeeTest verification. Enter the GeeTest captcha ID and captcha key first.",
		},
		{
			name:    "clear captcha ID while enabled",
			enabled: true,
			id:      "captcha-id",
			key:     "captcha-key",
			body:    `{"key":"GeetestCaptchaId","value":""}`,
			message: "Disable GeeTest verification before clearing the captcha ID or captcha key.",
		},
		{
			name:    "clear captcha key while enabled",
			enabled: true,
			id:      "captcha-id",
			key:     "captcha-key",
			body:    `{"key":"GeetestCaptchaKey","value":""}`,
			message: "Disable GeeTest verification before clearing the captcha ID or captcha key.",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setGeetestOptions(t, test.enabled, test.id, test.key)

			reply := serveCaptchaRouteRequest(t, engine, http.MethodPut, "/api/option/", test.body)

			assert.False(t, reply.Success)
			assert.Equal(t, test.message, reply.Message)
		})
	}
}
