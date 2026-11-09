package model

import (
	"context"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// Site-wide usage for the root user's monitor console, read from the log
// table. Aliases never repeat a column name: ClickHouse resolves aliases
// before columns, so `MAX(username) AS username` would refer to itself.

// GlobalLogTotals sums the consume and error rows of a time window.
type GlobalLogTotals struct {
	Quota       int64 `json:"quota" gorm:"column:total_quota"`
	Requests    int64 `json:"requests" gorm:"column:request_count"`
	Tokens      int64 `json:"tokens" gorm:"column:total_tokens"`
	Errors      int64 `json:"errors" gorm:"-"`
	ActiveUsers int64 `json:"active_users" gorm:"column:user_count"`
}

// GlobalLogRate counts the consume rows and their tokens of the last minute.
type GlobalLogRate struct {
	Rpm int64 `json:"rpm" gorm:"column:request_count"`
	Tpm int64 `json:"tpm" gorm:"column:total_tokens"`
}

type GlobalUserUsage struct {
	UserId   int    `json:"user_id" gorm:"column:user_id"`
	Username string `json:"username" gorm:"column:user_name"`
	Quota    int64  `json:"quota" gorm:"column:total_quota"`
	Requests int64  `json:"requests" gorm:"column:request_count"`
	Tokens   int64  `json:"tokens" gorm:"column:total_tokens"`
}

type GlobalModelUsage struct {
	ModelName string `json:"model_name" gorm:"column:model_name"`
	Quota     int64  `json:"quota" gorm:"column:total_quota"`
	Requests  int64  `json:"requests" gorm:"column:request_count"`
	Tokens    int64  `json:"tokens" gorm:"column:total_tokens"`
}

// GlobalChannelUsage counts a channel's consume rows (Requests) and error
// rows (Errors).
type GlobalChannelUsage struct {
	ChannelId   int    `json:"channel_id" gorm:"column:channel_id"`
	ChannelName string `json:"channel_name" gorm:"-"`
	Requests    int64  `json:"requests" gorm:"column:request_count"`
	Errors      int64  `json:"errors" gorm:"column:error_count"`
}

// GlobalLogUsage is the site-wide usage of one time window.
type GlobalLogUsage struct {
	Totals    GlobalLogTotals      `json:"totals"`
	Rate      GlobalLogRate        `json:"rate"`
	TopUsers  []GlobalUserUsage    `json:"top_users"`
	TopModels []GlobalModelUsage   `json:"top_models"`
	Channels  []GlobalChannelUsage `json:"channels"`
}

const (
	globalUsageColumns = "COUNT(*) AS request_count, COALESCE(SUM(quota), 0) AS total_quota, " +
		"COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) AS total_tokens"
	globalUsageOrder = "total_quota DESC, request_count DESC"
)

// GlobalLogCountLimit is where the site-wide log list stops counting: an
// exact total over every user's rows of the whole log range is too costly.
const GlobalLogCountLimit = 10000

// GetGlobalLogs lists every user's request rows (GlobalLogTypes, narrowed to
// filter's Type when set) matching filter, newest first, with channel names.
// The total stops at countLimit.
func GetGlobalLogs(filter LogFilter, startIdx, num, countLimit int) ([]*Log, int64, error) {
	if filter.Type != LogTypeUnknown && !IsGlobalLogType(filter.Type) {
		return []*Log{}, 0, nil
	}
	filter.Types = GlobalLogTypes
	tx, err := filter.apply(LOG_DB)
	if err != nil {
		return nil, 0, err
	}
	var total int64
	capped := tx.Session(&gorm.Session{}).Model(&Log{}).Select("1").Limit(countLimit)
	if err := LOG_DB.Table("(?) AS capped", capped).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	order := "logs.created_at desc, logs.id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	var logs []*Log
	if err := tx.Model(&Log{}).Order(order).Limit(num).Offset(startIdx).Find(&logs).Error; err != nil {
		return nil, 0, err
	}
	names := map[int]string{}
	for _, log := range logs {
		if log.ChannelId == 0 {
			continue
		}
		name, ok := names[log.ChannelId]
		if !ok {
			if channel, err := CacheGetChannel(log.ChannelId); err == nil {
				name = channel.Name
			}
			names[log.ChannelId] = name
		}
		log.ChannelName = name
	}
	return logs, total, nil
}

// GetGlobalLogUsage reads every user's usage between start and end (unix
// seconds, inclusive), the request rate since rateSince, and the top limit
// users, models and channels. Channels are ranked by errors, then requests.
func GetGlobalLogUsage(ctx context.Context, start, end, rateSince int64, limit int) (*GlobalLogUsage, error) {
	db := LOG_DB.WithContext(ctx)
	// Empty lists, not null, when the window has no rows.
	usage := &GlobalLogUsage{TopUsers: []GlobalUserUsage{}, TopModels: []GlobalModelUsage{}, Channels: []GlobalChannelUsage{}}
	consume := func() *gorm.DB {
		return db.Table("logs").Where("type = ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, start, end)
	}
	if err := consume().Select(globalUsageColumns + ", COUNT(DISTINCT user_id) AS user_count").Scan(&usage.Totals).Error; err != nil {
		return nil, err
	}
	if err := db.Table("logs").Where("type = ? AND created_at >= ? AND created_at <= ?", LogTypeError, start, end).
		Count(&usage.Totals.Errors).Error; err != nil {
		return nil, err
	}
	if err := db.Table("logs").Where("type = ? AND created_at >= ?", LogTypeConsume, rateSince).
		Select(globalUsageColumns).Scan(&usage.Rate).Error; err != nil {
		return nil, err
	}
	if err := consume().Select("user_id, MAX(username) AS user_name, " + globalUsageColumns).
		Group("user_id").Order(globalUsageOrder + ", user_id ASC").Limit(limit).Scan(&usage.TopUsers).Error; err != nil {
		return nil, err
	}
	if err := consume().Select("model_name, " + globalUsageColumns).
		Group("model_name").Order(globalUsageOrder + ", model_name ASC").Limit(limit).Scan(&usage.TopModels).Error; err != nil {
		return nil, err
	}
	if err := db.Table("logs").
		Where("type IN ? AND created_at >= ? AND created_at <= ?", []int{LogTypeConsume, LogTypeError}, start, end).
		Select("channel_id, SUM(CASE WHEN type = ? THEN 1 ELSE 0 END) AS request_count, SUM(CASE WHEN type = ? THEN 1 ELSE 0 END) AS error_count",
			LogTypeConsume, LogTypeError).
		Group("channel_id").Order("error_count DESC, request_count DESC, channel_id ASC").Limit(limit).
		Scan(&usage.Channels).Error; err != nil {
		return nil, err
	}
	for i := range usage.Channels {
		if usage.Channels[i].ChannelId == 0 {
			continue
		}
		if channel, err := CacheGetChannel(usage.Channels[i].ChannelId); err == nil {
			usage.Channels[i].ChannelName = channel.Name
		}
	}
	return usage, nil
}

// GlobalUserSpend is what a user spent in a recent span and in the whole
// window around it.
type GlobalUserSpend struct {
	UserId         int    `gorm:"column:user_id"`
	Username       string `gorm:"column:user_name"`
	RecentQuota    int64  `gorm:"column:recent_quota"`
	RecentRequests int64  `gorm:"column:recent_requests"`
	WindowQuota    int64  `gorm:"column:window_quota"`
}

// GetGlobalSpendSpikes returns up to limit users, biggest recent spend first,
// whose spend between recentSince and end is at least floor and at least ratio
// times their share of the window [start, end] for that span:
// recent × window ≥ ratio × span × windowTotal, in whole seconds. It is one
// pass over the window's consume rows, so every user is checked; HAVING
// repeats the sums because PostgreSQL does not accept aliases there.
func GetGlobalSpendSpikes(ctx context.Context, recentSince, start, end, floor, ratio int64, limit int) ([]GlobalUserSpend, error) {
	const recent = "SUM(CASE WHEN created_at >= ? THEN quota ELSE 0 END)"
	window, span := end-start, end-recentSince
	spends := []GlobalUserSpend{}
	err := LOG_DB.WithContext(ctx).Table("logs").
		Where("type = ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, start, end).
		Select("user_id, MAX(username) AS user_name, "+recent+" AS recent_quota, "+
			"SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS recent_requests, COALESCE(SUM(quota), 0) AS window_quota",
			recentSince, recentSince).
		Group("user_id").
		Having(recent+" >= ? AND "+recent+" * ? >= ? * COALESCE(SUM(quota), 0)", recentSince, floor, recentSince, window, ratio*span).
		Order("recent_quota DESC, user_id ASC").Limit(limit).Scan(&spends).Error
	return spends, err
}

// GlobalErrorSample is the error text and details of one error row.
type GlobalErrorSample struct {
	Content string `gorm:"column:content"`
	Other   string `gorm:"column:other"`
}

// GetGlobalErrorSamples returns the newest limit error rows between start and
// end (unix seconds, inclusive), newest first.
func GetGlobalErrorSamples(ctx context.Context, start, end int64, limit int) ([]GlobalErrorSample, error) {
	order := "created_at desc, id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("")
	}
	samples := []GlobalErrorSample{}
	err := LOG_DB.WithContext(ctx).Table("logs").Select("content, other").
		Where("type = ? AND created_at >= ? AND created_at <= ?", LogTypeError, start, end).
		Order(order).Limit(limit).Scan(&samples).Error
	return samples, err
}
