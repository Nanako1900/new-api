package service

import (
	"encoding/base64"
	"errors"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/shopspring/decimal"
)

// Reasons a consume log in a campaign window earns no cache subsidy. They are
// stable keys: campaigns store their counts and the admin UI translates them.
const (
	CacheSubsidySkipModel        = "model_mismatch"
	CacheSubsidySkipSubscription = "subscription"
	CacheSubsidySkipNoCache      = "no_cache"
	CacheSubsidySkipPerRequest   = "per_request"
	CacheSubsidySkipUnsupported  = "unsupported_expression"
	CacheSubsidySkipChannelTest  = "channel_test"
)

// channelTestTokenName is the token name channel tests log their usage
// under; the wallet is never charged for it.
const channelTestTokenName = "Model test"

// CacheSubsidyRules decides which part of a consume log a campaign refunds.
type CacheSubsidyRules struct {
	// ModelRules are case-insensitive globs on the billed model name, where
	// "*" matches any run of characters.
	ModelRules         []string
	IncludeCacheWrites bool
	// tiers memoizes the parsed pricing of each logged expression and tier
	// across one scan; nil disables the memo.
	tiers map[string]cacheSubsidyTier
}

type cacheSubsidyTier struct {
	prices   billingexpr.TierPrices
	usedVars map[string]bool
	err      error
}

// NewCacheSubsidyRules returns rules that parse each logged expression once.
func NewCacheSubsidyRules(modelRules []string, includeCacheWrites bool) CacheSubsidyRules {
	return CacheSubsidyRules{ModelRules: modelRules, IncludeCacheWrites: includeCacheWrites, tiers: map[string]cacheSubsidyTier{}}
}

func (rules CacheSubsidyRules) tierPricing(exprB64 string, label string) cacheSubsidyTier {
	key := exprB64 + "\x00" + label
	if cached, ok := rules.tiers[key]; ok {
		return cached
	}
	var tier cacheSubsidyTier
	exprBytes, err := base64.StdEncoding.DecodeString(exprB64)
	switch {
	case err != nil:
		tier.err = err
	case len(exprBytes) == 0:
		tier.err = errors.New("empty billing expression")
	default:
		tier.prices, tier.err = billingexpr.TierUnitPrices(string(exprBytes), label)
		if tier.err == nil {
			tier.usedVars = billingexpr.UsedVars(string(exprBytes))
		}
	}
	if rules.tiers != nil {
		rules.tiers[key] = tier
	}
	return tier
}

// CacheSubsidyLogCost is what one consume log charged for its cache tokens.
type CacheSubsidyLogCost struct {
	// CacheQuota is in quota units, at most the log's own charge.
	CacheQuota  decimal.Decimal
	ReadTokens  int64
	WriteTokens int64
}

// cacheSubsidyLogOther holds the consume-log fields that describe how the
// request was billed; see GenerateTextOtherInfo and InjectTieredBillingInfo.
type cacheSubsidyLogOther struct {
	BillingSource          string                          `json:"billing_source"`
	BillingMode            string                          `json:"billing_mode"`
	BillingUnit            string                          `json:"billing_unit"`
	UsageSemantic          string                          `json:"usage_semantic"`
	ModelPrice             *float64                        `json:"model_price"`
	ModelRatio             float64                         `json:"model_ratio"`
	GroupRatio             *float64                        `json:"group_ratio"`
	CacheTokens            int                             `json:"cache_tokens"`
	CacheRatio             float64                         `json:"cache_ratio"`
	CacheCreationTokens    int                             `json:"cache_creation_tokens"`
	CacheCreationRatio     float64                         `json:"cache_creation_ratio"`
	CacheCreationTokens5m  int                             `json:"cache_creation_tokens_5m"`
	CacheCreationRatio5m   float64                         `json:"cache_creation_ratio_5m"`
	CacheCreationTokens1h  int                             `json:"cache_creation_tokens_1h"`
	CacheCreationRatio1h   float64                         `json:"cache_creation_ratio_1h"`
	CacheCreationTokens12h int                             `json:"cache_creation_tokens_12h"`
	CacheCreationRatio12h  float64                         `json:"cache_creation_ratio_12h"`
	ExprB64                string                          `json:"expr_b64"`
	MatchedTier            string                          `json:"matched_tier"`
	RequestRules           *[]billingexpr.RequestRuleTrace `json:"request_rules"`
	BillingTokens          map[string]float64              `json:"billing_tokens"`
}

