package controller

import (
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v81"
	"gorm.io/gorm"
)

func TestTopUpQuotaValidation(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	common.QuotaPerUnit = 500000
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplayType
	})

	testCases := []struct {
		name        string
		displayType string
		amount      int64
		wantQuota   int
		wantErr     bool
	}{
		{
			name:        "currency amount below limit",
			displayType: operation_setting.QuotaDisplayTypeUSD,
			amount:      4294,
			wantQuota:   2_147_000_000,
		},
		{
			name:        "currency amount above limit",
			displayType: operation_setting.QuotaDisplayTypeUSD,
			amount:      4295,
			wantQuota:   2_147_500_000,
		},
		{
			name:        "token amount preserves settlement truncation",
			displayType: operation_setting.QuotaDisplayTypeTokens,
			amount:      2_147_500_000,
			wantQuota:   2_147_500_000,
		},
		{
			name:        "token amount above legacy int32 range",
			displayType: operation_setting.QuotaDisplayTypeTokens,
			amount:      4_294_500_000,
			wantQuota:   4_294_500_000,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			operation_setting.GetGeneralSetting().QuotaDisplayType = tc.displayType
			quota, err := getTopUpQuota(tc.amount)
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.wantQuota, quota)
		})
	}
}

func TestValidateTopUpQuotaReturnsMaximumAmount(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	common.QuotaPerUnit = 500000
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplayType
	})

	maxAmount := decimal.NewFromInt(common.MaxWalletQuota).
		Div(decimal.NewFromFloat(common.QuotaPerUnit)).
		Floor().IntPart()

	_, err := validateTopUpQuota(maxAmount)
	require.NoError(t, err)
	_, err = validateTopUpQuota(maxAmount + 1)
	require.EqualError(t, err, fmt.Sprintf("Top-up amount cannot exceed %d", maxAmount))
}

func TestRequestAmountRejectsTopUpThatCannotBeSettled(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	common.QuotaPerUnit = 500000
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplayType
	})

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	maxAmount := decimal.NewFromInt(common.MaxWalletQuota).
		Div(decimal.NewFromFloat(common.QuotaPerUnit)).
		Floor().IntPart()
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/user/amount",
		strings.NewReader(fmt.Sprintf(`{"amount":%d}`, maxAmount+1)),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")

	RequestAmount(ctx)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.JSONEq(t, fmt.Sprintf(`{"message":"error","data":"Top-up amount cannot exceed %d","message_key":"Top-up amount cannot exceed {{max}}","message_params":{"max":%d}}`, maxAmount, maxAmount), recorder.Body.String())
}

