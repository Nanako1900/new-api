package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const referencePricingFixture = `{"success":true,"data":{"billing_mode":{"model-exact":"tiered_expr"},"billing_expr":{"model-exact":"tier(\"base\", p * 4 + c * 20)"}}}`

type referencePricingTestTransport struct {
	target    *url.URL
	transport http.RoundTripper
}

func (transport referencePricingTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	request = request.Clone(request.Context())
	request.URL.Scheme = transport.target.Scheme
	request.URL.Host = transport.target.Host
	return transport.transport.RoundTrip(request)
}

func newReferencePricingTestCache(t *testing.T, handler http.HandlerFunc, now func() time.Time) *pricingReferenceCache {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	target, err := url.Parse(server.URL)
	require.NoError(t, err)
	client := *referencePricingHTTPClient
	client.Transport = referencePricingTestTransport{target: target, transport: server.Client().Transport}
	return &pricingReferenceCache{client: &client, now: now}
}

func TestPricingReferenceCacheCachesAndRefreshes(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	var requests atomic.Int32
	cache := newReferencePricingTestCache(t, func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodGet, r.Method)
		assert.Equal(t, "/llm-metadata/api/newapi/ratio_config-v1-base.json", r.URL.Path)
		if requests.Add(1) == 1 {
			_, _ = io.WriteString(w, `{"success":true,"data":{"billing_mode":{"model-exact":"tiered_expr","free":"tiered_expr","legacy":"ratio","empty":"tiered_expr"," ":"tiered_expr"},"billing_expr":{"model-exact":"tier(\"base\", p * 4 + c * 20)","free":"tier(\"base\", p * 0)","legacy":"tier(\"base\", p * 1)","empty":"  ","missing-mode":"tier(\"base\", p * 1)"," ":"tier(\"base\", p * 1)"}}}`)
			return
		}
		_, _ = io.WriteString(w, `{"success":true,"data":{"billing_mode":{"model-exact":"tiered_expr"},"billing_expr":{"model-exact":"tier(\"base\", p * 3 + c * 15)"}}}`)
	}, func() time.Time { return now })

	first := cache.get(context.Background())
	require.Len(t, first.Models, 2)
	assert.Equal(t, PricingReferenceModel{BillingMode: "tiered_expr", BillingExpr: `tier("base", p * 4 + c * 20)`}, first.Models["model-exact"])
	assert.Equal(t, `tier("base", p * 0)`, first.Models["free"].BillingExpr)
	assert.Equal(t, "https://basellm.github.io/llm-metadata/api/newapi/ratio_config-v1-base.json", first.SourceURL)
	assert.Equal(t, "USD", first.Currency)
	assert.Equal(t, 7.3, first.USDToCNYRate)
	assert.Equal(t, int64(1_800_000_000), first.UpdatedAt)
	assert.False(t, first.Stale)
	assert.Equal(t, int32(1), requests.Load())

	delete(first.Models, "model-exact")
	now = now.Add(6*time.Hour - time.Nanosecond)
	fresh := cache.get(context.Background())
	assert.Len(t, fresh.Models, 2, "callers cannot mutate the cached snapshot")
	assert.False(t, fresh.Stale)
	assert.Equal(t, int32(1), requests.Load(), "fresh reads do not fetch the source")

	now = now.Add(time.Nanosecond)
	refreshed := cache.get(context.Background())
	assert.Equal(t, map[string]PricingReferenceModel{"model-exact": {BillingMode: "tiered_expr", BillingExpr: `tier("base", p * 3 + c * 15)`}}, refreshed.Models)
	assert.Equal(t, int64(1_800_021_600), refreshed.UpdatedAt)
	assert.False(t, refreshed.Stale)
	assert.Equal(t, int32(2), requests.Load())
}

func TestPricingReferenceCacheFailureBackoff(t *testing.T) {
	for _, warm := range []bool{false, true} {
		name := "cold"
		if warm {
			name = "previous_success"
		}
		t.Run(name, func(t *testing.T) {
			now := time.Unix(1_800_000_000, 0)
			var requests atomic.Int32
			var fail atomic.Bool
			cache := newReferencePricingTestCache(t, func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				if fail.Load() {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				_, _ = io.WriteString(w, referencePricingFixture)
			}, func() time.Time { return now })
			var previous PricingReference
			if warm {
				previous = cache.get(context.Background())
				require.False(t, previous.Stale)
				now = now.Add(6 * time.Hour)
			}

			fail.Store(true)
			stale := cache.get(context.Background())
			assert.True(t, stale.Stale)
			assert.Equal(t, previous.UpdatedAt, stale.UpdatedAt)
			if warm {
				assert.Equal(t, previous.Models, stale.Models)
			} else {
				require.NotNil(t, stale.Models)
				assert.Empty(t, stale.Models)
				encoded, err := common.Marshal(stale)
				require.NoError(t, err)
				assert.JSONEq(t, `{"source_url":"https://basellm.github.io/llm-metadata/api/newapi/ratio_config-v1-base.json","currency":"USD","usd_to_cny_rate":7.3,"updated_at":0,"stale":true,"models":{}}`, string(encoded))
			}
			attemptsAfterFailure := requests.Load()

			fail.Store(false)
			now = now.Add(time.Minute - time.Nanosecond)
			assert.Equal(t, stale, cache.get(context.Background()))
			assert.Equal(t, attemptsAfterFailure, requests.Load(), "failure retries wait for the full backoff")

			now = now.Add(time.Nanosecond)
			recovered := cache.get(context.Background())
			assert.False(t, recovered.Stale)
			assert.Equal(t, now.Unix(), recovered.UpdatedAt)
			assert.Equal(t, map[string]PricingReferenceModel{"model-exact": {BillingMode: "tiered_expr", BillingExpr: `tier("base", p * 4 + c * 20)`}}, recovered.Models)
			assert.Equal(t, attemptsAfterFailure+1, requests.Load())
		})
	}
}

