package model

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type previousRefreshHashMigrationLegacy struct {
	SID                 string `gorm:"column:sid;type:varchar(64);primaryKey"`
	PreviousRefreshHash string `gorm:"column:previous_refresh_hash;type:char(64)"`
}

type previousRefreshHashMigrationTarget struct {
	SID                 string `gorm:"column:sid;type:varchar(64);primaryKey"`
	PreviousRefreshHash string `gorm:"column:previous_refresh_hash;type:varchar(64)"`
}

type migrationSQLRecorder struct {
	mu         sync.Mutex
	statements []string
}

func (recorder *migrationSQLRecorder) LogMode(logger.LogLevel) logger.Interface { return recorder }
func (recorder *migrationSQLRecorder) Info(context.Context, string, ...any)     {}
func (recorder *migrationSQLRecorder) Warn(context.Context, string, ...any)     {}
func (recorder *migrationSQLRecorder) Error(context.Context, string, ...any)    {}

func (recorder *migrationSQLRecorder) Trace(_ context.Context, _ time.Time, sql func() (string, int64), _ error) {
	statement, _ := sql()
	recorder.mu.Lock()
	recorder.statements = append(recorder.statements, statement)
	recorder.mu.Unlock()
}

func (recorder *migrationSQLRecorder) reset() {
	recorder.mu.Lock()
	recorder.statements = nil
	recorder.mu.Unlock()
}

func (recorder *migrationSQLRecorder) schemaMutations() []string {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	mutations := make([]string, 0)
	for _, statement := range recorder.statements {
		normalized := strings.ToUpper(strings.TrimSpace(statement))
		if strings.HasPrefix(normalized, "ALTER TABLE") ||
			strings.HasPrefix(normalized, "CREATE TABLE") ||
			strings.HasPrefix(normalized, "DROP TABLE") ||
			strings.HasPrefix(normalized, "RENAME TABLE") ||
			strings.HasPrefix(normalized, "CREATE INDEX") ||
			strings.HasPrefix(normalized, "CREATE UNIQUE INDEX") ||
			strings.HasPrefix(normalized, "DROP INDEX") {
			mutations = append(mutations, statement)
		}
	}
	return mutations
}

func TestUserSessionPreviousRefreshHashSchemaUsesNullableVarchar(t *testing.T) {
	statement := &gorm.Statement{DB: DB}
	require.NoError(t, statement.Parse(&UserSession{}))
	field := statement.Schema.LookUpField("PreviousRefreshHash")
	require.NotNil(t, field)
	assert.Equal(t, "varchar(64)", field.TagSettings["TYPE"])
	assert.False(t, field.NotNull)
}

func testPreviousRefreshHashMigration(t *testing.T, db *gorm.DB, recorder *migrationSQLRecorder, dialect string) {
	t.Helper()
	tableName := fmt.Sprintf("user_session_previous_hash_migration_%d", time.Now().UnixNano())
	t.Cleanup(func() { _ = db.Migrator().DropTable(tableName) })

	require.NoError(t, db.Table(tableName).AutoMigrate(&previousRefreshHashMigrationLegacy{}))
	digest := strings.Repeat("a", 60)
	require.NoError(t, db.Table(tableName).Create(&previousRefreshHashMigrationLegacy{
		SID:                 "legacy-session",
		PreviousRefreshHash: digest,
	}).Error)

	require.NoError(t, db.Table(tableName).AutoMigrate(&previousRefreshHashMigrationTarget{}))
	var session UserSession
	require.NoError(t, db.Table(tableName).
		Select("sid", "previous_refresh_hash").
		Where("sid = ?", "legacy-session").
		First(&session).Error)
	assert.Equal(t, digest, session.PreviousRefreshHash, "legacy CHAR padding must be normalized on database reads")

	columnTypes, err := db.Table(tableName).Migrator().ColumnTypes(&previousRefreshHashMigrationTarget{})
	require.NoError(t, err)
	var previousHashColumnFound bool
	for _, columnType := range columnTypes {
		if !strings.EqualFold(columnType.Name(), "previous_refresh_hash") {
			continue
		}
		previousHashColumnFound = true
		nullable, ok := columnType.Nullable()
		require.True(t, ok)
		if dialect != "sqlite" {
			assert.True(t, nullable)
		}
		assert.Contains(t, strings.ToUpper(columnType.DatabaseTypeName()), "VARCHAR")
	}
	assert.True(t, previousHashColumnFound)

	recorder.reset()
	require.NoError(t, db.Table(tableName).AutoMigrate(&previousRefreshHashMigrationTarget{}))
	assert.Empty(t, recorder.schemaMutations(), "a second migration must not repeat type-changing DDL")
}

func TestUserSessionPreviousRefreshHashMigrationSQLite(t *testing.T) {
	recorder := &migrationSQLRecorder{}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: recorder})
	require.NoError(t, err)
	testPreviousRefreshHashMigration(t, db, recorder, "sqlite")
}

