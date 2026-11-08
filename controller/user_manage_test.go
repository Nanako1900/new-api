package controller

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/alicebob/miniredis/v2"
	"github.com/glebarez/sqlite"
	"github.com/go-redis/redis/v8"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupManageUserTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	require.NoError(t, i18n.Init())
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousRedisEnabled, previousSecret := common.RedisEnabled, common.SessionSecret
	previousMainDatabaseType, previousLogDatabaseType := common.MainDatabaseType(), common.LogDatabaseType()
	dialect := os.Getenv("TEST_MANAGE_USER_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	databaseTypes := map[string]common.DatabaseType{
		"sqlite": common.DatabaseTypeSQLite, "mysql": common.DatabaseTypeMySQL, "postgres": common.DatabaseTypePostgreSQL,
	}
	require.Contains(t, databaseTypes, dialect)
	dsn := os.Getenv("TEST_" + strings.ToUpper(dialect) + "_DSN")
	db, _ := newAuditTestDatabase(t, dialect, dsn)
	logDB := db
	if os.Getenv("TEST_MANAGE_USER_SEPARATE_LOG_DB") == "1" {
		logDB, _ = newAuditTestDatabase(t, dialect, dsn)
	}
	model.DB, model.LOG_DB = db, logDB
	common.RedisEnabled = false
	common.SessionSecret = "manage-user-test-secret"
	common.SetDatabaseTypes(databaseTypes[dialect], databaseTypes[dialect])

	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.RedisEnabled, common.SessionSecret = previousRedisEnabled, previousSecret
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
		if logDB != db {
			sqlLogDB, err := logDB.DB()
			if err == nil {
				_ = sqlLogDB.Close()
			}
		}
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.CasbinRule{}, &model.AuthzRole{}, &model.AuthFlow{}, &model.TwoFA{}, &model.PasskeyCredential{}, &model.UserAccessToken{}))
	require.NoError(t, logDB.AutoMigrate(&model.Log{}, &model.AuditLog{}))
	versionQuery := "SELECT version()"
	if dialect == "sqlite" {
		versionQuery = "SELECT sqlite_version()"
	}
	var version string
	require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
	t.Logf("database: %s %s, separate log database: %v", dialect, version, logDB != db)
	return db
}

func performManageUserRequest(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	return performVerifiedManageUserRequest(t, body, service.AuthIdentity{UserID: 9999}, "")
}

// performVerifiedManageUserRequest drives ManageUser as the root operator from
// a dashboard login session, carrying the step-up proof status or role changes need.
func performVerifiedManageUserRequest(t *testing.T, body string, identity service.AuthIdentity, proof string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/user/manage", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if proof != "" {
		c.Request.Header.Set("X-Security-Proof", proof)
	}
	c.Set("id", identity.UserID)
	c.Set("role", common.RoleRootUser)
	c.Set("username", "root-operator")
	c.Set("session_id", identity.SessionID)
	c.Set("auth_version", identity.UserAuthVersion)
	c.Set("session_version", identity.SessionVersion)
	c.Set(common.RequestIdKey, "quota-test-request")
	ManageUser(c)
	return recorder
}

// manageUserProof signs the root operator in and issues a password-method proof
// bound to one ManageUser operation.
func manageUserProof(t *testing.T, db *gorm.DB, operation service.VerificationOperation) (service.AuthIdentity, string) {
	t.Helper()
	operator := createQuotaTestOperator(t, db, common.RoleRootUser)
	require.NoError(t, model.PublishUserAuthCache(operator.Id))
	bundle, err := service.CreateLoginSession(operator.Id, "password", "127.0.0.1", "manage-user-test")
	require.NoError(t, err)
	identity, err := service.ParseAccessToken(bundle.AccessToken)
	require.NoError(t, err)
	binding, err := service.BindVerificationOperation(operation)
	require.NoError(t, err)
	proof, _, err := service.IssueSecurityProof(identity, service.VerificationMethodPassword, binding)
	require.NoError(t, err)
	return identity, proof
}

