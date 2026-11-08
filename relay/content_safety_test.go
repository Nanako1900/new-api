package relay

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	kitdto "github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/contentsafety"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	unsafeReason = "asks how to hurt a person"
	safeReply    = `{"results":[{"id":1,"safe":true}]}`
	unsafeReply  = `{"results":[{"id":1,"safe":false,"category":"violence","reason":"` + unsafeReason + `"}]}`
)

// The verdict cache and the per-user review rate limiter are process-global
// and cannot be reset, so every test takes fresh user ids and salted texts
// from this sequence; the tests then also pass when run again in the same
// process (-count=2).
var contentSafetyTestSeq atomic.Int64

func nextContentSafetyUser() int {
	return int(100000 + contentSafetyTestSeq.Add(1))
}

// saltedText wraps text in a unique digit tag at both ends, so every window
// cut from it is new to the verdict cache.
func saltedText(text string) string {
	salt := "#" + strconv.FormatInt(contentSafetyTestSeq.Add(1), 10)
	return salt + " " + text + " " + salt
}

// setupContentSafetyReview points the review model at a fake OpenAI upstream
// and enables both tiers: "bomb" blocks and "knife" needs review.
func setupContentSafetyReview(t *testing.T, reply http.HandlerFunc) *atomic.Int32 {
	t.Helper()
	require.NoError(t, i18n.Init())
	database := setupRelayChannelDB(t)
	require.NoError(t, database.AutoMigrate(&model.Ability{}, &model.ContentSafetyLog{}))
	previousLogDB := model.LOG_DB
	model.LOG_DB = database
	t.Cleanup(func() { model.LOG_DB = previousLogDB })
	service.InitHttpClient()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		reply(w, r)
	}))
	t.Cleanup(server.Close)
	channel := &model.Channel{Name: "reviewer", Type: constant.ChannelTypeOpenAI, Key: "reviewer-key", Status: common.ChannelStatusEnabled, Models: "judge-model", Group: "default", BaseURL: &server.URL}
	require.NoError(t, database.Create(channel).Error)
	require.NoError(t, channel.AddAbilities(database))
	// setupRelayChannelDB does not run model.InitDB, so the quoted group column
	// used by the database channel lookup is unset; the memory cache path reads
	// abilities without it.
	common.MemoryCacheEnabled = true
	model.InitChannelCache()
	t.Cleanup(func() {
		// Runs while the memory cache is still on, so the global channel cache
		// is rebuilt empty instead of keeping the reviewer channel.
		require.NoError(t, database.Where("channel_id = ?", channel.Id).Delete(&model.Ability{}).Error)
		require.NoError(t, database.Delete(channel).Error)
		model.InitChannelCache()
	})

	cfg := operation_setting.GetContentSafetySetting()
	previous := *cfg
	cfg.ReviewEnabled, cfg.ReviewModel, cfg.ReviewGroup, cfg.ReviewWords = true, "judge-model", "default", "knife"
	cfg.ReviewTimeoutSeconds, cfg.CacheTTLSeconds = 5, 60
	previousWords, previousEnabled, previousOnPrompt := setting.SensitiveWords, setting.CheckSensitiveEnabled, setting.CheckSensitiveOnPromptEnabled
	setting.SensitiveWords, setting.CheckSensitiveEnabled, setting.CheckSensitiveOnPromptEnabled = []string{"bomb"}, true, true
	t.Cleanup(func() {
		*cfg = previous
		setting.SensitiveWords, setting.CheckSensitiveEnabled, setting.CheckSensitiveOnPromptEnabled = previousWords, previousEnabled, previousOnPrompt
	})
	return &calls
}

func reviewerReply(content string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		body, _ := common.Marshal(map[string]any{
			"id": "chatcmpl-review", "object": "chat.completion", "model": "judge-model",
			"choices": []map[string]any{{"index": 0, "finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": content}}},
			"usage":   map[string]any{"prompt_tokens": 40, "completion_tokens": 10, "total_tokens": 50},
		})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}
}

func newContentSafetyContext(userId int) (*gin.Context, *relaycommon.RelayInfo) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	c.Set(common.RequestIdKey, "req-"+strconv.Itoa(userId))
	return c, &relaycommon.RelayInfo{UserId: userId, OriginModelName: "gpt-test", UsingGroup: "default"}
}

