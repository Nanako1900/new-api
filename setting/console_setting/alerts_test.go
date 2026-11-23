package console_setting

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateAlerts(t *testing.T) {
	tooMany := make([]string, 0, 21)
	for i := range 21 {
		tooMany = append(tooMany, fmt.Sprintf(`{"id":%d,"content":"c","level":"info"}`, i+1))
	}

	tests := []struct {
		name      string
		value     string
		wantKey   string
		wantIndex int
	}{
		{name: "empty value is valid", value: ""},
		{name: "empty list is valid", value: `[]`},
		{name: "minimal alert is valid", value: `[{"id":1,"content":"Maintenance tonight","level":"info"}]`},
		{name: "time-based id from the web console is valid", value: `[{"id":1762588800000,"content":"c","level":"info"}]`},
		{
			// The web console sends Date.toISOString() values, which carry milliseconds.
			name:  "full alert with milliseconds and offsets is valid",
			value: `[{"id":1,"title":"Maintenance","content":"Tonight","level":"warning","dismissible":true,"enabled":true,"startsAt":"2026-11-07T20:00:00.000Z","endsAt":"2026-11-08T07:00:00+08:00"}]`,
		},
		{name: "content of exactly 500 UTF-16 units is valid", value: `[{"id":1,"content":"` + strings.Repeat("😀", 250) + `","level":"info"}]`},
		{name: "title of exactly 100 characters is valid", value: `[{"id":1,"title":"` + strings.Repeat("a", 100) + `","content":"c","level":"info"}]`},
		{name: "exactly 20 alerts is valid", value: "[" + strings.Join(tooMany[:20], ",") + "]"},
		{name: "malformed JSON", value: `{`, wantKey: "Invalid alerts format: {{error}}"},
		{name: "more than 20 alerts", value: "[" + strings.Join(tooMany, ",") + "]", wantKey: "Alerts cannot exceed 20 entries"},
		{name: "negative id", value: `[{"id":-1,"content":"c","level":"info"}]`, wantKey: "Alert #{{index}} has an invalid ID", wantIndex: 1},
		{name: "zero id", value: `[{"id":0,"content":"c","level":"info"}]`, wantKey: "Alert #{{index}} has an invalid ID", wantIndex: 1},
		{
			name:      "duplicate id reports the second alert",
			value:     `[{"id":1,"content":"a","level":"info"},{"id":1,"content":"b","level":"info"}]`,
			wantKey:   "Alert #{{index}} has a duplicate ID",
			wantIndex: 2,
		},
		{name: "blank content", value: `[{"id":1,"content":"   ","level":"info"}]`, wantKey: "Alert #{{index}} is missing the content field", wantIndex: 1},
		{
			name:    "content over 500 UTF-16 units",
			value:   `[{"id":1,"content":"` + strings.Repeat("😀", 251) + `","level":"info"}]`,
			wantKey: "Alert #{{index}} content cannot exceed 500 characters",
		},
		{
			name:    "title over 100 characters",
			value:   `[{"id":1,"title":"` + strings.Repeat("a", 101) + `","content":"c","level":"info"}]`,
			wantKey: "Alert #{{index}} title cannot exceed 100 characters",
		},
		{name: "unknown level", value: `[{"id":1,"content":"c","level":"critical"}]`, wantKey: "Alert #{{index}} has an invalid level value"},
		{name: "invalid start time", value: `[{"id":1,"content":"c","level":"info","startsAt":"2026-11-07 20:00"}]`, wantKey: "Alert #{{index}} has an invalid start time"},
		{name: "invalid end time", value: `[{"id":1,"content":"c","level":"info","endsAt":"tomorrow"}]`, wantKey: "Alert #{{index}} has an invalid end time"},
		{
			name:    "end equal to start",
			value:   `[{"id":1,"content":"c","level":"info","startsAt":"2026-11-07T20:00:00Z","endsAt":"2026-11-07T20:00:00Z"}]`,
			wantKey: "Alert #{{index}} end time must be after its start time",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateConsoleSettings(tt.value, "Alerts")
			if tt.wantKey == "" {
				require.NoError(t, err)
				return
			}
			var message *common.Message
			require.ErrorAs(t, err, &message)
			assert.Equal(t, tt.wantKey, message.Key)
			if tt.wantIndex != 0 {
				assert.Equal(t, tt.wantIndex, message.Params["index"])
			}
		})
	}
}

