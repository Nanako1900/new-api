package model

import (
	"errors"
	"math"
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
	ErrAffiliatePayment  = common.NewMessage("A verified CNY or USD payment amount is required for cashback")
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

func GetAffiliateEntries(userID, offset, limit int) ([]AffiliateEntry, int64, error) {
	entries := make([]AffiliateEntry, 0)
	var count int64
	query := DB.Model(&AffiliateEntry{}).Where("user_id = ?", userID)
	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("id desc").Offset(max(0, offset)).Limit(min(max(1, limit), 100)).Find(&entries).Error
	return entries, count, err
}
