package model

import (
	"context"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestContentSafetyLogDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "csl_test_"}})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			previousLogDB, previousType := LOG_DB, common.LogDatabaseType()
			LOG_DB = db
			common.SetLogDatabaseType(common.DatabaseType(dialect))
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&ContentSafetyLog{}))
				LOG_DB = previousLogDB
				common.SetLogDatabaseType(previousType)
				require.NoError(t, sqlDB.Close())
			})

			require.NoError(t, MigrateContentSafetyLogs())
			require.NoError(t, MigrateContentSafetyLogs(), "migration is idempotent")

			RecordContentSafetyLog(ContentSafetyLog{CreatedAt: 100, UserId: 7, Decision: ContentSafetyDecisionReviewRejected, Model: "gpt-test", HitWords: `["knife"]`, Snippets: `["a knife"]`, AiReason: "harm", CacheHit: true})
			RecordContentSafetyLog(ContentSafetyLog{CreatedAt: 200, UserId: 8, Decision: ContentSafetyDecisionKeywordBlocked})

			logs, total, err := GetContentSafetyLogs(ContentSafetyLogFilter{UserId: 7}, 0, 10)
			require.NoError(t, err)
			require.Equal(t, int64(1), total)
			assert.Equal(t, ContentSafetyDecisionReviewRejected, logs[0].Decision)
			assert.True(t, logs[0].CacheHit)
			assert.Equal(t, `["knife"]`, logs[0].HitWords)
			assert.NotEmpty(t, logs[0].EventId)

			_, total, err = GetContentSafetyLogs(ContentSafetyLogFilter{Decision: ContentSafetyDecisionKeywordBlocked, StartTimestamp: 150}, 0, 10)
			require.NoError(t, err)
			assert.Equal(t, int64(1), total)

			deleted, err := DeleteContentSafetyLogsBefore(context.Background(), 150)
			require.NoError(t, err)
			assert.Equal(t, int64(1), deleted)
			_, total, err = GetContentSafetyLogs(ContentSafetyLogFilter{}, 0, 10)
			require.NoError(t, err)
			assert.Equal(t, int64(1), total)
		})
	}
}
