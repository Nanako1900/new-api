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
				{UserId: 1, Username: "alice", Type: LogTypeError, CreatedAt: 1600, ModelName: "gpt-a", ChannelId: 4},
				{UserId: 2, Username: "bob", Type: LogTypeError, CreatedAt: 1700, ModelName: "gpt-a", ChannelId: 4},
				{UserId: 3, Username: "carol", Type: LogTypeError, CreatedAt: 1800, ModelName: "gpt-a"},
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
		})
	}
}
