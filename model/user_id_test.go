package model

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

func useUserIDTestDB(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	var driver gorm.Dialector
	switch dialect {
	case "sqlite":
		driver = sqlite.Open(filepath.Join(t.TempDir(), "users.db") + "?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)")
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
	db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent), NamingStrategy: schema.NamingStrategy{TablePrefix: "user_id_test_"}})
	require.NoError(t, err)
	tables := []any{&Option{}, &User{}, &SystemTask{}, &UserSubscription{}, &Log{}, &AuditLog{}, &ContentSafetyLog{}, &Token{}, &UserSession{}, &AuthFlow{}, &ExternalIdentityClaim{}, &PasskeyCredential{}, &Redemption{}, &Midjourney{}, &TopUp{}, &QuotaData{}, &Task{}, &TwoFA{}, &TwoFABackupCode{}, &Checkin{}, &SubscriptionOrder{}, &SubscriptionPreConsumeRecord{}, &UserOAuthBinding{}, &UserAccessToken{}, &CasbinRule{}, &AffiliateAccount{}, &AffiliateOrder{}, &AffiliateEntry{}, &AffiliateChange{}, &UserRiskProfile{}}
	require.NoError(t, db.AutoMigrate(tables...))
	require.NoError(t, db.AutoMigrate(tables...))
	var version string
	query := "SELECT version()"
	if dialect == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Logf("database version: %s", version)
	previousDB, previousLogDB, previousOptions, previousType := DB, LOG_DB, maps.Clone(common.OptionMap), common.MainDatabaseType()
	DB = db
	LOG_DB = db
	common.SetMainDatabaseType(common.DatabaseType(dialect))
	common.OptionMap = map[string]string{}
	t.Cleanup(func() {
		require.NoError(t, db.Migrator().DropTable(tables...))
		DB = previousDB
		LOG_DB = previousLogDB
		common.SetMainDatabaseType(previousType)
		common.OptionMap = previousOptions
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	return db
}

// Reverting to native auto-increment after saving the start would skip the gap.
func TestUserIDStartFillsGapsAndSkipsDeletedUsers(t *testing.T) {
	db := useUserIDTestDB(t, "sqlite")
	for _, id := range []int{10000, 10002, 20000} {
		user := User{Id: id, Username: fmt.Sprintf("existing-%d", id), AffCode: fmt.Sprintf("aff-%d", id)}
		require.NoError(t, db.Create(&user).Error)
		if id == 10002 {
			require.NoError(t, db.Delete(&user).Error)
		}
	}
	require.NoError(t, UpdateOption("UserIdStart", "10000"))
	for i, want := range []int{10001, 10003} {
		user := User{Username: fmt.Sprintf("new-%d", i)}
		require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return user.InsertWithTx(tx, 0) }))
		assert.Equal(t, want, user.Id)
	}
}

// Invalid input must fail before either the public setting or cursor changes.
func TestUserIDStartRejectsInvalidValues(t *testing.T) {
	db := useUserIDTestDB(t, "sqlite")
	for _, value := range []string{"", "0", "-1", "2147483648", "1.5", "NaN", "1e3", " 2", "+2"} {
		t.Run(value, func(t *testing.T) {
			assert.Error(t, UpdateOption("UserIdStart", value))
			var count int64
			require.NoError(t, db.Model(&Option{}).Where(&Option{Key: "UserIdStart"}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

// The generic option writers must not bypass allocation by changing hidden or
// case-insensitive aliases (MySQL's option primary key uses its DB collation).
func TestUserIDStartProtectsInternalState(t *testing.T) {
	db := useUserIDTestDB(t, "sqlite")
	require.NoError(t, UpdateOption("UserIdStart", "100"))
	for _, key := range []string{"internal.user_id_cursor", "INTERNAL.USER_ID_CURSOR", "internal.user_id_cursor ", "useridstart", "UserIdStart ", "UsérIdStart", "internal.usér_id_cursor", "User\x00IdStart", "User\x7fIdStart", "inter\x00nal.user_id_cursor", "inter\x7fnal.user_id_cursor"} {
		assert.Error(t, UpdateOption(key, "2"), key)
		assert.Error(t, UpdateOptionsBulk(map[string]string{key: "2"}), key)
	}
	options, err := AllOption()
	require.NoError(t, err)
	for _, option := range options {
		assert.NotEqual(t, "internal.user_id_cursor", option.Key)
	}
	require.NoError(t, updateOptionMap("internal.user_id_cursor", "2"))
	assert.NotContains(t, common.OptionMap, "internal.user_id_cursor")
	user := User{Username: "after-rejected-write"}
	require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return user.InsertWithTx(tx, 0) }))
	assert.Equal(t, 100, user.Id)
	var saved Option
	require.NoError(t, db.Where(&Option{Key: "UserIdStart"}).Take(&saved).Error)
	assert.Equal(t, "100", saved.Value)
}

// Retirement must survive both deleting the account row and resetting the
// configured start; otherwise old subscriptions and permissions change owners.
func TestUserIDStartNeverReusesRetiredIdentity(t *testing.T) {
	db := useUserIDTestDB(t, "sqlite")
	require.NoError(t, UpdateOption("UserIdStart", "10000"))
	user := User{Username: "retired", AuthVersion: 1}
	require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return user.InsertWithTx(tx, 0) }))
	_, err := user.HardDelete()
	require.NoError(t, err)
	require.NoError(t, UpdateOption("UserIdStart", "9999"))
	require.NoError(t, UpdateOption("UserIdStart", "10000"))
	next := User{Username: "after-retirement"}
	require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return next.InsertWithTx(tx, 0) }))
	assert.Equal(t, 10001, next.Id)
	var count int64
	require.NoError(t, db.Unscoped().Model(&User{}).Where("id = ?", 10000).Count(&count).Error)
	assert.Zero(t, count)
}

func TestUserIDStartDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := useUserIDTestDB(t, dialect)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(8)
			sqlDB.SetMaxIdleConns(8)
			// No saved setting: leave native sequences in charge, including deleted high watermarks.
			first := User{Username: "native", AffCode: "native"}
			require.NoError(t, db.Create(&first).Error)
			require.NoError(t, db.Unscoped().Delete(&first).Error)
			native := User{Username: "native-next"}
			require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return native.InsertWithTx(tx, 0) }))
			assert.Greater(t, native.Id, first.Id)
			for _, id := range []int{10000, 10002, 20000} {
				user := User{Id: id, Username: fmt.Sprintf("existing-%d", id), AffCode: fmt.Sprintf("aff-%d", id)}
				require.NoError(t, db.Create(&user).Error)
				if id == 10002 {
					require.NoError(t, db.Delete(&user).Error)
				}
			}
			require.NoError(t, UpdateOption("UserIdStart", "10000"))
			for _, alias := range []string{"User\x00IdStart", "User\x7fIdStart", "inter\x00nal.user_id_cursor", "inter\x7fnal.user_id_cursor"} {
				assert.Error(t, UpdateOption(alias, "1"))
				assert.Error(t, UpdateOptionsBulk(map[string]string{alias: "1"}))
			}
			for i, want := range []int{10001, 10003} {
				user := User{}
				require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return user.InsertWithGeneratedUsername(tx, 0, "wechat_") }))
				assert.Equal(t, want, user.Id)
				assert.Equal(t, []string{"wechat_10001", "wechat_10003"}[i], user.Username)
			}
			// Reconnecting and stale process options cannot rewind persistent progress.
			sqlDB.SetMaxIdleConns(0)
			sqlDB.SetMaxIdleConns(8)
			common.OptionMap["UserIdStart"] = "1"
			require.NoError(t, UpdateOptionsBulk(map[string]string{"UserIdStart": "010000"}))
			user := User{Username: "upstream-name"}
			require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return user.InsertWithGeneratedUsername(tx, 0, "") }))
			assert.Equal(t, 10004, user.Id)
			assert.Equal(t, "upstream-name", user.Username)
			// A failed surrounding flow rolls back cursor advancement and user creation.
			aborted := errors.New("flow failed")
			failed := User{Username: "rolled-back"}
			require.ErrorIs(t, UserCreationTransaction(func(tx *gorm.DB) error {
				if err := failed.InsertWithTx(tx, 0); err != nil {
					return err
				}
				return aborted
			}), aborted)
			next := User{Username: "after-rollback"}
			require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return next.InsertWithTx(tx, 0) }))
			assert.Equal(t, 10005, next.Id)
			// Old orphaned ownership rows predate permanent retirement markers.
			require.NoError(t, db.Create(&Log{UserId: 11000}).Error)
			require.NoError(t, db.Create(&UserSubscription{UserId: 11001}).Error)
			require.NoError(t, db.Create(&CasbinRule{Ptype: "p", V0: "user:11002", V1: "admin.users", V2: "allow"}).Error)
			require.NoError(t, db.Create(&AffiliateAccount{UserID: 11003, BalanceCents: 800}).Error)
			require.NoError(t, db.Create(&AffiliateOrder{TradeNo: "retained-affiliate", BuyerID: 11004, InviterID: 11005}).Error)
			require.NoError(t, db.Create(&AffiliateEntry{EventKey: "retained-affiliate", UserID: 11006, BuyerID: 11007, OperatorID: 11008}).Error)
			require.NoError(t, db.Create(&AffiliateChange{UserID: 11009, OldInviter: 11010, NewInviter: 11011, OperatorID: 11012}).Error)
			require.NoError(t, UpdateOption("UserIdStart", "11000"))
			orphanSafe := User{Username: "after-orphans"}
			require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return orphanSafe.InsertWithTx(tx, 0) }))
			assert.Equal(t, 11013, orphanSafe.Id)
			// Dedicated simultaneously held connections ensure this is not a one-connection test.
			conn1, err := sqlDB.Conn(context.Background())
			require.NoError(t, err)
			conn2, err := sqlDB.Conn(context.Background())
			require.NoError(t, err)
			require.NoError(t, conn1.Close())
			require.NoError(t, conn2.Close())
			require.NoError(t, UpdateOption("UserIdStart", "12000"))
			const callers = 8
			ids := make([]int, callers)
			errs := make([]error, callers)
			start := make(chan struct{})
			var wg sync.WaitGroup
			for i := range callers {
				wg.Go(func() {
					<-start
					u := User{Username: fmt.Sprintf("concurrent-%d", i)}
					errs[i] = UserCreationTransaction(func(tx *gorm.DB) error { return u.InsertWithTx(tx, 0) })
					ids[i] = u.Id
				})
			}
			close(start)
			wg.Wait()
			for _, err := range errs {
				require.NoError(t, err)
			}
			slices.Sort(ids)
			assert.Equal(t, []int{12000, 12001, 12002, 12003, 12004, 12005, 12006, 12007}, ids)
			assert.GreaterOrEqual(t, sqlDB.Stats().OpenConnections, 2)
			require.NoError(t, UpdateOption("UserIdStart", "2147483647"))
			last := User{Username: "last"}
			require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return last.InsertWithTx(tx, 0) }))
			assert.Equal(t, 2147483647, last.Id)
			exhausted := User{Username: "exhausted"}
			assert.Error(t, UserCreationTransaction(func(tx *gorm.DB) error { return exhausted.InsertWithTx(tx, 0) }))
			require.NoError(t, UpdateOption("UserIdStart", "1"))
			reset := User{Username: "reset"}
			require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return reset.InsertWithTx(tx, 0) }))
			assert.Equal(t, 1, reset.Id)
		})
	}
}

