package model

import (
	"errors"
	"maps"
	"math"
	"os"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestRequestPolicyDatabaseMatrix(t *testing.T) {
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
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "policy_test_"}})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			previousDB, previousType, previousSnapshot := DB, common.MainDatabaseType(), CurrentRequestPolicy()
			common.OptionMapRWMutex.Lock()
			previousOptions := maps.Clone(common.OptionMap)
			common.OptionMap = maps.Clone(previousSnapshot.Options)
			common.OptionMapRWMutex.Unlock()
			DB = db
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			initCol()
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&Option{}))
				for k, v := range previousSnapshot.Options {
					require.NoError(t, updateOptionMap(k, v))
				}
				requestPolicySnapshot.Store(previousSnapshot)
				common.OptionMapRWMutex.Lock()
				common.OptionMap = previousOptions
				common.OptionMapRWMutex.Unlock()
				DB = previousDB
				common.SetMainDatabaseType(previousType)
				initCol()
				require.NoError(t, sqlDB.Close())
			})
			require.NoError(t, db.AutoMigrate(&Option{}))
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)
			rules := `[{"name":"session","model_regex":[".*"],"key_sources":[{"type":"request_header","key":"X-Session"}],"ttl_seconds":0,"skip_retry_on_failure":false,"include_using_group":false,"param_override_template":{"temperature":0},"future_field":{"enabled":false}}]`
			require.NoError(t, UpdateRequestPolicyOptions(map[string]string{"RetryTimes": "2", "channel_affinity_setting.rules": rules}))
			assert.Equal(t, 2, CurrentRequestPolicy().RetryTimes)
			assert.Equal(t, 2, common.RetryTimes, "the runtime global follows the same write")
			require.NoError(t, UpdateOption("AutomaticRetryStatusCodes", "429,500-503"))
			assert.Equal(t, "429,500-503", CurrentRequestPolicy().Options["AutomaticRetryStatusCodes"])
			assert.Equal(t, "429,500-503", operation_setting.AutomaticRetryStatusCodesToString())
			assert.Error(t, UpdateRequestPolicyOptions(map[string]string{"request_policy_setting.mode": "off"}), "the removed mode switch is not a policy option")
			assert.False(t, CurrentRequestPolicy().Affinity.Rules[0].SkipRetryOnFailure)
			assert.Equal(t, rules, CurrentRequestPolicy().Options["channel_affinity_setting.rules"])
			LoadOptionsFromDatabase()
			LoadOptionsFromDatabase()
			assert.Equal(t, rules, CurrentRequestPolicy().Options["channel_affinity_setting.rules"], "legacy rule JSON survives reloads without dropping extension fields")
			require.NoError(t, UpdateRequestPolicyOptions(map[string]string{"channel_affinity_setting.session_mode": "strict"}))
			LoadOptionsFromDatabase()
			LoadOptionsFromDatabase()
			assert.Equal(t, "strict", CurrentRequestPolicy().Affinity.SessionMode)
			assert.Equal(t, rules, CurrentRequestPolicy().Options["channel_affinity_setting.rules"], "a global mode never rewrites rule fields")
			snapshot := CurrentRequestPolicy()
			assert.Error(t, UpdateRequestPolicyOptions(map[string]string{"channel_affinity_setting.session_mode": "unknown"}))
			assert.Same(t, snapshot, CurrentRequestPolicy())
			for _, value := range []string{"-1", "1.5", "bad", strconv.Itoa(math.MaxInt)} {
				assert.Error(t, UpdateRequestPolicyOptions(map[string]string{"RetryTimes": value}))
				assert.Same(t, snapshot, CurrentRequestPolicy())
			}
			assert.Error(t, UpdateRequestPolicyOptions(map[string]string{"channel_affinity_setting.rules": "[", "RetryTimes": "8"}))
			assert.Same(t, snapshot, CurrentRequestPolicy())
			var option Option
			require.NoError(t, db.Where(map[string]any{"key": "RetryTimes"}).First(&option).Error)
			assert.Equal(t, "2", option.Value)
			require.NoError(t, db.Callback().Update().Before("gorm:update").Register("policy_fail", func(tx *gorm.DB) {
				if tx.Statement.Table == "policy_test_options" {
					tx.AddError(errors.New("save rejected"))
				}
			}))
			assert.Error(t, UpdateRequestPolicyOptions(map[string]string{"RetryTimes": "8", "channel_affinity_setting.session_mode": "off"}))
			assert.Same(t, snapshot, CurrentRequestPolicy())
			require.NoError(t, db.Callback().Update().Remove("policy_fail"))
			option = Option{}
			require.NoError(t, db.Where(map[string]any{"key": "RetryTimes"}).First(&option).Error)
			assert.Equal(t, "2", option.Value)
			LoadOptionsFromDatabase()
			assert.Equal(t, "strict", CurrentRequestPolicy().Affinity.SessionMode, "a failed save keeps the persisted global mode")
		})
	}
}

