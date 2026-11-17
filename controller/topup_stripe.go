package controller

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/checkout/session"
	"github.com/stripe/stripe-go/v81/price"
	"github.com/stripe/stripe-go/v81/webhook"
	"github.com/thanhpk/randstr"
)

var stripeAdaptor = &StripeAdaptor{}

// StripePayRequest represents a payment request for Stripe checkout.
type StripePayRequest struct {
	// Amount is the quantity of units to purchase.
	Amount int64 `json:"amount"`
	// GBP checkout requires explicit CNY units; legacy clients must not silently change currency.
	AmountCNY int64  `json:"amount_cny"`
	QuoteID   string `json:"quote_id"`
	// PaymentMethod specifies the payment method (e.g., "stripe").
	PaymentMethod string `json:"payment_method"`
	// SuccessURL is the optional custom URL to redirect after successful payment.
	// If empty, defaults to the server's console log page.
	SuccessURL string `json:"success_url,omitempty"`
	// CancelURL is the optional custom URL to redirect when payment is canceled.
	// If empty, defaults to the server's console topup page.
	CancelURL string `json:"cancel_url,omitempty"`
}

type StripeAdaptor struct {
}

func (*StripeAdaptor) RequestAmount(c *gin.Context, req *StripePayRequest) {
	if operation_setting.GetPaymentSetting().StripeGBPEnabled {
		id := c.GetInt("id")
		user, err := model.GetUserById(id, false)
		if err != nil || user == nil {
			paymentError(c, common.NewMessage("Failed to get the user group"))
			return
		}
		quote, err := calculateStripeGBPQuote(req.AmountCNY, user.Group)
		if err != nil {
			paymentError(c, err)
			return
		}
		if rejectInvalidCreditedQuota(c, id, quote.credit.Mul(decimal.NewFromFloat(common.QuotaPerUnit))) {
			return
		}
		if err := validateStripeGBPPrice(); err != nil {
			paymentError(c, common.NewMessage("Stripe GBP checkout requires an active one-time GBP 0.01 price"))
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "success", "data": quote})
		return
	}
	if !operation_setting.GetPaymentSetting().StripeGBPEnabled && req.Amount < getStripeMinTopup() {
		paymentError(c, common.NewMessage("Top-up amount cannot be less than {{min}}", map[string]any{"min": getStripeMinTopup()}))
		return
	}
	if !operation_setting.GetPaymentSetting().StripeGBPEnabled && req.Amount > 10000 {
		paymentError(c, common.NewMessage("Top-up amount cannot exceed {{max}}", map[string]any{"max": 10000}))
		return
	}
	id := c.GetInt("id")
	group, err := model.GetUserGroup(id, true)
	if err != nil {
		paymentError(c, common.NewMessage("Failed to get the user group"))
		return
	}
	if rejectInvalidCreditedQuota(c, id, getStripeCreditedQuota(req.Amount, group)) {
		return
	}
	if operation_setting.GetPaymentSetting().StripeFeeEnabled {
		configuredPrice, fee, err := getStripeProcessingFee(req.Amount)
		if err != nil {
			paymentError(c, common.NewMessage("Failed to calculate Stripe processing fee"))
			return
		}
		total := decimal.NewFromInt(configuredPrice.UnitAmount).Mul(decimal.NewFromInt(req.Amount)).
			Add(decimal.NewFromInt(fee)).Div(decimal.NewFromInt(100))
		c.JSON(http.StatusOK, gin.H{"message": "success", "data": total.StringFixed(2)})
		return
	}
	payMoney := getStripePayMoney(float64(req.Amount), group)
	if payMoney <= 0.01 {
		paymentError(c, common.NewMessage("Payment amount is too low"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": strconv.FormatFloat(payMoney, 'f', 2, 64)})
}

func (*StripeAdaptor) RequestPay(c *gin.Context, req *StripePayRequest) {
	if req.PaymentMethod != model.PaymentMethodStripe {
		paymentError(c, common.NewMessage("Unsupported payment channel"))
		return
	}
	if !operation_setting.GetPaymentSetting().StripeGBPEnabled && req.Amount < getStripeMinTopup() {
		common.ApiErrorStatus(c, http.StatusOK, common.NewMessage("Top-up amount cannot be less than {{min}}", map[string]any{"min": getStripeMinTopup()}), gin.H{"data": 10})
		return
	}
	if !operation_setting.GetPaymentSetting().StripeGBPEnabled && req.Amount > 10000 {
		common.ApiErrorStatus(c, http.StatusOK, common.NewMessage("Top-up amount cannot exceed {{max}}", map[string]any{"max": 10000}), gin.H{"data": 10})
		return
	}

	if req.SuccessURL != "" && common.ValidateRedirectURL(req.SuccessURL) != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Payment success redirect URL is not in the trusted domain list"), gin.H{"data": ""})
		return
	}

	if req.CancelURL != "" && common.ValidateRedirectURL(req.CancelURL) != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Payment cancel redirect URL is not in the trusted domain list"), gin.H{"data": ""})
		return
	}

	id := c.GetInt("id")
	user, err := model.GetUserById(id, false)
	if err != nil || user == nil {
		paymentError(c, common.NewMessage("User does not exist"))
		return
	}
	chargedMoney := GetChargedAmount(float64(req.Amount), *user)
	var quote *stripeGBPQuote
	if operation_setting.GetPaymentSetting().StripeGBPEnabled {
		quote, err = calculateStripeGBPQuote(req.AmountCNY, user.Group)
		if err != nil {
			paymentError(c, err)
			return
		}
		if req.QuoteID == "" || req.QuoteID != quote.QuoteID {
			paymentError(c, common.NewMessage("Payment quote changed. Please review the payment again."))
			return
		}
		chargedMoney = quote.credit.InexactFloat64()
	}
	if rejectInvalidCreditedQuota(c, id,
		decimal.NewFromFloat(chargedMoney).Mul(decimal.NewFromFloat(common.QuotaPerUnit)),
	) {
		return
	}

	reference := fmt.Sprintf("new-api-ref-%d-%d-%s", user.Id, time.Now().UnixMilli(), randstr.String(4))
	referenceId := "ref_" + common.Sha1([]byte(reference))

	checkout, feeCents, err := genStripeLink(referenceId, user.StripeCustomer, user.Email, req.Amount, req.SuccessURL, req.CancelURL, quote)
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("Stripe failed to create Checkout Session user_id=%d trade_no=%s amount=%d error=%q", id, referenceId, req.Amount, err.Error()))
		paymentError(c, common.NewMessage("Failed to start payment"))
		return
	}

	topUp := &model.TopUp{
		UserId:            id,
		Amount:            req.Amount,
		Money:             chargedMoney,
		TradeNo:           referenceId,
		PaymentMethod:     model.PaymentMethodStripe,
		PaymentProvider:   model.PaymentProviderStripe,
		AffiliateCurrency: string(checkout.Currency),
		AffiliateFeeCents: feeCents,
		CreateTime:        time.Now().Unix(),
		Status:            common.TopUpStatusPending,
	}
	if quote != nil {
		topUp.Amount = req.AmountCNY
		topUp.AffiliateExchangeRate = quote.ExchangeRate
	}
	err = topUp.Insert()
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("Stripe failed to create top-up order user_id=%d trade_no=%s amount=%d error=%q", id, referenceId, req.Amount, err.Error()))
		paymentError(c, common.NewMessage("Failed to create order"))
		return
	}
	logger.LogInfo(c.Request.Context(), common.LogText("Stripe top-up order created user_id=%d trade_no=%s amount=%d money=%.2f", id, referenceId, req.Amount, chargedMoney))
	c.JSON(http.StatusOK, gin.H{
		"message": "success",
		"data": gin.H{
			"pay_link": checkout.URL,
		},
	})
}

