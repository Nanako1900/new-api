package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestLogCreatedHookReceivesTheStoredRow(t *testing.T) {
	require.NoError(t, LOG_DB.AutoMigrate(&Log{}))
	t.Cleanup(func() {
		SetLogCreatedHook(nil)
		LOG_DB.Exec("DELETE FROM logs")
	})
	var observed []Log
	SetLogCreatedHook(func(log Log) { observed = append(observed, log) })

	stored := &Log{UserId: 9101, CreatedAt: 1000, Type: LogTypeConsume, ModelName: "gpt-test", Quota: 7}
	require.NoError(t, createLog(stored))

	require.Len(t, observed, 1)
	assert.Equal(t, stored.Id, observed[0].Id, "the hook sees the id the log database assigned")
	assert.Positive(t, observed[0].Id)
	assert.Equal(t, 9101, observed[0].UserId)
	assert.NotEmpty(t, observed[0].RequestId)

	SetLogCreatedHook(nil)
	require.NoError(t, createLog(&Log{UserId: 9101, CreatedAt: 1001, Type: LogTypeConsume}))
	assert.Len(t, observed, 1, "a removed hook is not called")
}

func TestGetUserLogsSinceReturnsTheNewestWindowOldestFirst(t *testing.T) {
	require.NoError(t, LOG_DB.AutoMigrate(&Log{}))
	t.Cleanup(func() { LOG_DB.Exec("DELETE FROM logs") })
	assertUserLogsSinceWindow(t)
}

func TestGetUserLogsSinceOnConfiguredDatabases(t *testing.T) {
	runOnConfiguredMigrationDatabases(t, func(t *testing.T, db *gorm.DB, _ *migrationSQLRecorder, _ string) {
		previous := LOG_DB
		LOG_DB = db
		t.Cleanup(func() {
			LOG_DB = previous
			_ = db.Migrator().DropTable(&Log{})
		})
		require.NoError(t, db.AutoMigrate(&Log{}))
		assertUserLogsSinceWindow(t)
	})
}

func assertUserLogsSinceWindow(t *testing.T) {
	t.Helper()
	for _, createdAt := range []int64{100, 101, 102, 103, 104, 105} {
		require.NoError(t, createLog(&Log{UserId: 9201, CreatedAt: createdAt, Type: LogTypeConsume}))
	}
	require.NoError(t, createLog(&Log{UserId: 9202, CreatedAt: 104, Type: LogTypeConsume}))

	logs, err := GetUserLogsSince(9201, 102, 3)

	require.NoError(t, err)
	createdAts := make([]int64, 0, len(logs))
	for _, log := range logs {
		assert.Equal(t, 9201, log.UserId)
		createdAts = append(createdAts, log.CreatedAt)
	}
	assert.Equal(t, []int64{103, 104, 105}, createdAts, "a truncated window keeps the newest rows, oldest first")

	all, err := GetUserLogsSince(9201, 102, 10)
	require.NoError(t, err)
	assert.Len(t, all, 4, "since is inclusive")
	none, err := GetUserLogsSince(9201, 0, 10)
	require.NoError(t, err)
	assert.Empty(t, none)
}

func TestFormatUserLogViewKeepsOnlyTheOwnersFields(t *testing.T) {
	stored := Log{Id: 42, UserId: 7, ChannelName: "upstream-a", Other: common.MapToJsonStr(map[string]any{
		"model_price": 0.5,
		"admin_info":  map[string]any{"use_channel": []any{"3"}},
	})}

	view := FormatUserLogView(stored)

	assert.Empty(t, view.ChannelName)
	assert.Equal(t, 42, view.Id)
	parsed, err := common.StrToMap(view.Other)
	require.NoError(t, err)
	assert.NotContains(t, parsed, "admin_info")
	assert.Contains(t, parsed, "model_price")
	assert.Equal(t, "upstream-a", stored.ChannelName, "the stored row is not modified")
}
