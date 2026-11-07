package middleware

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
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

func setupCaptchaCheck(t *testing.T, enabled bool, geetest http.HandlerFunc) {
	t.Helper()
	previousEnabled := common.GeetestCheckEnabled
	previousID := common.GeetestCaptchaId
	previousKey := common.GeetestCaptchaKey
	previousURL := geetestValidateURL
	previousClient := geetestHTTPClient
	t.Cleanup(func() {
		common.GeetestCheckEnabled = previousEnabled
		common.GeetestCaptchaId = previousID
		common.GeetestCaptchaKey = previousKey
		geetestValidateURL = previousURL
		geetestHTTPClient = previousClient
	})
	common.GeetestCheckEnabled = enabled
	common.GeetestCaptchaId = testCaptchaID
	common.GeetestCaptchaKey = testCaptchaKey
	if geetest != nil {
		server := httptest.NewServer(geetest)
		t.Cleanup(server.Close)
		geetestValidateURL = server.URL + "/validate"
	}
}

func runCaptchaCheck(t *testing.T, token string) captchaCheckResult {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	result := captchaCheckResult{}
	router.POST("/api/user/login", CaptchaCheck(), func(c *gin.Context) {
		result.reachedHandler = true
		c.JSON(http.StatusOK, gin.H{"success": true})
	})
	request := httptest.NewRequest(http.MethodPost, "/api/user/login", nil)
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
	result.success = body.Success
	result.code = body.Code
	return result
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