// MatchCacheSubsidyModel reports whether a billed model name matches any of
// the campaign's model globs.
func MatchCacheSubsidyModel(rules []string, modelName string) bool {
	name := strings.ToLower(modelName)
	for _, rule := range rules {
		parts := strings.Split(strings.ToLower(strings.TrimSpace(rule)), "*")
		if len(parts) == 1 {
			if parts[0] == name {
				return true
			}
			continue
		}
		rest, ok := strings.CutPrefix(name, parts[0])
		if !ok {
			continue
		}
		last := parts[len(parts)-1]
		matched := true
		for _, part := range parts[1 : len(parts)-1] {
			index := strings.Index(rest, part)
			if index < 0 {
				matched = false
				break
			}
			rest = rest[index+len(part):]
		}
		if matched && len(rest) >= len(last) && strings.HasSuffix(rest, last) {
			return true
		}
	}
	return false
}

// ComputeCacheSubsidyLogCost returns the cache charge of one consume log, or
// the reason it has none a campaign could refund. It reads only what the log
// recorded at billing time, so a later price change does not alter it.
func ComputeCacheSubsidyLogCost(log *model.Log, rules CacheSubsidyRules) (CacheSubsidyLogCost, string) {
	if !MatchCacheSubsidyModel(rules.ModelRules, log.ModelName) {
		return CacheSubsidyLogCost{}, CacheSubsidySkipModel
	}
	if log.TokenId == 0 && log.TokenName == channelTestTokenName {
		return CacheSubsidyLogCost{}, CacheSubsidySkipChannelTest
	}
	var other cacheSubsidyLogOther
	if log.Other == "" || common.UnmarshalJsonStr(log.Other, &other) != nil {
		return CacheSubsidyLogCost{}, CacheSubsidySkipUnsupported
	}
	if other.BillingSource == BillingSourceSubscription {
		return CacheSubsidyLogCost{}, CacheSubsidySkipSubscription
	}

	writeTokens := 0
	if rules.IncludeCacheWrites {
		writeTokens = max(other.CacheCreationTokens, other.CacheCreationTokens5m+other.CacheCreationTokens1h, 0)
	}
	readTokens := max(other.CacheTokens, 0)
	if log.Quota <= 0 || readTokens+writeTokens == 0 {
		return CacheSubsidyLogCost{}, CacheSubsidySkipNoCache
	}
	if other.GroupRatio == nil || *other.GroupRatio < 0 || math.IsNaN(*other.GroupRatio) {
		return CacheSubsidyLogCost{}, CacheSubsidySkipUnsupported
	}

	var cacheQuota decimal.Decimal
	switch {
	case other.BillingMode == "tiered_expr":
		quota, skip := tieredCacheQuota(log, &other, rules)
		if skip != "" {
			return CacheSubsidyLogCost{}, skip
		}
		cacheQuota = quota
	case other.ModelPrice == nil:
		return CacheSubsidyLogCost{}, CacheSubsidySkipUnsupported
	case *other.ModelPrice != -1:
		return CacheSubsidyLogCost{}, CacheSubsidySkipPerRequest
	default:
		cacheQuota = ratioCacheQuota(&other, rules.IncludeCacheWrites)
	}

	cacheQuota = decimal.Min(cacheQuota.Round(6), decimal.NewFromInt(int64(log.Quota)))
	if !cacheQuota.IsPositive() {
		return CacheSubsidyLogCost{}, CacheSubsidySkipNoCache
	}
	return CacheSubsidyLogCost{
		CacheQuota:  cacheQuota,
		ReadTokens:  int64(readTokens),
		WriteTokens: int64(writeTokens),
	}, ""
}