func TestManageUserDisableAdvancesAuthVersionOnceAndRevokesSession(t *testing.T) {
	db := setupManageUserTestDB(t)
	now := time.Now().Unix()
	user := model.User{
		Username: "managed-disable-user", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Create(&model.UserSession{
		SID: "managed-disable-session", UserID: user.Id, Version: 1, UserAuthVersion: 1,
		Status: model.UserSessionStatusActive, RefreshHash: "refresh-hash", LoginMethod: "password",
		LastActiveAt: now, ExpiresAt: now + 3600,
	}).Error)

	identity, proof := manageUserProof(t, db, service.VerificationOperation{Scope: service.VerificationScopeAdminUserManage, Context: []byte(fmt.Sprintf(`{"user_id":%d,"action":"disable"}`, user.Id))})
	recorder := performVerifiedManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"disable"}`, user.Id), identity, proof)
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.UserStatusDisabled, updated.Status)
	assert.EqualValues(t, 2, updated.AuthVersion)
	var session model.UserSession
	require.NoError(t, db.First(&session, "sid = ?", "managed-disable-session").Error)
	assert.Equal(t, model.UserSessionStatusRevoked, session.Status)
}

func TestManageUserDemoteAdvancesAuthVersionAndRevokesSessionsOnce(t *testing.T) {
	db := setupManageUserTestDB(t)
	previousMaster := common.IsMasterNode
	common.IsMasterNode = false
	t.Cleanup(func() { common.IsMasterNode = previousMaster })
	require.NoError(t, authz.Init(db))

	now := time.Now().Unix()
	user := model.User{
		Username: "managed-demote-user", Password: "password", Role: common.RoleAdminUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
	}
	require.NoError(t, db.Create(&user).Error)
	for _, sid := range []string{"managed-demote-session-one", "managed-demote-session-two"} {
		require.NoError(t, db.Create(&model.UserSession{
			SID: sid, UserID: user.Id, Version: 1, UserAuthVersion: 1,
			Status: model.UserSessionStatusActive, RefreshHash: "refresh-" + sid, LoginMethod: "password",
			LastActiveAt: now, ExpiresAt: now + 3600,
		}).Error)
	}

	sessionUpdateCount := 0
	require.NoError(t, db.Callback().Update().Before("gorm:update").Register("test:count_demote_session_updates", func(tx *gorm.DB) {
		if tx.Statement != nil && tx.Statement.Table == "user_sessions" {
			sessionUpdateCount++
		}
	}))

	identity, proof := manageUserProof(t, db, service.VerificationOperation{Scope: service.VerificationScopeAdminUserManage, Context: []byte(fmt.Sprintf(`{"user_id":%d,"action":"demote"}`, user.Id))})
	recorder := performVerifiedManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"demote"}`, user.Id), identity, proof)
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, common.RoleCommonUser, updated.Role)
	assert.EqualValues(t, 2, updated.AuthVersion)
	var sessions []model.UserSession
	require.NoError(t, db.Where("user_id = ?", user.Id).Order("sid asc").Find(&sessions).Error)
	require.Len(t, sessions, 2)
	for _, session := range sessions {
		assert.Equal(t, model.UserSessionStatusRevoked, session.Status)
		assert.Equal(t, "admin_demote", session.RevokedReason)
	}
	assert.Equal(t, 1, sessionUpdateCount)
}

func TestManageUserDeleteReturnsImmediatelyAndUnknownActionFails(t *testing.T) {
	db := setupManageUserTestDB(t)
	deleted := model.User{
		Username: "managed-delete-user", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "delete-aff",
	}
	require.NoError(t, db.Create(&deleted).Error)

	identity, proof := manageUserProof(t, db, service.VerificationOperation{Scope: service.VerificationScopeAdminUserDelete, Context: []byte(fmt.Sprintf(`{"user_id":%d}`, deleted.Id))})
	recorder := performVerifiedManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"delete"}`, deleted.Id), identity, proof)
	assert.Contains(t, recorder.Body.String(), `"success":true`)
	var deletedCount int64
	require.NoError(t, db.Unscoped().Model(&model.User{}).Where("id = ? AND deleted_at IS NOT NULL", deleted.Id).Count(&deletedCount).Error)
	assert.EqualValues(t, 1, deletedCount)

	unchanged := model.User{
		Username: "managed-unknown-user", Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "unknown-aff",
	}
	require.NoError(t, db.Create(&unchanged).Error)
	recorder = performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"unknown"}`, unchanged.Id))
	assert.Contains(t, recorder.Body.String(), `"success":false`)
	require.NoError(t, db.First(&unchanged, unchanged.Id).Error)
	assert.EqualValues(t, 1, unchanged.AuthVersion)
	assert.Equal(t, common.UserStatusEnabled, unchanged.Status)
}

func createQuotaTestOperator(t *testing.T, db *gorm.DB, role int) model.User {
	t.Helper()
	if role == 0 {
		role = common.RoleRootUser
	}
	operator := model.User{Id: 9999, Username: "root-operator", Password: "root-operator-hash", Role: role, Status: common.UserStatusEnabled, AuthVersion: 1, AffCode: "root-operator-aff"}
	require.NoError(t, db.Create(&operator).Error)
	return operator
}

