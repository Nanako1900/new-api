package middleware

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// CaptchaTokenHeader carries the GeeTest v4 result produced by the web
// console: the JSON object returned by captchaObj.getValidate(). A header keeps
// the single-use pass token out of URLs and access logs.
const CaptchaTokenHeader = "X-Captcha-Token"

const (
	captchaRequiredCode    = "CAPTCHA_REQUIRED"
	captchaFailedCode      = "CAPTCHA_FAILED"
	captchaUnavailableCode = "CAPTCHA_UNAVAILABLE"

	maxCaptchaTokenLength = 8 << 10
	maxGeetestReplyBytes  = 64 << 10
)

// geetestValidateURL is the GeeTest v4 second-validation endpoint. Tests point
// it at a local server.
var geetestValidateURL = "https://gcaptcha4.geetest.com/validate"

var geetestHTTPClient = &http.Client{Timeout: 5 * time.Second}

type geetestCaptchaResult struct {
	LotNumber     string `json:"lot_number"`
	CaptchaOutput string `json:"captcha_output"`
	PassToken     string `json:"pass_token"`
	GenTime       string `json:"gen_time"`
}

type geetestValidateReply struct {
	Status string `json:"status"`
	Result string `json:"result"`
	Reason string `json:"reason"`
	Code   string `json:"code"`
	Msg    string `json:"msg"`
}

// CaptchaScope names a protected action. In risk mode each scope has its own
// risk policy (see captchaRiskPolicies).
type CaptchaScope string

const (
	CaptchaScopeLogin   CaptchaScope = "login"
	CaptchaScopeEmail   CaptchaScope = "email"
	CaptchaScopeCheckin CaptchaScope = "checkin"
)

// RequireCaptcha decides whether the request may proceed and writes the
// rejection when it returns false. A GeeTest result sent with the request is
// always validated, and the check fails closed when GeeTest cannot be reached
// or does not confirm it. Without a result, mode always rejects the request
// and mode risk rejects it only when a risk signal of scope fires for subject
// or the client network, or when the risk store fails. In risk mode a request
// that proceeds is recorded as an event of scope at once, so parallel requests
// count against each other; the handler calls WithdrawCaptchaRisk when the
// request turns out not to be one.
func RequireCaptcha(c *gin.Context, scope CaptchaScope, subject string) bool {
	if !common.GeetestCheckEnabled {
		return true
	}
	allowed := false
	if rawToken := c.GetHeader(CaptchaTokenHeader); rawToken != "" {
		if !verifySubmittedCaptcha(c, rawToken) {
			return false
		}
		allowed = true
		c.Set(captchaVerifiedContextKey, true)
	}
	if common.GeetestCheckMode == common.GeetestCheckModeRisk {
		allowed = takeCaptchaRisk(c, scope, captchaRiskSubject(scope, subject))
	}
	if !allowed {
		abortCaptcha(c, captchaRequiredCode, "Please complete the human verification first")
	}
	return allowed
}

// CaptchaGate runs RequireCaptcha for routes whose subject is known before
// the handler: none for email requests, the signed-in user for check-in.
// Password login calls RequireCaptcha itself because its subject is the
// submitted username.
func CaptchaGate(scope CaptchaScope) gin.HandlerFunc {
	return func(c *gin.Context) {
		subject := ""
		if scope == CaptchaScopeCheckin {
			subject = strconv.Itoa(c.GetInt("id"))
		}
		if !RequireCaptcha(c, scope, subject) {
			return
		}
		c.Next()
	}
}

// verifySubmittedCaptcha validates a GeeTest result with GeeTest and writes
// the rejection when it is unusable or not confirmed.
func verifySubmittedCaptcha(c *gin.Context, rawToken string) bool {
	var result geetestCaptchaResult
	if len(rawToken) > maxCaptchaTokenLength ||
		common.UnmarshalJsonStr(rawToken, &result) != nil ||
		result.LotNumber == "" || result.CaptchaOutput == "" || result.PassToken == "" || result.GenTime == "" {
		abortCaptcha(c, captchaFailedCode, "Human verification failed, please try again")
		return false
	}
	passed, err := validateGeetestCaptcha(c.Request.Context(), result)
	if err != nil {
		common.SysError(common.LogText("GeeTest validation failed: %s", err.Error()))
		abortCaptcha(c, captchaUnavailableCode, "Human verification is temporarily unavailable, please try again later")
		return false
	}
	if !passed {
		abortCaptcha(c, captchaFailedCode, "Human verification failed, please try again")
		return false
	}
	return true
}

func abortCaptcha(c *gin.Context, code string, key string) {
	common.ApiErrorStatus(c, http.StatusOK, common.NewMessage(key), gin.H{"code": code})
	c.Abort()
}

// validateGeetestCaptcha performs GeeTest's server-side second validation.
// It returns an error when GeeTest gives no usable verdict, so the caller can
// fail closed instead of treating an outage as a failed attempt.
func validateGeetestCaptcha(ctx context.Context, result geetestCaptchaResult) (bool, error) {
	signer := hmac.New(sha256.New, []byte(common.GeetestCaptchaKey))
	signer.Write([]byte(result.LotNumber))
	form := url.Values{
		"lot_number":     {result.LotNumber},
		"captcha_output": {result.CaptchaOutput},
		"pass_token":     {result.PassToken},
		"gen_time":       {result.GenTime},
		"sign_token":     {hex.EncodeToString(signer.Sum(nil))},
	}
	endpoint := geetestValidateURL + "?" + url.Values{"captcha_id": {common.GeetestCaptchaId}}.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return false, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := geetestHTTPClient.Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false, fmt.Errorf("unexpected HTTP status %d", response.StatusCode)
	}
	var reply geetestValidateReply
	if err := common.DecodeJson(io.LimitReader(response.Body, maxGeetestReplyBytes), &reply); err != nil {
		return false, err
	}
	if reply.Status == "error" {
		// GeeTest rejected the request itself (for example a wrong captcha ID
		// or a malformed gen_time). Treat it as a failed check, not an outage.
		common.SysError(common.LogText("GeeTest rejected the validation request: %s %s", reply.Code, reply.Msg))
		return false, nil
	}
	if reply.Result == "" {
		return false, fmt.Errorf("reply has no result")
	}
	return reply.Result == "success", nil
}
