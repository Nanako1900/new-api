package model

import (
	"errors"
	"maps"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// Campaign lifecycle: draft → queued → calculating → calculated → open →
// closed. Only draft campaigns change their rules; a calculated campaign can
// be reset to draft, which discards its grants.
const (
	CacheSubsidyStatusDraft       = "draft"
	CacheSubsidyStatusQueued      = "queued"
	CacheSubsidyStatusCalculating = "calculating"
	CacheSubsidyStatusCalculated  = "calculated"
	CacheSubsidyStatusOpen        = "open"
	CacheSubsidyStatusClosed      = "closed"

	CacheSubsidyGrantPending = "pending"
	CacheSubsidyGrantClaimed = "claimed"

	// CacheSubsidyWindowSettleSeconds is how long a window must have been
	// closed before it is scanned, so no consume log is still landing in it.
	CacheSubsidyWindowSettleSeconds = 5 * 60

	cacheSubsidyMaxModelRules   = 50
	cacheSubsidyMaxWindow       = 366 * 24 * 60 * 60
	cacheSubsidyGrantBatchSize  = 500
	cacheSubsidyMaxErrorLength  = 255
	cacheSubsidyOpenCacheSecond = 60
)

var (
	ErrCacheSubsidyNotFound     = common.NewMessage("Cache subsidy campaign not found")
	ErrCacheSubsidyUnavailable  = common.NewMessage("Cache subsidy is not available")
	ErrCacheSubsidyClaimed      = common.NewMessage("Cache subsidy already claimed")
	ErrCacheSubsidyClaimFailed  = common.NewMessage("Cache subsidy claim failed, please try again later")
	ErrCacheSubsidyRulesLocked  = common.NewMessage("Campaign rules can only be edited in draft status")
	ErrCacheSubsidyWindowOpen   = common.NewMessage("The campaign window must have ended at least 5 minutes ago")
	ErrCacheSubsidyInvalid      = common.NewMessage("Invalid cache subsidy campaign settings")
	ErrCacheSubsidyBadStatus    = common.NewMessage("This action is not allowed in the campaign's current status")
	ErrCacheSubsidyScanConflict = errors.New("cache subsidy campaign changed during calculation")
)

// CacheSubsidyCampaign refunds part of the cache cost users paid inside a
// time window. Totals and counters describe the latest calculation.
type CacheSubsidyCampaign struct {
	Id                 int     `json:"id"`
	Name               string  `json:"name" gorm:"type:varchar(128);not null"`
	Description        string  `json:"description" gorm:"type:text"`
	Status             string  `json:"status" gorm:"type:varchar(16);not null;index"`
	WindowStart        int64   `json:"window_start" gorm:"bigint;not null;default:0"`
	WindowEnd          int64   `json:"window_end" gorm:"bigint;not null;default:0"`
	ModelRules         string  `json:"-" gorm:"type:text"`
	IncludeCacheWrites bool    `json:"include_cache_writes"`
	SubsidyPercent     float64 `json:"subsidy_percent" gorm:"not null;default:0"`
	ClaimDeadline      int64   `json:"claim_deadline" gorm:"bigint;not null;default:0"`
	PerUserCapQuota    int64   `json:"per_user_cap_quota" gorm:"not null;default:0"`
	MinSubsidyQuota    int64   `json:"min_subsidy_quota" gorm:"not null;default:0"`
	// The scan cursor is the last log read: (created_at, id) on SQL log
	// databases and (created_at, request_id) on ClickHouse.
	CursorCreatedAt int64  `json:"-" gorm:"bigint;not null;default:0"`
	CursorId        int64  `json:"-" gorm:"bigint;not null;default:0"`
	CursorRequestId string `json:"-" gorm:"type:varchar(64);not null;default:''"`
	ScanCompletedAt int64  `json:"-" gorm:"bigint;not null;default:0"`
	// CalcGeneration counts calculations; a runner only writes for the
	// generation it started, so one still running after a reset changes
	// nothing.
	CalcGeneration    int64  `json:"-" gorm:"bigint;not null;default:0"`
	LastError         string `json:"last_error" gorm:"type:varchar(255);not null;default:''"`
	ScannedLogs       int64  `json:"scanned_logs" gorm:"not null;default:0"`
	MatchedLogs       int64  `json:"matched_logs" gorm:"not null;default:0"`
	SkippedLogs       int64  `json:"skipped_logs" gorm:"not null;default:0"`
	SkipReasons       string `json:"-" gorm:"type:text"`
	EligibleUsers     int64  `json:"eligible_users" gorm:"not null;default:0"`
	TotalCacheQuota   int64  `json:"total_cache_quota" gorm:"not null;default:0"`
	TotalSubsidyQuota int64  `json:"total_subsidy_quota" gorm:"not null;default:0"`
	CalculatedAt      int64  `json:"calculated_at" gorm:"bigint;not null;default:0"`
	OpenedAt          int64  `json:"opened_at" gorm:"bigint;not null;default:0"`
	ClosedAt          int64  `json:"closed_at" gorm:"bigint;not null;default:0"`
	CreatedAt         int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt         int64  `json:"updated_at" gorm:"bigint"`
}

// CacheSubsidyGrant is one user's result in one campaign.
type CacheSubsidyGrant struct {
	Id               int    `json:"id"`
	CampaignId       int    `json:"campaign_id" gorm:"not null;uniqueIndex:idx_cache_subsidy_grant_user,priority:1;index:idx_cache_subsidy_grant_status,priority:1"`
	UserId           int    `json:"user_id" gorm:"not null;uniqueIndex:idx_cache_subsidy_grant_user,priority:2"`
	Username         string `json:"username" gorm:"type:varchar(64);not null;default:''"`
	LogCount         int64  `json:"log_count" gorm:"not null;default:0"`
	CacheReadTokens  int64  `json:"cache_read_tokens" gorm:"not null;default:0"`
	CacheWriteTokens int64  `json:"cache_write_tokens" gorm:"not null;default:0"`
	CacheQuota       int64  `json:"cache_quota" gorm:"not null;default:0"`
	SubsidyQuota     int64  `json:"subsidy_quota" gorm:"not null;default:0"`
	Status           string `json:"status" gorm:"type:varchar(16);not null;index:idx_cache_subsidy_grant_status,priority:2"`
	ClaimedAt        int64  `json:"claimed_at" gorm:"bigint;not null;default:0"`
}

// CacheSubsidyCampaignInput is the part of a campaign an administrator sets.
type CacheSubsidyCampaignInput struct {
	Name               string   `json:"name"`
	Description        string   `json:"description"`
	WindowStart        int64    `json:"window_start"`
	WindowEnd          int64    `json:"window_end"`
	ModelRules         []string `json:"model_rules"`
	IncludeCacheWrites bool     `json:"include_cache_writes"`
	SubsidyPercent     float64  `json:"subsidy_percent"`
	ClaimDeadline      int64    `json:"claim_deadline"`
	PerUserCapQuota    int64    `json:"per_user_cap_quota"`
	MinSubsidyQuota    int64    `json:"min_subsidy_quota"`
}

// CacheSubsidyCampaignView is the admin representation of a campaign.
type CacheSubsidyCampaignView struct {
	CacheSubsidyCampaign
	ModelRules   []string         `json:"model_rules"`
	SkipReasons  map[string]int64 `json:"skip_reasons"`
	Progress     int              `json:"progress"`
	ClaimedUsers int64            `json:"claimed_users"`
	ClaimedQuota int64            `json:"claimed_quota"`
}

func (c *CacheSubsidyCampaign) BeforeCreate(_ *gorm.DB) error {
	now := common.GetTimestamp()
	c.CreatedAt = now
	c.UpdatedAt = now
	return nil
}

// Rules returns the campaign's model globs.
func (c *CacheSubsidyCampaign) Rules() []string {
	var rules []string
	_ = common.UnmarshalJsonStr(c.ModelRules, &rules)
	return rules
}

// ScanSkipReasons returns the skip counts of the latest calculation.
func (c *CacheSubsidyCampaign) ScanSkipReasons() map[string]int64 {
	reasons := map[string]int64{}
	if c.SkipReasons != "" {
		_ = common.UnmarshalJsonStr(c.SkipReasons, &reasons)
	}
	return reasons
}

// ScanProgress estimates calculation progress from how far the cursor has
// moved through the window.
func (c *CacheSubsidyCampaign) ScanProgress() int {
	switch c.Status {
	case CacheSubsidyStatusDraft, CacheSubsidyStatusQueued:
		return 0
	case CacheSubsidyStatusCalculating:
	default:
		return 100
	}
	if c.ScanCompletedAt > 0 || c.WindowEnd <= c.WindowStart {
		return 99
	}
	if c.CursorCreatedAt <= c.WindowStart {
		return 0
	}
	return int(min(99, (c.CursorCreatedAt-c.WindowStart)*100/(c.WindowEnd-c.WindowStart)))
}

// SubsidyFor turns a user's cache cost into the subsidy the campaign grants.
func (c *CacheSubsidyCampaign) SubsidyFor(cacheQuota int64) int64 {
	if cacheQuota <= 0 {
		return 0
	}
	subsidy := decimal.NewFromInt(cacheQuota).Mul(decimal.NewFromFloat(c.SubsidyPercent)).Div(decimal.NewFromInt(100)).Floor()
	subsidy = decimal.Min(subsidy, decimal.NewFromInt(common.MaxWalletQuota))
	quota, err := common.WalletQuotaFromDecimalStrict(subsidy)
	if err != nil {
		return 0
	}
	amount := int64(quota)
	if c.PerUserCapQuota > 0 {
		amount = min(amount, c.PerUserCapQuota)
	}
	if amount < max(c.MinSubsidyQuota, 1) {
		return 0
	}
	return amount
}

func (input CacheSubsidyCampaignInput) normalized() (CacheSubsidyCampaignInput, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	rules := make([]string, 0, len(input.ModelRules))
	for _, rule := range input.ModelRules {
		rule = strings.TrimSpace(rule)
		if rule == "" || utf8.RuneCountInString(rule) > 128 || slices.Contains(rules, rule) {
			continue
		}
		rules = append(rules, rule)
	}
	input.ModelRules = rules
	percentExponent := decimal.NewFromFloat(input.SubsidyPercent).Exponent()
	if input.Name == "" || utf8.RuneCountInString(input.Name) > 128 ||
		utf8.RuneCountInString(input.Description) > 2000 ||
		input.WindowStart <= 0 || input.WindowEnd <= input.WindowStart ||
		input.WindowEnd-input.WindowStart > cacheSubsidyMaxWindow ||
		len(rules) == 0 || len(rules) > cacheSubsidyMaxModelRules ||
		!(input.SubsidyPercent > 0 && input.SubsidyPercent <= 100) || percentExponent < -2 ||
		input.ClaimDeadline <= input.WindowEnd ||
		input.PerUserCapQuota < 0 || input.PerUserCapQuota > common.MaxWalletQuota ||
		input.MinSubsidyQuota < 0 || input.MinSubsidyQuota > common.MaxWalletQuota ||
		(input.PerUserCapQuota > 0 && input.MinSubsidyQuota > input.PerUserCapQuota) {
		return input, ErrCacheSubsidyInvalid
	}
	return input, nil
}

func (input CacheSubsidyCampaignInput) sameRules(c *CacheSubsidyCampaign) bool {
	return input.WindowStart == c.WindowStart && input.WindowEnd == c.WindowEnd &&
		slices.Equal(input.ModelRules, c.Rules()) && input.IncludeCacheWrites == c.IncludeCacheWrites &&
		input.SubsidyPercent == c.SubsidyPercent && input.PerUserCapQuota == c.PerUserCapQuota &&
		input.MinSubsidyQuota == c.MinSubsidyQuota
}

func CreateCacheSubsidyCampaign(input CacheSubsidyCampaignInput) (*CacheSubsidyCampaign, error) {
	input, err := input.normalized()
	if err != nil {
		return nil, err
	}
	rules, err := common.Marshal(input.ModelRules)
	if err != nil {
		return nil, err
	}
	campaign := &CacheSubsidyCampaign{
		Name:               input.Name,
		Description:        input.Description,
		Status:             CacheSubsidyStatusDraft,
		WindowStart:        input.WindowStart,
		WindowEnd:          input.WindowEnd,
		ModelRules:         string(rules),
		IncludeCacheWrites: input.IncludeCacheWrites,
		SubsidyPercent:     input.SubsidyPercent,
		ClaimDeadline:      input.ClaimDeadline,
		PerUserCapQuota:    input.PerUserCapQuota,
		MinSubsidyQuota:    input.MinSubsidyQuota,
		SkipReasons:        "{}",
	}
	if err := DB.Create(campaign).Error; err != nil {
		return nil, err
	}
	return campaign, nil
}

// UpdateCacheSubsidyCampaign saves an edit. Name, description and claim
// deadline can change at any time; the rules only while the campaign is a
// draft, because grants were computed from them.
func UpdateCacheSubsidyCampaign(id int, input CacheSubsidyCampaignInput) (*CacheSubsidyCampaign, error) {
	campaign, err := GetCacheSubsidyCampaign(id)
	if err != nil {
		return nil, err
	}
	input, err = input.normalized()
	if err != nil {
		return nil, err
	}
	updates := map[string]any{
		"name":           input.Name,
		"description":    input.Description,
		"claim_deadline": input.ClaimDeadline,
		"updated_at":     common.GetTimestamp(),
	}
	if !input.sameRules(campaign) {
		if campaign.Status != CacheSubsidyStatusDraft {
			return nil, ErrCacheSubsidyRulesLocked
		}
		rules, err := common.Marshal(input.ModelRules)
		if err != nil {
			return nil, err
		}
		updates["window_start"] = input.WindowStart
		updates["window_end"] = input.WindowEnd
		updates["model_rules"] = string(rules)
		updates["include_cache_writes"] = input.IncludeCacheWrites
		updates["subsidy_percent"] = input.SubsidyPercent
		updates["per_user_cap_quota"] = input.PerUserCapQuota
		updates["min_subsidy_quota"] = input.MinSubsidyQuota
	}
	result := DB.Model(&CacheSubsidyCampaign{}).Where("id = ? AND status = ?", id, campaign.Status).Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	invalidateOpenCacheSubsidies()
	updated, err := GetCacheSubsidyCampaign(id)
	if err != nil {
		return nil, err
	}
	// MySQL reports zero rows for an update that changes nothing, so only a
	// status that moved meanwhile means the edit was not applied.
	if result.RowsAffected == 0 && updated.Status != campaign.Status {
		return nil, ErrCacheSubsidyBadStatus
	}
	return updated, nil
}

func GetCacheSubsidyCampaign(id int) (*CacheSubsidyCampaign, error) {
	var campaign CacheSubsidyCampaign
	err := DB.Where("id = ?", id).First(&campaign).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrCacheSubsidyNotFound
	}
	if err != nil {
		return nil, err
	}
	return &campaign, nil
}

