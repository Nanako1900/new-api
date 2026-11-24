package relay

import (
	"bytes"
	"cmp"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
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
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	unsafeReason       = "asks how to hurt a person"
	safeReply          = `{"results":[{"id":1,"level":"safe"}]}`
	controversialReply = `{"results":[{"id":1,"level":"controversial","category":"weapons","reason":"dual-use detail"}]}`
	unsafeReply        = `{"results":[{"id":1,"level":"unsafe","category":"weapons","reason":"` + unsafeReason + `"}]}`
)

var contentSafetyTestSeq atomic.Int64

func nextContentSafetyUser() int {
	return int(100000 + contentSafetyTestSeq.Add(1))
}

func saltedText(text string) string {
	salt := "#" + strconv.FormatInt(contentSafetyTestSeq.Add(1), 10)
	return salt + " " + text + " " + salt
}

// setupContentSafetyReview points the review model, and the escalation model
// "escalate-model" it leaves unset, at a fake OpenAI upstream, makes "bomb" a
// block word and enforces the review synchronously for every account. Every
// review decision is logged.
func setupContentSafetyReview(t *testing.T, reply http.HandlerFunc) *atomic.Int32 {
	t.Helper()
	require.NoError(t, i18n.Init())
	database := setupRelayChannelDB(t)
	require.NoError(t, database.AutoMigrate(&model.Ability{}, &model.ContentSafetyLog{}, &model.User{}, &model.UserRiskProfile{}))
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
	channel := &model.Channel{Name: "reviewer", Type: constant.ChannelTypeOpenAI, Key: "reviewer-key", Status: common.ChannelStatusEnabled, Models: "judge-model,escalate-model", Group: "default", BaseURL: &server.URL}
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
	cfg.ReviewMode, cfg.ReviewModel, cfg.ReviewGroup, cfg.SyncAll = operation_setting.ContentReviewModeEnforce, "judge-model", "default", true
	cfg.ReviewTimeoutSeconds, cfg.CacheTTLSeconds, cfg.PassLogPercent, cfg.SyncNewUserDays = 5, 60, 100, 0
	previousWords, previousEnabled, previousOnPrompt := setting.SensitiveWords, setting.CheckSensitiveEnabled, setting.CheckSensitiveOnPromptEnabled
	setting.SensitiveWords, setting.CheckSensitiveEnabled, setting.CheckSensitiveOnPromptEnabled = []string{"bomb"}, true, true
	t.Cleanup(func() {
		*cfg = previous
		setting.SensitiveWords, setting.CheckSensitiveEnabled, setting.CheckSensitiveOnPromptEnabled = previousWords, previousEnabled, previousOnPrompt
	})
	return &calls
}

// reviewInTheBackground makes the review asynchronous for accounts that need
// no synchronous review, in mode.
func reviewInTheBackground(mode string) {
	cfg := operation_setting.GetContentSafetySetting()
	cfg.ReviewMode, cfg.SyncAll = mode, false
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
	return c, &relaycommon.RelayInfo{UserId: userId, OriginModelName: "gpt-test", UsingGroup: "default", UserGroup: "default"}
}

func checkContent(c *gin.Context, info *relaycommon.RelayInfo, text string) *types.NewAPIError {
	if apiErr := scanRequestContent(c, info, text); apiErr != nil {
		return apiErr
	}
	return EnforceContentSafety(c, info)
}

