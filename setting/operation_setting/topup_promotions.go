package operation_setting

import (
	"cmp"
	"math"
	"slices"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
)

// Thresholds and gifts are denominated in CNY wallet face value, before any
// gateway rate, discount, fee or group multiplier is applied.
type TopUpPromotionTier struct {
	ThresholdCNY float64 `json:"threshold_cny"`
	BonusCNY     float64 `json:"bonus_cny,omitempty"`
	PayPercent   float64 `json:"pay_percent,omitempty"`
}

var topUpPromotions atomic.Pointer[[]TopUpPromotionTier]

func ParseTopUpPromotions(value string) ([]TopUpPromotionTier, error) {
	var input []map[string]float64
	invalid := common.NewMessage("Invalid recharge promotion tiers")
	if len(value) > 16384 || common.UnmarshalJsonStr(value, &input) != nil || input == nil || len(input) > 50 {
		return nil, invalid
	}
	tiers := make([]TopUpPromotionTier, 0, len(input))
	for _, row := range input {
		for key := range row {
			if key != "threshold_cny" && key != "bonus_cny" && key != "pay_percent" {
				return nil, invalid
			}
		}
		tiers = append(tiers, TopUpPromotionTier{ThresholdCNY: row["threshold_cny"], BonusCNY: row["bonus_cny"], PayPercent: row["pay_percent"]})
	}
	slices.SortFunc(tiers, func(a, b TopUpPromotionTier) int { return cmp.Compare(a.ThresholdCNY, b.ThresholdCNY) })
	for i, t := range tiers {
		if t.ThresholdCNY <= 0 || t.ThresholdCNY > 1000000 || t.BonusCNY < 0 || t.BonusCNY > 1000000 || t.PayPercent < 0 || t.PayPercent >= 100 || (t.BonusCNY == 0 && t.PayPercent == 0) || (i > 0 && tiers[i-1].ThresholdCNY == t.ThresholdCNY) {
			return nil, invalid
		}
		for _, n := range []float64{t.ThresholdCNY, t.BonusCNY, t.PayPercent} {
			if decimal.NewFromFloat(n).Exponent() < -2 {
				return nil, invalid
			}
		}
	}
	return tiers, nil
}

func SetTopUpPromotions(value string) error {
	tiers, err := ParseTopUpPromotions(value)
	if err != nil {
		return err
	}
	topUpPromotions.Store(&tiers)
	return nil
}

// TopUpPromotionTiers returns an immutable snapshot, published in threshold order.
func TopUpPromotionTiers() []TopUpPromotionTier {
	if p := topUpPromotions.Load(); p != nil {
		return *p
	}
	return nil
}

type TopUpOffer struct {
	BonusCNY   float64 `json:"bonus_cny,omitempty"`
	PayPercent float64 `json:"pay_percent,omitempty"`
	BonusQuota int     `json:"-"`
}

// WalletDiscountRate preserves existing exact-amount pricing, using the better
// rate when both a threshold promotion and a preset apply.
func (o TopUpOffer) WalletDiscountRate(amount int64) float64 {
	rate := GetPaymentSetting().AmountDiscount[int(amount)]
	if rate <= 0 {
		rate = 1
	}
	if o.PayPercent > 0 {
		rate = min(rate, o.PayPercent/100)
	}
	return rate
}

func (o TopUpOffer) Discounted(amount decimal.Decimal) decimal.Decimal {
	if o.PayPercent == 0 {
		return amount
	}
	return amount.Mul(decimal.NewFromFloat(o.PayPercent)).Shift(-2)
}

// QuoteTopUpOffer selects the highest qualifying threshold separately for each
// benefit. Bonus quota is fixed at checkout and never derives from the fee.
func QuoteTopUpOffer(face decimal.Decimal, inCNY bool) (TopUpOffer, error) {
	var offer TopUpOffer
	tiers := TopUpPromotionTiers()
	if len(tiers) == 0 {
		return offer, nil
	}
	fx := USDExchangeRate
	if math.IsNaN(fx) || math.IsInf(fx, 0) || fx < 0.000001 || fx > 1000000 {
		return offer, common.NewMessage("Invalid parameters")
	}
	rate := decimal.NewFromFloat(fx)
	if !inCNY {
		face = face.Mul(rate)
	}
	for _, t := range tiers {
		if face.LessThan(decimal.NewFromFloat(t.ThresholdCNY)) {
			break
		}
		if t.BonusCNY > 0 {
			offer.BonusCNY = t.BonusCNY
		}
		if t.PayPercent > 0 {
			offer.PayPercent = t.PayPercent
		}
	}
	if offer.BonusCNY > 0 {
		var err error
		offer.BonusQuota, err = common.WalletQuotaFromDecimalStrict(decimal.NewFromFloat(offer.BonusCNY).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).Div(rate))
		if err != nil || offer.BonusQuota < 1 {
			return TopUpOffer{}, common.NewMessage("Invalid top-up quota")
		}
	}
	return offer, nil
}