func ListCacheSubsidyCampaigns(keyword string, offset int, limit int) ([]*CacheSubsidyCampaign, int64, error) {
	tx := DB.Model(&CacheSubsidyCampaign{})
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		pattern, err := cacheSubsidyLikePattern(keyword)
		if err != nil {
			return nil, 0, err
		}
		tx = tx.Where("name LIKE ? ESCAPE '!'", pattern)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var campaigns []*CacheSubsidyCampaign
	err := tx.Order("id desc").Offset(offset).Limit(limit).Find(&campaigns).Error
	return campaigns, total, err
}

// CacheSubsidyCampaignViews adds rules, progress and claim totals, reading the
// claim totals of all campaigns in one grouped query.
func CacheSubsidyCampaignViews(campaigns []*CacheSubsidyCampaign) ([]CacheSubsidyCampaignView, error) {
	ids := make([]int, 0, len(campaigns))
	for _, campaign := range campaigns {
		ids = append(ids, campaign.Id)
	}
	type claimedRow struct {
		CampaignId int
		Users      int64
		Quota      int64
	}
	var rows []claimedRow
	if len(ids) > 0 {
		err := DB.Model(&CacheSubsidyGrant{}).
			Select("campaign_id, COUNT(*) AS users, COALESCE(SUM(subsidy_quota), 0) AS quota").
			Where("campaign_id IN ? AND status = ?", ids, CacheSubsidyGrantClaimed).
			Group("campaign_id").Scan(&rows).Error
		if err != nil {
			return nil, err
		}
	}
	views := make([]CacheSubsidyCampaignView, 0, len(campaigns))
	for _, campaign := range campaigns {
		view := CacheSubsidyCampaignView{
			CacheSubsidyCampaign: *campaign,
			ModelRules:           campaign.Rules(),
			SkipReasons:          campaign.ScanSkipReasons(),
			Progress:             campaign.ScanProgress(),
		}
		for _, row := range rows {
			if row.CampaignId == campaign.Id {
				view.ClaimedUsers = row.Users
				view.ClaimedQuota = row.Quota
			}
		}
		views = append(views, view)
	}
	return views, nil
}

