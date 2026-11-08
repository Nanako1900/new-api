package relay

import (
	"bytes"
	"context"
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
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/contentsafety"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
// are exactly want. Records are written in the background, so a test that
// leaves without waiting races with its fixture restoring the log database.
func requireContentSafetyDecisions(t *testing.T, userId int, want ...string) {
	t.Helper()
	slices.Sort(want)
	require.Eventually(t, func() bool {
		logs, _, err := model.GetContentSafetyLogs(model.ContentSafetyLogFilter{UserId: userId}, 0, 10)
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
}

func TestContentSafetyGate(t *testing.T) {
	for i, tc := range []struct {
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
		{name: "a safe verdict releases", text: "cut bread with a knife", reply: reviewerReply(`{"results":[{"id":1,"safe":true}]}`), wantCalls: 1, wantDecision: model.ContentSafetyDecisionReviewPassed},
		{name: "an unsafe verdict rejects", text: "stab someone with a knife", reply: reviewerReply(`{"results":[{"id":1,"safe":false,"category":"violence","reason":"asks how to hurt a person"}]}`), wantCode: types.ErrorCodeContentReviewRejected, wantStatus: http.StatusBadRequest, wantCalls: 1, wantDecision: model.ContentSafetyDecisionReviewRejected},
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
			c, info := newContentSafetyContext(1000 + i)
			apiErr := checkContent(c, info, tc.text)
			assert.Equal(t, tc.wantCalls, calls.Load())
			if tc.wantCode == "" {
				assert.Nil(t, apiErr)
			} else {
				require.NotNil(t, apiErr)
				assert.Equal(t, tc.wantCode, apiErr.GetErrorCode())
				assert.Equal(t, tc.wantStatus, apiErr.StatusCode)
				assert.NotContains(t, apiErr.Error(), "knife", "clients never see the matched words")
				assert.NotContains(t, apiErr.Error(), "bomb", "clients never see the matched words")
			}
			if tc.wantDecision == "" {
				return
			}
			requireContentSafetyDecisions(t, info.UserId, tc.wantDecision)
		})
	}
}

func TestContentSafetyReviewCachesVerdictPerWindow(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(`{"results":[{"id":1,"safe":true}]}`))
	for range 2 {
		c, info := newContentSafetyContext(2001)
		require.Nil(t, checkContent(c, info, "sharpen the kitchen knife carefully"))
	}
	assert.Equal(t, int32(1), calls.Load(), "the second identical window is answered from the cache")
	requireContentSafetyDecisions(t, 2001, model.ContentSafetyDecisionReviewPassed)
}

func TestContentSafetyReviewRateLimitFailsClosed(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(`{"results":[{"id":1,"safe":true}]}`))
	operation_setting.GetContentSafetySetting().ReviewRateLimitPerMinute = 1
	c, info := newContentSafetyContext(3001)
	require.Nil(t, checkContent(c, info, "first knife text"))
	c, info = newContentSafetyContext(3001)
	apiErr := checkContent(c, info, "second knife text")
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodeContentReviewUnavailable, apiErr.GetErrorCode())
	assert.Equal(t, int32(1), calls.Load())
	requireContentSafetyDecisions(t, 3001, model.ContentSafetyDecisionReviewPassed, model.ContentSafetyDecisionReviewFailed)
}

func TestContentSafetyReviewTimeoutFailsClosed(t *testing.T) {
	release := make(chan struct{})
	calls := setupContentSafetyReview(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	})
	cfg := operation_setting.GetContentSafetySetting()
	cfg.ReviewTimeoutSeconds, cfg.ReviewMaxConcurrency = 1, 1
	t.Cleanup(func() {
		// The timed-out call keeps its only slot until it truly returns. Taking
		// the slot waits for it before the fixture restores the channel data.
		close(release)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		releaseSlot, err := contentsafety.AcquireSlot(ctx, 1)
		require.NoError(t, err)
		releaseSlot()
	})
	c, info := newContentSafetyContext(4001)
	apiErr := checkContent(c, info, "slow knife review")
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodeContentReviewUnavailable, apiErr.GetErrorCode())
	assert.Equal(t, int32(1), calls.Load())
	requireContentSafetyDecisions(t, 4001, model.ContentSafetyDecisionReviewFailed)
}

func TestEnforceContentSafetyTextReviewsASubmissionOnce(t *testing.T) {
	calls := setupContentSafetyReview(t, reviewerReply(`{"results":[{"id":1,"safe":true}]}`))
	c, info := newContentSafetyContext(5001)
	require.Nil(t, EnforceContentSafetyText(c, info, contentsafety.CollectJSONText([]byte(`{"prompt":"a knife on a table","seconds":"4"}`))))
	require.Nil(t, EnforceContentSafetyText(c, info, "a different knife prompt"), "a retry of the same submission is not reviewed again")
	assert.Equal(t, int32(1), calls.Load())
	assert.True(t, common.GetContextKeyBool(c, constant.ContextKeyContentSafetyChecked))
	requireContentSafetyDecisions(t, 5001, model.ContentSafetyDecisionReviewPassed)
}

func TestTaskRequestTextReadsJSONAndMultipartBodies(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{"prompt":"a knife","seconds":"4"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	text, err := taskRequestText(c)
	require.NoError(t, err)
	assert.Equal(t, "a knife\n4\n", text)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("prompt", "a knife"))
	require.NoError(t, writer.WriteField("size", "720x1280"))
	require.NoError(t, writer.Close())
	c, _ = gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", &body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	text, err = taskRequestText(c)
	require.NoError(t, err)
	assert.Contains(t, text, "a knife\n")
	assert.Contains(t, text, "720x1280\n")
}
