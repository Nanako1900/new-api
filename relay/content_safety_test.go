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
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/contentsafety"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
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
		logs, _, err = model.GetContentSafetyLogs(model.ContentSafetyLogFilter{UserId: userId}, 0, 10)
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

func TestTaskRequestTextReadsJSONAndMultipartBodies(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{"prompt":"a knife","seconds":"4"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	text, err := taskRequestText(c)
	require.NoError(t, err)
	assert.Equal(t, "a knife\n4\n", text)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("size", "720x1280"))
	require.NoError(t, writer.WriteField("prompt", "a knife"))
	require.NoError(t, writer.Close())
	c, _ = gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", &body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	text, err = taskRequestText(c)
	require.NoError(t, err)
	assert.Equal(t, "a knife\n720x1280\n", text, "form values are read in sorted field order")
}