func TestManageUserQuotaRecordsTopupAndAudit(t *testing.T) {
	for _, tc := range []struct {
		name, mode, action, content string
		value, wantQuota            int
	}{
		{"add", "add", "user.quota_add", "Increased user quota by 500", 500, 1500},
		{"subtract", "subtract", "user.quota_subtract", "Decreased user quota by 500", 500, 500},
		{"override_up", "override", "user.quota_override", "Overrode user quota from 1000 to 1500", 1500, 1500},
		{"override_down", "override", "user.quota_override", "Overrode user quota from 1000 to 500", 500, 500},
		{"override_unchanged", "override", "user.quota_override", "Overrode user quota from 1000 to 1000", 1000, 1000},
		{"override_zero", "override", "user.quota_override", "Overrode user quota from 1000 to 0", 0, 0},
		{"override_negative", "override", "user.quota_override", "Overrode user quota from 1000 to -1", -1, -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			user := model.User{Username: "quota-owner", Role: common.RoleCommonUser, Quota: 1000, AffCode: "quota-owner-aff"}
			require.NoError(t, db.Create(&user).Error)
			createQuotaTestOperator(t, db, common.RoleRootUser)

			recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":%q,"value":%d}`, user.Id, tc.mode, tc.value))
			assert.Equal(t, http.StatusOK, recorder.Code)
			require.Contains(t, recorder.Body.String(), `"success":true`)
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, tc.wantQuota, user.Quota)

			logs, total, err := model.GetAllLogs(model.LogFilter{Type: model.LogTypeTopup}, 0, 20)
			require.NoError(t, err)
			assert.EqualValues(t, 1, total)
			require.Len(t, logs, 1)
			assert.Equal(t, user.Id, logs[0].UserId)
			assert.Equal(t, user.Username, logs[0].Username)
			assert.Equal(t, tc.content, logs[0].Content)
			model.FormatAdminLogs(logs)
			var other model.AuditOther
			require.NoError(t, common.UnmarshalJsonStr(logs[0].Other, &other))
			assert.Equal(t, &model.AuditAdminInfo{AdminID: 9999, AdminUsername: "root-operator", AdminRole: common.RoleRootUser, AuthMethod: "session"}, other.AdminInfo)

			logs, total, err = model.GetUserLogs(user.Id, model.LogFilter{Type: model.LogTypeTopup}, 0, 20)
			require.NoError(t, err)
			assert.EqualValues(t, 1, total)
			require.Len(t, logs, 1)
			other = model.AuditOther{}
			require.NoError(t, common.UnmarshalJsonStr(logs[0].Other, &other))
			assert.Nil(t, other.AdminInfo)
			require.NotNil(t, other.Op)
			assert.Equal(t, tc.action, other.Op.Action)
			params, err := common.Marshal(other.Op.Params)
			require.NoError(t, err)
			expectedParams := model.AuditFields{"target_user_id": user.Id, "target_username": user.Username, "mode": tc.mode, "requested_quota": tc.value, "from": 1000, "to": tc.wantQuota}
			if tc.mode != "override" {
				expectedParams["quota"] = tc.value
			}
			expected, err := common.Marshal(expectedParams)
			require.NoError(t, err)
			assert.JSONEq(t, string(expected), string(params))
			assert.Equal(t, "quota-test-request", logs[0].RequestId)
			assert.Empty(t, logs[0].Ip, "recipient logs must not disclose the administrator IP")

			logs, total, err = model.GetUserLogs(9999, model.LogFilter{Type: model.LogTypeTopup}, 0, 20)
			require.NoError(t, err)
			assert.Zero(t, total)
			assert.Empty(t, logs)
			var audits []model.AuditLog
			require.NoError(t, model.LOG_DB.Find(&audits).Error)
			require.Len(t, audits, 1)
			assert.Equal(t, 9999, audits[0].UserId)
			assert.Equal(t, "root-operator", audits[0].Username)
			assert.Equal(t, tc.action, audits[0].Action)
			assert.True(t, audits[0].Success)
			params, err = common.Marshal(audits[0].Other.Op.Params)
			require.NoError(t, err)
			assert.JSONEq(t, string(expected), string(params))
			assert.Equal(t, "quota-test-request", audits[0].RequestId)
		})
	}
}

func TestManageUserQuotaFailuresDoNotRecordTopup(t *testing.T) {
	for _, tc := range []struct {
		name, mode string
		value      int
		failUpdate bool
	}{
		{"zero_add", "add", 0, false},
		{"negative_subtract", "subtract", -1, false},
		{"invalid_mode", "invalid", 500, false},
		{"add_update_error", "add", 500, true},
		{"subtract_update_error", "subtract", 500, true},
		{"override_update_error", "override", 500, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			createQuotaTestOperator(t, db, common.RoleRootUser)
			user := model.User{Username: "quota-owner", Role: common.RoleCommonUser, Quota: 1000}
			require.NoError(t, db.Create(&user).Error)
			if tc.failUpdate {
				require.NoError(t, db.Callback().Update().Before("gorm:update").Register("test:fail_quota_update", func(tx *gorm.DB) {
					if tx.Statement.Table == "users" {
						tx.AddError(errors.New("quota update unavailable"))
					}
				}))
			}
			recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":%q,"value":%d}`, user.Id, tc.mode, tc.value))
			assert.Contains(t, recorder.Body.String(), `"success":false`)
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, 1000, user.Quota)
			var logCount, auditCount int64
			require.NoError(t, model.LOG_DB.Model(&model.Log{}).Count(&logCount).Error)
			require.NoError(t, model.LOG_DB.Model(&model.AuditLog{}).Count(&auditCount).Error)
			assert.Zero(t, logCount)
			assert.EqualValues(t, 1, auditCount)
			var audit model.AuditLog
			require.NoError(t, model.LOG_DB.First(&audit).Error)
			assert.False(t, audit.Success)
			params, err := common.Marshal(audit.Other.Op.Params)
			require.NoError(t, err)
			assert.NotContains(t, string(params), `"from"`)
			assert.NotContains(t, string(params), `"to"`)
			assert.NotContains(t, string(params), `"target_username"`)
			assert.NotContains(t, string(params), "quota update unavailable")
			reason := "invalid_parameters"
			if tc.failUpdate {
				reason = "database_error"
			}
			assert.Contains(t, string(params), `"failure_reason":"`+reason+`"`)
			assert.Contains(t, string(params), fmt.Sprintf(`"requested_quota":%d`, tc.value))
		})
	}
}

