package controller

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/thanhpk/randstr"
)

type SubscriptionNanakoPayRequest struct {
	PlanId int `json:"plan_id"`
}

func resolveNanakoPaySubscriptionCurrency(plan *model.SubscriptionPlan) string {
	if plan != nil && setting.IsValidNanakoPayCurrency(plan.Currency) {
		return strings.ToUpper(strings.TrimSpace(plan.Currency))
	}
	return setting.GetNanakoPayCurrency()
}

func SubscriptionRequestNanakoPay(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	if !isNanakoPayTopUpEnabled() {
		common.ApiErrorT(c, "Nanako Pay is not configured")
		return
	}

	var req SubscriptionNanakoPayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}

	plan, err := model.GetSubscriptionPlanById(req.PlanId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !plan.Enabled {
		common.ApiErrorT(c, "Subscription plan is not enabled")
		return
	}
	if plan.PriceAmount < 0.01 {
		common.ApiErrorT(c, "Plan amount is too low")
		return
	}

	userId := c.GetInt("id")
	if plan.MaxPurchasePerUser > 0 {
		count, err := model.CountUserSubscriptionsByPlan(userId, plan.Id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			common.ApiErrorT(c, "Purchase limit for this plan has been reached")
			return
		}
	}

	currency := resolveNanakoPaySubscriptionCurrency(plan)
	minorUnits, err := service.NanakoPayMoneyToMinorUnits(decimal.NewFromFloat(plan.PriceAmount), currency)
	if err != nil {
		common.ApiErrorT(c, "Plan amount is too low")
		return
	}
	exactMoneyDecimal, _ := decimal.NewFromString(service.NanakoPayFormatMinorUnits(minorUnits, currency))
	exactMoney := exactMoneyDecimal.InexactFloat64()

	tradeNo := fmt.Sprintf("%s%d-%d-%s", nanakoPaySubscriptionTradePrefix, userId, time.Now().UnixMilli(), randstr.String(6))
	order := &model.SubscriptionOrder{
		UserId:          userId,
		PlanId:          plan.Id,
		Money:           exactMoney,
		TradeNo:         tradeNo,
		PaymentMethod:   model.PaymentMethodNanakoPay,
		PaymentProvider: model.PaymentProviderNanakoPay,
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}
	if err := order.Insert(); err != nil {
		common.ApiErrorT(c, "Failed to create order")
		return
	}

	client, err := service.NewConfiguredNanakoPayClient()
	if err != nil {
		_ = model.ExpireSubscriptionOrder(tradeNo, model.PaymentProviderNanakoPay)
		common.ApiErrorT(c, "Nanako Pay is not configured")
		return
	}

	remoteOrder, err := client.CreateOrder(c.Request.Context(), &service.NanakoPayCreateOrderRequest{
		MerchantOrderNo: tradeNo,
		Amount:          minorUnits,
		Currency:        currency,
		Subject:         sanitizeNanakoPaySubject(fmt.Sprintf("Subscription: %s", plan.Title), "Subscription"),
		ReturnURL:       resolveNanakoPayReturnURL("/wallet"),
		Metadata: map[string]any{
			"kind":    "subscription",
			"user_id": userId,
			"plan_id": plan.Id,
		},
	})
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("Nanako Pay failed to create subscription order user_id=%d plan_id=%d trade_no=%s error=%q", userId, plan.Id, tradeNo, err.Error()))
		_ = model.ExpireSubscriptionOrder(tradeNo, model.PaymentProviderNanakoPay)
		common.ApiErrorT(c, "Failed to start payment")
		return
	}
	expectedMode := setting.GetNanakoPayMode()
	if !strings.EqualFold(strings.TrimSpace(remoteOrder.Mode), expectedMode) {
		logger.LogError(c.Request.Context(), common.LogText("Nanako Pay subscription order mode mismatch user_id=%d plan_id=%d trade_no=%s order_no=%s expected=%s actual=%s", userId, plan.Id, tradeNo, remoteOrder.OrderNo, expectedMode, remoteOrder.Mode))
		_ = model.ExpireSubscriptionOrder(tradeNo, model.PaymentProviderNanakoPay)
		common.ApiErrorT(c, "Failed to start payment")
		return
	}
	if strings.TrimSpace(remoteOrder.CashierURL) == "" {
		logger.LogError(c.Request.Context(), common.LogText("Nanako Pay subscription order returned empty cashier url user_id=%d plan_id=%d trade_no=%s order_no=%s", userId, plan.Id, tradeNo, remoteOrder.OrderNo))
		_ = model.ExpireSubscriptionOrder(tradeNo, model.PaymentProviderNanakoPay)
		common.ApiErrorT(c, "Failed to start payment")
		return
	}

	logger.LogInfo(c.Request.Context(), common.LogText("Nanako Pay subscription order created user_id=%d plan_id=%d trade_no=%s order_no=%s mode=%s minor_units=%d currency=%s", userId, plan.Id, tradeNo, remoteOrder.OrderNo, remoteOrder.Mode, minorUnits, currency))
	c.JSON(http.StatusOK, gin.H{
		"message": "success",
		"data": gin.H{
			"checkout_url": remoteOrder.CashierURL,
			"order_id":     tradeNo,
			"order_no":     remoteOrder.OrderNo,
			"expires_at":   remoteOrder.ExpiresAt,
		},
	})
}
