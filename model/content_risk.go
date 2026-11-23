package model

import (
	"math"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Content risk levels, computed on read from the decayed score. Blocked is
// the sticky flag an administrator clears; for the shadow score it is the
// level an enforced review would have blocked at.
const (
	RiskLevelNormal   = "normal"
	RiskLevelWatch    = "watch"
	RiskLevelRestrict = "restrict"
	RiskLevelBlocked  = "blocked"
)

// Block reasons stored in UserRiskProfile.BlockedReason. A zero-tolerance
// block is followed by ":" and the category.
const (
	RiskBlockedReasonScore         = "score_threshold"
	RiskBlockedReasonZeroTolerance = "zero_tolerance"
)

// riskRankFloor is the rank of a zero score, below the rank of any score
// above zero.
const riskRankFloor = -1e15

// UserRiskProfile is an account's content risk. Score decays by half every
// half-life from ScoreAt; Rank is log2(Score) + ScoreAt/half-life, which keeps
// the order of decayed scores as time passes, so SQL filters and sorts by it
// without a power function. Shadow columns score reviews in shadow mode (and
// of trusted accounts) and never block anyone.
type UserRiskProfile struct {
	UserId                int     `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	Score                 float64 `json:"score"`
	ScoreAt               int64   `json:"score_at" gorm:"type:bigint"`
	Rank                  float64 `json:"rank" gorm:"index"`
	ShadowScore           float64 `json:"shadow_score"`
	ShadowScoreAt         int64   `json:"shadow_score_at" gorm:"type:bigint"`
	ShadowRank            float64 `json:"shadow_rank" gorm:"index"`
	ShadowZeroToleranceAt int64   `json:"shadow_zero_tolerance_at" gorm:"type:bigint"`
	Blocked               bool    `json:"blocked" gorm:"index"`
	BlockedAt             int64   `json:"blocked_at" gorm:"type:bigint"`
	BlockedReason         string  `json:"blocked_reason" gorm:"type:varchar(255)"`
	Trusted               bool    `json:"trusted"`
	UnsafeCount           int     `json:"unsafe_count"`
	ControversialCount    int     `json:"controversial_count"`
	LastEventAt           int64   `json:"last_event_at" gorm:"type:bigint"`
	UpdatedAt             int64   `json:"updated_at" gorm:"type:bigint"`
}

// RiskThresholds are the risk settings that decide levels, in score points
// and seconds.
type RiskThresholds struct {
	HalfLifeSeconds float64
	Watch           float64
	Restrict        float64
	Block           float64
}

// DecayedRiskScore is score, set at, as of now.
func DecayedRiskScore(score float64, at, now int64, halfLifeSeconds float64) float64 {
	if score <= 0 || halfLifeSeconds <= 0 {
		return max(score, 0)
	}
	return score * math.Exp2(-float64(max(now-at, 0))/halfLifeSeconds)
}

func riskRank(score float64, at int64, halfLifeSeconds float64) float64 {
	if score <= 0 || halfLifeSeconds <= 0 {
		return riskRankFloor
	}
	return math.Log2(score) + float64(at)/halfLifeSeconds
}

// riskRankBound is the rank at which a score decays to threshold at now.
func riskRankBound(threshold float64, now int64, halfLifeSeconds float64) float64 {
	return math.Log2(threshold) + float64(now)/halfLifeSeconds
}

// RiskLevelOf is the level of a decayed score.
func RiskLevelOf(score float64, blocked bool, thresholds RiskThresholds) string {
	switch {
	case blocked:
		return RiskLevelBlocked
	case score >= thresholds.Restrict:
		return RiskLevelRestrict
	case score >= thresholds.Watch:
		return RiskLevelWatch
	}
	return RiskLevelNormal
}

func (p UserRiskProfile) ScoreNow(now int64, thresholds RiskThresholds) float64 {
	return DecayedRiskScore(p.Score, p.ScoreAt, now, thresholds.HalfLifeSeconds)
}

func (p UserRiskProfile) ShadowScoreNow(now int64, thresholds RiskThresholds) float64 {
	return DecayedRiskScore(p.ShadowScore, p.ShadowScoreAt, now, thresholds.HalfLifeSeconds)
}

// WouldBlock reports whether the shadow score would have blocked the
// account: a zero-tolerance hit, or a score at the block threshold.
func (p UserRiskProfile) WouldBlock(now int64, thresholds RiskThresholds) bool {
	return p.ShadowZeroToleranceAt > 0 || p.ShadowScoreNow(now, thresholds) >= thresholds.Block
}

func (p UserRiskProfile) Level(now int64, thresholds RiskThresholds) string {
	return RiskLevelOf(p.ScoreNow(now, thresholds), p.Blocked, thresholds)
}

func (p UserRiskProfile) ShadowLevel(now int64, thresholds RiskThresholds) string {
	return RiskLevelOf(p.ShadowScoreNow(now, thresholds), p.WouldBlock(now, thresholds), thresholds)
}

// RiskEvent is one scored verdict on an account. Shadow scores the shadow
// columns only; ZeroTolerance blocks an enforced account at once.
type RiskEvent struct {
	UserId        int
	Shadow        bool
	Unsafe        bool
	Points        int
	ZeroTolerance bool
	Category      string
	Now           int64
	Thresholds    RiskThresholds
}

// RiskEventResult is the score before and after an event, decayed to its
// time, and whether the event blocked the account (or, in shadow, would have).
type RiskEventResult struct {
	Before       float64
	After        float64
	NewlyBlocked bool
	Profile      UserRiskProfile
}

// lockUserRiskProfile creates the profile of userId when it has none and
// locks it for the transaction.
func lockUserRiskProfile(tx *gorm.DB, userId int) (UserRiskProfile, error) {
	profile := UserRiskProfile{UserId: userId, Rank: riskRankFloor, ShadowRank: riskRankFloor, UpdatedAt: common.GetTimestamp()}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&profile).Error; err != nil {
		return profile, err
	}
	// The write also serializes SQLite transactions, where FOR UPDATE is absent.
	if err := tx.Model(&UserRiskProfile{}).Where("user_id = ?", userId).UpdateColumn("updated_at", gorm.Expr("updated_at")).Error; err != nil {
		return profile, err
	}
	err := lockForUpdate(tx).First(&profile, "user_id = ?", userId).Error
	return profile, err
}

// RecordRiskEvent adds one verdict to an account's risk in one transaction:
// the score decays to the event time, gains the points, and an enforced
// account reaching the block threshold or hitting a zero-tolerance category
// is blocked until an administrator resets it.
func RecordRiskEvent(event RiskEvent) (RiskEventResult, error) {
	var result RiskEventResult
	err := DB.Transaction(func(tx *gorm.DB) error {
		profile, err := lockUserRiskProfile(tx, event.UserId)
		if err != nil {
			return err
		}
		halfLife, now := event.Thresholds.HalfLifeSeconds, event.Now
		updates := map[string]any{"last_event_at": now, "updated_at": now}
		if event.Unsafe {
			profile.UnsafeCount++
			updates["unsafe_count"] = profile.UnsafeCount
		} else {
			profile.ControversialCount++
			updates["controversial_count"] = profile.ControversialCount
		}
		if event.Shadow {
			result.Before = DecayedRiskScore(profile.ShadowScore, profile.ShadowScoreAt, now, halfLife)
			result.After = result.Before + float64(event.Points)
			wouldBlock := profile.ShadowZeroToleranceAt > 0 || result.Before >= event.Thresholds.Block
			profile.ShadowScore, profile.ShadowScoreAt, profile.ShadowRank = result.After, now, riskRank(result.After, now, halfLife)
			updates["shadow_score"], updates["shadow_score_at"], updates["shadow_rank"] = profile.ShadowScore, profile.ShadowScoreAt, profile.ShadowRank
			if event.ZeroTolerance && profile.ShadowZeroToleranceAt == 0 {
				profile.ShadowZeroToleranceAt = now
				updates["shadow_zero_tolerance_at"] = now
			}
			result.NewlyBlocked = !wouldBlock && (profile.ShadowZeroToleranceAt > 0 || result.After >= event.Thresholds.Block)
		} else {
			result.Before = DecayedRiskScore(profile.Score, profile.ScoreAt, now, halfLife)
			result.After = result.Before + float64(event.Points)
			profile.Score, profile.ScoreAt, profile.Rank = result.After, now, riskRank(result.After, now, halfLife)
			updates["score"], updates["score_at"], updates["rank"] = profile.Score, profile.ScoreAt, profile.Rank
			if !profile.Blocked && (event.ZeroTolerance || result.After >= event.Thresholds.Block) {
				profile.Blocked, profile.BlockedAt, profile.BlockedReason = true, now, RiskBlockedReasonScore
				if event.ZeroTolerance {
					profile.BlockedReason = RiskBlockedReasonZeroTolerance + ":" + event.Category
				}
				updates["blocked"], updates["blocked_at"], updates["blocked_reason"] = true, now, profile.BlockedReason
				result.NewlyBlocked = true
			}
		}
		profile.LastEventAt, profile.UpdatedAt = now, now
		result.Profile = profile
		return tx.Model(&UserRiskProfile{}).Where("user_id = ?", event.UserId).Updates(updates).Error
	})
	return result, err
}

// ResetUserRiskProfile clears both scores, the would-block record and the
// block of userId, keeping the event counts.
func ResetUserRiskProfile(userId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if _, err := lockUserRiskProfile(tx, userId); err != nil {
			return err
		}
		now := common.GetTimestamp()
		return tx.Model(&UserRiskProfile{}).Where("user_id = ?", userId).Updates(map[string]any{
			"score": 0, "score_at": now, "rank": riskRankFloor,
			"shadow_score": 0, "shadow_score_at": now, "shadow_rank": riskRankFloor, "shadow_zero_tolerance_at": 0,
			"blocked": false, "blocked_at": 0, "blocked_reason": "", "updated_at": now,
		}).Error
	})
}

// SetUserRiskTrusted marks userId trusted or not.
func SetUserRiskTrusted(userId int, trusted bool) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if _, err := lockUserRiskProfile(tx, userId); err != nil {
			return err
		}
		return tx.Model(&UserRiskProfile{}).Where("user_id = ?", userId).
			Updates(map[string]any{"trusted": trusted, "updated_at": common.GetTimestamp()}).Error
	})
}

// GetUserRiskProfile returns the profile of userId, or a zero profile when the
// account has none.
func GetUserRiskProfile(userId int) (UserRiskProfile, error) {
	profiles := make([]UserRiskProfile, 0, 1)
	if err := DB.Where("user_id = ?", userId).Limit(1).Find(&profiles).Error; err != nil {
		return UserRiskProfile{}, err
	}
	if len(profiles) == 0 {
		return UserRiskProfile{UserId: userId, Rank: riskRankFloor, ShadowRank: riskRankFloor}, nil
	}
	return profiles[0], nil
}

// UserRiskProfileFilter selects risk profiles. Level is one of the risk
// levels or empty; Shadow filters and orders by the shadow score.
type UserRiskProfileFilter struct {
	Level    string
	Trusted  *bool
	UserId   int
	Username string
	Shadow   bool
}

// UserRiskProfileRow is a risk profile with the account's name.
type UserRiskProfileRow struct {
	UserRiskProfile
	Username string
}

// ListUserRiskProfiles pages the profiles of existing accounts matching
// filter, riskiest first. A viewer below root never sees root accounts. The
// level filter compares ranks against the rank each threshold has now, which
// matches the levels computed from decayed scores.
func ListUserRiskProfiles(filter UserRiskProfileFilter, thresholds RiskThresholds, now int64, start, limit, viewerRole int) ([]UserRiskProfileRow, int64, error) {
	start = max(start, 0)
	limit = min(max(limit, 1), 100)
	accounts := DB.Model(&User{}).Select("id")
	if viewerRole < common.RoleRootUser {
		accounts = accounts.Where("role < ?", common.RoleRootUser)
	}
	if filter.Username != "" {
		accounts = accounts.Where("username LIKE ?", "%"+filter.Username+"%")
	}
	query := DB.Model(&UserRiskProfile{}).Where("user_id IN (?)", accounts)
	if filter.UserId > 0 {
		query = query.Where("user_id = ?", filter.UserId)
	}
	if filter.Trusted != nil {
		query = query.Where("trusted = ?", *filter.Trusted)
	}
	bound := func(threshold float64) float64 { return riskRankBound(threshold, now, thresholds.HalfLifeSeconds) }
	rank, first := clause.Column{Name: "rank"}, clause.Column{Name: "blocked"}
	blocked := clause.Expression(clause.Eq{Column: first, Value: true})
	if filter.Shadow {
		rank, first = clause.Column{Name: "shadow_rank"}, clause.Column{Name: "shadow_zero_tolerance_at"}
		blocked = clause.Or(clause.Gt{Column: first, Value: 0}, clause.Gte{Column: rank, Value: bound(thresholds.Block)})
	}
	switch filter.Level {
	case RiskLevelBlocked:
		query = query.Where(blocked)
	case RiskLevelRestrict:
		query = query.Not(blocked).Where(clause.Gte{Column: rank, Value: bound(thresholds.Restrict)})
	case RiskLevelWatch:
		query = query.Not(blocked).Where(clause.Gte{Column: rank, Value: bound(thresholds.Watch)}).Where(clause.Lt{Column: rank, Value: bound(thresholds.Restrict)})
	case RiskLevelNormal:
		query = query.Not(blocked).Where(clause.Lt{Column: rank, Value: bound(thresholds.Watch)})
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	profiles := make([]UserRiskProfile, 0)
	err := query.Order(clause.OrderByColumn{Column: first, Desc: true}).Order(clause.OrderByColumn{Column: rank, Desc: true}).
		Order(clause.OrderByColumn{Column: clause.Column{Name: "user_id"}}).Offset(start).Limit(limit).Find(&profiles).Error
	if err != nil || len(profiles) == 0 {
		return []UserRiskProfileRow{}, total, err
	}
	ids := make([]int, len(profiles))
	for i, profile := range profiles {
		ids[i] = profile.UserId
	}
	var users []User
	if err := DB.Select("id", "username").Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	usernames := make(map[int]string, len(users))
	for _, user := range users {
		usernames[user.Id] = user.Username
	}
	rows := make([]UserRiskProfileRow, len(profiles))
	for i, profile := range profiles {
		rows[i] = UserRiskProfileRow{UserRiskProfile: profile, Username: usernames[profile.UserId]}
	}
	return rows, total, nil
}
