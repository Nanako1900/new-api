package operation_setting

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// Content review modes. Shadow reviews every new message in the background
// and never blocks; enforce reviews the same way but holds the requests of
// accounts that need a synchronous review until the reviewer answers.
const (
	ContentReviewModeOff     = "off"
	ContentReviewModeShadow  = "shadow"
	ContentReviewModeEnforce = "enforce"
)

// ContentSafetySetting configures the AI review of request content. The
// zero-tolerance block-word tier keeps using setting.SensitiveWords behind
// the CheckSensitiveEnabled and CheckSensitiveOnPromptEnabled switches.
type ContentSafetySetting struct {
	ReviewMode               string `json:"review_mode"`
	ReviewModel              string `json:"review_model"`
	ReviewGroup              string `json:"review_group"`
	ReviewPrompt             string `json:"review_prompt"`
	ReviewToolResults        bool   `json:"review_tool_results"`
	ReviewTimeoutSeconds     int    `json:"review_timeout_seconds"`
	ReviewMaxConcurrency     int    `json:"review_max_concurrency"`
	ReviewRateLimitPerMinute int    `json:"review_rate_limit_per_minute"`
	UnitChars                int    `json:"unit_chars"`
	MaxUnits                 int    `json:"max_units"`
	AsyncWorkers             int    `json:"async_workers"`
	AsyncQueueSize           int    `json:"async_queue_size"`
	AsyncRatePerMinute       int    `json:"async_rate_per_minute"`
	PassLogPercent           int    `json:"pass_log_percent"`
	SyncAll                  bool   `json:"sync_all"`
	SyncNewUserDays          int    `json:"sync_new_user_days"`
	SyncGroups               string `json:"sync_groups"`
	CacheTTLSeconds          int    `json:"cache_ttl_seconds"`
	LogRetentionDays         int    `json:"log_retention_days"`
}

const ContentSafetyOptionPrefix = "content_safety_setting."

// RetiredContentSafetyOptionKeys are the options of the keyword-triggered
// review. Stored rows of them are ignored, so an old database or an old
// frontend cannot break the request policy.
var RetiredContentSafetyOptionKeys = []string{
	ContentSafetyOptionPrefix + "review_enabled",
	ContentSafetyOptionPrefix + "review_words",
	ContentSafetyOptionPrefix + "window_chars",
	ContentSafetyOptionPrefix + "max_windows",
}

var contentSafetySetting = ContentSafetySetting{
	ReviewMode:               ContentReviewModeOff,
	ReviewGroup:              "default",
	ReviewToolResults:        true,
	ReviewTimeoutSeconds:     15,
	ReviewMaxConcurrency:     16,
	ReviewRateLimitPerMinute: 120,
	UnitChars:                2000,
	MaxUnits:                 16,
	AsyncWorkers:             4,
	AsyncQueueSize:           2000,
	AsyncRatePerMinute:       300,
	PassLogPercent:           10,
	SyncNewUserDays:          3,
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
	{"unit_chars", 200, 8000, func(s *ContentSafetySetting) *int { return &s.UnitChars }},
	{"max_units", 1, 100, func(s *ContentSafetySetting) *int { return &s.MaxUnits }},
	{"async_workers", 1, 64, func(s *ContentSafetySetting) *int { return &s.AsyncWorkers }},
	{"async_queue_size", 10, 100000, func(s *ContentSafetySetting) *int { return &s.AsyncQueueSize }},
	{"async_rate_per_minute", 1, 10000, func(s *ContentSafetySetting) *int { return &s.AsyncRatePerMinute }},
	{"pass_log_percent", 0, 100, func(s *ContentSafetySetting) *int { return &s.PassLogPercent }},
	{"sync_new_user_days", 0, 365, func(s *ContentSafetySetting) *int { return &s.SyncNewUserDays }},
	{"cache_ttl_seconds", 0, 604800, func(s *ContentSafetySetting) *int { return &s.CacheTTLSeconds }},
	{"log_retention_days", 1, 3650, func(s *ContentSafetySetting) *int { return &s.LogRetentionDays }},
}

var contentSafetyBoolFields = []string{"review_tool_results", "sync_all"}

var contentSafetyStringFields = []string{"review_mode", "review_model", "review_group", "review_prompt", "sync_groups"}

func init() {
	config.GlobalConfig.Register("content_safety_setting", &contentSafetySetting)
}

func GetContentSafetySetting() *ContentSafetySetting {
	return &contentSafetySetting
}

// ReviewActive reports whether request content goes to the AI reviewer.
func (s *ContentSafetySetting) ReviewActive() bool {
	return s.ReviewMode == ContentReviewModeShadow || s.ReviewMode == ContentReviewModeEnforce
}

// SyncGroupList returns the non-empty trimmed lines of SyncGroups.
func (s *ContentSafetySetting) SyncGroupList() []string {
	groups := make([]string, 0)
	for group := range strings.SplitSeq(s.SyncGroups, "\n") {
		if group = strings.TrimSpace(group); group != "" {
			groups = append(groups, group)
		}
	}
	return groups
}

// Bounded returns a copy with every integer clamped to its range, an unknown
// mode turned off and the model and group names trimmed. Values loaded from
// the database bypass validation (manual edits, older nodes), so consumers
// read this copy.
func (s *ContentSafetySetting) Bounded() ContentSafetySetting {
	bounded := *s
	for _, option := range contentSafetyIntOptions {
		value := option.ptr(&bounded)
		*value = min(max(*value, option.min), option.max)
	}
	if !bounded.ReviewActive() {
		bounded.ReviewMode = ContentReviewModeOff
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
		if !ok || slices.Contains(RetiredContentSafetyOptionKeys, key) {
			continue
		}
		known := slices.ContainsFunc(contentSafetyIntOptions, func(o contentSafetyIntOption) bool { return o.field == field }) ||
			slices.Contains(contentSafetyBoolFields, field) || slices.Contains(contentSafetyStringFields, field)
		if !known {
			return fmt.Errorf("unknown content safety option: %s", key)
		}
	}
	for _, option := range contentSafetyIntOptions {
		value, err := strconv.Atoi(raw[ContentSafetyOptionPrefix+option.field])
		if err != nil || value < option.min || value > option.max {
			return fmt.Errorf("%s%s must be an integer from %d to %d", ContentSafetyOptionPrefix, option.field, option.min, option.max)
		}
	}
	for _, field := range contentSafetyBoolFields {
		if _, err := strconv.ParseBool(raw[ContentSafetyOptionPrefix+field]); err != nil {
			return fmt.Errorf("invalid boolean: %s%s", ContentSafetyOptionPrefix, field)
		}
	}
	switch mode := raw[ContentSafetyOptionPrefix+"review_mode"]; mode {
	case ContentReviewModeOff:
		return nil
	case ContentReviewModeShadow, ContentReviewModeEnforce:
	default:
		return fmt.Errorf("%sreview_mode must be off, shadow or enforce", ContentSafetyOptionPrefix)
	}
	for _, field := range []string{"review_model", "review_group"} {
		if strings.TrimSpace(raw[ContentSafetyOptionPrefix+field]) == "" {
			return fmt.Errorf("AI review requires %s%s", ContentSafetyOptionPrefix, field)
		}
	}
	return nil
}
