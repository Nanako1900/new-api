package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"maps"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func cacheSubsidyLog(t *testing.T, modelName string, quota int, promptTokens int, other map[string]any) *model.Log {
	t.Helper()
	data, err := common.Marshal(other)
	require.NoError(t, err)
	return &model.Log{
		Type:         model.LogTypeConsume,
		ModelName:    modelName,
		Quota:        quota,
		PromptTokens: promptTokens,
		Other:        string(data),
	}
}

func tieredOther(expr string, tier string, extra map[string]any) map[string]any {
	other := map[string]any{
		"billing_mode":   "tiered_expr",
		"billing_source": "wallet",
		"expr_b64":       base64.StdEncoding.EncodeToString([]byte(expr)),
		"matched_tier":   tier,
		"group_ratio":    1.0,
		"model_price":    0.0,
		"model_ratio":    0.0,
		"cache_ratio":    0.0,
	}
	maps.Copy(other, extra)
	return other
}

func TestComputeCacheSubsidyLogCost(t *testing.T) {
	defaultRules := CacheSubsidyRules{ModelRules: []string{"claude*", "gpt*"}, IncludeCacheWrites: true}
	readsOnly := CacheSubsidyRules{ModelRules: []string{"claude*", "gpt*"}}
	claudeLegacy := map[string]any{
		"billing_source":           "wallet",
		"usage_semantic":           "anthropic",
		"model_price":              -1.0,
		"model_ratio":              1.5,
		"group_ratio":              0.8,
		"user_group_ratio":         -1.0,
		"cache_tokens":             1000,
		"cache_ratio":              0.1,
		"cache_creation_tokens":    2000,
		"cache_creation_ratio":     1.25,
		"cache_creation_tokens_5m": 1500,
		"cache_creation_ratio_5m":  1.25,
		"cache_creation_tokens_1h": 500,
		"cache_creation_ratio_1h":  2.0,
	}
	const gptAstra = `len <= 272000 ? tier("standard", p * 10 + c * 50 + cr * 1 + cc * 12.5 + cc12h * 25) : tier("long_context", p * 20 + c * 75 + cr * 2 + cc * 25 + cc12h * 50)`

	for _, tc := range []struct {
		name        string
		log         *model.Log
		rules       CacheSubsidyRules
		quota       string
		readTokens  int64
		writeTokens int64
		skip        string
	}{
		{
			name:        "legacy claude counts reads and 5m/1h writes at their ratios",
			log:         cacheSubsidyLog(t, "claude-sonnet-4-5", 1_000_000, 300, claudeLegacy),
			rules:       defaultRules,
			quota:       "3570", // (1000*0.1 + 1500*1.25 + 500*2) * 1.5 * 0.8
			readTokens:  1000,
			writeTokens: 2000,
		},
		{
			name:       "legacy claude without writes",
			log:        cacheSubsidyLog(t, "claude-sonnet-4-5", 1_000_000, 300, claudeLegacy),
			rules:      readsOnly,
			quota:      "120",
			readTokens: 1000,
		},
		{
			name:        "cache cost is capped at what the log charged",
			log:         cacheSubsidyLog(t, "Claude-Opus-4", 1000, 300, claudeLegacy),
			rules:       defaultRules,
			quota:       "1000",
			readTokens:  1000,
			writeTokens: 2000,
		},
		{
			name: "legacy openai splits 12h writes",
			log: cacheSubsidyLog(t, "gpt-5.2", 1_000_000, 10000, map[string]any{
				"billing_source":            "wallet",
				"model_price":               -1.0,
				"model_ratio":               1.25,
				"group_ratio":               1.0,
				"cache_tokens":              4000,
				"cache_ratio":               0.1,
				"cache_creation_tokens":     1000,
				"cache_creation_ratio":      1.25,
				"cache_creation_tokens_12h": 400,
				"cache_creation_ratio_12h":  2.0,
			}),
			rules:       defaultRules,
			quota:       "2437.5", // (4000*0.1 + 600*1.25 + 400*2) * 1.25
			readTokens:  4000,
			writeTokens: 1000,
		},
		{
			name: "tiered openai prices reads and writes of the matched tier",
			log: cacheSubsidyLog(t, "gpt-6-astra", 1_000_000, 10000, tieredOther(gptAstra, "standard", map[string]any{
				"group_ratio":               0.5,
				"cache_tokens":              6000,
				"cache_creation_tokens":     1000,
				"cache_creation_tokens_12h": 200,
			})),
			rules:       defaultRules,
			quota:       "5250", // (6000*1 + 800*12.5 + 200*25) / 1e6 * 500000 * 0.5
			readTokens:  6000,
			writeTokens: 1000,
		},
		{
			name: "tiered long context tier uses its own prices",
			log: cacheSubsidyLog(t, "gpt-6-astra", 3_000_000, 300000, tieredOther(gptAstra, "long_context", map[string]any{
				"cache_tokens": 1000,
			})),
			rules:      defaultRules,
			quota:      "1000", // 1000*2 / 1e6 * 500000
			readTokens: 1000,
		},
		{
			name: "tiered claude without a cache price bills reads at the input price",
			log: cacheSubsidyLog(t, "claude-haiku-4-5", 1_000_000, 2000, tieredOther(`tier("base", p * 3 + c * 15)`, "base", map[string]any{
				"usage_semantic": "anthropic",
				"cache_tokens":   10000,
			})),
			rules:      defaultRules,
			quota:      "15000",
			readTokens: 10000,
		},
		{
			name: "tiered claude 1h writes without a price follow the cc multiple",
			log: cacheSubsidyLog(t, "claude-haiku-4-5", 1_000_000, 2000, tieredOther(`tier("base", p * 3 + c * 15 + cr * 0.3 + cc * 3.75)`, "base", map[string]any{
				"usage_semantic":           "anthropic",
				"group_ratio":              0.5,
				"cache_creation_tokens":    1000,
				"cache_creation_tokens_5m": 600,
				"cache_creation_tokens_1h": 400,
			})),
			rules:       defaultRules,
			quota:       "1162.5", // (600 + 400*6/3.75) * 3.75 / 1e6 * 500000 * 0.5
			writeTokens: 1000,
		},
		{
			name: "tiered matched request rules scale the cache price",
			log: cacheSubsidyLog(t, "gpt-5.2", 1_000_000, 2000, tieredOther(`tier("base", p * 2 + cr * 0.2) * (param("service_tier") == "flex" ? 0.5 : 1)`, "base", map[string]any{
				"cache_tokens":  1000,
				"request_rules": []map[string]any{{"cond": `param("service_tier") == "flex"`, "multiplier": 0.5, "matched": true}},
			})),
			rules:      defaultRules,
			quota:      "50",
			readTokens: 1000,
		},
		{
			name: "tiered image cache uses the logged billing tokens",
			log: cacheSubsidyLog(t, "gpt-image-2", 1_000_000, 900, tieredOther(`tier("standard", p * 5 + cr * 1.25 + img * 8 + img_cr * 2 + c * 30)`, "standard", map[string]any{
				"cache_tokens":   150,
				"billing_tokens": map[string]float64{"p": 300, "cr": 100, "img_cr": 50},
			})),
			rules:      defaultRules,
			quota:      "112.5",
			readTokens: 150,
		},
		{
			name: "tiered time windows that pick the tier need no rule trace",
			log: cacheSubsidyLog(t, "gpt-deepseek-compatible", 1_000_000, 2000, tieredOther(`weekday("Asia/Shanghai") >= 1 && hour("Asia/Shanghai") >= 9 ? tier("peak", p * 1.32 + cr * 0.044 + c * 3.96) : tier("off_peak", p * 0.66 + cr * 0.022 + c * 1.98)`, "off_peak", map[string]any{
				"cache_tokens": 1000,
			})),
			rules:      defaultRules,
			quota:      "11", // 1000*0.022 / 1e6 * 500000
			readTokens: 1000,
		},
		{
			name: "tiered log charged less than its rebuilt cost was billed by something unlogged",
			log: cacheSubsidyLog(t, "gpt-6-astra", 2000, 10000, tieredOther(gptAstra, "standard", map[string]any{
				"cache_tokens": 6000,
			})),
			rules: defaultRules,
			skip:  CacheSubsidySkipUnsupported,
		},
		{
			name: "channel tests are not charged to the wallet",
			log: func() *model.Log {
				log := cacheSubsidyLog(t, "claude-sonnet-4-5", 1_000_000, 300, claudeLegacy)
				log.TokenName = "Model test"
				return log
			}(),
			rules: defaultRules,
			skip:  CacheSubsidySkipChannelTest,
		},
		{
			name: "reads another tier prices are free in a tier without a cr price",
			log: cacheSubsidyLog(t, "gpt-image-2", 1_000_000, 900, tieredOther(`len > 1000 ? tier("long", p * 5 + img * 8 + img_cr * 2 + c * 30) : tier("short", p * 5 + cr * 1.25 + img * 8 + img_cr * 2 + c * 30)`, "long", map[string]any{
				"cache_tokens":   150,
				"billing_tokens": map[string]float64{"p": 300, "cr": 100, "img_cr": 50},
			})),
			rules:      defaultRules,
			quota:      "50", // only img_cr: 50*2 / 1e6 * 500000; settlement charged the reads 0
			readTokens: 150,
		},
		{
			name: "tiered rules without a logged trace are unsupported",
			log: cacheSubsidyLog(t, "gpt-5.2", 1_000_000, 2000, tieredOther(`tier("base", p * 2 + cr * 0.2) * (param("service_tier") == "flex" ? 0.5 : 1)`, "base", map[string]any{
				"cache_tokens": 1000,
			})),
			rules: defaultRules,
			skip:  CacheSubsidySkipUnsupported,
		},
		{
			name: "tiered per-request price has no cache part",
			log: cacheSubsidyLog(t, "gpt-5.2", 1_000_000, 2000, tieredOther(`tier("base", fixed(0.01))`, "base", map[string]any{
				"cache_tokens": 1000,
				"billing_unit": "request",
			})),
			rules: defaultRules,
			skip:  CacheSubsidySkipPerRequest,
		},
		{
			name: "legacy per-request price has no cache part",
			log: cacheSubsidyLog(t, "gpt-5.2", 1_000_000, 2000, map[string]any{
				"billing_source": "wallet", "model_price": 0.05, "group_ratio": 1.0, "cache_tokens": 1000, "cache_ratio": 0.1,
			}),
			rules: defaultRules,
			skip:  CacheSubsidySkipPerRequest,
		},
		{
			name:  "subscription usage is not subsidised",
			log:   cacheSubsidyLog(t, "claude-sonnet-4-5", 1_000_000, 300, map[string]any{"billing_source": "subscription", "cache_tokens": 1000}),
			rules: defaultRules,
			skip:  CacheSubsidySkipSubscription,
		},
		{
			name:  "other models are not subsidised",
			log:   cacheSubsidyLog(t, "gemini-3-pro", 1_000_000, 300, claudeLegacy),
			rules: defaultRules,
			skip:  CacheSubsidySkipModel,
		},
		{
			name: "writes alone do not count when the campaign excludes them",
			log: cacheSubsidyLog(t, "claude-sonnet-4-5", 1_000_000, 300, map[string]any{
				"billing_source": "wallet", "model_price": -1.0, "model_ratio": 1.5, "group_ratio": 1.0,
				"cache_creation_tokens": 2000, "cache_creation_ratio": 1.25,
			}),
			rules: readsOnly,
			skip:  CacheSubsidySkipNoCache,
		},
		{
			name:  "free requests have nothing to refund",
			log:   cacheSubsidyLog(t, "claude-sonnet-4-5", 0, 300, claudeLegacy),
			rules: defaultRules,
			skip:  CacheSubsidySkipNoCache,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cost, skip := ComputeCacheSubsidyLogCost(tc.log, tc.rules)
			require.Equal(t, tc.skip, skip)
			if tc.skip != "" {
				return
			}
			assert.Equal(t, tc.quota, cost.CacheQuota.String())
			assert.Equal(t, tc.readTokens, cost.ReadTokens)
			assert.Equal(t, tc.writeTokens, cost.WriteTokens)
		})
	}
}

