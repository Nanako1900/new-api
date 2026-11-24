package relay

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	mathrand "math/rand/v2"
	"mime"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/contentsafety"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"golang.org/x/sync/errgroup"
)

// maxLoggedSnippets caps the excerpts stored for one decision.
const maxLoggedSnippets = 20

// contentReviewPlan is what the scan before pre-consume leaves for
// EnforceContentSafety: the units the reviewer has not judged yet, newest
// first and at most max_units of them, the non-safe units the verdict cache
// already decided, how many units go unread, when the review runs, and the
// review configuration the cache keys were made with, which a background
// review keeps using however the settings change meanwhile.
type contentReviewPlan struct {
	pending   []contentsafety.Unit
	flagged   []cachedUnit
	truncated int
	// skipped are the keys of the new units past max_units, left unreviewed.
	skipped []string
	mode    string
	prompt  string
	cfg     operation_setting.ContentSafetySetting
}

type cachedUnit struct {
	unit    contentsafety.Unit
	verdict contentsafety.CachedVerdict
}

// unitReview is the reviewer's answer for one unit. A non-empty failure is
// the content_safety_logs failure reason of a review that did not conclude.
// A refusal by the review channel concludes as controversial. escalatedModel
// is set when the escalation model gave the verdict.
type unitReview struct {
	unit      contentsafety.Unit
	verdict   contentsafety.Verdict
	refused   bool
	channelId int
	tokens    int
	latencyMs int
	failure   string
	// detail says what went wrong when the review failed or the channel
	// refused it; it is stored as the log entry's failure detail.
	detail         string
	escalatedModel string
}

// reviewerAnswer is what a review channel answered: the reply text, how the
// completion ended and how much hidden reasoning came with it, which tell a
// reply cut off by max_tokens from one that broke the reply contract.
type reviewerAnswer struct {
	content        string
	finishReason   string
	reasoningRunes int
	tokens         int
}

// maxReplyExcerptRunes bounds the reply excerpt in the failure detail of a
// review whose reply did not parse.
const maxReplyExcerptRunes = 300

// refusedReason is the verdict reason of a unit the review channel refused.
// It is a key of the frontend locale files, which translate it when a log's
// reason is exactly this text.
const refusedReason = "The review channel refused to review this text"

// maxParallelUnitReviews bounds the units of one request reviewed at the same
// time, so one request cannot take every synchronous slot.
const maxParallelUnitReviews = 4

// scanRequestContent runs before pre-consume. A zero-tolerance word rejects
// the request; so does, for a request reviewed synchronously, a cached unsafe
// verdict or more new text than one review covers. What remains to review
// waits in the context until EnforceContentSafety runs after pre-consume.
func scanRequestContent(c *gin.Context, info *relaycommon.RelayInfo, combineText string) *types.NewAPIError {
	if contentsafety.BlockListActive() {
		text := combineText
		if info != nil {
			text = requestScanText(info.Request, combineText)
		}
		if blocked := contentsafety.Scan(text, setting.SensitiveWords); len(blocked) > 0 {
			words := contentsafety.Words(blocked)
			logger.LogWarn(c, common.LogText("content safety blocked words: %s", strings.Join(words, ", ")))
			snippets := make([]string, 0, min(len(blocked), maxLoggedSnippets))
			for _, window := range blocked[:min(len(blocked), maxLoggedSnippets)] {
				snippets = append(snippets, window.Snippet(contentsafety.SnippetRadius))
			}
			entry := contentSafetyLogEntry(c, info)
			entry.Decision, entry.Mode = model.ContentSafetyDecisionKeywordBlocked, model.ContentSafetyModeSync
			recordContentSafetyLog(entry, words, snippets)
			return rejectContent(c, types.ErrorCodeSensitiveWordsDetected, http.StatusBadRequest, i18n.MsgContentSafetyBlocked)
		}
	}
	cfg := operation_setting.GetContentSafetySetting().Bounded()
	if !cfg.ReviewActive() || info == nil {
		return nil
	}
	prompt := contentsafety.EffectivePrompt(cfg.ReviewPrompt)
	engine := reviewEngineKey(cfg)
	units, unread := contentsafety.BuildUnits(requestReviewMessages(info.Request, combineText, cfg.ReviewToolResults), cfg.UnitChars,
		func(text, context string) string { return contentsafety.CacheKey(engine, prompt, text, context) })
	if len(units) == 0 {
		return nil
	}
	keys := make([]string, len(units))
	for i, unit := range units {
		keys[i] = unit.Key
	}
	cached := contentsafety.LoadVerdicts(keys, cfg.CacheTTLSeconds)
	plan := &contentReviewPlan{truncated: unread, mode: model.ContentSafetyModeShadow, prompt: prompt, cfg: cfg}
	for _, unit := range units {
		verdict, found := cached[unit.Key]
		if !found {
			plan.pending = append(plan.pending, unit)
		} else if verdict.Level != contentsafety.LevelSafe {
			plan.flagged = append(plan.flagged, cachedUnit{unit: unit, verdict: verdict})
		}
	}
	if len(plan.pending) == 0 && len(plan.flagged) == 0 && plan.truncated == 0 {
		return nil
	}
	if cfg.ReviewMode == operation_setting.ContentReviewModeEnforce {
		plan.mode = model.ContentSafetyModeAsync
		if needsSyncReview(c, info, cfg) {
			plan.mode = model.ContentSafetyModeSync
		}
	}
	// A shadow review reads the sample of the new text. Enforced reviews read
	// all of it: text left out is never cached, so an account turning
	// synchronous would find its whole history new and over max_units.
	// Cached verdicts count whatever the sample.
	if plan.mode == model.ContentSafetyModeShadow && cfg.ReviewSamplePercent < 100 {
		plan.pending = slices.DeleteFunc(plan.pending, func(unit contentsafety.Unit) bool {
			return !contentsafety.SampledForReview(info.UserId, unit.Key, cfg.ReviewSamplePercent)
		})
		if len(plan.pending) == 0 && len(plan.flagged) == 0 && plan.truncated == 0 {
			return nil
		}
	}
	if len(plan.pending) > cfg.MaxUnits {
		plan.truncated += len(plan.pending) - cfg.MaxUnits
		for _, unit := range plan.pending[cfg.MaxUnits:] {
			plan.skipped = append(plan.skipped, unit.Key)
		}
		plan.pending = plan.pending[:cfg.MaxUnits]
	}
	if plan.mode == model.ContentSafetyModeSync {
		if apiErr := rejectCachedOrOversized(c, info, plan); apiErr != nil {
			return apiErr
		}
	}
	common.SetContextKey(c, constant.ContextKeyContentSafetyPlan, plan)
	return nil
}

