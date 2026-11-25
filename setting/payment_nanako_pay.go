package setting

import "strings"

const (
	DefaultNanakoPayBaseURL  = "https://api.nanako.org/api/v1/pay"
	NanakoPayModeLive        = "live"
	NanakoPayModeTest        = "test"
	DefaultNanakoPayCurrency = "CNY"
)

var (
	NanakoPayBaseURL       string = DefaultNanakoPayBaseURL
	NanakoPayAppID         string
	NanakoPayApiSecret     string
	NanakoPayWebhookSecret string
	NanakoPayMode          string  = NanakoPayModeLive
	NanakoPayCurrency      string  = DefaultNanakoPayCurrency
	NanakoPayUnitPrice     float64 = 1.0
	NanakoPayMinTopUp      int     = 1
	NanakoPayReturnURL     string
)

var nanakoPaySupportedCurrencies = map[string]bool{
	"CNY": true,
	"USD": true,
	"EUR": true,
	"GBP": true,
	"HKD": true,
	"JPY": true,
}

func IsValidNanakoPayCurrency(currency string) bool {
	return nanakoPaySupportedCurrencies[strings.ToUpper(strings.TrimSpace(currency))]
}

func IsValidNanakoPayMode(mode string) bool {
	normalized := strings.ToLower(strings.TrimSpace(mode))
	return normalized == NanakoPayModeLive || normalized == NanakoPayModeTest
}

func GetNanakoPayBaseURL() string {
	base := strings.TrimRight(strings.TrimSpace(NanakoPayBaseURL), "/")
	if base == "" {
		return DefaultNanakoPayBaseURL
	}
	return base
}

func GetNanakoPayMode() string {
	normalized := strings.ToLower(strings.TrimSpace(NanakoPayMode))
	if normalized == NanakoPayModeTest {
		return NanakoPayModeTest
	}
	return NanakoPayModeLive
}

func GetNanakoPayCurrency() string {
	currency := strings.ToUpper(strings.TrimSpace(NanakoPayCurrency))
	if IsValidNanakoPayCurrency(currency) {
		return currency
	}
	return DefaultNanakoPayCurrency
}