func RequestStripeAmount(c *gin.Context) {
	var req StripePayRequest
	err := c.ShouldBindJSON(&req)
	if err != nil {
		paymentError(c, common.NewMessage("Invalid parameters"))
		return
	}
	stripeAdaptor.RequestAmount(c, &req)
}

func RequestStripePay(c *gin.Context) {
	var req StripePayRequest
	err := c.ShouldBindJSON(&req)
	if err != nil {
		paymentError(c, common.NewMessage("Invalid parameters"))
		return
	}
	stripeAdaptor.RequestPay(c, &req)
}

func StripeWebhook(c *gin.Context) {
	ctx := c.Request.Context()
	if !isStripeWebhookEnabled() {
		logger.LogWarn(ctx, common.LogText("Stripe webhook rejected reason=webhook_disabled path=%q client_ip=%s", c.Request.RequestURI, c.ClientIP()))
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	payload, err := io.ReadAll(c.Request.Body)
	if err != nil {
		logger.LogError(ctx, common.LogText("Stripe webhook failed to read request body path=%q client_ip=%s error=%q", c.Request.RequestURI, c.ClientIP(), err.Error()))
		c.AbortWithStatus(http.StatusServiceUnavailable)
		return
	}

	signature := c.GetHeader("Stripe-Signature")
	logger.LogInfo(ctx, common.LogText("Stripe webhook received request path=%q client_ip=%s signature=%q body=%q", c.Request.RequestURI, c.ClientIP(), signature, string(payload)))
	event, err := webhook.ConstructEventWithOptions(payload, signature, setting.StripeWebhookSecret, webhook.ConstructEventOptions{
		IgnoreAPIVersionMismatch: true,
	})

	if err != nil {
		logger.LogWarn(ctx, common.LogText("Stripe webhook signature verification failed path=%q client_ip=%s error=%q", c.Request.RequestURI, c.ClientIP(), err.Error()))
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	callerIp := c.ClientIP()
	logger.LogInfo(ctx, common.LogText("Stripe webhook signature verified event_type=%s client_ip=%s path=%q", string(event.Type), callerIp, c.Request.RequestURI))
	switch event.Type {
	case stripe.EventTypeCheckoutSessionCompleted:
		if err := sessionCompleted(ctx, event, callerIp); err != nil {
			c.Status(http.StatusInternalServerError)
			return
		}
	case stripe.EventTypeCheckoutSessionExpired:
		sessionExpired(ctx, event)
	case stripe.EventTypeCheckoutSessionAsyncPaymentSucceeded:
		if err := sessionAsyncPaymentSucceeded(ctx, event, callerIp); err != nil {
			c.Status(http.StatusInternalServerError)
			return
		}
	case stripe.EventTypeCheckoutSessionAsyncPaymentFailed:
		sessionAsyncPaymentFailed(ctx, event, callerIp)
	default:
		logger.LogInfo(ctx, common.LogText("Stripe webhook ignored event event_type=%s client_ip=%s", string(event.Type), callerIp))
	}

	c.Status(http.StatusOK)
}

func sessionCompleted(ctx context.Context, event stripe.Event, callerIp string) error {
	customerId := event.GetObjectValue("customer")
	referenceId := event.GetObjectValue("client_reference_id")
	status := event.GetObjectValue("status")
	if "complete" != status {
		logger.LogWarn(ctx, common.LogText("Stripe checkout.completed has unexpected status, ignored trade_no=%s status=%s client_ip=%s", referenceId, status, callerIp))
		return nil
	}

	paymentStatus := event.GetObjectValue("payment_status")
	if paymentStatus != "paid" {
		logger.LogInfo(ctx, common.LogText("Stripe Checkout payment not completed, waiting for async result trade_no=%s payment_status=%s client_ip=%s", referenceId, paymentStatus, callerIp))
		return nil
	}

	return fulfillOrder(ctx, event, referenceId, customerId, callerIp)
}

// sessionAsyncPaymentSucceeded handles delayed payment methods (bank transfer, SEPA, etc.)
// that confirm payment after the checkout session completes.
func sessionAsyncPaymentSucceeded(ctx context.Context, event stripe.Event, callerIp string) error {
	customerId := event.GetObjectValue("customer")
	referenceId := event.GetObjectValue("client_reference_id")
	logger.LogInfo(ctx, common.LogText("Stripe async payment succeeded trade_no=%s client_ip=%s", referenceId, callerIp))

	return fulfillOrder(ctx, event, referenceId, customerId, callerIp)
}

// sessionAsyncPaymentFailed marks orders as failed when delayed payment methods
// ultimately fail (e.g. bank transfer not received, SEPA rejected).
func sessionAsyncPaymentFailed(ctx context.Context, event stripe.Event, callerIp string) {
	referenceId := event.GetObjectValue("client_reference_id")
	logger.LogWarn(ctx, common.LogText("Stripe async payment failed trade_no=%s client_ip=%s", referenceId, callerIp))

	if len(referenceId) == 0 {
		logger.LogWarn(ctx, common.LogText("Stripe async payment failed event missing order number client_ip=%s", callerIp))
		return
	}

	LockOrder(referenceId)
	defer UnlockOrder(referenceId)

	topUp := model.GetTopUpByTradeNo(referenceId)
	if topUp == nil {
		logger.LogWarn(ctx, common.LogText("Stripe async payment failed but local order not found trade_no=%s client_ip=%s", referenceId, callerIp))
		return
	}

	if topUp.PaymentProvider != model.PaymentProviderStripe {
		logger.LogWarn(ctx, common.LogText("Stripe async payment failed but order payment gateway mismatch trade_no=%s payment_provider=%s client_ip=%s", referenceId, topUp.PaymentProvider, callerIp))
		return
	}

	if topUp.Status != common.TopUpStatusPending {
		logger.LogInfo(ctx, common.LogText("Stripe async payment failed but order not pending, ignored trade_no=%s status=%s client_ip=%s", referenceId, topUp.Status, callerIp))
		return
	}

	topUp.Status = common.TopUpStatusFailed
	if err := topUp.Update(); err != nil {
		logger.LogError(ctx, common.LogText("Stripe failed to mark top-up order as failed trade_no=%s client_ip=%s error=%q", referenceId, callerIp, err.Error()))
		return
	}
	logger.LogInfo(ctx, common.LogText("Stripe top-up order marked as failed trade_no=%s client_ip=%s", referenceId, callerIp))
}

// fulfillOrder is the shared logic for crediting quota after payment is confirmed.
func fulfillOrder(ctx context.Context, event stripe.Event, referenceId string, customerId string, callerIp string) error {
	if len(referenceId) == 0 {
		logger.LogWarn(ctx, common.LogText("Stripe order completion missing order number client_ip=%s", callerIp))
		return nil
	}

	LockOrder(referenceId)
	defer UnlockOrder(referenceId)
	payload := map[string]any{
		"customer":     customerId,
		"amount_total": event.GetObjectValue("amount_total"),
		"currency":     strings.ToUpper(event.GetObjectValue("currency")),
		"event_type":   string(event.Type),
	}
	if err := model.CompleteSubscriptionOrder(referenceId, common.GetJsonString(payload), model.PaymentProviderStripe, ""); err == nil {
		logger.LogInfo(ctx, common.LogText("Stripe subscription order processed trade_no=%s event_type=%s client_ip=%s", referenceId, string(event.Type), callerIp))
		return nil
	} else if err != nil && !errors.Is(err, model.ErrSubscriptionOrderNotFound) {
		logger.LogError(ctx, common.LogText("Stripe subscription order processing failed trade_no=%s event_type=%s client_ip=%s error=%q", referenceId, string(event.Type), callerIp, err.Error()))
		return err
	}

	total, totalErr := decimal.NewFromString(event.GetObjectValue("amount_total"))
	tax := decimal.Zero
	if value := event.GetObjectValue("total_details", "amount_tax"); value != "" {
		var taxErr error
		tax, taxErr = decimal.NewFromString(value)
		if taxErr != nil {
			return taxErr
		}
	}
	if totalErr != nil {
		return totalErr
	}
	err := model.Recharge(referenceId, customerId, callerIp, model.AffiliatePayment{Amount: total.Sub(tax).Div(decimal.NewFromInt(100)).String(), Currency: event.GetObjectValue("currency")})
	if err != nil {
		logger.LogError(ctx, common.LogText("Stripe top-up processing failed trade_no=%s event_type=%s client_ip=%s error=%q", referenceId, string(event.Type), callerIp, err.Error()))
		return err
	}

	totalFloat, _ := strconv.ParseFloat(event.GetObjectValue("amount_total"), 64)
	currency := strings.ToUpper(event.GetObjectValue("currency"))
	logger.LogInfo(ctx, common.LogText("Stripe top-up succeeded trade_no=%s amount_total=%.2f currency=%s event_type=%s client_ip=%s", referenceId, totalFloat/100, currency, string(event.Type), callerIp))

	return nil
}
func sessionExpired(ctx context.Context, event stripe.Event) {
	referenceId := event.GetObjectValue("client_reference_id")
	status := event.GetObjectValue("status")
	if "expired" != status {
		logger.LogWarn(ctx, common.LogText("Stripe checkout.expired has unexpected status, ignored trade_no=%s status=%s", referenceId, status))
		return
	}

	if len(referenceId) == 0 {
		logger.LogWarn(ctx, common.LogText("Stripe checkout.expired missing order number"))
		return
	}

	// Subscription order expiration
	LockOrder(referenceId)
	defer UnlockOrder(referenceId)
	if err := model.ExpireSubscriptionOrder(referenceId, model.PaymentProviderStripe); err == nil {
		logger.LogInfo(ctx, common.LogText("Stripe subscription order expired trade_no=%s", referenceId))
		return
	} else if err != nil && !errors.Is(err, model.ErrSubscriptionOrderNotFound) {
		logger.LogError(ctx, common.LogText("Stripe subscription order expiry processing failed trade_no=%s error=%q", referenceId, err.Error()))
		return
	}

	err := model.UpdatePendingTopUpStatus(referenceId, model.PaymentProviderStripe, common.TopUpStatusExpired)
	if errors.Is(err, model.ErrTopUpNotFound) {
		logger.LogWarn(ctx, common.LogText("Stripe top-up order not found, cannot mark as expired trade_no=%s", referenceId))
		return
	}
	if err != nil {
		logger.LogError(ctx, common.LogText("Stripe top-up order expiry processing failed trade_no=%s error=%q", referenceId, err.Error()))
		return
	}

	logger.LogInfo(ctx, common.LogText("Stripe top-up order expired trade_no=%s", referenceId))
}

// genStripeLink generates a Stripe Checkout session URL for payment.
// It creates a new checkout session with the specified parameters and returns the payment URL.
//
// Parameters:
//   - referenceId: unique reference identifier for the transaction
//   - customerId: existing Stripe customer ID (empty string if new customer)
//   - email: customer email address for new customer creation
//   - amount: quantity of units to purchase
//   - successURL: custom URL to redirect after successful payment (empty for default)
//   - cancelURL: custom URL to redirect when payment is canceled (empty for default)
//
// Returns the checkout session and separately charged processing fee in cents.
func genStripeLink(referenceId string, customerId string, email string, amount int64, successURL string, cancelURL string, quote *stripeGBPQuote) (*stripe.CheckoutSession, int64, error) {
	if !strings.HasPrefix(setting.StripeApiSecret, "sk_") && !strings.HasPrefix(setting.StripeApiSecret, "rk_") {
		return nil, 0, errors.New("invalid Stripe API key")
	}

	backend := stripe.GetBackend(stripe.APIBackend)
	checkoutClient := session.Client{B: backend, Key: setting.StripeApiSecret}

	// Use custom URLs if provided, otherwise use defaults
	if successURL == "" {
		successURL = paymentReturnPath("/usage-logs")
	}
	if cancelURL == "" {
		cancelURL = paymentReturnPath("/wallet")
	}

	params := &stripe.CheckoutSessionParams{
		ClientReferenceID: stripe.String(referenceId),
		SuccessURL:        stripe.String(successURL),
		CancelURL:         stripe.String(cancelURL),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				Price:    stripe.String(setting.StripePriceId),
				Quantity: stripe.Int64(amount),
			},
		},
		Mode:                stripe.String(string(stripe.CheckoutSessionModePayment)),
		AllowPromotionCodes: stripe.Bool(setting.StripePromotionCodesEnabled),
	}
	var feeCents int64
	if quote != nil {
		if err := validateStripeGBPPrice(); err != nil {
			return nil, 0, err
		}
		params.Currency = stripe.String("gbp")
		params.AdaptivePricing = &stripe.CheckoutSessionAdaptivePricingParams{Enabled: stripe.Bool(false)}
		params.AllowPromotionCodes = stripe.Bool(false)
		params.LineItems[0].Quantity = stripe.Int64(quote.principalPence)
		feeCents = quote.feePence
	}
	feeSettings := operation_setting.GetPaymentSetting()
	if feeSettings.StripeFeeEnabled && quote == nil {
		// A coupon could discount the fee line as well as the principal. Do not
		// create a checkout whose fee differs from the disclosed calculation.
		if setting.StripePromotionCodesEnabled {
			return nil, 0, common.NewMessage("Disable Stripe promotion codes before enabling processing fees")
		}
		_, fee, err := getStripeProcessingFee(amount)
		if err != nil {
			return nil, 0, err
		}
		feeCents = fee
	}
	if feeCents > 0 {
		currency := "cny"
		if quote != nil {
			currency = "gbp"
		}
		params.LineItems = append(params.LineItems, &stripe.CheckoutSessionLineItemParams{
			Quantity: stripe.Int64(1),
			PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
				Currency: stripe.String(currency), UnitAmount: stripe.Int64(feeCents),
				ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{Name: stripe.String("Stripe processing fee / Stripe 支付手续费")},
			},
		})
	}

	if "" == customerId {
		if "" != email {
			params.CustomerEmail = stripe.String(email)
		}

		params.CustomerCreation = stripe.String(string(stripe.CheckoutSessionCustomerCreationAlways))
	} else {
		params.Customer = stripe.String(customerId)
	}

	result, err := checkoutClient.New(params)
	if err != nil {
		return nil, 0, err
	}

	if quote != nil && (result.Currency != stripe.CurrencyGBP || result.AmountTotal != quote.principalPence+quote.feePence) {
		return nil, 0, errors.New("Stripe checkout does not match the GBP payment quote")
	}
	return result, feeCents, nil
}