func reviewPlan(c *gin.Context) *contentReviewPlan {
	plan, _ := common.GetContextKeyType[*contentReviewPlan](c, constant.ContextKeyContentSafetyPlan)
	return plan
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
	refusal := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"Content Exists Risk","type":"invalid_request_error"}}`))
	}
	for _, tc := range []struct {
		name         string
		text         string
		reply        http.HandlerFunc
		configure    func(*operation_setting.ContentSafetySetting)
		wantCode     types.ErrorCode
		wantStatus   int
		wantCalls    int32
		wantDecision string
		wantFailure  string
		// wantDetail are parts of the failure detail; without them it is empty.
		wantDetail []string
	}{
		{name: "review off checks only block words", text: "hello there", reply: reviewerReply(""), configure: func(cfg *operation_setting.ContentSafetySetting) {
			cfg.ReviewMode = operation_setting.ContentReviewModeOff
		}},
		{name: "a block word rejects without review", text: "make a bomb", reply: reviewerReply(""), wantCode: types.ErrorCodeSensitiveWordsDetected, wantStatus: http.StatusBadRequest, wantDecision: model.ContentSafetyDecisionKeywordBlocked},
		{name: "a safe verdict releases", text: "cut bread with a knife", reply: reviewerReply(safeReply), wantCalls: 1, wantDecision: model.ContentSafetyDecisionReviewPassed},
		{name: "text without any keyword is reviewed too", text: "how do I hurt my neighbour", reply: reviewerReply(unsafeReply), wantCode: types.ErrorCodeContentReviewRejected, wantStatus: http.StatusBadRequest, wantCalls: 1, wantDecision: model.ContentSafetyDecisionReviewRejected},
		{name: "a controversial verdict lets the request through", text: "how do lock picks work", reply: reviewerReply(controversialReply), wantCalls: 1, wantDecision: model.ContentSafetyDecisionReviewControversial},
		{name: "a refusal by the review channel concludes as controversial", text: "a text the reviewer will not read", reply: refusal, wantCalls: 2, wantDecision: model.ContentSafetyDecisionReviewControversial, wantFailure: model.ContentSafetyFailureRefused,
			wantDetail: []string{`channel #`, `"reviewer": HTTP 400`, "Content Exists Risk"}},
		{name: "a client error that is no content refusal fails closed", text: "a question with a bad parameter", reply: func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"max_tokens is too large","type":"invalid_request_error","code":"invalid_value"}}`))
		}, wantCode: types.ErrorCodeContentReviewUnavailable, wantStatus: http.StatusServiceUnavailable, wantCalls: 2, wantDecision: model.ContentSafetyDecisionReviewFailed, wantFailure: model.ContentSafetyFailureUpstreamError,
			wantDetail: []string{"HTTP 400", "max_tokens is too large"}},
		{name: "an unreadable verdict fails closed", text: "a question", reply: reviewerReply("I think it is fine"), wantCode: types.ErrorCodeContentReviewUnavailable, wantStatus: http.StatusServiceUnavailable, wantCalls: 1, wantDecision: model.ContentSafetyDecisionReviewFailed, wantFailure: model.ContentSafetyFailureUnparseable,
			wantDetail: []string{`finish_reason="stop"`, "18 content chars", "reply: I think it is fine"}},
		{name: "a reply cut off while reasoning says so", text: "a long think", reply: func(w http.ResponseWriter, _ *http.Request) {
			body, _ := common.Marshal(map[string]any{
				"id": "chatcmpl-review", "object": "chat.completion", "model": "judge-model",
				"choices": []map[string]any{{"index": 0, "finish_reason": "length", "message": map[string]any{"role": "assistant", "content": "", "reasoning_content": "let me think"}}},
				"usage":   map[string]any{"prompt_tokens": 40, "completion_tokens": 1024, "total_tokens": 1064},
			})
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(body)
		}, wantCode: types.ErrorCodeContentReviewUnavailable, wantStatus: http.StatusServiceUnavailable, wantCalls: 1, wantDecision: model.ContentSafetyDecisionReviewFailed, wantFailure: model.ContentSafetyFailureUnparseable,
			wantDetail: []string{"the reply is empty", `finish_reason="length"`, "0 content chars", "12 reasoning chars"}},
		{name: "an upstream error fails closed after one more channel attempt", text: "another question", reply: func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) }, wantCode: types.ErrorCodeContentReviewUnavailable, wantStatus: http.StatusServiceUnavailable, wantCalls: 2, wantDecision: model.ContentSafetyDecisionReviewFailed, wantFailure: model.ContentSafetyFailureUpstreamError,
			wantDetail: []string{"HTTP 500"}},
		{name: "no review channel fails closed", text: "a text without reviewer", reply: reviewerReply(""), configure: func(cfg *operation_setting.ContentSafetySetting) { cfg.ReviewModel = "missing-model" }, wantCode: types.ErrorCodeContentReviewUnavailable, wantStatus: http.StatusServiceUnavailable, wantDecision: model.ContentSafetyDecisionReviewFailed, wantFailure: model.ContentSafetyFailureNoChannel,
			wantDetail: []string{`no enabled channel in group "default" serves model "missing-model"`}},
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
				assert.NotContains(t, apiErr.Error(), "bomb", "clients never see the matched words")
				assert.NotContains(t, apiErr.Error(), unsafeReason, "clients never see the reviewer's reason")
			}
			if tc.wantDecision == "" {
				requireContentSafetyDecisions(t, info.UserId)
				return
			}
			logs := requireContentSafetyDecisions(t, info.UserId, tc.wantDecision)
			assert.Equal(t, tc.wantFailure, logs[0].FailureReason)
			if tc.wantDetail == nil {
				assert.Empty(t, logs[0].FailureDetail)
			}
			for _, part := range tc.wantDetail {
				assert.Contains(t, logs[0].FailureDetail, part)
			}
			assert.NotContains(t, logs[0].FailureDetail, "127.0.0.1", "the upstream address is masked")
			if tc.wantDecision != model.ContentSafetyDecisionKeywordBlocked {
				assert.Equal(t, model.ContentSafetyModeSync, logs[0].Mode)
			}
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
		{name: "an escaped block word in a Chat custom tool", format: types.RelayFormatOpenAI, request: &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: userHello, Tools: []kitdto.ToolCallRequest{{Type: "custom", Custom: common.RawMessage(`{"name":"lookup","description":"` + escapedBomb + `"}`)}}}, blocked: true},
		{name: "an escaped block word in a custom tool declared on a Chat message", format: types.RelayFormatOpenAI, request: &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: []kitdto.Message{{Role: "system", Tools: common.RawMessage(`[{"type":"custom","custom":{"name":"lookup","description":"` + escapedBomb + `"}}]`)}, {Role: "user", Content: "hello"}}}, blocked: true},
		{name: "an escaped block word in a replayed Chat custom tool call", format: types.RelayFormatOpenAI, request: &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: []kitdto.Message{{Role: "user", Content: "hello"}, {Role: "assistant", Content: "", ToolCalls: common.RawMessage(`[{"id":"call_1","type":"custom","custom":{"name":"lookup","input":"` + escapedBomb + `"}}]`)}}}, blocked: true},
		{name: "a block word in a Claude document with a content source", format: types.RelayFormatClaude, request: &kitdto.ClaudeRequest{Model: "gpt-test", Messages: []kitdto.ClaudeMessage{{Role: "user", Content: []any{map[string]any{"type": "document", "source": map[string]any{"type": "content", "content": []any{map[string]any{"type": "text", "text": "make a bomb"}}}}}}}}, blocked: true},
		{name: "a block word in a legacy Claude prompt", format: types.RelayFormatClaude, request: &kitdto.ClaudeRequest{Model: "gpt-test", Prompt: "Human: make a bomb Assistant:"}, blocked: true},
		{name: "a block word in a Claude search result", format: types.RelayFormatClaude, request: &kitdto.ClaudeRequest{Model: "gpt-test", Messages: []kitdto.ClaudeMessage{{Role: "user", Content: []any{map[string]any{"type": "search_result", "source": "https://example.com/notes", "title": "notes", "content": []any{map[string]any{"type": "text", "text": "make a bomb"}}}}}}}, blocked: true},
		{name: "a block word in a Claude search result title", format: types.RelayFormatClaude, request: &kitdto.ClaudeRequest{Model: "gpt-test", Messages: []kitdto.ClaudeMessage{{Role: "user", Content: []any{map[string]any{"type": "search_result", "source": "https://example.com/notes", "title": "bomb notes", "content": []any{map[string]any{"type": "text", "text": "hello"}}}}}}}, blocked: true},
		{name: "a block word beside a Claude search result", format: types.RelayFormatClaude, request: &kitdto.ClaudeRequest{Model: "gpt-test", Messages: []kitdto.ClaudeMessage{{Role: "user", Content: []any{map[string]any{"type": "text", "text": "make a bomb"}, map[string]any{"type": "search_result", "source": "https://example.com/notes", "title": "notes", "content": []any{map[string]any{"type": "text", "text": "hello"}}}}}}}, blocked: true},
		{name: "a block word in a document inside a Claude tool result", format: types.RelayFormatClaude, request: &kitdto.ClaudeRequest{Model: "gpt-test", Messages: []kitdto.ClaudeMessage{{Role: "user", Content: []any{map[string]any{"type": "tool_result", "tool_use_id": "toolu_1", "content": []any{map[string]any{"type": "document", "source": map[string]any{"type": "text", "media_type": "text/plain", "data": "make a bomb"}}}}}}}}, blocked: true},
		{name: "a block word beside a search result inside a Claude tool result", format: types.RelayFormatClaude, request: &kitdto.ClaudeRequest{Model: "gpt-test", Messages: []kitdto.ClaudeMessage{{Role: "user", Content: []any{map[string]any{"type": "tool_result", "tool_use_id": "toolu_1", "content": []any{map[string]any{"type": "text", "text": "make a bomb"}, map[string]any{"type": "search_result", "source": "https://example.com/notes", "title": "notes", "content": []any{map[string]any{"type": "text", "text": "hello"}}}}}}}}}, blocked: true},
		{name: "a block word in a Claude MCP tool result", format: types.RelayFormatClaude, request: &kitdto.ClaudeRequest{Model: "gpt-test", Messages: []kitdto.ClaudeMessage{{Role: "user", Content: []any{map[string]any{"type": "mcp_tool_result", "tool_use_id": "mcptoolu_1", "content": []any{map[string]any{"type": "text", "text": "make a bomb"}}}}}}}, blocked: true},
		{name: "a block word in a Claude server tool call", format: types.RelayFormatClaude, request: &kitdto.ClaudeRequest{Model: "gpt-test", Messages: []kitdto.ClaudeMessage{{Role: "assistant", Content: []any{map[string]any{"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": map[string]any{"query": "make a bomb"}}}}}}, blocked: true},
		{name: "a block word in Gemini inline text data", format: types.RelayFormatGemini, request: &kitdto.GeminiChatRequest{Contents: []kitdto.GeminiChatContent{{Role: "user", Parts: []kitdto.GeminiPart{{Text: "summarize"}, {InlineData: &kitdto.GeminiInlineData{MimeType: "text/plain", Data: base64.StdEncoding.EncodeToString([]byte("make a bomb"))}}}}}}, blocked: true},
		{name: "a block word in a Gemini response schema", format: types.RelayFormatGemini, request: &kitdto.GeminiChatRequest{Contents: []kitdto.GeminiChatContent{{Role: "user", Parts: []kitdto.GeminiPart{{Text: "hello"}}}}, GenerationConfig: kitdto.GeminiChatGenerationConfig{ResponseSchema: map[string]any{"type": "object", "properties": map[string]any{"bomb": map[string]any{"type": "string"}}}}}, blocked: true},
		{name: "a block word in a Gemini response JSON schema", format: types.RelayFormatGemini, request: &kitdto.GeminiChatRequest{Contents: []kitdto.GeminiChatContent{{Role: "user", Parts: []kitdto.GeminiPart{{Text: "hello"}}}}, GenerationConfig: kitdto.GeminiChatGenerationConfig{ResponseJsonSchema: common.RawMessage(`{"type":"object","description":"` + escapedBomb + `"}`)}}, blocked: true},
		{name: "a block word in an embedding input", format: types.RelayFormatEmbedding, request: &kitdto.EmbeddingRequest{Model: "gpt-test", Input: "make a bomb"}, blocked: true},
		{name: "a block word in a Chat prediction", format: types.RelayFormatOpenAI, request: &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: userHello, Prediction: common.RawMessage(`{"type":"content","content":"make a bomb"}`)}, blocked: true},
		{name: "an escaped block word in Chat prediction text parts", format: types.RelayFormatOpenAI, request: &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: userHello, Prediction: common.RawMessage(`{"type":"content","content":[{"type":"text","text":"` + escapedBomb + `"}]}`)}, blocked: true},
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

func unitRoles(units []contentsafety.Unit) []string {
	roles := make([]string, len(units))
	for i, unit := range units {
		roles[i] = unit.Role
	}
	return roles
}

// Chat formats are reviewed message by message, newest first, with tool and
// schema definitions as one meta unit. Tool results are part of the history a
// client writes, so they are reviewed unless switched off.
func TestContentSafetyReviewReadsEachFormatByMessage(t *testing.T) {
	const tools = `[{"type":"function","name":"lookup","description":"look things up"}]`
	user, assistant, tool, system, meta := contentsafety.RoleUser, contentsafety.RoleAssistant, contentsafety.RoleTool, contentsafety.RoleSystem, contentsafety.RoleMeta
	for _, tc := range []struct {
		name        string
		request     kitdto.Request
		toolResults bool
		wantRoles   []string
		wantText    map[string]string
	}{
		{
			name: "Chat with tool results",
			request: &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: []kitdto.Message{
				{Role: "system", Content: "be brief"}, {Role: "user", Content: "find it"},
				{Role: "assistant", Content: "", ToolCalls: common.RawMessage(`[{"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{}"}}]`)},
				{Role: "tool", ToolCallId: "call_1", Content: "the tool result"}, {Role: "user", Content: []any{map[string]any{"type": "text", "text": "thanks"}}},
			}},
			toolResults: true,
			wantRoles:   []string{user, tool, assistant, user, system},
			wantText:    map[string]string{user: "thanks", tool: "the tool result", system: "be brief"},
		},
		{
			name: "Chat without tool results",
			request: &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: []kitdto.Message{
				{Role: "user", Content: "find it"}, {Role: "tool", ToolCallId: "call_1", Content: "the tool result"},
			}},
			wantRoles: []string{user},
		},
		{
			name: "Claude",
			request: &kitdto.ClaudeRequest{Model: "gpt-test", System: "be brief", Messages: []kitdto.ClaudeMessage{
				{Role: "user", Content: "find it"},
				{Role: "assistant", Content: []any{map[string]any{"type": "tool_use", "id": "toolu_1", "name": "lookup", "input": map[string]any{"q": "x"}}}},
				{Role: "user", Content: []any{map[string]any{"type": "tool_result", "tool_use_id": "toolu_1", "content": "the tool result"}, map[string]any{"type": "text", "text": "thanks"}}},
			}},
			toolResults: true,
			wantRoles:   []string{user, assistant, user, system},
			wantText:    map[string]string{user: "the tool result\nthanks", system: "be brief"},
		},
		{
			name: "Responses",
			request: &kitdto.OpenAIResponsesRequest{Model: "gpt-test", Instructions: common.RawMessage(`"be brief"`), Tools: common.RawMessage(tools), Input: common.RawMessage(`[
				{"role":"user","content":[{"type":"input_text","text":"find it"}]},
				{"type":"function_call","call_id":"c1","name":"lookup","arguments":"{}"},
				{"type":"function_call_output","call_id":"c1","output":"the tool result"},
				{"type":"message","role":"user","content":"thanks"}]`)},
			toolResults: true,
			wantRoles:   []string{user, tool, assistant, user, system, meta},
			wantText:    map[string]string{user: "thanks", tool: "the tool result", system: "be brief"},
		},
		{
			name: "Responses compaction",
			request: &kitdto.OpenAIResponsesCompactionRequest{Model: "gpt-test", Instructions: common.RawMessage(`"be brief"`), Input: common.RawMessage(`[
				{"role":"user","content":[{"type":"input_text","text":"find it"}]},
				{"type":"function_call","call_id":"c1","name":"lookup","arguments":"{}"},
				{"type":"function_call_output","call_id":"c1","output":"the tool result"},
				{"type":"message","role":"user","content":"thanks"}]`)},
			toolResults: true,
			wantRoles:   []string{user, tool, assistant, user, system},
			wantText:    map[string]string{user: "thanks", tool: "the tool result", system: "be brief"},
		},
		{
			name: "Gemini",
			request: &kitdto.GeminiChatRequest{SystemInstructions: &kitdto.GeminiChatContent{Parts: []kitdto.GeminiPart{{Text: "be brief"}}}, Contents: []kitdto.GeminiChatContent{
				{Role: "user", Parts: []kitdto.GeminiPart{{Text: "find it"}}},
				{Role: "model", Parts: []kitdto.GeminiPart{{FunctionCall: &kitdto.FunctionCall{FunctionName: "lookup", Arguments: map[string]any{"q": "x"}}}}},
				{Role: "user", Parts: []kitdto.GeminiPart{{FunctionResponse: &kitdto.GeminiFunctionResponse{Name: "lookup", Response: map[string]any{"result": "the tool result"}}}}},
				{Role: "user", Parts: []kitdto.GeminiPart{{Text: "thanks"}}},
			}},
			toolResults: true,
			wantRoles:   []string{user, tool, assistant, user, system},
			wantText:    map[string]string{user: "thanks", system: "be brief"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupContentSafetyReview(t, reviewerReply(safeReply))
			operation_setting.GetContentSafetySetting().ReviewToolResults = tc.toolResults
			c, info := newContentSafetyContext(nextContentSafetyUser())
			info.Request = tc.request
			require.Nil(t, scanRequestContent(c, info, ""))
			plan := reviewPlan(c)
			require.NotNil(t, plan)
			assert.Equal(t, tc.wantRoles, unitRoles(plan.pending))
			for role, text := range tc.wantText {
				index := slices.Index(unitRoles(plan.pending), role)
				require.GreaterOrEqual(t, index, 0)
				assert.Equal(t, text, plan.pending[index].Text, "the newest %s unit", role)
			}
		})
	}
}

// A conversation resends its history on every turn; only messages the
// reviewer has not judged are asked about.
func TestContentSafetyReviewAsksOnlyAboutNewMessages(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(safeReply))
	userId, first, second := nextContentSafetyUser(), saltedText("first question"), saltedText("second question")
	turn := func(messages ...kitdto.Message) {
		c, info := newContentSafetyContext(userId)
		info.Request = &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: messages}
		require.Nil(t, checkContent(c, info, ""))
	}
	turn(kitdto.Message{Role: "user", Content: first})
	assert.Equal(t, int32(1), calls.Load())
	turn(kitdto.Message{Role: "user", Content: first}, kitdto.Message{Role: "assistant", Content: saltedText("an answer")}, kitdto.Message{Role: "user", Content: second})
	assert.Equal(t, int32(3), calls.Load(), "the answer and the new question are reviewed, the first question is not")
	turn(kitdto.Message{Role: "user", Content: first})
	assert.Equal(t, int32(3), calls.Load(), "a repeat is decided from the cache")
	requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewPassed, model.ContentSafetyDecisionReviewPassed)
}

// A cached unsafe verdict stops a synchronously reviewed request in the scan,
// before anything is reserved.
func TestContentSafetyReviewRejectsACachedUnsafeUnitWithoutAsking(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(unsafeReply))
	userId, text := nextContentSafetyUser(), saltedText("stab someone")
	c, info := newContentSafetyContext(userId)
	apiErr := checkContent(c, info, text)
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodeContentReviewRejected, apiErr.GetErrorCode())

	c, info = newContentSafetyContext(userId)
	apiErr = scanRequestContent(c, info, text)
	require.NotNil(t, apiErr, "the scan rejects before pre-consume")
	assert.Equal(t, types.ErrorCodeContentReviewRejected, apiErr.GetErrorCode())
	assert.NotContains(t, apiErr.Error(), unsafeReason)
	assert.Equal(t, int32(1), calls.Load())

	logs := requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewRejected, model.ContentSafetyDecisionReviewRejected)
	hits := slices.DeleteFunc(logs, func(entry *model.ContentSafetyLog) bool { return !entry.CacheHit })
	require.Len(t, hits, 1, "only the cache-answered rejection is recorded as a cache hit")
	assert.Equal(t, "weapons", hits[0].AiCategory)
	assert.Equal(t, unsafeReason, hits[0].AiReason)
	assert.JSONEq(t, `["weapons"]`, hits[0].HitWords)
	snippets, err := common.Marshal([]string{text})
	require.NoError(t, err)
	assert.JSONEq(t, string(snippets), hits[0].Snippets)
}

// gatedReviewer answers with reply only once released, so a test can tell a
// request that waited for its review from one that did not.
func gatedReviewer(t *testing.T, reply string) (http.HandlerFunc, func()) {
	release := make(chan struct{})
	var once sync.Once
	open := func() { once.Do(func() { close(release) }) }
	t.Cleanup(open)
	return func(w http.ResponseWriter, r *http.Request) {
		<-release
		reviewerReply(reply)(w, r)
	}, open
}

func TestContentSafetyBackgroundReviewsNeverHoldOrBlockTheRequest(t *testing.T) {
	for _, tc := range []struct {
		mode         string
		wantLogMode  string
		wantDecision string
	}{
		{mode: operation_setting.ContentReviewModeShadow, wantLogMode: model.ContentSafetyModeShadow, wantDecision: model.ContentSafetyDecisionReviewFlagged},
		{mode: operation_setting.ContentReviewModeEnforce, wantLogMode: model.ContentSafetyModeAsync, wantDecision: model.ContentSafetyDecisionReviewFlagged},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			reply, release := gatedReviewer(t, unsafeReply)
			setupContentSafetyReview(t, reply)
			reviewInTheBackground(tc.mode)
			c, info := newContentSafetyContext(nextContentSafetyUser())
			require.Nil(t, checkContent(c, info, saltedText("stab someone")), "the request goes on while the reviewer has not answered")
			release()
			logs := requireContentSafetyDecisions(t, info.UserId, tc.wantDecision)
			assert.Equal(t, tc.wantLogMode, logs[0].Mode)
			assert.Equal(t, "weapons", logs[0].AiCategory)
		})
	}
}

func TestContentSafetySyncReviewIsForAccountsThatNeedIt(t *testing.T) {
	for _, tc := range []struct {
		name      string
		configure func(*operation_setting.ContentSafetySetting)
		info      func(*relaycommon.RelayInfo)
		createdAt int64
		// noCreatedAt clears the account's registration time.
		noCreatedAt bool
		wantMode    string
	}{
		{name: "an account in a listed group", configure: func(cfg *operation_setting.ContentSafetySetting) { cfg.SyncGroups = "vip\nrisky" }, info: func(info *relaycommon.RelayInfo) { info.UserGroup = "risky" }, wantMode: model.ContentSafetyModeSync},
		{name: "a token choosing a listed group", configure: func(cfg *operation_setting.ContentSafetySetting) { cfg.SyncGroups = "risky" }, info: func(info *relaycommon.RelayInfo) { info.UsingGroup = "risky" }, wantMode: model.ContentSafetyModeAsync},
		{name: "a new account", configure: func(cfg *operation_setting.ContentSafetySetting) { cfg.SyncNewUserDays = 3 }, createdAt: -3600, wantMode: model.ContentSafetyModeSync},
		{name: "an established account", configure: func(cfg *operation_setting.ContentSafetySetting) { cfg.SyncNewUserDays = 3 }, createdAt: -4 * 86400, wantMode: model.ContentSafetyModeAsync},
		{name: "an account without a registration time", configure: func(cfg *operation_setting.ContentSafetySetting) { cfg.SyncNewUserDays = 3 }, noCreatedAt: true, wantMode: model.ContentSafetyModeAsync},
		{name: "an account whose background reviews were dropped", info: func(info *relaycommon.RelayInfo) { contentsafety.ForceSync(info.UserId) }, wantMode: model.ContentSafetyModeSync},
		{name: "an account at the watch risk level", info: func(info *relaycommon.RelayInfo) { scoreTestAccount(info.UserId, 25) }, wantMode: model.ContentSafetyModeSync},
		{name: "a trusted account even with sync_all", configure: func(cfg *operation_setting.ContentSafetySetting) { cfg.SyncAll = true }, info: func(info *relaycommon.RelayInfo) {
			scoreTestAccount(info.UserId, 60)
			_ = model.SetUserRiskTrusted(info.UserId, true)
			contentsafety.ForgetRiskState(info.UserId)
		}, wantMode: model.ContentSafetyModeAsync},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupContentSafetyReview(t, reviewerReply(safeReply))
			reviewInTheBackground(operation_setting.ContentReviewModeEnforce)
			cfg := operation_setting.GetContentSafetySetting()
			if tc.configure != nil {
				tc.configure(cfg)
			}
			c, info := newContentSafetyContext(nextContentSafetyUser())
			require.NoError(t, model.DB.AutoMigrate(&model.User{}))
			require.NoError(t, model.DB.Create(&model.User{Id: info.UserId, Username: "cs-" + strconv.Itoa(info.UserId), Status: common.UserStatusEnabled, Group: "default", CreatedAt: common.GetTimestamp() + tc.createdAt}).Error)
			if tc.noCreatedAt {
				require.NoError(t, model.DB.Exec("UPDATE users SET created_at = NULL WHERE id = ?", info.UserId).Error)
			}
			if tc.info != nil {
				tc.info(info)
			}
			require.Nil(t, scanRequestContent(c, info, saltedText("a question")))
			require.NotNil(t, reviewPlan(c))
			assert.Equal(t, tc.wantMode, reviewPlan(c).mode)
		})
	}
}

// scoreTestAccount gives userId an enforced risk score of points now.
func scoreTestAccount(userId, points int) {
	cfg := operation_setting.GetContentSafetySetting().Bounded()
	_, _ = model.RecordRiskEvent(model.RiskEvent{UserId: userId, Unsafe: true, Points: points, Now: common.GetTimestamp(), Thresholds: contentsafety.RiskThresholds(cfg)})
	contentsafety.ForgetRiskState(userId)
}

// Every non-safe verdict feeds the risk score of the account that sent it,
// once per account and unit: resent history never adds up, while another
// account sending the same text is scored too. Shadow reviews and trusted
// accounts move only the shadow score, and root accounts are never scored.
// The log row of each decision carries the change.
func TestContentSafetyVerdictsScoreTheAccountOncePerUnit(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(unsafeReply))
	text := saltedText("stab someone")
	profile := func(userId int) model.UserRiskProfile {
		stored, err := model.GetUserRiskProfile(userId)
		require.NoError(t, err)
		return stored
	}
	send := func(userId int) *types.NewAPIError {
		c, info := newContentSafetyContext(userId)
		return checkContent(c, info, text)
	}
	rejected, flagged := model.ContentSafetyDecisionReviewRejected, model.ContentSafetyDecisionReviewFlagged

	first := nextContentSafetyUser()
	require.NotNil(t, send(first))
	logs := requireContentSafetyDecisions(t, first, rejected)
	assert.Equal(t, []int{40, 40}, []int{logs[0].RiskDelta, logs[0].RiskScore})
	require.NotNil(t, send(first), "the cache rejects the resent text")
	logs = requireContentSafetyDecisions(t, first, rejected, rejected)
	assert.Equal(t, 40, logs[0].RiskDelta+logs[1].RiskDelta, "the resent text is not scored again")
	assert.InDelta(t, 40, profile(first).Score, 0.01)
	assert.Equal(t, 1, profile(first).UnsafeCount)

	second := nextContentSafetyUser()
	require.NotNil(t, send(second))
	logs = requireContentSafetyDecisions(t, second, rejected)
	assert.True(t, logs[0].CacheHit)
	assert.Equal(t, 40, logs[0].RiskDelta, "another account sending the cached text is scored")
	assert.Equal(t, int32(1), calls.Load())

	reviewInTheBackground(operation_setting.ContentReviewModeShadow)
	shadow := nextContentSafetyUser()
	require.Nil(t, send(shadow))
	requireContentSafetyDecisions(t, shadow, flagged)
	assert.InDelta(t, 40, profile(shadow).ShadowScore, 0.01)
	assert.Zero(t, profile(shadow).Score)

	reviewInTheBackground(operation_setting.ContentReviewModeEnforce)
	trusted := nextContentSafetyUser()
	require.NoError(t, model.SetUserRiskTrusted(trusted, true))
	require.Nil(t, send(trusted))
	requireContentSafetyDecisions(t, trusted, flagged)
	assert.InDelta(t, 40, profile(trusted).ShadowScore, 0.01)
	assert.Zero(t, profile(trusted).Score)
	assert.False(t, profile(trusted).Blocked)

	root := nextContentSafetyUser()
	require.NoError(t, model.DB.Create(&model.User{Id: root, Username: "cs-root-" + strconv.Itoa(root), Role: common.RoleRootUser, Status: common.UserStatusEnabled, AffCode: "cs-root-" + strconv.Itoa(root)}).Error)
	require.Nil(t, send(root))
	logs = requireContentSafetyDecisions(t, root, flagged)
	assert.Zero(t, logs[0].RiskDelta)
	var stored int64
	require.NoError(t, model.DB.Model(&model.UserRiskProfile{}).Where("user_id = ?", root).Count(&stored).Error)
	assert.Zero(t, stored, "root accounts are never scored")
}

// Administrators hear when an enforced account becomes restricted or
// blocked, and of every zero-tolerance hit, shadow reviews included. A notice
// names the account, its level and the category, never the content.
func TestContentRiskNoticesNameTheAccountNeverTheContent(t *testing.T) {
	const minorsMarker = "minors-marker"
	setupContentSafetyReview(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(string(body), minorsMarker) {
			reviewerReply(`{"results":[{"id":1,"level":"unsafe","category":"sexual_minors","reason":"minor"}]}`)(w, r)
			return
		}
		reviewerReply(unsafeReply)(w, r)
	})
	fetch := system_setting.GetFetchSetting()
	previousFetch, previousRedis, previousLimit := *fetch, common.RedisEnabled, constant.NotifyLimitCount
	fetch.EnableSSRFProtection, common.RedisEnabled, constant.NotifyLimitCount = false, false, 2
	t.Cleanup(func() {
		*fetch, common.RedisEnabled, constant.NotifyLimitCount = previousFetch, previousRedis, previousLimit
	})
	var mutex sync.Mutex
	var received []service.WebhookPayload
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload service.WebhookPayload
		if common.DecodeJson(r.Body, &payload) == nil {
			mutex.Lock()
			received = append(received, payload)
			mutex.Unlock()
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)
	setting, err := common.Marshal(kitdto.UserSetting{NotifyType: kitdto.NotifyTypeWebhook, WebhookUrl: server.URL})
	require.NoError(t, err)
	adminId := nextContentSafetyUser()
	require.NoError(t, model.DB.Create(&model.User{Id: adminId, Username: "cs-admin-" + strconv.Itoa(adminId), Role: common.RoleAdminUser, Status: common.UserStatusEnabled, Setting: string(setting), AffCode: "cs-admin-" + strconv.Itoa(adminId)}).Error)
	account := func() int {
		id := nextContentSafetyUser()
		require.NoError(t, model.DB.Create(&model.User{Id: id, Username: "cs-" + strconv.Itoa(id), Status: common.UserStatusEnabled, AffCode: "cs-" + strconv.Itoa(id)}).Error)
		return id
	}
	var texts []string
	send := func(userId int, text string) {
		texts = append(texts, text)
		c, info := newContentSafetyContext(userId)
		_ = checkContent(c, info, text)
	}

	// Each decision is recorded after its notice, so waiting for it orders them.
	scored := account()
	for i := range 3 {
		send(scored, saltedText("stab someone "+strconv.Itoa(i)))
		requireContentSafetyDecisions(t, scored, slices.Repeat([]string{model.ContentSafetyDecisionReviewRejected}, i+1)...)
	}
	zeroTolerance := account()
	send(zeroTolerance, saltedText(minorsMarker))
	requireContentSafetyDecisions(t, zeroTolerance, model.ContentSafetyDecisionReviewRejected)
	reviewInTheBackground(operation_setting.ContentReviewModeShadow)
	shadow := account()
	send(shadow, saltedText(minorsMarker))
	requireContentSafetyDecisions(t, shadow, model.ContentSafetyDecisionReviewFlagged)

	want := []string{
		fmt.Sprintf(`content_risk_restricted_%[1]d Account "cs-%[1]d" (#%[1]d) is now restricted by its content risk`, scored),
		fmt.Sprintf(`content_risk_blocked_%[1]d Account "cs-%[1]d" (#%[1]d) has been blocked by its content risk`, scored),
		fmt.Sprintf(`content_risk_blocked_%[1]d Account "cs-%[1]d" (#%[1]d) has been blocked by its content risk`, zeroTolerance),
		fmt.Sprintf(`content_risk_zero_tolerance_%[1]d Account "cs-%[1]d" (#%[1]d) sent content in a zero-tolerance category`, shadow),
	}
	var got []string
	require.Eventually(t, func() bool {
		mutex.Lock()
		defer mutex.Unlock()
		got = got[:0]
		for _, payload := range received {
			got = append(got, payload.Type+" "+payload.Title)
		}
		return len(got) == len(want)
	}, 3*time.Second, 20*time.Millisecond)
	assert.Equal(t, want, got)
	mutex.Lock()
	defer mutex.Unlock()
	assert.Equal(t, fmt.Sprintf("Account: cs-%[1]d (#%[1]d)\nRisk level: blocked\nCategory: sexual_minors\nReview mode: shadow", shadow), received[3].Content)
	for _, payload := range received {
		for _, text := range texts {
			assert.NotContains(t, payload.Content, text)
		}
	}
}