// reviewEngineKey names the reviewer in verdict cache keys, so a verdict of
// one engine or model never decides for another. With escalation on it also
// names the escalation model, whose verdicts are cached under the same keys.
func reviewEngineKey(cfg operation_setting.ContentSafetySetting) string {
	key := cfg.ReviewEngine + "\x00" + cfg.ReviewModel
	if cfg.EscalateModel != "" {
		key += "\x00" + cfg.EscalateModel
	}
	return key
}

// needsSyncReview reports whether an enforced review holds the request until
// the reviewer answers: for every account with sync_all, for accounts in a
// listed group or younger than sync_new_user_days, for accounts at the watch
// risk level or above, and for accounts whose background reviews were
// recently dropped. Trusted accounts are always reviewed in the background.
// The group is the account's own; the group a token selects is the caller's
// choice.
func needsSyncReview(c *gin.Context, info *relaycommon.RelayInfo, cfg operation_setting.ContentSafetySetting) bool {
	state, ok := common.GetContextKeyType[contentsafety.RiskState](c, constant.ContextKeyContentRiskState)
	if !ok {
		var err error
		if state, err = contentsafety.LoadRiskState(info.UserId); err != nil {
			logger.LogError(c, common.LogText("content risk state read failed: %s", err.Error()))
			return true
		}
	}
	if state.Trusted {
		return false
	}
	if cfg.SyncAll || slices.Contains(cfg.SyncGroupList(), info.UserGroup) {
		return true
	}
	now := common.GetTimestamp()
	if cfg.SyncNewUserDays > 0 && state.UserCreatedAt > 0 && now-state.UserCreatedAt < int64(cfg.SyncNewUserDays)*86400 {
		return true
	}
	if state.Level(now, contentsafety.RiskThresholds(cfg)) != model.RiskLevelNormal {
		return true
	}
	return contentsafety.SyncForced(c.Request.Context(), info.UserId)
}

// rejectCachedOrOversized stops a synchronously reviewed request that the
// cache already judged unsafe, or that carries more new text than one review
// covers, before anything is reserved.
func rejectCachedOrOversized(c *gin.Context, info *relaycommon.RelayInfo, plan *contentReviewPlan) *types.NewAPIError {
	cfg := plan.cfg
	for _, hit := range plan.flagged {
		if hit.verdict.Level != contentsafety.LevelUnsafe {
			continue
		}
		entry := contentSafetyLogEntry(c, info)
		entry.Decision, entry.Mode, entry.CacheHit = model.ContentSafetyDecisionReviewRejected, model.ContentSafetyModeSync, true
		entry.ReviewModel, entry.AiCategory, entry.AiReason, entry.UnitCount = cfg.ReviewModel, hit.verdict.Category, hit.verdict.Reason, 1
		entry.EscalatedModel = hit.verdict.EscalatedModel
		recordScoredReview(entry, []string{hit.verdict.Category}, []string{unitSnippet(hit.unit)}, cfg, cachedRiskVerdicts(plan.flagged))
		return rejectContent(c, types.ErrorCodeContentReviewRejected, http.StatusBadRequest, i18n.MsgContentSafetyRejected)
	}
	if plan.truncated == 0 {
		return nil
	}
	entry := contentSafetyLogEntry(c, info)
	entry.Decision, entry.Mode, entry.FailureReason = model.ContentSafetyDecisionReviewFailed, model.ContentSafetyModeSync, model.ContentSafetyFailureTooManyUnits
	entry.ReviewModel, entry.UnitCount, entry.Truncated = cfg.ReviewModel, len(plan.pending)+plan.truncated, true
	entry.FailureDetail = fmt.Sprintf("%d new pieces are more than the %d a synchronous review reads", len(plan.pending)+plan.truncated, cfg.MaxUnits)
	recordContentSafetyLog(entry, nil, nil)
	return rejectContent(c, types.ErrorCodeContentReviewUnavailable, http.StatusServiceUnavailable, i18n.MsgContentSafetyUnavailable)
}