// ratioCacheQuota mirrors the cache terms of the ratio formula in
// calculateTextQuotaSummary.
func ratioCacheQuota(other *cacheSubsidyLogOther, includeWrites bool) decimal.Decimal {
	tokens := decimal.NewFromInt(int64(max(other.CacheTokens, 0))).Mul(decimal.NewFromFloat(other.CacheRatio))
	if includeWrites {
		creation := int64(max(other.CacheCreationTokens, 0))
		if other.CacheCreationTokens12h > 0 {
			tokens12h := int64(other.CacheCreationTokens12h)
			tokens = tokens.Add(decimal.NewFromInt(creation - tokens12h).Mul(decimal.NewFromFloat(other.CacheCreationRatio))).
				Add(decimal.NewFromInt(tokens12h).Mul(decimal.NewFromFloat(other.CacheCreationRatio12h)))
		} else {
			tokens5m := int64(max(other.CacheCreationTokens5m, 0))
			tokens1h := int64(max(other.CacheCreationTokens1h, 0))
			remaining := max(creation-tokens5m-tokens1h, 0)
			tokens = tokens.Add(decimal.NewFromInt(remaining).Mul(decimal.NewFromFloat(other.CacheCreationRatio))).
				Add(decimal.NewFromInt(tokens5m).Mul(decimal.NewFromFloat(other.CacheCreationRatio5m))).
				Add(decimal.NewFromInt(tokens1h).Mul(decimal.NewFromFloat(other.CacheCreationRatio1h)))
		}
	}
	return tokens.Mul(decimal.NewFromFloat(other.ModelRatio)).Mul(decimal.NewFromFloat(*other.GroupRatio))
}

// tieredCacheQuota prices the cache tokens with the matched tier of the
// logged expression. It compares the request's normalized token counts with
// and without its cache tokens, so cache that had no price of its own and
// was billed as input, or a long-lived write billed as a multiple of cc, is
// counted exactly as settlement counted it. A log whose rebuilt full cost
// exceeds what it was charged was billed by something the log does not
// record, so it is not priced at all.
func tieredCacheQuota(log *model.Log, other *cacheSubsidyLogOther, rules CacheSubsidyRules) (decimal.Decimal, string) {
	if other.BillingUnit == string(billingexpr.BillingUnitRequest) {
		return decimal.Zero, CacheSubsidySkipPerRequest
	}
	tier := rules.tierPricing(other.ExprB64, other.MatchedTier)
	if tier.err != nil || (tier.prices.HasRequestRules && other.RequestRules == nil) {
		return decimal.Zero, CacheSubsidySkipUnsupported
	}
	ruleMultiplier := 1.0
	if other.RequestRules != nil {
		for _, rule := range *other.RequestRules {
			if !rule.Matched {
				continue
			}
			if rule.Multiplier < 0 || math.IsNaN(rule.Multiplier) || math.IsInf(rule.Multiplier, 0) {
				return decimal.Zero, CacheSubsidySkipUnsupported
			}
			ruleMultiplier *= rule.Multiplier
		}
	}
	if math.IsInf(ruleMultiplier, 0) {
		return decimal.Zero, CacheSubsidySkipUnsupported
	}

	prices := tier.prices.Unit
	var cost, fullCost float64
	if len(other.BillingTokens) > 0 {
		cacheVars := []string{"cr", "img_cr"}
		if rules.IncludeCacheWrites {
			cacheVars = append(cacheVars, "cc", "cc1h", "cc12h")
		}
		for _, name := range cacheVars {
			price := prices[name]
			if name == "cr" && !tier.usedVars["cr"] {
				// Settlement separates cache reads only when the expression
				// prices them somewhere; otherwise they stay in the prompt.
				price = prices["p"]
			}
			cost += other.BillingTokens[name] * price
		}
		for name, price := range prices {
			fullCost += other.BillingTokens[name] * price
		}
		if cost > fullCost {
			return decimal.Zero, CacheSubsidySkipUnsupported
		}
	} else {
		isClaude := other.UsageSemantic == "anthropic"
		actual := BuildTieredTokenParams(cacheSubsidyUsage(log, other, isClaude, false, false), isClaude, tier.usedVars)
		baseline := BuildTieredTokenParams(cacheSubsidyUsage(log, other, isClaude, true, rules.IncludeCacheWrites), isClaude, tier.usedVars)
		fullCost = tierTokenCost(prices, actual)
		cost = fullCost - tierTokenCost(prices, baseline)
	}
	if math.IsNaN(cost) || math.IsInf(cost, 0) || cost <= 0 || math.IsNaN(fullCost) || math.IsInf(fullCost, 0) {
		return decimal.Zero, CacheSubsidySkipNoCache
	}
	toQuota := func(exprCost float64) decimal.Decimal {
		return decimal.NewFromFloat(exprCost).
			Div(decimal.NewFromInt(1_000_000)).
			Mul(decimal.NewFromFloat(common.QuotaPerUnit)).
			Mul(decimal.NewFromFloat(*other.GroupRatio)).
			Mul(decimal.NewFromFloat(ruleMultiplier))
	}
	// Allow for rounding and for charges outside the token prices (tool
	// surcharges); never for a rebuilt cost above the charge.
	charged := decimal.NewFromInt(int64(log.Quota))
	if toQuota(fullCost).GreaterThan(charged.Mul(decimal.NewFromFloat(1.01)).Add(decimal.NewFromInt(2))) {
		return decimal.Zero, CacheSubsidySkipUnsupported
	}
	return toQuota(cost), ""
}