func TestMatchCacheSubsidyModel(t *testing.T) {
	for _, tc := range []struct {
		rules []string
		model string
		want  bool
	}{
		{[]string{"claude*"}, "claude-sonnet-4-5", true},
		{[]string{"gpt*"}, "chatgpt-4o-latest", false},
		{[]string{"*gpt*"}, "chatgpt-4o-latest", true},
		{[]string{"gpt-5*codex"}, "gpt-5.2-codex", true},
		{[]string{"gpt-5*codex"}, "gpt-5.2-codex-mini", false},
		{[]string{" GPT-4O "}, "gpt-4o", true},
		{[]string{"claude*", "o3*"}, "o4-mini", false},
		{nil, "claude-sonnet-4-5", false},
	} {
		assert.Equal(t, tc.want, MatchCacheSubsidyModel(tc.rules, tc.model), "%v %s", tc.rules, tc.model)
	}
}

func setupCacheSubsidy(t *testing.T) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(&model.CacheSubsidyCampaign{}, &model.CacheSubsidyGrant{}))
	saved := cacheSubsidyScanBatchSize
	cacheSubsidyScanBatchSize = 2
	t.Cleanup(func() {
		cacheSubsidyScanBatchSize = saved
		model.DB.Exec("DELETE FROM cache_subsidy_campaigns")
		model.DB.Exec("DELETE FROM cache_subsidy_grants")
		model.DB.Exec("DELETE FROM logs")
		model.DB.Exec("DELETE FROM users")
	})
}