// requestScanText is the text of a request the keyword tier scans, given the
// CombineText its token count reads. Token counting, which also drives the
// billing estimate, skips some members the model reads and keeps others as
// raw request JSON, where an escape such as \u006f for "o" hides a word.
// Those members are scanned decoded, keys included, and each only once: a
// member counted raw is scanned decoded instead of raw, never both, because a
// hit in two windows makes a multi-window batch that is not cached per window.
func requestScanText(request dto.Request, combineText string) string {
	parts := []string{combineText}
	switch r := request.(type) {
	case *dto.GeneralOpenAIRequest:
		// Token counting reads custom tools, and the tools and tool calls of a
		// message, raw. A request with any is counted again on a copy without
		// them.
		counted, decoded := *r, []string(nil)
		counted.Tools = slices.DeleteFunc(slices.Clone(r.Tools), func(tool dto.ToolCallRequest) bool { return len(tool.Custom) > 0 })
		for _, tool := range r.Tools {
			decoded = append(decoded, contentsafety.CollectJSONText(tool.Custom))
		}
		counted.Messages = slices.Clone(r.Messages)
		for i, message := range r.Messages {
			counted.Messages[i].Tools, counted.Messages[i].ToolCalls = nil, nil
			decoded = append(decoded, contentsafety.CollectJSONText(message.Tools), contentsafety.CollectJSONText(message.ToolCalls))
		}
		if slices.ContainsFunc(decoded, func(text string) bool { return text != "" }) {
			parts = []string{counted.GetTokenCountMeta().CombineText}
		}
		parts = append(parts, decoded...)
		parts = append(parts, contentsafety.CollectJSONText(r.Functions), contentsafety.CollectJSONText(r.Prediction))
		if r.ResponseFormat != nil {
			parts = append(parts, contentsafety.CollectJSONText(r.ResponseFormat.JsonSchema))
		}
	case *dto.OpenAIResponsesRequest:
		// Token counting appends these members raw after the input, in this
		// order; instructions only when not a plain string, which it decodes.
		// Their raw text is cut from the end and scanned decoded instead. Were
		// that layout ever different, nothing is cut and the members are
		// scanned twice, which costs only the per-window cache.
		members := [][]byte{r.Instructions, r.Metadata, r.Text, r.ToolChoice, r.Prompt, r.Tools}
		if common.GetJsonType(r.Instructions) == "string" {
			members[0] = nil
		}
		var raw []string
		for _, member := range members {
			if len(member) > 0 {
				raw, parts = append(raw, string(member)), append(parts, contentsafety.CollectJSONText(member))
			}
		}
		parts[0] = strings.TrimSuffix(combineText, strings.Join(raw, "\n"))
	case *dto.OpenAIResponsesCompactionRequest:
		// Token counting reads instructions and input raw and skips the rest.
		parts = []string{contentsafety.CollectJSONText(r.Instructions), contentsafety.CollectJSONText(r.Input),
			contentsafety.CollectJSONText(r.Tools), contentsafety.CollectJSONText(r.Text)}
	case *dto.GeminiChatRequest:
		// Token counting reads tools and call arguments raw and skips code,
		// text sent as inline data, function response parts and response
		// schemas. The review reads all of them decoded, so the scan reads
		// the request the same way.
		parts = nil
		for _, message := range geminiReviewMessages(r, true) {
			parts = append(parts, message.Text)
		}
	case *dto.ClaudeRequest:
		// Token counting skips the legacy prompt, which a Claude channel still
		// forwards, documents and search results, and drops every block of a
		// list that does not parse into its typed blocks, as a list with a
		// search result does not. System and messages are read from their
		// decoded blocks instead; only tools come from a count without them.
		counted := *r
		counted.System, counted.Messages = nil, nil
		parts = []string{counted.GetTokenCountMeta().CombineText, r.Prompt}
		parts = append(parts, claudeContentText(r.System, true)...)
		for _, message := range r.Messages {
			parts = append(parts, claudeContentText(message.Content, true)...)
		}
	case *dto.AudioRequest:
		// Speech instructions are plain text, not JSON.
		parts = append(parts, r.Instructions)
	case *dto.AlphaSearchRequest, *dto.DeepSeekToolsRequest:
		// Token counting reads the whole request body raw.
		parts = []string{contentsafety.CollectJSONText([]byte(combineText))}
	}
	return strings.Join(slices.DeleteFunc(parts, func(part string) bool { return part == "" }), "\n")
}

// claudeContentText is the plain text a model reads from Claude content as
// decoded from request JSON: a string, or the text, tool use, tool result,
// document and search result blocks of a list, and the decoded strings of
// any other block, such as server and MCP tool calls and their results.
// Images and thinking are not read as text. Tool results, and blocks whose
// type ends in "_tool_result", are left out unless includeToolResults is set.
func claudeContentText(content any, includeToolResults bool) []string {
	if text, ok := content.(string); ok {
		return []string{text}
	}
	blocks, _ := content.([]any)
	var texts []string
	for _, block := range blocks {
		item, _ := block.(map[string]any)
		switch item["type"] {
		case "text":
			text, _ := item["text"].(string)
			texts = append(texts, text)
		case "tool_use":
			name, _ := item["name"].(string)
			texts = append(texts, name, contentsafety.CollectValueText(item["input"]))
		case "tool_result":
			if includeToolResults {
				texts = append(texts, claudeContentText(item["content"], true)...)
			}
		case "document":
			texts = append(texts, claudeDocumentText(item)...)
		case "search_result":
			title, _ := item["title"].(string)
			source, _ := item["source"].(string)
			texts = append(texts, title, source)
			texts = append(texts, claudeContentText(item["content"], includeToolResults)...)
		case "image", "thinking", "redacted_thinking":
		default:
			blockType, _ := item["type"].(string)
			if includeToolResults || !strings.HasSuffix(blockType, "_tool_result") {
				texts = append(texts, contentsafety.CollectValueText(block))
			}
		}
	}
	return texts
}

// claudeDocumentText is the plain text a model reads from a Claude document
// block: its title and context, and the text of a text or content source. A
// base64 or URL source is a file, not text.
func claudeDocumentText(document map[string]any) []string {
	title, _ := document["title"].(string)
	documentContext, _ := document["context"].(string)
	texts := []string{title, documentContext}
	source, _ := document["source"].(map[string]any)
	switch source["type"] {
	case "text":
		data, _ := source["data"].(string)
		texts = append(texts, data)
	case "content":
		texts = append(texts, claudeContentText(source["content"], true)...)
	}
	return texts
}

