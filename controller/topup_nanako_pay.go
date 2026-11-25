package controller

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/thanhpk/randstr"
)

const (
	nanakoPayTopUpTradePrefix        = "NP-"
	nanakoPaySubscriptionTradePrefix = "NP_SUB-"
	nanakoPayWebhookEventTTL         = 72 * time.Hour
	nanakoPayMaxInMemoryEvents       = 10000
	nanakoPayWebhookVerifyTimeout    = 8 * time.Second
)

var (
	nanakoPayNow             = time.Now
	nanakoPayHandledEventsMu sync.Mutex
	nanakoPayHandledEvents   = map[string]time.Time{}
)

type NanakoPayRequest struct {
	Amount int64 `json:"amount"`
}

func getNanakoPayMinTopup() int64 {
	minTopup := max(setting.NanakoPayMinTopUp, 1)
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		dMinTopup := decimal.NewFromInt(int64(minTopup))
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		quota, err := common.WalletQuotaFromDecimalStrict(dMinTopup.Mul(dQuotaPerUnit))
		if err != nil {
			return common.MaxWalletQuota
		}
		return int64(quota)
	}
	return int64(minTopup)
}

func getNanakoPayMoneyDecimal(amount int64, group string, offer operation_setting.TopUpOffer) decimal.Decimal {
	dAmount := decimal.NewFromInt(amount)
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		dAmount = dAmount.Div(decimal.NewFromFloat(common.QuotaPerUnit))
	}

	topupGroupRatio := common.GetTopupGroupRatio(group)
	if topupGroupRatio == 0 {
		topupGroupRatio = 1
	}

	discount := offer.WalletDiscountRate(amount)

	return dAmount.
		Mul(decimal.NewFromFloat(setting.NanakoPayUnitPrice)).
		Mul(decimal.NewFromFloat(topupGroupRatio)).
		Mul(decimal.NewFromFloat(discount))
}

func normalizeNanakoPayTopUpAmount(amount int64) int64 {
	if operation_setting.GetQuotaDisplayType() != operation_setting.QuotaDisplayTypeTokens {
		return amount
	}
	normalized := decimal.NewFromInt(amount).
		Div(decimal.NewFromFloat(common.QuotaPerUnit)).
		IntPart()
	return max(normalized, 1)
}

func resolveNanakoPayReturnURL(defaultSuffix string) string {
	candidate := strings.TrimSpace(setting.NanakoPayReturnURL)
	if candidate == "" {
		candidate = paymentReturnPath(defaultSuffix)
	}
	parsed, err := url.Parse(candidate)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return ""
	}
	return candidate
}

func sanitizeNanakoPaySubject(raw, fallback string) string {
	var b strings.Builder
	b.Grow(len(raw))
	for _, r := range raw {
		if unicode.IsControl(r) {
			b.WriteByte(' ')
			continue
		}
		b.WriteRune(r)
	}
	cleaned := strings.TrimSpace(b.String())
	if cleaned == "" {
		cleaned = fallback
	}
	runes := []rune(cleaned)
	if len(runes) > 128 {
		cleaned = strings.TrimSpace(string(runes[:128]))
	}
	if cleaned == "" {
		return fallback
	}
	return cleaned
}

func buildNanakoPayTopUpSubject(amount int64) string {
	appName := strings.TrimSpace(common.SystemName)
	if appName == "" {
		appName = "New API"
	}
	return sanitizeNanakoPaySubject(fmt.Sprintf("%s Top-up %d", appName, amount), "Wallet Top-up")
}

func RequestNanakoPayAmount(c *gin.Context) {
	if !isNanakoPayTopUpEnabled() {
		paymentError(c, common.NewMessage("Nanako Pay is not configured"))
		return
	}
	var req NanakoPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		paymentError(c, common.NewMessage("Invalid parameters"))
		return
	}

	minTopup := getNanakoPayMinTopup()
	if req.Amount < minTopup {
		paymentError(c, common.NewMessage("Top-up amount cannot be less than {{min}}", map[string]any{"min": minTopup}))
		return
	}
	id := c.GetInt("id")
	offer, err := rechargeAmountOffer(req.Amount)
	if err != nil {
		paymentError(c, err)
		return
	}
	if rejectInvalidTopUpQuota(c, id, req.Amount, offer.BonusQuota) {
		return
	}

	group, err := model.GetUserGroup(id, true)
	if err != nil {
		paymentError(c, common.NewMessage("Failed to get the user group"))
		return
	}

	currency := setting.GetNanakoPayCurrency()
	payMoney := getNanakoPayMoneyDecimal(req.Amount, group, offer)
	minorUnits, err := service.NanakoPayMoneyToMinorUnits(payMoney, currency)
	if err != nil {
		paymentError(c, common.NewMessage("Payment amount is too low"))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "success",
		"data":    service.NanakoPayFormatMinorUnits(minorUnits, currency),
	})
}

