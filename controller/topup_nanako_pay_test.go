package controller

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNanakoPayKnownAnswerVectors(t *testing.T) {
	t.Run("canonical query vector", func(t *testing.T) {
		got, err := service.NanakoPayCanonicalQuery("b=2&a=x%20y&a=%2f&c")
		require.NoError(t, err)
		assert.Equal(t, "a=%2F&a=x+y&b=2&c=", got)
	})

	const (
		apiSecret = "example_api_secret_9f8e7d6c5b4a"
		appID     = "papp_06e8gq3vh1b2r9kd5x7n4tmwc0"
	)
	fixedTime := time.Unix(1795435200, 0).UTC()

	t.Run("POST /api/v1/pay/orders request signature", func(t *testing.T) {
		body := []byte(`{"merchant_order_no":"M-1001","amount":6800,"currency":"CNY","subject":"Annual plan"}`)
		headers, err := service.SignNanakoPayRequest(
			appID,
			apiSecret,
			http.MethodPost,
			"https://api.nanako.org/api/v1/pay/orders",
			body,
			fixedTime,
		)
		require.NoError(t, err)
		assert.Equal(t, appID, headers.Get(service.NanakoPayHeaderAppID))
		assert.Equal(t, "1795435200", headers.Get(service.NanakoPayHeaderTimestamp))
		assert.Equal(t, "185537dadb840741bfd4966038df18cfd6aef1a4818a1a27b42073575c126282", headers.Get(service.NanakoPayHeaderSignature))
	})

	t.Run("GET /api/v1/pay/orders?merchant_order_no=M-1001 query signature", func(t *testing.T) {
		headers, err := service.SignNanakoPayRequest(
			appID,
			apiSecret,
			http.MethodGet,
			"https://api.nanako.org/api/v1/pay/orders?merchant_order_no=M-1001",
			nil,
			fixedTime,
		)
		require.NoError(t, err)
		assert.Equal(t, "1d24256da8b289edb89ee4f23c5f7cb39cb6870d15f7c861a8e24d8cefbfdfe6", headers.Get(service.NanakoPayHeaderSignature))
	})

	t.Run("webhook payment.succeeded signature vector and rotation", func(t *testing.T) {
		const (
			webhookSecret = "example_webhook_secret_1a2b3c4d"
			sigHeader     = "t=1795435291,v1=838477787769d26883d329622c452b39f43fe7978d98845c13d9561efaa67bcc"
			rawBody       = `{"id":"evt_06e8h4c2d3e4f5g6h7j8k9m0n1","type":"payment.succeeded","created":1795435290,"mode":"live","data":{"order":{"order_no":"po_06e8h2k3m4n5p6q7r8s9t0v1w2","merchant_order_no":"M-1001","mode":"live","status":"paid","amount":6800,"currency":"CNY","subject":"Annual plan","refunded_amount":0,"paid_at":"2026-11-23T12:01:28Z","expires_at":"2026-11-23T12:30:00Z","created_at":"2026-11-23T12:00:00Z"}}}`
		)
		now := time.Unix(1795435291, 0).UTC()

		assert.True(t, service.VerifyNanakoPayWebhookSignature(webhookSecret, sigHeader, []byte(rawBody), now))
		assert.True(t, service.VerifyNanakoPayWebhookSignature("new_rotated_secret, "+webhookSecret, sigHeader, []byte(rawBody), now))
		assert.False(t, service.VerifyNanakoPayWebhookSignature(webhookSecret, sigHeader, []byte(rawBody), now.Add(301*time.Second)))
		assert.False(t, service.VerifyNanakoPayWebhookSignature("wrong_secret", sigHeader, []byte(rawBody), now))
		assert.False(t, service.VerifyNanakoPayWebhookSignature(webhookSecret, sigHeader, []byte(rawBody+" "), now))
	})
}