func TestGetActiveAlertsFiltersByScheduleAndSortsBySeverity(t *testing.T) {
	original := GetConsoleSetting().Alerts
	t.Cleanup(func() { GetConsoleSetting().Alerts = original })
	GetConsoleSetting().Alerts = `[
		{"id":1,"content":"disabled","level":"error","enabled":false},
		{"id":2,"content":"starts later","level":"error","enabled":true,"startsAt":"2026-11-07T12:00:01Z"},
		{"id":3,"content":"ended now","level":"error","enabled":true,"endsAt":"2026-11-07T12:00:00Z"},
		{"id":4,"content":"starts now","level":"info","enabled":true,"startsAt":"2026-11-07T12:00:00Z"},
		{"id":5,"content":"no schedule","level":"success","enabled":true},
		{"id":6,"content":"older warning","level":"warning","enabled":true,"endsAt":"2026-11-07T12:00:01Z"},
		{"id":7,"content":"newer warning","level":"warning","enabled":true},
		{"id":8,"content":"error","level":"error","enabled":true},
		{"id":9,"content":"unknown level","level":"bogus","enabled":true}
	]`
	now := time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)

	alerts := GetActiveAlerts(now)

	ids := make([]int64, 0, len(alerts))
	for _, alert := range alerts {
		ids = append(ids, alert.Id)
	}
	assert.Equal(t, []int64{8, 7, 6, 4, 5}, ids)
}

func TestGetActiveAlertsReturnsEmptySliceWhenUnset(t *testing.T) {
	original := GetConsoleSetting().Alerts
	t.Cleanup(func() { GetConsoleSetting().Alerts = original })
	GetConsoleSetting().Alerts = ""

	alerts := GetActiveAlerts(time.Now())

	require.NotNil(t, alerts)
	assert.Empty(t, alerts)
}

func TestMergeAlertHistory(t *testing.T) {
	now := time.Date(2026, 11, 23, 12, 0, 0, 0, time.UTC)
	createdId := time.Date(2026, 11, 16, 0, 0, 0, 0, time.UTC).UnixMilli()
	fullHistory := make([]string, 0, maxAlertHistory)
	for i := range maxAlertHistory {
		fullHistory = append(fullHistory, fmt.Sprintf(
			`{"id":%d,"content":"old","level":"info","publishedAt":"2026-10-%02dT00:00:00Z"}`, i+1, i%28+1))
	}

	tests := []struct {
		name     string
		history  string
		previous string
		next     string
		want     []AlertHistoryEntry
	}{
		{
			name: "a new live alert is recorded as published now",
			next: `[{"id":1,"title":"Promo","content":"5% off","level":"success","enabled":true}]`,
			want: []AlertHistoryEntry{{Id: 1, Title: "Promo", Content: "5% off", Level: "success", PublishedAt: "2026-11-23T12:00:00Z"}},
		},
		{
			name:     "a deleted alert keeps its entry",
			history:  `[{"id":1,"content":"a","level":"info","publishedAt":"2026-11-20T00:00:00Z"}]`,
			previous: `[{"id":1,"content":"a","level":"info","enabled":true}]`,
			next:     `[]`,
			want:     []AlertHistoryEntry{{Id: 1, Content: "a", Level: "info", PublishedAt: "2026-11-20T00:00:00Z"}},
		},
		{
			name:     "editing a shown alert updates its entry in place",
			history:  `[{"id":1,"content":"a","level":"info","publishedAt":"2026-11-20T00:00:00Z"}]`,
			previous: `[{"id":1,"content":"a","level":"info","enabled":true}]`,
			next:     `[{"id":1,"content":"b","level":"warning","enabled":true}]`,
			want:     []AlertHistoryEntry{{Id: 1, Content: "b", Level: "warning", PublishedAt: "2026-11-20T00:00:00Z", UpdatedAt: "2026-11-23T12:00:00Z"}},
		},
		{
			name:     "a disabled alert keeps the version users saw",
			history:  `[{"id":1,"content":"a","level":"info","publishedAt":"2026-11-20T00:00:00Z"}]`,
			previous: `[{"id":1,"content":"a","level":"info","enabled":true}]`,
			next:     `[{"id":1,"content":"b","level":"info","enabled":false}]`,
			want:     []AlertHistoryEntry{{Id: 1, Content: "a", Level: "info", PublishedAt: "2026-11-20T00:00:00Z"}},
		},
		{
			name: "a scheduled alert is dated by its start",
			next: `[{"id":1,"content":"a","level":"info","enabled":true,"startsAt":"2026-11-25T00:00:00.000Z"}]`,
			want: []AlertHistoryEntry{{Id: 1, Content: "a", Level: "info", PublishedAt: "2026-11-25T00:00:00Z"}},
		},
		{
			name:     "a scheduled alert deleted before it starts leaves no entry",
			history:  `[{"id":1,"content":"a","level":"info","publishedAt":"2026-11-25T00:00:00Z"}]`,
			previous: `[{"id":1,"content":"a","level":"info","enabled":true,"startsAt":"2026-11-25T00:00:00Z"}]`,
			next:     `[]`,
			want:     []AlertHistoryEntry{},
		},
		{
			name:     "an alert from before the history existed is archived by its start when deleted",
			previous: `[{"id":7,"content":"old","level":"info","enabled":true,"startsAt":"2026-11-01T00:00:00Z"}]`,
			next:     `[]`,
			want:     []AlertHistoryEntry{{Id: 7, Content: "old", Level: "info", PublishedAt: "2026-11-01T00:00:00Z"}},
		},
		{
			name:     "an alert from before the history existed is dated by its time-based id",
			previous: fmt.Sprintf(`[{"id":%d,"content":"old","level":"info","enabled":true}]`, createdId),
			next:     `[]`,
			want:     []AlertHistoryEntry{{Id: createdId, Content: "old", Level: "info", PublishedAt: "2026-11-16T00:00:00Z"}},
		},
		{
			name:     "an alert that was never enabled is not recorded",
			previous: `[{"id":1,"content":"draft","level":"info","enabled":false}]`,
			next:     `[{"id":1,"content":"draft","level":"info","enabled":false}]`,
			want:     []AlertHistoryEntry{},
		},
		{
			name: "an alert saved after it ended is not recorded",
			next: `[{"id":1,"content":"late","level":"info","enabled":true,"endsAt":"2026-11-22T00:00:00Z"}]`,
			want: []AlertHistoryEntry{},
		},
		{
			name:    "a damaged history is replaced instead of blocking the save",
			history: `{`,
			next:    `[{"id":1,"content":"a","level":"info","enabled":true}]`,
			want:    []AlertHistoryEntry{{Id: 1, Content: "a", Level: "info", PublishedAt: "2026-11-23T12:00:00Z"}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			merged, err := MergeAlertHistory(tt.history, tt.previous, tt.next, now)
			require.NoError(t, err)

			var got []AlertHistoryEntry
			require.NoError(t, common.UnmarshalJsonStr(merged, &got))
			assert.Equal(t, tt.want, got)
		})
	}

	t.Run("only the newest 50 entries are kept", func(t *testing.T) {
		merged, err := MergeAlertHistory(
			"["+strings.Join(fullHistory, ",")+"]",
			`[]`,
			`[{"id":999,"content":"new","level":"info","enabled":true}]`,
			now,
		)
		require.NoError(t, err)

		var got []AlertHistoryEntry
		require.NoError(t, common.UnmarshalJsonStr(merged, &got))
		require.Len(t, got, maxAlertHistory)
		assert.Equal(t, int64(999), got[0].Id)
		assert.Equal(t, "2026-10-01T00:00:00Z", got[len(got)-1].PublishedAt)
	})
}