// seedCacheSubsidyLogs writes consume logs for three users around a window
// of [1000, 2000): user 1 has two Claude logs in the same second, user 2 a
// GPT log, user 3 a tiny one, plus logs every campaign must skip.
func seedCacheSubsidyLogs(t *testing.T) {
	t.Helper()
	legacy := func(cacheTokens int) map[string]any {
		return map[string]any{
			"billing_source": "wallet", "model_price": -1.0, "model_ratio": 1.0, "group_ratio": 1.0,
			"cache_tokens": cacheTokens, "cache_ratio": 0.5,
		}
	}
	for _, seed := range []struct {
		userId    int
		createdAt int64
		modelName string
		other     map[string]any
	}{
		{1, 999, "claude-sonnet-4-5", legacy(4000)},  // before the window
		{1, 1500, "claude-sonnet-4-5", legacy(4000)}, // 2000 quota
		{1, 1500, "claude-sonnet-4-5", legacy(2000)}, // 1000 quota, same second
		{2, 1600, "gpt-5.2", legacy(800)},            // 400 quota
		{3, 1700, "gpt-5.2", legacy(1)},              // 0.5 quota rounds to 1, subsidy floors to 0
		{2, 1800, "gemini-3-pro", legacy(8000)},
		{2, 1900, "gpt-5.2", map[string]any{"billing_source": "subscription", "cache_tokens": 1000}},
		{1, 2000, "claude-sonnet-4-5", legacy(4000)}, // window end is exclusive
	} {
		log := cacheSubsidyLog(t, seed.modelName, 1_000_000, 100, seed.other)
		log.UserId = seed.userId
		log.Username = "user" + string(rune('0'+seed.userId))
		log.CreatedAt = seed.createdAt
		require.NoError(t, model.LOG_DB.Create(log).Error)
	}
}

