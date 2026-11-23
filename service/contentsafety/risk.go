package contentsafety

import (
	"context"
	"fmt"
	"math"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/cachex"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/samber/hot"
)

const (
	riskStateNamespace = "new-api:content_safety:risk_state:v1"
	// riskStateTTL bounds how long a node acts on a state another node
	// changed; every change deletes the shared entry at once.
	riskStateTTL = 60 * time.Second
	// riskNotifyType starts the notice type of a content risk notice, which
	// also names the event and the account, so notices about one account do
	// not use up the per-type limit of notices about others.
	riskNotifyType = "content_risk"
)

// RiskState is what a request needs to know about an account's content risk
// and age, read through one cache entry: the enforced score, the block and
// trust flags, and when and with which role the account was created.
type RiskState struct {
	Score         float64 `json:"score"`
	ScoreAt       int64   `json:"score_at"`
	Blocked       bool    `json:"blocked"`
	Trusted       bool    `json:"trusted"`
	UserCreatedAt int64   `json:"user_created_at"`
	UserRole      int     `json:"user_role"`
}

var (
	riskStateOnce  sync.Once
	riskStateCache *cachex.HybridCache[RiskState]

	riskScoredOnce sync.Once
	riskScoredMu   sync.Mutex
	riskScored     *hot.HotCache[string, bool]
)

func getRiskStateCache() *cachex.HybridCache[RiskState] {
	riskStateOnce.Do(func() {
		riskStateCache = cachex.NewHybridCache[RiskState](cachex.HybridCacheConfig[RiskState]{
			Namespace: cachex.Namespace(riskStateNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.JSONCodec[RiskState]{},
			Memory: func() *hot.HotCache[string, RiskState] {
				return hot.NewHotCache[string, RiskState](hot.LRU, 100000).WithTTL(riskStateTTL).WithJanitor().Build()
			},
		})
	})
	return riskStateCache
}

// LoadRiskState returns the risk state of userId. A miss reads the profile
// and the account by primary key; an account without a profile is cached
// as one with a zero score.
func LoadRiskState(userId int) (RiskState, error) {
	cache := getRiskStateCache()
	key := strconv.Itoa(userId)
	if state, found, err := cache.Get(key); err == nil && found {
		return state, nil
	}
	profile, err := model.GetUserRiskProfile(userId)
	if err != nil {
		return RiskState{}, err
	}
	var account struct {
		CreatedAt int64
		Role      int
	}
	if err := model.DB.Model(&model.User{}).Where("id = ?", userId).Select("created_at", "role").Scan(&account).Error; err != nil {
		return RiskState{}, err
	}
	state := RiskState{Score: profile.Score, ScoreAt: profile.ScoreAt, Blocked: profile.Blocked, Trusted: profile.Trusted,
		UserCreatedAt: account.CreatedAt, UserRole: account.Role}
	if err := cache.SetWithTTL(key, state, riskStateTTL); err != nil {
		common.SysError(common.LogText("content risk state cache write failed: %s", err.Error()))
	}
	return state, nil
}

// ForgetRiskState drops the cached risk state of userId after its profile
// changed, so the next request reads the stored one. It never writes the
// entry, which would race with other writers.
func ForgetRiskState(userId int) {
	if _, err := getRiskStateCache().DeleteMany([]string{strconv.Itoa(userId)}); err != nil {
		common.SysError(common.LogText("content risk state cache delete failed: %s", err.Error()))
	}
}

// RiskThresholds converts the risk settings into the units profiles use.
func RiskThresholds(cfg operation_setting.ContentSafetySetting) model.RiskThresholds {
	return model.RiskThresholds{
		HalfLifeSeconds: float64(cfg.RiskHalfLifeHours) * 3600,
		Watch:           float64(cfg.RiskWatchThreshold),
		Restrict:        float64(cfg.RiskRestrictThreshold),
		Block:           float64(cfg.RiskBlockThreshold),
	}
}

// Level is the enforced risk level of the state at now.
func (s RiskState) Level(now int64, thresholds model.RiskThresholds) string {
	return model.RiskLevelOf(model.DecayedRiskScore(s.Score, s.ScoreAt, now, thresholds.HalfLifeSeconds), s.Blocked, thresholds)
}

// RiskVerdict is a non-safe verdict that counts toward the risk of the
// account that sent it. It counts once per account within twice the
// half-life: when any of Keys is new for the account.
type RiskVerdict struct {
	Keys     []string
	Unsafe   bool
	Category string
}

// RiskOutcome is what ScoreRisk changed: the points added, the account's
// rounded score after the last counted verdict, and which verdicts counted.
type RiskOutcome struct {
	Delta   int
	Score   int
	Counted []bool
}

// ScoreRisk adds verdicts to the risk score of userId, one transaction each,
// and notifies administrators when one restricts or blocks the account or
// hits a zero-tolerance category. Shadow, and every verdict on a trusted
// account, scores the shadow score. Root accounts are never scored.
func ScoreRisk(userId int, shadow bool, verdicts []RiskVerdict) RiskOutcome {
	outcome := RiskOutcome{Counted: make([]bool, len(verdicts))}
	if len(verdicts) == 0 {
		return outcome
	}
	cfg := operation_setting.GetContentSafetySetting().Bounded()
	state, err := LoadRiskState(userId)
	if err != nil {
		common.SysError(common.LogText("content risk scoring of user %d failed: %s", userId, err.Error()))
		return outcome
	}
	if state.UserRole >= common.RoleRootUser {
		return outcome
	}
	shadow = shadow || state.Trusted
	thresholds := RiskThresholds(cfg)
	window := 2 * time.Duration(cfg.RiskHalfLifeHours) * time.Hour
	zeroTolerance := cfg.RiskZeroToleranceList()
	for i, verdict := range verdicts {
		if !firstRiskScoring(userId, verdict.Keys, window) {
			continue
		}
		points := cfg.RiskPointsControversial
		if verdict.Unsafe {
			points = cfg.RiskPointsUnsafe
		}
		event := model.RiskEvent{UserId: userId, Shadow: shadow, Unsafe: verdict.Unsafe, Points: points, Category: verdict.Category,
			ZeroTolerance: verdict.Unsafe && slices.Contains(zeroTolerance, verdict.Category), Now: common.GetTimestamp(), Thresholds: thresholds}
		result, err := model.RecordRiskEvent(event)
		if err != nil {
			common.SysError(common.LogText("content risk event of user %d failed: %s", userId, err.Error()))
			continue
		}
		ForgetRiskState(userId)
		outcome.Counted[i] = true
		outcome.Delta += points
		outcome.Score = int(math.Round(result.After))
		if cfg.RiskNotifyEnabled {
			notifyRiskEvent(event, result)
		}
	}
	return outcome
}

// firstRiskScoring reports whether any of keys is new for userId within
// window, and remembers them all. A Redis failure counts as new, so nothing
// is missed.
func firstRiskScoring(userId int, keys []string, window time.Duration) bool {
	fresh := false
	if common.RedisEnabled && common.RDB != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		for _, key := range keys {
			added, err := common.RDB.SetNX(ctx, fmt.Sprintf("content_safety:risk_scored:%d:%s", userId, key), 1, window).Result()
			if err != nil {
				common.SysError(common.LogText("content risk scoring check failed: %s", err.Error()))
				return true
			}
			fresh = fresh || added
		}
		return fresh
	}
	riskScoredOnce.Do(func() {
		// Entries carry their own TTL; the default sets how often the janitor runs.
		riskScored = hot.NewHotCache[string, bool](hot.LRU, 200000).WithTTL(time.Hour).WithJanitor().Build()
	})
	riskScoredMu.Lock()
	defer riskScoredMu.Unlock()
	for _, key := range keys {
		local := strconv.Itoa(userId) + ":" + key
		if _, seen, _ := riskScored.Get(local); !seen {
			riskScored.SetWithTTL(local, true, window)
			fresh = true
		}
	}
	return fresh
}

