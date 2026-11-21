package model

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/clickhouse"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// openGlobalLogTestDB opens an empty log database of dialect with its own
// `logs` table: the site-wide queries name the table directly, so each run
// gets a fresh database (MySQL, ClickHouse) or schema (PostgreSQL).
func openGlobalLogTestDB(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_" + strings.ToUpper(dialect) + "_DSN")
	if dialect != "sqlite" && dsn == "" {
		t.Skipf("TEST_%s_DSN is not configured", strings.ToUpper(dialect))
	}
	name := fmt.Sprintf("global_usage_%d", time.Now().UnixNano())
	var db *gorm.DB
	var err error
	switch dialect {
	case "sqlite":
		db, err = gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	case "mysql":
		admin, openErr := gorm.Open(mysql.Open(dsn), &gorm.Config{})
		require.NoError(t, openErr)
		require.NoError(t, admin.Exec("CREATE DATABASE "+name+" CHARACTER SET utf8mb4").Error)
		t.Cleanup(func() { assert.NoError(t, admin.Exec("DROP DATABASE "+name).Error) })
		base, _, _ := strings.Cut(dsn, "?")
		base = base[:strings.LastIndex(base, "/")+1]
		db, err = gorm.Open(mysql.Open(base+name+"?parseTime=true"), &gorm.Config{})
	case "postgres":
		db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
		require.NoError(t, err)
		db = db.Begin()
		require.NoError(t, db.Error)
		t.Cleanup(func() { assert.NoError(t, db.Rollback().Error) })
		require.NoError(t, db.Exec("CREATE SCHEMA ?", clause.Table{Name: name}).Error)
		require.NoError(t, db.Exec("SET LOCAL search_path TO ?", clause.Table{Name: name}).Error)
	case "clickhouse":
		admin, openErr := gorm.Open(clickhouse.Open(dsn), &gorm.Config{})
		require.NoError(t, openErr)
		require.NoError(t, admin.Exec("CREATE DATABASE "+name).Error)
		t.Cleanup(func() { assert.NoError(t, admin.Exec("DROP DATABASE "+name).Error) })
		parsed, parseErr := url.Parse(dsn)
		require.NoError(t, parseErr)
		parsed.Path = "/" + name
		db, err = gorm.Open(clickhouse.Open(parsed.String()), &gorm.Config{})
	}
	require.NoError(t, err)

	previousLogDB, previousType := LOG_DB, common.LogDatabaseType()
	LOG_DB = db
	common.SetLogDatabaseType(common.DatabaseType(dialect))
	t.Cleanup(func() {
		LOG_DB = previousLogDB
		common.SetLogDatabaseType(previousType)
	})
	if dialect == "clickhouse" {
		require.NoError(t, migrateClickHouseLogDB())
	} else {
		require.NoError(t, db.AutoMigrate(&Log{}))
	}
	versionSQL := "SELECT version()"
	if dialect == "sqlite" {
		versionSQL = "SELECT sqlite_version()"
	}
	var version string
	require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
	t.Logf("database version: %s", version)
	return db
}

