package model

import (
	"context"
	"slices"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// Decisions. review_rejected is an unsafe verdict that stopped the request;
// review_flagged is an unsafe verdict on a request that went on, because it
// was reviewed in the background or in shadow mode.
const (
	ContentSafetyDecisionKeywordBlocked      = "keyword_blocked"
	ContentSafetyDecisionReviewPassed        = "review_passed"
	ContentSafetyDecisionReviewControversial = "review_controversial"
	ContentSafetyDecisionReviewFlagged       = "review_flagged"
	ContentSafetyDecisionReviewRejected      = "review_rejected"
	ContentSafetyDecisionReviewFailed        = "review_failed"

	ContentSafetyFailureTimeout        = "timeout"
	ContentSafetyFailureNoChannel      = "no_channel"
	ContentSafetyFailureUnparseable    = "unparseable"
	ContentSafetyFailureRefused        = "refused"
	ContentSafetyFailureTooManyUnits   = "too_many_units"
	ContentSafetyFailureRateLimited    = "rate_limited"
	ContentSafetyFailureQueueFull      = "queue_full"
	ContentSafetyFailureUpstreamError  = "upstream_error"
	ContentSafetyFailureClientCanceled = "client_canceled"

	// Modes say when a review ran: before the request went upstream (sync),
	// in the background with actions (async) or in the background without
	// them (shadow).
	ContentSafetyModeSync   = "sync"
	ContentSafetyModeAsync  = "async"
	ContentSafetyModeShadow = "shadow"
)

const (
	contentSafetyDeleteBatch = 1000
	// contentSafetyStatsLatencyRows bounds the reviews read for latency
	// percentiles.
	contentSafetyStatsLatencyRows = 5000
)

var contentSafetyDecisions = []string{
	ContentSafetyDecisionKeywordBlocked,
	ContentSafetyDecisionReviewPassed,
	ContentSafetyDecisionReviewControversial,
	ContentSafetyDecisionReviewFlagged,
	ContentSafetyDecisionReviewRejected,
	ContentSafetyDecisionReviewFailed,
}

// ContentSafetyLog records one keyword block or AI review of request content.
// HitWords and Snippets are JSON string arrays; snippets keep only short
// excerpts around hits, never the whole request. Weight is how many reviews
// the row stands for: passed reviews are sampled, and each kept one counts
// for the ones left out.
type ContentSafetyLog struct {
	Id              int    `json:"id"`
	EventId         string `json:"event_id" gorm:"type:varchar(64);uniqueIndex;index:idx_csl_time_event,priority:2;index:idx_csl_user_time,priority:3;index:idx_csl_decision_time,priority:3"`
	CreatedAt       int64  `json:"created_at" gorm:"type:bigint;index:idx_csl_time_event,priority:1;index:idx_csl_user_time,priority:2;index:idx_csl_decision_time,priority:2"`
	RequestId       string `json:"request_id" gorm:"type:varchar(64);index"`
	UserId          int    `json:"user_id" gorm:"index:idx_csl_user_time,priority:1"`
	Username        string `json:"username" gorm:"type:varchar(64)"`
	TokenId         int    `json:"token_id"`
	TokenName       string `json:"token_name" gorm:"type:varchar(128)"`
	UsingGroup      string `json:"group" gorm:"column:using_group;type:varchar(64)"`
	Model           string `json:"model" gorm:"type:varchar(255);index"`
	RequestPath     string `json:"request_path" gorm:"type:varchar(255)"`
	Decision        string `json:"decision" gorm:"type:varchar(32);index:idx_csl_decision_time,priority:1"`
	FailureReason   string `json:"failure_reason" gorm:"type:varchar(32)"`
	HitWords        string `json:"hit_words" gorm:"type:text"`
	Snippets        string `json:"snippets" gorm:"type:text"`
	AiCategory      string `json:"ai_category" gorm:"type:varchar(64)"`
	AiReason        string `json:"ai_reason" gorm:"type:text"`
	ReviewChannelId int    `json:"review_channel_id"`
	ReviewModel     string `json:"review_model" gorm:"type:varchar(128)"`
	LatencyMs       int    `json:"latency_ms"`
	ReviewTokens    int    `json:"review_tokens"`
	CacheHit        bool   `json:"cache_hit"`
	Mode            string `json:"mode" gorm:"type:varchar(16)"`
	UnitCount       int    `json:"unit_count"`
	Truncated       bool   `json:"truncated"`
	Weight          int    `json:"weight"`
}

type ContentSafetyLogFilter struct {
	UserId         int
	RequestId      string
	Decision       string
	Model          string
	StartTimestamp int64
	EndTimestamp   int64
}

func ValidContentSafetyDecision(decision string) bool {
	return decision == "" || slices.Contains(contentSafetyDecisions, decision)
}

// RecordContentSafetyLog stores one decision. A failed write is only logged
// because the decision has already been enforced.
func RecordContentSafetyLog(entry ContentSafetyLog) {
	if entry.CreatedAt == 0 {
		entry.CreatedAt = common.GetTimestamp()
	}
	if entry.EventId == "" {
		entry.EventId = common.NewRequestId()
	}
	entry.Weight = max(entry.Weight, 1)
	// MySQL strict mode and PostgreSQL reject over-long values, which would lose the record.
	for _, field := range []struct {
		value *string
		width int
	}{
		{&entry.EventId, 64}, {&entry.RequestId, 64}, {&entry.Username, 64}, {&entry.TokenName, 128},
		{&entry.UsingGroup, 64}, {&entry.Model, 255}, {&entry.RequestPath, 255}, {&entry.Decision, 32},
		{&entry.FailureReason, 32}, {&entry.AiCategory, 64}, {&entry.ReviewModel, 128}, {&entry.Mode, 16},
	} {
		if runes := []rune(*field.value); len(runes) > field.width {
			*field.value = string(runes[:field.width])
		}
	}
	if LOG_DB == nil {
		common.SysError(common.LogText("content safety log write failed (request_id=%s): log database unavailable", entry.RequestId))
		return
	}
	if err := LOG_DB.Create(&entry).Error; err != nil {
		common.SysError(common.LogText("content safety log write failed (request_id=%s): %v", entry.RequestId, err))
	}
}

// GetContentSafetyLogs pages matching records. A viewer below root never sees
// records of root users, like GetAuditLogs.
func GetContentSafetyLogs(filter ContentSafetyLogFilter, start, limit int, viewerRole int) ([]*ContentSafetyLog, int64, error) {
	start = max(start, 0)
	limit = min(max(limit, 1), 100)
	query, err := contentSafetyLogsVisibleTo(viewerRole)
	if err != nil {
		return nil, 0, err
	}
	if filter.RequestId != "" {
		query = query.Where("request_id = ?", filter.RequestId)
	}
	if filter.UserId > 0 {
		query = query.Where("user_id = ?", filter.UserId)
	}
	if filter.Decision != "" {
		query = query.Where("decision = ?", filter.Decision)
	}
	if filter.Model != "" {
		query = query.Where("model = ?", filter.Model)
	}
	if filter.StartTimestamp > 0 {
		query = query.Where("created_at >= ?", filter.StartTimestamp)
	}
	if filter.EndTimestamp > 0 {
		query = query.Where("created_at <= ?", filter.EndTimestamp)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	logs := make([]*ContentSafetyLog, 0)
	if err := query.Order("created_at DESC").Order("event_id DESC").Offset(start).Limit(limit).Find(&logs).Error; err != nil {
		return nil, 0, err
	}
	return logs, total, nil
}

// contentSafetyLogsVisibleTo starts a query over the records a viewer may
// read: below root, never those of root users.
func contentSafetyLogsVisibleTo(viewerRole int) (*gorm.DB, error) {
	query := LOG_DB.Model(&ContentSafetyLog{})
	if viewerRole >= common.RoleRootUser {
		return query, nil
	}
	var rootIds []int
	if err := DB.Unscoped().Model(&User{}).Where("role >= ?", common.RoleRootUser).Pluck("id", &rootIds).Error; err != nil {
		return nil, err
	}
	// An empty slice would render as NOT IN (NULL) and match nothing.
	if len(rootIds) > 0 {
		query = query.Where("user_id NOT IN ?", rootIds)
	}
	return query, nil
}

// ContentSafetyStatsCount is the number of checks with one outcome. Sampled
// passed reviews count with their weight. CacheHit tells verdicts the cache
// decided from reviews that asked the reviewer.
type ContentSafetyStatsCount struct {
	Decision      string `json:"decision"`
	Mode          string `json:"mode"`
	FailureReason string `json:"failure_reason"`
	CacheHit      bool   `json:"cache_hit"`
	Total         int64  `json:"total"`
}

// ContentSafetyStats sums the checks since a time, so an administrator can
// judge a reviewer before enforcing it. Latency covers the reviews that asked
// the reviewer, the most recent contentSafetyStatsLatencyRows of them, each
// counted with its sampling weight.
type ContentSafetyStats struct {
	Counts         []ContentSafetyStatsCount `json:"counts"`
	LatencyP50Ms   int                       `json:"latency_p50_ms"`
	LatencyP95Ms   int                       `json:"latency_p95_ms"`
	LatencySamples int                       `json:"latency_samples"`
}

func GetContentSafetyStats(since int64, viewerRole int) (*ContentSafetyStats, error) {
	stats := &ContentSafetyStats{Counts: make([]ContentSafetyStatsCount, 0)}
	counts, err := contentSafetyLogsVisibleTo(viewerRole)
	if err != nil {
		return nil, err
	}
	err = counts.Where("created_at >= ?", since).
		Select("decision, mode, failure_reason, cache_hit, SUM(CASE WHEN weight > 0 THEN weight ELSE 1 END) AS total").
		Group("decision, mode, failure_reason, cache_hit").
		Scan(&stats.Counts).Error
	if err != nil {
		return nil, err
	}
	latencies, err := contentSafetyLogsVisibleTo(viewerRole)
	if err != nil {
		return nil, err
	}
	type latencySample struct {
		LatencyMs int
		Weight    int
	}
	var samples []latencySample
	err = latencies.Where("created_at >= ? AND latency_ms > 0", since).
		Order("created_at DESC").Limit(contentSafetyStatsLatencyRows).
		Select("latency_ms, weight").Scan(&samples).Error
	if err != nil {
		return nil, err
	}
	if len(samples) == 0 {
		return stats, nil
	}
	slices.SortFunc(samples, func(a, b latencySample) int { return a.LatencyMs - b.LatencyMs })
	total := 0
	for i := range samples {
		samples[i].Weight = max(samples[i].Weight, 1)
		total += samples[i].Weight
	}
	// A percentile is the first latency at which the summed weights reach
	// that share of all weights.
	stats.LatencySamples = len(samples)
	seen := 0
	for _, sample := range samples {
		seen += sample.Weight
		if stats.LatencyP50Ms == 0 && seen*100 >= total*50 {
			stats.LatencyP50Ms = sample.LatencyMs
		}
		if seen*100 >= total*95 {
			stats.LatencyP95Ms = sample.LatencyMs
			break
		}
	}
	return stats, nil
}

// DeleteContentSafetyLogsBefore removes records older than cutoff. ClickHouse
// deletes in one synchronous mutation, like DeleteOldLogBatch.
func DeleteContentSafetyLogsBefore(ctx context.Context, cutoff int64) (int64, error) {
	if !common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		var deleted int64
		for {
			var ids []int
			if err := LOG_DB.WithContext(ctx).Model(&ContentSafetyLog{}).Where("created_at < ?", cutoff).Order("created_at").Limit(contentSafetyDeleteBatch).Pluck("id", &ids).Error; err != nil {
				return deleted, err
			}
			if len(ids) == 0 {
				return deleted, nil
			}
			result := LOG_DB.WithContext(ctx).Where("id IN ?", ids).Delete(&ContentSafetyLog{})
			deleted += result.RowsAffected
			if result.Error != nil {
				return deleted, result.Error
			}
			if err := ctx.Err(); err != nil {
				return deleted, err
			}
		}
	}
	var total int64
	if err := LOG_DB.WithContext(ctx).Model(&ContentSafetyLog{}).Where("created_at < ?", cutoff).Count(&total).Error; err != nil {
		return 0, err
	}
	if total == 0 {
		return 0, nil
	}
	if err := LOG_DB.WithContext(ctx).Exec("ALTER TABLE content_safety_logs DELETE WHERE created_at < ? SETTINGS mutations_sync = 1", cutoff).Error; err != nil {
		return 0, err
	}
	return total, nil
}

// MigrateContentSafetyLogs also supports an independently configured ClickHouse log store.
func MigrateContentSafetyLogs() error {
	if !common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		return LOG_DB.AutoMigrate(&ContentSafetyLog{})
	}
	if err := LOG_DB.Exec(`CREATE TABLE IF NOT EXISTS content_safety_logs (
		id Int64 DEFAULT 0, event_id String, created_at Int64, request_id String, user_id Int64,
		username String, token_id Int64, token_name String, using_group String, model String,
		request_path String, decision String, failure_reason String, hit_words String, snippets String,
		ai_category String, ai_reason String, review_channel_id Int64, review_model String,
		latency_ms Int64, review_tokens Int64, cache_hit UInt8,
		mode String, unit_count Int64, truncated UInt8, weight Int64 DEFAULT 1
	) ENGINE = MergeTree()
	PARTITION BY toYYYYMM(toDateTime(created_at))
	ORDER BY (created_at, event_id)`).Error; err != nil {
		return err
	}
	// Tables created before these columns get them; IF NOT EXISTS makes a
	// second start a no-op.
	for _, column := range []string{"mode String", "unit_count Int64", "truncated UInt8", "weight Int64 DEFAULT 1"} {
		if err := LOG_DB.Exec("ALTER TABLE content_safety_logs ADD COLUMN IF NOT EXISTS " + column).Error; err != nil {
			return err
		}
	}
	return nil
}
