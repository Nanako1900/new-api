package middleware

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service/contentsafety"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// ContentRiskGate applies the content risk actions to the signed-in account
// of a console route that relays requests, as TokenAuth does for API keys.
func ContentRiskGate() func(c *gin.Context) {
	return func(c *gin.Context) {
		if allowContentRisk(c, c.GetInt("id"), c.GetInt("role")) {
			c.Next()
		}
	}
}

// allowContentRisk is the authorization check after authentication that
// enforces an account's content risk while reviews are enforced: a blocked
// account is denied every request, and a restricted one is held to
// risk_restrict_rpm requests a minute. Root and trusted accounts pass. It
// aborts the request and returns false when it denies it.
func allowContentRisk(c *gin.Context, userId, role int) bool {
	current := operation_setting.GetContentSafetySetting()
	if current.ReviewMode != operation_setting.ContentReviewModeEnforce || role >= common.RoleRootUser {
		return true
	}
	cfg := current.Bounded()
	state, err := contentsafety.LoadRiskState(userId)
	if err != nil {
		common.SysLog(common.LogText("content risk state read failed for user %d: %s", userId, err.Error()))
		abortWithOpenAiMessage(c, http.StatusInternalServerError, common.TranslateMessage(c, i18n.MsgDatabaseError))
		return false
	}
	common.SetContextKey(c, constant.ContextKeyContentRiskState, state)
	if state.Trusted {
		return true
	}
	if state.Blocked {
		abortWithOpenAiMessage(c, http.StatusForbidden, i18n.T(c, i18n.MsgContentRiskBlocked), types.ErrorCodeContentRiskBlocked)
		return false
	}
	if state.Level(common.GetTimestamp(), contentsafety.RiskThresholds(cfg)) == model.RiskLevelRestrict &&
		!contentsafety.AllowRiskRequest(c.Request.Context(), userId, cfg.RiskRestrictRPM) {
		abortWithOpenAiMessage(c, http.StatusTooManyRequests, i18n.T(c, i18n.MsgContentRiskThrottled), types.ErrorCodeContentRiskThrottled)
		return false
	}
	return true
}