// TestGlobalLogUsageDatabaseMatrix checks the root console's site-wide queries
// on every supported log database.
func TestGlobalLogUsageDatabaseMatrix(t *testing.T) {
	channelDB, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, channelDB.AutoMigrate(&Channel{}))
	require.NoError(t, channelDB.Create(&[]Channel{{Id: 3, Name: "upstream-3", Key: "k3"}, {Id: 4, Name: "upstream-4", Key: "k4"}}).Error)
	previousDB, previousMemoryCache := DB, common.MemoryCacheEnabled
	DB, common.MemoryCacheEnabled = channelDB, false
	t.Cleanup(func() { DB, common.MemoryCacheEnabled = previousDB, previousMemoryCache })

	for _, dialect := range []string{"sqlite", "mysql", "postgres", "clickhouse"} {
		t.Run(dialect, func(t *testing.T) {
			db := openGlobalLogTestDB(t, dialect)
			rows := []Log{
				{UserId: 1, Username: "alice", Type: LogTypeConsume, CreatedAt: 1500, ModelName: "gpt-a", ChannelId: 3, Quota: 100, PromptTokens: 10, CompletionTokens: 5},
				{UserId: 1, Username: "alice", Type: LogTypeConsume, CreatedAt: 1950, ModelName: "gpt-b", ChannelId: 3, Quota: 50, PromptTokens: 20, CompletionTokens: 10},
				{UserId: 2, Username: "bob", Type: LogTypeConsume, CreatedAt: 1200, ModelName: "gpt-a", ChannelId: 4, Quota: 300, PromptTokens: 100, CompletionTokens: 50},
				{UserId: 3, Username: "carol", Type: LogTypeConsume, CreatedAt: 999, ModelName: "gpt-a", ChannelId: 3, Quota: 20},
				{UserId: 1, Username: "alice", Type: LogTypeError, CreatedAt: 1600, ModelName: "gpt-a", ChannelId: 4,
					Content: "upstream exploded", Other: `{"status_code":500,"error_code":"unknown_error"}`},
				{UserId: 2, Username: "bob", Type: LogTypeError, CreatedAt: 1700, ModelName: "gpt-a", ChannelId: 4,
					Content: "upstream exploded again", Other: `{"status_code":500,"error_code":"unknown_error"}`},
				{UserId: 3, Username: "carol", Type: LogTypeError, CreatedAt: 1800, ModelName: "gpt-a",
					Content: "no channel available", Other: `{"status_code":503,"error_code":"model_not_found"}`},
				{UserId: 2, Username: "bob", Type: LogTypeError, CreatedAt: 2001, ModelName: "gpt-a", ChannelId: 4},
				{UserId: 1, Username: "alice", Type: LogTypeTopup, CreatedAt: 1650, Quota: 9999},
			}
			for i := range rows {
				rows[i].RequestId = fmt.Sprintf("req-%02d", i)
				require.NoError(t, db.Create(&rows[i]).Error)
			}

			usage, err := GetGlobalLogUsage(context.Background(), 1000, 2000, 1900, 10)
			require.NoError(t, err)
			assert.Equal(t, GlobalLogTotals{Quota: 450, Requests: 3, Tokens: 195, Errors: 3, ActiveUsers: 2}, usage.Totals,
				"rows outside the window and top-ups do not count")
			assert.Equal(t, GlobalLogRate{Rpm: 1, Tpm: 30}, usage.Rate)
			assert.Equal(t, []GlobalUserUsage{
				{UserId: 2, Username: "bob", Quota: 300, Requests: 1, Tokens: 150},
				{UserId: 1, Username: "alice", Quota: 150, Requests: 2, Tokens: 45},
			}, usage.TopUsers)
			assert.Equal(t, []GlobalModelUsage{
				{ModelName: "gpt-a", Quota: 400, Requests: 2, Tokens: 165},
				{ModelName: "gpt-b", Quota: 50, Requests: 1, Tokens: 30},
			}, usage.TopModels)
			assert.Equal(t, []GlobalChannelUsage{
				{ChannelId: 4, ChannelName: "upstream-4", Requests: 1, Errors: 2},
				{ChannelId: 0, ChannelName: "", Requests: 0, Errors: 1},
				{ChannelId: 3, ChannelName: "upstream-3", Requests: 2, Errors: 0},
			}, usage.Channels, "channels with errors come first")

			limited, err := GetGlobalLogUsage(context.Background(), 1000, 2000, 1900, 1)
			require.NoError(t, err)
			assert.Len(t, limited.TopUsers, 1)
			assert.Equal(t, "bob", limited.TopUsers[0].Username)

			empty, err := GetGlobalLogUsage(context.Background(), 5000, 6000, 5900, 10)
			require.NoError(t, err)
			assert.Equal(t, GlobalLogTotals{}, empty.Totals)
			assert.NotNil(t, empty.TopUsers, "an empty window lists no users rather than null")
			assert.Empty(t, empty.TopUsers)

			replay, err := GetGlobalLogsSince(1600, 3)
			require.NoError(t, err)
			var replayed []int64
			for _, row := range replay {
				replayed = append(replayed, row.CreatedAt)
			}
			assert.Equal(t, []int64{1800, 1950, 2001}, replayed, "the newest request rows, oldest first, without the top-up")

			window := LogFilter{StartTimestamp: 1000, EndTimestamp: 2000}
			logs, total, err := GetGlobalLogs(window, 0, 100, GlobalLogCountLimit)
			require.NoError(t, err)
			assert.EqualValues(t, 6, total, "request rows only: the top-up and the rows outside the window are left out")
			require.Len(t, logs, 6)
			assert.EqualValues(t, 1950, logs[0].CreatedAt, "newest first")
			for _, row := range logs {
				assert.True(t, IsGlobalLogType(row.Type))
			}
			assert.Equal(t, "upstream-3", logs[0].ChannelName)

			_, capped, err := GetGlobalLogs(window, 0, 2, 4)
			require.NoError(t, err)
			assert.EqualValues(t, 4, capped, "the total stops at the count limit")
			errorsOnly, errorTotal, err := GetGlobalLogs(LogFilter{Type: LogTypeError, StartTimestamp: 1000, EndTimestamp: 2000}, 0, 100, GlobalLogCountLimit)
			require.NoError(t, err)
			assert.EqualValues(t, 3, errorTotal)
			assert.Len(t, errorsOnly, 3)
			_, topUps, err := GetGlobalLogs(LogFilter{Type: LogTypeTopup}, 0, 100, GlobalLogCountLimit)
			require.NoError(t, err)
			assert.Zero(t, topUps, "asking for another type still returns no row of it")

			// Window [1000, 2000] is 1000 s; the last 100 s from 1900 are recent. Alice spent 50 of her 150
			// there: 50 × 1000 ≥ 3 × 100 × 150, a spike. Bob spent nothing recently.
			spikes, err := GetGlobalSpendSpikes(context.Background(), 1900, 1000, 2000, 10, 3, 10)
			require.NoError(t, err)
			assert.Equal(t, []GlobalUserSpend{{UserId: 1, Username: "alice", RecentQuota: 50, RecentRequests: 1, WindowQuota: 150}}, spikes)
			for _, tc := range []struct {
				name               string
				floor, ratio, from int64
			}{
				{"below the floor", 60, 3, 1900},
				{"below the ratio", 10, 4, 1900},
				{"steady spend over a long recent span", 10, 3, 1100},
			} {
				none, err := GetGlobalSpendSpikes(context.Background(), tc.from, 1000, 2000, tc.floor, tc.ratio, 10)
				require.NoError(t, err, tc.name)
				assert.Empty(t, none, tc.name)
			}

			samples, err := GetGlobalErrorSamples(context.Background(), 1000, 2000, 2)
			require.NoError(t, err)
			require.Len(t, samples, 2, "the newest rows up to the limit; the one after the window is left out")
			assert.Equal(t, "no channel available", samples[0].Content)
			assert.Equal(t, "upstream exploded again", samples[1].Content)
			assert.JSONEq(t, `{"status_code":500,"error_code":"unknown_error"}`, samples[1].Other)
		})
	}
}

