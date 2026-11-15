package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	pricingReferenceSourceURL = "https://basellm.github.io/llm-metadata/api/newapi/ratio_config-v1-base.json"
	pricingReferenceTTL       = 6 * time.Hour
	pricingReferenceBackoff   = time.Minute
	pricingReferenceMaxBytes  = 2 * 1024 * 1024
)

type PricingReferenceModel struct {
	BillingMode string `json:"billing_mode"`
	BillingExpr string `json:"billing_expr"`
}

// PricingReference is comparison data only. Its exchange rate never participates
// in configured prices, quota conversion, or settlement.
type PricingReference struct {
	SourceURL    string                           `json:"source_url"`
	Currency     string                           `json:"currency"`
	USDToCNYRate float64                          `json:"usd_to_cny_rate"`
	UpdatedAt    int64                            `json:"updated_at"`
	Stale        bool                             `json:"stale"`
	Models       map[string]PricingReferenceModel `json:"models"`
}

var referencePricingHTTPClient = &http.Client{
	Timeout: 5 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

var referencePricingCache = pricingReferenceCache{
	client: referencePricingHTTPClient,
	now:    time.Now,
}

type pricingReferenceCache struct {
	mu          sync.Mutex
	client      *http.Client
	now         func() time.Time
	models      map[string]PricingReferenceModel
	updatedAt   time.Time
	nextAttempt time.Time
	loading     chan struct{}
}

// GetPricingReference returns a cached reference feed independently of the
// configured pricing catalog. A failed fetch retains the last successful feed.
func GetPricingReference(ctx context.Context) PricingReference {
	return referencePricingCache.get(ctx)
}

func (cache *pricingReferenceCache) get(ctx context.Context) PricingReference {
	cache.mu.Lock()
	if ctx.Err() != nil || cache.now().Before(cache.nextAttempt) {
		defer cache.mu.Unlock()
		return cache.snapshotLocked()
	}
	if cache.loading == nil {
		cache.loading = make(chan struct{})
		// The bounded fetch is shared; one caller leaving must not cancel it.
		go cache.refresh()
	}
	done := cache.loading
	cache.mu.Unlock()

	select {
	case <-done:
	case <-ctx.Done():
	}
	cache.mu.Lock()
	defer cache.mu.Unlock()
	return cache.snapshotLocked()
}

func (cache *pricingReferenceCache) snapshotLocked() PricingReference {
	models := maps.Clone(cache.models)
	if models == nil {
		models = make(map[string]PricingReferenceModel)
	}
	var updatedAt int64
	if !cache.updatedAt.IsZero() {
		updatedAt = cache.updatedAt.Unix()
	}
	return PricingReference{
		SourceURL:    pricingReferenceSourceURL,
		Currency:     "USD",
		USDToCNYRate: 7.3,
		UpdatedAt:    updatedAt,
		Stale:        cache.updatedAt.IsZero() || !cache.now().Before(cache.updatedAt.Add(pricingReferenceTTL)),
		Models:       models,
	}
}

func (cache *pricingReferenceCache) refresh() {
	models, err := cache.fetch()
	cache.mu.Lock()
	defer cache.mu.Unlock()
	now := cache.now()
	if err == nil {
		cache.models = models
		cache.updatedAt = now
		cache.nextAttempt = now.Add(pricingReferenceTTL)
	} else {
		cache.nextAttempt = now.Add(pricingReferenceBackoff)
	}
	close(cache.loading)
	cache.loading = nil
}

func (cache *pricingReferenceCache) fetch() (map[string]PricingReferenceModel, error) {
	response, err := cache.client.Get(pricingReferenceSourceURL)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("reference pricing source returned HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, pricingReferenceMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > pricingReferenceMaxBytes {
		return nil, errors.New("reference pricing source exceeded the response size limit")
	}
	var source struct {
		Success bool `json:"success"`
		Data    struct {
			BillingMode map[string]string `json:"billing_mode"`
			BillingExpr map[string]string `json:"billing_expr"`
		} `json:"data"`
	}
	if err := common.Unmarshal(body, &source); err != nil {
		return nil, err
	}
	if !source.Success {
		return nil, errors.New("reference pricing source reported failure")
	}
	models := make(map[string]PricingReferenceModel, len(source.Data.BillingExpr))
	for name, expression := range source.Data.BillingExpr {
		if strings.TrimSpace(name) == "" || strings.TrimSpace(expression) == "" || source.Data.BillingMode[name] != "tiered_expr" {
			continue
		}
		models[name] = PricingReferenceModel{BillingMode: "tiered_expr", BillingExpr: expression}
	}
	if len(models) == 0 {
		return nil, errors.New("reference pricing source contained no supported models")
	}
	return models, nil
}