func RequestNanakoPay(c *gin.Context) {
	if !isNanakoPayTopUpEnabled() {
		paymentError(c, common.NewMessage("Nanako Pay is not configured"))
		return
	}

	var req NanakoPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		paymentError(c, common.NewMessage("Invalid parameters"))
		return
	}
	minTopup := getNanakoPayMinTopup()
	if req.Amount < minTopup {
		paymentError(c, common.NewMessage("Top-up amount cannot be less than {{min}}", map[string]any{"min": minTopup}))
		return
	}
	id := c.GetInt("id")
	offer, err := rechargeAmountOffer(req.Amount)
	if err != nil {
		paymentError(c, err)
		return
	}
	if rejectInvalidTopUpQuota(c, id, req.Amount, offer.BonusQuota) {
		return
	}

	user, err := model.GetUserById(id, false)
	if err != nil || user == nil {
		paymentError(c, common.NewMessage("User does not exist"))
		return
	}

	group, err := model.GetUserGroup(id, true)
	if err != nil {
		paymentError(c, common.NewMessage("Failed to get the user group"))
		return
	}

	currency := setting.GetNanakoPayCurrency()
	payMoneyDecimal := getNanakoPayMoneyDecimal(req.Amount, group, offer)
	minorUnits, err := service.NanakoPayMoneyToMinorUnits(payMoneyDecimal, currency)
	if err != nil {
		paymentError(c, common.NewMessage("Payment amount is too low"))
		return
	}
	exactMoneyDecimal, _ := decimal.NewFromString(service.NanakoPayFormatMinorUnits(minorUnits, currency))
	exactMoney := exactMoneyDecimal.InexactFloat64()

	tradeNo := fmt.Sprintf("%s%d-%d-%s", nanakoPayTopUpTradePrefix, id, time.Now().UnixMilli(), randstr.String(6))
	topUp := &model.TopUp{
		UserId:            id,
		BonusQuota:        offer.BonusQuota,
		Amount:            normalizeNanakoPayTopUpAmount(req.Amount),
		Money:             exactMoney,
		TradeNo:           tradeNo,
		PaymentMethod:     model.PaymentMethodNanakoPay,
		PaymentProvider:   model.PaymentProviderNanakoPay,
		AffiliateCurrency: currency,
		CreateTime:        time.Now().Unix(),
		Status:            common.TopUpStatusPending,
	}
	if currency == "GBP" && operation_setting.GetPaymentSetting().StripeGBPExchangeRate > 0 {
		topUp.AffiliateExchangeRate = decimal.NewFromFloat(operation_setting.GetPaymentSetting().StripeGBPExchangeRate).String()
	}
	if err := topUp.Insert(); err != nil {
		logger.LogError(c.Request.Context(), common.LogText("Nanako Pay failed to create top-up order user_id=%d trade_no=%s amount=%d error=%q", id, tradeNo, req.Amount, err.Error()))
		paymentError(c, common.NewMessage("Failed to create order"))
		return
	}

	client, err := service.NewConfiguredNanakoPayClient()
	if err != nil {
		topUp.Status = common.TopUpStatusFailed
		_ = topUp.Update()
		paymentError(c, common.NewMessage("Nanako Pay is not configured"))
		return
	}

	order, err := client.CreateOrder(c.Request.Context(), &service.NanakoPayCreateOrderRequest{
		MerchantOrderNo: tradeNo,
		Amount:          minorUnits,
		Currency:        currency,
		Subject:         buildNanakoPayTopUpSubject(req.Amount),
		ReturnURL:       resolveNanakoPayReturnURL("/wallet?show_history=true"),
		Metadata: map[string]any{
			"kind":    "topup",
			"user_id": id,
		},
	})
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("Nanako Pay failed to create checkout order user_id=%d trade_no=%s error=%q", id, tradeNo, err.Error()))
		topUp.Status = common.TopUpStatusFailed
		_ = topUp.Update()
		paymentError(c, common.NewMessage("Failed to start payment"))
		return
	}
	expectedMode := setting.GetNanakoPayMode()
	if !strings.EqualFold(strings.TrimSpace(order.Mode), expectedMode) {
		logger.LogError(c.Request.Context(), common.LogText("Nanako Pay order mode mismatch user_id=%d trade_no=%s order_no=%s expected=%s actual=%s", id, tradeNo, order.OrderNo, expectedMode, order.Mode))
		topUp.Status = common.TopUpStatusFailed
		_ = topUp.Update()
		paymentError(c, common.NewMessage("Failed to start payment"))
		return
	}
	if strings.TrimSpace(order.CashierURL) == "" {
		logger.LogError(c.Request.Context(), common.LogText("Nanako Pay order returned empty cashier url user_id=%d trade_no=%s order_no=%s status=%s", id, tradeNo, order.OrderNo, order.Status))
		topUp.Status = common.TopUpStatusFailed
		_ = topUp.Update()
		paymentError(c, common.NewMessage("Failed to start payment"))
		return
	}

	logger.LogInfo(c.Request.Context(), common.LogText("Nanako Pay top-up order created user_id=%d trade_no=%s order_no=%s mode=%s amount=%d minor_units=%d currency=%s", id, tradeNo, order.OrderNo, order.Mode, req.Amount, minorUnits, currency))
	c.JSON(http.StatusOK, gin.H{
		"message": "success",
		"data": gin.H{
			"checkout_url": order.CashierURL,
			"order_id":     tradeNo,
			"order_no":     order.OrderNo,
			"expires_at":   order.ExpiresAt,
		},
	})
}