func TestManageUserQuotaLogFailureKeepsSuccessfulAdjustment(t *testing.T) {
	for _, failedTable := range []string{"logs", "audit_logs"} {
		t.Run(failedTable, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			createQuotaTestOperator(t, db, common.RoleRootUser)
			user := model.User{Username: "quota-owner", Role: common.RoleCommonUser, Quota: 1000}
			require.NoError(t, db.Create(&user).Error)
			require.NoError(t, model.LOG_DB.Callback().Create().Before("gorm:create").Register("test:fail_quota_log", func(tx *gorm.DB) {
				if tx.Statement.Table == failedTable {
					tx.AddError(errors.New("quota log unavailable"))
				}
			}))
			recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":"add","value":500}`, user.Id))
			assert.Contains(t, recorder.Body.String(), `"success":true`)
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, 1500, user.Quota)
			var logCount, auditCount int64
			require.NoError(t, model.LOG_DB.Model(&model.Log{}).Count(&logCount).Error)
			require.NoError(t, model.LOG_DB.Model(&model.AuditLog{}).Count(&auditCount).Error)
			if failedTable == "logs" {
				assert.Zero(t, logCount)
				assert.EqualValues(t, 1, auditCount)
			} else {
				assert.EqualValues(t, 1, logCount)
				assert.Zero(t, auditCount)
			}
		})
	}
}

