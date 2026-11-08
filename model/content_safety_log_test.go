package model

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

// MySQL and PostgreSQL DSNs must point at a dedicated database: index names
// idx_csl_* are schema-wide on PostgreSQL and the test drops the table.
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

			_, total, err = GetContentSafetyLogs(ContentSafetyLogFilter{EndTimestamp: 150, Model: "gpt-test"}, 0, 10)
			require.NoError(t, err)
			assert.Equal(t, int64(1), total)
			_, total, err = GetContentSafetyLogs(ContentSafetyLogFilter{EndTimestamp: 150, Model: "other"}, 0, 10)
			require.NoError(t, err)
			assert.Equal(t, int64(0), total)

			RecordContentSafetyLog(ContentSafetyLog{EventId: "evt-a", RequestId: "req-find", CreatedAt: 300, UserId: 9})
			RecordContentSafetyLog(ContentSafetyLog{EventId: "evt-b", CreatedAt: 300, UserId: 9})
			logs, total, err = GetContentSafetyLogs(ContentSafetyLogFilter{RequestId: "req-find"}, 0, 10)
			require.NoError(t, err)
			require.Equal(t, int64(1), total)
			assert.Equal(t, "evt-a", logs[0].EventId)
			logs, _, err = GetContentSafetyLogs(ContentSafetyLogFilter{}, 0, 3)
			require.NoError(t, err)
			require.Len(t, logs, 3)
			assert.Equal(t, []string{"evt-b", "evt-a"}, []string{logs[0].EventId, logs[1].EventId})
			assert.Equal(t, int64(200), logs[2].CreatedAt)
			logs, _, err = GetContentSafetyLogs(ContentSafetyLogFilter{}, -5, 0)
			require.NoError(t, err)
			assert.Len(t, logs, 1, "limit below 1 is clamped to 1 and negative start to 0")

			RecordContentSafetyLog(ContentSafetyLog{
				EventId: "evt-long", CreatedAt: 400, UserId: 10,
				Model:       strings.Repeat("模", 300),
				RequestPath: strings.Repeat("p", 300),
				TokenName:   strings.Repeat("令", 200),
			})
			logs, _, err = GetContentSafetyLogs(ContentSafetyLogFilter{UserId: 10}, 0, 10)
			require.NoError(t, err)
			require.Len(t, logs, 1)
			assert.Equal(t, 255, utf8.RuneCountInString(logs[0].Model))
			assert.Equal(t, 255, utf8.RuneCountInString(logs[0].RequestPath))
			assert.Equal(t, 128, utf8.RuneCountInString(logs[0].TokenName))

			old := make([]ContentSafetyLog, 2050)
			for i := range old {
				old[i] = ContentSafetyLog{EventId: fmt.Sprintf("old-%05d", i), CreatedAt: 10, UserId: 11}
			}
			require.NoError(t, db.CreateInBatches(old, 200).Error)
			deleted, err := DeleteContentSafetyLogsBefore(context.Background(), 150)
			require.NoError(t, err)
			assert.Equal(t, int64(2051), deleted)
			_, total, err = GetContentSafetyLogs(ContentSafetyLogFilter{}, 0, 10)
			require.NoError(t, err)
			assert.Equal(t, int64(4), total)
		})
	}
}