// More new units than one review covers: a synchronous review cannot leave
// any unread and rejects; a background review reads the newest and records
// that the rest went unread.
func TestContentSafetyReviewOfTooManyNewUnits(t *testing.T) {
	messages := func() []kitdto.Message {
		return []kitdto.Message{{Role: "user", Content: saltedText("older question")}, {Role: "assistant", Content: saltedText("answer")}, {Role: "user", Content: saltedText("newest question")}}
	}
	t.Run("sync", func(t *testing.T) {
		calls := setupContentSafetyReview(t, reviewerReply(safeReply))
		operation_setting.GetContentSafetySetting().MaxUnits = 2
		c, info := newContentSafetyContext(nextContentSafetyUser())
		info.Request = &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: messages()}
		apiErr := scanRequestContent(c, info, "")
		require.NotNil(t, apiErr)
		assert.Equal(t, types.ErrorCodeContentReviewUnavailable, apiErr.GetErrorCode())
		assert.Zero(t, calls.Load())
		logs := requireContentSafetyDecisions(t, info.UserId, model.ContentSafetyDecisionReviewFailed)
		assert.Equal(t, model.ContentSafetyFailureTooManyUnits, logs[0].FailureReason)
		assert.True(t, logs[0].Truncated)
	})
	// An enforced background review that leaves units unread has the
	// account's next requests reviewed first, so padding every request with
	// new filler cannot keep an older message from ever being reviewed.
	for _, tc := range []struct {
		mode       string
		wantForced bool
	}{
		{mode: operation_setting.ContentReviewModeShadow},
		{mode: operation_setting.ContentReviewModeEnforce, wantForced: true},
	} {
		t.Run("background "+tc.mode, func(t *testing.T) {
			calls := setupContentSafetyReview(t, reviewerReply(controversialReply))
			reviewInTheBackground(tc.mode)
			operation_setting.GetContentSafetySetting().MaxUnits = 2
			c, info := newContentSafetyContext(nextContentSafetyUser())
			request := &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: messages()}
			info.Request = request
			require.Nil(t, checkContent(c, info, ""))
			logs := requireContentSafetyDecisions(t, info.UserId, model.ContentSafetyDecisionReviewControversial)
			assert.True(t, logs[0].Truncated)
			assert.Equal(t, 3, logs[0].UnitCount)
			assert.Equal(t, int32(2), calls.Load(), "the two newest units are reviewed")
			assert.Equal(t, 15, logs[0].RiskDelta, "two controversial units and the unread one count 5 points each")
			var snippets []string
			require.NoError(t, common.UnmarshalJsonStr(logs[0].Snippets, &snippets))
			assert.Contains(t, snippets, request.Messages[2].StringContent())
			assert.Equal(t, tc.wantForced, contentsafety.SyncForced(context.Background(), info.UserId))
		})
	}
}

