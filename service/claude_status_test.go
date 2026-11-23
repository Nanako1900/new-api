package service

import (
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const claudeStatusFixture = `{
  "status":{"indicator":"major"},
  "components":[{"id":"website","status":"major_outage"},{"id":"k8w3r06qmzrp","status":"operational"}],
  "incidents":[
    {"name":"Web outage","status":"identified","components":[{"id":"website"}],"incident_updates":[{"affected_components":[{"code":"k8w3r06qmzrp"}]}]},
    {"id":"yzs0s90d8fm8","name":"API monitoring","status":"monitoring","components":[{"id":"k8w3r06qmzrp"}]},
    {"id":"s7115yk4gk7m","name":"API investigation","status":"investigating","incident_updates":[{"affected_components":[{"code":"k8w3r06qmzrp"}]}]},
    {"name":"Finished","status":"resolved","components":[{"id":"k8w3r06qmzrp"}]}
  ]
}`

type claudeStatusTransport func(*http.Request) (*http.Response, error)

func (transport claudeStatusTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestClaudeAPIStatusCache(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var calls atomic.Int32
		upstreamStatus, body := http.StatusOK, claudeStatusFixture
		cache := claudeStatusCache{client: &http.Client{Transport: claudeStatusTransport(func(request *http.Request) (*http.Response, error) {
			assert.Equal(t, "https://status.claude.com/api/v2/summary.json", request.URL.String())
			calls.Add(1)
			return &http.Response{StatusCode: upstreamStatus, Body: io.NopCloser(strings.NewReader(body))}, nil
		})}}

		start := time.Now()
		first, err := cache.get()
		require.NoError(t, err)
		assert.Equal(t, "operational", first.Status)
		assert.Equal(t, []ClaudeStatusIncident{{ID: "yzs0s90d8fm8", Name: "API monitoring", Status: "monitoring"}, {ID: "s7115yk4gk7m", Name: "API investigation", Status: "investigating"}}, first.Incidents)
		assert.Equal(t, start.Unix(), first.CheckedAt)
		assert.False(t, first.Stale)
		assert.Equal(t, 300, first.RefreshAfterSeconds)

		time.Sleep(5*time.Minute - 250*time.Millisecond)
		cached, err := cache.get()
		require.NoError(t, err)
		expected := first
		expected.RefreshAfterSeconds = 1
		assert.Equal(t, expected, cached)
		assert.EqualValues(t, 1, calls.Load())

		time.Sleep(250 * time.Millisecond)
		upstreamStatus = http.StatusServiceUnavailable
		var visitors sync.WaitGroup
		for range 5 {
			visitors.Go(func() {
				stale, err := cache.get()
				if assert.NoError(t, err) {
					assert.True(t, stale.Stale)
					assert.Equal(t, 60, stale.RefreshAfterSeconds)
					assert.Equal(t, first.CheckedAt, stale.CheckedAt)
					assert.Equal(t, first.Incidents, stale.Incidents)
				}
			})
		}
		visitors.Wait()
		assert.EqualValues(t, 2, calls.Load())

		upstreamStatus = http.StatusOK
		body = `{"components":[{"id":"k8w3r06qmzrp","status":"degraded_performance"}],"incidents":[]}`
		time.Sleep(59 * time.Second)
		cached, err = cache.get()
		require.NoError(t, err)
		assert.True(t, cached.Stale)
		assert.Equal(t, 1, cached.RefreshAfterSeconds)
		assert.EqualValues(t, 2, calls.Load())
		time.Sleep(time.Second)
		recovered, err := cache.get()
		require.NoError(t, err)
		assert.Equal(t, "degraded_performance", recovered.Status)
		assert.Equal(t, []ClaudeStatusIncident{}, recovered.Incidents)
		assert.False(t, recovered.Stale)
		assert.Equal(t, 300, recovered.RefreshAfterSeconds)
		assert.Equal(t, start.Add(6*time.Minute).Unix(), recovered.CheckedAt)
		assert.EqualValues(t, 3, calls.Load())
	})
}

func TestClaudeAPIStatusUnavailable(t *testing.T) {
	for _, body := range []string{`{"components":[{"id":"website","status":"operational"}]}`, `not JSON`, strings.Repeat(" ", 1<<20) + claudeStatusFixture} {
		calls := 0
		cache := claudeStatusCache{client: &http.Client{Transport: claudeStatusTransport(func(*http.Request) (*http.Response, error) {
			calls++
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}, nil
		})}}
		for range 2 {
			_, err := cache.get()
			require.Error(t, err)
		}
		assert.Equal(t, 1, calls)
	}
}
