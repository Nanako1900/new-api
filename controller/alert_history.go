package controller

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/console_setting"

	"github.com/gin-gonic/gin"
)

const (
	alertsOptionKey       = "console_setting.alerts"
	alertHistoryOptionKey = "console_setting.alert_history"
)

// alertHistoryMutex serializes the read-merge-write of the alert history, so
// two saves at once cannot drop each other's entries.
var alertHistoryMutex sync.Mutex

// updateAlertsWithHistory saves a new alert list and, in the same
// transaction, the history entries it adds or updates.
func updateAlertsWithHistory(alertsJSON string) error {
	alertHistoryMutex.Lock()
	defer alertHistoryMutex.Unlock()

	common.OptionMapRWMutex.RLock()
	previous := console_setting.GetConsoleSetting().Alerts
	history := console_setting.GetConsoleSetting().AlertHistory
	common.OptionMapRWMutex.RUnlock()

	merged, err := console_setting.MergeAlertHistory(history, previous, alertsJSON, time.Now())
	if err != nil {
		return err
	}
	return model.UpdateOptionsBulk(map[string]string{
		alertsOptionKey:       alertsJSON,
		alertHistoryOptionKey: merged,
	})
}

// GetAlertHistory lists alerts that were live before and are not live now.
func GetAlertHistory(c *gin.Context) {
	common.OptionMapRWMutex.RLock()
	past := console_setting.GetPastAlerts(time.Now())
	common.OptionMapRWMutex.RUnlock()
	common.ApiSuccess(c, past)
}

// DeleteAlertHistoryEntry removes a deleted alert from every user's history.
func DeleteAlertHistoryEntry(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}

	alertHistoryMutex.Lock()
	defer alertHistoryMutex.Unlock()

	common.OptionMapRWMutex.RLock()
	alerts := console_setting.GetConsoleSetting().Alerts
	history := console_setting.GetConsoleSetting().AlertHistory
	common.OptionMapRWMutex.RUnlock()

	kept, err := console_setting.RemoveAlertHistoryEntry(history, alerts, id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpdateOption(alertHistoryOptionKey, kept); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "option.update", map[string]any{
		"key": alertHistoryOptionKey,
		"id":  id,
	})
	common.ApiSuccess(c, nil)
}