func TestNanakoPayMinorUnitConversions(t *testing.T) {
	testCases := []struct {
		name      string
		amount    string
		currency  string
		wantMinor int64
		wantFmt   string
	}{
		{"CNY fen", "68.00", "CNY", 6800, "68.00"},
		{"USD small", "0.01", "USD", 1, "0.01"},
		{"EUR fractional", "19.99", "EUR", 1999, "19.99"},
		{"GBP large", "123456.78", "GBP", 12345678, "123456.78"},
		{"JPY zero decimals", "6800", "JPY", 6800, "6800"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			d, err := decimal.NewFromString(tc.amount)
			require.NoError(t, err)
			minor, err := service.NanakoPayMoneyToMinorUnits(d, tc.currency)
			require.NoError(t, err)
			assert.Equal(t, tc.wantMinor, minor)
			formatted := service.NanakoPayFormatMinorUnits(minor, tc.currency)
			assert.Equal(t, tc.wantFmt, formatted)

			// Verify float64 DB round-trip stays exact.
			roundTripDec, err := decimal.NewFromString(formatted)
			require.NoError(t, err)
			roundTripMinor, err := service.NanakoPayMoneyToMinorUnits(decimal.NewFromFloat(roundTripDec.InexactFloat64()), tc.currency)
			require.NoError(t, err)
			assert.Equal(t, tc.wantMinor, roundTripMinor)
		})
	}
}

