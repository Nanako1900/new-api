package middleware

import (
	"errors"
	"net/http"
	"slices"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const monitorIdentityContextKey = "monitor_identity"

// MonitorCORS grants CORS on the monitor API to the configured monitor
// origins only, with credentials, and answers their preflight requests. Other
// origins get no CORS headers, so browsers block them. Unlike CORS() it never
// emits a wildcard origin.
func MonitorCORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.Writer.Header()
		header.Add("Vary", "Origin")
		origin := c.GetHeader("Origin")
		allowed := origin != "" && slices.Contains(common.MonitorOrigins, origin)
		if allowed {
			header.Set("Access-Control-Allow-Origin", origin)
			header.Set("Access-Control-Allow-Credentials", "true")
		}
		if c.Request.Method != http.MethodOptions {
			c.Next()
			return
		}
		if allowed {
			header.Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
			// Authorization must be listed by name: the "*" wildcard never covers it.
			header.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			header.Set("Access-Control-Max-Age", "600")
		}
		c.AbortWithStatus(http.StatusNoContent)
	}
}

// MonitorEnabled hides the monitor API unless MONITOR_SSO_ENABLED is on.
func MonitorEnabled() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.MonitorSSOEnabled {
			abortMonitor(c, http.StatusNotFound, "MONITOR_DISABLED")
			return
		}
		c.Next()
	}
}

// MonitorOriginGuard requires the cookie-authenticated monitor auth endpoints
// to be called from a configured monitor origin, whatever the cookie mode.
func MonitorOriginGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin, ok := requestBrowserOrigin(c.Request)
		if !ok || !slices.Contains(common.MonitorOrigins, origin) {
			abortMonitor(c, http.StatusForbidden, "AUTH_ORIGIN_FORBIDDEN")
			return
		}
		c.Next()
	}
}

// MonitorAuth authenticates a monitor access token and exposes the user the
// way dashboard auth does, so the user's own read controllers (and the console
// preferences writer) can be reused. It sets no
// dashboard session identity: GetSessionAuthIdentity and GetStepUpIdentity
// fail for monitor requests.
func MonitorAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, ok := authorizationToken(c.GetHeader("Authorization"))
		if !ok {
			abortMonitor(c, http.StatusUnauthorized, "MONITOR_AUTH_INVALID")
			return
		}
		identity, err := service.ParseMonitorAccessToken(raw)
		if err != nil {
			abortMonitor(c, http.StatusUnauthorized, "MONITOR_AUTH_INVALID")
			return
		}
		_, user, err := service.ValidateMonitorAccess(identity)
		if err != nil {
			if errors.Is(err, service.ErrMonitorSessionInvalid) {
				abortMonitor(c, http.StatusUnauthorized, "MONITOR_AUTH_INVALID")
				return
			}
			logger.LogError(c.Request.Context(), common.LogText("monitor authentication error: %v", err))
			abortMonitor(c, http.StatusInternalServerError, "MONITOR_INTERNAL_ERROR")
			return
		}
		c.Set("username", user.Username)
		c.Set("role", user.Role)
		c.Set("id", user.Id)
		c.Set("group", user.Group)
		c.Set("user_group", user.Group)
		c.Set(monitorIdentityContextKey, identity)
		user.WriteContext(c)
		c.Next()
	}
}

// MonitorRootOnly limits the site-wide monitor endpoints to the root user.
// MonitorAuth reads the role again on every request, so a demoted user is
// refused at once.
func MonitorRootOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !AllowMonitorGlobal(c) {
			return
		}
		c.Next()
	}
}

// AllowMonitorGlobal reports whether the monitor user may see the whole site.
// When not, it logs the attempt and answers 403 MONITOR_FORBIDDEN.
func AllowMonitorGlobal(c *gin.Context) bool {
	if c.GetInt("role") >= common.RoleRootUser {
		return true
	}
	logger.LogWarn(c.Request.Context(), common.LogText("monitor global access rejected: user=%d role=%d ip=%s",
		c.GetInt("id"), c.GetInt("role"), c.ClientIP()))
	abortMonitor(c, http.StatusForbidden, "MONITOR_FORBIDDEN")
	return false
}

// GetMonitorIdentity returns the monitor session identity MonitorAuth verified.
func GetMonitorIdentity(c *gin.Context) (service.AuthIdentity, bool) {
	value, ok := c.Get(monitorIdentityContextKey)
	if !ok {
		return service.AuthIdentity{}, false
	}
	identity, ok := value.(service.AuthIdentity)
	return identity, ok
}

func abortMonitor(c *gin.Context, status int, code string) {
	c.AbortWithStatusJSON(status, gin.H{"success": false, "code": code, "message": http.StatusText(status)})
}