// TestGlobalCacheUsageDatabaseMatrix checks the root console's cache hit rate
// sums over quota_data on every supported main database.
func TestGlobalCacheUsageDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := openGlobalLogTestDB(t, dialect)
			require.NoError(t, db.AutoMigrate(&QuotaData{}, &Channel{}))
			previousDB, previousMemoryCache := DB, common.MemoryCacheEnabled
			DB, common.MemoryCacheEnabled = db, false
			t.Cleanup(func() { DB, common.MemoryCacheEnabled = previousDB, previousMemoryCache })
			require.NoError(t, db.Create(&[]Channel{{Id: 3, Name: "upstream-3", Key: "k3"}, {Id: 4, Name: "upstream-4", Key: "k4"}}).Error)
			require.NoError(t, db.Create(&[]QuotaData{
				{UserID: 1, Username: "alice", ModelName: "claude-a", CreatedAt: 3600, ChannelID: 3, Count: 2, InputTokens: 1000, CacheReadTokens: 600, CacheCreationTokens: 100},
				{UserID: 1, Username: "alice", ModelName: "gpt-a", CreatedAt: 7200, ChannelID: 4, Count: 1, InputTokens: 400, CacheReadTokens: 100},
				{UserID: 2, Username: "bob", ModelName: "gpt-a", CreatedAt: 7200, ChannelID: 4, Count: 3, InputTokens: 600},
				{UserID: 2, Username: "bob", ModelName: "gpt-a", CreatedAt: 7200, ChannelID: 9, Count: 1, InputTokens: 1600},
				// Written before input totals were recorded: no input, so it does not count.
				{UserID: 3, Username: "carol", ModelName: "claude-a", CreatedAt: 7200, ChannelID: 3, Count: 9, CacheReadTokens: 900},
				// Upgrade hour: the old version's cache reads plus the new version's input in one row.
				// More reads than input, so it does not count either.
				{UserID: 2, Username: "bob", ModelName: "claude-a", CreatedAt: 7200, ChannelID: 4, Count: 6, InputTokens: 100, CacheReadTokens: 5000, CacheCreationTokens: 300},
				// Before since (a zero created_at would be filled with the current time).
				{UserID: 1, Username: "alice", ModelName: "claude-a", CreatedAt: 1, ChannelID: 3, Count: 1, InputTokens: 5000, CacheReadTokens: 5000},
			}).Error)

			usage, users, err := GetGlobalCacheUsage(context.Background(), 3600, []int{1, 2, 3}, 10)
			require.NoError(t, err)
			assert.Equal(t, int64(3600), usage.Since)
			assert.Equal(t, GlobalCacheTokens{InputTokens: 3600, CacheReadTokens: 700, CacheCreationTokens: 100}, usage.GlobalCacheTokens)
			assert.Equal(t, []GlobalCacheChannelUsage{
				{ChannelId: 9, Requests: 1, GlobalCacheTokens: GlobalCacheTokens{InputTokens: 1600}},
				{ChannelId: 3, ChannelName: "upstream-3", Requests: 2, GlobalCacheTokens: GlobalCacheTokens{InputTokens: 1000, CacheReadTokens: 600, CacheCreationTokens: 100}},
				{ChannelId: 4, ChannelName: "upstream-4", Requests: 4, GlobalCacheTokens: GlobalCacheTokens{InputTokens: 1000, CacheReadTokens: 100}},
			}, usage.Channels, "most input first; equal input by channel id")
			assert.Equal(t, map[int]GlobalCacheTokens{
				1: {InputTokens: 1400, CacheReadTokens: 700, CacheCreationTokens: 100},
				2: {InputTokens: 2200},
			}, users, "a user with no counted row is left out")

			limited, _, err := GetGlobalCacheUsage(context.Background(), 3600, nil, 1)
			require.NoError(t, err)
			require.Len(t, limited.Channels, 1)
			assert.Equal(t, 9, limited.Channels[0].ChannelId)

			empty, noUsers, err := GetGlobalCacheUsage(context.Background(), 10800, []int{1}, 10)
			require.NoError(t, err)
			assert.Equal(t, GlobalCacheTokens{}, empty.GlobalCacheTokens)
			assert.NotNil(t, empty.Channels, "no counted row lists no channels rather than null")
			assert.Empty(t, empty.Channels)
			assert.Empty(t, noUsers)
		})
	}
}
