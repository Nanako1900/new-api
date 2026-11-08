package relay

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"time"

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
)

// maxLoggedWindows caps the excerpts stored for one decision.
const maxLoggedWindows = 20

// contentReview is the reviewer's answer for one batch of windows. A
// non-empty failure is the content_safety_logs failure reason.
type contentReview struct {
	verdicts  []contentsafety.Verdict
	channelId int
	tokens    int
	failure   string
}

// scanRequestContent is the keyword tier. A block word rejects the request
// before pre-consume; review windows wait in the context until
// EnforceContentSafety runs after pre-consume.
func scanRequestContent(c *gin.Context, info *relaycommon.RelayInfo, text string) *types.NewAPIError {
	if info != nil {
		text = requestScanText(info.Request, text)
	}
	cfg := operation_setting.GetContentSafetySetting().Bounded()
	var reviewWords []string
	if cfg.ReviewEnabled {
		reviewWords = cfg.ReviewWordList()
	}
	result := contentsafety.Scan(text, setting.SensitiveWords, reviewWords, cfg.WindowChars)
	if len(result.Blocked) > 0 {
		logger.LogWarn(c, common.LogText("content safety blocked words: %s", strings.Join(contentsafety.Words(result.Blocked), ", ")))
		recordContentSafetyLog(c, info, model.ContentSafetyLog{Decision: model.ContentSafetyDecisionKeywordBlocked}, result.Blocked)
		return rejectContent(c, types.ErrorCodeSensitiveWordsDetected, http.StatusBadRequest, i18n.MsgContentSafetyBlocked)
	}
	if len(result.Review) > cfg.MaxWindows {
		recordContentSafetyLog(c, info, model.ContentSafetyLog{Decision: model.ContentSafetyDecisionReviewFailed, FailureReason: model.ContentSafetyFailureTooManyWindows}, result.Review)
		return rejectContent(c, types.ErrorCodeContentReviewUnavailable, http.StatusServiceUnavailable, i18n.MsgContentSafetyUnavailable)
	}
	if len(result.Review) > 0 {
		common.SetContextKey(c, constant.ContextKeyContentSafetyWindows, result.Review)
	}
	return nil
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
		parts = append(parts, contentsafety.CollectJSONText(r.Functions))
		if r.ResponseFormat != nil {
			parts = append(parts, contentsafety.CollectJSONText(r.ResponseFormat.JsonSchema))
		}
	case *dto.OpenAIResponsesRequest:
		// Token counting reads these members raw (instructions unless a plain
		// string), so the rest is counted again on a copy without them.
		counted := *r
		counted.Instructions, counted.Metadata, counted.Text, counted.ToolChoice, counted.Prompt, counted.Tools = nil, nil, nil, nil, nil, nil
		parts = []string{counted.GetTokenCountMeta().CombineText}
		for _, member := range [][]byte{r.Instructions, r.Metadata, r.Text, r.ToolChoice, r.Prompt, r.Tools} {
			parts = append(parts, contentsafety.CollectJSONText(member))
		}
	case *dto.OpenAIResponsesCompactionRequest:
		// Token counting reads instructions and input raw and skips the rest.
		parts = []string{contentsafety.CollectJSONText(r.Instructions), contentsafety.CollectJSONText(r.Input),
			contentsafety.CollectJSONText(r.Tools), contentsafety.CollectJSONText(r.Text)}
	case *dto.GeminiChatRequest:
		// Token counting reads tools raw.
		counted := *r
		counted.Tools = nil
		parts = []string{counted.GetTokenCountMeta().CombineText, contentsafety.CollectJSONText(r.Tools)}
	case *dto.ClaudeRequest:
		// Token counting skips document blocks; their title and context, and
		// the data of a text source, are plain text the model reads.
		for _, message := range r.Messages {
			blocks, _ := message.Content.([]any)
			for _, block := range blocks {
				document, _ := block.(map[string]any)
				if document["type"] != "document" {
					continue
				}
				title, _ := document["title"].(string)
				documentContext, _ := document["context"].(string)
				parts = append(parts, title, documentContext)
				if source, _ := document["source"].(map[string]any); source["type"] == "text" {
					data, _ := source["data"].(string)
					parts = append(parts, data)
				}
			}
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

// EnforceContentSafety is the AI review tier. It runs after pre-consume, so
// the caller's existing refund path returns the reservation when the review
// rejects the request or cannot conclude. Only a pass is remembered as
// checked; a rejection is returned again on every retry of the request.
func EnforceContentSafety(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	if rejection, ok := common.GetContextKeyType[*types.NewAPIError](c, constant.ContextKeyContentSafetyRejection); ok {
		return rejection
	}
	if common.GetContextKeyBool(c, constant.ContextKeyContentSafetyChecked) {
		return nil
	}
	windows, _ := common.GetContextKeyType[[]contentsafety.Window](c, constant.ContextKeyContentSafetyWindows)
	if len(windows) > 0 {
		if apiErr := reviewContentWindows(c, info, windows); apiErr != nil {
			return apiErr
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
	if !setting.ShouldCheckPromptSensitive() || common.GetContextKeyBool(c, constant.ContextKeyContentSafetyChecked) {
		return nil
	}
	if apiErr := scanRequestContent(c, info, text); apiErr != nil {
		return apiErr
	}
	return EnforceContentSafety(c, info)
}

// reviewContentWindows asks the review model about windows the cache has not
// decided. Any unsafe or inconclusive window rejects the request.
func reviewContentWindows(c *gin.Context, info *relaycommon.RelayInfo, windows []contentsafety.Window) *types.NewAPIError {
	cfg := operation_setting.GetContentSafetySetting().Bounded()
	prompt := contentsafety.EffectivePrompt(cfg.ReviewPrompt)
	started := time.Now()
	entry := model.ContentSafetyLog{ReviewModel: cfg.ReviewModel}
	pending := make([]contentsafety.Window, 0, len(windows))
	pendingKeys := make([]string, 0, len(windows))
	for _, window := range windows {
		key := contentsafety.CacheKey(cfg.ReviewModel, prompt, window.Text)
		cached, found := contentsafety.LoadVerdict(key, cfg.CacheTTLSeconds)
		if !found {
			pending, pendingKeys = append(pending, window), append(pendingKeys, key)
			continue
		}
		entry.CacheHit = true
		if !cached.Safe {
			entry.Decision, entry.AiCategory, entry.AiReason = model.ContentSafetyDecisionReviewRejected, cached.Category, cached.Reason
			recordContentSafetyLog(c, info, entry, []contentsafety.Window{window})
			return rejectContent(c, types.ErrorCodeContentReviewRejected, http.StatusBadRequest, i18n.MsgContentSafetyRejected)
		}
	}
	if len(pending) == 0 {
		return nil
	}
	batchKey := ""
	if len(pending) > 1 {
		batchKey = contentsafety.BatchCacheKey(cfg.ReviewModel, prompt, pendingKeys)
		if cached, found := contentsafety.LoadVerdict(batchKey, cfg.CacheTTLSeconds); found && cached.Safe {
			return nil
		}
	}
	review := contentReview{failure: model.ContentSafetyFailureRateLimited}
	if contentsafety.AllowReview(c.Request.Context(), info.UserId, cfg.ReviewRateLimitPerMinute) {
		review = callContentReviewer(c, cfg, prompt, pending)
	}
	entry.LatencyMs = int(time.Since(started).Milliseconds())
	entry.ReviewChannelId, entry.ReviewTokens = review.channelId, review.tokens
	if review.failure != "" {
		entry.Decision, entry.FailureReason = model.ContentSafetyDecisionReviewFailed, review.failure
		recordContentSafetyLog(c, info, entry, pending)
		return rejectContent(c, types.ErrorCodeContentReviewUnavailable, http.StatusServiceUnavailable, i18n.MsgContentSafetyUnavailable)
	}
	entry.Decision = model.ContentSafetyDecisionReviewPassed
	for i, verdict := range review.verdicts {
		// Only a single-window batch is cached per window. In a larger batch,
		// text injected into one window can sway the verdict of another either
		// way, and a cached verdict would then decide that window for everyone.
		// A larger batch is cached whole, and only when every window is safe,
		// so it lets nothing but the same set of windows pass unasked.
		if len(review.verdicts) == 1 {
			contentsafety.StoreVerdict(pendingKeys[i], contentsafety.CachedVerdict{Safe: verdict.IsSafe(), Category: verdict.Category, Reason: verdict.Reason}, cfg.CacheTTLSeconds)
		}
		if !verdict.IsSafe() && entry.Decision == model.ContentSafetyDecisionReviewPassed {
			entry.Decision, entry.AiCategory, entry.AiReason = model.ContentSafetyDecisionReviewRejected, verdict.Category, verdict.Reason
		}
	}
	recordContentSafetyLog(c, info, entry, pending)
	if entry.Decision == model.ContentSafetyDecisionReviewRejected {
		return rejectContent(c, types.ErrorCodeContentReviewRejected, http.StatusBadRequest, i18n.MsgContentSafetyRejected)
	}
	if batchKey != "" {
		contentsafety.StoreVerdict(batchKey, contentsafety.CachedVerdict{Safe: true}, cfg.CacheTTLSeconds)
	}
	return nil
}

// callContentReviewer runs one review within the review timeout. The upstream
// call is bound to the same context, so it ends with the timeout or with the
// client request; the concurrency slot is held until the call truly returns.
func callContentReviewer(c *gin.Context, cfg operation_setting.ContentSafetySetting, prompt string, windows []contentsafety.Window) contentReview {
	parent := c.Request.Context()
	ctx, cancel := context.WithTimeout(parent, time.Duration(cfg.ReviewTimeoutSeconds)*time.Second)
	defer cancel()
	release, err := contentsafety.AcquireSlot(ctx, cfg.ReviewMaxConcurrency)
	if err != nil {
		return contentReview{failure: interruptedReviewFailure(parent)}
	}
	done := make(chan contentReview, 1)
	requestId, group, modelName := c.GetString(common.RequestIdKey), cfg.ReviewGroup, cfg.ReviewModel
	gopool.Go(func() {
		defer release()
		done <- runContentReview(ctx, requestId, group, modelName, prompt, windows)
	})
	select {
	case review := <-done:
		// A call cut short by the context fails because of the context.
		if review.failure != "" && ctx.Err() != nil {
			review.failure = interruptedReviewFailure(parent)
		}
		return review
	case <-ctx.Done():
		return contentReview{failure: interruptedReviewFailure(parent)}
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

// runContentReview tries up to two channels that serve the review model, and
// stops as soon as ctx ends because nobody waits for the answer any more.
func runContentReview(ctx context.Context, requestId, group, modelName, prompt string, windows []contentsafety.Window) contentReview {
	system, user, err := contentsafety.ReviewMessages(prompt, windows, rand.Text())
	if err != nil {
		return contentReview{failure: model.ContentSafetyFailureUpstreamError}
	}
	// Reasoning models spend part of max_tokens on hidden reasoning before the
	// JSON reply, so the budget leaves room well beyond the reply itself.
	maxTokens := uint(min(4096, 512+64*len(windows)))
	review := contentReview{failure: model.ContentSafetyFailureNoChannel}
	for retry := range 2 {
		if ctx.Err() != nil {
			return review
		}
		channel, err := model.GetRandomSatisfiedChannel(group, modelName, retry, nil)
		if err != nil || channel == nil {
			return review
		}
		reply, tokens, err := askContentReviewer(ctx, requestId, channel, modelName, system, user, maxTokens)
		if err != nil {
			common.SysError(common.LogText("content safety review via channel %d failed (request_id=%s): %s", channel.Id, requestId, err.Error()))
			review = contentReview{channelId: channel.Id, failure: model.ContentSafetyFailureUpstreamError}
			continue
		}
		verdicts, err := contentsafety.ParseVerdicts(reply, len(windows))
		if err != nil {
			return contentReview{channelId: channel.Id, tokens: tokens, failure: model.ContentSafetyFailureUnparseable}
		}
		return contentReview{verdicts: verdicts, channelId: channel.Id, tokens: tokens}
	}
	return review
}

// askContentReviewer sends one non-stream chat completion to channel through
// its adaptor, the way a channel test does, and returns the assistant reply.
// The upstream request ends with ctx. It never touches the requesting user's
// billing.
func askContentReviewer(ctx context.Context, requestId string, channel *model.Channel, modelName, system, user string, maxTokens uint) (string, int, error) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequestWithContext(ctx, http.MethodPost, "/v1/chat/completions", nil)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(common.RequestIdKey, requestId)
	common.SetContextKey(c, constant.ContextKeyBindUpstreamToRequestContext, true)
	if apiErr := middleware.SetupContextForSelectedChannel(c, channel, modelName); apiErr != nil {
		return "", 0, apiErr
	}
	stream, temperature := false, 0.0
	request := &dto.GeneralOpenAIRequest{Model: modelName, Stream: &stream, Temperature: &temperature, MaxTokens: &maxTokens,
		Messages: []dto.Message{{Role: "system", Content: system}, {Role: "user", Content: user}}}
	info, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAI, request, nil)
	if err != nil {
		return "", 0, err
	}
	info.InitChannelMeta(c)
	if err := helper.ModelMappedHelper(c, info, request); err != nil {
		return "", 0, err
	}
	apiType, _ := common.ChannelType2APIType(channel.Type)
	adaptor := GetAdaptor(apiType)
	if adaptor == nil {
		return "", 0, fmt.Errorf("invalid api type: %d", apiType)
	}
	adaptor.Init(info)
	converted, err := adaptor.ConvertOpenAIRequest(c, info, request)
	if err != nil {
		return "", 0, err
	}
	body, err := common.Marshal(converted)
	if err != nil {
		return "", 0, err
	}
	if len(info.ParamOverride) > 0 {
		if body, err = relaycommon.ApplyParamOverrideWithRelayInfo(body, info); err != nil {
			return "", 0, err
		}
	}
	// Pass-through adaptors such as AWS read the body from the request.
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	resp, err := adaptor.DoRequest(c, info, bytes.NewReader(body))
	if err != nil {
		return "", 0, err
	}
	// Some adaptors (AWS) send the request inside DoResponse and return no
	// response here, as in the relay and channel test paths.
	var httpResp *http.Response
	if resp != nil {
		response, ok := resp.(*http.Response)
		if !ok {
			return "", 0, fmt.Errorf("review channel returned an unexpected response type %T", resp)
		}
		httpResp = response
	}
	if httpResp != nil && httpResp.StatusCode != http.StatusOK {
		return "", 0, service.RelayErrorHandler(c, httpResp, false)
	}
	usage, apiErr := adaptor.DoResponse(c, httpResp, info)
	if apiErr != nil {
		return "", 0, apiErr
	}
	var completion dto.OpenAITextResponse
	if err := common.Unmarshal(recorder.Body.Bytes(), &completion); err != nil {
		return "", 0, err
	}
	if len(completion.Choices) == 0 {
		return "", 0, errors.New("review reply has no choices")
	}
	tokens := 0
	if u, ok := usage.(*dto.Usage); ok && u != nil {
		tokens = u.TotalTokens
	}
	return completion.Choices[0].Message.StringContent(), tokens, nil
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

// recordContentSafetyLog stores one decision with short excerpts around the
// hits, without delaying the request.
func recordContentSafetyLog(c *gin.Context, info *relaycommon.RelayInfo, entry model.ContentSafetyLog, windows []contentsafety.Window) {
	hitWords, err := common.Marshal(contentsafety.Words(windows))
	if err != nil {
		logger.LogError(c, common.LogText("content safety log encode failed: %s", err.Error()))
		return
	}
	logged := windows[:min(len(windows), maxLoggedWindows)]
	snippets := make([]string, len(logged))
	for i, window := range logged {
		snippets[i] = window.Snippet(contentsafety.SnippetRadius)
	}
	encodedSnippets, err := common.Marshal(snippets)
	if err != nil {
		logger.LogError(c, common.LogText("content safety log encode failed: %s", err.Error()))
		return
	}
	entry.HitWords, entry.Snippets = string(hitWords), string(encodedSnippets)
	entry.RequestId = c.GetString(common.RequestIdKey)
	entry.Username = c.GetString(string(constant.ContextKeyUserName))
	entry.TokenName = c.GetString("token_name")
	entry.RequestPath = c.Request.URL.Path
	if info != nil {
		entry.UserId, entry.TokenId, entry.UsingGroup, entry.Model = info.UserId, info.TokenId, info.UsingGroup, info.OriginModelName
	}
	gopool.Go(func() { model.RecordContentSafetyLog(entry) })
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
