package service

import (
	"cmp"
	"context"
	"errors"
	"math"
	"slices"
	"strconv"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"golang.org/x/sync/singleflight"
)

const (
	// monitorGlobalCacheTTL is how stale the site-wide overview may be. The
	// console polls every 30 s, so a node reads the log table at most twice a
	// minute per window however many root consoles are open.
	monitorGlobalCacheTTL = 30 * time.Second
	monitorGlobalTopLimit = 10
	monitorGlobalRateSpan = 60 * time.Second
	// monitorGlobalQueryTimeout ends a slow read; the console keeps showing
	// the last overview and tries again on its next poll.
	monitorGlobalQueryTimeout = 15 * time.Second

	// A user spikes when their last monitorGlobalSpikeSpan cost at least
	// monitorGlobalSpikeRatio times their usual share of the window, and at
	// least the site's value of $0.10. The database checks every user and
	// returns the monitorGlobalSpikeCandidates biggest recent spenders that
	// qualify; the monitorGlobalSpikeLimit highest ratios are shown.
	monitorGlobalSpikeSpan       = 5 * time.Minute
	monitorGlobalSpikeRatio      = 3
	monitorGlobalSpikeCandidates = 20
	monitorGlobalSpikeLimit      = 5
	// Error reasons count the newest monitorGlobalErrorSampleLimit error rows.
	monitorGlobalErrorSampleLimit = 1000
	monitorGlobalErrorReasonLimit = 5
	monitorGlobalErrorExampleMax  = 160
)

// MonitorGlobalWindows are the time windows the site-wide overview offers.
var MonitorGlobalWindows = map[string]time.Duration{
	"1h":  time.Hour,
	"3h":  3 * time.Hour,
	"24h": 24 * time.Hour,
}

// ErrMonitorGlobalWindow means the requested window is not one of
// MonitorGlobalWindows.
var ErrMonitorGlobalWindow = errors.New("monitor global window is invalid")

// MonitorGlobalOverview is the root user's site-wide usage of one window.
type MonitorGlobalOverview struct {
	Window      string `json:"window"`
	Start       int64  `json:"start"`
	End         int64  `json:"end"`
	GeneratedAt int64  `json:"generated_at"`
	*model.GlobalLogUsage
	Spikes        []MonitorUserSpike   `json:"spikes"`
	ErrorReasons  []MonitorErrorReason `json:"error_reasons"`
	ErrorRowsRead int                  `json:"error_rows_read"`
}

// MonitorUserSpike is a user whose recent spend is far above their usual.
// UsualQuota is what they spend in monitorGlobalSpikeSpan on average over the
// window; Ratio is RecentQuota / UsualQuota to one decimal.
type MonitorUserSpike struct {
	UserId         int     `json:"user_id"`
	Username       string  `json:"username"`
	RecentQuota    int64   `json:"recent_quota"`
	RecentRequests int64   `json:"recent_requests"`
	UsualQuota     int64   `json:"usual_quota"`
	Ratio          float64 `json:"ratio"`
}

// MonitorErrorReason is one cause of failed requests: a status code and
// error code, how many of the read error rows had it, and the newest row's
// error text.
type MonitorErrorReason struct {
	StatusCode int    `json:"status_code"`
	ErrorCode  string `json:"error_code"`
	ErrorType  string `json:"error_type"`
	Count      int    `json:"count"`
	Example    string `json:"example"`
}

var (
	monitorGlobalCache   sync.Map // window -> *MonitorGlobalOverview
	monitorGlobalQueries singleflight.Group
)

