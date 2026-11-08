package model

import (
	"slices"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// logCreatedHook observes every log row right after it is stored. The monitor
// stream uses it to push a user's new rows within a second.
var logCreatedHook atomic.Pointer[func(Log)]

// SetLogCreatedHook installs the observer called after each successful log
// insert, or removes it when hook is nil. The hook runs on the goroutine that
// wrote the log (usually a relay request), so it must return immediately. It
// receives a copy of the stored row, with the id the log database assigned
// (always 0 on ClickHouse).
func SetLogCreatedHook(hook func(Log)) {
	if hook == nil {
		logCreatedHook.Store(nil)
		return
	}
	logCreatedHook.Store(&hook)
}

func notifyLogCreated(log *Log) {
	if hook := logCreatedHook.Load(); hook != nil {
		(*hook)(*log)
	}
}

// GetUserLogsSince returns the newest limit logs of a user created at or after
// since, ordered oldest first, with their stored ids and without counting. A
// result of exactly limit rows may be missing older rows of the window.
func GetUserLogsSince(userID int, since int64, limit int) ([]*Log, error) {
	if userID <= 0 {
		return nil, nil
	}
	return logsSince(LOG_DB.Where("user_id = ?", userID), since, limit)
}

// GlobalLogTypes are the rows the root user's site-wide monitor view shows:
// requests (consume and error rows), never top-ups, logins or admin actions.
var GlobalLogTypes = []int{LogTypeConsume, LogTypeError}

// IsGlobalLogType reports whether rows of logType belong in the site-wide view.
func IsGlobalLogType(logType int) bool {
	return slices.Contains(GlobalLogTypes, logType)
}

// GetGlobalLogsSince is GetUserLogsSince for every user's request rows
// (GlobalLogTypes).
func GetGlobalLogsSince(since int64, limit int) ([]*Log, error) {
	return logsSince(LOG_DB.Where("type IN ?", GlobalLogTypes), since, limit)
}

func logsSince(tx *gorm.DB, since int64, limit int) ([]*Log, error) {
	if since <= 0 || limit <= 0 {
		return nil, nil
	}
	order := "created_at desc, id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("")
	}
	var logs []*Log
	if err := tx.Where("created_at >= ?", since).Order(order).Limit(limit).Find(&logs).Error; err != nil {
		return nil, err
	}
	slices.Reverse(logs)
	return logs, nil
}

// FormatGlobalLogView returns the copy of a request row (GlobalLogTypes) the
// root user's site-wide monitor view shows: what an administrator sees,
// without the client IP. The caller fills in the channel name.
func FormatGlobalLogView(log Log) Log {
	log.Ip = ""
	log.Other = formatLogOtherJSON(log.Other, logOtherVisibilityAdmin)
	return log
}