// EnforceContentSafety runs the AI review after pre-consume, so the caller's
// existing refund path returns the reservation when a synchronous review
// rejects the request or cannot conclude. A background review only queues
// the units and returns. Only a pass is remembered as checked; a rejection is
// returned again on every retry of the request.
func EnforceContentSafety(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	if rejection, ok := common.GetContextKeyType[*types.NewAPIError](c, constant.ContextKeyContentSafetyRejection); ok {
		return rejection
	}
	if common.GetContextKeyBool(c, constant.ContextKeyContentSafetyChecked) {
		return nil
	}
	if plan, ok := common.GetContextKeyType[*contentReviewPlan](c, constant.ContextKeyContentSafetyPlan); ok && plan != nil {
		recordFlaggedVerdicts(c, info, plan)
		if plan.mode == model.ContentSafetyModeSync && len(plan.pending) > 0 {
			if apiErr := reviewSynchronously(c, info, plan); apiErr != nil {
				return apiErr
			}
		} else if plan.mode != model.ContentSafetyModeSync && (len(plan.pending) > 0 || plan.truncated > 0) {
			queueContentReview(c, info, plan)
		}
	}
	common.SetContextKey(c, constant.ContextKeyContentSafetyChecked, true)
	return nil
}

// EnforceContentSafetyText runs both tiers in one step for submissions that
// do not pass through PrepareRequestBilling (async tasks and Midjourney).
func EnforceContentSafetyText(c *gin.Context, info *relaycommon.RelayInfo, text string) *types.NewAPIError {
	if rejection, ok := common.GetContextKeyType[*types.NewAPIError](c, constant.ContextKeyContentSafetyRejection); ok {
		return rejection
	}
	if !contentsafety.Active() || common.GetContextKeyBool(c, constant.ContextKeyContentSafetyChecked) {
		return nil
	}
	if apiErr := scanRequestContent(c, info, text); apiErr != nil {
		return apiErr
	}
	return EnforceContentSafety(c, info)
}

// reviewSynchronously asks the reviewer about the pending units, at most
// maxParallelUnitReviews at a time, within the review timeout and the
// synchronous slots. An unsafe verdict rejects the request, and so does any
// unit the reviewer could not judge.
func reviewSynchronously(c *gin.Context, info *relaycommon.RelayInfo, plan *contentReviewPlan) *types.NewAPIError {
	cfg := plan.cfg
	entry := contentSafetyLogEntry(c, info)
	entry.Mode, entry.ReviewModel, entry.UnitCount = model.ContentSafetyModeSync, cfg.ReviewModel, len(plan.pending)
	if !contentsafety.AllowReview(c.Request.Context(), info.UserId, cfg.ReviewRateLimitPerMinute, len(plan.pending)) {
		entry.Decision, entry.FailureReason = model.ContentSafetyDecisionReviewFailed, model.ContentSafetyFailureRateLimited
		entry.FailureDetail = fmt.Sprintf("the account is over %d synchronous review pieces per minute", cfg.ReviewRateLimitPerMinute)
		recordContentSafetyLog(entry, nil, nil)
		return rejectContent(c, types.ErrorCodeContentReviewUnavailable, http.StatusServiceUnavailable, i18n.MsgContentSafetyUnavailable)
	}
	parent := c.Request.Context()
	ctx, cancel := context.WithTimeout(parent, time.Duration(cfg.ReviewTimeoutSeconds)*time.Second)
	defer cancel()
	requestId := c.GetString(common.RequestIdKey)
	reviews := make([]unitReview, len(plan.pending))
	var group errgroup.Group
	group.SetLimit(maxParallelUnitReviews)
	for i, unit := range plan.pending {
		group.Go(func() error {
			reviews[i] = reviewWithSlot(ctx, parent, requestId, info.UserId, plan, unit)
			return nil
		})
	}
	_ = group.Wait()
	storeVerdicts(reviews, cfg.CacheTTLSeconds)
	entry, categories, snippets := summarizeReviews(entry, reviews)
	recordScoredReview(entry, categories, snippets, cfg, riskVerdicts(reviews))
	switch entry.Decision {
	case model.ContentSafetyDecisionReviewRejected:
		return rejectContent(c, types.ErrorCodeContentReviewRejected, http.StatusBadRequest, i18n.MsgContentSafetyRejected)
	case model.ContentSafetyDecisionReviewFailed:
		return rejectContent(c, types.ErrorCodeContentReviewUnavailable, http.StatusServiceUnavailable, i18n.MsgContentSafetyUnavailable)
	}
	return nil
}

// reviewWithSlot runs one synchronous review within ctx, holding a slot of
// the account and of the node. The upstream call is bound to ctx, so it ends
// with the timeout or with the client request; the slot is held until the
// call truly returns.
func reviewWithSlot(ctx, parent context.Context, requestId string, userId int, plan *contentReviewPlan, unit contentsafety.Unit) unitReview {
	timeout := plan.cfg.ReviewTimeoutSeconds
	release, err := contentsafety.AcquireSlot(ctx, userId, plan.cfg.ReviewMaxConcurrency)
	if err != nil {
		return unitReview{unit: unit, failure: interruptedReviewFailure(parent),
			detail: interruptedReviewDetail(parent, timeout, "waiting for a free synchronous review slot")}
	}
	done := make(chan unitReview, 1)
	gopool.Go(func() {
		defer release()
		done <- reviewUnit(ctx, requestId, plan.cfg, plan.prompt, unit)
	})
	select {
	case review := <-done:
		// A call cut short by the context fails because of the context.
		if review.failure != "" && ctx.Err() != nil {
			review.failure, review.detail = interruptedReviewFailure(parent), interruptedReviewDetail(parent, timeout, review.detail)
		}
		return review
	case <-ctx.Done():
		return unitReview{unit: unit, failure: interruptedReviewFailure(parent),
			detail: interruptedReviewDetail(parent, timeout, "the review channel had not answered")}
	}
}

