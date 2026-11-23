package service

import (
	"context"
	"errors"
	"maps"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/shopspring/decimal"
)

const (
	// cacheSubsidyScanPause spaces out log reads so a long window does not
	// monopolize the log database.
	cacheSubsidyScanPause        = 20 * time.Millisecond
	cacheSubsidyMaxScanConflicts = 3
)

// cacheSubsidyScanBatchSize is how many logs one batch reads; tests lower it
// to cross batch boundaries.
var cacheSubsidyScanBatchSize = 2000

// cacheSubsidyTaskHandler calculates queued campaigns one after another. It
// is scheduled as well as enqueued on demand, so a campaign queued while a
// run is finishing, or left half-calculated by a crashed node, is picked up
// within a minute.
type cacheSubsidyTaskHandler struct{}

func init() {
	RegisterSystemTaskHandler(cacheSubsidyTaskHandler{})
}

func (cacheSubsidyTaskHandler) Type() string { return model.SystemTaskTypeCacheSubsidy }

func (cacheSubsidyTaskHandler) Enabled() bool {
	pending, err := model.HasPendingCacheSubsidyCalculation()
	if err != nil {
		common.SysError(common.LogText("failed to check pending cache subsidy calculations: %s", err.Error()))
		return false
	}
	return pending
}

func (cacheSubsidyTaskHandler) Interval() time.Duration { return time.Minute }

func (cacheSubsidyTaskHandler) NewPayload() any { return nil }

func (cacheSubsidyTaskHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	report := NewSystemTaskProgressReporter(task, runnerID)
	calculated := []int{}
	conflicts := 0
	for {
		campaign, err := model.StartNextCacheSubsidyCalculation()
		if err != nil {
			failSystemTask(task, runnerID, err)
			return
		}
		if campaign == nil {
			break
		}
		err = CalculateCacheSubsidyCampaign(ctx, campaign, func(progress int) { report(progress, 100) })
		if errors.Is(err, model.ErrCacheSubsidyScanConflict) && conflicts < cacheSubsidyMaxScanConflicts {
			// The campaign was reset or moved on elsewhere; re-read it.
			conflicts++
			continue
		}
		if err != nil {
			model.RecordCacheSubsidyCalculationError(campaign, err.Error())
			failSystemTask(task, runnerID, err)
			return
		}
		conflicts = 0
		calculated = append(calculated, campaign.Id)
	}
	result := map[string]any{"campaign_ids": calculated}
	if err := model.FinishSystemTask(task.TaskID, runnerID, model.SystemTaskStatusSucceeded, result, ""); err != nil {
		logSystemTaskLockError(ctx, task, err)
	}
}

// QueueCacheSubsidyCalculation schedules a draft campaign and wakes the
// runner.
func QueueCacheSubsidyCalculation(campaignId int) error {
	if err := model.QueueCacheSubsidyCalculation(campaignId, common.GetTimestamp()); err != nil {
		return err
	}
	if _, _, err := EnqueueSystemTask(model.SystemTaskTypeCacheSubsidy, nil); err != nil {
		// The scheduled pass still finds the queued campaign.
		common.SysError(common.LogText("failed to enqueue cache subsidy calculation: %s", err.Error()))
	}
	return nil
}

// CalculateCacheSubsidyCampaign scans the campaign window from its saved
// cursor, then turns the per-user cache costs into subsidies.
func CalculateCacheSubsidyCampaign(ctx context.Context, campaign *model.CacheSubsidyCampaign, onProgress func(progress int)) error {
	rules := NewCacheSubsidyRules(campaign.Rules(), campaign.IncludeCacheWrites)
	reasons := campaign.ScanSkipReasons()
	for campaign.ScanCompletedAt == 0 {
		if err := ctx.Err(); err != nil {
			return err
		}
		cursor := model.ConsumeLogCursor{
			CreatedAt: campaign.CursorCreatedAt,
			Id:        campaign.CursorId,
			RequestId: campaign.CursorRequestId,
		}
		logs, err := model.ScanConsumeLogBatch(ctx, cursor, campaign.WindowStart, campaign.WindowEnd, cacheSubsidyScanBatchSize)
		if err != nil {
			return err
		}
		batch := model.CacheSubsidyScanBatch{
			CursorCreatedAt: cursor.CreatedAt,
			CursorId:        cursor.Id,
			CursorRequestId: cursor.RequestId,
			Done:            len(logs) < cacheSubsidyScanBatchSize,
			SkipReasons:     maps.Clone(reasons),
			Grants:          map[int]model.CacheSubsidyGrantDelta{},
		}
		cacheQuotas := map[int]decimal.Decimal{}
		for _, log := range logs {
			key := model.ConsumeLogCursor{CreatedAt: log.CreatedAt, Id: int64(log.Id), RequestId: log.RequestId}
			// ClickHouse does not enforce a unique key, so a log stored twice
			// shows up as consecutive rows with the same key; count it once.
			if key == (model.ConsumeLogCursor{CreatedAt: batch.CursorCreatedAt, Id: batch.CursorId, RequestId: batch.CursorRequestId}) {
				continue
			}
			batch.Scanned++
			batch.CursorCreatedAt = key.CreatedAt
			batch.CursorId = key.Id
			batch.CursorRequestId = key.RequestId
			cost, skip := ComputeCacheSubsidyLogCost(log, rules)
			if skip != "" {
				batch.Skipped++
				batch.SkipReasons[skip]++
				continue
			}
			batch.Matched++
			delta := batch.Grants[log.UserId]
			delta.Username = log.Username
			delta.LogCount++
			delta.CacheReadTokens += cost.ReadTokens
			delta.CacheWriteTokens += cost.WriteTokens
			batch.Grants[log.UserId] = delta
			cacheQuotas[log.UserId] = cacheQuotas[log.UserId].Add(cost.CacheQuota)
		}
		for userId, cacheQuota := range cacheQuotas {
			// Truncating each batch can only round a user's total down.
			quota, err := common.WalletQuotaFromDecimalStrict(cacheQuota.Floor())
			if err != nil {
				return err
			}
			delta := batch.Grants[userId]
			delta.CacheQuota = int64(quota)
			batch.Grants[userId] = delta
		}
		if err := model.ApplyCacheSubsidyScanBatch(campaign, batch); err != nil {
			return err
		}
		reasons = batch.SkipReasons
		onProgress(campaign.ScanProgress())
		if batch.Done {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(cacheSubsidyScanPause):
		}
	}
	return model.FinalizeCacheSubsidyCampaign(campaign)
}