// An account over its background quota cannot flood the queue to slip a
// request past the reviewer: the drop is recorded and its next requests wait
// for their review.
func TestContentSafetyBackgroundQuotaForcesSyncReview(t *testing.T) {
	setupContentSafetyReview(t, reviewerReply(safeReply))
	reviewInTheBackground(operation_setting.ContentReviewModeEnforce)
	operation_setting.GetContentSafetySetting().AsyncRatePerMinute = 1
	userId := nextContentSafetyUser()
	c, info := newContentSafetyContext(userId)
	require.Nil(t, checkContent(c, info, saltedText("first question")))
	c, info = newContentSafetyContext(userId)
	require.Nil(t, checkContent(c, info, saltedText("second question")))
	c, info = newContentSafetyContext(userId)
	require.Nil(t, scanRequestContent(c, info, saltedText("third question")))
	assert.Equal(t, model.ContentSafetyModeSync, reviewPlan(c).mode)
	logs := requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewPassed, model.ContentSafetyDecisionReviewFailed)
	failed := slices.DeleteFunc(logs, func(entry *model.ContentSafetyLog) bool {
		return entry.Decision != model.ContentSafetyDecisionReviewFailed
	})
	assert.Equal(t, model.ContentSafetyFailureRateLimited, failed[0].FailureReason)
	assert.Equal(t, "the account is over 1 background review pieces per minute", failed[0].FailureDetail)
}