func isNanakoPayEventHandled(ctx context.Context, eventID string) bool {
	if eventID == "" {
		return false
	}
	if common.RedisEnabled && common.RDB != nil {
		exists, err := common.RDB.Exists(ctx, "nanako_pay:webhook:event:"+eventID).Result()
		if err == nil && exists > 0 {
			return true
		}
	}
	now := nanakoPayNow()
	nanakoPayHandledEventsMu.Lock()
	defer nanakoPayHandledEventsMu.Unlock()
	if exp, ok := nanakoPayHandledEvents[eventID]; ok {
		if now.Before(exp) {
			return true
		}
		delete(nanakoPayHandledEvents, eventID)
	}
	return false
}

func markNanakoPayEventHandled(ctx context.Context, eventID string) {
	if eventID == "" {
		return
	}
	if common.RedisEnabled && common.RDB != nil {
		_ = common.RDB.Set(ctx, "nanako_pay:webhook:event:"+eventID, "1", nanakoPayWebhookEventTTL).Err()
	}
	now := nanakoPayNow()
	nanakoPayHandledEventsMu.Lock()
	defer nanakoPayHandledEventsMu.Unlock()
	if len(nanakoPayHandledEvents) >= nanakoPayMaxInMemoryEvents {
		for id, exp := range nanakoPayHandledEvents {
			if !now.Before(exp) {
				delete(nanakoPayHandledEvents, id)
			}
		}
		if len(nanakoPayHandledEvents) >= nanakoPayMaxInMemoryEvents {
			clear(nanakoPayHandledEvents)
		}
	}
	nanakoPayHandledEvents[eventID] = now.Add(nanakoPayWebhookEventTTL)
}