func TestPricingReferenceCacheRejectsInvalidSource(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
	}{
		{name: "malformed_json", body: `{"success":true,`},
		{name: "unsuccessful", body: strings.Replace(referencePricingFixture, `"success":true`, `"success":false`, 1)},
		{name: "missing_data", body: `{"success":true}`},
		{name: "null_data", body: `{"success":true,"data":null}`},
		{name: "missing_modes", body: `{"success":true,"data":{"billing_expr":{"model-exact":"tier(\"base\", p * 4)"}}}`},
		{name: "empty_models", body: `{"success":true,"data":{"billing_mode":{},"billing_expr":{}}}`},
		{name: "wrong_expression_type", body: `{"success":true,"data":{"billing_mode":{"model-exact":"tiered_expr"},"billing_expr":{"model-exact":4}}}`},
		{name: "no_supported_modes", body: strings.Replace(referencePricingFixture, `"tiered_expr"`, `"ratio"`, 1)},
		{name: "blank_expression", body: `{"success":true,"data":{"billing_mode":{"model-exact":"tiered_expr"},"billing_expr":{"model-exact":" \t "}}}`},
		{name: "oversized_body", body: referencePricingFixture + strings.Repeat(" ", 2*1024*1024+1-len(referencePricingFixture))},
	} {
		t.Run(tc.name, func(t *testing.T) {
			now := time.Unix(1_800_000_000, 0)
			var invalid atomic.Bool
			cache := newReferencePricingTestCache(t, func(w http.ResponseWriter, r *http.Request) {
				if invalid.Load() {
					_, _ = io.WriteString(w, tc.body)
					return
				}
				_, _ = io.WriteString(w, referencePricingFixture)
			}, func() time.Time { return now })
			previous := cache.get(context.Background())
			require.False(t, previous.Stale)

			now = now.Add(6 * time.Hour)
			invalid.Store(true)
			stale := cache.get(context.Background())
			assert.True(t, stale.Stale)
			assert.Equal(t, previous.Models, stale.Models)
			assert.Equal(t, previous.UpdatedAt, stale.UpdatedAt)
		})
	}
}

func TestPricingReferenceCacheAcceptsBodyAtLimit(t *testing.T) {
	cache := newReferencePricingTestCache(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, referencePricingFixture+strings.Repeat(" ", 2*1024*1024-len(referencePricingFixture)))
	}, time.Now)
	result := cache.get(context.Background())
	assert.False(t, result.Stale)
	assert.Len(t, result.Models, 1)
}

func TestPricingReferenceCacheCoalescesColdRequests(t *testing.T) {
	var requests atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	cache := newReferencePricingTestCache(t, func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			close(started)
		}
		<-release
		_, _ = io.WriteString(w, referencePricingFixture)
	}, func() time.Time { return time.Unix(1_800_000_000, 0) })

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	firstResult := make(chan PricingReference, 1)
	go func() { firstResult <- cache.get(ctx) }()
	<-started
	cancel()
	first := <-firstResult
	assert.True(t, first.Stale, "a caller can leave while a shared fetch is pending")
	assert.Empty(t, first.Models)

	var readers sync.WaitGroup
	results := make(chan PricingReference, 8)
	for range 8 {
		readers.Go(func() { results <- cache.get(context.Background()) })
	}
	releaseOnce.Do(func() { close(release) })
	readers.Wait()
	close(results)
	for result := range results {
		assert.False(t, result.Stale, "one caller's cancellation must not cancel the shared fetch")
		assert.Equal(t, `tier("base", p * 4 + c * 20)`, result.Models["model-exact"].BillingExpr)
	}
	assert.Equal(t, int32(1), requests.Load())
}

func TestPricingReferenceCacheDoesNotFollowRedirects(t *testing.T) {
	var requests atomic.Int32
	cache := newReferencePricingTestCache(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path == "/redirected" {
			_, _ = io.WriteString(w, referencePricingFixture)
			return
		}
		http.Redirect(w, r, "/redirected", http.StatusFound)
	}, time.Now)
	result := cache.get(context.Background())
	assert.True(t, result.Stale)
	assert.Empty(t, result.Models)
	assert.Equal(t, int32(1), requests.Load(), "reference requests stay pinned to the supplied URL")
}