func TestManageUserQuotaTargetsAndWalletBounds(t *testing.T) {
	for _, tc := range []struct {
		name, mode, reason                                string
		before, value, targetID, targetRole, operatorRole int
		deleted, failRead                                 bool
	}{
		{name: "zero_id", mode: "add", value: 1, reason: "invalid_parameters"},
		{name: "negative_id", mode: "subtract", value: 1, targetID: -1, reason: "invalid_parameters"},
		{name: "missing", mode: "override", value: 1, targetID: 12345, reason: "target_not_found"},
		{name: "deleted", mode: "add", value: 1, targetID: 1, deleted: true, reason: "target_not_found"},
		{name: "peer_admin", mode: "add", value: 1, targetID: 1, targetRole: common.RoleAdminUser, operatorRole: common.RoleAdminUser, reason: "permission_denied"},
		{name: "higher_role", mode: "override", value: 1, targetID: 1, targetRole: common.RoleRootUser, operatorRole: common.RoleAdminUser, reason: "permission_denied"},
		{name: "read_error", mode: "add", value: 1, targetID: 1, failRead: true, reason: "database_error"},
		{name: "add_overflow", mode: "add", before: common.MaxWalletQuota, value: 1, targetID: 1, reason: "quota_limit_exceeded"},
		{name: "subtract_underflow", mode: "subtract", before: -common.MaxWalletQuota, value: 1, targetID: 1, reason: "quota_limit_exceeded"},
		{name: "oversized_add", mode: "add", value: common.MaxWalletQuota + 1, targetID: 1, reason: "quota_limit_exceeded"},
		{name: "oversized_subtract", mode: "subtract", value: common.MaxWalletQuota + 1, targetID: 1, reason: "quota_limit_exceeded"},
		{name: "oversized_override", mode: "override", value: -common.MaxWalletQuota - 1, targetID: 1, reason: "quota_limit_exceeded"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			createQuotaTestOperator(t, db, tc.operatorRole)
			user := model.User{Id: 1, Username: "private-target-name", Role: tc.targetRole, Quota: tc.before}
			require.NoError(t, db.Create(&user).Error)
			if tc.deleted {
				require.NoError(t, db.Delete(&user).Error)
			}
			if tc.failRead {
				require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:quota_read_error", func(tx *gorm.DB) {
					if tx.Statement.Table == "users" && len(tx.Statement.Selects) == 0 {
						tx.AddError(errors.New("private database error"))
					}
				}))
			}
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/api/user/manage", strings.NewReader(fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":%q,"value":%d}`, tc.targetID, tc.mode, tc.value)))
			role := tc.operatorRole
			if role == 0 {
				role = common.RoleRootUser
			}
			c.Set("id", 9999)
			c.Set("role", role)
			ManageUser(c)
			require.Contains(t, recorder.Body.String(), `"success":false`)
			if tc.failRead {
				require.NoError(t, db.Callback().Query().Remove("test:quota_read_error"))
			}
			require.NoError(t, db.Unscoped().First(&user, user.Id).Error)
			assert.Equal(t, tc.before, user.Quota)
			var audits []model.AuditLog
			require.NoError(t, model.LOG_DB.Find(&audits).Error)
			require.Len(t, audits, 1)
			assert.False(t, audits[0].Success)
			params, err := common.Marshal(audits[0].Other.Op.Params)
			require.NoError(t, err)
			expected, err := common.Marshal(model.AuditFields{"target_user_id": tc.targetID, "mode": tc.mode, "requested_quota": tc.value, "failure_reason": tc.reason})
			require.NoError(t, err)
			assert.JSONEq(t, string(expected), string(params))
			assert.NotContains(t, audits[0].Content, user.Username)
			var count int64
			require.NoError(t, model.LOG_DB.Model(&model.Log{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestManageUserQuotaMiddlewareKeepsOneOperationPerRequest(t *testing.T) {
	db := setupManageUserTestDB(t)
	pat := "quota-middleware-test-token"
	operator := model.User{Id: 9999, Username: "root-operator", Role: common.RoleRootUser, Status: common.UserStatusEnabled, AuthVersion: 1, AccessToken: &pat, Quota: 1000}
	require.NoError(t, db.Create(&operator).Error)
	router := gin.New()
	router.Use(middleware.RequestId(), middleware.AccessTokenAudit())
	router.POST("/api/user/manage", middleware.AdminAuth(), ManageUser)
	for _, tc := range []struct {
		body, action string
		success      bool
	}{
		{`{"id":9999,"action":"add_quota","mode":"add","value":100}`, "user.quota_add", true},
		{`{"id":9999,"action":"add_quota","mode":"subtract","value":0}`, "user.quota_subtract", false},
		{`{"id":9999,"action":"add_quota","mode":"invalid","value":1}`, "generic", false},
		{`{"id":`, "generic", false},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/user/manage", strings.NewReader(tc.body))
		request.Header.Set("Authorization", "Bearer "+pat)
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)
		assert.Equal(t, http.StatusOK, recorder.Code)
		assert.Contains(t, recorder.Body.String(), fmt.Sprintf(`"success":%t`, tc.success))
		requestID := recorder.Header().Get(common.RequestIdKey)
		require.NotEmpty(t, requestID)
		var audits []model.AuditLog
		require.NoError(t, model.LOG_DB.Where("request_id = ?", requestID).Find(&audits).Error)
		require.Len(t, audits, 2, "one operation audit and one PAT request audit")
		for _, audit := range audits {
			assert.Equal(t, tc.success, audit.Success)
			if audit.Category != model.AuditCategoryOperation {
				continue
			}
			assert.Equal(t, tc.action, audit.Action)
			assert.Equal(t, operator.Id, audit.UserId)
			assert.Equal(t, "/api/user/manage", audit.Route)
			if tc.success {
				params, err := common.Marshal(audit.Other.Op.Params)
				require.NoError(t, err)
				assert.Contains(t, string(params), `"target_user_id":9999`)
				assert.Contains(t, string(params), `"target_username":"root-operator"`)
			}
		}
		var count int64
		require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("request_id = ?", requestID).Count(&count).Error)
		if tc.success {
			assert.EqualValues(t, 1, count)
		} else {
			assert.Zero(t, count)
		}
	}
	require.NoError(t, db.First(&operator, operator.Id).Error)
	assert.Equal(t, 1100, operator.Quota)
}

func TestManageUserQuotaConcurrentSnapshots(t *testing.T) {
	db := setupManageUserTestDB(t)
	user := model.User{Username: "concurrent-quota", Quota: 1000}
	require.NoError(t, db.Create(&user).Error)
	var ready sync.WaitGroup
	ready.Add(2)
	release := make(chan struct{})
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:concurrent_quota_start", func(tx *gorm.DB) {
		if tx.Statement.Table == "users" {
			ready.Done()
			<-release
		}
	}))
	type result struct {
		adjustment *model.UserQuotaAdjustment
		err        error
		value      int
	}
	results := make(chan result, 2)
	for _, value := range []int{10, 20} {
		go func(value int) {
			adjustment, err := model.AdjustUserQuota(user.Id, common.RoleRootUser, "add", value)
			results <- result{adjustment, err, value}
		}(value)
	}
	ready.Wait()
	close(release)
	var committed []model.UserQuotaAdjustment
	for range 2 {
		result := <-results
		if result.err != nil {
			require.True(t, common.UsingMainDatabase(common.DatabaseTypeSQLite), "row-locking databases must serialize both adjustments: %v", result.err)
			assert.Contains(t, strings.ToLower(result.err.Error()), "locked")
			assert.Nil(t, result.adjustment)
			continue
		}
		require.NotNil(t, result.adjustment)
		assert.Equal(t, result.value, result.adjustment.After-result.adjustment.Before)
		committed = append(committed, *result.adjustment)
	}
	require.NoError(t, db.Callback().Query().Remove("test:concurrent_quota_start"))
	require.NotEmpty(t, committed)
	sort.Slice(committed, func(i, j int) bool { return committed[i].Before < committed[j].Before })
	balance := 1000
	for _, adjustment := range committed {
		assert.Equal(t, balance, adjustment.Before)
		balance = adjustment.After
	}
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, balance, user.Quota)
}

func TestManageUserQuotaCacheUsesCommittedIntegerDifference(t *testing.T) {
	for _, tc := range []struct {
		name, mode                               string
		before, cached, value, after, wantCached int
		failUpdate, failCache, missingCache      bool
	}{
		{name: "add_preserves_reservations", mode: "add", before: 1000, cached: 900, value: 500, after: 1500, wantCached: 1400},
		{name: "subtract_preserves_reservations", mode: "subtract", before: 1000, cached: 900, value: 500, after: 500, wantCached: 400},
		{name: "override_preserves_reservations", mode: "override", before: 1000, cached: 900, value: 2000, after: 2000, wantCached: 1900},
		{name: "large_odd_difference", mode: "override", before: common.MaxWalletQuota - 1, cached: common.MaxWalletQuota - 1, value: -common.MaxWalletQuota, after: -common.MaxWalletQuota, wantCached: -common.MaxWalletQuota},
		{name: "rollback_does_not_change_cache", mode: "subtract", before: 1000, cached: 900, value: 500, after: 1000, wantCached: 900, failUpdate: true},
		{name: "cache_error_keeps_committed_change", mode: "add", before: 1000, value: 500, after: 1500, failCache: true},
		{name: "missing_cache_is_not_partially_created", mode: "add", before: 1000, value: 500, after: 1500, missingCache: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			operator := createQuotaTestOperator(t, db, common.RoleRootUser)
			server := miniredis.RunT(t)
			oldRDB := common.RDB
			common.RDB = redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
			common.RedisEnabled = true
			t.Cleanup(func() { _ = common.RDB.Close(); common.RDB = oldRDB })
			user := model.User{Username: "cached-quota", Quota: tc.before, AuthVersion: 1}
			require.NoError(t, db.Create(&user).Error)
			cache, err := model.GetUserCache(user.Id)
			require.NoError(t, err)
			assert.Equal(t, tc.before, cache.Quota)
			_, err = model.GetUserCache(operator.Id)
			require.NoError(t, err)
			keys := server.Keys()
			var quotaKey string
			for _, key := range keys {
				if server.HGet(key, "Id") == strconv.Itoa(user.Id) && server.HGet(key, "Quota") != "" {
					quotaKey = key
					break
				}
			}
			require.NotEmpty(t, quotaKey)
			server.HSet(quotaKey, "Quota", strconv.Itoa(tc.cached))
			if tc.missingCache {
				server.Del(quotaKey)
			}
			if tc.failCache {
				server.SetError("ERR quota cache unavailable")
			}
			if tc.failUpdate {
				require.NoError(t, db.Callback().Update().After("gorm:update").Register("test:cache_quota_rollback", func(tx *gorm.DB) {
					if tx.Statement.Table == "users" {
						tx.AddError(errors.New("quota rollback"))
					}
				}))
			}
			recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":%q,"value":%d}`, user.Id, tc.mode, tc.value))
			assert.Contains(t, recorder.Body.String(), fmt.Sprintf(`"success":%t`, !tc.failUpdate))
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, tc.after, user.Quota)
			if tc.missingCache {
				// Log username lookup may hydrate the whole user after commit.
				if server.Exists(quotaKey) {
					assert.Equal(t, strconv.Itoa(user.Id), server.HGet(quotaKey, "Id"))
					assert.NotEmpty(t, server.HGet(quotaKey, "CacheSchema"))
					assert.Equal(t, strconv.Itoa(tc.after), server.HGet(quotaKey, "Quota"))
				}
			} else if !tc.failCache {
				assert.Equal(t, strconv.Itoa(tc.wantCached), server.HGet(quotaKey, "Quota"))
			}
		})
	}
}