// A flagged message the cache decided is recorded the first time an account
// sends it, not again with every turn that resends it.
func TestContentSafetyCachedFlaggedHistoryIsRecordedOncePerAccount(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(controversialReply))
	flagged := saltedText("how do lock picks work")
	c, info := newContentSafetyContext(nextContentSafetyUser())
	require.Nil(t, checkContent(c, info, flagged))
	requireContentSafetyDecisions(t, info.UserId, model.ContentSafetyDecisionReviewControversial)

	userId := nextContentSafetyUser()
	for range 3 {
		c, info := newContentSafetyContext(userId)
		require.Nil(t, checkContent(c, info, flagged))
	}
	assert.Equal(t, int32(1), calls.Load())
	logs := requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewControversial)
	assert.True(t, logs[0].CacheHit)
}

// reviewCall is what the stub reviewer received in one review call.
type reviewCall struct {
	Model    string `json:"model"`
	Messages []struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"messages"`
}

func (call reviewCall) roles() []string {
	roles := make([]string, len(call.Messages))
	for i, message := range call.Messages {
		roles[i] = message.Role
	}
	return roles
}

func (call reviewCall) contents() []string {
	contents := make([]string, len(call.Messages))
	for i, message := range call.Messages {
		contents[i] = message.Content
	}
	return contents
}

// recordingReviewer answers every review call with the handler route picks
// for it, and returns the calls received so far.
func recordingReviewer(route func(reviewCall) http.HandlerFunc) (http.HandlerFunc, func() []reviewCall) {
	var mu sync.Mutex
	var calls []reviewCall
	handler := func(w http.ResponseWriter, r *http.Request) {
		var call reviewCall
		if err := common.DecodeJson(r.Body, &call); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mu.Lock()
		calls = append(calls, call)
		mu.Unlock()
		route(call)(w, r)
	}
	return handler, func() []reviewCall {
		mu.Lock()
		defer mu.Unlock()
		return slices.Clone(calls)
	}
}

// byModel answers each review model with its own handler.
func byModel(handlers map[string]http.HandlerFunc) func(reviewCall) http.HandlerFunc {
	return func(call reviewCall) http.HandlerFunc { return handlers[call.Model] }
}

func callsTo(calls []reviewCall, modelName string) []reviewCall {
	return slices.DeleteFunc(calls, func(call reviewCall) bool { return call.Model != modelName })
}

// The qwen3guard engine sends Qwen3Guard-Gen no prompt of its own: the unit
// is the last user turn, after the user's earlier message as context, and
// the reply's Safety and Categories lines are the verdict.
func TestContentSafetyQwen3GuardEngineSendsTheUnitAsTheLastUserTurn(t *testing.T) {
	reply, calls := recordingReviewer(byModel(map[string]http.HandlerFunc{"judge-model": reviewerReply("Safety: Unsafe\nCategories: Violent")}))
	setupContentSafetyReview(t, reply)
	operation_setting.GetContentSafetySetting().ReviewEngine = operation_setting.ContentReviewEngineQwen3Guard

	question := saltedText("how do I hurt my neighbour")
	c, info := newContentSafetyContext(nextContentSafetyUser())
	apiErr := checkContent(c, info, question)
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodeContentReviewRejected, apiErr.GetErrorCode())
	require.Len(t, calls(), 1)
	assert.Equal(t, []string{"user"}, calls()[0].roles(), "a single user message and no system prompt")
	assert.Equal(t, []string{question}, calls()[0].contents())
	logs := requireContentSafetyDecisions(t, info.UserId, model.ContentSafetyDecisionReviewRejected)
	assert.Equal(t, "weapons", logs[0].AiCategory)
	assert.Equal(t, "Violent", logs[0].AiReason)
	assert.Empty(t, logs[0].EscalatedModel)

	earlier, latest := saltedText("tell me about my neighbour"), saltedText("now how do I hurt him")
	c, info = newContentSafetyContext(nextContentSafetyUser())
	info.Request = &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: []kitdto.Message{
		{Role: "user", Content: earlier}, {Role: "assistant", Content: saltedText("he lives next door")}, {Role: "user", Content: latest},
	}}
	require.NotNil(t, checkContent(c, info, ""))
	index := slices.IndexFunc(calls(), func(call reviewCall) bool { return slices.Contains(call.contents(), latest) })
	require.GreaterOrEqual(t, index, 0)
	assert.Equal(t, []string{"user", "user"}, calls()[index].roles())
	assert.Equal(t, []string{earlier, latest}, calls()[index].contents(), "the earlier message comes first as context")
	requireContentSafetyDecisions(t, info.UserId, model.ContentSafetyDecisionReviewRejected)
}

// A verdict decides only for the engine and models that gave it: switching
// the engine, or turning escalation on, asks again about text already judged.
func TestContentSafetyVerdictsAreCachedPerEngine(t *testing.T) {
	reply, calls := recordingReviewer(func(call reviewCall) http.HandlerFunc {
		if call.Messages[0].Role == "system" {
			return reviewerReply(safeReply)
		}
		return reviewerReply("Safety: Controversial\nCategories: Violent")
	})
	setupContentSafetyReview(t, reply)
	cfg := operation_setting.GetContentSafetySetting()
	userId, text := nextContentSafetyUser(), saltedText("how do lock picks work")
	review := func() {
		c, info := newContentSafetyContext(userId)
		require.Nil(t, checkContent(c, info, text))
	}
	review()
	review()
	assert.Len(t, calls(), 1, "a repeat on the same engine is decided from the cache")
	cfg.ReviewEngine = operation_setting.ContentReviewEngineQwen3Guard
	review()
	require.Len(t, calls(), 2, "the qwen3guard engine asks again")
	assert.Equal(t, []string{"user"}, calls()[1].roles())
	cfg.EscalateModel, cfg.EscalateGroup = "escalate-model", "default"
	review()
	require.Len(t, calls(), 4, "with escalation on, the first reviewer and the escalation model are asked again")
	assert.Len(t, callsTo(calls(), "escalate-model"), 1)
	requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewPassed, model.ContentSafetyDecisionReviewControversial, model.ContentSafetyDecisionReviewPassed)
}

// A shadow review reads the sample of an account's new text: a text out of
// the sample is never sent to the reviewer however often the account resends
// it, while enforced reviews, in the background or not, read it all the same.
func TestContentSafetyShadowReviewSample(t *testing.T) {
	previousSecret := common.CryptoSecret
	common.CryptoSecret = "sample-test-secret"
	t.Cleanup(func() { common.CryptoSecret = previousSecret })
	calls := setupContentSafetyReview(t, reviewerReply(safeReply))
	cfg := operation_setting.GetContentSafetySetting()
	cfg.PassLogPercent = 100
	reviewInTheBackground(operation_setting.ContentReviewModeShadow)

	userId := nextContentSafetyUser()
	var inSample, outOfSample string
	for i := range 64 {
		if inSample != "" && outOfSample != "" {
			break
		}
		text := saltedText(fmt.Sprintf("sample probe %d", i))
		c, info := newContentSafetyContext(userId)
		require.Nil(t, scanRequestContent(c, info, text))
		require.Len(t, reviewPlan(c).pending, 1)
		if contentsafety.SampledForReview(userId, reviewPlan(c).pending[0].Key, 50) {
			inSample = cmp.Or(inSample, text)
		} else {
			outOfSample = cmp.Or(outOfSample, text)
		}
	}
	require.NotEmpty(t, inSample)
	require.NotEmpty(t, outOfSample)

	cfg.ReviewSamplePercent = 50
	for range 2 {
		c, info := newContentSafetyContext(userId)
		require.Nil(t, checkContent(c, info, outOfSample))
	}
	c, info := newContentSafetyContext(userId)
	require.Nil(t, checkContent(c, info, inSample))
	requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewPassed)
	assert.Equal(t, int32(1), calls.Load(), "only the text in the sample is reviewed, once")

	reviewInTheBackground(operation_setting.ContentReviewModeEnforce)
	c, info = newContentSafetyContext(userId)
	require.Nil(t, checkContent(c, info, outOfSample))
	requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewPassed, model.ContentSafetyDecisionReviewPassed)
	assert.Equal(t, int32(2), calls.Load(), "an enforced background review reads text out of the sample")

	cfg.SyncAll = true
	c, info = newContentSafetyContext(userId)
	require.Nil(t, checkContent(c, info, saltedText("a synchronous question")))
	assert.Equal(t, int32(3), calls.Load(), "a synchronous review reads everything")
}

// A review whose time ran out before its first call, as an escalation can at
// the end of the review timeout, reports the timeout, not a missing channel.
func TestContentSafetyReviewOutOfTimeReportsTimeout(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(safeReply))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	review := reviewUnitOnChannels(ctx, "req-out-of-time", operation_setting.GetContentSafetySetting().Bounded(), contentsafety.DefaultReviewPrompt, contentsafety.Unit{Text: "late", Key: "late"})
	assert.Equal(t, model.ContentSafetyFailureTimeout, review.failure)
	assert.Equal(t, "the review time had run out before the call", review.detail)
	assert.Zero(t, calls.Load())
}

// A controversial or refused verdict is asked again of the escalation model
// with the llm_json engine, and the second verdict decides; the log names the
// escalation model when it did. A failed escalation keeps the first verdict.
func TestContentSafetyEscalation(t *testing.T) {
	refusal := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"Content Exists Risk","type":"invalid_request_error"}}`))
	}
	serverError := func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) }
	guardControversial := reviewerReply("Safety: Controversial\nCategories: Violent")
	for _, tc := range []struct {
		name                string
		engine              string
		first, escalation   http.HandlerFunc
		wantCode            types.ErrorCode
		wantDecision        string
		wantCategory        string
		wantFailure         string
		wantEscalated       string
		wantEscalationCalls int
		// wantRiskDelta is what the final verdict adds to the account's score.
		wantRiskDelta int
		wantDetail    []string
	}{
		{name: "an unsafe second verdict replaces a controversial one", engine: operation_setting.ContentReviewEngineQwen3Guard, first: guardControversial, escalation: reviewerReply(unsafeReply),
			wantCode: types.ErrorCodeContentReviewRejected, wantDecision: model.ContentSafetyDecisionReviewRejected, wantCategory: "weapons", wantEscalated: "escalate-model", wantEscalationCalls: 1, wantRiskDelta: 40},
		{name: "a safe second verdict clears a controversial one", first: reviewerReply(controversialReply), escalation: reviewerReply(safeReply),
			wantDecision: model.ContentSafetyDecisionReviewPassed, wantEscalated: "escalate-model", wantEscalationCalls: 1},
		{name: "a refused review is escalated", first: refusal, escalation: reviewerReply(unsafeReply),
			wantCode: types.ErrorCodeContentReviewRejected, wantDecision: model.ContentSafetyDecisionReviewRejected, wantCategory: "weapons", wantEscalated: "escalate-model", wantEscalationCalls: 1, wantRiskDelta: 40},
		{name: "a failed escalation keeps the controversial verdict", engine: operation_setting.ContentReviewEngineQwen3Guard, first: guardControversial, escalation: serverError,
			wantDecision: model.ContentSafetyDecisionReviewControversial, wantCategory: "weapons", wantEscalationCalls: 2, wantRiskDelta: 5,
			wantDetail: []string{"escalation to escalate-model kept the first verdict: upstream_error", "HTTP 500"}},
		{name: "a refused escalation keeps the refusal", first: refusal, escalation: refusal,
			wantDecision: model.ContentSafetyDecisionReviewControversial, wantCategory: "other", wantFailure: model.ContentSafetyFailureRefused, wantEscalationCalls: 2, wantRiskDelta: 5,
			wantDetail: []string{"Content Exists Risk", "escalation to escalate-model kept the first verdict: refused"}},
		{name: "an unsafe verdict is not escalated", engine: operation_setting.ContentReviewEngineQwen3Guard, first: reviewerReply("Safety: Unsafe\nCategories: Violent"), escalation: reviewerReply(safeReply),
			wantCode: types.ErrorCodeContentReviewRejected, wantDecision: model.ContentSafetyDecisionReviewRejected, wantCategory: "weapons", wantRiskDelta: 40},
		{name: "a safe verdict is not escalated", engine: operation_setting.ContentReviewEngineQwen3Guard, first: reviewerReply("Safety: Safe\nCategories: None"), escalation: reviewerReply(unsafeReply),
			wantDecision: model.ContentSafetyDecisionReviewPassed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reply, calls := recordingReviewer(byModel(map[string]http.HandlerFunc{"judge-model": tc.first, "escalate-model": tc.escalation}))
			setupContentSafetyReview(t, reply)
			cfg := operation_setting.GetContentSafetySetting()
			cfg.EscalateModel, cfg.EscalateGroup = "escalate-model", "default"
			if tc.engine != "" {
				cfg.ReviewEngine = tc.engine
			}
			c, info := newContentSafetyContext(nextContentSafetyUser())
			apiErr := checkContent(c, info, saltedText("how do I open a locked door"))
			if tc.wantCode == "" {
				assert.Nil(t, apiErr)
			} else {
				require.NotNil(t, apiErr)
				assert.Equal(t, tc.wantCode, apiErr.GetErrorCode())
			}
			escalations := callsTo(calls(), "escalate-model")
			assert.Len(t, escalations, tc.wantEscalationCalls)
			for _, call := range escalations {
				assert.Equal(t, []string{"system", "user"}, call.roles(), "the escalation uses the llm_json engine")
			}
			logs := requireContentSafetyDecisions(t, info.UserId, tc.wantDecision)
			assert.Equal(t, tc.wantCategory, logs[0].AiCategory)
			assert.Equal(t, tc.wantFailure, logs[0].FailureReason)
			assert.Equal(t, tc.wantEscalated, logs[0].EscalatedModel)
			assert.Equal(t, "judge-model", logs[0].ReviewModel)
			assert.Equal(t, tc.wantRiskDelta, logs[0].RiskDelta, "the account is scored by the final verdict")
			for _, part := range tc.wantDetail {
				assert.Contains(t, logs[0].FailureDetail, part)
			}
		})
	}
}