func newCacheSubsidyCampaign(t *testing.T) *model.CacheSubsidyCampaign {
	t.Helper()
	campaign, err := model.CreateCacheSubsidyCampaign(model.CacheSubsidyCampaignInput{
		Name:               "Cache refund",
		WindowStart:        1000,
		WindowEnd:          2000,
		ModelRules:         []string{"claude*", "gpt*"},
		IncludeCacheWrites: true,
		SubsidyPercent:     75,
		ClaimDeadline:      common.GetTimestamp() + 3600,
	})
	require.NoError(t, err)
	require.NoError(t, model.QueueCacheSubsidyCalculation(campaign.Id, common.GetTimestamp()))
	started, err := model.StartNextCacheSubsidyCalculation()
	require.NoError(t, err)
	require.Equal(t, campaign.Id, started.Id)
	return started
}

func cacheSubsidyGrants(t *testing.T, campaignId int) map[int]model.CacheSubsidyGrant {
	t.Helper()
	var grants []model.CacheSubsidyGrant
	require.NoError(t, model.DB.Where("campaign_id = ?", campaignId).Find(&grants).Error)
	byUser := map[int]model.CacheSubsidyGrant{}
	for _, grant := range grants {
		byUser[grant.UserId] = grant
	}
	return byUser
}

