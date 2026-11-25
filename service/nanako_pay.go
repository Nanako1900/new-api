package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/shopspring/decimal"
)

const (
	NanakoPayHeaderAppID     = "X-NanakoPay-App-Id"
	NanakoPayHeaderTimestamp = "X-NanakoPay-Timestamp"
	NanakoPayHeaderSignature = "X-NanakoPay-Signature"
	NanakoPayHeaderEventID   = "X-NanakoPay-Event-Id"

	NanakoPayMaxAmountMinorUnits int64 = 10_000_000_000
	nanakoPayWebhookTolerance          = 300 * time.Second
	nanakoPayMaxRetries                = 2
	nanakoPayMaxRetryAfter             = 5 * time.Second
)

type NanakoPayClient struct {
	BaseURL    string
	AppID      string
	APISecret  string
	HTTPClient *http.Client
	Now        func() time.Time
	Sleep      func(ctx context.Context, d time.Duration) error
}

type NanakoPayCreateOrderRequest struct {
	MerchantOrderNo string         `json:"merchant_order_no"`
	Amount          int64          `json:"amount"`
	Currency        string         `json:"currency"`
	Subject         string         `json:"subject"`
	ReturnURL       string         `json:"return_url,omitempty"`
	Metadata        map[string]any `json:"metadata,omitempty"`
	PayerSub        string         `json:"payer_sub,omitempty"`
	ExpiresIn       *int           `json:"expires_in,omitempty"`
}

type NanakoPayOrder struct {
	OrderNo         string         `json:"order_no"`
	MerchantOrderNo string         `json:"merchant_order_no"`
	Mode            string         `json:"mode"`
	Status          string         `json:"status"`
	Amount          int64          `json:"amount"`
	Currency        string         `json:"currency"`
	Subject         string         `json:"subject"`
	Metadata        map[string]any `json:"metadata,omitempty"`
	PayerSub        string         `json:"payer_sub,omitempty"`
	ReturnURL       string         `json:"return_url,omitempty"`
	CashierURL      string         `json:"cashier_url,omitempty"`
	RefundedAmount  int64          `json:"refunded_amount"`
	PaidAt          string         `json:"paid_at,omitempty"`
	ExpiresAt       string         `json:"expires_at"`
	CreatedAt       string         `json:"created_at"`
}

type NanakoPayWebhookEvent struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Created int64  `json:"created"`
	Mode    string `json:"mode"`
	Data    struct {
		Order *NanakoPayOrder `json:"order,omitempty"`
	} `json:"data"`
}

type NanakoPayAPIError struct {
	StatusCode int
	Code       string
	Message    string
	RetryAfter time.Duration
}

func (e *NanakoPayAPIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("nanako pay api error status=%d code=%s", e.StatusCode, e.Code)
	}
	return fmt.Sprintf("nanako pay api error status=%d", e.StatusCode)
}

func (e *NanakoPayAPIError) Retryable() bool {
	if e == nil {
		return false
	}
	if e.StatusCode == http.StatusTooManyRequests {
		return true
	}
	return e.StatusCode >= http.StatusInternalServerError
}

func NewConfiguredNanakoPayClient() (*NanakoPayClient, error) {
	appID := strings.TrimSpace(setting.NanakoPayAppID)
	apiSecret := strings.TrimSpace(setting.NanakoPayApiSecret)
	if appID == "" || apiSecret == "" {
		return nil, errors.New("Nanako Pay credentials are not configured")
	}
	return &NanakoPayClient{
		BaseURL:    setting.GetNanakoPayBaseURL(),
		AppID:      appID,
		APISecret:  apiSecret,
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
	}, nil
}