// interruptedReviewFailure names why a review ended before it concluded:
// the client request went away, or the review timeout passed.
func interruptedReviewFailure(parent context.Context) string {
	if parent.Err() != nil {
		return model.ContentSafetyFailureClientCanceled
	}
	return model.ContentSafetyFailureTimeout
}

// interruptedReviewDetail is the failure detail of a review that ended before
// it concluded, with what was going on when it ended.
func interruptedReviewDetail(parent context.Context, timeoutSeconds int, last string) string {
	detail := fmt.Sprintf("no verdict within the %ds review timeout", timeoutSeconds)
	if parent.Err() != nil {
		detail = "the client request ended before the review concluded"
	}
	if last != "" {
		detail += "; " + last
	}
	return detail
}

// queueContentReview hands the pending units to the background reviewers.
// An account over its queue quota or its share of the queue, or a full
// queue, is recorded. So is a request with unread units and nothing new to
// queue among the units read. When reviews are enforced, any of these, or
// unread units, has the account's next requests reviewed synchronously, so
// neither flooding the queue nor padding every request with new filler
// keeps a message from being reviewed.
func queueContentReview(c *gin.Context, info *relaycommon.RelayInfo, plan *contentReviewPlan) {
	cfg := plan.cfg
	entry := contentSafetyLogEntry(c, info)
	entry.Mode, entry.ReviewModel = plan.mode, cfg.ReviewModel
	entry.UnitCount, entry.Truncated = len(plan.pending)+plan.truncated, plan.truncated > 0
	failure, detail := "", ""
	switch {
	case len(plan.pending) == 0:
		failure = model.ContentSafetyFailureTooManyUnits
		detail = fmt.Sprintf("%d new pieces beyond the review limits were left unreviewed", plan.truncated)
	case !contentsafety.AllowEnqueue(c.Request.Context(), info.UserId, cfg.AsyncRatePerMinute, len(plan.pending)):
		failure = model.ContentSafetyFailureRateLimited
		detail = fmt.Sprintf("the account is over %d background review pieces per minute", cfg.AsyncRatePerMinute)
	default:
		size := int64(0)
		for _, unit := range plan.pending {
			size += int64(len(unit.Text) + len(unit.Context))
		}
		err := contentsafety.EnqueueReview(info.UserId, size, func() { reviewInBackground(entry, plan) })
		if errors.Is(err, contentsafety.ErrAccountQueueFull) {
			failure = model.ContentSafetyFailureRateLimited
			detail = fmt.Sprintf("the account already has %d background reviews queued", contentsafety.MaxQueuedReviewsPerAccount)
		} else if err != nil {
			failure, detail = model.ContentSafetyFailureQueueFull, err.Error()
		}
	}
	if plan.mode == model.ContentSafetyModeAsync && (failure != "" || plan.truncated > 0) {
		contentsafety.ForceSync(info.UserId)
	}
	if failure == "" {
		return
	}
	entry.Decision, entry.FailureReason, entry.FailureDetail = model.ContentSafetyDecisionReviewFailed, failure, detail
	recordContentSafetyLog(entry, nil, nil)
}

// reviewInBackground reviews queued units one after another, each within the
// review timeout of the plan, and records the outcome.
func reviewInBackground(entry model.ContentSafetyLog, plan *contentReviewPlan) {
	cfg := plan.cfg
	reviews := make([]unitReview, 0, len(plan.pending))
	for _, unit := range plan.pending {
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(cfg.ReviewTimeoutSeconds)*time.Second)
		review := reviewUnit(ctx, entry.RequestId, cfg, plan.prompt, unit)
		if review.failure != "" && ctx.Err() != nil {
			review.failure = model.ContentSafetyFailureTimeout
			review.detail = interruptedReviewDetail(context.Background(), cfg.ReviewTimeoutSeconds, review.detail)
		}
		cancel()
		reviews = append(reviews, review)
	}
	storeVerdicts(reviews, cfg.CacheTTLSeconds)
	entry, categories, snippets := summarizeReviews(entry, reviews)
	verdicts := riskVerdicts(reviews)
	if len(plan.skipped) > 0 {
		verdicts = append(verdicts, unreviewedRiskVerdict(plan.skipped))
	}
	recordScoredReview(entry, categories, snippets, cfg, verdicts)
}

// reviewUnit reviews unit on the review channels and, when an escalation
// model is set, escalates a controversial or refused verdict within the same
// ctx. The latency covers every attempt, the escalation included.
func reviewUnit(ctx context.Context, requestId string, cfg operation_setting.ContentSafetySetting, prompt string, unit contentsafety.Unit) unitReview {
	started := time.Now()
	review := reviewUnitOnChannels(ctx, requestId, cfg, prompt, unit)
	if cfg.EscalateModel != "" && review.failure == "" && (review.refused || review.verdict.Level == contentsafety.LevelControversial) {
		review = escalateReview(ctx, requestId, cfg, prompt, review)
	}
	review.latencyMs = int(time.Since(started).Milliseconds())
	return review
}