func TestCalculateCacheSubsidyCampaign(t *testing.T) {
	setupCacheSubsidy(t)
	seedCacheSubsidyLogs(t)
	campaign := newCacheSubsidyCampaign(t)

	require.NoError(t, CalculateCacheSubsidyCampaign(context.Background(), campaign, func(int) {}))

	stored, err := model.GetCacheSubsidyCampaign(campaign.Id)
	require.NoError(t, err)
	assert.Equal(t, model.CacheSubsidyStatusCalculated, stored.Status)
	assert.Equal(t, int64(6), stored.ScannedLogs)
	assert.Equal(t, int64(4), stored.MatchedLogs)
	assert.Equal(t, map[string]int64{CacheSubsidySkipModel: 1, CacheSubsidySkipSubscription: 1}, stored.ScanSkipReasons())
	assert.Equal(t, int64(2), stored.EligibleUsers)
	assert.Equal(t, int64(3400), stored.TotalCacheQuota)
	assert.Equal(t, int64(2250+300), stored.TotalSubsidyQuota)

	grants := cacheSubsidyGrants(t, campaign.Id)
	require.Len(t, grants, 3)
	assert.Equal(t, int64(2), grants[1].LogCount)
	assert.Equal(t, int64(6000), grants[1].CacheReadTokens)
	assert.Equal(t, int64(3000), grants[1].CacheQuota)
	assert.Equal(t, int64(2250), grants[1].SubsidyQuota)
	assert.Equal(t, int64(300), grants[2].SubsidyQuota)
	assert.Equal(t, int64(0), grants[3].SubsidyQuota)
}

func TestCacheSubsidyScanResumesWithoutDoubleCounting(t *testing.T) {
	setupCacheSubsidy(t)
	seedCacheSubsidyLogs(t)
	campaign := newCacheSubsidyCampaign(t)
	stale := *campaign

	// One batch lands, then the runner dies before the next one.
	ctx, cancel := context.WithCancel(context.Background())
	err := CalculateCacheSubsidyCampaign(ctx, campaign, func(int) { cancel() })
	require.ErrorIs(t, err, context.Canceled)

	// A runner still holding the pre-batch cursor cannot apply it again.
	err = model.ApplyCacheSubsidyScanBatch(&stale, model.CacheSubsidyScanBatch{
		CursorCreatedAt: 1500, CursorId: 99,
		Scanned: 1, Matched: 1,
		Grants: map[int]model.CacheSubsidyGrantDelta{1: {LogCount: 1, CacheQuota: 2000}},
	})
	require.ErrorIs(t, err, model.ErrCacheSubsidyScanConflict)

	resumed, err := model.StartNextCacheSubsidyCalculation()
	require.NoError(t, err)
	require.NoError(t, CalculateCacheSubsidyCampaign(context.Background(), resumed, func(int) {}))

	stored, err := model.GetCacheSubsidyCampaign(campaign.Id)
	require.NoError(t, err)
	assert.Equal(t, int64(6), stored.ScannedLogs)
	assert.Equal(t, int64(3400), stored.TotalCacheQuota)
	assert.Equal(t, int64(3000), cacheSubsidyGrants(t, campaign.Id)[1].CacheQuota)
}