// Saving notification settings starts from what the user stored: fields the
// form does not manage stay, and switches an older client leaves out keep
// their stored values. Only administrators change the channel and upstream
// switches, and a threshold of 0 means the site default.
func TestUpdateUserSettingKeepsWhatTheRequestLeavesOut(t *testing.T) {
	on, off := true, false
	stored := dto.UserSetting{
		NotifyType:                       dto.NotifyTypeBark,
		BarkUrl:                          "https://api.day.app/key/{{title}}/{{content}}",
		QuotaWarningThreshold:            500000,
		QuotaWarningEnabled:              &off,
		ChannelNotifyEnabled:             &on,
		UpstreamModelUpdateNotifyEnabled: true,
		Language:                         "zhCN",
		SidebarModules:                   `{"chat":{"enabled":true}}`,
		BillingPreference:                "wallet_only",
	}
	kept := func(setting dto.UserSetting) dto.UserSetting {
		setting.Language, setting.SidebarModules, setting.BillingPreference = stored.Language, stored.SidebarModules, stored.BillingPreference
		return setting
	}
	switchesChanged := `{"notify_type":"email","quota_warning_threshold":0,"quota_warning_enabled":true,"channel_notify_enabled":false,"upstream_model_update_notify_enabled":false}`
	for _, tc := range []struct {
		name        string
		role        int
		body        string
		wantSuccess bool
		want        dto.UserSetting
	}{
		{
			name:        "older client without the new switches",
			role:        common.RoleAdminUser,
			body:        `{"notify_type":"webhook","quota_warning_threshold":2000,"webhook_url":"https://example.com/hook","webhook_secret":"hook-secret","accept_unset_model_ratio_model":true,"record_ip_log":true}`,
			wantSuccess: true,
			want: kept(dto.UserSetting{
				NotifyType: dto.NotifyTypeWebhook, WebhookUrl: "https://example.com/hook", WebhookSecret: "hook-secret",
				QuotaWarningThreshold: 2000, QuotaWarningEnabled: &off, ChannelNotifyEnabled: &on, UpstreamModelUpdateNotifyEnabled: true,
				AcceptUnsetRatioModel: true, RecordIpLog: true,
			}),
		},
		{
			name:        "administrator changes the switches and uses the site default threshold",
			role:        common.RoleAdminUser,
			body:        switchesChanged,
			wantSuccess: true,
			want:        kept(dto.UserSetting{NotifyType: dto.NotifyTypeEmail, QuotaWarningEnabled: &on, ChannelNotifyEnabled: &off}),
		},
		{
			name:        "user cannot change the administrator switches",
			role:        common.RoleCommonUser,
			body:        switchesChanged,
			wantSuccess: true,
			want:        kept(dto.UserSetting{NotifyType: dto.NotifyTypeEmail, QuotaWarningEnabled: &on, ChannelNotifyEnabled: &on, UpstreamModelUpdateNotifyEnabled: true}),
		},
		{
			name: "negative threshold",
			role: common.RoleCommonUser,
			body: `{"notify_type":"email","quota_warning_threshold":-1}`,
			want: stored,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			setting, err := common.Marshal(stored)
			require.NoError(t, err)
			user := model.User{Username: "setting-owner", Role: tc.role, Status: common.UserStatusEnabled, AffCode: "setting-owner-aff", Setting: string(setting)}
			require.NoError(t, db.Create(&user).Error)

			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPut, "/api/user/setting", strings.NewReader(tc.body))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Set("id", user.Id)
			UpdateUserSetting(c)

			assert.Contains(t, recorder.Body.String(), fmt.Sprintf(`"success":%t`, tc.wantSuccess))
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, tc.want, user.GetSetting())
		})
	}
}