func TestNanakoPayClientRetryPolicy(t *testing.T) {
	t.Run("retries 503 with same merchant_order_no and fresh timestamp", func(t *testing.T) {
		var attempts atomic.Int32
		var seenTimestamps []string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			n := attempts.Add(1)
			seenTimestamps = append(seenTimestamps, r.Header.Get(service.NanakoPayHeaderTimestamp))
			if n == 1 {
				w.Header().Set("Retry-After", "1")
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"error":{"code":"try_again_later","message":"busy"}}`))
				return
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"order_no":"po_retry123","merchant_order_no":"NP-1","mode":"test","status":"pending","amount":6800,"currency":"CNY","subject":"Top-up","cashier_url":"https://pay.nanako.org/c/po_retry123"}`))
		}))
		defer server.Close()

		tick := int64(1795435200)
		client := &service.NanakoPayClient{
			BaseURL:    server.URL + "/api/v1/pay",
			AppID:      "papp_test",
			APISecret:  "secret_test",
			HTTPClient: server.Client(),
			Now: func() time.Time {
				tick++
				return time.Unix(tick, 0)
			},
			Sleep: func(ctx context.Context, d time.Duration) error { return nil },
		}

		order, err := client.CreateOrder(context.Background(), &service.NanakoPayCreateOrderRequest{
			MerchantOrderNo: "NP-1",
			Amount:          6800,
			Currency:        "CNY",
			Subject:         "Top-up",
		})
		require.NoError(t, err)
		assert.Equal(t, int32(2), attempts.Load())
		assert.Equal(t, "po_retry123", order.OrderNo)
		require.Len(t, seenTimestamps, 2)
		assert.NotEqual(t, seenTimestamps[0], seenTimestamps[1])
	})

	t.Run("never retries 401 invalid_signature", func(t *testing.T) {
		var attempts atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			attempts.Add(1)
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"code":"invalid_signature","message":"bad sig"}}`))
		}))
		defer server.Close()

		client := &service.NanakoPayClient{
			BaseURL:    server.URL + "/api/v1/pay",
			AppID:      "papp_test",
			APISecret:  "secret_test",
			HTTPClient: server.Client(),
			Sleep:      func(ctx context.Context, d time.Duration) error { return nil },
		}

		_, err := client.CreateOrder(context.Background(), &service.NanakoPayCreateOrderRequest{
			MerchantOrderNo: "NP-401",
			Amount:          100,
			Currency:        "CNY",
			Subject:         "Top-up",
		})
		require.Error(t, err)
		assert.Equal(t, int32(1), attempts.Load())
	})
}

func signNanakoPayWebhookForTest(secret string, ts int64, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.", ts)))
	mac.Write(body)
	return fmt.Sprintf("t=%d,v1=%s", ts, hex.EncodeToString(mac.Sum(nil)))
}

func setupNanakoPayControllerTestEnv(t *testing.T, serverURL string) {
	t.Helper()
	confirmPaymentComplianceForTest(t)

	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(
		&model.User{},
		&model.TopUp{},
		&model.Log{},
		&model.Option{},
		&model.AffiliateAccount{},
		&model.AffiliateOrder{},
		&model.AffiliateEntry{},
		&model.SubscriptionPlan{},
		&model.SubscriptionOrder{},
		&model.UserSubscription{},
	))

	origBaseURL := setting.NanakoPayBaseURL
	origAppID := setting.NanakoPayAppID
	origAPISecret := setting.NanakoPayApiSecret
	origWebhookSecret := setting.NanakoPayWebhookSecret
	origMode := setting.NanakoPayMode
	origCurrency := setting.NanakoPayCurrency
	origUnitPrice := setting.NanakoPayUnitPrice
	origMinTopUp := setting.NanakoPayMinTopUp
	origReturnURL := setting.NanakoPayReturnURL
	origServerAddress := system_setting.ServerAddress
	origQuotaPerUnit := common.QuotaPerUnit
	origNow := nanakoPayNow
	origUSDExchangeRate := operation_setting.USDExchangeRate
	origPromotionsJSON := "[]"
	if existing := operation_setting.TopUpPromotionTiers(); len(existing) > 0 {
		if raw, err := common.Marshal(existing); err == nil {
			origPromotionsJSON = string(raw)
		}
	}

	t.Cleanup(func() {
		setting.NanakoPayBaseURL = origBaseURL
		setting.NanakoPayAppID = origAppID
		setting.NanakoPayApiSecret = origAPISecret
		setting.NanakoPayWebhookSecret = origWebhookSecret
		setting.NanakoPayMode = origMode
		setting.NanakoPayCurrency = origCurrency
		setting.NanakoPayUnitPrice = origUnitPrice
		setting.NanakoPayMinTopUp = origMinTopUp
		setting.NanakoPayReturnURL = origReturnURL
		system_setting.ServerAddress = origServerAddress
		common.QuotaPerUnit = origQuotaPerUnit
		nanakoPayNow = origNow
		operation_setting.USDExchangeRate = origUSDExchangeRate
		_ = operation_setting.SetTopUpPromotions(origPromotionsJSON)
		nanakoPayHandledEventsMu.Lock()
		clear(nanakoPayHandledEvents)
		nanakoPayHandledEventsMu.Unlock()
	})

	setting.NanakoPayBaseURL = serverURL + "/api/v1/pay"
	setting.NanakoPayAppID = "papp_testapp1234567890123456"
	setting.NanakoPayApiSecret = "test_api_secret_value"
	setting.NanakoPayWebhookSecret = "test_webhook_secret_value"
	setting.NanakoPayMode = setting.NanakoPayModeTest
	setting.NanakoPayCurrency = "CNY"
	setting.NanakoPayUnitPrice = 7.0
	setting.NanakoPayMinTopUp = 1
	setting.NanakoPayReturnURL = ""
	system_setting.ServerAddress = "https://shop.example.com"
	common.QuotaPerUnit = 500000
	operation_setting.USDExchangeRate = 7.0
	require.NoError(t, operation_setting.SetTopUpPromotions("[]"))
	nanakoPayNow = func() time.Time { return time.Unix(1795435291, 0).UTC() }
}

func TestNanakoPayTopUpAndWebhookEndToEnd(t *testing.T) {
	gin.SetMode(gin.TestMode)

	remoteStatus := "paid"
	var remoteAmount int64 = 7000
	remoteCurrency := "CNY"
	remoteMode := "test"
	createMode := "test"
	var getOrderStatusCode = http.StatusOK
	var lastCreatedMerchantNo string
	var getOrderCalls atomic.Int32

	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/pay/orders":
			assert.Equal(t, setting.NanakoPayAppID, r.Header.Get(service.NanakoPayHeaderAppID))
			assert.NotEmpty(t, r.Header.Get(service.NanakoPayHeaderSignature))
			var req service.NanakoPayCreateOrderRequest
			require.NoError(t, common.DecodeJson(r.Body, &req))
			lastCreatedMerchantNo = req.MerchantOrderNo
			w.WriteHeader(http.StatusCreated)
			resp, _ := common.Marshal(service.NanakoPayOrder{
				OrderNo:         "po_testorder001",
				MerchantOrderNo: req.MerchantOrderNo,
				Mode:            createMode,
				Status:          "pending",
				Amount:          req.Amount,
				Currency:        req.Currency,
				Subject:         req.Subject,
				CashierURL:      "https://pay.nanako.org/checkout/po_testorder001",
				ExpiresAt:       "2026-11-25T10:30:00Z",
				CreatedAt:       "2026-11-25T10:00:00Z",
			})
			_, _ = w.Write(resp)
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/v1/pay/orders/"):
			getOrderCalls.Add(1)
			if getOrderStatusCode != http.StatusOK {
				w.WriteHeader(getOrderStatusCode)
				_, _ = w.Write([]byte(`{"error":{"code":"order_not_found","message":"missing"}}`))
				return
			}
			orderNo := strings.TrimPrefix(r.URL.Path, "/api/v1/pay/orders/")
			resp, _ := common.Marshal(service.NanakoPayOrder{
				OrderNo:         orderNo,
				MerchantOrderNo: lastCreatedMerchantNo,
				Mode:            remoteMode,
				Status:          remoteStatus,
				Amount:          remoteAmount,
				Currency:        remoteCurrency,
				Subject:         "New API Top-up 10",
			})
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(resp)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer mockServer.Close()

	setupNanakoPayControllerTestEnv(t, mockServer.URL)

	user := &model.User{Id: 101, Username: "nanako_buyer", Status: common.UserStatusEnabled, Group: "default", Quota: 0}
	require.NoError(t, model.DB.Create(user).Error)

	router := gin.New()
	router.POST("/api/user/nanako-pay/amount", func(c *gin.Context) {
		c.Set("id", user.Id)
		RequestNanakoPayAmount(c)
	})
	router.POST("/api/user/nanako-pay/pay", func(c *gin.Context) {
		c.Set("id", user.Id)
		RequestNanakoPay(c)
	})
	router.POST("/api/nanako-pay/webhook", NanakoPayWebhook)

	// 1. Quote amount
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/user/nanako-pay/amount", strings.NewReader(`{"amount":10}`))
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"70.00"`)

	// 1b. Reject order when remote app mode mismatches configured mode
	createMode = "live"
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/user/nanako-pay/pay", strings.NewReader(`{"amount":10}`))
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"message":"error"`)
	failedOrder := model.GetTopUpByTradeNo(lastCreatedMerchantNo)
	require.NotNil(t, failedOrder)
	assert.Equal(t, common.TopUpStatusFailed, failedOrder.Status)
	createMode = "test"

	// 2. Create checkout order with bonus promotion tier (threshold 70 CNY -> +7 CNY = +1 base unit)
	require.NoError(t, operation_setting.SetTopUpPromotions(`[{"threshold_cny":70,"bonus_cny":7}]`))
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/user/nanako-pay/pay", strings.NewReader(`{"amount":10}`))
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	var payResp struct {
		Message string `json:"message"`
		Data    struct {
			CheckoutURL string `json:"checkout_url"`
			OrderID     string `json:"order_id"`
			OrderNo     string `json:"order_no"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &payResp))
	assert.Equal(t, "success", payResp.Message)
	assert.Equal(t, "https://pay.nanako.org/checkout/po_testorder001", payResp.Data.CheckoutURL)
	assert.Equal(t, lastCreatedMerchantNo, payResp.Data.OrderID)

	sendWebhook := func(body []byte, sig string) *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		httpReq := httptest.NewRequest(http.MethodPost, "/api/nanako-pay/webhook", bytes.NewReader(body))
		httpReq.Header.Set("Content-Type", "application/json")
		if sig != "" {
			httpReq.Header.Set(service.NanakoPayHeaderSignature, sig)
		}
		router.ServeHTTP(r, httpReq)
		return r
	}

	makeEventBody := func(eventID, eventType, mode, orderNo, tradeNo string, amount int64, currency string) []byte {
		ev := map[string]any{
			"id":      eventID,
			"type":    eventType,
			"created": 1795435290,
			"mode":    mode,
			"data": map[string]any{
				"order": map[string]any{
					"order_no":          orderNo,
					"merchant_order_no": tradeNo,
					"mode":              mode,
					"status":            "paid",
					"amount":            amount,
					"currency":          currency,
				},
			},
		}
		b, err := common.Marshal(ev)
		require.NoError(t, err)
		return b
	}

	// 3. Reject invalid signature
	badBody := makeEventBody("evt_bad_sig", "payment.succeeded", "test", "po_testorder001", lastCreatedMerchantNo, 7000, "CNY")
	assert.Equal(t, http.StatusUnauthorized, sendWebhook(badBody, "t=1795435291,v1=deadbeef").Code)

	// 4. Reject mode mismatch (live event sent to test app)
	liveBody := makeEventBody("evt_wrong_mode", "payment.succeeded", "live", "po_testorder001", lastCreatedMerchantNo, 7000, "CNY")
	assert.Equal(t, http.StatusBadRequest, sendWebhook(liveBody, signNanakoPayWebhookForTest(setting.NanakoPayWebhookSecret, 1795435291, liveBody)).Code)

	// 4b. Remote read returns 404 -> acknowledge 200 without retry loop
	getOrderStatusCode = http.StatusNotFound
	notFoundBody := makeEventBody("evt_not_found", "payment.succeeded", "test", "po_missing", lastCreatedMerchantNo, 7000, "CNY")
	assert.Equal(t, http.StatusOK, sendWebhook(notFoundBody, signNanakoPayWebhookForTest(setting.NanakoPayWebhookSecret, 1795435291, notFoundBody)).Code)
	getOrderStatusCode = http.StatusOK

	// 4c. Remote read still pending -> return 500 so Nanako Pay retries
	remoteStatus = "pending"
	pendingBody := makeEventBody("evt_still_pending", "payment.succeeded", "test", "po_testorder001", lastCreatedMerchantNo, 7000, "CNY")
	assert.Equal(t, http.StatusInternalServerError, sendWebhook(pendingBody, signNanakoPayWebhookForTest(setting.NanakoPayWebhookSecret, 1795435291, pendingBody)).Code)
	remoteStatus = "paid"

	// 5. Reject tampered/mismatched read-back amount without crediting
	remoteAmount = 6999
	mismatchBody := makeEventBody("evt_mismatch", "payment.succeeded", "test", "po_testorder001", lastCreatedMerchantNo, 6999, "CNY")
	assert.Equal(t, http.StatusOK, sendWebhook(mismatchBody, signNanakoPayWebhookForTest(setting.NanakoPayWebhookSecret, 1795435291, mismatchBody)).Code)
	var reloadedUser model.User
	require.NoError(t, model.DB.First(&reloadedUser, user.Id).Error)
	assert.Equal(t, 0, reloadedUser.Quota)

	// 6. Valid payment.succeeded credits base + 10% bonus quota exactly once
	remoteAmount = 7000
	validBody := makeEventBody("evt_paid_001", "payment.succeeded", "test", "po_testorder001", lastCreatedMerchantNo, 7000, "CNY")
	validSig := signNanakoPayWebhookForTest(setting.NanakoPayWebhookSecret, 1795435291, validBody)
	assert.Equal(t, http.StatusOK, sendWebhook(validBody, validSig).Code)
	require.NoError(t, model.DB.First(&reloadedUser, user.Id).Error)
	assert.Equal(t, 11*500000, reloadedUser.Quota)
	callsAfterFirst := getOrderCalls.Load()

	// 7. Duplicate webhook event is deduplicated (no extra credit, no extra read)
	assert.Equal(t, http.StatusOK, sendWebhook(validBody, validSig).Code)
	require.NoError(t, model.DB.First(&reloadedUser, user.Id).Error)
	assert.Equal(t, 11*500000, reloadedUser.Quota)
	assert.Equal(t, callsAfterFirst, getOrderCalls.Load())

	// 8. Unknown event type is acknowledged with 200
	unknownEvt := makeEventBody("evt_unknown_type", "refund.succeeded", "test", "po_unknown", "NP-UNKNOWN", 7000, "CNY")
	assert.Equal(t, http.StatusOK, sendWebhook(unknownEvt, signNanakoPayWebhookForTest(setting.NanakoPayWebhookSecret, 1795435291, unknownEvt)).Code)

	// 9. order.expired marks a pending order as expired
	pendingOrder := &model.TopUp{
		UserId:          user.Id,
		Amount:          5,
		Money:           35,
		TradeNo:         "NP-EXPIRE-TEST",
		PaymentMethod:   model.PaymentMethodNanakoPay,
		PaymentProvider: model.PaymentProviderNanakoPay,
		Status:          common.TopUpStatusPending,
		CreateTime:      time.Now().Unix(),
	}
	require.NoError(t, pendingOrder.Insert())
	expireEvt := makeEventBody("evt_expire_001", "order.expired", "test", "po_expire001", "NP-EXPIRE-TEST", 3500, "CNY")
	assert.Equal(t, http.StatusOK, sendWebhook(expireEvt, signNanakoPayWebhookForTest(setting.NanakoPayWebhookSecret, 1795435291, expireEvt)).Code)
	expiredTopUp := model.GetTopUpByTradeNo("NP-EXPIRE-TEST")
	require.NotNil(t, expiredTopUp)
	assert.Equal(t, common.TopUpStatusExpired, expiredTopUp.Status)
}