func TestCacheSubsidyRecalculationStartsClean(t *testing.T) {
	setupCacheSubsidy(t)
	seedCacheSubsidyLogs(t)
	campaign := newCacheSubsidyCampaign(t)
	require.NoError(t, CalculateCacheSubsidyCampaign(context.Background(), campaign, func(int) {}))
	require.NoError(t, model.ResetCacheSubsidyCampaign(campaign.Id))
	assert.Empty(t, cacheSubsidyGrants(t, campaign.Id), "reset drops the grants with the status change")

	// A grant left behind by an interrupted earlier run must not be added to.
	require.NoError(t, model.DB.Create(&model.CacheSubsidyGrant{CampaignId: campaign.Id, UserId: 1, CacheQuota: 9999, Status: model.CacheSubsidyGrantPending}).Error)
	stale, err := model.GetCacheSubsidyCampaign(campaign.Id)
	require.NoError(t, err)
	stale.Status = model.CacheSubsidyStatusCalculating
	require.NoError(t, model.QueueCacheSubsidyCalculation(campaign.Id, common.GetTimestamp()))
	started, err := model.StartNextCacheSubsidyCalculation()
	require.NoError(t, err)

	// A runner from the previous calculation, at the same zero cursor, is fenced out.
	err = model.ApplyCacheSubsidyScanBatch(stale, model.CacheSubsidyScanBatch{
		CursorCreatedAt: 1500, CursorId: 1, Scanned: 1, Matched: 1,
		Grants: map[int]model.CacheSubsidyGrantDelta{1: {LogCount: 1, CacheQuota: 2000}},
	})
	require.ErrorIs(t, err, model.ErrCacheSubsidyScanConflict)

	require.NoError(t, CalculateCacheSubsidyCampaign(context.Background(), started, func(int) {}))

	// Its finalize cannot rewrite the new subsidies with its own percent either.
	stale.ScanCompletedAt = 1
	stale.SubsidyPercent = 10
	require.ErrorIs(t, model.FinalizeCacheSubsidyCampaign(stale), model.ErrCacheSubsidyScanConflict)

	grants := cacheSubsidyGrants(t, campaign.Id)
	assert.Equal(t, int64(3000), grants[1].CacheQuota)
	assert.Equal(t, int64(2250), grants[1].SubsidyQuota)
}

func TestClaimCacheSubsidy(t *testing.T) {
	setupCacheSubsidy(t)
	seedCacheSubsidyLogs(t)
	for id := 1; id <= 4; id++ {
		require.NoError(t, model.DB.Create(&model.User{Id: id, Username: "user" + string(rune('0'+id)), AffCode: "aff" + string(rune('0'+id)), Quota: 100, Status: common.UserStatusEnabled}).Error)
	}
	campaign := newCacheSubsidyCampaign(t)
	require.NoError(t, CalculateCacheSubsidyCampaign(context.Background(), campaign, func(int) {}))
	now := common.GetTimestamp()

	_, err := model.ClaimCacheSubsidy(campaign.Id, 1, now)
	require.ErrorIs(t, err, model.ErrCacheSubsidyUnavailable, "claims wait until the campaign opens")
	require.NoError(t, model.OpenCacheSubsidyCampaign(campaign.Id, now))

	items, err := model.ListUserCacheSubsidies(1, now)
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, int64(2250), items[0].Grant.SubsidyQuota)
	assert.Equal(t, model.CacheSubsidyGrantPending, items[0].Grant.Status)
	assert.True(t, model.HasOpenCacheSubsidy(now))

	results := make(chan error, 8)
	for range 8 {
		go func() {
			_, err := model.ClaimCacheSubsidy(campaign.Id, 1, now)
			results <- err
		}()
	}
	succeeded := 0
	for range 8 {
		err := <-results
		if err == nil {
			succeeded++
			continue
		}
		assert.ErrorIs(t, err, model.ErrCacheSubsidyClaimed)
	}
	assert.Equal(t, 1, succeeded)
	user, err := model.GetUserById(1, true)
	require.NoError(t, err)
	assert.Equal(t, 100+2250, user.Quota)

	for _, tc := range []struct {
		name   string
		userId int
		now    int64
		err    error
	}{
		{"below the minimum subsidy", 3, now, model.ErrCacheSubsidyUnavailable},
		{"no cache usage", 4, now, model.ErrCacheSubsidyUnavailable},
		{"after the claim deadline", 2, campaign.ClaimDeadline, model.ErrCacheSubsidyUnavailable},
	} {
		_, err := model.ClaimCacheSubsidy(campaign.Id, tc.userId, tc.now)
		assert.ErrorIs(t, err, tc.err, tc.name)
	}

	require.ErrorIs(t, model.DeleteCacheSubsidyCampaign(campaign.Id), model.ErrCacheSubsidyBadStatus)
	require.NoError(t, model.CloseCacheSubsidyCampaign(campaign.Id, now))
	_, err = model.ClaimCacheSubsidy(campaign.Id, 2, now)
	assert.ErrorIs(t, err, model.ErrCacheSubsidyUnavailable, "closed campaigns pay nothing")
	assert.ErrorIs(t, model.DeleteCacheSubsidyCampaign(campaign.Id), model.ErrCacheSubsidyBadStatus, "a campaign that opened stays as the payout record")
}