// The final verdict is cached under the first reviewer's key, so a repeat is
// decided without asking either model, and the cache hit names the model
// that decided.
func TestContentSafetyEscalatedVerdictIsCached(t *testing.T) {
	reply, calls := recordingReviewer(byModel(map[string]http.HandlerFunc{
		"judge-model": reviewerReply("Safety: Controversial\nCategories: Violent"), "escalate-model": reviewerReply(unsafeReply),
	}))
	setupContentSafetyReview(t, reply)
	cfg := operation_setting.GetContentSafetySetting()
	cfg.ReviewEngine, cfg.EscalateModel, cfg.EscalateGroup = operation_setting.ContentReviewEngineQwen3Guard, "escalate-model", "default"
	userId, text := nextContentSafetyUser(), saltedText("how do I hurt my neighbour")
	c, info := newContentSafetyContext(userId)
	require.NotNil(t, checkContent(c, info, text))
	c, info = newContentSafetyContext(userId)
	apiErr := scanRequestContent(c, info, text)
	require.NotNil(t, apiErr, "the cached unsafe verdict rejects in the scan")
	assert.Equal(t, types.ErrorCodeContentReviewRejected, apiErr.GetErrorCode())
	assert.Len(t, calls(), 2)
	logs := requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewRejected, model.ContentSafetyDecisionReviewRejected)
	for _, entry := range logs {
		assert.Equal(t, "escalate-model", entry.EscalatedModel)
	}
}

