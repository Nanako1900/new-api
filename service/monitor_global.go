package service

import (
	"context"
	"errors"
	"sync"
	"time"

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
		// Fresh from when the read finished, so a slow read is not stale on arrival.
		overview := &MonitorGlobalOverview{Window: window, Start: now.Add(-span).Unix(), End: now.Unix(), GeneratedAt: time.Now().Unix(), GlobalLogUsage: usage}
		monitorGlobalCache.Store(window, overview)
		return overview, nil
	})
	if err != nil {
		return nil, err
	}
	return result.(*MonitorGlobalOverview), nil
}
