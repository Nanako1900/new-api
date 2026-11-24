package relay

import (
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service/contentsafety"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// unreviewedRiskKeyPrefix keeps the keys that score a review left incomplete
// by max_units apart from the keys of scored verdicts.
const unreviewedRiskKeyPrefix = "unreviewed:"

// riskVerdicts lists the non-safe verdicts among reviews, a refusal by the
// review channel included. Reviews that did not conclude score nothing.
func riskVerdicts(reviews []unitReview) []contentsafety.RiskVerdict {
	var verdicts []contentsafety.RiskVerdict
	for _, review := range reviews {
		if review.failure != "" || review.verdict.Level == contentsafety.LevelSafe {
			continue
		}
		verdicts = append(verdicts, contentsafety.RiskVerdict{Keys: []string{review.unit.Key},
			Unsafe: review.verdict.Level == contentsafety.LevelUnsafe, Category: review.verdict.Category})
	}
	return verdicts
}

// cachedRiskVerdicts lists the verdicts of the non-safe units the verdict
// cache decided.
func cachedRiskVerdicts(hits []cachedUnit) []contentsafety.RiskVerdict {
	verdicts := make([]contentsafety.RiskVerdict, len(hits))
	for i, hit := range hits {
		verdicts[i] = contentsafety.RiskVerdict{Keys: []string{hit.unit.Key}, Unsafe: hit.verdict.Level == contentsafety.LevelUnsafe, Category: hit.verdict.Category}
	}
	return verdicts
}

// unreviewedRiskVerdict scores a background review that left units unread
// because of max_units as one controversial verdict, counted again only
// when a unit that was never left unread before is.
func unreviewedRiskVerdict(skipped []string) contentsafety.RiskVerdict {
	keys := make([]string, len(skipped))
	for i, key := range skipped {
		keys[i] = unreviewedRiskKeyPrefix + key
	}
	return contentsafety.RiskVerdict{Keys: keys, Category: "other"}
}

// recordScoredReview records a review decision as recordReview does, after
// scoring its verdicts against the account in the background, so neither
// adds latency to the request. A decision that changed the score is always
// recorded, with the change. cfg is the configuration of the review plan.
func recordScoredReview(entry model.ContentSafetyLog, categories, snippets []string, cfg operation_setting.ContentSafetySetting, verdicts []contentsafety.RiskVerdict) {
	if len(verdicts) == 0 {
		recordReview(entry, categories, snippets, cfg.PassLogPercent, recordContentSafetyLog)
		return
	}
	gopool.Go(func() {
		outcome := contentsafety.ScoreRisk(cfg, entry.UserId, entry.Mode == model.ContentSafetyModeShadow, verdicts)
		entry.RiskDelta, entry.RiskScore = outcome.Delta, outcome.Score
		if encoded, ok := encodeLogLists(entry, categories, snippets); ok {
			model.RecordContentSafetyLog(encoded)
		}
	})
}

// recordFlaggedVerdicts scores the non-safe units the verdict cache decided
// and records them. A unit is recorded the first time the account sends it
// within the sighting window, or when it counted toward the score: a
// conversation resends its history on every turn.
func recordFlaggedVerdicts(c *gin.Context, info *relaycommon.RelayInfo, plan *contentReviewPlan) {
	if len(plan.flagged) == 0 {
		return
	}
	sighted := make([]bool, len(plan.flagged))
	for i, hit := range plan.flagged {
		sighted[i] = contentsafety.FirstSighting(c.Request.Context(), info.UserId, hit.unit.Key)
	}
	entry := contentSafetyLogEntry(c, info)
	entry.Mode, entry.ReviewModel, entry.CacheHit = plan.mode, plan.cfg.ReviewModel, true
	hits := plan.flagged
	gopool.Go(func() {
		outcome := contentsafety.ScoreRisk(plan.cfg, entry.UserId, entry.Mode == model.ContentSafetyModeShadow, cachedRiskVerdicts(hits))
		var reviews []unitReview
		for i, hit := range hits {
			if sighted[i] || outcome.Counted[i] {
				reviews = append(reviews, unitReview{unit: hit.unit, verdict: contentsafety.Verdict{Level: hit.verdict.Level, Category: hit.verdict.Category, Reason: hit.verdict.Reason},
					escalatedModel: hit.verdict.EscalatedModel})
			}
		}
		if len(reviews) == 0 {
			return
		}
		entry, categories, snippets := summarizeReviews(entry, reviews)
		entry.RiskDelta, entry.RiskScore = outcome.Delta, outcome.Score
		if encoded, ok := encodeLogLists(entry, categories, snippets); ok {
			model.RecordContentSafetyLog(encoded)
		}
	})
}