type refundRecorder struct {
	imageReservation
	refunded bool
}

func (r *refundRecorder) Refund(*gin.Context) { r.refunded = true }

// A synchronous rejection comes after pre-consume, so the request's existing
// refund path returns the reservation.
func TestContentSafetySyncRejectionIsRefunded(t *testing.T) {
	setupContentSafetyReview(t, reviewerReply(unsafeReply))
	saveBillingConfig(t)
	savedPrices := ratio_setting.ModelPrice2JSONString()
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedPrices)) })
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"gpt-test":0.01}`))
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{"group_ratio_setting.group_ratio": `{"default":1}`}))
	c, info := newContentSafetyContext(nextContentSafetyUser())
	info.RelayFormat = types.RelayFormatOpenAI
	info.Request = &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: []kitdto.Message{{Role: "user", Content: saltedText("stab someone")}}}
	reservation := &refundRecorder{imageReservation: imageReservation{limit: 1 << 30}}
	info.Billing = reservation

	require.Nil(t, PrepareRequestBilling(c, info))
	assert.Equal(t, 5000, reservation.held, "the review waits holding the reservation")
	apiErr := EnforceContentSafety(c, info)
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodeContentReviewRejected, apiErr.GetErrorCode())
	RefundFailedRequestBilling(c, info, apiErr)
	assert.True(t, reservation.refunded)
	requireContentSafetyDecisions(t, info.UserId, model.ContentSafetyDecisionReviewRejected)
}

// The synchronous review limit counts new units, not requests.
func TestContentSafetyReviewRateLimitFailsClosed(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(safeReply))
	operation_setting.GetContentSafetySetting().ReviewRateLimitPerMinute = 2
	userId := nextContentSafetyUser()
	c, info := newContentSafetyContext(userId)
	require.Nil(t, checkContent(c, info, saltedText("first knife text")))
	c, info = newContentSafetyContext(userId)
	info.Request = &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: []kitdto.Message{
		{Role: "user", Content: saltedText("second knife text")}, {Role: "assistant", Content: saltedText("an answer")},
	}}
	apiErr := checkContent(c, info, "")
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
	assert.Contains(t, logs[0].FailureDetail, "no verdict within the 1s review timeout")

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

// Text a model reads in Claude blocks other than the known ones, in Gemini
// inline text data and in Gemini response schemas is reviewed too. Images and
// thinking are not text, and tool results follow the tool-results switch.
func TestContentSafetyReviewReadsTextOutsideKnownBlocks(t *testing.T) {
	const image = "aW1hZ2UgYnl0ZXM="
	claude := &kitdto.ClaudeRequest{Model: "gpt-test", Messages: []kitdto.ClaudeMessage{
		{Role: "user", Content: "search for it"},
		{Role: "assistant", Content: []any{
			map[string]any{"type": "thinking", "thinking": "a hidden thought", "signature": "sig"},
			map[string]any{"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": map[string]any{"query": "server tool query"}},
			map[string]any{"type": "web_search_tool_result", "tool_use_id": "srvtoolu_1", "content": []any{map[string]any{"type": "web_search_result", "title": "search result title", "url": "https://example.com"}}},
			map[string]any{"type": "mcp_tool_use", "id": "mcptoolu_1", "name": "lookup", "server_name": "notes", "input": map[string]any{"q": "mcp tool query"}},
		}},
		{Role: "user", Content: []any{
			map[string]any{"type": "mcp_tool_result", "tool_use_id": "mcptoolu_1", "content": []any{map[string]any{"type": "text", "text": "mcp tool output"}}},
			map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": "image/png", "data": image}},
			map[string]any{"type": "text", "text": "thanks"},
		}},
	}}
	attachment := base64.StdEncoding.EncodeToString([]byte("tool attachment"))
	gemini := &kitdto.GeminiChatRequest{
		Contents: []kitdto.GeminiChatContent{
			{Role: "user", Parts: []kitdto.GeminiPart{
				{Text: "summarize"},
				{InlineData: &kitdto.GeminiInlineData{MimeType: "text/plain", Data: base64.StdEncoding.EncodeToString([]byte("attached note"))}},
				{InlineData: &kitdto.GeminiInlineData{MimeType: "image/png", Data: image}},
			}},
			{Role: "user", Parts: []kitdto.GeminiPart{{FunctionResponse: &kitdto.GeminiFunctionResponse{Name: "lookup", Response: map[string]any{"ok": true},
				Parts: common.RawMessage(`[{"inlineData":{"mimeType":"text/markdown","data":"` + attachment + `"}}]`)}}}},
		},
		GenerationConfig: kitdto.GeminiChatGenerationConfig{
			ResponseSchema:     map[string]any{"type": "object", "properties": map[string]any{"verdict_field": map[string]any{"type": "string"}}},
			ResponseJsonSchema: common.RawMessage(`{"description":"json schema text"}`),
		},
	}
	for _, tc := range []struct {
		name        string
		request     kitdto.Request
		toolResults bool
		wantRead    []string
		wantUnread  []string
	}{
		{name: "Claude with tool results", request: claude, toolResults: true,
			wantRead:   []string{"server tool query", "web_search", "search result title", "mcp tool query", "mcp tool output", "thanks"},
			wantUnread: []string{"a hidden thought", image}},
		{name: "Claude without tool results", request: claude,
			wantRead:   []string{"server tool query", "mcp tool query", "thanks"},
			wantUnread: []string{"search result title", "mcp tool output", "a hidden thought"}},
		{name: "Gemini", request: gemini, toolResults: true,
			wantRead:   []string{"attached note", "tool attachment", "verdict_field", "json schema text"},
			wantUnread: []string{image, attachment}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupContentSafetyReview(t, reviewerReply(safeReply))
			operation_setting.GetContentSafetySetting().ReviewToolResults = tc.toolResults
			c, info := newContentSafetyContext(nextContentSafetyUser())
			info.Request = tc.request
			require.Nil(t, scanRequestContent(c, info, ""))
			plan := reviewPlan(c)
			require.NotNil(t, plan)
			var read strings.Builder
			for _, unit := range plan.pending {
				read.WriteString(unit.Text)
				read.WriteByte('\n')
			}
			for _, text := range tc.wantRead {
				assert.Contains(t, read.String(), text)
			}
			for _, text := range tc.wantUnread {
				assert.NotContains(t, read.String(), text)
			}
		})
	}
}

// Embeddings and rerank produce no content, and indexing a corpus would cost
// a reviewer call per chunk, so the AI review skips them; the block list
// still checks them (see TestPrepareRequestBillingScansContentBeforePreConsume).
func TestContentSafetyReviewSkipsEmbeddingsAndRerank(t *testing.T) {
	text := kitdto.GeminiChatContent{Parts: []kitdto.GeminiPart{{Text: "a sentence to index"}}}
	for _, request := range []kitdto.Request{
		&kitdto.EmbeddingRequest{Model: "gpt-test", Input: "a sentence to index"},
		&kitdto.GeminiEmbeddingRequest{Content: text},
		&kitdto.GeminiBatchEmbeddingRequest{Requests: []*kitdto.GeminiEmbeddingRequest{{Content: text}}},
		&kitdto.RerankRequest{Model: "gpt-test", Query: "a query", Documents: []any{"a document"}},
	} {
		t.Run(fmt.Sprintf("%T", request), func(t *testing.T) {
			calls := setupContentSafetyReview(t, reviewerReply(safeReply))
			c, info := newContentSafetyContext(nextContentSafetyUser())
			info.Request = request
			require.Nil(t, checkContent(c, info, saltedText("a sentence to index")))
			assert.Nil(t, reviewPlan(c))
			assert.Zero(t, calls.Load())
			requireContentSafetyDecisions(t, info.UserId)
		})
	}
}

// A refusal is remembered as the controversial verdict it concludes as, so a
// refused message resent with its conversation is not asked about on every
// turn, and a synchronous review of a history of refused messages goes on.
func TestContentSafetyRefusalIsRememberedAsControversial(t *testing.T) {
	calls := setupContentSafetyReview(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"Content Exists Risk","type":"invalid_request_error"}}`))
	})
	userId, refused := nextContentSafetyUser(), saltedText("a text the reviewer will not read")
	for range 2 {
		c, info := newContentSafetyContext(userId)
		require.Nil(t, checkContent(c, info, refused))
	}
	assert.Equal(t, int32(2), calls.Load(), "only the first request asks, on both channel attempts")
	logs := requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewControversial, model.ContentSafetyDecisionReviewControversial)
	hits := slices.DeleteFunc(logs, func(entry *model.ContentSafetyLog) bool { return !entry.CacheHit })
	require.Len(t, hits, 1)
	assert.Equal(t, "other", hits[0].AiCategory)
	assert.Equal(t, refusedReason, hits[0].AiReason)
}