// transitionCacheSubsidyCampaign moves a campaign that is in one of from to
// status to. The status predicate makes concurrent transitions exclusive.
func transitionCacheSubsidyCampaign(tx *gorm.DB, id int, from []string, to string, updates map[string]any) error {
	fields := map[string]any{"status": to, "updated_at": common.GetTimestamp()}
	maps.Copy(fields, updates)
	result := tx.Model(&CacheSubsidyCampaign{}).Where("id = ? AND status IN ?", id, from).Updates(fields)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var count int64
	if err := tx.Model(&CacheSubsidyCampaign{}).Where("id = ?", id).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return ErrCacheSubsidyNotFound
	}
	return ErrCacheSubsidyBadStatus
}

func resetCacheSubsidyScan() map[string]any {
	return map[string]any{
		"cursor_created_at": 0, "cursor_id": 0, "cursor_request_id": "", "scan_completed_at": 0,
		"scanned_logs": 0, "matched_logs": 0, "skipped_logs": 0, "skip_reasons": "{}",
		"eligible_users": 0, "total_cache_quota": 0, "total_subsidy_quota": 0, "calculated_at": 0,
		"last_error": "",
	}
}

// QueueCacheSubsidyCalculation schedules a draft whose window has closed.
func QueueCacheSubsidyCalculation(id int, now int64) error {
	campaign, err := GetCacheSubsidyCampaign(id)
	if err != nil {
		return err
	}
	if campaign.Status != CacheSubsidyStatusDraft {
		return ErrCacheSubsidyBadStatus
	}
	if campaign.WindowEnd > now-CacheSubsidyWindowSettleSeconds {
		return ErrCacheSubsidyWindowOpen
	}
	updates := resetCacheSubsidyScan()
	updates["calc_generation"] = gorm.Expr("calc_generation + 1")
	return transitionCacheSubsidyCampaign(DB, id, []string{CacheSubsidyStatusDraft}, CacheSubsidyStatusQueued, updates)
}

