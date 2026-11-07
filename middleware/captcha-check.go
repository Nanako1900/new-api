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

// CaptchaCheck requires a GeeTest v4 result that GeeTest confirms when the
// check is enabled. It fails closed: a request is rejected when GeeTest cannot
// be reached or does not confirm the result.
func CaptchaCheck() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.GeetestCheckEnabled {
			c.Next()
			return
		}
		rawToken := c.GetHeader(CaptchaTokenHeader)
		if rawToken == "" {
			abortCaptcha(c, captchaRequiredCode, "Please complete the human verification first")
			return
		}
		var result geetestCaptchaResult
		if len(rawToken) > maxCaptchaTokenLength ||
			common.UnmarshalJsonStr(rawToken, &result) != nil ||
			result.LotNumber == "" || result.CaptchaOutput == "" || result.PassToken == "" || result.GenTime == "" {
			abortCaptcha(c, captchaFailedCode, "Human verification failed, please try again")
			return
		}
		passed, err := validateGeetestCaptcha(c.Request.Context(), result)
		if err != nil {
			common.SysError(common.LogText("GeeTest validation failed: %s", err.Error()))
			abortCaptcha(c, captchaUnavailableCode, "Human verification is temporarily unavailable, please try again later")
			return
		}
		if !passed {
			abortCaptcha(c, captchaFailedCode, "Human verification failed, please try again")
			return
		}
		c.Next()
	}
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