func createAvatarTestUser(t *testing.T, db *gorm.DB, name string, role int, setting dto.UserSetting) model.User {
	t.Helper()
	raw, err := common.Marshal(setting)
	require.NoError(t, err)
	user := model.User{Username: name, Role: role, Status: common.UserStatusEnabled, AffCode: name + "-aff", Setting: string(raw)}
	require.NoError(t, db.Create(&user).Error)
	return user
}

func savedAvatar(t *testing.T, db *gorm.DB, user model.User) *dto.UserAvatar {
	t.Helper()
	require.NoError(t, db.First(&user, user.Id).Error)
	return user.GetSetting().Avatar
}

func TestUpdateSelfAvatarValidatesWhatItStores(t *testing.T) {
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 64, 64))))
	pngData := base64.StdEncoding.EncodeToString(buf.Bytes())

	for _, tc := range []struct {
		name     string
		body     string
		wantKind string
	}{
		{name: "built cat", body: `{"kind":"cat","cat":{"coat":"calico","ear":"soft","accessory":"pixel"}}`, wantKind: "cat"},
		{name: "uploaded png", body: `{"kind":"upload","image":"data:image/png;base64,` + pngData + `"}`, wantKind: "upload"},
		{name: "unknown cat part", body: `{"kind":"cat","cat":{"hat":"crown"}}`},
		{name: "cat part id with markup", body: `{"kind":"cat","cat":{"coat":"<svg>"}}`},
		{name: "svg image", body: `{"kind":"upload","image":"data:image/svg+xml;base64,PHN2Zy8+"}`},
		{name: "png bytes labelled as webp", body: `{"kind":"upload","image":"data:image/webp;base64,` + pngData + `"}`},
		{name: "image over the size limit", body: `{"kind":"upload","image":"data:image/png;base64,` + strings.Repeat("A", 40*1024) + `"}`},
		{name: "unknown kind", body: `{"kind":"gif"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			user := createAvatarTestUser(t, db, "avatar-owner", common.RoleCommonUser, dto.UserSetting{Language: "en"})

			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPut, "/api/user/self/avatar", strings.NewReader(tc.body))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Set("id", user.Id)
			UpdateSelfAvatar(c)

			assert.Contains(t, recorder.Body.String(), fmt.Sprintf(`"success":%t`, tc.wantKind != ""))
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, "en", user.GetSetting().Language)
			avatar := user.GetSetting().Avatar
			if tc.wantKind == "" {
				assert.Nil(t, avatar)
				return
			}
			require.NotNil(t, avatar)
			assert.Equal(t, tc.wantKind, avatar.Kind)
		})
	}
}

func TestUpdateUserSettingKeepsTheAvatar(t *testing.T) {
	db := setupManageUserTestDB(t)
	avatar := &dto.UserAvatar{Kind: "cat", Cat: map[string]string{"coat": "calico"}}
	user := createAvatarTestUser(t, db, "avatar-keeper", common.RoleCommonUser, dto.UserSetting{Avatar: avatar})

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/user/setting", strings.NewReader(`{"notify_type":"email","quota_warning_threshold":0}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("id", user.Id)
	UpdateUserSetting(c)

	assert.Contains(t, recorder.Body.String(), `"success":true`)
	assert.Equal(t, avatar, savedAvatar(t, db, user))
}

func TestResetAvatarGoesBackToTheDefault(t *testing.T) {
	avatar := &dto.UserAvatar{Kind: "cat", Cat: map[string]string{"coat": "calico"}}
	for _, tc := range []struct {
		name        string
		callerRole  int
		targetRole  int
		byAdmin     bool
		wantSuccess bool
	}{
		{name: "user resets their own avatar", targetRole: common.RoleCommonUser, wantSuccess: true},
		{name: "administrator resets a user's avatar", callerRole: common.RoleAdminUser, targetRole: common.RoleCommonUser, byAdmin: true, wantSuccess: true},
		{name: "administrator cannot reset another administrator", callerRole: common.RoleAdminUser, targetRole: common.RoleAdminUser, byAdmin: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			target := createAvatarTestUser(t, db, "avatar-target", tc.targetRole, dto.UserSetting{Avatar: avatar})

			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			if tc.byAdmin {
				c.Request = httptest.NewRequest(http.MethodDelete, "/api/user/"+strconv.Itoa(target.Id)+"/avatar", nil)
				c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(target.Id)}}
				c.Set("id", target.Id+1000)
				c.Set("role", tc.callerRole)
				AdminResetUserAvatar(c)
			} else {
				c.Request = httptest.NewRequest(http.MethodDelete, "/api/user/self/avatar", nil)
				c.Set("id", target.Id)
				ResetSelfAvatar(c)
			}

			assert.Contains(t, recorder.Body.String(), fmt.Sprintf(`"success":%t`, tc.wantSuccess))
			if tc.wantSuccess {
				assert.Nil(t, savedAvatar(t, db, target))
				return
			}
			assert.Equal(t, avatar, savedAvatar(t, db, target))
		})
	}
}