func getStripeProcessingFee(amount int64) (*stripe.Price, int64, error) {
	priceClient := price.Client{B: stripe.GetBackend(stripe.APIBackend), Key: setting.StripeApiSecret}
	configuredPrice, err := priceClient.Get(setting.StripePriceId, nil)
	if err != nil {
		return nil, 0, err
	}
	feeSettings := operation_setting.GetPaymentSetting()
	fee, err := calculateStripeProcessingFee(configuredPrice, amount, feeSettings.StripeFeePercent, feeSettings.StripeFeeFixedCNY)
	return configuredPrice, fee, err
}

// calculateStripeProcessingFee returns CNY minor units, separately from wallet
// credit. The fee is principal * percentage / 100 + fixed CNY, rounded up to a
// whole fen. Use the actual Stripe price, never the console's display rate.
func calculateStripeProcessingFee(configuredPrice *stripe.Price, amount int64, percent, fixedCNY float64) (int64, error) {
	for key, value := range map[string]float64{
		"payment_setting.stripe_fee_percent":   percent,
		"payment_setting.stripe_fee_fixed_cny": fixedCNY,
	} {
		if err := operation_setting.ValidateStripeFeeOption(key, strconv.FormatFloat(value, 'f', -1, 64)); err != nil {
			return 0, err
		}
	}
	if configuredPrice == nil || !configuredPrice.Active || configuredPrice.Currency != stripe.CurrencyCNY ||
		configuredPrice.Type != stripe.PriceTypeOneTime || configuredPrice.BillingScheme != stripe.PriceBillingSchemePerUnit ||
		configuredPrice.TransformQuantity != nil || configuredPrice.UnitAmount <= 0 ||
		(configuredPrice.UnitAmountDecimal != 0 && configuredPrice.UnitAmountDecimal != float64(configuredPrice.UnitAmount)) {
		return 0, common.NewMessage("Stripe processing fees require an active, one-time CNY price with a fixed unit amount")
	}
	if amount <= 0 || amount > 10000 {
		return 0, common.NewMessage("Invalid parameters")
	}
	principal := decimal.NewFromInt(configuredPrice.UnitAmount).Mul(decimal.NewFromInt(amount))
	fee := principal.Mul(decimal.NewFromFloat(percent)).Div(decimal.NewFromInt(100)).
		Add(decimal.NewFromFloat(fixedCNY).Mul(decimal.NewFromInt(100))).Ceil()
	// Stripe amounts support at most eight digits. Bound before integer conversion.
	if principal.Add(fee).GreaterThan(decimal.NewFromInt(99_999_999)) {
		return 0, common.NewMessage("Stripe payment amount exceeds the supported limit")
	}
	return fee.IntPart(), nil
}