// cacheSubsidyUsage rebuilds the usage settlement saw from the logged token
// counts, optionally without the cache reads or writes. OpenAI-style prompt
// totals include the cache, so removed cache tokens leave the prompt too.
func cacheSubsidyUsage(log *model.Log, other *cacheSubsidyLogOther, isClaude bool, removeReads bool, removeWrites bool) *dto.Usage {
	usage := &dto.Usage{
		PromptTokens:     log.PromptTokens,
		CompletionTokens: log.CompletionTokens,
	}
	if isClaude {
		usage.UsageSemantic = "anthropic"
	}
	if removeReads {
		if !isClaude {
			usage.PromptTokens -= other.CacheTokens
		}
	} else {
		usage.PromptTokensDetails.CachedTokens = other.CacheTokens
	}
	if removeWrites {
		if !isClaude {
			usage.PromptTokens -= other.CacheCreationTokens
		}
	} else {
		usage.PromptTokensDetails.CachedCreationTokens = other.CacheCreationTokens
		usage.ClaudeCacheCreation5mTokens = other.CacheCreationTokens5m
		usage.ClaudeCacheCreation1hTokens = other.CacheCreationTokens1h
		if other.CacheCreationTokens12h > 0 {
			usage.PromptTokensDetails.CacheWriteTokensDetails = &dto.CacheWriteTokenDetails{TTL12hTokens: other.CacheCreationTokens12h}
		}
	}
	usage.PromptTokens = max(usage.PromptTokens, 0)
	return usage
}

func tierTokenCost(prices map[string]float64, params billingexpr.TokenParams) float64 {
	values := map[string]float64{
		"p": params.P, "c": params.C, "cr": params.CR, "cc": params.CC, "cc1h": params.CC1h, "cc12h": params.CC12h,
		"img": params.Img, "img_cr": params.ImgCR, "img_o": params.ImgO, "ai": params.AI, "ao": params.AO,
	}
	var cost float64
	for name, price := range prices {
		cost += values[name] * price
	}
	return cost
}
