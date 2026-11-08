package relay

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
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
	cfg := operation_setting.GetContentSafetySetting().Bounded()
	var reviewWords []string
	if cfg.ReviewEnabled {
		reviewWords = cfg.ReviewWordList()
	}
	result := contentsafety.Scan(text, setting.SensitiveWords, reviewWords, cfg.WindowChars)
	if len(result.Blocked) > 0 {
		logger.LogWarn(c, "content safety blocked words: %s", strings.Join(contentsafety.Words(result.Blocked), ", "))
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

// EnforceContentSafety is the AI review tier. It runs once per request after
// pre-consume, so the caller's existing refund path returns the reservation
// when the review rejects the request or cannot conclude.
func EnforceContentSafety(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	if common.GetContextKeyBool(c, constant.ContextKeyContentSafetyChecked) {
		return nil
	}
	common.SetContextKey(c, constant.ContextKeyContentSafetyChecked, true)
	windows, _ := common.GetContextKeyType[[]contentsafety.Window](c, constant.ContextKeyContentSafetyWindows)
	if len(windows) == 0 {
		return nil
	}
	return reviewContentWindows(c, info, windows)
}

// EnforceContentSafetyText runs both tiers in one step for submissions that
// do not pass through PrepareRequestBilling (async tasks and Midjourney).
func EnforceContentSafetyText(c *gin.Context, info *relaycommon.RelayInfo, text string) *types.NewAPIError {
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
		// A safe verdict from a multi-window batch is not cached: text injected
		// into one window could sway the verdict of another, which would then be
		// reused for other requests on its own.
		if !verdict.IsSafe() || len(review.verdicts) == 1 {
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
	return nil
}

// callContentReviewer runs one review within the review timeout. The call
// keeps its concurrency slot until it truly returns, because the relay HTTP
// client is not bound to this context and keeps running after a timeout.
func callContentReviewer(c *gin.Context, cfg operation_setting.ContentSafetySetting, prompt string, windows []contentsafety.Window) contentReview {
	ctx, cancel := context.WithTimeout(c.Request.Context(), time.Duration(cfg.ReviewTimeoutSeconds)*time.Second)
	defer cancel()
	release, err := contentsafety.AcquireSlot(ctx, cfg.ReviewMaxConcurrency)
	if err != nil {
		return contentReview{failure: model.ContentSafetyFailureTimeout}
	}
	done := make(chan contentReview, 1)
	requestId, group, modelName := c.GetString(common.RequestIdKey), cfg.ReviewGroup, cfg.ReviewModel
	gopool.Go(func() {
		defer release()
		done <- runContentReview(requestId, group, modelName, prompt, windows)
	})
	select {
	case review := <-done:
		return review
	case <-ctx.Done():
		return contentReview{failure: model.ContentSafetyFailureTimeout}
	}
}

// runContentReview tries up to two channels that serve the review model.
func runContentReview(requestId, group, modelName, prompt string, windows []contentsafety.Window) contentReview {
	system, user, err := contentsafety.ReviewMessages(prompt, windows, rand.Text())
	if err != nil {
		return contentReview{failure: model.ContentSafetyFailureUpstreamError}
	}
	maxTokens := uint(min(2048, 128+64*len(windows)))
	review := contentReview{failure: model.ContentSafetyFailureNoChannel}
	for retry := range 2 {
		channel, err := model.GetRandomSatisfiedChannel(group, modelName, retry, nil)
		if err != nil || channel == nil {
			return review
		}
		reply, tokens, err := askContentReviewer(requestId, channel, modelName, system, user, maxTokens)
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
// It never touches the requesting user's billing.
func askContentReviewer(requestId string, channel *model.Channel, modelName, system, user string, maxTokens uint) (string, int, error) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(common.RequestIdKey, requestId)
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
	resp, err := adaptor.DoRequest(c, info, bytes.NewReader(body))
	if err != nil {
		return "", 0, err
	}
	httpResp, ok := resp.(*http.Response)
	if !ok || httpResp == nil {
		return "", 0, errors.New("review channel returned no response")
	}
	if httpResp.StatusCode != http.StatusOK {
		return "", 0, service.RelayErrorHandler(c.Request.Context(), httpResp, false)
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

// rejectContent builds the client error for a content safety decision and
// records it as a local request policy rejection.
func rejectContent(c *gin.Context, code types.ErrorCode, status int, messageKey string) *types.NewAPIError {
	service.RequestPolicy(c).AddEvent(service.PolicyEvent{ErrorCode: string(code), ErrorSource: "local", Decision: service.PolicyDecision{Action: "stop", Reason: "local_rejection", Source: "global"}, Health: "unchanged"})
	return types.NewErrorWithStatusCode(errors.New(i18n.T(c, messageKey)), code, status, types.ErrOptionWithSkipRetry())
}

// recordContentSafetyLog stores one decision with short excerpts around the
// hits, without delaying the request.
func recordContentSafetyLog(c *gin.Context, info *relaycommon.RelayInfo, entry model.ContentSafetyLog, windows []contentsafety.Window) {
	windows = windows[:min(len(windows), maxLoggedWindows)]
	snippets := make([]string, len(windows))
	for i, window := range windows {
		snippets[i] = window.Snippet(contentsafety.SnippetRadius)
	}
	hitWords, err := common.Marshal(contentsafety.Words(windows))
	if err != nil {
		logger.LogError(c, common.LogText("content safety log encode failed: %s", err.Error()))
		return
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

// taskRequestText is the prompt-bearing text of a task submission: every
// string value of a JSON body, or every value of a multipart form.
func taskRequestText(c *gin.Context) (string, error) {
	contentType := c.Request.Header.Get("Content-Type")
	if saved, ok := c.Get("_original_multipart_ct"); ok {
		contentType, _ = saved.(string)
	}
	if strings.HasPrefix(contentType, "multipart/form-data") {
		form, err := common.ParseMultipartFormReusable(c)
		if err != nil {
			return "", err
		}
		defer form.RemoveAll()
		var builder strings.Builder
		for _, values := range form.Value {
			for _, value := range values {
				builder.WriteString(value)
				builder.WriteByte('\n')
			}
		}
		return builder.String(), nil
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return "", err
	}
	body, err := storage.Bytes()
	if err != nil {
		return "", err
	}
	return contentsafety.CollectJSONText(body), nil
}
