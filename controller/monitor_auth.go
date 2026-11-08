package controller

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

type monitorAuthorizeRequest struct {
	RedirectURI         string `json:"redirect_uri"`
	CodeChallenge       string `json:"code_challenge"`
	CodeChallengeMethod string `json:"code_challenge_method"`
}

type monitorTokenRequest struct {
	Code         string `json:"code"`
	CodeVerifier string `json:"code_verifier"`
	RedirectURI  string `json:"redirect_uri"`
}

// MonitorAuthorize issues a monitor console authorization code for the
// caller's dashboard browser session. Access tokens cannot call it.
func MonitorAuthorize(c *gin.Context) {
	setAuthNoStore(c)
	identity, ok := requireBrowserSession(c)
	if !ok {
		return
	}
	var req monitorAuthorizeRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		writeMonitorError(c, errMonitorRequestInvalid)
		return
	}
	code, err := service.CreateMonitorAuthorizationCode(identity, req.RedirectURI, req.CodeChallenge, req.CodeChallengeMethod)
	if err != nil {
		writeMonitorError(c, err)
		return
	}
	service.WriteMonitorBindingCookie(c, code)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"code": code}})
}

// MonitorToken redeems an authorization code for a monitor session.
func MonitorToken(c *gin.Context) {
	setAuthNoStore(c)
	var req monitorTokenRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		writeMonitorError(c, errMonitorRequestInvalid)
		return
	}
	bundle, err := service.ExchangeMonitorCode(req.Code, req.CodeVerifier, req.RedirectURI, monitorCodeBindingCookie(c, req.Code), c.ClientIP(), c.Request.UserAgent())
	if err != nil {
		// A transient failure keeps the binding, so the browser can retry the
		// same code within its minute; a rejected grant ends it.
		if !errors.Is(err, service.ErrMonitorGrantInvalid) {
			writeMonitorError(c, err)
			return
		}
		service.ClearMonitorBindingCookie(c)
		writeMonitorError(c, err)
		return
	}
	service.ClearMonitorBindingCookie(c)
	service.WriteMonitorRefreshCookie(c, bundle)
	user, err := model.GetSelfUserById(bundle.Session.UserID)
	if err != nil {
		writeMonitorError(c, err)
		return
	}
	model.RecordLoginLog(user.Id, user.Role, user.Username, "Logged in successfully via "+service.MonitorLoginMethod, c.ClientIP(), "login",
		map[string]any{"method": service.MonitorLoginMethod},
		model.AuditOther{LoginMethod: service.MonitorLoginMethod, UserAgent: c.Request.UserAgent()}, c)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": monitorBundleData(bundle, user)})
}