func TestBuildRequestPolicyValidatesContentSafety(t *testing.T) {
	previousGroups := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousGroups)) })

	const p = operation_setting.ContentSafetyOptionPrefix
	enforced := map[string]string{p + "review_mode": "enforce", p + "review_model": "judge", p + "review_group": "default"}
	with := func(key, value string) map[string]string {
		options := maps.Clone(enforced)
		options[key] = value
		return options
	}
	for _, tc := range []struct {
		name    string
		options map[string]string
		wantErr string
	}{
		{name: "defaults are valid", options: nil},
		{name: "enforced with model and group", options: enforced},
		{name: "shadow with model and group", options: with(p+"review_mode", "shadow")},
		{name: "enforced without model", options: with(p+"review_model", " "), wantErr: "review_model"},
		{name: "shadow without group", options: map[string]string{p + "review_mode": "shadow", p + "review_model": "judge", p + "review_group": ""}, wantErr: "review_group"},
		{name: "unknown mode", options: with(p+"review_mode", "on"), wantErr: "review_mode"},
		{name: "refresh accepts a group that no longer exists", options: with(p+"review_group", "no-such-group")},
		{name: "timeout above its bound", options: map[string]string{p + "review_timeout_seconds": "61"}, wantErr: "review_timeout_seconds"},
		{name: "unit size below its bound", options: map[string]string{p + "unit_chars": "199"}, wantErr: "unit_chars"},
		{name: "a sampled background review", options: with(p+"review_sample_percent", "5")},
		{name: "a sample of nothing", options: with(p+"review_sample_percent", "0"), wantErr: "review_sample_percent"},
		{name: "a sample above everything", options: with(p+"review_sample_percent", "101"), wantErr: "review_sample_percent"},
		{name: "zero cache ttl disables the cache", options: map[string]string{p + "cache_ttl_seconds": "0"}},
		{name: "non-integer concurrency", options: map[string]string{p + "review_max_concurrency": "1.5"}, wantErr: "review_max_concurrency"},
		{name: "unknown content safety field", options: map[string]string{p + "mode": "strict"}, wantErr: "unknown content safety option"},
		{name: "non-boolean switch", options: map[string]string{p + "sync_all": "yes"}, wantErr: "sync_all"},
		{name: "options of the retired keyword trigger are ignored", options: map[string]string{p + "review_enabled": "true", p + "review_words": "knife", p + "window_chars": "1", p + "max_windows": "x"}},
		{name: "risk thresholds must increase", options: map[string]string{p + "risk_watch_threshold": "50", p + "risk_restrict_threshold": "50"}, wantErr: "must increase"},
		{name: "block threshold above restrict", options: map[string]string{p + "risk_restrict_threshold": "100", p + "risk_block_threshold": "100"}, wantErr: "must increase"},
		{name: "half-life above a year", options: map[string]string{p + "risk_half_life_hours": "8761"}, wantErr: "risk_half_life_hours"},
		{name: "known zero-tolerance categories", options: map[string]string{p + "risk_zero_tolerance_categories": "sexual_minors\n terrorism \n"}},
		{name: "unknown zero-tolerance category", options: map[string]string{p + "risk_zero_tolerance_categories": "sexual_minors\nspam"}, wantErr: "unknown category: spam"},
		{name: "non-boolean notice switch", options: map[string]string{p + "risk_notify_enabled": "on"}, wantErr: "risk_notify_enabled"},
		{name: "the qwen3guard engine", options: with(p+"review_engine", "qwen3guard")},
		{name: "unknown engine", options: with(p+"review_engine", "llama_guard"), wantErr: "review_engine"},
		{name: "blank engine", options: map[string]string{p + "review_engine": ""}, wantErr: "review_engine"},
		{name: "escalation with a group", options: map[string]string{p + "review_mode": "enforce", p + "review_model": "judge", p + "review_group": "default", p + "escalate_model": "judge-2", p + "escalate_group": "default"}},
		{name: "escalation without a group", options: with(p+"escalate_model", "judge-2"), wantErr: "escalate_group"},
		{name: "escalation without a group while review is off", options: map[string]string{p + "escalate_model": "judge-2", p + "escalate_group": " "}, wantErr: "escalate_group"},
		{name: "an escalation group without a model is unused", options: with(p+"escalate_group", "default")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := BuildRequestPolicy(tc.options)
			if tc.wantErr != "" {
				assert.ErrorContains(t, err, tc.wantErr)
				return
			}
			assert.NoError(t, err)
		})
	}
}