func TestUserIDStartSeparateLogDatabase(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres", "clickhouse"} {
		t.Run(dialect, func(t *testing.T) {
			db := useUserIDTestDB(t, "sqlite")
			logDB := openGlobalLogTestDB(t, dialect)
			require.NoError(t, MigrateAuditLogs())
			require.NoError(t, MigrateContentSafetyLogs())
			// These fixtures represent accounts hard-deleted before retirement markers.
			require.NoError(t, logDB.Create(&Log{Id: 1, UserId: 13000, CreatedAt: common.GetTimestamp()}).Error)
			require.NoError(t, logDB.Create(&AuditLog{Id: 1, EventId: "retired-audit", UserId: 13001, CreatedAt: common.GetTimestamp()}).Error)
			require.NoError(t, logDB.Create(&ContentSafetyLog{Id: 1, UserId: 13002, CreatedAt: common.GetTimestamp()}).Error)
			require.NoError(t, UpdateOption("UserIdStart", "13000"))
			user := User{Username: "separate-log"}
			require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return user.InsertWithTx(tx, 0) }))
			assert.Equal(t, 13003, user.Id)
			if dialect != "sqlite" {
				return
			}
			// Missing required history data fails closed and does not consume an ID.
			require.NoError(t, logDB.Migrator().DropTable(&AuditLog{}))
			failed := User{Username: "history-unavailable"}
			require.Error(t, UserCreationTransaction(func(tx *gorm.DB) error { return failed.InsertWithTx(tx, 0) }))
			var count int64
			require.NoError(t, db.Model(&User{}).Where("username = ?", failed.Username).Count(&count).Error)
			assert.Zero(t, count)
			require.NoError(t, MigrateAuditLogs())
			recovered := User{Username: "history-recovered"}
			require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return recovered.InsertWithTx(tx, 0) }))
			assert.Equal(t, 13004, recovered.Id)
		})
	}
}

