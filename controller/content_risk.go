package controller

import (
	"math"
	"slices"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/contentsafety"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// contentRiskProfileItem is one account's content risk as administrators
// see it: scores decayed to now, the levels they give, and the flags.
type contentRiskProfileItem struct {
	UserId             int     `json:"user_id"`
	Username           string  `json:"username"`
	Score              float64 `json:"score"`
	Level              string  `json:"level"`
	ShadowScore        float64 `json:"shadow_score"`
	ShadowLevel        string  `json:"shadow_level"`
	WouldBlock         bool    `json:"would_block"`
	Blocked            bool    `json:"blocked"`
	BlockedAt          int64   `json:"blocked_at"`
	BlockedReason      string  `json:"blocked_reason"`
	Trusted            bool    `json:"trusted"`
	UnsafeCount        int     `json:"unsafe_count"`
	ControversialCount int     `json:"controversial_count"`
	LastEventAt        int64   `json:"last_event_at"`
	UpdatedAt          int64   `json:"updated_at"`
}

func newContentRiskProfileItem(profile model.UserRiskProfile, username string, now int64, thresholds model.RiskThresholds) contentRiskProfileItem {
	round := func(score float64) float64 { return math.Round(score*100) / 100 }
	return contentRiskProfileItem{
		UserId: profile.UserId, Username: username,
		Score: round(profile.ScoreNow(now, thresholds)), Level: profile.Level(now, thresholds),
		ShadowScore: round(profile.ShadowScoreNow(now, thresholds)), ShadowLevel: profile.ShadowLevel(now, thresholds),
		WouldBlock: profile.WouldBlock(now, thresholds), Blocked: profile.Blocked, BlockedAt: profile.BlockedAt,
		BlockedReason: profile.BlockedReason, Trusted: profile.Trusted, UnsafeCount: profile.UnsafeCount,
		ControversialCount: profile.ControversialCount, LastEventAt: profile.LastEventAt, UpdatedAt: profile.UpdatedAt,
	}
}

func contentRiskThresholds() model.RiskThresholds {
	return contentsafety.RiskThresholds(operation_setting.GetContentSafetySetting().Bounded())
}

// GetContentRiskProfiles lists account risk profiles, riskiest first, for
// administrators holding the audit read permission. username matches a
// substring of the account name.
func GetContentRiskProfiles(c *gin.Context) {
	page := common.GetPageQuery(c)
	filter := model.UserRiskProfileFilter{Level: c.Query("level"), Username: c.Query("username"), Shadow: c.Query("view") == "shadow"}
	valid := page.Page >= 1 && page.PageSize >= 1 && page.Page <= 100000000 && len(filter.Username) <= 64 &&
		slices.Contains([]string{"", "enforce", "shadow"}, c.Query("view")) &&
		slices.Contains([]string{"", model.RiskLevelNormal, model.RiskLevelWatch, model.RiskLevelRestrict, model.RiskLevelBlocked}, filter.Level)
	if raw := c.Query("user_id"); raw != "" {
		userId, err := strconv.Atoi(raw)
		valid = valid && err == nil && userId > 0
		filter.UserId = userId
	}
	if raw := c.Query("trusted"); raw != "" {
		trusted := raw == "true"
		valid = valid && (trusted || raw == "false")
		filter.Trusted = &trusted
	}
	if !valid {
		common.ApiErrorT(c, "Invalid content risk profile query")
		return
	}
	now, thresholds := common.GetTimestamp(), contentRiskThresholds()
	rows, total, err := model.ListUserRiskProfiles(filter, thresholds, now, page.GetStartIdx(), page.GetPageSize(), c.GetInt("role"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]contentRiskProfileItem, len(rows))
	for i, row := range rows {
		items[i] = newContentRiskProfileItem(row.UserRiskProfile, row.Username, now, thresholds)
	}
	page.SetItems(items)
	page.SetTotal(int(total))
	common.ApiSuccess(c, page)
}

// contentRiskTarget reads the account a risk profile route names. An account
// that does not exist, or a root account for a viewer below root, answers
// that the user does not exist.
func contentRiskTarget(c *gin.Context) (model.User, bool) {
	userId, err := strconv.Atoi(c.Param("user_id"))
	if err != nil || userId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return model.User{}, false
	}
	users := make([]model.User, 0, 1)
	if err := model.DB.Select("id", "username", "role").Where("id = ?", userId).Limit(1).Find(&users).Error; err != nil {
		common.ApiError(c, err)
		return model.User{}, false
	}
	if len(users) == 0 || (users[0].Role >= common.RoleRootUser && c.GetInt("role") < common.RoleRootUser) {
		common.ApiErrorT(c, "User does not exist")
		return model.User{}, false
	}
	return users[0], true
}

// respondContentRiskProfile answers with the stored profile of user.
func respondContentRiskProfile(c *gin.Context, user model.User) {
	profile, err := model.GetUserRiskProfile(user.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, newContentRiskProfileItem(profile, user.Username, common.GetTimestamp(), contentRiskThresholds()))
}

// GetContentRiskProfile returns one account's risk profile; an account
// without one has a zero profile.
func GetContentRiskProfile(c *gin.Context) {
	if user, ok := contentRiskTarget(c); ok {
		respondContentRiskProfile(c, user)
	}
}

// ResetContentRiskProfile clears both scores and the block of an account,
// keeping its event counts. The account's next request reads the change.
func ResetContentRiskProfile(c *gin.Context) {
	user, ok := contentRiskTarget(c)
	if !ok {
		return
	}
	if !canManageTargetRole(c.GetInt("role"), user.Role) {
		common.ApiErrorT(c, "No permission to update users of same or higher permission level")
		return
	}
	if err := model.ResetUserRiskProfile(user.Id); err != nil {
		common.ApiError(c, err)
		return
	}
	contentsafety.ForgetRiskState(user.Id)
	respondContentRiskProfile(c, user)
}

// TrustContentRiskProfile marks an account trusted or not. A trusted
// account skips the risk gate and synchronous review; its reviews still run
// in the background and score its shadow score.
func TrustContentRiskProfile(c *gin.Context) {
	user, ok := contentRiskTarget(c)
	if !ok {
		return
	}
	var request struct {
		Trusted *bool `json:"trusted"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || request.Trusted == nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if !canManageTargetRole(c.GetInt("role"), user.Role) {
		common.ApiErrorT(c, "No permission to update users of same or higher permission level")
		return
	}
	if err := model.SetUserRiskTrusted(user.Id, *request.Trusted); err != nil {
		common.ApiError(c, err)
		return
	}
	contentsafety.ForgetRiskState(user.Id)
	respondContentRiskProfile(c, user)
}
