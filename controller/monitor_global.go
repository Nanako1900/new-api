package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// GetMonitorGlobalOverview returns the site-wide usage of the requested
// window (1h, 3h or 24h; 3h when omitted) for the root user's console.
func GetMonitorGlobalOverview(c *gin.Context) {
	window := c.DefaultQuery("window", "3h")
	overview, err := service.GetMonitorGlobalOverview(window)
	if errors.Is(err, service.ErrMonitorGlobalWindow) {
		writeMonitorError(c, errMonitorRequestInvalid)
		return
	}
	if err != nil {
		writeMonitorError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": overview})
}

// GetMonitorGlobalLogs lists every user's request rows (consume and error)
// for the root user's console, newest first, within the site's longest log
// time range. Rows are the site-wide view (model.FormatGlobalLogView) with
// display ids; the total stops at model.GlobalLogCountLimit.
func GetMonitorGlobalLogs(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	// GetPageQuery passes a negative page size through, which drops the LIMIT.
	if pageInfo.GetPage() < 1 || pageInfo.GetPageSize() < 1 {
		writeMonitorError(c, errMonitorRequestInvalid)
		return
	}
	filter := logFilterFromQuery(c, true)
	if raw := c.Query("type"); raw != "" {
		logType, err := strconv.Atoi(raw)
		if err != nil || !model.IsGlobalLogType(logType) {
			writeMonitorError(c, errMonitorRequestInvalid)
			return
		}
	}
	startTimestamp, err := limitLogTimeRange(filter.StartTimestamp, filter.EndTimestamp)
	if err != nil {
		writeMonitorError(c, errMonitorRequestInvalid)
		return
	}
	filter.StartTimestamp = startTimestamp
	logs, total, err := model.GetGlobalLogs(filter, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), model.GlobalLogCountLimit)
	if err != nil {
		writeMonitorError(c, err)
		return
	}
	for i := range logs {
		view := model.FormatGlobalLogView(*logs[i])
		view.Id = pageInfo.GetStartIdx() + i + 1
		logs[i] = &view
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
}
