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

type contentSafetyIntOption struct {
	field    string
	min, max int
	ptr      func(*ContentSafetySetting) *int
}

// contentSafetyIntOptions lists the integer options in a fixed order with their
// inclusive ranges, so validation errors are deterministic.
var contentSafetyIntOptions = []contentSafetyIntOption{
	{"review_timeout_seconds", 1, 60, func(s *ContentSafetySetting) *int { return &s.ReviewTimeoutSeconds }},
	{"review_max_concurrency", 1, 256, func(s *ContentSafetySetting) *int { return &s.ReviewMaxConcurrency }},
	{"review_rate_limit_per_minute", 1, 10000, func(s *ContentSafetySetting) *int { return &s.ReviewRateLimitPerMinute }},
	{"window_chars", 50, 2000, func(s *ContentSafetySetting) *int { return &s.WindowChars }},
	{"max_windows", 1, 100, func(s *ContentSafetySetting) *int { return &s.MaxWindows }},
	{"cache_ttl_seconds", 0, 604800, func(s *ContentSafetySetting) *int { return &s.CacheTTLSeconds }},
	{"log_retention_days", 1, 3650, func(s *ContentSafetySetting) *int { return &s.LogRetentionDays }},
}

var contentSafetyNonIntFields = []string{"review_enabled", "review_words", "review_model", "review_group", "review_prompt"}

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

// Bounded returns a copy with every integer clamped to its range and the model
// and group names trimmed. Values loaded from the database bypass validation
// (manual edits, older nodes), so consumers read this copy.
func (s *ContentSafetySetting) Bounded() ContentSafetySetting {
	bounded := *s
	for _, option := range contentSafetyIntOptions {
		value := option.ptr(&bounded)
		*value = min(max(*value, option.min), option.max)
	}
	bounded.ReviewModel = strings.TrimSpace(bounded.ReviewModel)
	bounded.ReviewGroup = strings.TrimSpace(bounded.ReviewGroup)
	return bounded
}

// ValidateContentSafetyOptions checks the content_safety_setting.* entries of
// a complete request policy option map on every load, refresh and write.
func ValidateContentSafetyOptions(raw map[string]string) error {
	for key := range raw {
		field, ok := strings.CutPrefix(key, ContentSafetyOptionPrefix)
		if !ok {
			continue
		}
		isInt := slices.ContainsFunc(contentSafetyIntOptions, func(o contentSafetyIntOption) bool { return o.field == field })
		if !isInt && !slices.Contains(contentSafetyNonIntFields, field) {
			return fmt.Errorf("unknown content safety option: %s", key)
		}
	}
	for _, option := range contentSafetyIntOptions {
		value, err := strconv.Atoi(raw[ContentSafetyOptionPrefix+option.field])
		if err != nil || value < option.min || value > option.max {
			return fmt.Errorf("%s%s must be an integer from %d to %d", ContentSafetyOptionPrefix, option.field, option.min, option.max)
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
