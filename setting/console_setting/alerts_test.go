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