func TestRequestAmountRejectsTopUpThatWouldOverflowWallet(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	oldDB := model.DB
	common.QuotaPerUnit = 500000
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	model.DB = db
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplayType
		model.DB = oldDB
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			require.NoError(t, sqlDB.Close())
		}
	})

	require.NoError(t, model.DB.Create(&model.User{
		Id:       42,
		Username: "topup_capacity_user",
		Quota:    common.MaxWalletQuota - 100_000,
		Status:   common.UserStatusEnabled,
	}).Error)

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("id", 42)
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/user/amount",
		strings.NewReader(`{"amount":1}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")

	RequestAmount(ctx)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.JSONEq(t, `{"message":"error","data":"Top-up quota limit exceeded","message_key":"Top-up quota limit exceeded"}`, recorder.Body.String())
}

func TestValidateCreditedQuotaRejectsOverflow(t *testing.T) {
	_, err := validateCreditedQuota(decimal.NewFromInt(int64(common.MaxWalletQuota / 2)))
	require.NoError(t, err)
	_, err = validateCreditedQuota(decimal.Zero)
	require.EqualError(t, err, "Top-up quota must be greater than 0")
	_, err = validateCreditedQuota(decimal.NewFromInt(common.MaxWalletQuota + 1))
	require.EqualError(
		t,
		err,
		"Top-up quota exceeds the range the system can represent",
	)
}

func TestStripeCreditedQuotaIncludesGroupRatio(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldTopupGroupRatio := common.TopupGroupRatio2JSONString()
	common.QuotaPerUnit = 500000
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"vip":2}`))
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(oldTopupGroupRatio))
	})

	_, err := validateCreditedQuota(getStripeCreditedQuota(2147, "vip"))
	require.NoError(t, err)
	_, err = validateCreditedQuota(getStripeCreditedQuota(2148, "vip"))
	require.NoError(t, err)
	_, err = validateCreditedQuota(getStripeCreditedQuota(int64(common.MaxWalletQuota), "vip"))
	require.Error(t, err)

	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"free":0}`))
	assert.True(t, decimal.NewFromInt(500000).Equal(getStripeCreditedQuota(1, "free")))
}

func TestStripeGBPCNYCheckout(t *testing.T) {
	settings := operation_setting.GetPaymentSetting()
	oldSettings, oldUSD, oldMin := *settings, operation_setting.USDExchangeRate, setting.StripeMinTopUp
	oldKey, oldPrice := setting.StripeApiSecret, setting.StripePriceId
	oldDB, oldRatios := model.DB, common.TopupGroupRatio2JSONString()
	oldBackend := stripe.GetBackend(stripe.APIBackend)
	t.Cleanup(func() {
		*settings = oldSettings
		operation_setting.USDExchangeRate = oldUSD
		setting.StripeMinTopUp = oldMin
		setting.StripeApiSecret = oldKey
		setting.StripePriceId = oldPrice
		model.DB = oldDB
		stripe.SetBackend(stripe.APIBackend, oldBackend)
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(oldRatios))
	})
	settings.StripeGBPEnabled, settings.StripeGBPExchangeRate = true, 8
	settings.StripeFeeEnabled, settings.StripeFeePercent, settings.StripeFeeFixedGBP = true, 2.9, 0.2
	settings.ComplianceConfirmed = false
	operation_setting.USDExchangeRate, setting.StripeMinTopUp = 7.3, 1
	setting.StripeApiSecret, setting.StripePriceId = "sk_test_local", "price_gbp_penny"
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"default":1}`))
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}))
	model.DB = db
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.Create(&model.User{Id: 42, Username: "gbp-buyer", Group: "default", Status: common.UserStatusEnabled}).Error)
	priceJSON := `{"id":"price_gbp_penny","object":"price","active":true,"currency":"gbp","type":"one_time","billing_scheme":"per_unit","unit_amount":1,"unit_amount_decimal":"1"}`
	created := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(priceJSON))
			return
		}
		created++
		require.NoError(t, r.ParseForm())
		assert.Equal(t, "price_gbp_penny", r.Form.Get("line_items[0][price]"))
		assert.Equal(t, "1250", r.Form.Get("line_items[0][quantity]"), "GBP 0.01 × 1250 = GBP 12.50")
		assert.Equal(t, "57", r.Form.Get("line_items[1][price_data][unit_amount]"))
		assert.Equal(t, "gbp", r.Form.Get("line_items[1][price_data][currency]"))
		assert.Equal(t, "false", r.Form.Get("adaptive_pricing[enabled]"))
		assert.Equal(t, "false", r.Form.Get("allow_promotion_codes"))
		assert.Equal(t, "payment", r.Form.Get("mode"))
		_, _ = w.Write([]byte(`{"id":"cs_local","object":"checkout.session","currency":"gbp","amount_total":1307,"url":"https://checkout.stripe.com/local"}`))
	}))
	defer server.Close()
	stripe.SetBackend(stripe.APIBackend, stripe.GetBackendWithConfig(stripe.APIBackend, &stripe.BackendConfig{URL: stripe.String(server.URL), MaxNetworkRetries: stripe.Int64(0)}))
	quote, err := calculateStripeGBPQuote(100, "default")
	require.NoError(t, err)
	assert.Equal(t, "12.50", quote.Principal)
	assert.Equal(t, "0.57", quote.Fee)
	assert.Equal(t, "13.07", quote.Total)
	assert.True(t, decimal.NewFromInt(100).Div(decimal.NewFromFloat(7.3)).Equal(quote.credit))
	gin.SetMode(gin.TestMode)
	preview := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(preview)
	ctx.Set("id", 42)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/user/stripe/pay", nil)
	stripeAdaptor.RequestAmount(ctx, &StripePayRequest{AmountCNY: 100})
	assert.Contains(t, preview.Body.String(), `"total":"13.07"`)
	for _, request := range []StripePayRequest{{Amount: 100, PaymentMethod: "stripe"}, {AmountCNY: 100, PaymentMethod: "stripe", QuoteID: "stale"}} {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Set("id", 42)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/api/user/stripe/pay", nil)
		stripeAdaptor.RequestPay(ctx, &request)
		assert.Contains(t, recorder.Body.String(), `"message":"error"`)
		assert.Zero(t, created)
	}
	recorder := httptest.NewRecorder()
	ctx, _ = gin.CreateTestContext(recorder)
	ctx.Set("id", 42)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/user/stripe/pay", nil)
	stripeAdaptor.RequestPay(ctx, &StripePayRequest{AmountCNY: 100, PaymentMethod: "stripe", QuoteID: quote.QuoteID})
	assert.Contains(t, recorder.Body.String(), "https://checkout.stripe.com/local")
	assert.Equal(t, 1, created)
	var order model.TopUp
	require.NoError(t, db.First(&order).Error)
	assert.EqualValues(t, 100, order.Amount)
	assert.InDelta(t, 100/7.3, order.Money, 0.00000001, "GBP amount and fee must not become wallet USD credit")
	// FX changes invalidate the confirmation, even if rounded total happens to match.
	settings.StripeGBPExchangeRate = 8.000001
	changed, err := calculateStripeGBPQuote(100, "default")
	require.NoError(t, err)
	assert.NotEqual(t, quote.QuoteID, changed.QuoteID)
	settings.StripeGBPExchangeRate = 8
	for _, invalidPrice := range []string{
		strings.Replace(priceJSON, `"gbp"`, `"cny"`, 1),
		strings.Replace(priceJSON, `"one_time"`, `"recurring"`, 1),
		strings.Replace(priceJSON, `"active":true`, `"active":false`, 1),
		strings.Replace(priceJSON, `"unit_amount":1`, `"unit_amount":100`, 1),
	} {
		priceJSON = invalidPrice
		require.Error(t, validateStripeGBPPrice())
	}
	for _, amount := range []int64{0, -1, 1, 1000001, math.MaxInt64} {
		_, err := calculateStripeGBPQuote(amount, "default")
		require.Error(t, err)
	}
	for _, fx := range []float64{0, -1, math.NaN(), math.Inf(1), 0.0000001, 1000001} {
		settings.StripeGBPExchangeRate = fx
		_, err := calculateStripeGBPQuote(100, "default")
		require.Error(t, err)
	}
	settings.StripeGBPExchangeRate = 8
	settings.StripeFeeEnabled = false
	withoutFee, err := calculateStripeGBPQuote(100, "default")
	require.NoError(t, err)
	assert.Equal(t, "12.50", withoutFee.Total)
	settings.StripeGBPExchangeRate = 8.4
	rounded, err := calculateStripeGBPQuote(100, "default")
	require.NoError(t, err)
	assert.Equal(t, "11.91", rounded.Total)
}
