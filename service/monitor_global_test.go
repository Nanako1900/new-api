package service

import (
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
)

func TestMonitorUserSpikesFlagsOnlyRecentSpendFarAboveUsual(t *testing.T) {
	// Over 3 hours, 5 minutes are 1/36 of the window.
	rows := []model.GlobalUserSpend{
		{UserId: 1, Username: "steady", RecentQuota: 100_000, WindowQuota: 3_600_000},  // usual 100 000: ratio 1
		{UserId: 2, Username: "surging", RecentQuota: 500_000, WindowQuota: 3_600_000}, // usual 100 000: ratio 5
		{UserId: 3, Username: "newcomer", RecentQuota: 200_000, WindowQuota: 200_000},  // all spend recent: ratio 36
		{UserId: 4, Username: "tiny", RecentQuota: 40_000, WindowQuota: 40_000},        // below the floor
		{UserId: 5, Username: "borderline", RecentQuota: 300_000, WindowQuota: 3_600_000},
	}

	spikes := monitorUserSpikes(rows, 3*time.Hour, 50_000)

	assert.Equal(t, []MonitorUserSpike{
		{UserId: 3, Username: "newcomer", RecentQuota: 200_000, UsualQuota: 5_556, Ratio: 36},
		{UserId: 2, Username: "surging", RecentQuota: 500_000, UsualQuota: 100_000, Ratio: 5},
		{UserId: 5, Username: "borderline", RecentQuota: 300_000, UsualQuota: 100_000, Ratio: 3},
	}, spikes)
	assert.NotNil(t, monitorUserSpikes(nil, time.Hour, 1), "no rows give an empty list, not null")
}

func TestMonitorErrorReasonsGroupsByStatusAndCode(t *testing.T) {
	samples := []model.GlobalErrorSample{
		{Content: "newest refused", Other: `{"status_code":500,"error_code":"do_request_failed","error_type":"new_api_error"}`},
		{Content: "rate limited", Other: `{"status_code":429,"error_code":"rate_limit","error_type":"upstream_error"}`},
		{Content: "older refused", Other: `{"status_code":500,"error_code":"do_request_failed","error_type":"new_api_error"}`},
		{Content: strings.Repeat("长", 200), Other: `not json`},
		{Content: "another 429", Other: `{"status_code":"429","error_code":"rate_limit"}`},
		{Content: "exploded", Other: `{"status_code":500,"error_code":"unknown_error"}`},
	}

	reasons := monitorErrorReasons(samples)

	assert.Len(t, reasons, 4)
	assert.Equal(t, MonitorErrorReason{StatusCode: 500, ErrorCode: "do_request_failed", ErrorType: "new_api_error", Count: 2, Example: "newest refused"},
		reasons[0], "most common first, with the newest row's text")
	assert.Equal(t, 429, reasons[1].StatusCode)
	assert.Equal(t, 2, reasons[1].Count, "a status code stored as a string still counts")
	assert.Equal(t, 0, reasons[2].StatusCode, "unreadable details count as unknown")
	assert.Equal(t, monitorGlobalErrorExampleMax, len([]rune(reasons[2].Example)), "long error text is cut")
	assert.Equal(t, "unknown_error", reasons[3].ErrorCode)

	many := make([]model.GlobalErrorSample, 0, 7)
	for code := range 7 {
		many = append(many, model.GlobalErrorSample{Other: `{"status_code":` + string(rune('0'+code)) + `}`})
	}
	assert.Len(t, monitorErrorReasons(many), monitorGlobalErrorReasonLimit)
}
