package model

import (
	"errors"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"gorm.io/gorm"
)

// UserCacheSubsidy pairs an open campaign with the caller's grant.
type UserCacheSubsidy struct {
	Campaign UserCacheSubsidyCampaign `json:"campaign"`
	Grant    UserCacheSubsidyGrant    `json:"grant"`
}

type UserCacheSubsidyCampaign struct {
	Id                 int     `json:"id"`
	Name               string  `json:"name"`
	Description        string  `json:"description"`
	SubsidyPercent     float64 `json:"subsidy_percent"`
	IncludeCacheWrites bool    `json:"include_cache_writes"`
	WindowStart        int64   `json:"window_start"`
	WindowEnd          int64   `json:"window_end"`
	ClaimDeadline      int64   `json:"claim_deadline"`
}

type UserCacheSubsidyGrant struct {
	LogCount         int64  `json:"log_count"`
	CacheReadTokens  int64  `json:"cache_read_tokens"`
	CacheWriteTokens int64  `json:"cache_write_tokens"`
	CacheQuota       int64  `json:"cache_quota"`
	SubsidyQuota     int64  `json:"subsidy_quota"`
	Status           string `json:"status"`
	ClaimedAt        int64  `json:"claimed_at"`
}

type openCacheSubsidies struct {
	campaigns []CacheSubsidyCampaign
	err       error
	loadedAt  int64
}

var openCacheSubsidyCache atomic.Pointer[openCacheSubsidies]

func invalidateOpenCacheSubsidies() {
	openCacheSubsidyCache.Store(nil)
}

// openCacheSubsidyCampaigns returns the claimable campaigns, cached for a
// minute per node so the status endpoint and dashboards do not query them on
// every request. Claims re-check the campaign in their transaction.
func openCacheSubsidyCampaigns(now int64) ([]CacheSubsidyCampaign, error) {
	if cached := openCacheSubsidyCache.Load(); cached != nil && now-cached.loadedAt < cacheSubsidyOpenCacheSecond {
		return cached.campaigns, cached.err
	}
	var campaigns []CacheSubsidyCampaign
	err := DB.Where("status = ?", CacheSubsidyStatusOpen).Order("id").Find(&campaigns).Error
	if err != nil {
		// Remember the failure for the same minute so a broken query does not
		// run, and log, on every status request.
		common.SysError(common.LogText("failed to load open cache subsidy campaigns: %s", err.Error()))
		openCacheSubsidyCache.Store(&openCacheSubsidies{err: err, loadedAt: now})
		return nil, err
	}
	openCacheSubsidyCache.Store(&openCacheSubsidies{campaigns: campaigns, loadedAt: now})
	return campaigns, nil
}

// HasOpenCacheSubsidy reports whether any campaign is accepting claims.
func HasOpenCacheSubsidy(now int64) bool {
	campaigns, err := openCacheSubsidyCampaigns(now)
	if err != nil {
		return false
	}
	for _, campaign := range campaigns {
		if campaign.ClaimDeadline > now {
			return true
		}
	}
	return false
}

// ListUserCacheSubsidies returns the open campaigns where the user has a
// subsidy, claimed or not.
func ListUserCacheSubsidies(userId int, now int64) ([]UserCacheSubsidy, error) {
	campaigns, err := openCacheSubsidyCampaigns(now)
	if err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(campaigns))
	for _, campaign := range campaigns {
		if campaign.ClaimDeadline > now {
			ids = append(ids, campaign.Id)
		}
	}
	items := []UserCacheSubsidy{}
	if len(ids) == 0 {
		return items, nil
	}
	var grants []CacheSubsidyGrant
	err = DB.Where("campaign_id IN ? AND user_id = ? AND subsidy_quota > 0", ids, userId).Find(&grants).Error
	if err != nil {
		return nil, err
	}
	for _, campaign := range campaigns {
		for _, grant := range grants {
			if grant.CampaignId != campaign.Id {
				continue
			}
			items = append(items, UserCacheSubsidy{
				Campaign: UserCacheSubsidyCampaign{
					Id:                 campaign.Id,
					Name:               campaign.Name,
					Description:        campaign.Description,
					SubsidyPercent:     campaign.SubsidyPercent,
					IncludeCacheWrites: campaign.IncludeCacheWrites,
					WindowStart:        campaign.WindowStart,
					WindowEnd:          campaign.WindowEnd,
					ClaimDeadline:      campaign.ClaimDeadline,
				},
				Grant: UserCacheSubsidyGrant{
					LogCount:         grant.LogCount,
					CacheReadTokens:  grant.CacheReadTokens,
					CacheWriteTokens: grant.CacheWriteTokens,
					CacheQuota:       grant.CacheQuota,
					SubsidyQuota:     grant.SubsidyQuota,
					Status:           grant.Status,
					ClaimedAt:        grant.ClaimedAt,
				},
			})
		}
	}
	return items, nil
}

// ClaimCacheSubsidy credits a user's subsidy once. The grant's status flip
// and the wallet credit share one transaction, and only the transaction
// that flips pending to claimed credits anything, so repeated or concurrent
// claims pay out at most once.
func ClaimCacheSubsidy(campaignId int, userId int, now int64) (int, error) {
	var credited int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var campaign CacheSubsidyCampaign
		if err := tx.Select("id", "status", "claim_deadline").Where("id = ?", campaignId).First(&campaign).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrCacheSubsidyUnavailable
			}
			return err
		}
		if campaign.Status != CacheSubsidyStatusOpen || campaign.ClaimDeadline <= now {
			return ErrCacheSubsidyUnavailable
		}
		var grant CacheSubsidyGrant
		err := tx.Select("id", "subsidy_quota", "status").Where("campaign_id = ? AND user_id = ?", campaignId, userId).First(&grant).Error
		if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && grant.SubsidyQuota <= 0) {
			return ErrCacheSubsidyUnavailable
		}
		if err != nil {
			return err
		}
		if grant.Status == CacheSubsidyGrantClaimed {
			return ErrCacheSubsidyClaimed
		}
		if grant.SubsidyQuota > common.MaxWalletQuota {
			return ErrCacheSubsidyUnavailable
		}
		result := tx.Model(&CacheSubsidyGrant{}).
			Where("id = ? AND status = ?", grant.Id, CacheSubsidyGrantPending).
			Updates(map[string]any{"status": CacheSubsidyGrantClaimed, "claimed_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCacheSubsidyClaimed
		}
		credited = int(grant.SubsidyQuota)
		return creditTopUpQuota(tx, userId, credited, nil)
	})
	if err != nil {
		var message *common.Message
		if errors.As(err, &message) || errors.Is(err, ErrTopUpQuotaLimitExceeded) {
			return 0, err
		}
		common.SysError(common.LogText("cache subsidy claim failed: user=%d campaign=%d: %s", userId, campaignId, err.Error()))
		return 0, ErrCacheSubsidyClaimFailed
	}
	syncCreditUserQuotaCache(userId, credited, common.LogText("cache subsidy"))
	RecordLog(userId, LogTypeSystem, common.NewMessage("Cache subsidy received {{quota}}", map[string]any{"quota": logger.FormatQuota(credited)}))
	return credited, nil
}