func TestUserSessionPreviousRefreshHashMigrationConfiguredDatabases(t *testing.T) {
	runOnConfiguredMigrationDatabases(t, testPreviousRefreshHashMigration)
}

// runOnConfiguredMigrationDatabases runs a migration case against the real
// MySQL and PostgreSQL instances named by TEST_MYSQL_DSN / TEST_POSTGRES_DSN.
func runOnConfiguredMigrationDatabases(t *testing.T, run func(*testing.T, *gorm.DB, *migrationSQLRecorder, string)) {
	tests := []struct {
		name      string
		env       string
		dialector func(string) gorm.Dialector
	}{
		{name: "mysql", env: "TEST_MYSQL_DSN", dialector: func(dsn string) gorm.Dialector { return mysql.Open(dsn) }},
		{name: "postgres", env: "TEST_POSTGRES_DSN", dialector: func(dsn string) gorm.Dialector {
			return postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dsn := strings.TrimSpace(os.Getenv(test.env))
			if dsn == "" {
				t.Skip(test.env + " is not configured")
			}
			recorder := &migrationSQLRecorder{}
			db, err := gorm.Open(test.dialector(dsn), &gorm.Config{Logger: recorder})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { _ = sqlDB.Close() })
			run(t, db, recorder, test.name)
		})
	}
}

type userSessionKindMigrationLegacy struct {
	SID         string `gorm:"column:sid;type:varchar(64);primaryKey"`
	LoginMethod string `gorm:"type:varchar(32);not null"`
}

// userSessionKindMigrationTarget mirrors the UserSession kind columns; the
// schema test below keeps both tag sets identical.
type userSessionKindMigrationTarget struct {
	SID         string `gorm:"column:sid;type:varchar(64);primaryKey"`
	LoginMethod string `gorm:"type:varchar(32);not null"`
	Kind        string `gorm:"type:varchar(16);not null;default:''"`
	ParentSID   string `gorm:"column:parent_sid;type:varchar(64);not null;default:''"`
}

func TestUserSessionKindColumnsMatchMigrationFixture(t *testing.T) {
	sessionSchema := &gorm.Statement{DB: DB}
	require.NoError(t, sessionSchema.Parse(&UserSession{}))
	fixtureSchema := &gorm.Statement{DB: DB}
	require.NoError(t, fixtureSchema.Parse(&userSessionKindMigrationTarget{}))
	for _, name := range []string{"Kind", "ParentSID"} {
		sessionField := sessionSchema.Schema.LookUpField(name)
		fixtureField := fixtureSchema.Schema.LookUpField(name)
		require.NotNil(t, sessionField, name)
		require.NotNil(t, fixtureField, name)
		assert.Equal(t, fixtureField.TagSettings, sessionField.TagSettings, name)
	}
}

func testUserSessionKindMigration(t *testing.T, db *gorm.DB, recorder *migrationSQLRecorder, _ string) {
	t.Helper()
	tableName := fmt.Sprintf("user_session_kind_migration_%d", time.Now().UnixNano())
	t.Cleanup(func() { _ = db.Migrator().DropTable(tableName) })

	require.NoError(t, db.Table(tableName).AutoMigrate(&userSessionKindMigrationLegacy{}))
	require.NoError(t, db.Table(tableName).Create(&userSessionKindMigrationLegacy{SID: "legacy-session", LoginMethod: "password"}).Error)

	require.NoError(t, db.Table(tableName).AutoMigrate(&userSessionKindMigrationTarget{}))
	var upgraded userSessionKindMigrationTarget
	require.NoError(t, db.Table(tableName).Where("sid = ?", "legacy-session").First(&upgraded).Error)
	assert.Equal(t, "password", upgraded.LoginMethod)
	assert.Empty(t, upgraded.Kind, "existing sessions must stay dashboard sessions")
	assert.Empty(t, upgraded.ParentSID)

	require.NoError(t, db.Table(tableName).Create(&userSessionKindMigrationTarget{
		SID: "monitor-session", LoginMethod: "monitor_sso", Kind: "monitor", ParentSID: "legacy-session",
	}).Error)
	var monitor userSessionKindMigrationTarget
	require.NoError(t, db.Table(tableName).Where("sid = ?", "monitor-session").First(&monitor).Error)
	assert.Equal(t, "monitor", monitor.Kind)
	assert.Equal(t, "legacy-session", monitor.ParentSID)

	recorder.reset()
	require.NoError(t, db.Table(tableName).AutoMigrate(&userSessionKindMigrationTarget{}))
	assert.Empty(t, recorder.schemaMutations(), "a second migration must not repeat DDL for the kind columns")
}

func TestUserSessionKindMigrationSQLite(t *testing.T) {
	recorder := &migrationSQLRecorder{}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: recorder})
	require.NoError(t, err)
	testUserSessionKindMigration(t, db, recorder, "sqlite")
}

func TestUserSessionKindMigrationConfiguredDatabases(t *testing.T) {
	runOnConfiguredMigrationDatabases(t, testUserSessionKindMigration)
}