// One request reviews at most maxParallelUnitReviews units at a time, so it
// cannot take every synchronous slot of the node: while the first ones hang
// until the review timeout, the others never reach the reviewer.
func TestContentSafetySyncReviewBoundsTheUnitsReviewedAtOnce(t *testing.T) {
	release := make(chan struct{})
	calls := setupContentSafetyReview(t, func(w http.ResponseWriter, r *http.Request) {
		// The server notices a closed client connection only after the body
		// has been read, as a real upstream would. The reply's headers go out
		// at once and its body never comes, so every held call ends with the
		// review timeout while it reads the reply.
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		select {
		case <-r.Context().Done():
		case <-release:
		}
	})
	t.Cleanup(func() { close(release) })
	operation_setting.GetContentSafetySetting().ReviewTimeoutSeconds = 1
	messages := make([]kitdto.Message, maxParallelUnitReviews+2)
	for i := range messages {
		messages[i] = kitdto.Message{Role: []string{"user", "assistant"}[i%2], Content: saltedText("turn " + strconv.Itoa(i))}
	}
	c, info := newContentSafetyContext(nextContentSafetyUser())
	info.Request = &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: messages}
	apiErr := checkContent(c, info, "")
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodeContentReviewUnavailable, apiErr.GetErrorCode())
	assert.Equal(t, int32(maxParallelUnitReviews), calls.Load())
	logs := requireContentSafetyDecisions(t, info.UserId, model.ContentSafetyDecisionReviewFailed)
	assert.Equal(t, model.ContentSafetyFailureTimeout, logs[0].FailureReason)
}

// One account cannot fill the background queue of a node: over its share,
// the request is recorded as over its quota and the account's next requests
// are reviewed first.
func TestContentSafetyBackgroundQueueCapsOneAccount(t *testing.T) {
	reply, release := gatedReviewer(t, safeReply)
	setupContentSafetyReview(t, reply)
	reviewInTheBackground(operation_setting.ContentReviewModeEnforce)
	userId := nextContentSafetyUser()
	for range contentsafety.MaxQueuedReviewsPerAccount {
		c, info := newContentSafetyContext(userId)
		require.Nil(t, checkContent(c, info, saltedText("a queued question")))
	}
	c, info := newContentSafetyContext(userId)
	require.Nil(t, checkContent(c, info, saltedText("one question too many")), "the request still goes on")
	c, info = newContentSafetyContext(userId)
	require.Nil(t, scanRequestContent(c, info, saltedText("the next question")))
	assert.Equal(t, model.ContentSafetyModeSync, reviewPlan(c).mode, "the account's next request is reviewed first")
	release()
	require.Eventually(t, func() bool {
		var count int64
		err := model.LOG_DB.Model(&model.ContentSafetyLog{}).Where("user_id = ?", userId).Count(&count).Error
		return err == nil && count == contentsafety.MaxQueuedReviewsPerAccount+1
	}, 5*time.Second, 20*time.Millisecond, "every queued review records its pass")
	var failed model.ContentSafetyLog
	require.NoError(t, model.LOG_DB.Where("user_id = ? AND decision = ?", userId, model.ContentSafetyDecisionReviewFailed).First(&failed).Error)
	assert.Equal(t, model.ContentSafetyFailureRateLimited, failed.FailureReason)
	assert.Equal(t, fmt.Sprintf("the account already has %d background reviews queued", contentsafety.MaxQueuedReviewsPerAccount), failed.FailureDetail)
}

// A pass kept at percent stands for 100/percent passes on average, so the
// weights of the sampled passes sum to the true count however percent
// divides 100.
func TestSampledPassWeightIsUnbiased(t *testing.T) {
	for _, tc := range []struct{ percent, floor int }{{100, 1}, {10, 10}, {30, 3}, {7, 14}, {67, 1}} {
		total := 0
		for roll := range tc.percent {
			weight := sampledPassWeight(tc.percent, roll)
			assert.Contains(t, []int{tc.floor, tc.floor + 1}, weight, "percent %d", tc.percent)
			total += weight
		}
		assert.Equal(t, 100, total, "percent %d", tc.percent)
	}
}

// A background review runs with the reviewer settings its request was
// planned with: the cache keys were made for that model and prompt.
func TestContentSafetyBackgroundReviewUsesThePlannedConfiguration(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(unsafeReply))
	reviewInTheBackground(operation_setting.ContentReviewModeShadow)
	c, info := newContentSafetyContext(nextContentSafetyUser())
	require.Nil(t, scanRequestContent(c, info, saltedText("stab someone")))
	cfg := operation_setting.GetContentSafetySetting()
	cfg.ReviewModel, cfg.ReviewGroup, cfg.ReviewPrompt, cfg.CacheTTLSeconds = "missing-model", "missing-group", "another prompt", 0
	require.Nil(t, EnforceContentSafety(c, info))
	logs := requireContentSafetyDecisions(t, info.UserId, model.ContentSafetyDecisionReviewFlagged)
	assert.Equal(t, "judge-model", logs[0].ReviewModel)
	assert.Equal(t, int32(1), calls.Load())
}

// The verdict cache is read for the newest contentsafety.MaxRequestUnits
// units. Older text goes unread: a background review records it and, when
// enforced, reviews the account's next requests first.
func TestContentSafetyHistoryBeyondTheUnitCapGoesUnread(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(safeReply))
	reviewInTheBackground(operation_setting.ContentReviewModeEnforce)
	operation_setting.GetContentSafetySetting().MaxUnits = 100
	messages := make([]kitdto.Message, contentsafety.MaxRequestUnits)
	for i := range messages {
		messages[i] = kitdto.Message{Role: []string{"user", "assistant"}[i%2], Content: saltedText("turn " + strconv.Itoa(i))}
	}
	userId := nextContentSafetyUser()
	// Judge the whole history safe, max_units at a time.
	for range contentsafety.MaxRequestUnits/100 + 1 {
		c, info := newContentSafetyContext(userId)
		info.Request = &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: messages}
		require.Nil(t, scanRequestContent(c, info, ""))
		plan := reviewPlan(c)
		if plan == nil {
			break
		}
		reviews := make([]unitReview, len(plan.pending))
		for i, unit := range plan.pending {
			reviews[i] = unitReview{unit: unit, verdict: contentsafety.Verdict{Level: contentsafety.LevelSafe}}
		}
		storeVerdicts(reviews, 60)
	}

	c, info := newContentSafetyContext(userId)
	info.Request = &kitdto.GeneralOpenAIRequest{Model: "gpt-test", Messages: append([]kitdto.Message{{Role: "assistant", Content: saltedText("an older answer")}}, messages...)}
	require.Nil(t, checkContent(c, info, ""))
	assert.Zero(t, calls.Load())
	logs := requireContentSafetyDecisions(t, userId, model.ContentSafetyDecisionReviewFailed)
	assert.Equal(t, model.ContentSafetyFailureTooManyUnits, logs[0].FailureReason)
	assert.Equal(t, model.ContentSafetyModeAsync, logs[0].Mode)
	assert.True(t, logs[0].Truncated)
	assert.Equal(t, 1, logs[0].UnitCount)
	assert.True(t, contentsafety.SyncForced(context.Background(), userId))
}