func TestCacheSubsidyCampaignLifecycle(t *testing.T) {
	setupCacheSubsidy(t)
	now := common.GetTimestamp()
	input := model.CacheSubsidyCampaignInput{
		Name: "Refund", WindowStart: now - 7200, WindowEnd: now - 60,
		ModelRules: []string{"claude*"}, SubsidyPercent: 75, ClaimDeadline: now + 3600,
	}
	invalid := input
	invalid.SubsidyPercent = 75.125
	_, err := model.CreateCacheSubsidyCampaign(invalid)
	require.ErrorIs(t, err, model.ErrCacheSubsidyInvalid)
	invalid = input
	invalid.PerUserCapQuota, invalid.MinSubsidyQuota = 100, 200
	_, err = model.CreateCacheSubsidyCampaign(invalid)
	require.ErrorIs(t, err, model.ErrCacheSubsidyInvalid, "a minimum above the cap would zero every grant")

	campaign, err := model.CreateCacheSubsidyCampaign(input)
	require.NoError(t, err)
	require.ErrorIs(t, model.QueueCacheSubsidyCalculation(campaign.Id, now), model.ErrCacheSubsidyWindowOpen)

	input.WindowEnd = now - model.CacheSubsidyWindowSettleSeconds
	_, err = model.UpdateCacheSubsidyCampaign(campaign.Id, input)
	require.NoError(t, err)
	require.NoError(t, model.QueueCacheSubsidyCalculation(campaign.Id, now))

	input.SubsidyPercent = 50
	_, err = model.UpdateCacheSubsidyCampaign(campaign.Id, input)
	require.ErrorIs(t, err, model.ErrCacheSubsidyRulesLocked)
	input.SubsidyPercent = 75
	input.Name = "Renamed"
	renamed, err := model.UpdateCacheSubsidyCampaign(campaign.Id, input)
	require.NoError(t, err)
	assert.Equal(t, "Renamed", renamed.Name)

	require.ErrorIs(t, model.OpenCacheSubsidyCampaign(campaign.Id, now), model.ErrCacheSubsidyBadStatus)
	require.NoError(t, model.ResetCacheSubsidyCampaign(campaign.Id))
	require.NoError(t, model.DeleteCacheSubsidyCampaign(campaign.Id))
	_, err = model.GetCacheSubsidyCampaign(campaign.Id)
	require.ErrorIs(t, err, model.ErrCacheSubsidyNotFound)
}