// reviewUnitOnChannels asks cfg's review engine and model about unit on up
// to two channels that serve the model, and stops as soon as ctx ends
// because nobody waits for the answer any more. A channel refusing the text
// on content grounds (see contentsafety.IsReviewRefusal) concludes as
// controversial unless another channel judges the text; any other channel
// error is a failure.
func reviewUnitOnChannels(ctx context.Context, requestId string, cfg operation_setting.ContentSafetySetting, prompt string, unit contentsafety.Unit) unitReview {
	messages, maxTokens, err := reviewRequestMessages(cfg.ReviewEngine, prompt, unit)
	if err != nil {
		return unitReview{unit: unit, failure: model.ContentSafetyFailureUpstreamError, detail: "building the review request failed: " + err.Error()}
	}
	review := unitReview{unit: unit, failure: model.ContentSafetyFailureNoChannel}
	for retry := range 2 {
		if ctx.Err() != nil {
			if retry == 0 {
				review.failure, review.detail = model.ContentSafetyFailureTimeout, "the review time had run out before the call"
			}
			return review
		}
		channel, err := model.GetRandomSatisfiedChannel(cfg.ReviewGroup, cfg.ReviewModel, retry, nil)
		if err != nil || channel == nil {
			if retry == 0 {
				review.detail = fmt.Sprintf("no enabled channel in group %q serves model %q", cfg.ReviewGroup, cfg.ReviewModel)
				if err != nil {
					review.detail += ": " + err.Error()
				}
				logReviewAttempt(requestId, cfg, retry, model.ContentSafetyFailureNoChannel, review.detail, 0)
			}
			return review
		}
		started := time.Now()
		reply, err := askContentReviewer(ctx, requestId, channel, cfg.ReviewModel, messages, maxTokens)
		elapsed := time.Since(started)
		label := fmt.Sprintf("channel #%d %q", channel.Id, channel.Name)
		if err != nil {
			// The upstream address of the channel is masked, as in client errors.
			detail := label + ": " + common.MaskSensitiveInfo(err.Error(), channel.GetBaseURL())
			var apiErr *types.NewAPIError
			if errors.As(err, &apiErr) {
				detail = fmt.Sprintf("%s: %s: %s", label, apiErr.GetErrorCode(), apiErr.MaskSensitiveError(channel.GetBaseURL()))
				if apiErr.StatusCode > 0 {
					detail = fmt.Sprintf("%s: HTTP %d %s: %s", label, apiErr.StatusCode, apiErr.GetErrorCode(), apiErr.MaskSensitiveError(channel.GetBaseURL()))
				}
			}
			if apiErr != nil && contentsafety.IsReviewRefusal(apiErr) {
				logReviewAttempt(requestId, cfg, retry, model.ContentSafetyFailureRefused, detail, elapsed)
				review = unitReview{unit: unit, channelId: channel.Id, refused: true, detail: detail,
					verdict: contentsafety.Verdict{Level: contentsafety.LevelControversial, Category: "other", Reason: refusedReason}}
				continue
			}
			logReviewAttempt(requestId, cfg, retry, model.ContentSafetyFailureUpstreamError, detail, elapsed)
			if !review.refused {
				review = unitReview{unit: unit, channelId: channel.Id, failure: model.ContentSafetyFailureUpstreamError, detail: detail}
			}
			continue
		}
		verdict, err := parseReviewReply(cfg.ReviewEngine, reply.content)
		if err != nil {
			runes := []rune(reply.content)
			detail := fmt.Sprintf("%s: %v (finish_reason=%q, %d content chars, %d reasoning chars)",
				label, err, reply.finishReason, len(runes), reply.reasoningRunes)
			// The reply can quote the user's text, so its excerpt goes only to
			// the log entry, which log_retention_days bounds.
			logReviewAttempt(requestId, cfg, retry, model.ContentSafetyFailureUnparseable, detail, elapsed)
			return unitReview{unit: unit, channelId: channel.Id, tokens: reply.tokens, failure: model.ContentSafetyFailureUnparseable,
				detail: detail + "; reply: " + string(runes[:min(len(runes), maxReplyExcerptRunes)])}
		}
		if common.DebugEnabled {
			common.SysLog(common.LogText("content safety review via %s concluded %s %s (request_id=%s, model=%s, %dms, %d tokens, finish_reason=%s)",
				label, verdict.Level, verdict.Category, requestId, cfg.ReviewModel, elapsed.Milliseconds(), reply.tokens, reply.finishReason))
		}
		return unitReview{unit: unit, verdict: verdict, channelId: channel.Id, tokens: reply.tokens}
	}
	return review
}

// logReviewAttempt writes one review call that did not conclude to the server
// log: a refusal as information, anything else as an error.
func logReviewAttempt(requestId string, cfg operation_setting.ContentSafetySetting, attempt int, outcome, detail string, elapsed time.Duration) {
	line := common.LogText("content safety review %s (request_id=%s, engine=%s, model=%s, group=%s, attempt=%d, %dms): %q",
		outcome, requestId, cfg.ReviewEngine, cfg.ReviewModel, cfg.ReviewGroup, attempt+1, elapsed.Milliseconds(), detail)
	if outcome == model.ContentSafetyFailureRefused {
		common.SysLog(line)
		return
	}
	common.SysError(line)
}

// storeVerdicts caches every verdict the reviewer gave, and a refusal as the
// controversial verdict it concludes as: a refused text resent in a
// conversation's history is not asked about on every turn. Failed reviews
// are asked again next time.
func storeVerdicts(reviews []unitReview, ttlSeconds int) {
	for _, review := range reviews {
		if review.failure != "" {
			continue
		}
		contentsafety.StoreVerdict(review.unit.Key, contentsafety.CachedVerdict{Level: review.verdict.Level, Category: review.verdict.Category, Reason: review.verdict.Reason,
			EscalatedModel: review.escalatedModel}, ttlSeconds)
	}
}

