package console_setting

import (
	"cmp"
	"slices"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// AlertHistoryEntry is an alert as users last saw it. The header bell lists
// the entries whose alert is no longer live, so an alert that was closed,
// ended, disabled or deleted can still be read. Editing a shown alert updates
// its entry in place; deleting an alert keeps its entry until an
// administrator removes it from the history.
type AlertHistoryEntry struct {
	Id          int64  `json:"id"`
	Title       string `json:"title,omitempty"`
	Content     string `json:"content"`
	Level       string `json:"level"`
	PublishedAt string `json:"publishedAt"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
}

const maxAlertHistory = 50

// The console assigns new alert ids from Date.now(), so an id in this range
// is the alert's creation time in milliseconds.
const minMillisecondAlertId = 1_000_000_000_000

func parseAlertHistory(value string) []AlertHistoryEntry {
	var entries []AlertHistoryEntry
	if value == "" {
		return entries
	}
	// A damaged history must not block saving alerts: start a new one.
	if err := common.UnmarshalJsonStr(value, &entries); err != nil {
		common.SysError(common.LogText("invalid alert history, starting a new one: %s", err.Error()))
		return nil
	}
	return entries
}

// alertWindow is the time span an enabled alert is live: from its start (or
// its creation time when it has no start) to its end. Nil bounds are open.
func alertWindow(alert Alert, now time.Time) (start *time.Time, end *time.Time) {
	start, _ = parseAlertTime(alert.StartsAt)
	end, _ = parseAlertTime(alert.EndsAt)
	if start == nil && alert.Id >= minMillisecondAlertId && alert.Id <= now.UnixMilli() {
		created := time.UnixMilli(alert.Id).UTC()
		start = &created
	}
	return start, end
}

func newAlertHistoryEntry(alert Alert, publishedAt time.Time) AlertHistoryEntry {
	return AlertHistoryEntry{
		Id:          alert.Id,
		Title:       alert.Title,
		Content:     alert.Content,
		Level:       alert.Level,
		PublishedAt: publishedAt.UTC().Format(time.RFC3339),
	}
}

func isPublishedBy(entry AlertHistoryEntry, now time.Time) bool {
	publishedAt, err := time.Parse(time.RFC3339, entry.PublishedAt)
	return err == nil && !publishedAt.After(now)
}

// MergeAlertHistory returns the alert history after an administrator replaces
// the alert list previousJSON with nextJSON at now:
//   - Every enabled alert that has been live keeps an entry, also once it is
//     disabled or deleted. Alerts saved before the history existed are added
//     from previousJSON, dated by their start or creation time.
//   - An enabled alert in nextJSON gets or updates its entry. A scheduled one
//     is dated by its start and stays hidden until then; until it starts, its
//     entry follows the list, so a scheduled alert deleted early leaves none.
//   - Only the newest 50 entries are kept.
func MergeAlertHistory(historyJSON, previousJSON, nextJSON string, now time.Time) (string, error) {
	var next []Alert
	if nextJSON != "" {
		if err := common.UnmarshalJsonStr(nextJSON, &next); err != nil {
			return "", common.NewMessage("Invalid alerts format: {{error}}", map[string]any{"error": err.Error()})
		}
	}
	var previous []Alert
	_ = common.UnmarshalJsonStr(previousJSON, &previous)

	entries := make([]AlertHistoryEntry, 0, maxAlertHistory)
	indexById := make(map[int64]int)
	for _, entry := range parseAlertHistory(historyJSON) {
		if _, seen := indexById[entry.Id]; seen || !isPublishedBy(entry, now) {
			continue
		}
		indexById[entry.Id] = len(entries)
		entries = append(entries, entry)
	}

	for _, alert := range previous {
		if _, ok := indexById[alert.Id]; ok || !alert.Enabled {
			continue
		}
		start, end := alertWindow(alert, now)
		if start != nil && start.After(now) {
			continue
		}
		if start != nil && end != nil && !end.After(*start) {
			continue
		}
		publishedAt := now
		if start != nil {
			publishedAt = *start
		}
		indexById[alert.Id] = len(entries)
		entries = append(entries, newAlertHistoryEntry(alert, publishedAt))
	}

	for _, alert := range next {
		if !alert.Enabled {
			continue
		}
		if index, ok := indexById[alert.Id]; ok {
			entry := &entries[index]
			if entry.Title != alert.Title || entry.Content != alert.Content || entry.Level != alert.Level {
				entry.Title = alert.Title
				entry.Content = alert.Content
				entry.Level = alert.Level
				entry.UpdatedAt = now.UTC().Format(time.RFC3339)
			}
			continue
		}
		start, _ := parseAlertTime(alert.StartsAt)
		end, _ := parseAlertTime(alert.EndsAt)
		publishedAt := now
		if start != nil && start.After(now) {
			publishedAt = *start
		}
		if end != nil && !end.After(publishedAt) {
			continue
		}
		indexById[alert.Id] = len(entries)
		entries = append(entries, newAlertHistoryEntry(alert, publishedAt))
	}

	slices.SortStableFunc(entries, func(a, b AlertHistoryEntry) int {
		return cmp.Or(
			cmp.Compare(b.PublishedAt, a.PublishedAt),
			cmp.Compare(b.Id, a.Id),
		)
	})
	if len(entries) > maxAlertHistory {
		entries = entries[:maxAlertHistory]
	}
	encoded, err := common.Marshal(entries)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

// GetPastAlerts returns the history entries published by now whose alert is
// not live, newest first. Callers must hold common.OptionMapRWMutex for
// reading.
func GetPastAlerts(now time.Time) []AlertHistoryEntry {
	live := make(map[int64]bool)
	for _, alert := range GetActiveAlerts(now) {
		live[alert.Id] = true
	}
	past := []AlertHistoryEntry{}
	for _, entry := range parseAlertHistory(GetConsoleSetting().AlertHistory) {
		if live[entry.Id] || !isPublishedBy(entry, now) {
			continue
		}
		past = append(past, entry)
	}
	slices.SortStableFunc(past, func(a, b AlertHistoryEntry) int {
		return cmp.Or(
			cmp.Compare(b.PublishedAt, a.PublishedAt),
			cmp.Compare(b.Id, a.Id),
		)
	})
	return past
}

// RemoveAlertHistoryEntry deletes the entry of alert id from historyJSON. An
// alert still in the list alertsJSON keeps its entry, because saving the list
// would add it again: it has to be deleted from the list first.
func RemoveAlertHistoryEntry(historyJSON, alertsJSON string, id int64) (string, error) {
	var alerts []Alert
	_ = common.UnmarshalJsonStr(alertsJSON, &alerts)
	if slices.ContainsFunc(alerts, func(alert Alert) bool { return alert.Id == id }) {
		return "", common.NewMessage("Delete this alert from the alert list and save before removing it from history")
	}
	entries := parseAlertHistory(historyJSON)
	kept := slices.DeleteFunc(slices.Clone(entries), func(entry AlertHistoryEntry) bool { return entry.Id == id })
	if len(kept) == len(entries) {
		return "", common.NewMessage("Alert history entry not found")
	}
	encoded, err := common.Marshal(kept)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}
