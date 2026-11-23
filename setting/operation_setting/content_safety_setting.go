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

// Content review engines. llm_json asks a general chat model with the review
// prompt and a JSON reply contract; qwen3guard sends the text alone to a
// Qwen3Guard-Gen model and reads its "Safety:" and "Categories:" reply lines.
const (
	ContentReviewEngineLLMJSON    = "llm_json"
	ContentReviewEngineQwen3Guard = "qwen3guard"
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
	// ReviewEngine reads ReviewModel's replies. EscalateModel, when set, is
	// asked again with llm_json through EscalateGroup about every unit the
	// first reviewer found controversial or refused, and its verdict wins.
	ReviewEngine  string `json:"review_engine"`
	EscalateModel string `json:"escalate_model"`
	EscalateGroup string `json:"escalate_group"`

	// Per-account risk score. Verdicts add points that halve every
	// RiskHalfLifeHours; the levels act only when ReviewMode is enforce.
	RiskHalfLifeHours           int    `json:"risk_half_life_hours"`
	RiskPointsUnsafe            int    `json:"risk_points_unsafe"`
	RiskPointsControversial     int    `json:"risk_points_controversial"`
	RiskZeroToleranceCategories string `json:"risk_zero_tolerance_categories"`
	RiskWatchThreshold          int    `json:"risk_watch_threshold"`
	RiskRestrictThreshold       int    `json:"risk_restrict_threshold"`
	RiskBlockThreshold          int    `json:"risk_block_threshold"`
	RiskRestrictRPM             int    `json:"risk_restrict_rpm"`
	RiskNotifyEnabled           bool   `json:"risk_notify_enabled"`
}

// ContentSafetyCategories are the policy areas a non-safe verdict names. They
// follow what gets an AI provider account banned; anything else is "other".
var ContentSafetyCategories = []string{"sexual_minors", "weapons", "terrorism", "self_harm", "cyber_attack", "fraud", "sexual", "other"}

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
	ReviewEngine:             ContentReviewEngineLLMJSON,

	RiskHalfLifeHours:           168,
	RiskPointsUnsafe:            40,
	RiskPointsControversial:     5,
	RiskZeroToleranceCategories: "sexual_minors",
	RiskWatchThreshold:          20,
	RiskRestrictThreshold:       50,
	RiskBlockThreshold:          100,
	RiskRestrictRPM:             10,
	RiskNotifyEnabled:           true,
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
	{"risk_half_life_hours", 1, 8760, func(s *ContentSafetySetting) *int { return &s.RiskHalfLifeHours }},
	{"risk_points_unsafe", 0, 1000, func(s *ContentSafetySetting) *int { return &s.RiskPointsUnsafe }},
	{"risk_points_controversial", 0, 1000, func(s *ContentSafetySetting) *int { return &s.RiskPointsControversial }},
	{"risk_watch_threshold", 1, 100000, func(s *ContentSafetySetting) *int { return &s.RiskWatchThreshold }},
	{"risk_restrict_threshold", 1, 100000, func(s *ContentSafetySetting) *int { return &s.RiskRestrictThreshold }},
	{"risk_block_threshold", 1, 100000, func(s *ContentSafetySetting) *int { return &s.RiskBlockThreshold }},
	{"risk_restrict_rpm", 1, 10000, func(s *ContentSafetySetting) *int { return &s.RiskRestrictRPM }},
}

var contentSafetyBoolFields = []string{"review_tool_results", "sync_all", "risk_notify_enabled"}

var contentSafetyStringFields = []string{"review_mode", "review_model", "review_group", "review_prompt", "sync_groups", "review_engine", "escalate_model", "escalate_group", "risk_zero_tolerance_categories"}

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

// RiskZeroToleranceList returns the non-empty trimmed lines of
// RiskZeroToleranceCategories.
func (s *ContentSafetySetting) RiskZeroToleranceList() []string {
	categories := make([]string, 0)
	for category := range strings.SplitSeq(s.RiskZeroToleranceCategories, "\n") {
		if category = strings.TrimSpace(category); category != "" {
			categories = append(categories, category)
		}
	}
	return categories
}

// Bounded returns a copy with every integer clamped to its range, an unknown
// mode turned off, an unknown engine read as llm_json and the model and group
// names trimmed. Values loaded from
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
	if bounded.ReviewEngine != ContentReviewEngineQwen3Guard {
		bounded.ReviewEngine = ContentReviewEngineLLMJSON
	}
	bounded.EscalateModel = strings.TrimSpace(bounded.EscalateModel)
	bounded.EscalateGroup = strings.TrimSpace(bounded.EscalateGroup)
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
	// The integers parsed above, so the thresholds compare as numbers.
	watch, _ := strconv.Atoi(raw[ContentSafetyOptionPrefix+"risk_watch_threshold"])
	restrict, _ := strconv.Atoi(raw[ContentSafetyOptionPrefix+"risk_restrict_threshold"])
	block, _ := strconv.Atoi(raw[ContentSafetyOptionPrefix+"risk_block_threshold"])
	if watch >= restrict || restrict >= block {
		return fmt.Errorf("%srisk_watch_threshold, risk_restrict_threshold and risk_block_threshold must increase", ContentSafetyOptionPrefix)
	}
	zeroTolerance := ContentSafetySetting{RiskZeroToleranceCategories: raw[ContentSafetyOptionPrefix+"risk_zero_tolerance_categories"]}
	for _, category := range zeroTolerance.RiskZeroToleranceList() {
		if !slices.Contains(ContentSafetyCategories, category) {
			return fmt.Errorf("%srisk_zero_tolerance_categories has an unknown category: %s", ContentSafetyOptionPrefix, category)
		}
	}
	switch raw[ContentSafetyOptionPrefix+"review_engine"] {
	case ContentReviewEngineLLMJSON, ContentReviewEngineQwen3Guard:
	default:
		return fmt.Errorf("%sreview_engine must be llm_json or qwen3guard", ContentSafetyOptionPrefix)
	}
	if strings.TrimSpace(raw[ContentSafetyOptionPrefix+"escalate_model"]) != "" && strings.TrimSpace(raw[ContentSafetyOptionPrefix+"escalate_group"]) == "" {
		return fmt.Errorf("escalation requires %sescalate_group", ContentSafetyOptionPrefix)
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