// summarizeReviews folds unit reviews into one log entry. An unsafe unit
// decides the request: rejected when it was reviewed synchronously, flagged
// otherwise. Without one, a failed review decides, then a controversial unit,
// then a pass. It returns the categories and excerpts of the units behind the
// decision.
func summarizeReviews(entry model.ContentSafetyLog, reviews []unitReview) (model.ContentSafetyLog, []string, []string) {
	entry.UnitCount = max(entry.UnitCount, len(reviews))
	var unsafe, failed, controversial []unitReview
	for _, review := range reviews {
		entry.LatencyMs = max(entry.LatencyMs, review.latencyMs)
		entry.ReviewTokens += review.tokens
		if entry.ReviewChannelId == 0 {
			entry.ReviewChannelId = review.channelId
		}
		switch {
		case review.failure != "":
			failed = append(failed, review)
		case review.verdict.Level == contentsafety.LevelUnsafe:
			unsafe = append(unsafe, review)
		case review.verdict.Level == contentsafety.LevelControversial:
			controversial = append(controversial, review)
		}
	}
	decisive := controversial
	switch {
	case len(unsafe) > 0:
		decisive, entry.Decision = unsafe, model.ContentSafetyDecisionReviewFlagged
		if entry.Mode == model.ContentSafetyModeSync {
			entry.Decision = model.ContentSafetyDecisionReviewRejected
		}
	case len(failed) > 0:
		decisive, entry.Decision, entry.FailureReason = failed, model.ContentSafetyDecisionReviewFailed, failed[0].failure
	case len(controversial) > 0:
		entry.Decision = model.ContentSafetyDecisionReviewControversial
	default:
		entry.Decision = model.ContentSafetyDecisionReviewPassed
		entry.EscalatedModel = escalatedModelOf(reviews)
		return entry, nil, nil
	}
	entry.EscalatedModel = escalatedModelOf(decisive)
	for _, review := range decisive {
		if review.detail != "" {
			entry.FailureDetail = review.detail
			break
		}
	}
	var categories, snippets []string
	for _, review := range decisive[:min(len(decisive), maxLoggedSnippets)] {
		snippets = append(snippets, unitSnippet(review.unit))
		if review.verdict.Category != "" && !slices.Contains(categories, review.verdict.Category) {
			categories = append(categories, review.verdict.Category)
		}
		if review.refused && entry.FailureReason == "" {
			entry.FailureReason = model.ContentSafetyFailureRefused
		}
	}
	entry.AiCategory, entry.AiReason = decisive[0].verdict.Category, decisive[0].verdict.Reason
	return entry, categories, snippets
}

// unitSnippet is the stored excerpt of a unit: its start, within two
// snippet radii.
func unitSnippet(unit contentsafety.Unit) string {
	runes := []rune(unit.Text)
	return string(runes[:min(len(runes), 2*contentsafety.SnippetRadius)])
}

// recordReview writes a review decision through record. Passed reviews are
// sampled at percent, and a kept one stands for the ones left out.
func recordReview(entry model.ContentSafetyLog, categories, snippets []string, percent int, record func(model.ContentSafetyLog, []string, []string)) {
	if entry.Decision == model.ContentSafetyDecisionReviewPassed {
		if percent <= 0 || mathrand.IntN(100) >= percent {
			return
		}
		entry.Weight = sampledPassWeight(percent, mathrand.IntN(percent))
	}
	record(entry, categories, snippets)
}

// sampledPassWeight is how many passed reviews one kept at percent stands
// for: 100/percent, rounded down or up at random in proportion to the
// fraction, so summed weights are unbiased. roll is uniform in [0, percent).
func sampledPassWeight(percent, roll int) int {
	if roll < 100%percent {
		return 100/percent + 1
	}
	return 100 / percent
}

// askContentReviewer sends messages as one non-stream chat completion to
// channel through its adaptor, the way a channel test does, and returns the
// assistant reply. The upstream request ends with ctx. It never touches the
// requesting user's billing.
func askContentReviewer(ctx context.Context, requestId string, channel *model.Channel, modelName string, messages []dto.Message, maxTokens uint) (reviewerAnswer, error) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequestWithContext(ctx, http.MethodPost, "/v1/chat/completions", nil)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(common.RequestIdKey, requestId)
	common.SetContextKey(c, constant.ContextKeyBindUpstreamToRequestContext, true)
	if apiErr := middleware.SetupContextForInternalChannel(c, channel, modelName); apiErr != nil {
		return reviewerAnswer{}, apiErr
	}
	stream, temperature := false, 0.0
	request := &dto.GeneralOpenAIRequest{Model: modelName, Stream: &stream, Temperature: &temperature, MaxTokens: &maxTokens, Messages: messages}
	info, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAI, request, nil)
	if err != nil {
		return reviewerAnswer{}, err
	}
	info.InitChannelMeta(c)
	if err := helper.ModelMappedHelper(c, info, request); err != nil {
		return reviewerAnswer{}, err
	}
	apiType, _ := common.ChannelType2APIType(channel.Type)
	adaptor := GetAdaptor(apiType)
	if adaptor == nil {
		return reviewerAnswer{}, fmt.Errorf("invalid api type: %d", apiType)
	}
	adaptor.Init(info)
	converted, err := adaptor.ConvertOpenAIRequest(c, info, request)
	if err != nil {
		return reviewerAnswer{}, err
	}
	body, err := common.Marshal(converted)
	if err != nil {
		return reviewerAnswer{}, err
	}
	if len(info.ParamOverride) > 0 {
		if body, err = relaycommon.ApplyParamOverrideWithRelayInfo(body, info); err != nil {
			return reviewerAnswer{}, err
		}
	}
	// Pass-through adaptors such as AWS read the body from the request.
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	resp, err := adaptor.DoRequest(c, info, bytes.NewReader(body))
	if err != nil {
		return reviewerAnswer{}, err
	}
	// Some adaptors (AWS) send the request inside DoResponse and return no
	// response here, as in the relay and channel test paths.
	var httpResp *http.Response
	if resp != nil {
		response, ok := resp.(*http.Response)
		if !ok {
			return reviewerAnswer{}, fmt.Errorf("review channel returned an unexpected response type %T", resp)
		}
		httpResp = response
	}
	if httpResp != nil && httpResp.StatusCode != http.StatusOK {
		return reviewerAnswer{}, service.RelayErrorHandler(c, httpResp, false)
	}
	usage, apiErr := adaptor.DoResponse(c, httpResp, info)
	if apiErr != nil {
		return reviewerAnswer{}, apiErr
	}
	var completion dto.OpenAITextResponse
	if err := common.Unmarshal(recorder.Body.Bytes(), &completion); err != nil {
		return reviewerAnswer{}, err
	}
	if len(completion.Choices) == 0 {
		return reviewerAnswer{}, errors.New("review reply has no choices")
	}
	choice := completion.Choices[0]
	reply := reviewerAnswer{content: choice.Message.StringContent(), finishReason: choice.FinishReason}
	if choice.Message.ReasoningContent != nil {
		reply.reasoningRunes = utf8.RuneCountInString(*choice.Message.ReasoningContent)
	} else if choice.Message.Reasoning != nil {
		reply.reasoningRunes = utf8.RuneCountInString(*choice.Message.Reasoning)
	}
	if u, ok := usage.(*dto.Usage); ok && u != nil {
		reply.tokens = u.TotalTokens
	}
	return reply, nil
}