func TestUpdateRequestPolicyOptionsRejectsMissingReviewGroup(t *testing.T) {
	previousGroups := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`))
	previousSnapshot := requestPolicySnapshot.Load()
	snapshot, err := BuildRequestPolicy(nil)
	require.NoError(t, err)
	requestPolicySnapshot.Store(snapshot)
	t.Cleanup(func() {
		requestPolicySnapshot.Store(previousSnapshot)
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousGroups))
	})

	const p = operation_setting.ContentSafetyOptionPrefix
	for _, mode := range []string{"shadow", "enforce"} {
		err := UpdateRequestPolicyOptions(map[string]string{
			p + "review_mode": mode, p + "review_model": "judge", p + "review_group": "no-such-group",
		})
		assert.ErrorContains(t, err, "does not exist")
		assert.Same(t, snapshot, CurrentRequestPolicy())
	}
	err = UpdateOptionsBulk(map[string]string{
		p + "review_mode": "enforce", p + "review_model": "judge", p + "review_group": "no-such-group",
	})
	assert.ErrorContains(t, err, "does not exist")
	assert.Same(t, snapshot, CurrentRequestPolicy())

	escalation := map[string]string{
		p + "review_mode": "enforce", p + "review_model": "judge", p + "review_group": "default",
		p + "escalate_model": "judge-2", p + "escalate_group": "no-such-group",
	}
	assert.ErrorContains(t, UpdateRequestPolicyOptions(escalation), `escalation group "no-such-group" does not exist`)
	assert.ErrorContains(t, UpdateOptionsBulk(escalation), `escalation group "no-such-group" does not exist`)
	assert.Same(t, snapshot, CurrentRequestPolicy())
}

func TestContentSafetySettingBounded(t *testing.T) {
	setting := operation_setting.ContentSafetySetting{
		ReviewMode: "on", ReviewModel: " judge ", ReviewGroup: " default ",
		ReviewTimeoutSeconds: -1, ReviewMaxConcurrency: 0, ReviewRateLimitPerMinute: 99999,
		UnitChars: 10, MaxUnits: 1000, AsyncWorkers: 0, AsyncQueueSize: 1, AsyncRatePerMinute: 0,
		PassLogPercent: 101, ReviewSamplePercent: 0, SyncNewUserDays: -1, CacheTTLSeconds: -5, LogRetentionDays: 0,
		RiskHalfLifeHours: 0, RiskPointsUnsafe: 5000, RiskPointsControversial: -1, RiskWatchThreshold: 0,
		RiskRestrictThreshold: 200000, RiskBlockThreshold: 0, RiskRestrictRPM: 0,
		ReviewEngine: "llama_guard", EscalateModel: " judge-2 ", EscalateGroup: " vip ",
	}
	bounded := setting.Bounded()
	assert.Equal(t, operation_setting.ContentSafetySetting{
		ReviewMode: "off", ReviewModel: "judge", ReviewGroup: "default",
		ReviewTimeoutSeconds: 1, ReviewMaxConcurrency: 1, ReviewRateLimitPerMinute: 10000,
		UnitChars: 200, MaxUnits: 100, AsyncWorkers: 1, AsyncQueueSize: 10, AsyncRatePerMinute: 1,
		PassLogPercent: 100, ReviewSamplePercent: 1, SyncNewUserDays: 0, CacheTTLSeconds: 0, LogRetentionDays: 1,
		RiskHalfLifeHours: 1, RiskPointsUnsafe: 1000, RiskPointsControversial: 0, RiskWatchThreshold: 1,
		RiskRestrictThreshold: 100000, RiskBlockThreshold: 1, RiskRestrictRPM: 1,
		ReviewEngine: "llm_json", EscalateModel: "judge-2", EscalateGroup: "vip",
	}, bounded)
	assert.Equal(t, -1, setting.ReviewTimeoutSeconds)
}
