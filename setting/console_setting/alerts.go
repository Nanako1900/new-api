package console_setting

import (
	"cmp"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// Alert is a console banner the root user manages. It is shown at the top of
// every signed-in console page while it is enabled and inside its schedule.
type Alert struct {
	Id          int    `json:"id"`
	Title       string `json:"title,omitempty"`
	Content     string `json:"content"`
	Level       string `json:"level"`
	Dismissible bool   `json:"dismissible"`
	Enabled     bool   `json:"enabled"`
	StartsAt    string `json:"startsAt,omitempty"`
	EndsAt      string `json:"endsAt,omitempty"`
}

const (
	maxAlerts             = 20
	maxAlertTitleLength   = 100
	maxAlertContentLength = 500
)

// alertLevelRank orders active alerts; lower ranks are shown first.
var alertLevelRank = map[string]int{"error": 0, "warning": 1, "info": 2, "success": 3}

// parseAlertTime parses an optional RFC3339 schedule bound. An empty value
// means the alert has no bound on that side.
func parseAlertTime(value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func validateAlerts(value string) error {
	var alerts []Alert
	if err := common.UnmarshalJsonStr(value, &alerts); err != nil {
		return common.NewMessage("Invalid alerts format: {{error}}", map[string]any{"error": err.Error()})
	}
	if len(alerts) > maxAlerts {
		return common.NewMessage("Alerts cannot exceed 20 entries")
	}

	seenIds := make(map[int]bool, len(alerts))
	for i, alert := range alerts {
		index := map[string]any{"index": i + 1}
		if alert.Id <= 0 {
			return common.NewMessage("Alert #{{index}} has an invalid ID", index)
		}
		if seenIds[alert.Id] {
			return common.NewMessage("Alert #{{index}} has a duplicate ID", index)
		}
		seenIds[alert.Id] = true
		if strings.TrimSpace(alert.Content) == "" {
			return common.NewMessage("Alert #{{index}} is missing the content field", index)
		}
		if exceedsMaxCharacters(alert.Content, maxAlertContentLength) {
			return common.NewMessage("Alert #{{index}} content cannot exceed 500 characters", index)
		}
		if exceedsMaxCharacters(alert.Title, maxAlertTitleLength) {
			return common.NewMessage("Alert #{{index}} title cannot exceed 100 characters", index)
		}
		if _, ok := alertLevelRank[alert.Level]; !ok {
			return common.NewMessage("Alert #{{index}} has an invalid level value", index)
		}
		startsAt, err := parseAlertTime(alert.StartsAt)
		if err != nil {
			return common.NewMessage("Alert #{{index}} has an invalid start time", index)
		}
		endsAt, err := parseAlertTime(alert.EndsAt)
		if err != nil {
			return common.NewMessage("Alert #{{index}} has an invalid end time", index)
		}
		if startsAt != nil && endsAt != nil && !endsAt.After(*startsAt) {
			return common.NewMessage("Alert #{{index}} end time must be after its start time", index)
		}
	}
	return nil
}

// GetActiveAlerts returns the enabled alerts whose schedule contains now, the
// most severe first and the newest first within a level. Callers must hold
// common.OptionMapRWMutex for reading.
func GetActiveAlerts(now time.Time) []Alert {
	active := []Alert{}
	var alerts []Alert
	if err := common.UnmarshalJsonStr(GetConsoleSetting().Alerts, &alerts); err != nil {
		return active
	}
	for _, alert := range alerts {
		if !alert.Enabled {
			continue
		}
		if _, ok := alertLevelRank[alert.Level]; !ok {
			continue
		}
		startsAt, startErr := parseAlertTime(alert.StartsAt)
		endsAt, endErr := parseAlertTime(alert.EndsAt)
		if startErr != nil || endErr != nil {
			continue
		}
		if startsAt != nil && now.Before(*startsAt) {
			continue
		}
		if endsAt != nil && !now.Before(*endsAt) {
			continue
		}
		active = append(active, alert)
	}
	slices.SortStableFunc(active, func(a, b Alert) int {
		return cmp.Or(
			cmp.Compare(alertLevelRank[a.Level], alertLevelRank[b.Level]),
			cmp.Compare(b.Id, a.Id),
		)
	})
	return active
}
