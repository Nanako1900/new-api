package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
)

// SetMonitorRouter registers the read-only monitor console API. It is a
// separate group from /api so that it carries its own exact-origin CORS and
// monitor-session authentication; dashboard credentials are not accepted here
// and monitor credentials are not accepted anywhere else. It must be
// registered before SetRelayRouter installs the wildcard CORS middleware.
func SetMonitorRouter(router *gin.Engine) {
	monitorRoute := router.Group("/api/monitor")
	monitorRoute.Use(middleware.RouteTag("monitor"), middleware.MonitorCORS(), middleware.MonitorEnabled(), middleware.GlobalAPIRateLimit())
	// Preflight requests must match a route here; otherwise they fall through
	// to NoRoute and its wildcard CORS. MonitorCORS answers them.
	monitorRoute.OPTIONS("/*path")

	authRoute := monitorRoute.Group("/auth", middleware.MonitorOriginGuard(), middleware.CriticalRateLimit(), middleware.DisableCache())
	{
		authRoute.POST("/token", middleware.AnonymousRequestBodyLimit(), controller.MonitorToken)
		authRoute.POST("/refresh", controller.MonitorRefresh)
		authRoute.POST("/logout", controller.MonitorLogout)
	}

	// The stream must stay outside gzip: gin-contrib/gzip does not flush.
	monitorRoute.GET("/stream", middleware.MonitorAuth(), controller.MonitorStream)

	readRoute := monitorRoute.Group("", middleware.MonitorAuth(), middleware.DisableCache(), gzip.Gzip(gzip.DefaultCompression))
	{
		readRoute.GET("/self", controller.GetMonitorSelf)
		readRoute.GET("/logs", controller.GetUserLogs)
		readRoute.GET("/logs/stat", controller.GetLogsSelfStat)
		readRoute.GET("/quota_dates", controller.GetUserQuotaDates)
		readRoute.GET("/models", controller.GetUserModels)
		readRoute.GET("/subscription", controller.GetSubscriptionSelf)
		// The dashboard route is public or user-only; a monitor user is always signed in.
		readRoute.GET("/perf-metrics/summary", controller.GetPerfMetricsSummary)
		readRoute.GET("/status", controller.GetStatus)
	}
}
