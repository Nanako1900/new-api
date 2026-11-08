package operation_setting

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// ContentSafetySetting configures the AI review tier of the prompt content
// check. The block-word tier keeps using setting.SensitiveWords behind the
// CheckSensitiveEnabled and CheckSensitiveOnPromptEnabled switches.
type ContentSafetySetting struct {
	ReviewEnabled            bool   `json:"review_enabled"`
	ReviewWords              string `json:"review_words"`
	ReviewModel              string `json:"review_model"`
	ReviewGroup              string `json:"review_group"`
	ReviewPrompt             string `json:"review_prompt"`
	ReviewTimeoutSeconds     int    `json:"review_timeout_seconds"`
	ReviewMaxConcurrency     int    `json:"review_max_concurrency"`
	ReviewRateLimitPerMinute int    `json:"review_rate_limit_per_minute"`
	WindowChars              int    `json:"window_chars"`
	MaxWindows               int    `json:"max_windows"`
	CacheTTLSeconds          int    `json:"cache_ttl_seconds"`
	LogRetentionDays         int    `json:"log_retention_days"`
}

const ContentSafetyOptionPrefix = "content_safety_setting."

var contentSafetySetting = ContentSafetySetting{
	ReviewGroup:              "default",
	ReviewTimeoutSeconds:     15,
	ReviewMaxConcurrency:     16,
	ReviewRateLimitPerMinute: 30,
	WindowChars:              300,
	MaxWindows:               20,
	CacheTTLSeconds:          86400,
	LogRetentionDays:         30,
}

// contentSafetyIntBounds are the inclusive ranges of the integer options.
var contentSafetyIntBounds = map[string][2]int{
	"review_timeout_seconds":       {1, 60},
	"review_max_concurrency":       {1, 256},
	"review_rate_limit_per_minute": {1, 10000},
	"window_chars":                 {50, 2000},
	"max_windows":                  {1, 100},
	"cache_ttl_seconds":            {0, 604800},
	"log_retention_days":           {1, 3650},
}

var contentSafetyTextFields = []string{"review_enabled", "review_words", "review_model", "review_group", "review_prompt"}

func init() {
	config.GlobalConfig.Register("content_safety_setting", &contentSafetySetting)
}

func GetContentSafetySetting() *ContentSafetySetting {
	return &contentSafetySetting
}

// ReviewWordList returns the non-empty trimmed lines of ReviewWords.
func (s *ContentSafetySetting) ReviewWordList() []string {
	words := make([]string, 0)
	for word := range strings.SplitSeq(s.ReviewWords, "\n") {
		if word = strings.TrimSpace(word); word != "" {
			words = append(words, word)
		}
	}
	return words
}

// ValidateContentSafetyOptions checks the content_safety_setting.* entries of
// a complete request policy option map before it is stored.
func ValidateContentSafetyOptions(raw map[string]string) error {
	for key := range raw {
		field, ok := strings.CutPrefix(key, ContentSafetyOptionPrefix)
		if !ok {
			continue
		}
		if _, isInt := contentSafetyIntBounds[field]; !isInt && !slices.Contains(contentSafetyTextFields, field) {
			return fmt.Errorf("unknown content safety option: %s", key)
		}
	}
	for field, bounds := range contentSafetyIntBounds {
		value, err := strconv.Atoi(raw[ContentSafetyOptionPrefix+field])
		if err != nil || value < bounds[0] || value > bounds[1] {
			return fmt.Errorf("%s%s must be an integer from %d to %d", ContentSafetyOptionPrefix, field, bounds[0], bounds[1])
		}
	}
	enabled, err := strconv.ParseBool(raw[ContentSafetyOptionPrefix+"review_enabled"])
	if err != nil {
		return fmt.Errorf("invalid boolean: %sreview_enabled", ContentSafetyOptionPrefix)
	}
	if !enabled {
		return nil
	}
	for _, field := range []string{"review_model", "review_group", "review_words"} {
		if strings.TrimSpace(raw[ContentSafetyOptionPrefix+field]) == "" {
			return fmt.Errorf("AI review requires %s%s", ContentSafetyOptionPrefix, field)
		}
	}
	return nil
}