// MonitorRefresh rotates the monitor refresh cookie and returns a new access token.
func MonitorRefresh(c *gin.Context) {
	setAuthNoStore(c)
	rawRefreshToken, duplicated := monitorRefreshCookie(c)
	if duplicated {
		writeMonitorError(c, errMonitorRequestInvalid)
		return
	}
	if rawRefreshToken == "" {
		writeMonitorError(c, service.ErrMonitorSessionInvalid)
		return
	}
	bundle, err := service.RefreshMonitorSession(rawRefreshToken, c.ClientIP(), c.Request.UserAgent())
	if err != nil {
		if errors.Is(err, service.ErrMonitorSessionInvalid) {
			service.ClearMonitorRefreshCookie(c)
		}
		writeMonitorError(c, err)
		return
	}
	service.WriteMonitorRefreshCookie(c, bundle)
	user, err := model.GetSelfUserById(bundle.Session.UserID)
	if err != nil {
		writeMonitorError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": monitorBundleData(bundle, user)})
}

// MonitorLogout ends the monitor session only; the main site stays signed in.
// Without a refresh cookie (blocked or already cleared) the monitor access
// token identifies the session instead.
func MonitorLogout(c *gin.Context) {
	setAuthNoStore(c)
	rawRefreshToken, duplicated := monitorRefreshCookie(c)
	if duplicated {
		writeMonitorError(c, errMonitorRequestInvalid)
		return
	}
	revoked := false
	if rawRefreshToken != "" {
		var err error
		if revoked, err = service.RevokeMonitorSession(rawRefreshToken); err != nil {
			writeMonitorError(c, err)
			return
		}
	}
	if rawAccessToken, ok := dashboardBearer(c.GetHeader("Authorization")); ok && !revoked {
		if err := service.RevokeMonitorSessionByAccessToken(rawAccessToken); err != nil {
			writeMonitorError(c, err)
			return
		}
	}
	service.ClearMonitorRefreshCookie(c)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// GetMonitorSelf returns the balance summary of the monitor user. It is a
// narrow projection: no email, linked accounts, invite or payment data.
func GetMonitorSelf(c *gin.Context) {
	user, err := model.GetSelfUserById(c.GetInt("id"))
	if err != nil {
		writeMonitorError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": monitorUserData(user)})
}

func monitorBundleData(bundle *service.MonitorBundle, user *model.User) gin.H {
	return gin.H{
		"access_token":      bundle.AccessToken,
		"token_type":        "Bearer",
		"access_expires_at": bundle.AccessExpiresAt,
		"session":           gin.H{"sid": bundle.Session.SID, "expires_at": bundle.Session.ExpiresAt},
		"user":              monitorUserData(user),
	}
}

// monitorUserData reads the balance from the quota cache when Redis is on: the
// database copy lags behind spending while batch updates are enabled.
func monitorUserData(user *model.User) gin.H {
	quota := user.Quota
	if cached, err := model.GetUserQuota(user.Id, false); err == nil {
		quota = cached
	}
	return gin.H{
		"id":            user.Id,
		"username":      user.Username,
		"display_name":  user.DisplayName,
		"group":         user.Group,
		"quota":         quota,
		"used_quota":    user.UsedQuota,
		"request_count": user.RequestCount,
	}
}

var errMonitorRequestInvalid = errors.New("monitor request is invalid")

// monitorCodeBindingCookie returns the binding cookie that matches code. A
// sibling subdomain can plant an extra cookie of that name in front of the
// real one, so every cookie of the name is checked, not only the first.
func monitorCodeBindingCookie(c *gin.Context, code string) string {
	expected := service.MonitorCodeBinding(strings.TrimSpace(code))
	for _, cookie := range c.Request.Cookies() {
		if cookie.Name == service.MonitorBindingCookieName && subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(expected)) == 1 {
			return cookie.Value
		}
	}
	return ""
}

// monitorRefreshCookie returns the monitor refresh cookie. A sibling subdomain
// can plant a second cookie of the same name; such a request is refused
// without clearing anything, so a planted cookie cannot sign the console into
// another account or destroy the real cookie. While a planted cookie lives the
// console cannot refresh; only a __Host- cookie would prevent that, which
// plain-http development cannot use.
func monitorRefreshCookie(c *gin.Context) (string, bool) {
	value, count := "", 0
	for _, cookie := range c.Request.Cookies() {
		if cookie.Name == service.MonitorRefreshCookieName {
			value = cookie.Value
			count++
		}
	}
	return value, count > 1
}

func writeMonitorError(c *gin.Context, err error) {
	status, code := http.StatusInternalServerError, "MONITOR_INTERNAL_ERROR"
	switch {
	case errors.Is(err, service.ErrMonitorDisabled):
		status, code = http.StatusNotFound, "MONITOR_DISABLED"
	case errors.Is(err, errMonitorRequestInvalid):
		status, code = http.StatusBadRequest, "MONITOR_REQUEST_INVALID"
	case errors.Is(err, service.ErrMonitorRedirectURIInvalid):
		status, code = http.StatusBadRequest, "MONITOR_REDIRECT_URI_INVALID"
	case errors.Is(err, service.ErrMonitorChallengeInvalid):
		status, code = http.StatusBadRequest, "MONITOR_CHALLENGE_INVALID"
	case errors.Is(err, service.ErrMonitorGrantInvalid):
		status, code = http.StatusBadRequest, "MONITOR_GRANT_INVALID"
	case errors.Is(err, service.ErrMonitorSessionInvalid):
		status, code = http.StatusUnauthorized, "MONITOR_SESSION_INVALID"
	case errors.Is(err, service.ErrMonitorRefreshRace):
		status, code = http.StatusConflict, "MONITOR_REFRESH_RACE"
	case errors.Is(err, service.ErrMonitorIssuanceLimit):
		status, code = http.StatusTooManyRequests, "MONITOR_ISSUANCE_LIMIT"
	case errors.Is(err, service.ErrLoginSessionRevoked), errors.Is(err, service.ErrLoginSessionInvalid):
		status, code = http.StatusUnauthorized, "AUTH_SESSION_REVOKED"
	}
	if status == http.StatusInternalServerError {
		logger.LogError(c.Request.Context(), common.LogText("monitor request internal error (%s %s): %v", c.Request.Method, c.Request.URL.Path, err))
	} else if status == http.StatusBadRequest || status == http.StatusUnauthorized || status == http.StatusTooManyRequests {
		// Rejected sign-ins and refreshes are security events; the error text
		// carries the reason and never a code, verifier or token.
		logger.LogWarn(c.Request.Context(), common.LogText("monitor auth rejected (%s %s): %v; ip=%s", c.Request.Method, c.Request.URL.Path, err, c.ClientIP()))
	}
	c.JSON(status, gin.H{"success": false, "code": code, "message": http.StatusText(status)})
}