func TestGetPastAlertsListsPublishedEntriesThatAreNotLive(t *testing.T) {
	setting := GetConsoleSetting()
	originalAlerts, originalHistory := setting.Alerts, setting.AlertHistory
	t.Cleanup(func() { setting.Alerts, setting.AlertHistory = originalAlerts, originalHistory })
	setting.Alerts = `[{"id":1,"content":"live","level":"info","enabled":true}]`
	setting.AlertHistory = `[
		{"id":1,"content":"live","level":"info","publishedAt":"2026-11-22T00:00:00Z"},
		{"id":2,"content":"older","level":"info","publishedAt":"2026-11-01T00:00:00Z"},
		{"id":3,"content":"newer","level":"info","publishedAt":"2026-11-20T00:00:00Z"},
		{"id":4,"content":"scheduled","level":"info","publishedAt":"2026-11-30T00:00:00Z"}
	]`

	past := GetPastAlerts(time.Date(2026, 11, 23, 12, 0, 0, 0, time.UTC))

	ids := make([]int64, 0, len(past))
	for _, entry := range past {
		ids = append(ids, entry.Id)
	}
	assert.Equal(t, []int64{3, 2}, ids)
}

func TestRemoveAlertHistoryEntry(t *testing.T) {
	history := `[{"id":1,"content":"a","level":"info","publishedAt":"2026-11-20T00:00:00Z"},{"id":2,"content":"b","level":"info","publishedAt":"2026-11-21T00:00:00Z"}]`

	t.Run("a deleted alert is removed", func(t *testing.T) {
		kept, err := RemoveAlertHistoryEntry(history, `[]`, 1)
		require.NoError(t, err)

		var got []AlertHistoryEntry
		require.NoError(t, common.UnmarshalJsonStr(kept, &got))
		require.Len(t, got, 1)
		assert.Equal(t, int64(2), got[0].Id)
	})

	t.Run("an alert still in the list is refused", func(t *testing.T) {
		_, err := RemoveAlertHistoryEntry(history, `[{"id":1,"content":"a","level":"info","enabled":false}]`, 1)

		var message *common.Message
		require.ErrorAs(t, err, &message)
		assert.Equal(t, "Delete this alert from the alert list and save before removing it from history", message.Key)
	})

	t.Run("an unknown id is reported", func(t *testing.T) {
		_, err := RemoveAlertHistoryEntry(history, `[]`, 3)

		var message *common.Message
		require.ErrorAs(t, err, &message)
		assert.Equal(t, "Alert history entry not found", message.Key)
	})
}