func GetChargedAmount(count float64, user model.User) float64 {
	topUpGroupRatio := common.GetTopupGroupRatio(user.Group)
	if topUpGroupRatio == 0 {
		topUpGroupRatio = 1
	}

	return count * topUpGroupRatio
}

func getStripeCreditedQuota(amount int64, group string) decimal.Decimal {
	topUpGroupRatio := common.GetTopupGroupRatio(group)
	if topUpGroupRatio == 0 {
		topUpGroupRatio = 1
	}
	return decimal.NewFromInt(amount).
		Mul(decimal.NewFromFloat(topUpGroupRatio)).
		Mul(decimal.NewFromFloat(common.QuotaPerUnit))
}

func getStripePayMoney(amount float64, group string) float64 {
	originalAmount := amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		amount = amount / common.QuotaPerUnit
	}
	// Using float64 for monetary calculations is acceptable here due to the small amounts involved
	topupGroupRatio := common.GetTopupGroupRatio(group)
	if topupGroupRatio == 0 {
		topupGroupRatio = 1
	}
	// apply optional preset discount by the original request amount (if configured), default 1.0
	discount := 1.0
	if ds, ok := operation_setting.GetPaymentSetting().AmountDiscount[int(originalAmount)]; ok {
		if ds > 0 {
			discount = ds
		}
	}
	payMoney := amount * setting.StripeUnitPrice * topupGroupRatio * discount
	return payMoney
}

