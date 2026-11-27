package model

import (
	"errors"
	"maps"
	"math"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AffiliateAccount is a cash ledger in CNY cents, independent of API quota and
// registration gifts. A negative balance represents a reversal after payout.
type AffiliateAccount struct {
	UserID        int   `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	RateBPS       int   `json:"rate_bps"`
	BalanceCents  int64 `json:"balance_cents" gorm:"type:bigint"`
	EarnedCents   int64 `json:"earned_cents" gorm:"type:bigint"`
	PaidCents     int64 `json:"paid_cents" gorm:"type:bigint"`
	ReversedCents int64 `json:"reversed_cents" gorm:"type:bigint"`
}

// AffiliateOrder only exists for eligible orders created after feature rollout.
// Absence means no cashback; later changes must never backfill old payments.
type AffiliateOrder struct {
	TradeNo      string `json:"trade_no" gorm:"primaryKey;type:varchar(191)"`
	BuyerID      int    `json:"buyer_id"`
	InviterID    int    `json:"inviter_id" gorm:"index"`
	RateBPS      int    `json:"rate_bps"`
	Currency     string `json:"currency" gorm:"type:varchar(3)"`
	ExchangeRate string `json:"exchange_rate" gorm:"type:varchar(32)"`
	FeeCents     int64  `json:"fee_cents" gorm:"type:bigint"`
	PaidCents    int64  `json:"paid_cents" gorm:"type:bigint"`
	BaseCents    int64  `json:"base_cents" gorm:"type:bigint"`
	RewardCents  int64  `json:"reward_cents" gorm:"type:bigint"`
	SettledAt    int64  `json:"settled_at"`
	ReversedAt   int64  `json:"reversed_at"`
}

type AffiliateEntry struct {
	ID           int    `json:"id"`
	EventKey     string `json:"-" gorm:"uniqueIndex;type:varchar(191)"`
	UserID       int    `json:"user_id" gorm:"index"`
	Kind         string `json:"kind" gorm:"type:varchar(20)"`
	TradeNo      string `json:"trade_no" gorm:"type:varchar(191)"`
	BuyerID      int    `json:"buyer_id"`
	RateBPS      int    `json:"rate_bps"`
	BaseCents    int64  `json:"base_cents" gorm:"type:bigint"`
	AmountCents  int64  `json:"amount_cents" gorm:"type:bigint"`
	BalanceAfter int64  `json:"balance_after" gorm:"type:bigint"`
	OperatorID   int    `json:"operator_id"`
	Note         string `json:"note" gorm:"type:varchar(500)"`
	CreatedAt    int64  `json:"created_at"`
}

type AffiliateHistoryEntry struct {
	AffiliateEntry
	BuyerName        string `json:"buyer_name,omitempty" gorm:"-"`
	BuyerDisplayName string `json:"-" gorm:"->"`
	BuyerUsername    string `json:"-" gorm:"->"`
}

type AffiliateInvitee struct {
	ID          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

type AffiliateTopUpTotal struct {
	Currency  string `json:"currency"`
	PaidCents string `json:"paid_cents"`
}

type AffiliateInviteeTopUps struct {
	ID            int                   `json:"id"`
	DisplayName   string                `json:"display_name"`
	TopUpCount    int64                 `json:"topup_count"`
	TopUpTotals   []AffiliateTopUpTotal `json:"topup_totals"`
	LastSettledAt *int64                `json:"last_settled_at"`
}

type AffiliateChange struct {
	ID         int   `json:"id"`
	UserID     int   `json:"user_id" gorm:"index"`
	OldInviter int   `json:"old_inviter"`
	NewInviter int   `json:"new_inviter"`
	OldRateBPS int   `json:"old_rate_bps"`
	NewRateBPS int   `json:"new_rate_bps"`
	OperatorID int   `json:"operator_id"`
	CreatedAt  int64 `json:"created_at"`
}

// This database row serializes graph edits across processes, including SQLite.
// It prevents concurrent A->B and B->A assignments from both passing validation.
type AffiliateGraphLock struct {
	ID      int `gorm:"primaryKey;autoIncrement:false"`
	Version int64
}

type AffiliatePayment struct {
	// Amount is the verified payment total minus tax, in the original currency.
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
}

type AffiliateSummary struct {
	AffiliateAccount
	InviterID   int    `json:"inviter_id"`
	InviterName string `json:"inviter_name"`
	InviteCount int64  `json:"invite_count"`
}

// AffiliateAction is also the transaction-bound context of an admin proof.
type AffiliateAction struct {
	UserID            int    `json:"user_id"`
	Action            string `json:"action"`
	InviterID         int    `json:"inviter_id,omitempty"`
	RateBPS           int    `json:"rate_bps,omitempty"`
	AmountCents       int64  `json:"amount_cents,omitempty"`
	ExpectedPaidCents int64  `json:"expected_paid_cents,omitempty"`
	RequestID         string `json:"request_id,omitempty"`
	TradeNo           string `json:"trade_no,omitempty"`
	Note              string `json:"note,omitempty"`
}

func (a AffiliateAction) Validate() error {
	if a.UserID <= 0 {
		return ErrAffiliateSettings
	}
	switch a.Action {
	case "settings":
		if a.InviterID < 0 || a.RateBPS < 0 || a.RateBPS > 10000 {
			return ErrAffiliateSettings
		}
	case "withdrawal":
		if _, err := uuid.Parse(a.RequestID); err != nil {
			return ErrAffiliateSettings
		}
		if a.AmountCents <= 0 || a.AmountCents > common.MaxWalletQuota || a.ExpectedPaidCents < 0 || a.ExpectedPaidCents > common.MaxWalletQuota {
			return ErrAffiliateSettings
		}
		if a.Note == "" || len(a.Note) > 500 || strings.TrimSpace(a.Note) != a.Note {
			return ErrAffiliateSettings
		}
	case "reversal":
		if a.TradeNo == "" || len(a.TradeNo) > 180 || a.Note == "" || len(a.Note) > 500 || strings.TrimSpace(a.Note) != a.Note {
			return ErrAffiliateSettings
		}
	default:
		return ErrAffiliateSettings
	}
	return nil
}

func (a AffiliateAction) VerificationContext() map[string]any {
	context := map[string]any{"user_id": a.UserID, "action": a.Action}
	switch a.Action {
	case "settings":
		context["inviter_id"], context["rate_bps"] = a.InviterID, a.RateBPS
	case "withdrawal":
		context["amount_cents"], context["expected_paid_cents"] = a.AmountCents, a.ExpectedPaidCents
		context["request_id"], context["note"] = a.RequestID, a.Note
	case "reversal":
		context["trade_no"], context["note"] = a.TradeNo, a.Note
	}
	return context
}

var (
	ErrAffiliateSettings = common.NewMessage("Invalid referral settings")
	ErrAffiliateCycle    = common.NewMessage("An invitation relationship cannot contain a cycle")
	ErrAffiliatePayment  = common.NewMessage("A valid payment amount, currency and exchange rate are required for cashback")
	ErrAffiliateBalance  = common.NewMessage("The cashback balance changed. Refresh and try again.")
	ErrAffiliateLimit    = common.NewMessage("Cashback amount exceeds the supported limit")
)

func GetAffiliateSummary(userID int) (*AffiliateSummary, error) {
	var user User
	if err := DB.Select("id", "inviter_id").First(&user, userID).Error; err != nil {
		return nil, err
	}
	result := &AffiliateSummary{AffiliateAccount: AffiliateAccount{UserID: userID}, InviterID: user.InviterId}
	if err := DB.Where("user_id = ?", userID).Find(&result.AffiliateAccount).Error; err != nil {
		return nil, err
	}
	if user.InviterId > 0 {
		var inviter User
		if err := DB.Select("display_name").Where("id = ?", user.InviterId).Find(&inviter).Error; err != nil {
			return nil, err
		}
		result.InviterName = inviter.DisplayName
	}
	if err := DB.Model(&User{}).Where("inviter_id = ?", userID).Count(&result.InviteCount).Error; err != nil {
		return nil, err
	}
	return result, nil
}

func SetAffiliateSettings(userID, inviterID, rateBPS, operatorID, operatorRole int) error {
	if userID <= 0 || inviterID < 0 || rateBPS < 0 || rateBPS > 10000 {
		return ErrAffiliateSettings
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&AffiliateGraphLock{ID: 1}).Error; err != nil {
			return err
		}
		if err := tx.Model(&AffiliateGraphLock{}).Where("id = ?", 1).Update("version", gorm.Expr("version + 1")).Error; err != nil {
			return err
		}
		var user User
		if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
			return err
		}
		if operatorRole < common.RoleAdminUser || (operatorRole != common.RoleRootUser && operatorRole <= user.Role) {
			return ErrUserQuotaPermission
		}
		seen := map[int]bool{userID: true}
		for id := inviterID; id != 0; {
			if seen[id] {
				return ErrAffiliateCycle
			}
			seen[id] = true
			var parent User
			if err := tx.Select("id", "inviter_id", "status").First(&parent, id).Error; err != nil {
				// Historical chains can end at an account that was deleted.
				// The newly assigned direct inviter must still exist.
				if errors.Is(err, gorm.ErrRecordNotFound) && id != inviterID {
					break
				}
				return err
			}
			if id == inviterID && parent.Status != common.UserStatusEnabled {
				return ErrAffiliateSettings
			}
			id = parent.InviterId
		}
		account, err := lockAffiliateAccount(tx, userID)
		if err != nil {
			return err
		}
		if user.InviterId == inviterID && account.RateBPS == rateBPS {
			return nil
		}
		change := AffiliateChange{UserID: userID, OldInviter: user.InviterId, NewInviter: inviterID, OldRateBPS: account.RateBPS, NewRateBPS: rateBPS, OperatorID: operatorID, CreatedAt: common.GetTimestamp()}
		if err := tx.Model(&User{}).Where("id = ?", userID).Update("inviter_id", inviterID).Error; err != nil {
			return err
		}
		if err := tx.Model(account).Update("rate_bps", rateBPS).Error; err != nil {
			return err
		}
		return tx.Create(&change).Error
	})
}

func lockAffiliateAccount(tx *gorm.DB, userID int) (*AffiliateAccount, error) {
	account := AffiliateAccount{UserID: userID}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
		return nil, err
	}
	// The write also serializes SQLite transactions, where FOR UPDATE is absent.
	if err := tx.Model(&AffiliateAccount{}).Where("user_id = ?", userID).UpdateColumn("balance_cents", gorm.Expr("balance_cents")).Error; err != nil {
		return nil, err
	}
	if err := lockForUpdate(tx).First(&account, "user_id = ?", userID).Error; err != nil {
		return nil, err
	}
	return &account, nil
}

func snapshotAffiliateOrder(tx *gorm.DB, topUp *TopUp) error {
	if !operation_setting.IsPaymentComplianceConfirmed() {
		return nil
	}
	var buyer User
	if err := tx.Select("id", "inviter_id").First(&buyer, topUp.UserId).Error; err != nil {
		return err
	}
	if buyer.InviterId == 0 {
		return nil
	}
	var account AffiliateAccount
	if err := tx.Where("user_id = ?", buyer.InviterId).Find(&account).Error; err != nil {
		return err
	}
	if account.RateBPS == 0 {
		return nil
	}
	// Leave room for ledger event prefixes in the portable unique index.
	if topUp.TradeNo == "" || len(topUp.TradeNo) > 180 {
		return ErrAffiliateSettings
	}
	if account.RateBPS < 0 || account.RateBPS > 10000 || buyer.InviterId == buyer.Id {
		return ErrAffiliateSettings
	}
	var inviter User
	if err := tx.Select("id", "status").First(&inviter, buyer.InviterId).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if inviter.Status != common.UserStatusEnabled {
		return nil
	}
	currency := strings.ToUpper(topUp.AffiliateCurrency)
	rate := decimal.NewFromInt(1)
	if currency == "USD" {
		fx := operation_setting.USDExchangeRate
		if math.IsNaN(fx) || math.IsInf(fx, 0) || fx <= 0 || fx > 1000000 {
			return ErrAffiliatePayment
		}
		rate = decimal.NewFromFloat(fx).Round(8)
		if !rate.IsPositive() {
			return ErrAffiliatePayment
		}
	} else if currency == "GBP" {
		var err error
		rate, err = decimal.NewFromString(topUp.AffiliateExchangeRate)
		if err != nil || !rate.IsPositive() || rate.GreaterThan(decimal.NewFromInt(1000000)) {
			return ErrAffiliatePayment
		}
	} else if currency != "CNY" {
		return ErrAffiliatePayment
	}
	if topUp.AffiliateFeeCents < 0 || topUp.AffiliateFeeCents > common.MaxWalletQuota {
		return ErrAffiliatePayment
	}
	if err := tx.Create(&AffiliateOrder{TradeNo: topUp.TradeNo, BuyerID: buyer.Id, InviterID: inviter.Id, RateBPS: account.RateBPS, Currency: currency, ExchangeRate: rate.String(), FeeCents: topUp.AffiliateFeeCents}).Error; err != nil {
		return err
	}
	topUp.AffiliateEligible = true
	return tx.Model(topUp).Update("affiliate_eligible", true).Error
}

// affiliateCents validates before IntPart; wallet and cash arithmetic share the
// JavaScript-safe ceiling but do not share quota units or quota conversion.
func affiliateCents(amount decimal.Decimal) (int64, error) {
	if amount.IsNegative() || amount.GreaterThan(decimal.NewFromInt(common.MaxWalletQuota)) {
		return 0, ErrAffiliateLimit
	}
	return amount.Round(0).IntPart(), nil
}

func settleAffiliateOrder(tx *gorm.DB, topUp *TopUp, payments []AffiliatePayment) error {
	if !topUp.AffiliateEligible {
		return nil
	}
	var order AffiliateOrder
	err := tx.First(&order, "trade_no = ?", topUp.TradeNo).Error
	if err != nil {
		return err
	}
	if order.SettledAt != 0 {
		return nil
	}
	if len(payments) != 1 || len(payments[0].Amount) > 40 || strings.ToUpper(payments[0].Currency) != order.Currency {
		return ErrAffiliatePayment
	}
	paid, err := decimal.NewFromString(payments[0].Amount)
	if err != nil || paid.IsNegative() || paid.Exponent() < -2 || paid.Exponent() > 8 {
		return ErrAffiliatePayment
	}
	paidCents, err := affiliateCents(paid.Mul(decimal.NewFromInt(100)))
	if err != nil || paidCents < order.FeeCents {
		return ErrAffiliatePayment
	}
	fx, err := decimal.NewFromString(order.ExchangeRate)
	if err != nil || !fx.IsPositive() {
		return ErrAffiliatePayment
	}
	base := decimal.NewFromInt(paidCents - order.FeeCents).Mul(fx)
	baseCents, err := affiliateCents(base)
	if err != nil {
		return err
	}
	reward, err := affiliateCents(base.Mul(decimal.NewFromInt(int64(order.RateBPS))).Div(decimal.NewFromInt(10000)))
	if err != nil {
		return err
	}
	account, err := lockAffiliateAccount(tx, order.InviterID)
	if err != nil {
		return err
	}
	if account.BalanceCents > common.MaxWalletQuota-reward || account.EarnedCents > common.MaxWalletQuota-reward {
		return ErrAffiliateLimit
	}
	account.BalanceCents += reward
	account.EarnedCents += reward
	if err := tx.Save(account).Error; err != nil {
		return err
	}
	order.PaidCents, order.BaseCents, order.RewardCents, order.SettledAt = paidCents, baseCents, reward, common.GetTimestamp()
	if err := tx.Save(&order).Error; err != nil {
		return err
	}
	return tx.Create(&AffiliateEntry{EventKey: "credit:" + order.TradeNo, UserID: order.InviterID, Kind: "credit", TradeNo: order.TradeNo, BuyerID: order.BuyerID, RateBPS: order.RateBPS, BaseCents: baseCents, AmountCents: reward, BalanceAfter: account.BalanceCents, CreatedAt: order.SettledAt}).Error
}

func WithdrawAffiliate(userID, operatorID, operatorRole int, amount, expectedPaid int64, requestID, note string) (*AffiliateEntry, error) {
	note = strings.TrimSpace(note)
	if amount <= 0 || amount > common.MaxWalletQuota || expectedPaid < 0 || len(requestID) != 36 || note == "" || len(note) > 500 {
		return nil, ErrAffiliateSettings
	}
	var entry AffiliateEntry
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.Select("id", "role").First(&user, userID).Error; err != nil {
			return err
		}
		if operatorRole < common.RoleAdminUser || (operatorRole != common.RoleRootUser && operatorRole <= user.Role) {
			return ErrUserQuotaPermission
		}
		account, err := lockAffiliateAccount(tx, userID)
		if err != nil {
			return err
		}
		// A current read is required on MySQL: the earlier user lookup may
		// have established a snapshot before an identical payout committed.
		err = lockForUpdate(tx).Where("event_key = ?", "withdraw:"+requestID).First(&entry).Error
		if err == nil {
			if entry.UserID != userID || entry.OperatorID != operatorID || entry.AmountCents != -amount || entry.Note != note {
				return ErrAffiliateSettings
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if account.PaidCents != expectedPaid || account.BalanceCents < amount {
			return ErrAffiliateBalance
		}
		if account.PaidCents > common.MaxWalletQuota-amount {
			return ErrAffiliateLimit
		}
		account.BalanceCents -= amount
		account.PaidCents += amount
		if err := tx.Save(account).Error; err != nil {
			return err
		}
		entry = AffiliateEntry{EventKey: "withdraw:" + requestID, UserID: userID, Kind: "withdrawal", AmountCents: -amount, BalanceAfter: account.BalanceCents, OperatorID: operatorID, Note: note, CreatedAt: common.GetTimestamp()}
		return tx.Create(&entry).Error
	})
	return &entry, err
}

// ReverseAffiliateOrder records a full cashback reversal after a refund or a
// chargeback verified by an administrator. Paid-out cash becomes an offset debt.
func ReverseAffiliateOrder(userID, operatorID, operatorRole int, tradeNo, note string) error {
	if strings.TrimSpace(note) == "" || len(note) > 500 || tradeNo == "" {
		return ErrAffiliateSettings
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var order AffiliateOrder
		if err := lockForUpdate(tx).First(&order, "trade_no = ? AND inviter_id = ?", tradeNo, userID).Error; err != nil {
			return err
		}
		var user User
		if err := tx.Select("id", "role").First(&user, userID).Error; err != nil {
			return err
		}
		if operatorRole < common.RoleAdminUser || (operatorRole != common.RoleRootUser && operatorRole <= user.Role) {
			return ErrUserQuotaPermission
		}
		if order.SettledAt == 0 {
			return ErrAffiliateSettings
		}
		if order.ReversedAt > 0 {
			return nil
		}
		account, err := lockAffiliateAccount(tx, userID)
		if err != nil {
			return err
		}
		if account.ReversedCents > common.MaxWalletQuota-order.RewardCents || account.BalanceCents < -common.MaxWalletQuota+order.RewardCents {
			return ErrAffiliateLimit
		}
		account.BalanceCents -= order.RewardCents
		account.ReversedCents += order.RewardCents
		if err := tx.Save(account).Error; err != nil {
			return err
		}
		order.ReversedAt = common.GetTimestamp()
		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		return tx.Create(&AffiliateEntry{EventKey: "reverse:" + tradeNo, UserID: userID, Kind: "reversal", TradeNo: tradeNo, BuyerID: order.BuyerID, AmountCents: -order.RewardCents, BalanceAfter: account.BalanceCents, OperatorID: operatorID, Note: note, CreatedAt: order.ReversedAt}).Error
	})
}

func GetAffiliateEntries(userID, offset, limit int, includeBuyerName bool) ([]AffiliateHistoryEntry, int64, error) {
	entries := make([]AffiliateHistoryEntry, 0)
	var count int64
	query := DB.Model(&AffiliateEntry{}).Where("affiliate_entries.user_id = ?", userID)
	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	query = query.Select("affiliate_entries.*")
	if includeBuyerName {
		query = query.Select("affiliate_entries.*, buyer.display_name AS buyer_display_name, buyer.username AS buyer_username").
			Joins("LEFT JOIN users AS buyer ON buyer.id = affiliate_entries.buyer_id AND buyer.deleted_at IS NULL AND affiliate_entries.kind IN ?", []string{"credit", "reversal"})
	}
	if err := query.Order("affiliate_entries.id desc").Offset(max(0, offset)).Limit(min(max(1, limit), 100)).Find(&entries).Error; err != nil {
		return nil, 0, err
	}
	for i := range entries {
		entries[i].BuyerName = affiliateDisplayName(entries[i].BuyerDisplayName, entries[i].BuyerUsername)
	}
	return entries, count, nil
}

func affiliateDisplayName(displayName, username string) string {
	if name := strings.TrimSpace(displayName); name != "" {
		return name
	}
	return username
}

func GetAffiliateInvitees(inviterID int, page *common.PageInfo) ([]AffiliateInvitee, int64, error) {
	page.Page = max(1, page.Page)
	page.PageSize = min(max(1, page.PageSize), 100)
	invitees := make([]AffiliateInvitee, 0)
	var total int64
	query := DB.Model(&User{}).Where("inviter_id = ?", inviterID)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if total == 0 || int64(page.Page-1) > (total-1)/int64(page.PageSize) {
		return invitees, total, nil
	}
	err := query.Select("id", "username", "display_name").Order("id desc").
		Offset(page.GetStartIdx()).Limit(page.PageSize).Find(&invitees).Error
	return invitees, total, err
}

func GetAffiliateInviteeTopUps(inviterID int, page *common.PageInfo) ([]AffiliateInviteeTopUps, int64, error) {
	invitees, total, err := GetAffiliateInvitees(inviterID, page)
	if err != nil {
		return nil, 0, err
	}
	result := make([]AffiliateInviteeTopUps, len(invitees))
	if len(invitees) == 0 {
		return result, total, nil
	}
	buyerIDs := make([]int, len(invitees))
	indexByBuyer := make(map[int]int, len(invitees))
	for i, invitee := range invitees {
		result[i] = AffiliateInviteeTopUps{
			ID:          invitee.ID,
			DisplayName: affiliateDisplayName(invitee.DisplayName, invitee.Username),
			TopUpTotals: []AffiliateTopUpTotal{},
		}
		buyerIDs[i] = invitee.ID
		indexByBuyer[invitee.ID] = i
	}

	// Group identical amounts before adding them exactly; SQLite SUM of BIGINT can overflow.
	rows, err := DB.Model(&AffiliateOrder{}).
		Where("inviter_id = ? AND buyer_id IN ? AND settled_at > 0 AND reversed_at = 0", inviterID, buyerIDs).
		Select("buyer_id, currency, paid_cents, COUNT(*), MAX(settled_at)").
		Group("buyer_id, currency, paid_cents").Rows()
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	byCurrency := make([]map[string]decimal.Decimal, len(result))
	for rows.Next() {
		var buyerID int
		var currency string
		var paidCents, count, settledAt int64
		if err := rows.Scan(&buyerID, &currency, &paidCents, &count, &settledAt); err != nil {
			return nil, 0, err
		}
		i := indexByBuyer[buyerID]
		summary := &result[i]
		summary.TopUpCount += count
		if summary.LastSettledAt == nil || settledAt > *summary.LastSettledAt {
			summary.LastSettledAt = &settledAt
		}
		if byCurrency[i] == nil {
			byCurrency[i] = make(map[string]decimal.Decimal)
		}
		amount := decimal.NewFromInt(paidCents).Mul(decimal.NewFromInt(count))
		byCurrency[i][currency] = byCurrency[i][currency].Add(amount)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	for i, totals := range byCurrency {
		for _, currency := range slices.Sorted(maps.Keys(totals)) {
			result[i].TopUpTotals = append(result[i].TopUpTotals, AffiliateTopUpTotal{
				Currency: currency, PaidCents: totals[currency].String(),
			})
		}
	}
	return result, total, nil
}