// NanakoPayQueryEscape encodes query keys/values per the Nanako Pay canonical
// query spec: keep A-Z a-z 0-9 - _ . ~, write space as "+", and percent-encode
// every other byte as uppercase %XX.
func NanakoPayQueryEscape(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := range len(s) {
		c := s[i]
		switch {
		case (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~':
			b.WriteByte(c)
		case c == ' ':
			b.WriteByte('+')
		default:
			const hexDigits = "0123456789ABCDEF"
			b.WriteByte('%')
			b.WriteByte(hexDigits[c>>4])
			b.WriteByte(hexDigits[c&0x0F])
		}
	}
	return b.String()
}

// NanakoPayCanonicalQuery builds the canonical query string sorted by key bytes
// then value bytes.
func NanakoPayCanonicalQuery(rawQuery string) (string, error) {
	if rawQuery == "" {
		return "", nil
	}
	type pair struct {
		key   string
		value string
	}
	var pairs []pair
	for part := range strings.SplitSeq(rawQuery, "&") {
		if part == "" {
			continue
		}
		rawKey, rawVal, _ := strings.Cut(part, "=")
		key, err := url.QueryUnescape(rawKey)
		if err != nil {
			return "", fmt.Errorf("invalid query key: %w", err)
		}
		val, err := url.QueryUnescape(rawVal)
		if err != nil {
			return "", fmt.Errorf("invalid query value: %w", err)
		}
		pairs = append(pairs, pair{key: key, value: val})
	}
	slices.SortFunc(pairs, func(a, b pair) int {
		if a.key != b.key {
			return strings.Compare(a.key, b.key)
		}
		return strings.Compare(a.value, b.value)
	})
	var b strings.Builder
	for i, p := range pairs {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(NanakoPayQueryEscape(p.key))
		b.WriteByte('=')
		b.WriteString(NanakoPayQueryEscape(p.value))
	}
	return b.String(), nil
}

// SignNanakoPayRequest computes the three Nanako Pay authentication headers for
// a request with the exact serialized body bytes and timestamp.
func SignNanakoPayRequest(appID, apiSecret, method, rawURL string, body []byte, now time.Time) (http.Header, error) {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	canonicalQuery, err := NanakoPayCanonicalQuery(parsedURL.RawQuery)
	if err != nil {
		return nil, err
	}
	ts := strconv.FormatInt(now.Unix(), 10)
	bodySum := sha256.Sum256(body)
	canonical := strings.Join([]string{
		strings.ToUpper(method),
		parsedURL.Path,
		canonicalQuery,
		ts,
		hex.EncodeToString(bodySum[:]),
	}, "\n")

	mac := hmac.New(sha256.New, []byte(apiSecret))
	mac.Write([]byte(canonical))
	signature := hex.EncodeToString(mac.Sum(nil))

	headers := make(http.Header, 3)
	headers.Set(NanakoPayHeaderAppID, appID)
	headers.Set(NanakoPayHeaderTimestamp, ts)
	headers.Set(NanakoPayHeaderSignature, signature)
	return headers, nil
}

// VerifyNanakoPayWebhookSignature verifies X-NanakoPay-Signature against one or
// more configured webhook secrets (comma or newline separated during rotation).
func VerifyNanakoPayWebhookSignature(configuredSecrets, signatureHeader string, body []byte, now time.Time) bool {
	var timestamp string
	var signatures [][]byte
	for part := range strings.SplitSeq(signatureHeader, ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "t":
			timestamp = strings.TrimSpace(value)
		case "v1":
			if sig, err := hex.DecodeString(strings.TrimSpace(value)); err == nil && len(sig) > 0 {
				signatures = append(signatures, sig)
			}
		}
	}
	if timestamp == "" || len(signatures) == 0 {
		return false
	}
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	if skew := now.Sub(time.Unix(ts, 0)); skew > nanakoPayWebhookTolerance || skew < -nanakoPayWebhookTolerance {
		return false
	}

	secrets := splitNanakoPaySecrets(configuredSecrets)
	if len(secrets) == 0 {
		return false
	}

	for _, secret := range secrets {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(timestamp + "."))
		mac.Write(body)
		expected := mac.Sum(nil)
		for _, sig := range signatures {
			if hmac.Equal(expected, sig) {
				return true
			}
		}
	}
	return false
}

