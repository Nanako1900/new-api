package model

import (
	"context"
	"slices"

	"github.com/QuantumNous/new-api/common"
)

const (
	ContentSafetyDecisionKeywordBlocked = "keyword_blocked"
	ContentSafetyDecisionReviewPassed   = "review_passed"
	ContentSafetyDecisionReviewRejected = "review_rejected"
	ContentSafetyDecisionReviewFailed   = "review_failed"

	ContentSafetyFailureTimeout        = "timeout"
	ContentSafetyFailureNoChannel      = "no_channel"
	ContentSafetyFailureUnparseable    = "unparseable"
	ContentSafetyFailureTooManyWindows = "too_many_windows"
	ContentSafetyFailureRateLimited    = "rate_limited"
	ContentSafetyFailureUpstreamError  = "upstream_error"
)

var contentSafetyDecisions = []string{
	ContentSafetyDecisionKeywordBlocked,
	ContentSafetyDecisionReviewPassed,
	ContentSafetyDecisionReviewRejected,
	ContentSafetyDecisionReviewFailed,
}

// ContentSafetyLog records one keyword block or AI review of request content.
// HitWords and Snippets are JSON string arrays; snippets keep only short
// excerpts around hits, never the whole request.
type ContentSafetyLog struct {
	Id              int    `json:"id"`
	EventId         string `json:"event_id" gorm:"type:varchar(64);uniqueIndex"`
	CreatedAt       int64  `json:"created_at" gorm:"type:bigint;index;index:idx_csl_user_time,priority:2;index:idx_csl_decision_time,priority:2"`
	RequestId       string `json:"request_id" gorm:"type:varchar(64);index"`
	UserId          int    `json:"user_id" gorm:"index:idx_csl_user_time,priority:1"`
	Username        string `json:"username" gorm:"type:varchar(64)"`
	TokenId         int    `json:"token_id"`
	TokenName       string `json:"token_name" gorm:"type:varchar(128)"`
	UsingGroup      string `json:"group" gorm:"column:using_group;type:varchar(64)"`
	Model           string `json:"model" gorm:"type:varchar(128);index"`
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
}

type ContentSafetyLogFilter struct {
	UserId         int
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
	if LOG_DB == nil {
		common.SysError(common.LogText("content safety log write failed (request_id=%s): log database unavailable", entry.RequestId))
		return
	}
	if err := LOG_DB.Create(&entry).Error; err != nil {
		common.SysError(common.LogText("content safety log write failed (request_id=%s): %v", entry.RequestId, err))
	}
}

func GetContentSafetyLogs(filter ContentSafetyLogFilter, start, limit int) ([]*ContentSafetyLog, int64, error) {
	query := LOG_DB.Model(&ContentSafetyLog{})
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

// DeleteContentSafetyLogsBefore removes records older than cutoff. ClickHouse
// deletes in one synchronous mutation, like DeleteOldLogBatch.
func DeleteContentSafetyLogsBefore(ctx context.Context, cutoff int64) (int64, error) {
	if !common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		result := LOG_DB.WithContext(ctx).Where("created_at < ?", cutoff).Delete(&ContentSafetyLog{})
		return result.RowsAffected, result.Error
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
	return LOG_DB.Exec(`CREATE TABLE IF NOT EXISTS content_safety_logs (
		id Int64 DEFAULT 0, event_id String, created_at Int64, request_id String, user_id Int64,
		username String, token_id Int64, token_name String, using_group String, model String,
		request_path String, decision String, failure_reason String, hit_words String, snippets String,
		ai_category String, ai_reason String, review_channel_id Int64, review_model String,
		latency_ms Int64, review_tokens Int64, cache_hit UInt8
	) ENGINE = MergeTree()
	PARTITION BY toYYYYMM(toDateTime(created_at))
	ORDER BY (created_at, event_id)`).Error
}