func checkContent(c *gin.Context, info *relaycommon.RelayInfo, text string) *types.NewAPIError {
	if apiErr := scanRequestContent(c, info, text); apiErr != nil {
		return apiErr
	}
	return EnforceContentSafety(c, info)
}

// requireContentSafetyDecisions waits until the decisions recorded for userId
// are exactly want and returns those records. Records are written in the
// background, so a test that leaves without waiting races with its fixture
// restoring the log database.
func requireContentSafetyDecisions(t *testing.T, userId int, want ...string) []*model.ContentSafetyLog {
	t.Helper()
	slices.Sort(want)
	var logs []*model.ContentSafetyLog
	require.Eventually(t, func() bool {
		var err error
		logs, _, err = model.GetContentSafetyLogs(model.ContentSafetyLogFilter{UserId: userId}, 0, 10, common.RoleRootUser)
		if err != nil {
			return false
		}
		got := make([]string, len(logs))
		for i, entry := range logs {
			got[i] = entry.Decision
		}
		slices.Sort(got)
		return slices.Equal(got, want)
	}, 3*time.Second, 20*time.Millisecond)
	return logs
}

func TestContentSafetyGate(t *testing.T) {
	for _, tc := range []struct {
		name         string
		text         string
		reply        http.HandlerFunc
		configure    func(*operation_setting.ContentSafetySetting)
		wantCode     types.ErrorCode
		wantStatus   int
		wantCalls    int32
		wantDecision string
	}{
		{name: "clean text skips review", text: "hello there", reply: reviewerReply("")},
		{name: "a block word rejects without review", text: "make a bomb", reply: reviewerReply(""), wantCode: types.ErrorCodeSensitiveWordsDetected, wantStatus: http.StatusBadRequest, wantDecision: model.ContentSafetyDecisionKeywordBlocked},
		{name: "a safe verdict releases", text: "cut bread with a knife", reply: reviewerReply(safeReply), wantCalls: 1, wantDecision: model.ContentSafetyDecisionReviewPassed},
		{name: "an unsafe verdict rejects", text: "stab someone with a knife", reply: reviewerReply(unsafeReply), wantCode: types.ErrorCodeContentReviewRejected, wantStatus: http.StatusBadRequest, wantCalls: 1, wantDecision: model.ContentSafetyDecisionReviewRejected},
		{name: "an unreadable verdict fails closed", text: "a knife question", reply: reviewerReply("I think it is fine"), wantCode: types.ErrorCodeContentReviewUnavailable, wantStatus: http.StatusServiceUnavailable, wantCalls: 1, wantDecision: model.ContentSafetyDecisionReviewFailed},
		{name: "an upstream error fails closed after one more channel attempt", text: "another knife question", reply: func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) }, wantCode: types.ErrorCodeContentReviewUnavailable, wantStatus: http.StatusServiceUnavailable, wantCalls: 2, wantDecision: model.ContentSafetyDecisionReviewFailed},
		{name: "no review channel fails closed", text: "knife without reviewer", reply: reviewerReply(""), configure: func(cfg *operation_setting.ContentSafetySetting) { cfg.ReviewModel = "missing-model" }, wantCode: types.ErrorCodeContentReviewUnavailable, wantStatus: http.StatusServiceUnavailable, wantDecision: model.ContentSafetyDecisionReviewFailed},
		{name: "too many windows fails closed", text: "knife" + strings.Repeat(".", 120) + "knife", reply: reviewerReply(""), configure: func(cfg *operation_setting.ContentSafetySetting) { cfg.WindowChars, cfg.MaxWindows = 50, 1 }, wantCode: types.ErrorCodeContentReviewUnavailable, wantStatus: http.StatusServiceUnavailable, wantDecision: model.ContentSafetyDecisionReviewFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := setupContentSafetyReview(t, tc.reply)
			if tc.configure != nil {
				tc.configure(operation_setting.GetContentSafetySetting())
			}
			c, info := newContentSafetyContext(nextContentSafetyUser())
			apiErr := checkContent(c, info, saltedText(tc.text))
			assert.Equal(t, tc.wantCalls, calls.Load())
			if tc.wantCode == "" {
				assert.Nil(t, apiErr)
			} else {
				require.NotNil(t, apiErr)
				assert.Equal(t, tc.wantCode, apiErr.GetErrorCode())
				assert.Equal(t, tc.wantStatus, apiErr.StatusCode)
				assert.NotContains(t, apiErr.Error(), "knife", "clients never see the matched words")
				assert.NotContains(t, apiErr.Error(), "bomb", "clients never see the matched words")
				assert.NotContains(t, apiErr.Error(), unsafeReason, "clients never see the reviewer's reason")
			}
			if tc.wantDecision == "" {
				requireContentSafetyDecisions(t, info.UserId)
				return
			}
			requireContentSafetyDecisions(t, info.UserId, tc.wantDecision)
		})
	}
}