// Two setting writers that overlap both keep their change. An administrator
// removes a user's avatar while the user saves the notification form with a
// rotated webhook secret. The removal is held between its read and its write
// until the form has started reading: on MySQL and PostgreSQL until the form
// sends its locking read, on SQLite (where BEGIN IMMEDIATE blocks before any
// query) until the form has read the user. The form must not finish during the
// hold, and neither the old avatar nor the old secret may come back.
func TestOverlappingSettingWritersKeepBothChanges(t *testing.T) {
	db := setupManageUserTestDB(t)
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		// Production SQLite runs WAL with a busy timeout and BEGIN IMMEDIATE
		// (common.SQLitePath), so a second writer waits instead of failing.
		_, params, _ := strings.Cut(common.SQLitePath, "?")
		var err error
		db, err = gorm.Open(sqlite.Open(t.TempDir()+"/setting.db?"+params), &gorm.Config{})
		require.NoError(t, err)
		t.Cleanup(func() {
			if sqlDB, err := db.DB(); err == nil {
				_ = sqlDB.Close()
			}
		})
		require.NoError(t, db.AutoMigrate(&model.User{}))
		model.DB = db
	}
	user := createAvatarTestUser(t, db, "setting-race", common.RoleCommonUser, dto.UserSetting{
		NotifyType: dto.NotifyTypeWebhook, WebhookUrl: "https://example.com/hook", WebhookSecret: "old-secret",
		Avatar: &dto.UserAvatar{Kind: "cat", Cat: map[string]string{"coat": "calico"}},
	})

	var holding, watching atomic.Bool
	var readOnce sync.Once
	held, formRead, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	require.NoError(t, db.Callback().Update().Before("gorm:update").Register("test:hold_first_setting_write", func(tx *gorm.DB) {
		if tx.Statement.Table == "users" && holding.CompareAndSwap(false, true) {
			close(held)
			<-release
		}
	}))
	sqliteDB := common.UsingMainDatabase(common.DatabaseTypeSQLite)
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:form_sends_locking_read", func(tx *gorm.DB) {
		_, locking := tx.Statement.Clauses["FOR"]
		if !sqliteDB && locking && tx.Statement.Table == "users" && watching.Load() {
			readOnce.Do(func() { close(formRead) })
		}
	}))
	require.NoError(t, db.Callback().Query().After("gorm:query").Register("test:form_read_user", func(tx *gorm.DB) {
		if sqliteDB && tx.Statement.Table == "users" && watching.Load() {
			readOnce.Do(func() { close(formRead) })
		}
	}))

	removal := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodDelete, "/api/user/"+strconv.Itoa(user.Id)+"/avatar", nil)
		c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(user.Id)}}
		c.Set("id", user.Id+1000)
		c.Set("role", common.RoleAdminUser)
		AdminResetUserAvatar(c)
		removal <- recorder
	}()
	select {
	case <-held:
	case recorder := <-removal:
		require.FailNow(t, "the avatar removal finished without writing the setting", recorder.Body.String())
	}

	watching.Store(true)
	form := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPut, "/api/user/setting", strings.NewReader(
			`{"notify_type":"webhook","webhook_url":"https://example.com/hook","webhook_secret":"rotated-secret"}`))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Set("id", user.Id)
		UpdateUserSetting(c)
		form <- recorder
	}()
	select {
	case <-formRead:
	case recorder := <-form:
		// Let the removal finish before failing: it must not touch the database
		// after the cleanup swaps it out.
		close(release)
		<-removal
		require.FailNow(t, "the notification form finished while the avatar removal held the user", recorder.Body.String())
	}
	close(release)

	assert.Contains(t, (<-removal).Body.String(), `"success":true`)
	assert.Contains(t, (<-form).Body.String(), `"success":true`)
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Nil(t, user.GetSetting().Avatar, "the removed avatar came back")
	assert.Equal(t, "rotated-secret", user.GetSetting().WebhookSecret, "the rotated secret was lost")
}