// rejectContent builds the client error for a content safety decision,
// records it as a local request policy rejection and keeps it in the context,
// so a retry of the request gets the same rejection.
func rejectContent(c *gin.Context, code types.ErrorCode, status int, messageKey string) *types.NewAPIError {
	service.RequestPolicy(c).AddEvent(service.PolicyEvent{ErrorCode: string(code), ErrorSource: "local", Decision: service.PolicyDecision{Action: "stop", Reason: "local_rejection", Source: "global"}, Health: "unchanged"})
	rejection := types.NewErrorWithStatusCode(errors.New(i18n.T(c, messageKey)), code, status, types.ErrOptionWithSkipRetry())
	common.SetContextKey(c, constant.ContextKeyContentSafetyRejection, rejection)
	return rejection
}

// contentSafetyLogEntry starts a log entry with who sent the request and
// where, read while the request context is still live.
func contentSafetyLogEntry(c *gin.Context, info *relaycommon.RelayInfo) model.ContentSafetyLog {
	entry := model.ContentSafetyLog{
		RequestId:   c.GetString(common.RequestIdKey),
		Username:    c.GetString(string(constant.ContextKeyUserName)),
		TokenName:   c.GetString("token_name"),
		RequestPath: c.Request.URL.Path,
	}
	if info != nil {
		entry.UserId, entry.TokenId, entry.UsingGroup, entry.Model = info.UserId, info.TokenId, info.UsingGroup, info.OriginModelName
	}
	return entry
}

// encodeLogLists stores the hit words or categories and the excerpts of an
// entry as JSON string arrays.
func encodeLogLists(entry model.ContentSafetyLog, words, snippets []string) (model.ContentSafetyLog, bool) {
	if words == nil {
		words = []string{}
	}
	if snippets == nil {
		snippets = []string{}
	}
	hitWords, err := common.Marshal(words)
	if err != nil {
		common.SysError(common.LogText("content safety log encode failed: %s", err.Error()))
		return entry, false
	}
	encodedSnippets, err := common.Marshal(snippets)
	if err != nil {
		common.SysError(common.LogText("content safety log encode failed: %s", err.Error()))
		return entry, false
	}
	entry.HitWords, entry.Snippets = string(hitWords), string(encodedSnippets)
	return entry, true
}

// recordContentSafetyLog stores one decision without delaying the request.
func recordContentSafetyLog(entry model.ContentSafetyLog, words, snippets []string) {
	encoded, ok := encodeLogLists(entry, words, snippets)
	if !ok {
		return
	}
	gopool.Go(func() { model.RecordContentSafetyLog(encoded) })
}

// taskRequestText is the prompt-bearing text of a task submission, read from
// the body the upstream receives the way the plugin request parser reads it:
// every string value of a JSON body, or every value of a multipart or
// urlencoded form, without inline media. A body declared as a form that does
// not decode is an error, so the caller fails closed.
func taskRequestText(c *gin.Context) (string, error) {
	contentType := c.Request.Header.Get("Content-Type")
	if saved, ok := c.Get("_original_multipart_ct"); ok {
		contentType, _ = saved.(string)
	}
	// The media type survives a malformed parameter, so a form with a broken
	// boundary still fails as a form below.
	mediaType, _, _ := mime.ParseMediaType(contentType)
	if mediaType == "multipart/form-data" {
		form, err := common.ParseMultipartFormReusable(c)
		if err != nil {
			return "", err
		}
		defer form.RemoveAll()
		return contentsafety.CollectFormText(form.Value), nil
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return "", err
	}
	body, err := storage.Bytes()
	if err != nil {
		return "", err
	}
	if mediaType == "application/x-www-form-urlencoded" {
		values, err := url.ParseQuery(string(body))
		if err != nil {
			return "", err
		}
		return contentsafety.CollectFormText(values), nil
	}
	return contentsafety.CollectJSONText(body), nil
}