func splitNanakoPaySecrets(raw string) []string {
	var out []string
	for part := range strings.FieldsFuncSeq(raw, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r'
	}) {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func NanakoPayCurrencyDecimals(currency string) int32 {
	if strings.EqualFold(strings.TrimSpace(currency), "JPY") {
		return 0
	}
	return 2
}

// NanakoPayMoneyToMinorUnits converts a decimal major-unit amount into integer
// smallest currency units, verifying Nanako Pay's 1..10_000_000_000 bounds.
func NanakoPayMoneyToMinorUnits(amount decimal.Decimal, currency string) (int64, error) {
	if !setting.IsValidNanakoPayCurrency(currency) {
		return 0, errors.New("unsupported Nanako Pay currency")
	}
	decimals := NanakoPayCurrencyDecimals(currency)
	scale := decimal.New(1, decimals)
	scaled := amount.Mul(scale).Round(0)
	if scaled.LessThan(decimal.NewFromInt(1)) || scaled.GreaterThan(decimal.NewFromInt(NanakoPayMaxAmountMinorUnits)) {
		return 0, errors.New("Nanako Pay amount is out of range")
	}
	return scaled.IntPart(), nil
}

// NanakoPayFormatMinorUnits formats minor-unit integers into a major-unit
// decimal string suitable for UI display and AffiliatePayment.
func NanakoPayFormatMinorUnits(minorUnits int64, currency string) string {
	decimals := NanakoPayCurrencyDecimals(currency)
	if decimals == 0 {
		return strconv.FormatInt(minorUnits, 10)
	}
	return decimal.New(minorUnits, -decimals).StringFixed(decimals)
}

func (c *NanakoPayClient) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

func (c *NanakoPayClient) sleep(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	if c.Sleep != nil {
		return c.Sleep(ctx, d)
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (c *NanakoPayClient) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return &http.Client{Timeout: 30 * time.Second}
}

func (c *NanakoPayClient) doSignedJSON(ctx context.Context, method, fullURL string, body []byte, dest any) error {
	var lastErr error
	for attempt := range nanakoPayMaxRetries + 1 {
		if attempt > 0 {
			delay := time.Duration(attempt) * 500 * time.Millisecond
			var apiErr *NanakoPayAPIError
			if errors.As(lastErr, &apiErr) && apiErr.RetryAfter > 0 {
				delay = min(apiErr.RetryAfter, nanakoPayMaxRetryAfter)
			}
			if err := c.sleep(ctx, delay); err != nil {
				return err
			}
		}

		headers, err := SignNanakoPayRequest(c.AppID, c.APISecret, method, fullURL, body, c.now())
		if err != nil {
			return err
		}

		var bodyReader io.Reader
		if len(body) > 0 {
			bodyReader = bytes.NewReader(body)
		}
		req, err := http.NewRequestWithContext(ctx, method, fullURL, bodyReader)
		if err != nil {
			return err
		}
		for k, vals := range headers {
			for _, v := range vals {
				req.Header.Add(k, v)
			}
		}
		if len(body) > 0 {
			req.Header.Set("Content-Type", "application/json")
		}
		req.Header.Set("Accept", "application/json")

		resp, err := c.httpClient().Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return err
			}
			lastErr = err
			continue
		}

		respBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		_ = resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			continue
		}

		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
			if dest != nil {
				if err := common.Unmarshal(respBody, dest); err != nil {
					return fmt.Errorf("failed to parse Nanako Pay response: %w", err)
				}
			}
			return nil
		}

		apiErr := parseNanakoPayError(resp.StatusCode, resp.Header.Get("Retry-After"), respBody)
		if !apiErr.Retryable() {
			return apiErr
		}
		lastErr = apiErr
	}
	return lastErr
}

func parseNanakoPayError(statusCode int, retryAfterHeader string, body []byte) *NanakoPayAPIError {
	apiErr := &NanakoPayAPIError{StatusCode: statusCode}
	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := common.Unmarshal(body, &payload); err == nil {
		apiErr.Code = payload.Error.Code
		apiErr.Message = payload.Error.Message
	}
	if secs, err := strconv.Atoi(strings.TrimSpace(retryAfterHeader)); err == nil && secs > 0 {
		apiErr.RetryAfter = time.Duration(secs) * time.Second
	}
	return apiErr
}

func (c *NanakoPayClient) CreateOrder(ctx context.Context, req *NanakoPayCreateOrderRequest) (*NanakoPayOrder, error) {
	body, err := common.Marshal(req)
	if err != nil {
		return nil, err
	}
	endpoint := strings.TrimRight(c.BaseURL, "/") + "/orders"
	var order NanakoPayOrder
	if err := c.doSignedJSON(ctx, http.MethodPost, endpoint, body, &order); err != nil {
		return nil, err
	}
	return &order, nil
}

func (c *NanakoPayClient) GetOrder(ctx context.Context, orderNo string) (*NanakoPayOrder, error) {
	endpoint := strings.TrimRight(c.BaseURL, "/") + "/orders/" + url.PathEscape(strings.TrimSpace(orderNo))
	var order NanakoPayOrder
	if err := c.doSignedJSON(ctx, http.MethodGet, endpoint, nil, &order); err != nil {
		return nil, err
	}
	return &order, nil
}

func (c *NanakoPayClient) GetOrderByMerchantOrderNo(ctx context.Context, merchantOrderNo string) (*NanakoPayOrder, error) {
	endpoint := strings.TrimRight(c.BaseURL, "/") + "/orders?merchant_order_no=" + url.QueryEscape(strings.TrimSpace(merchantOrderNo))
	var order NanakoPayOrder
	if err := c.doSignedJSON(ctx, http.MethodGet, endpoint, nil, &order); err != nil {
		return nil, err
	}
	return &order, nil
}
