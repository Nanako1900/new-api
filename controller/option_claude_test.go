package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestUpdateOptionRejectsNegativeClaudeDefaultMaxTokens(t *testing.T) {
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/option/",
		strings.NewReader(`{"key":"claude.default_max_tokens","value":"{\"default\":-1}"}`),
	)

	UpdateOption(context)

	assert.Equal(t, http.StatusOK, response.Code)
	var payload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.False(t, payload.Success)
	assert.Contains(t, payload.Message, "-1")
}

func TestUpdateOptionValidatesUserIDStartAndProtectsAllocator(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.SystemTask{}, &model.User{}, &model.Log{}, &model.AuditLog{}))
	previousDB, previousLogDB, previousOptions, previousRedis := model.DB, model.LOG_DB, common.OptionMap, common.RedisEnabled
	model.DB, model.LOG_DB, common.RedisEnabled = db, db, false
	common.OptionMap = map[string]string{}
	t.Cleanup(func() {
		model.DB, model.LOG_DB, common.RedisEnabled = previousDB, previousLogDB, previousRedis
		common.OptionMap = previousOptions
		pool, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, pool.Close())
	})
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "setting-owner", AffCode: "setting-owner", Role: common.RoleRootUser}).Error)
	for _, tc := range []struct {
		key      string
		value    any
		accepted bool
	}{
		{"UserIdStart", "10000", true}, {"UserIdStart", 20000, true}, {"UserIdStart", "0", false}, {"UserIdStart", 1.5, false}, {"UserIdStart", true, false}, {"UserIdStart", nil, false}, {"UserIdStart", "2147483648", false}, {"internal.user_id_cursor", "1", false}, {"internal.user_id_retired.10000", "0", false}, {"UsérIdStart", "1", false},
	} {
		body, err := common.Marshal(OptionUpdateRequest{Key: tc.key, Value: tc.value})
		require.NoError(t, err)
		response := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(response)
		ctx.Set("id", 1)
		ctx.Set("role", common.RoleRootUser)
		ctx.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(string(body)))
		UpdateOption(ctx)
		var result struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		assert.Equal(t, tc.accepted, result.Success, string(body))
	}
	var option model.Option
	require.NoError(t, db.Where(&model.Option{Key: "UserIdStart"}).First(&option).Error)
	assert.Equal(t, "20000", option.Value)
	response := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(response)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/option/", nil)
	GetOptions(ctx)
	assert.NotContains(t, response.Body.String(), "internal.user_id_")
}