// notifyRiskEvent tells administrators that an event blocked an enforced
// account, hit a zero-tolerance category, or brought an enforced account to
// the restrict level. Notices name the account, level and category, never
// the content.
func notifyRiskEvent(event model.RiskEvent, result model.RiskEventResult) {
	subjectKey, kind := "", ""
	thresholds := event.Thresholds
	switch {
	case result.NewlyBlocked && !event.Shadow:
		subjectKey, kind = i18n.MsgContentRiskNotifyBlockedSubject, "blocked"
	case event.ZeroTolerance:
		subjectKey, kind = i18n.MsgContentRiskNotifyZeroToleranceSubject, "zero_tolerance"
	case !event.Shadow && !result.Profile.Blocked && result.Before < thresholds.Restrict && result.After >= thresholds.Restrict:
		subjectKey, kind = i18n.MsgContentRiskNotifyRestrictedSubject, "restricted"
	default:
		return
	}
	var username string
	if err := model.DB.Model(&model.User{}).Where("id = ?", event.UserId).Select("username").Scan(&username).Error; err != nil {
		common.SysError(common.LogText("content risk notice of user %d failed: %s", event.UserId, err.Error()))
	}
	level, mode := result.Profile.Level(event.Now, thresholds), operation_setting.ContentReviewModeEnforce
	if event.Shadow {
		level, mode = result.Profile.ShadowLevel(event.Now, thresholds), operation_setting.ContentReviewModeShadow
	}
	params := map[string]any{"Username": username, "Id": event.UserId, "Level": level, "Category": event.Category, "Mode": mode}
	service.NotifyContentRiskWatchers(fmt.Sprintf("%s_%s_%d", riskNotifyType, kind, event.UserId), func(lang string) (string, string) {
		return i18n.Translate(lang, subjectKey, params), i18n.Translate(lang, i18n.MsgContentRiskNotifyContent, params)
	})
}