// GetMonitorGlobalOverview returns the site-wide usage of window, read from
// the log table at most once per monitorGlobalCacheTTL; concurrent callers
// share one read.
func GetMonitorGlobalOverview(window string) (*MonitorGlobalOverview, error) {
	span, ok := MonitorGlobalWindows[window]
	if !ok {
		return nil, ErrMonitorGlobalWindow
	}
	if cached, ok := monitorGlobalCache.Load(window); ok {
		overview := cached.(*MonitorGlobalOverview)
		if time.Since(time.Unix(overview.GeneratedAt, 0)) < monitorGlobalCacheTTL {
			return overview, nil
		}
	}
	result, err, _ := monitorGlobalQueries.Do(window, func() (any, error) {
		// Shared by every waiting caller, so not tied to one request's context.
		ctx, cancel := context.WithTimeout(context.Background(), monitorGlobalQueryTimeout)
		defer cancel()
		now := time.Now()
		usage, err := model.GetGlobalLogUsage(ctx, now.Add(-span).Unix(), now.Unix(), now.Add(-monitorGlobalRateSpan).Unix(), monitorGlobalTopLimit)
		if err != nil {
			return nil, err
		}
		start, end := now.Add(-span).Unix(), now.Unix()
		floor := int64(common.QuotaFromFloat(common.QuotaPerUnit / 10))
		// Spikes and error reasons are extras: when they fail, the overview
		// still answers, with them empty, and the failure is logged.
		spends, err := model.GetGlobalSpendSpikes(ctx, now.Add(-monitorGlobalSpikeSpan).Unix(), start, end, floor,
			monitorGlobalSpikeRatio, monitorGlobalSpikeCandidates)
		if err != nil {
			common.SysError(common.LogText("failed to read monitor spending spikes: %s", err.Error()))
			spends = nil
		}
		samples, err := model.GetGlobalErrorSamples(ctx, start, end, monitorGlobalErrorSampleLimit)
		if err != nil {
			common.SysError(common.LogText("failed to read monitor error reasons: %s", err.Error()))
			samples = nil
		}
		// Fresh from when the read finished, so a slow read is not stale on arrival.
		overview := &MonitorGlobalOverview{Window: window, Start: start, End: end, GeneratedAt: time.Now().Unix(), GlobalLogUsage: usage,
			Spikes:        monitorUserSpikes(spends, span, floor),
			ErrorReasons:  monitorErrorReasons(samples),
			ErrorRowsRead: len(samples),
		}
		monitorGlobalCache.Store(window, overview)
		return overview, nil
	})
	if err != nil {
		return nil, err
	}
	return result.(*MonitorGlobalOverview), nil
}

// monitorUserSpikes picks the users whose recent spend is at least
// monitorGlobalSpikeRatio times their usual share of the window and at least
// floor, highest ratio first. A user whose whole window spend is recent (a
// new heavy user) has the highest possible ratio.
func monitorUserSpikes(rows []model.GlobalUserSpend, window time.Duration, floor int64) []MonitorUserSpike {
	share := float64(monitorGlobalSpikeSpan) / float64(window)
	spikes := []MonitorUserSpike{}
	for _, row := range rows {
		usual := float64(max(row.WindowQuota, row.RecentQuota)) * share
		ratio := float64(row.RecentQuota) / max(usual, 1)
		if row.RecentQuota < floor || ratio < monitorGlobalSpikeRatio {
			continue
		}
		spikes = append(spikes, MonitorUserSpike{UserId: row.UserId, Username: row.Username, RecentQuota: row.RecentQuota,
			RecentRequests: row.RecentRequests, UsualQuota: int64(common.QuotaRound(usual)), Ratio: math.Round(ratio*10) / 10})
	}
	slices.SortStableFunc(spikes, func(a, b MonitorUserSpike) int {
		return cmp.Or(cmp.Compare(b.Ratio, a.Ratio), cmp.Compare(b.RecentQuota, a.RecentQuota))
	})
	return spikes[:min(len(spikes), monitorGlobalSpikeLimit)]
}

// monitorErrorReasons groups error rows (newest first) by status code and
// error code, most common first; ties keep the most recent cause first. A row
// whose details cannot be read counts under status 0 with no error code.
func monitorErrorReasons(samples []model.GlobalErrorSample) []MonitorErrorReason {
	type key struct {
		status int
		code   string
	}
	index := map[key]int{}
	reasons := []MonitorErrorReason{}
	for _, sample := range samples {
		details := monitorErrorCause(sample.Other)
		k := key{details.StatusCode, details.ErrorCode}
		if i, ok := index[k]; ok {
			reasons[i].Count++
			continue
		}
		example := sample.Content
		if utf8.RuneCountInString(example) > monitorGlobalErrorExampleMax {
			example = string([]rune(example)[:monitorGlobalErrorExampleMax])
		}
		index[k] = len(reasons)
		reasons = append(reasons, MonitorErrorReason{StatusCode: details.StatusCode, ErrorCode: details.ErrorCode,
			ErrorType: details.ErrorType, Count: 1, Example: example})
	}
	slices.SortStableFunc(reasons, func(a, b MonitorErrorReason) int { return cmp.Compare(b.Count, a.Count) })
	return reasons[:min(len(reasons), monitorGlobalErrorReasonLimit)]
}

// monitorErrorCause reads an error row's status code, error code and error
// type, keeping each field that decodes: a status code stored as a string
// (older rows) still counts, and unreadable details give the zero cause.
func monitorErrorCause(other string) MonitorErrorReason {
	var fields map[string]any
	if err := common.UnmarshalJsonStr(other, &fields); err != nil {
		return MonitorErrorReason{}
	}
	cause := MonitorErrorReason{}
	switch status := fields["status_code"].(type) {
	case float64:
		cause.StatusCode = int(status)
	case string:
		cause.StatusCode, _ = strconv.Atoi(status)
	}
	cause.ErrorCode, _ = fields["error_code"].(string)
	cause.ErrorType, _ = fields["error_type"].(string)
	return cause
}
