package service

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMonitorUserSpikesFlagsOnlyRecentSpendFarAboveUsual(t *testing.T) {
	// Over 3 hours, 5 minutes are 1/36 of the window.
	rows := []model.GlobalUserSpend{
		{UserId: 1, Username: "steady", RecentQuota: 100_000, WindowQuota: 3_600_000},  // usual 100 000: ratio 1
		{UserId: 2, Username: "surging", RecentQuota: 500_000, WindowQuota: 3_600_000}, // usual 100 000: ratio 5
		{UserId: 3, Username: "newcomer", RecentQuota: 200_000, WindowQuota: 200_000},  // all spend recent: ratio 36
		{UserId: 4, Username: "tiny", RecentQuota: 40_000, WindowQuota: 40_000},        // below the floor
		{UserId: 5, Username: "borderline", RecentQuota: 300_000, WindowQuota: 3_600_000},
	}

	spikes := monitorUserSpikes(rows, 3*time.Hour, 50_000)

	assert.Equal(t, []MonitorUserSpike{
		{UserId: 3, Username: "newcomer", RecentQuota: 200_000, UsualQuota: 5_556, Ratio: 36},
		{UserId: 2, Username: "surging", RecentQuota: 500_000, UsualQuota: 100_000, Ratio: 5},
		{UserId: 5, Username: "borderline", RecentQuota: 300_000, UsualQuota: 100_000, Ratio: 3},
	}, spikes)
	assert.NotNil(t, monitorUserSpikes(nil, time.Hour, 1), "no rows give an empty list, not null")
}

func TestMonitorErrorReasonsGroupsByStatusAndCode(t *testing.T) {
	samples := []model.GlobalErrorSample{
		{Content: "newest refused", Other: `{"status_code":500,"error_code":"do_request_failed","error_type":"new_api_error"}`},
		{Content: "rate limited", Other: `{"status_code":429,"error_code":"rate_limit","error_type":"upstream_error"}`},
		{Content: "older refused", Other: `{"status_code":500,"error_code":"do_request_failed","error_type":"new_api_error"}`},
		{Content: strings.Repeat("长", 200), Other: `not json`},
		{Content: "another 429", Other: `{"status_code":"429","error_code":"rate_limit"}`},
		{Content: "exploded", Other: `{"status_code":500,"error_code":"unknown_error"}`},
	}

	reasons := monitorErrorReasons(samples)

	assert.Len(t, reasons, 4)
	assert.Equal(t, MonitorErrorReason{StatusCode: 500, ErrorCode: "do_request_failed", ErrorType: "new_api_error", Count: 2, Example: "newest refused"},
		reasons[0], "most common first, with the newest row's text")
	assert.Equal(t, 429, reasons[1].StatusCode)
	assert.Equal(t, 2, reasons[1].Count, "a status code stored as a string still counts")
	assert.Equal(t, 0, reasons[2].StatusCode, "unreadable details count as unknown")
	assert.Equal(t, monitorGlobalErrorExampleMax, len([]rune(reasons[2].Example)), "long error text is cut")
	assert.Equal(t, "unknown_error", reasons[3].ErrorCode)

	many := make([]model.GlobalErrorSample, 0, 7)
	for code := range 7 {
		many = append(many, model.GlobalErrorSample{Other: `{"status_code":` + string(rune('0'+code)) + `}`})
	}
	assert.Len(t, monitorErrorReasons(many), monitorGlobalErrorReasonLimit)
}

// The overview's cache use starts at the window's first hour (quota_data is
// hourly) and gives each top user their own sums. When quota_data cannot be
// read the overview still answers, with no cache use.
func TestGetMonitorGlobalOverviewAddsCacheUsage(t *testing.T) {
	truncate(t)
	require.NoError(t, model.LOG_DB.Exec("DELETE FROM logs").Error)
	require.NoError(t, model.DB.AutoMigrate(&model.QuotaData{}))
	previousMemoryCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	monitorGlobalCache.Delete("1h")
	t.Cleanup(func() {
		common.MemoryCacheEnabled = previousMemoryCache
		monitorGlobalCache.Delete("1h")
		assert.NoError(t, model.DB.Migrator().DropTable(&model.QuotaData{}))
	})
	seedChannel(t, 3)
	now := time.Now().Unix()
	hour := now - now%3600
	require.NoError(t, model.LOG_DB.Create(&[]model.Log{
		{UserId: 1, Username: "alice", Type: model.LogTypeConsume, CreatedAt: now - 60, ChannelId: 3, Quota: 100, PromptTokens: 650},
		{UserId: 2, Username: "bob", Type: model.LogTypeConsume, CreatedAt: now - 60, ChannelId: 3, Quota: 300, PromptTokens: 80},
	}).Error)
	require.NoError(t, model.DB.Create(&[]model.QuotaData{
		{UserID: 1, Username: "alice", ModelName: "claude-a", CreatedAt: hour, ChannelID: 3, Count: 2, InputTokens: 1000, CacheReadTokens: 600, CacheCreationTokens: 100},
		// Two hours back is before the 1h window's first hour.
		{UserID: 1, Username: "alice", ModelName: "claude-a", CreatedAt: hour - 7200, ChannelID: 3, Count: 1, InputTokens: 5000, CacheReadTokens: 5000},
	}).Error)

	overview, err := GetMonitorGlobalOverview("1h")
	require.NoError(t, err)
	since := overview.Start - overview.Start%3600
	cache, err := common.Marshal(overview.Cache)
	require.NoError(t, err)
	assert.JSONEq(t, fmt.Sprintf(`{"since":%d,"input_tokens":1000,"cache_read_tokens":600,"cache_creation_tokens":100,
		"channels":[{"channel_id":3,"channel_name":"test_channel","requests":2,"input_tokens":1000,"cache_read_tokens":600,"cache_creation_tokens":100}]}`, since), string(cache))
	users, err := common.Marshal(overview.TopUsers)
	require.NoError(t, err)
	assert.JSONEq(t, `[
		{"user_id":2,"username":"bob","quota":300,"requests":1,"tokens":80,"input_tokens":0,"cache_read_tokens":0,"cache_creation_tokens":0},
		{"user_id":1,"username":"alice","quota":100,"requests":1,"tokens":650,"input_tokens":1000,"cache_read_tokens":600,"cache_creation_tokens":100}
	]`, string(users))

	require.NoError(t, model.DB.Migrator().DropTable(&model.QuotaData{}))
	monitorGlobalCache.Delete("1h")
	failed, err := GetMonitorGlobalOverview("1h")
	require.NoError(t, err, "a failed cache read does not fail the overview")
	cache, err = common.Marshal(failed.Cache)
	require.NoError(t, err)
	assert.JSONEq(t, fmt.Sprintf(`{"since":%d,"input_tokens":0,"cache_read_tokens":0,"cache_creation_tokens":0,"channels":[]}`,
		failed.Start-failed.Start%3600), string(cache))
	require.Len(t, failed.TopUsers, 2)
	assert.Equal(t, model.GlobalCacheTokens{}, failed.TopUsers[1].GlobalCacheTokens)
	assert.EqualValues(t, 100, failed.TopUsers[1].Quota)
}