// ResetCacheSubsidyCampaign returns an unopened campaign to draft and drops
// its grants in the same transaction. A calculation still running loses its
// next cursor update.
func ResetCacheSubsidyCampaign(id int) error {
	from := []string{CacheSubsidyStatusQueued, CacheSubsidyStatusCalculating, CacheSubsidyStatusCalculated}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := transitionCacheSubsidyCampaign(tx, id, from, CacheSubsidyStatusDraft, resetCacheSubsidyScan()); err != nil {
			return err
		}
		return tx.Where("campaign_id = ?", id).Delete(&CacheSubsidyGrant{}).Error
	})
}

func OpenCacheSubsidyCampaign(id int, now int64) error {
	campaign, err := GetCacheSubsidyCampaign(id)
	if err != nil {
		return err
	}
	if campaign.Status != CacheSubsidyStatusCalculated || campaign.ClaimDeadline <= now {
		return ErrCacheSubsidyBadStatus
	}
	err = transitionCacheSubsidyCampaign(DB, id, []string{CacheSubsidyStatusCalculated}, CacheSubsidyStatusOpen, map[string]any{"opened_at": now})
	invalidateOpenCacheSubsidies()
	return err
}

func CloseCacheSubsidyCampaign(id int, now int64) error {
	err := transitionCacheSubsidyCampaign(DB, id, []string{CacheSubsidyStatusOpen}, CacheSubsidyStatusClosed, map[string]any{"closed_at": now})
	invalidateOpenCacheSubsidies()
	return err
}