// TestCacheSubsidyMainDatabaseMatrix runs calculation and concurrent claims
// on the real MySQL and PostgreSQL servers named by TEST_MYSQL_DSN and
// TEST_POSTGRES_DSN, each in a fresh database migrated twice.
func TestCacheSubsidyMainDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := os.Getenv("TEST_" + strings.ToUpper(dialect) + "_DSN")
			if dsn == "" {
				t.Skipf("TEST_%s_DSN is not configured", strings.ToUpper(dialect))
			}
			name := fmt.Sprintf("cache_subsidy_%d", time.Now().UnixNano())
			var db *gorm.DB
			switch dialect {
			case "mysql":
				admin, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
				require.NoError(t, err)
				require.NoError(t, admin.Exec("CREATE DATABASE "+name+" CHARACTER SET utf8mb4").Error)
				t.Cleanup(func() { assert.NoError(t, admin.Exec("DROP DATABASE "+name).Error) })
				base, _, _ := strings.Cut(dsn, "?")
				db, err = gorm.Open(mysql.Open(base[:strings.LastIndex(base, "/")+1]+name+"?parseTime=true"), &gorm.Config{})
				require.NoError(t, err)
			case "postgres":
				admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
				require.NoError(t, err)
				require.NoError(t, admin.Exec("CREATE DATABASE "+name).Error)
				parsed, err := url.Parse(dsn)
				require.NoError(t, err)
				parsed.Path = "/" + name
				db, err = gorm.Open(postgres.New(postgres.Config{DSN: parsed.String(), PreferSimpleProtocol: true}), &gorm.Config{})
				require.NoError(t, err)
				t.Cleanup(func() {
					if sqlDB, err := db.DB(); err == nil {
						_ = sqlDB.Close()
					}
					assert.NoError(t, admin.Exec("DROP DATABASE "+name).Error)
				})
			}
			var version string
			require.NoError(t, db.Raw("SELECT version()").Scan(&version).Error)
			t.Logf("database version: %s", version)

			savedDB, savedLogDB := model.DB, model.LOG_DB
			model.DB, model.LOG_DB = db, db
			common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
			t.Cleanup(func() {
				model.DB, model.LOG_DB = savedDB, savedLogDB
				common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
			})
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.User{}, &model.Log{}, &model.CacheSubsidyCampaign{}, &model.CacheSubsidyGrant{}))
			}
			saved := cacheSubsidyScanBatchSize
			cacheSubsidyScanBatchSize = 2
			t.Cleanup(func() { cacheSubsidyScanBatchSize = saved })

			seedCacheSubsidyLogs(t)
			for id := 1; id <= 3; id++ {
				require.NoError(t, db.Create(&model.User{Id: id, Username: fmt.Sprintf("user%d", id), AffCode: fmt.Sprintf("aff%d", id), Quota: 100, Status: common.UserStatusEnabled}).Error)
			}
			campaign := newCacheSubsidyCampaign(t)
			require.NoError(t, CalculateCacheSubsidyCampaign(context.Background(), campaign, func(int) {}))
			stored, err := model.GetCacheSubsidyCampaign(campaign.Id)
			require.NoError(t, err)
			assert.Equal(t, int64(2), stored.EligibleUsers)
			assert.Equal(t, int64(2550), stored.TotalSubsidyQuota)

			now := common.GetTimestamp()
			require.NoError(t, model.OpenCacheSubsidyCampaign(campaign.Id, now))
			results := make(chan error, 6)
			for range 6 {
				go func() {
					_, err := model.ClaimCacheSubsidy(campaign.Id, 1, now)
					results <- err
				}()
			}
			succeeded := 0
			for range 6 {
				if err := <-results; err == nil {
					succeeded++
				} else {
					assert.ErrorIs(t, err, model.ErrCacheSubsidyClaimed)
				}
			}
			assert.Equal(t, 1, succeeded)
			var quota int
			require.NoError(t, db.Model(&model.User{}).Where("id = ?", 1).Pluck("quota", &quota).Error)
			assert.Equal(t, 100+2250, quota)

			grants, total, err := model.ListCacheSubsidyGrants(campaign.Id, "user", model.CacheSubsidyGrantClaimed, 0, 10)
			require.NoError(t, err)
			assert.Equal(t, int64(1), total)
			require.Len(t, grants, 1)
			views, err := model.CacheSubsidyCampaignViews([]*model.CacheSubsidyCampaign{stored})
			require.NoError(t, err)
			assert.Equal(t, int64(1), views[0].ClaimedUsers)
			assert.Equal(t, int64(2250), views[0].ClaimedQuota)
		})
	}
}