func getStripeMinTopup() int64 {
	minTopup := setting.StripeMinTopUp
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		minTopup = minTopup * int(common.QuotaPerUnit)
	}
	return int64(minTopup)
}

// stripeGBPQuote separates the CNY wallet principal from GBP presentment and fees.
// All amounts sent to Stripe are bounded integer pence; wallet credit remains USD-equivalent.
type stripeGBPQuote struct {
	Currency       string `json:"currency"`
	AmountCNY      int64  `json:"amount_cny"`
	Principal      string `json:"principal"`
	Fee            string `json:"fee"`
	Total          string `json:"total"`
	ExchangeRate   string `json:"exchange_rate"`
	QuoteID        string `json:"quote_id"`
	credit         decimal.Decimal
	principalPence int64
	feePence       int64
}

func calculateStripeGBPQuote(amountCNY int64, group string) (*stripeGBPQuote, error) {
	settings := *operation_setting.GetPaymentSetting()
	fx := settings.StripeGBPExchangeRate
	usdFX := operation_setting.USDExchangeRate
	if math.IsNaN(usdFX) || math.IsInf(usdFX, 0) || usdFX < 0.000001 || usdFX > 1000000 {
		return nil, common.NewMessage("Invalid parameters")
	}
	if err := operation_setting.ValidateStripeFeeOption("payment_setting.stripe_gbp_exchange_rate", strconv.FormatFloat(fx, 'f', -1, 64)); err != nil {
		return nil, err
	}
	if amountCNY <= 0 || amountCNY > 1000000 {
		return nil, common.NewMessage("Invalid parameters")
	}
	usd := decimal.NewFromInt(amountCNY).Div(decimal.NewFromFloat(usdFX))
	if usd.LessThan(decimal.NewFromInt(int64(setting.StripeMinTopUp))) {
		return nil, common.NewMessage("Top-up amount cannot be less than {{min}}", map[string]any{"min": decimal.NewFromInt(int64(setting.StripeMinTopUp)).Mul(decimal.NewFromFloat(usdFX)).Ceil().String()})
	}
	principal := decimal.NewFromInt(amountCNY).Mul(decimal.NewFromInt(100)).Div(decimal.NewFromFloat(fx)).Ceil()
	fee := decimal.Zero
	if settings.StripeFeeEnabled {
		for key, value := range map[string]float64{"payment_setting.stripe_fee_percent": settings.StripeFeePercent, "payment_setting.stripe_fee_fixed_gbp": settings.StripeFeeFixedGBP} {
			if err := operation_setting.ValidateStripeFeeOption(key, strconv.FormatFloat(value, 'f', -1, 64)); err != nil {
				return nil, err
			}
		}
		fee = principal.Mul(decimal.NewFromFloat(settings.StripeFeePercent)).Div(decimal.NewFromInt(100)).Add(decimal.NewFromFloat(settings.StripeFeeFixedGBP).Mul(decimal.NewFromInt(100))).Ceil()
	}
	if principal.LessThan(decimal.NewFromInt(30)) {
		return nil, common.NewMessage("Payment amount is too low")
	}
	if principal.Add(fee).GreaterThan(decimal.NewFromInt(99_999_999)) {
		return nil, common.NewMessage("Stripe payment amount exceeds the supported limit")
	}
	ratio := common.GetTopupGroupRatio(group)
	if ratio == 0 {
		ratio = 1
	}
	credit := usd.Mul(decimal.NewFromFloat(ratio))
	if _, err := common.WalletQuotaFromDecimalStrict(credit.Mul(decimal.NewFromFloat(common.QuotaPerUnit))); err != nil {
		return nil, err
	}
	quote := &stripeGBPQuote{Currency: "GBP", AmountCNY: amountCNY, Principal: principal.Div(decimal.NewFromInt(100)).StringFixed(2), Fee: fee.Div(decimal.NewFromInt(100)).StringFixed(2), Total: principal.Add(fee).Div(decimal.NewFromInt(100)).StringFixed(2), ExchangeRate: decimal.NewFromFloat(fx).String(), credit: credit, principalPence: principal.IntPart(), feePence: fee.IntPart()}
	// Recomputed at payment creation: a rate, wallet-credit, fee or price change requires a fresh confirmation.
	quote.QuoteID = common.Sha1([]byte(fmt.Sprintf("%d|%s|%s|%s|%s|%s", amountCNY, quote.Total, quote.ExchangeRate, credit.String(), setting.StripePriceId, quote.Fee)))
	return quote, nil
}

func validateStripeGBPPrice() error {
	client := price.Client{B: stripe.GetBackend(stripe.APIBackend), Key: setting.StripeApiSecret}
	p, err := client.Get(setting.StripePriceId, nil)
	if err != nil {
		return err
	}
	if !p.Active || p.Currency != stripe.CurrencyGBP || p.Type != stripe.PriceTypeOneTime || p.BillingScheme != stripe.PriceBillingSchemePerUnit || p.TransformQuantity != nil || p.UnitAmount != 1 || (p.UnitAmountDecimal != 0 && p.UnitAmountDecimal != 1) || p.CustomUnitAmount != nil {
		return common.NewMessage("Stripe GBP checkout requires an active one-time GBP 0.01 price")
	}
	return nil
}