// DeleteCacheSubsidyCampaign removes a campaign that never opened, with its
// grants. Campaigns that took claims stay as the record of what was paid.
func DeleteCacheSubsidyCampaign(id int) error {
	from := []string{CacheSubsidyStatusDraft, CacheSubsidyStatusCalculated}
	return DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Where("id = ? AND status IN ? AND opened_at = 0", id, from).Delete(&CacheSubsidyCampaign{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			var count int64
			if err := tx.Model(&CacheSubsidyCampaign{}).Where("id = ?", id).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				return ErrCacheSubsidyNotFound
			}
			return ErrCacheSubsidyBadStatus
		}
		return tx.Where("campaign_id = ?", id).Delete(&CacheSubsidyGrant{}).Error
	})
}

func ListCacheSubsidyGrants(campaignId int, keyword string, status string, offset int, limit int) ([]*CacheSubsidyGrant, int64, error) {
	tx := DB.Model(&CacheSubsidyGrant{}).Where("campaign_id = ?", campaignId)
	if status == CacheSubsidyGrantPending || status == CacheSubsidyGrantClaimed {
		tx = tx.Where("status = ?", status)
	}
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		pattern, err := cacheSubsidyLikePattern(keyword)
		if err != nil {
			return nil, 0, err
		}
		if userId, convErr := strconv.Atoi(keyword); convErr == nil {
			tx = tx.Where("user_id = ? OR username LIKE ? ESCAPE '!'", userId, pattern)
		} else {
			tx = tx.Where("username LIKE ? ESCAPE '!'", pattern)
		}
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var grants []*CacheSubsidyGrant
	err := tx.Order("subsidy_quota desc, id").Offset(offset).Limit(limit).Find(&grants).Error
	return grants, total, err
}

// cacheSubsidyLikePattern matches keyword anywhere unless the admin placed
// the % wildcards themselves.
func cacheSubsidyLikePattern(keyword string) (string, error) {
	pattern, err := sanitizeLikePattern(keyword)
	if err != nil || strings.Contains(keyword, "%") {
		return pattern, err
	}
	return "%" + pattern + "%", nil
}