// The keyword tier runs inside PrepareRequestBilling, before pricing and
// pre-consume. The model has a price, so a clean request reserves it while a
// blocked one reserves nothing, and the client learns the error code, not the
// matched word. Request JSON is scanned after decoding, so a JSON escape
// cannot hide a block word, and so are the members the model reads that token
// counting skips: tools, schemas, instructions and documents.
func TestPrepareRequestBillingScansContentBeforePreConsume(t *testing.T) {
	const escapedBomb = `make a b\u006fmb`
	userHello := []kitdto.Message{{Role: "user", Content: "hello"}}
	for _, tc := range []struct {
		name     string
		format   types.RelayFormat
		request  kitdto.Request
		blocked  bool
		wantHeld int
	}{
		{name: "a clean request is priced and reserved", format: types.RelayFormatOpenAI, request: &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: []kitdto.Message{{Role: "user", Content: saltedText("hello there")}}}, wantHeld: 5000},
		{name: "a block word", format: types.RelayFormatOpenAI, request: &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: []kitdto.Message{{Role: "user", Content: saltedText("make a Bomb")}}}, blocked: true},
		{name: "an escaped block word in a multi-line compaction input", format: types.RelayFormatOpenAIResponsesCompaction, request: &kitdto.OpenAIResponsesCompactionRequest{Model: "gpt-test", Instructions: common.RawMessage(`"be brief"`), Input: common.RawMessage("[\n  {\"role\": \"user\", \"content\": \"" + escapedBomb + "\"},\n  {\"role\": \"user\", \"content\": \"hi\"}\n]")}, blocked: true},
		{name: "an escaped block word in an alpha search body", format: types.RelayFormatOpenAIAlphaSearch, request: &kitdto.AlphaSearchRequest{Model: "gpt-test", RawBody: common.RawMessage(`{"model":"gpt-test","query":"` + escapedBomb + `"}`)}, blocked: true},
		{name: "an escaped block word in a DeepSeek tools body", format: types.RelayFormatDeepSeekTools, request: &kitdto.DeepSeekToolsRequest{Model: "gpt-test", RawBody: common.RawMessage(`{"query":"` + escapedBomb + `"}`)}, blocked: true},
		{name: "a block word as an object key", format: types.RelayFormatDeepSeekTools, request: &kitdto.DeepSeekToolsRequest{Model: "gpt-test", RawBody: common.RawMessage(`{"query":"hello","filters":{"bomb":true}}`)}, blocked: true},
		{name: "an escaped block word as an object key", format: types.RelayFormatDeepSeekTools, request: &kitdto.DeepSeekToolsRequest{Model: "gpt-test", RawBody: common.RawMessage(`{"query":"hello","filters":{"b\u006fmb":true}}`)}, blocked: true},
		{name: "an escaped block word in Responses tools", format: types.RelayFormatOpenAIResponses, request: &kitdto.OpenAIResponsesRequest{Model: "gpt-test", Input: common.RawMessage(`"hello"`), Tools: common.RawMessage(`[{"type":"function","name":"lookup","description":"` + escapedBomb + `"}]`)}, blocked: true},
		{name: "an escaped block word in Responses instructions given as an array", format: types.RelayFormatOpenAIResponses, request: &kitdto.OpenAIResponsesRequest{Model: "gpt-test", Input: common.RawMessage(`"hello"`), Instructions: common.RawMessage(`[{"role":"developer","content":"` + escapedBomb + `"}]`)}, blocked: true},
		{name: "an escaped block word in a Responses text format", format: types.RelayFormatOpenAIResponses, request: &kitdto.OpenAIResponsesRequest{Model: "gpt-test", Input: common.RawMessage(`"hello"`), Text: common.RawMessage(`{"format":{"type":"json_schema","name":"answer","schema":{"type":"object","description":"` + escapedBomb + `"}}}`)}, blocked: true},
		{name: "an escaped block word in Responses prompt variables", format: types.RelayFormatOpenAIResponses, request: &kitdto.OpenAIResponsesRequest{Model: "gpt-test", Input: common.RawMessage(`"hello"`), Prompt: common.RawMessage(`{"id":"pmpt_1","variables":{"topic":"` + escapedBomb + `"}}`)}, blocked: true},
		{name: "an escaped block word in Gemini tools", format: types.RelayFormatGemini, request: &kitdto.GeminiChatRequest{Contents: []kitdto.GeminiChatContent{{Role: "user", Parts: []kitdto.GeminiPart{{Text: "hello"}}}}, Tools: common.RawMessage(`[{"functionDeclarations":[{"name":"lookup","description":"` + escapedBomb + `"}]}]`)}, blocked: true},
		{name: "a block word in compaction tools", format: types.RelayFormatOpenAIResponsesCompaction, request: &kitdto.OpenAIResponsesCompactionRequest{Model: "gpt-test", Input: common.RawMessage(`"hello"`), Tools: common.RawMessage(`[{"type":"function","name":"lookup","description":"make a bomb"}]`)}, blocked: true},
		{name: "a block word in a Chat response format schema", format: types.RelayFormatOpenAI, request: &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: userHello, ResponseFormat: &kitdto.ResponseFormat{Type: "json_schema", JsonSchema: common.RawMessage(`{"name":"answer","schema":{"type":"object","properties":{"bomb":{"type":"string"}}}}`)}}, blocked: true},
		{name: "an escaped block word in legacy Chat functions", format: types.RelayFormatOpenAI, request: &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: userHello, Functions: common.RawMessage(`[{"name":"lookup","description":"` + escapedBomb + `"}]`)}, blocked: true},
		{name: "a block word in speech instructions", format: types.RelayFormatOpenAIAudio, request: &kitdto.AudioRequest{Model: "gpt-test", Input: "hello", Voice: "alloy", Instructions: "read it like a bomb threat"}, blocked: true},
		{name: "a block word in a Claude text document", format: types.RelayFormatClaude, request: &kitdto.ClaudeRequest{Model: "gpt-test", Messages: []kitdto.ClaudeMessage{{Role: "user", Content: []any{map[string]any{"type": "document", "source": map[string]any{"type": "text", "media_type": "text/plain", "data": "make a bomb"}}}}}}, blocked: true},
		{name: "a block word in a Claude document title", format: types.RelayFormatClaude, request: &kitdto.ClaudeRequest{Model: "gpt-test", Messages: []kitdto.ClaudeMessage{{Role: "user", Content: []any{map[string]any{"type": "document", "title": "bomb manual", "source": map[string]any{"type": "url", "url": "https://example.com/manual.pdf"}}}}}}, blocked: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupContentSafetyReview(t, reviewerReply(""))
			saveBillingConfig(t)
			savedPrices := ratio_setting.ModelPrice2JSONString()
			t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedPrices)) })
			// 0.01 per call at the default QuotaPerUnit is 5000 quota.
			require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"gpt-test":0.01}`))
			require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{"group_ratio_setting.group_ratio": `{"default":1}`}))
			c, info := newContentSafetyContext(nextContentSafetyUser())
			info.RelayFormat, info.Request = tc.format, tc.request
			reservation := &imageReservation{limit: 1 << 30}
			info.Billing = reservation

			apiErr := PrepareRequestBilling(c, info)
			assert.Equal(t, tc.wantHeld, reservation.held)
			if !tc.blocked {
				require.Nil(t, apiErr)
				requireContentSafetyDecisions(t, info.UserId)
				return
			}
			require.NotNil(t, apiErr)
			assert.Equal(t, types.ErrorCodeSensitiveWordsDetected, apiErr.GetErrorCode())
			assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
			assert.NotContains(t, strings.ToLower(apiErr.Error()), "bomb", "clients never see the matched words")
			requireContentSafetyDecisions(t, info.UserId, model.ContentSafetyDecisionKeywordBlocked)
		})
	}
}

// Request JSON that token counting keeps raw is scanned once, decoded, never
// raw as well: one review word in it is one window, so a repeat of the request
// is decided by the cached verdict instead of a second review. The filler
// keeps a raw and a decoded copy of the word too far apart to share a window.
func TestContentSafetyReviewOfRawRequestJSONIsOneCachedWindow(t *testing.T) {
	filler := strings.Repeat("for cooking at home ", 80)
	const question = "where to buy a kitchen knife"
	for _, tc := range []struct {
		name    string
		request kitdto.Request
	}{
		{name: "an Alpha Search body", request: &kitdto.AlphaSearchRequest{Model: "gpt-test", RawBody: common.RawMessage(`{"model":"gpt-test","query":"` + filler + saltedText(question) + filler + `"}`)}},
		{name: "Responses tools", request: &kitdto.OpenAIResponsesRequest{Model: "gpt-test", Input: common.RawMessage(`"hello"`), Tools: common.RawMessage(`[{"type":"function","name":"lookup","description":"` + filler + saltedText(question) + filler + `"}]`)}},
		{name: "Gemini tools", request: &kitdto.GeminiChatRequest{Contents: []kitdto.GeminiChatContent{{Role: "user", Parts: []kitdto.GeminiPart{{Text: "hello"}}}}, Tools: common.RawMessage(`[{"functionDeclarations":[{"name":"lookup","description":"` + filler + saltedText(question) + filler + `"}]}]`)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := setupContentSafetyReview(t, reviewerReply(safeReply))
			userId := nextContentSafetyUser()
			for range 2 {
				c, info := newContentSafetyContext(userId)
				info.Request = tc.request
				require.Nil(t, scanRequestContent(c, info, tc.request.GetTokenCountMeta().CombineText))
				windows, _ := common.GetContextKeyType[[]contentsafety.Window](c, constant.ContextKeyContentSafetyWindows)
				assert.Len(t, windows, 1)
				require.Nil(t, EnforceContentSafety(c, info))
			}
			assert.Equal(t, int32(1), calls.Load(), "the repeat is served from the verdict cache")
			requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewPassed)
		})
	}
}

func TestContentSafetyReviewCachesVerdictPerWindow(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(safeReply))
	userId, text := nextContentSafetyUser(), saltedText("sharpen the kitchen knife carefully")
	for range 2 {
		c, info := newContentSafetyContext(userId)
		require.Nil(t, checkContent(c, info, text))
	}
	assert.Equal(t, int32(1), calls.Load(), "the second identical window is answered from the cache")
	requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewPassed)
}

func TestContentSafetyReviewDoesNotCacheMultiWindowVerdicts(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(`{"results":[{"id":1,"safe":true},{"id":2,"safe":false,"category":"violence","reason":"`+unsafeReason+`"}]}`))
	operation_setting.GetContentSafetySetting().WindowChars = 50
	userId, text := nextContentSafetyUser(), saltedText("knife"+strings.Repeat(".", 120)+"knife")
	for range 2 {
		c, info := newContentSafetyContext(userId)
		apiErr := checkContent(c, info, text)
		require.NotNil(t, apiErr)
		assert.Equal(t, types.ErrorCodeContentReviewRejected, apiErr.GetErrorCode())
	}
	assert.Equal(t, int32(2), calls.Load(), "neither verdict of a two-window batch answers a later request")
	requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewRejected, model.ContentSafetyDecisionReviewRejected)
}

func TestContentSafetyReviewRejectsACachedUnsafeWindowWithoutAsking(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(unsafeReply))
	userId, text := nextContentSafetyUser(), saltedText("stab someone with a knife")
	for range 2 {
		c, info := newContentSafetyContext(userId)
		apiErr := checkContent(c, info, text)
		require.NotNil(t, apiErr)
		assert.Equal(t, types.ErrorCodeContentReviewRejected, apiErr.GetErrorCode())
		assert.NotContains(t, apiErr.Error(), unsafeReason)
	}
	assert.Equal(t, int32(1), calls.Load(), "the cached unsafe verdict answers the second request")
	logs := requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewRejected, model.ContentSafetyDecisionReviewRejected)
	hits := slices.DeleteFunc(logs, func(entry *model.ContentSafetyLog) bool { return !entry.CacheHit })
	require.Len(t, hits, 1, "only the cache-answered rejection is recorded as a cache hit")
	assert.Equal(t, "violence", hits[0].AiCategory)
	assert.Equal(t, unsafeReason, hits[0].AiReason)
	assert.JSONEq(t, `["knife"]`, hits[0].HitWords)
	snippets, err := common.Marshal([]string{text})
	require.NoError(t, err)
	assert.JSONEq(t, string(snippets), hits[0].Snippets)
}

func TestContentSafetyReviewRateLimitFailsClosed(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(safeReply))
	operation_setting.GetContentSafetySetting().ReviewRateLimitPerMinute = 1
	userId := nextContentSafetyUser()
	c, info := newContentSafetyContext(userId)
	require.Nil(t, checkContent(c, info, saltedText("first knife text")))
	c, info = newContentSafetyContext(userId)
	apiErr := checkContent(c, info, saltedText("second knife text"))
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodeContentReviewUnavailable, apiErr.GetErrorCode())
	assert.Equal(t, int32(1), calls.Load())
	requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewPassed, model.ContentSafetyDecisionReviewFailed)
}

func TestContentSafetyReviewTimeoutCancelsTheUpstreamAndFreesTheSlot(t *testing.T) {
	var healthy atomic.Bool
	canceled, release := make(chan struct{}, 1), make(chan struct{})
	calls := setupContentSafetyReview(t, func(w http.ResponseWriter, r *http.Request) {
		if healthy.Load() {
			reviewerReply(safeReply)(w, r)
			return
		}
		// The server notices a closed client connection only after the body
		// has been read, as a real upstream would.
		_, _ = io.Copy(io.Discard, r.Body)
		select {
		case <-r.Context().Done():
			canceled <- struct{}{}
		case <-release:
		}
	})
	t.Cleanup(func() { close(release) })
	cfg := operation_setting.GetContentSafetySetting()
	cfg.ReviewTimeoutSeconds, cfg.ReviewMaxConcurrency = 1, 1

	c, info := newContentSafetyContext(nextContentSafetyUser())
	apiErr := checkContent(c, info, saltedText("slow knife review"))
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodeContentReviewUnavailable, apiErr.GetErrorCode())
	select {
	case <-canceled:
	case <-time.After(5 * time.Second):
		require.FailNow(t, "the timed-out review left its upstream request running")
	}
	logs := requireContentSafetyDecisions(t, info.UserId, model.ContentSafetyDecisionReviewFailed)
	assert.Equal(t, model.ContentSafetyFailureTimeout, logs[0].FailureReason)

	healthy.Store(true)
	c, info = newContentSafetyContext(nextContentSafetyUser())
	require.Nil(t, checkContent(c, info, saltedText("quick knife review")), "the timed-out review gave its only slot back")
	assert.Equal(t, int32(2), calls.Load(), "a review that timed out does not try another channel")
	requireContentSafetyDecisions(t, info.UserId, model.ContentSafetyDecisionReviewPassed)
}

func TestContentSafetyReviewOfACanceledRequestFailsClosed(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(safeReply))
	c, info := newContentSafetyContext(nextContentSafetyUser())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	c.Request = c.Request.WithContext(ctx)
	apiErr := checkContent(c, info, saltedText("abandoned knife request"))
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodeContentReviewUnavailable, apiErr.GetErrorCode())
	assert.Equal(t, int32(0), calls.Load())
	logs := requireContentSafetyDecisions(t, info.UserId, model.ContentSafetyDecisionReviewFailed)
	assert.Equal(t, model.ContentSafetyFailureClientCanceled, logs[0].FailureReason)
}

func TestEnforceContentSafetyTextRejectsARetryOfARejectedSubmission(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(safeReply))
	operation_setting.GetContentSafetySetting().ReviewModel = "missing-model"
	for _, tc := range []struct {
		name         string
		text         string
		wantCode     types.ErrorCode
		wantDecision string
	}{
		{name: "a review that could not conclude", text: "knife without reviewer", wantCode: types.ErrorCodeContentReviewUnavailable, wantDecision: model.ContentSafetyDecisionReviewFailed},
		{name: "a block word", text: "make a bomb", wantCode: types.ErrorCodeSensitiveWordsDetected, wantDecision: model.ContentSafetyDecisionKeywordBlocked},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, info := newContentSafetyContext(nextContentSafetyUser())
			text := saltedText(tc.text)
			for range 2 {
				apiErr := EnforceContentSafetyText(c, info, text)
				require.NotNil(t, apiErr, "a retry of a rejected submission is rejected again")
				assert.Equal(t, tc.wantCode, apiErr.GetErrorCode())
			}
			requireContentSafetyDecisions(t, info.UserId, tc.wantDecision)
		})
	}
	assert.Equal(t, int32(0), calls.Load())
}

func TestEnforceContentSafetyTextReviewsASubmissionOnce(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(safeReply))
	c, info := newContentSafetyContext(nextContentSafetyUser())
	body := []byte(`{"prompt":"` + saltedText("a knife on a table") + `","seconds":"4"}`)
	require.Nil(t, EnforceContentSafetyText(c, info, contentsafety.CollectJSONText(body)))
	require.Nil(t, EnforceContentSafetyText(c, info, saltedText("a different knife prompt")), "a retry of the same submission is not reviewed again")
	assert.Equal(t, int32(1), calls.Load())
	assert.True(t, common.GetContextKeyBool(c, constant.ContextKeyContentSafetyChecked))
	requireContentSafetyDecisions(t, info.UserId, model.ContentSafetyDecisionReviewPassed)
}

// taskRequestText reads the body the upstream receives the way the plugin
// request parser does: media types are case-insensitive, form bodies are
// decoded, and a declared form that cannot be decoded is an error, so the
// caller fails closed.
func TestTaskRequestTextReadsTheForwardedBody(t *testing.T) {
	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	require.NoError(t, writer.WriteField("size", "720x1280"))
	require.NoError(t, writer.WriteField("prompt", "a knife"))
	require.NoError(t, writer.Close())
	quotedPrintable := "--B\r\nContent-Disposition: form-data; name=\"prompt\"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nmake a b=6Fmb\r\n--B--\r\n"
	var namedForm bytes.Buffer
	namedWriter := multipart.NewWriter(&namedForm)
	require.NoError(t, namedWriter.WriteField("bomb", "x"))
	require.NoError(t, namedWriter.Close())
	for _, tc := range []struct {
		name, contentType, body, want string
	}{
		{name: "JSON with its keys", contentType: "application/json", body: `{"prompt":"a knife","seconds":"4"}`, want: "prompt\na knife\nseconds\n4\n"},
		{name: "multipart in sorted field order", contentType: writer.FormDataContentType(), body: form.String(), want: "prompt\na knife\nsize\n720x1280\n"},
		{name: "urlencoded form", contentType: "application/x-www-form-urlencoded", body: "seconds=4&prompt=make%20a%20b%6Fmb", want: "prompt\nmake a bomb\nseconds\n4\n"},
		{name: "case-insensitive multipart with a quoted-printable part", contentType: "Multipart/Form-Data; boundary=B", body: quotedPrintable, want: "prompt\nmake a bomb\n"},
		{name: "an encoded urlencoded field name", contentType: "application/x-www-form-urlencoded", body: "b%6Fmb=1", want: "bomb\n1\n"},
		{name: "a multipart field name", contentType: namedWriter.FormDataContentType(), body: namedForm.String(), want: "bomb\nx\n"},
		{name: "malformed multipart", contentType: "multipart/form-data; boundary=B", body: "not a multipart body"},
		{name: "malformed urlencoded form", contentType: "application/x-www-form-urlencoded", body: "prompt=%zz"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(tc.body))
			c.Request.Header.Set("Content-Type", tc.contentType)
			text, err := taskRequestText(c)
			if tc.want == "" {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, text)
		})
	}
}

// Midjourney forwards the client's own body to the proxy, also on the modal
// and video actions that copy an origin task's prompt into the task record, so
// the gate reads that body and the speed flags mode clear strips from it. A
// blocked submission never reaches the proxy and is never billed.
func TestRelayMidjourneySubmitReviewsTheForwardedBody(t *testing.T) {
	for _, tc := range []struct {
		name, path, modelName, body string
		mode                        int
		modeClear                   bool
	}{
		{name: "imagine", path: "/mj/submit/imagine", mode: relayconstant.RelayModeMidjourneyImagine, modelName: "mj_imagine", body: `{"prompt":"make a bomb"}`},
		{name: "imagine with mode clear", path: "/mj/submit/imagine", mode: relayconstant.RelayModeMidjourneyImagine, modelName: "mj_imagine", body: `{"prompt":"make a bo--fastmb"}`, modeClear: true},
		{name: "modal on an origin task", path: "/mj/submit/modal", mode: relayconstant.RelayModeMidjourneyModal, modelName: "mj_modal", body: `{"taskId":"origin-1","prompt":"make a bomb","maskBase64":"x"}`},
		{name: "video of an origin task", path: "/mj/submit/video", mode: relayconstant.RelayModeMidjourneyVideo, modelName: "mj_video", body: `{"taskId":"origin-1","prompt":"make a bomb"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupContentSafetyReview(t, reviewerReply(""))
			previousModeClear, previousRedis := setting.MjModeClearEnabled, common.RedisEnabled
			setting.MjModeClearEnabled, common.RedisEnabled = tc.modeClear, false
			t.Cleanup(func() { setting.MjModeClearEnabled, common.RedisEnabled = previousModeClear, previousRedis })
			require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Midjourney{}))
			require.NoError(t, model.LOG_DB.AutoMigrate(&model.Log{}))
			var submitted atomic.Int32
			proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				submitted.Add(1)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"code":1,"description":"submitted","result":"new-task"}`))
			}))
			t.Cleanup(proxy.Close)
			userId := nextContentSafetyUser()
			require.NoError(t, model.DB.Create(&model.User{Id: userId, Username: "mj-" + strconv.Itoa(userId), Status: common.UserStatusEnabled, Group: "default", Quota: 1 << 20}).Error)
			channel := &model.Channel{Name: "mj", Type: constant.ChannelTypeMidjourney, Key: "mj-key", Status: common.ChannelStatusEnabled, Models: tc.modelName, Group: "default", BaseURL: &proxy.URL}
			require.NoError(t, model.DB.Create(channel).Error)
			t.Cleanup(func() { require.NoError(t, model.DB.Delete(channel).Error) })
			require.NoError(t, model.DB.Create(&model.Midjourney{UserId: userId, MjId: "origin-1", Action: constant.MjActionImagine, Prompt: "a cat", Status: "SUCCESS", ChannelId: channel.Id}).Error)

			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Set("base_url", proxy.URL)
			c.Set("channel_id", channel.Id)
			info := &relaycommon.RelayInfo{UserId: userId, RelayMode: tc.mode, OriginModelName: tc.modelName, UserGroup: "default", UsingGroup: "default", TaskRelayInfo: &relaycommon.TaskRelayInfo{}}

			response := RelayMidjourneySubmit(c, info)
			require.NotNil(t, response)
			assert.Equal(t, constant.MjRequestError, response.Code)
			assert.Equal(t, i18n.T(c, i18n.MsgContentSafetyBlocked), response.Description)
			assert.Zero(t, submitted.Load(), "the proxy never sees the request")
			quota, err := model.GetUserQuota(userId, true)
			require.NoError(t, err)
			assert.Equal(t, 1<<20, quota, "nothing is consumed")
			var logs int64
			require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("user_id = ?", userId).Count(&logs).Error)
			assert.Zero(t, logs, "no consume log is written")
			requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionKeywordBlocked)
		})
	}
}