func TestNanakoPaySubscriptionPurchaseAndWebhook(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var createdTradeNo string
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/pay/orders":
			var req service.NanakoPayCreateOrderRequest
			require.NoError(t, common.DecodeJson(r.Body, &req))
			createdTradeNo = req.MerchantOrderNo
			assert.Equal(t, int64(1999), req.Amount)
			assert.Equal(t, "USD", req.Currency)
			w.WriteHeader(http.StatusCreated)
			resp, _ := common.Marshal(service.NanakoPayOrder{
				OrderNo:         "po_suborder001",
				MerchantOrderNo: req.MerchantOrderNo,
				Mode:            "test",
				Status:          "pending",
				Amount:          req.Amount,
				Currency:        req.Currency,
				CashierURL:      "https://pay.nanako.org/checkout/po_suborder001",
			})
			_, _ = w.Write(resp)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/pay/orders/po_suborder001":
			resp, _ := common.Marshal(service.NanakoPayOrder{
				OrderNo:         "po_suborder001",
				MerchantOrderNo: createdTradeNo,
				Mode:            "test",
				Status:          "paid",
				Amount:          1999,
				Currency:        "USD",
			})
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(resp)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer mockServer.Close()

	setupNanakoPayControllerTestEnv(t, mockServer.URL)

	user := &model.User{Id: 202, Username: "sub_buyer", Status: common.UserStatusEnabled, Group: "default"}
	require.NoError(t, model.DB.Create(user).Error)
	plan := &model.SubscriptionPlan{
		Id:            10,
		Title:         "Pro Monthly",
		PriceAmount:   19.99,
		Currency:      "USD",
		DurationUnit:  model.SubscriptionDurationMonth,
		DurationValue: 1,
		Enabled:       true,
		TotalAmount:   100000,
	}
	require.NoError(t, model.DB.Create(plan).Error)

	router := gin.New()
	router.POST("/api/subscription/nanako-pay/pay", func(c *gin.Context) {
		c.Set("id", user.Id)
		SubscriptionRequestNanakoPay(c)
	})
	router.POST("/api/nanako-pay/webhook", NanakoPayWebhook)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/subscription/nanako-pay/pay", strings.NewReader(`{"plan_id":10}`))
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"checkout_url":"https://pay.nanako.org/checkout/po_suborder001"`)
	require.True(t, strings.HasPrefix(createdTradeNo, nanakoPaySubscriptionTradePrefix))

	eventBody, err := common.Marshal(map[string]any{
		"id":      "evt_sub_paid_001",
		"type":    "payment.succeeded",
		"created": 1795435290,
		"mode":    "test",
		"data": map[string]any{
			"order": map[string]any{
				"order_no":          "po_suborder001",
				"merchant_order_no": createdTradeNo,
				"mode":              "test",
				"status":            "paid",
				"amount":            1999,
				"currency":          "USD",
			},
		},
	})
	require.NoError(t, err)

	whRec := httptest.NewRecorder()
	whReq := httptest.NewRequest(http.MethodPost, "/api/nanako-pay/webhook", bytes.NewReader(eventBody))
	whReq.Header.Set(service.NanakoPayHeaderSignature, signNanakoPayWebhookForTest(setting.NanakoPayWebhookSecret, 1795435291, eventBody))
	router.ServeHTTP(whRec, whReq)
	require.Equal(t, http.StatusOK, whRec.Code)

	subOrder := model.GetSubscriptionOrderByTradeNo(createdTradeNo)
	require.NotNil(t, subOrder)
	assert.Equal(t, common.TopUpStatusSuccess, subOrder.Status)

	var subCount int64
	require.NoError(t, model.DB.Model(&model.UserSubscription{}).Where("user_id = ? AND plan_id = ?", user.Id, plan.Id).Count(&subCount).Error)
	assert.Equal(t, int64(1), subCount)
}

func TestNanakoPayOptionValidationAndSecretStripping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}))

	origOptionMap := common.OptionMap
	origMode := setting.NanakoPayMode
	origCurrency := setting.NanakoPayCurrency
	origUnitPrice := setting.NanakoPayUnitPrice
	origMinTopUp := setting.NanakoPayMinTopUp
	t.Cleanup(func() {
		common.OptionMap = origOptionMap
		setting.NanakoPayMode = origMode
		setting.NanakoPayCurrency = origCurrency
		setting.NanakoPayUnitPrice = origUnitPrice
		setting.NanakoPayMinTopUp = origMinTopUp
	})

	common.OptionMap = map[string]string{
		"NanakoPayAppID":         "papp_public",
		"NanakoPayApiSecret":     "super_secret_api",
		"NanakoPayWebhookSecret": "super_secret_webhook",
		"NanakoPayMode":          "test",
		"NanakoPayCurrency":      "CNY",
		"NanakoPayBaseURL":       setting.DefaultNanakoPayBaseURL,
		"NanakoPayReturnURL":     "",
		"NanakoPayUnitPrice":     "1",
		"NanakoPayMinTopUp":      "1",
	}

	router := gin.New()
	router.GET("/api/option/", GetOptions)
	router.PUT("/api/option/", UpdateOption)

	// Secrets must be stripped from GET /api/option/
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/option/", nil))
	var resp struct {
		Success bool           `json:"success"`
		Data    []model.Option `json:"data"`
	}
	require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &resp))
	require.True(t, resp.Success)
	returned := make(map[string]string, len(resp.Data))
	for _, opt := range resp.Data {
		returned[opt.Key] = opt.Value
	}
	assert.Equal(t, "papp_public", returned["NanakoPayAppID"])
	assert.NotContains(t, returned, "NanakoPayApiSecret")
	assert.NotContains(t, returned, "NanakoPayWebhookSecret")

	// Invalid option values are rejected by PUT /api/option/
	invalidCases := []struct {
		key   string
		value any
	}{
		{"NanakoPayMode", "staging"},
		{"NanakoPayCurrency", "BTC"},
		{"NanakoPayBaseURL", "ftp://invalid.example.com"},
		{"NanakoPayReturnURL", "javascript:alert(1)"},
		{"NanakoPayUnitPrice", -1},
		{"NanakoPayMinTopUp", 0},
	}
	for _, tc := range invalidCases {
		body, err := common.Marshal(map[string]any{"key": tc.key, "value": tc.value})
		require.NoError(t, err)
		putRec := httptest.NewRecorder()
		router.ServeHTTP(putRec, httptest.NewRequest(http.MethodPut, "/api/option/", bytes.NewReader(body)))
		var putResp struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(putRec.Body.Bytes(), &putResp))
		assert.False(t, putResp.Success, "expected rejection for %s=%v", tc.key, tc.value)
	}
}