// A previous log configuration can leave ownership rows in main even after
// LOG_DB moves elsewhere. Missing optional tables are valid; broken ones are not.
func TestUserIDStartRetainedMainLogHistory(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := useUserIDTestDB(t, dialect)
			openGlobalLogTestDB(t, "sqlite")
			require.NoError(t, MigrateAuditLogs())
			require.NoError(t, MigrateContentSafetyLogs())
			require.NoError(t, db.Create(&AuditLog{EventId: "legacy-main", UserId: 14000}).Error)
			require.NoError(t, db.Create(&ContentSafetyLog{UserId: 14001}).Error)
			require.NoError(t, UpdateOption("UserIdStart", "14000"))
			user := User{Username: "after-log-switch"}
			require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return user.InsertWithTx(tx, 0) }))
			assert.Equal(t, 14002, user.Id)
			require.NoError(t, db.Migrator().DropTable(&AuditLog{}, &ContentSafetyLog{}))
			withoutLegacy := User{Username: "no-legacy-tables"}
			require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return withoutLegacy.InsertWithTx(tx, 0) }))
			assert.Equal(t, 14003, withoutLegacy.Id)
			require.NoError(t, db.Table(db.NamingStrategy.TableName("AuditLog")).AutoMigrate(&struct{ Id int }{}))
			broken := User{Username: "broken-legacy-table"}
			require.Error(t, UserCreationTransaction(func(tx *gorm.DB) error { return broken.InsertWithTx(tx, 0) }))
			require.NoError(t, db.Migrator().DropTable(&AuditLog{}))
			recovered := User{Username: "after-schema-repair"}
			require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return recovered.InsertWithTx(tx, 0) }))
			assert.Equal(t, 14004, recovered.Id)
		})
	}
}

// A free numeric ID must remain usable when its conventional provider name is
// owned by another account; soft-deleted usernames still occupy the unique key.
func TestUserIDStartGeneratedUsernameCollisions(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := useUserIDTestDB(t, dialect)
			nativeOwner := User{Username: "native_2", AffCode: "native-owner"}
			require.NoError(t, db.Create(&nativeOwner).Error)
			native := User{}
			require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return native.InsertWithGeneratedUsername(tx, 0, "native_") }))
			assert.Equal(t, 2, native.Id)
			assert.Equal(t, "native_2_1", native.Username)
			for index, tc := range []struct{ prefix, start, base, suffixed, want, next string }{
				{"wechat_", "15000", "wechat_15000", "wechat_15000_1", "wechat_15000_2", "wechat_15001"},
				{"enterprise_provider_", "16000", "enterprise_prov16000", "enterprise_pr16000_1", "enterprise_pr16000_2", "enterprise_prov16001"},
			} {
				for i, name := range []string{tc.base, tc.suffixed} {
					existing := User{Id: 20000 + index*10 + i, Username: name, AffCode: fmt.Sprintf("collision-%d-%d", index, i)}
					require.NoError(t, db.Create(&existing).Error)
					if i == 1 {
						require.NoError(t, db.Delete(&existing).Error)
					}
				}
				require.NoError(t, UpdateOption("UserIdStart", tc.start))
				user := User{}
				require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return user.InsertWithGeneratedUsername(tx, 0, tc.prefix) }))
				assert.Equal(t, []int{15000, 16000}[index], user.Id)
				assert.Equal(t, tc.want, user.Username)
				assert.LessOrEqual(t, len(user.Username), 20)
				next := User{}
				require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return next.InsertWithGeneratedUsername(tx, 0, tc.prefix) }))
				assert.Equal(t, []int{15001, 16001}[index], next.Id)
				assert.Equal(t, tc.next, next.Username)
				explicit := User{Username: tc.base}
				require.Error(t, UserCreationTransaction(func(tx *gorm.DB) error { return explicit.InsertWithGeneratedUsername(tx, 0, "") }))
				assert.Equal(t, tc.base, explicit.Username)
				afterFailure := User{}
				require.NoError(t, UserCreationTransaction(func(tx *gorm.DB) error { return afterFailure.InsertWithGeneratedUsername(tx, 0, tc.prefix) }))
				assert.Equal(t, []int{15002, 16002}[index], afterFailure.Id)
			}
		})
	}
}
