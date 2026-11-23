package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/console_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupAlertHistoryTestDB(t *testing.T) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis := common.RedisEnabled
	setting := console_setting.GetConsoleSetting()
	previousAlerts, previousHistory := setting.Alerts, setting.AlertHistory
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()

	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.AuditLog{}))
	model.DB, model.LOG_DB = db, db
	setting.Alerts, setting.AlertHistory = "", ""

	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		common.RedisEnabled = previousRedis
		setting.Alerts, setting.AlertHistory = previousAlerts, previousHistory
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
}

type alertHistoryResponse struct {
	Success bool                                `json:"success"`
	Message string                              `json:"message"`
	Data    []console_setting.AlertHistoryEntry `json:"data"`
}

func alertHistoryRequest(t *testing.T, handler gin.HandlerFunc, method, path, body string, params gin.Params) alertHistoryResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(method, path, strings.NewReader(body))
	context.Params = params
	context.Set("role", common.RoleRootUser)
	handler(context)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	var response alertHistoryResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response), recorder.Body.String())
	return response
}

func TestAlertHistoryThroughTheOptionAPI(t *testing.T) {
	setupAlertHistoryTestDB(t)
	saveAlerts := func(alerts string) alertHistoryResponse {
		body, err := common.Marshal(map[string]string{"key": alertsOptionKey, "value": alerts})
		require.NoError(t, err)
		return alertHistoryRequest(t, UpdateOption, http.MethodPut, "/api/option/", string(body), nil)
	}

	require.True(t, saveAlerts(`[{"id":1,"title":"Promo","content":"5% off top-ups","level":"success","dismissible":true,"enabled":true}]`).Success)
	past := alertHistoryRequest(t, GetAlertHistory, http.MethodGet, "/api/alerts/history", "", nil)
	require.True(t, past.Success)
	assert.Empty(t, past.Data, "a live alert is not listed as past")

	require.True(t, saveAlerts(`[]`).Success)
	past = alertHistoryRequest(t, GetAlertHistory, http.MethodGet, "/api/alerts/history", "", nil)
	require.Len(t, past.Data, 1, "a deleted alert stays readable")
	assert.Equal(t, "5% off top-ups", past.Data[0].Content)
	var stored model.Option
	require.NoError(t, model.DB.First(&stored, "key = ?", alertHistoryOptionKey).Error)
	assert.Contains(t, stored.Value, "5% off top-ups")

	direct := alertHistoryRequest(t, UpdateOption, http.MethodPut, "/api/option/", `{"key":"console_setting.alert_history","value":"[]"}`, nil)
	assert.False(t, direct.Success, "the history cannot be overwritten through the option API")

	removed := alertHistoryRequest(t, DeleteAlertHistoryEntry, http.MethodDelete, "/api/option/alert_history/1", "", gin.Params{{Key: "id", Value: "1"}})
	require.True(t, removed.Success, removed.Message)
	past = alertHistoryRequest(t, GetAlertHistory, http.MethodGet, "/api/alerts/history", "", nil)
	assert.Empty(t, past.Data, "a removed entry is gone for every user")
}
