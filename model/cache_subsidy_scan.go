package model

import (
	"errors"
	"slices"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// CacheSubsidyGrantDelta is one user's share of one scanned log batch.
type CacheSubsidyGrantDelta struct {
	Username         string
	LogCount         int64
	CacheReadTokens  int64
	CacheWriteTokens int64
	CacheQuota       int64
}

// CacheSubsidyScanBatch is the outcome of scanning the logs after a
// campaign's cursor. Counters are increments; SkipReasons is the new total.
type CacheSubsidyScanBatch struct {
	CursorCreatedAt int64
	CursorId        int64
	CursorRequestId string
	Done            bool
	Scanned         int64
	Matched         int64
	Skipped         int64
	SkipReasons     map[string]int64
	Grants          map[int]CacheSubsidyGrantDelta
}

// HasPendingCacheSubsidyCalculation reports queued or unfinished campaigns.
func HasPendingCacheSubsidyCalculation() (bool, error) {
	var count int64
	err := DB.Model(&CacheSubsidyCampaign{}).
		Where("status IN ?", []string{CacheSubsidyStatusQueued, CacheSubsidyStatusCalculating}).
		Count(&count).Error
	return count > 0, err
}

// StartNextCacheSubsidyCalculation returns the campaign to calculate next:
// an unfinished one first, otherwise the oldest queued one, which it marks
// calculating. It returns nil when nothing is waiting.
func StartNextCacheSubsidyCalculation() (*CacheSubsidyCampaign, error) {
	for {
		var campaign CacheSubsidyCampaign
		err := DB.Where("status = ?", CacheSubsidyStatusCalculating).Order("id").First(&campaign).Error
		if err == nil {
			return &campaign, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		err = DB.Where("status = ?", CacheSubsidyStatusQueued).Order("id").First(&campaign).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		// A fresh calculation starts from no grants, even if an earlier one
		// left some behind.
		err = DB.Transaction(func(tx *gorm.DB) error {
			if err := transitionCacheSubsidyCampaign(tx, campaign.Id, []string{CacheSubsidyStatusQueued}, CacheSubsidyStatusCalculating, nil); err != nil {
				return err
			}
			return tx.Where("campaign_id = ?", campaign.Id).Delete(&CacheSubsidyGrant{}).Error
		})
		if errors.Is(err, ErrCacheSubsidyBadStatus) || errors.Is(err, ErrCacheSubsidyNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		campaign.Status = CacheSubsidyStatusCalculating
		return &campaign, nil
	}
}

// ApplyCacheSubsidyScanBatch adds one batch to the grants and moves the
// cursor in one transaction. The cursor update only succeeds from the cursor
// the batch was read after, so a batch is counted exactly once even if two
// runners race or a runner resumes after a crash. On success campaign holds
// the new cursor and counters.
func ApplyCacheSubsidyScanBatch(campaign *CacheSubsidyCampaign, batch CacheSubsidyScanBatch) error {
	reasons, err := common.Marshal(batch.SkipReasons)
	if err != nil {
		return err
	}
	now := common.GetTimestamp()
	updates := map[string]any{
		"cursor_created_at": batch.CursorCreatedAt,
		"cursor_id":         batch.CursorId,
		"cursor_request_id": batch.CursorRequestId,
		"scanned_logs":      campaign.ScannedLogs + batch.Scanned,
		"matched_logs":      campaign.MatchedLogs + batch.Matched,
		"skipped_logs":      campaign.SkippedLogs + batch.Skipped,
		"skip_reasons":      string(reasons),
		"updated_at":        now,
	}
	if batch.Done {
		updates["scan_completed_at"] = now
	}
	userIds := make([]int, 0, len(batch.Grants))
	for userId := range batch.Grants {
		userIds = append(userIds, userId)
	}
	slices.Sort(userIds)

	err = DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&CacheSubsidyCampaign{}).
			Where("id = ? AND status = ? AND calc_generation = ? AND scan_completed_at = 0 AND cursor_created_at = ? AND cursor_id = ? AND cursor_request_id = ?",
				campaign.Id, CacheSubsidyStatusCalculating, campaign.CalcGeneration, campaign.CursorCreatedAt, campaign.CursorId, campaign.CursorRequestId).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCacheSubsidyScanConflict
		}
		for _, userId := range userIds {
			delta := batch.Grants[userId]
			result := tx.Model(&CacheSubsidyGrant{}).
				Where("campaign_id = ? AND user_id = ?", campaign.Id, userId).
				Updates(map[string]any{
					"log_count":          gorm.Expr("log_count + ?", delta.LogCount),
					"cache_read_tokens":  gorm.Expr("cache_read_tokens + ?", delta.CacheReadTokens),
					"cache_write_tokens": gorm.Expr("cache_write_tokens + ?", delta.CacheWriteTokens),
					"cache_quota":        gorm.Expr("cache_quota + ?", delta.CacheQuota),
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected > 0 {
				continue
			}
			grant := &CacheSubsidyGrant{
				CampaignId:       campaign.Id,
				UserId:           userId,
				Username:         delta.Username,
				LogCount:         delta.LogCount,
				CacheReadTokens:  delta.CacheReadTokens,
				CacheWriteTokens: delta.CacheWriteTokens,
				CacheQuota:       delta.CacheQuota,
				Status:           CacheSubsidyGrantPending,
			}
			if err := tx.Create(grant).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	campaign.CursorCreatedAt = batch.CursorCreatedAt
	campaign.CursorId = batch.CursorId
	campaign.CursorRequestId = batch.CursorRequestId
	campaign.ScannedLogs += batch.Scanned
	campaign.MatchedLogs += batch.Matched
	campaign.SkippedLogs += batch.Skipped
	campaign.SkipReasons = string(reasons)
	if batch.Done {
		campaign.ScanCompletedAt = now
	}
	return nil
}

// FinalizeCacheSubsidyCampaign turns every grant's cache cost into its
// subsidy and records the totals. It is idempotent, so an interrupted run is
// simply repeated.
func FinalizeCacheSubsidyCampaign(campaign *CacheSubsidyCampaign) error {
	lastId := 0
	for {
		var grants []CacheSubsidyGrant
		err := DB.Select("id", "cache_quota").Where("campaign_id = ? AND id > ?", campaign.Id, lastId).
			Order("id").Limit(cacheSubsidyGrantBatchSize).Find(&grants).Error
		if err != nil {
			return err
		}
		if len(grants) == 0 {
			break
		}
		err = DB.Transaction(func(tx *gorm.DB) error {
			// Only the runner of the current calculation may write subsidies.
			var current CacheSubsidyCampaign
			err := lockForUpdate(tx).Select("id").
				Where("id = ? AND status = ? AND calc_generation = ? AND scan_completed_at > 0", campaign.Id, CacheSubsidyStatusCalculating, campaign.CalcGeneration).
				First(&current).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrCacheSubsidyScanConflict
			}
			if err != nil {
				return err
			}
			for _, grant := range grants {
				if err := tx.Model(&CacheSubsidyGrant{}).Where("id = ?", grant.Id).
					Update("subsidy_quota", campaign.SubsidyFor(grant.CacheQuota)).Error; err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
		lastId = grants[len(grants)-1].Id
	}

	var totals struct {
		Users   int64
		Cache   int64
		Subsidy int64
	}
	err := DB.Model(&CacheSubsidyGrant{}).
		Select("COUNT(*) AS users, COALESCE(SUM(cache_quota), 0) AS cache, COALESCE(SUM(subsidy_quota), 0) AS subsidy").
		Where("campaign_id = ? AND subsidy_quota > 0", campaign.Id).Scan(&totals).Error
	if err != nil {
		return err
	}
	now := common.GetTimestamp()
	result := DB.Model(&CacheSubsidyCampaign{}).
		Where("id = ? AND status = ? AND calc_generation = ? AND scan_completed_at > 0", campaign.Id, CacheSubsidyStatusCalculating, campaign.CalcGeneration).
		Updates(map[string]any{
			"status":              CacheSubsidyStatusCalculated,
			"eligible_users":      totals.Users,
			"total_cache_quota":   totals.Cache,
			"total_subsidy_quota": totals.Subsidy,
			"calculated_at":       now,
			"updated_at":          now,
			"last_error":          "",
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrCacheSubsidyScanConflict
	}
	return nil
}

// RecordCacheSubsidyCalculationError keeps the latest failure of a
// calculation on the campaign for the admin; the runner retries it.
func RecordCacheSubsidyCalculationError(campaign *CacheSubsidyCampaign, message string) {
	if utf8.RuneCountInString(message) > cacheSubsidyMaxErrorLength {
		message = string([]rune(message)[:cacheSubsidyMaxErrorLength])
	}
	err := DB.Model(&CacheSubsidyCampaign{}).
		Where("id = ? AND calc_generation = ?", campaign.Id, campaign.CalcGeneration).
		Update("last_error", message).Error
	if err != nil {
		common.SysError(common.LogText("failed to record cache subsidy calculation error: %s", err.Error()))
	}
}
