package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// GetContentSafetyLogs lists content safety decisions for administrators
// holding the audit read permission.
func GetContentSafetyLogs(c *gin.Context) {
	page := common.GetPageQuery(c)
	filter := model.ContentSafetyLogFilter{Decision: c.Query("decision"), Model: c.Query("model"), RequestId: c.Query("request_id")}
	valid := page.Page >= 1 && page.PageSize >= 1 && page.Page <= 100000000 && model.ValidContentSafetyDecision(filter.Decision) && len(filter.RequestId) <= 64 && len(filter.Model) <= 255
	if raw := c.Query("user_id"); raw != "" {
		userId, err := strconv.Atoi(raw)
		valid = valid && err == nil && userId > 0
		filter.UserId = userId
	}
	for name, target := range map[string]*int64{"start_timestamp": &filter.StartTimestamp, "end_timestamp": &filter.EndTimestamp} {
		if raw := c.Query(name); raw != "" {
			parsed, err := strconv.ParseInt(raw, 10, 64)
			valid = valid && err == nil && parsed >= 0
			*target = parsed
		}
	}
	if !valid || (filter.EndTimestamp > 0 && filter.EndTimestamp < filter.StartTimestamp) {
		common.ApiErrorT(c, "Invalid content safety log query")
		return
	}
	logs, total, err := model.GetContentSafetyLogs(filter, page.GetStartIdx(), page.GetPageSize(), c.GetInt("role"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetItems(logs)
	page.SetTotal(int(total))
	common.ApiSuccess(c, page)
}