func NanakoPayWebhook(c *gin.Context) {
	ctx := c.Request.Context()
	if !isNanakoPayWebhookEnabled() {
		logger.LogWarn(ctx, common.LogText("Nanako Pay webhook rejected reason=webhook_disabled path=%q client_ip=%s", c.Request.RequestURI, c.ClientIP()))
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		logger.LogError(ctx, common.LogText("Nanako Pay webhook failed to read body path=%q client_ip=%s error=%q", c.Request.RequestURI, c.ClientIP(), err.Error()))
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	sigHeader := c.GetHeader(service.NanakoPayHeaderSignature)
	if !service.VerifyNanakoPayWebhookSignature(setting.NanakoPayWebhookSecret, sigHeader, bodyBytes, nanakoPayNow()) {
		logger.LogWarn(ctx, common.LogText("Nanako Pay webhook signature verification failed path=%q client_ip=%s", c.Request.RequestURI, c.ClientIP()))
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}

	var event service.NanakoPayWebhookEvent
	if err := common.Unmarshal(bodyBytes, &event); err != nil {
		logger.LogError(ctx, common.LogText("Nanako Pay webhook failed to parse payload path=%q client_ip=%s error=%q", c.Request.RequestURI, c.ClientIP(), err.Error()))
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	eventID := strings.TrimSpace(event.ID)
	if eventID == "" {
		eventID = strings.TrimSpace(c.GetHeader(service.NanakoPayHeaderEventID))
	}

	expectedMode := setting.GetNanakoPayMode()
	if !strings.EqualFold(strings.TrimSpace(event.Mode), expectedMode) {
		logger.LogWarn(ctx, common.LogText("Nanako Pay webhook mode mismatch expected=%s actual=%s event_id=%s client_ip=%s", expectedMode, event.Mode, eventID, c.ClientIP()))
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	if isNanakoPayEventHandled(ctx, eventID) {
		logger.LogInfo(ctx, common.LogText("Nanako Pay duplicate webhook event ignored event_id=%s event_type=%s client_ip=%s", eventID, event.Type, c.ClientIP()))
		c.Status(http.StatusOK)
		return
	}

	switch event.Type {
	case "payment.succeeded":
		if event.Data.Order == nil || strings.TrimSpace(event.Data.Order.OrderNo) == "" {
			logger.LogWarn(ctx, common.LogText("Nanako Pay payment.succeeded missing order_no event_id=%s client_ip=%s", eventID, c.ClientIP()))
			c.AbortWithStatus(http.StatusBadRequest)
			return
		}
		if err := handleNanakoPayPaymentSucceeded(ctx, eventID, event.Data.Order, expectedMode, c.ClientIP()); err != nil {
			logger.LogError(ctx, common.LogText("Nanako Pay payment.succeeded processing failed event_id=%s order_no=%s client_ip=%s error=%q", eventID, event.Data.Order.OrderNo, c.ClientIP(), err.Error()))
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
	case "order.expired", "order.closed":
		if event.Data.Order != nil && strings.TrimSpace(event.Data.Order.MerchantOrderNo) != "" {
			if err := handleNanakoPayOrderEnded(ctx, eventID, event.Type, event.Data.Order.MerchantOrderNo, c.ClientIP()); err != nil {
				logger.LogError(ctx, common.LogText("Nanako Pay order end processing failed event_id=%s event_type=%s trade_no=%s error=%q", eventID, event.Type, event.Data.Order.MerchantOrderNo, err.Error()))
				c.AbortWithStatus(http.StatusInternalServerError)
				return
			}
		}
	default:
		logger.LogInfo(ctx, common.LogText("Nanako Pay webhook acknowledged ignored event event_id=%s event_type=%s client_ip=%s", eventID, event.Type, c.ClientIP()))
	}

	markNanakoPayEventHandled(ctx, eventID)
	c.Status(http.StatusOK)
}

func handleNanakoPayPaymentSucceeded(ctx context.Context, eventID string, eventOrder *service.NanakoPayOrder, expectedMode, clientIP string) error {
	client, err := service.NewConfiguredNanakoPayClient()
	if err != nil {
		return err
	}

	// Confirm the order server-side before fulfilling (Nanako Pay contract),
	// bounded inside Nanako Pay's 10s webhook delivery timeout.
	verifyCtx, cancel := context.WithTimeout(ctx, nanakoPayWebhookVerifyTimeout)
	defer cancel()

	remoteOrder, err := client.GetOrder(verifyCtx, eventOrder.OrderNo)
	if err != nil {
		var apiErr *service.NanakoPayAPIError
		if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusNotFound {
			logger.LogWarn(ctx, common.LogText("Nanako Pay order not found on server verification event_id=%s order_no=%s", eventID, eventOrder.OrderNo))
			return nil
		}
		return err
	}
	if remoteOrder.Status == "pending" {
		return fmt.Errorf("order %s is still pending on server verification", remoteOrder.OrderNo)
	}
	if remoteOrder.Status != "paid" {
		logger.LogWarn(ctx, common.LogText("Nanako Pay order not paid on server verification event_id=%s order_no=%s status=%s", eventID, remoteOrder.OrderNo, remoteOrder.Status))
		return nil
	}
	if !strings.EqualFold(strings.TrimSpace(remoteOrder.Mode), expectedMode) {
		logger.LogWarn(ctx, common.LogText("Nanako Pay read-back mode mismatch expected=%s actual=%s event_id=%s order_no=%s", expectedMode, remoteOrder.Mode, eventID, remoteOrder.OrderNo))
		return nil
	}

	tradeNo := strings.TrimSpace(remoteOrder.MerchantOrderNo)
	if tradeNo == "" {
		logger.LogWarn(ctx, common.LogText("Nanako Pay read-back order missing merchant_order_no event_id=%s order_no=%s", eventID, remoteOrder.OrderNo))
		return nil
	}
	if eventMerchantNo := strings.TrimSpace(eventOrder.MerchantOrderNo); eventMerchantNo != "" && eventMerchantNo != tradeNo {
		logger.LogWarn(ctx, common.LogText("Nanako Pay read-back merchant_order_no mismatch event_id=%s order_no=%s event_trade_no=%s remote_trade_no=%s", eventID, remoteOrder.OrderNo, eventMerchantNo, tradeNo))
		return nil
	}

	LockOrder(tradeNo)
	defer UnlockOrder(tradeNo)

	if strings.HasPrefix(tradeNo, nanakoPaySubscriptionTradePrefix) {
		return fulfillNanakoPaySubscriptionOrder(ctx, eventID, tradeNo, remoteOrder, clientIP)
	}
	return fulfillNanakoPayTopUpOrder(ctx, eventID, tradeNo, remoteOrder, clientIP)
}

func fulfillNanakoPayTopUpOrder(ctx context.Context, eventID, tradeNo string, remoteOrder *service.NanakoPayOrder, clientIP string) error {
	topUp := model.GetTopUpByTradeNo(tradeNo)
	if topUp == nil {
		logger.LogInfo(ctx, common.LogText("Nanako Pay webhook ignored unknown top-up order event_id=%s trade_no=%s order_no=%s", eventID, tradeNo, remoteOrder.OrderNo))
		return nil
	}
	if topUp.PaymentProvider != model.PaymentProviderNanakoPay {
		logger.LogWarn(ctx, common.LogText("Nanako Pay top-up provider mismatch event_id=%s trade_no=%s provider=%s", eventID, tradeNo, topUp.PaymentProvider))
		return nil
	}

	expectedCurrency := setting.GetNanakoPayCurrency()
	expectedMinorUnits, err := service.NanakoPayMoneyToMinorUnits(decimal.NewFromFloat(topUp.Money), expectedCurrency)
	if err != nil {
		logger.LogError(ctx, common.LogText("Nanako Pay failed to compute expected minor units event_id=%s trade_no=%s error=%q", eventID, tradeNo, err.Error()))
		return nil
	}
	if !strings.EqualFold(remoteOrder.Currency, expectedCurrency) || remoteOrder.Amount != expectedMinorUnits {
		logger.LogError(ctx, common.LogText("Nanako Pay order amount/currency mismatch event_id=%s trade_no=%s order_no=%s expected_amount=%d actual_amount=%d expected_currency=%s actual_currency=%s",
			eventID, tradeNo, remoteOrder.OrderNo, expectedMinorUnits, remoteOrder.Amount, expectedCurrency, remoteOrder.Currency))
		return nil
	}

	affiliatePayment := model.AffiliatePayment{
		Amount:   service.NanakoPayFormatMinorUnits(remoteOrder.Amount, remoteOrder.Currency),
		Currency: strings.ToUpper(remoteOrder.Currency),
	}
	alreadyDone, err := model.RechargeNanakoPay(tradeNo, clientIP, affiliatePayment)
	if err != nil {
		if errors.Is(err, model.ErrTopUpNotFound) || errors.Is(err, model.ErrPaymentMethodMismatch) || errors.Is(err, model.ErrTopUpStatusInvalid) {
			logger.LogWarn(ctx, common.LogText("Nanako Pay top-up order not eligible for settlement event_id=%s trade_no=%s error=%q", eventID, tradeNo, err.Error()))
			return nil
		}
		return err
	}
	if alreadyDone {
		logger.LogInfo(ctx, common.LogText("Nanako Pay duplicate top-up settlement ignored event_id=%s trade_no=%s order_no=%s", eventID, tradeNo, remoteOrder.OrderNo))
	} else {
		logger.LogInfo(ctx, common.LogText("Nanako Pay top-up succeeded event_id=%s trade_no=%s order_no=%s amount=%d currency=%s client_ip=%s", eventID, tradeNo, remoteOrder.OrderNo, remoteOrder.Amount, remoteOrder.Currency, clientIP))
	}
	return nil
}

func fulfillNanakoPaySubscriptionOrder(ctx context.Context, eventID, tradeNo string, remoteOrder *service.NanakoPayOrder, clientIP string) error {
	subOrder := model.GetSubscriptionOrderByTradeNo(tradeNo)
	if subOrder == nil {
		logger.LogInfo(ctx, common.LogText("Nanako Pay webhook ignored unknown subscription order event_id=%s trade_no=%s order_no=%s", eventID, tradeNo, remoteOrder.OrderNo))
		return nil
	}
	if subOrder.PaymentProvider != model.PaymentProviderNanakoPay {
		logger.LogWarn(ctx, common.LogText("Nanako Pay subscription provider mismatch event_id=%s trade_no=%s provider=%s", eventID, tradeNo, subOrder.PaymentProvider))
		return nil
	}

	expectedCurrency := setting.GetNanakoPayCurrency()
	if plan, err := model.GetSubscriptionPlanById(subOrder.PlanId); err == nil && plan != nil {
		expectedCurrency = resolveNanakoPaySubscriptionCurrency(plan)
	}
	expectedMinorUnits, err := service.NanakoPayMoneyToMinorUnits(decimal.NewFromFloat(subOrder.Money), expectedCurrency)
	if err != nil {
		logger.LogError(ctx, common.LogText("Nanako Pay failed to compute expected subscription minor units event_id=%s trade_no=%s error=%q", eventID, tradeNo, err.Error()))
		return nil
	}
	if !strings.EqualFold(remoteOrder.Currency, expectedCurrency) || remoteOrder.Amount != expectedMinorUnits {
		logger.LogError(ctx, common.LogText("Nanako Pay subscription amount/currency mismatch event_id=%s trade_no=%s order_no=%s expected_amount=%d actual_amount=%d expected_currency=%s actual_currency=%s",
			eventID, tradeNo, remoteOrder.OrderNo, expectedMinorUnits, remoteOrder.Amount, expectedCurrency, remoteOrder.Currency))
		return nil
	}

	payload := map[string]any{
		"event_id": eventID,
		"order_no": remoteOrder.OrderNo,
		"mode":     remoteOrder.Mode,
		"amount":   remoteOrder.Amount,
		"currency": strings.ToUpper(remoteOrder.Currency),
	}
	if err := model.CompleteSubscriptionOrder(tradeNo, common.GetJsonString(payload), model.PaymentProviderNanakoPay, ""); err != nil {
		if errors.Is(err, model.ErrSubscriptionOrderNotFound) || errors.Is(err, model.ErrPaymentMethodMismatch) {
			logger.LogWarn(ctx, common.LogText("Nanako Pay subscription order skipped event_id=%s trade_no=%s error=%q", eventID, tradeNo, err.Error()))
			return nil
		}
		return err
	}
	logger.LogInfo(ctx, common.LogText("Nanako Pay subscription order succeeded event_id=%s trade_no=%s order_no=%s client_ip=%s", eventID, tradeNo, remoteOrder.OrderNo, clientIP))
	return nil
}

func handleNanakoPayOrderEnded(ctx context.Context, eventID, eventType, tradeNo, clientIP string) error {
	LockOrder(tradeNo)
	defer UnlockOrder(tradeNo)

	if strings.HasPrefix(tradeNo, nanakoPaySubscriptionTradePrefix) {
		err := model.ExpireSubscriptionOrder(tradeNo, model.PaymentProviderNanakoPay)
		if errors.Is(err, model.ErrSubscriptionOrderNotFound) || errors.Is(err, model.ErrPaymentMethodMismatch) {
			return nil
		}
		if err == nil {
			logger.LogInfo(ctx, common.LogText("Nanako Pay subscription order marked expired event_id=%s event_type=%s trade_no=%s client_ip=%s", eventID, eventType, tradeNo, clientIP))
		}
		return err
	}

	err := model.UpdatePendingTopUpStatus(tradeNo, model.PaymentProviderNanakoPay, common.TopUpStatusExpired)
	if errors.Is(err, model.ErrTopUpNotFound) || errors.Is(err, model.ErrPaymentMethodMismatch) || errors.Is(err, model.ErrTopUpStatusInvalid) {
		return nil
	}
	if err == nil {
		logger.LogInfo(ctx, common.LogText("Nanako Pay top-up order marked expired event_id=%s event_type=%s trade_no=%s client_ip=%s", eventID, eventType, tradeNo, clientIP))
	}
	return err
}
