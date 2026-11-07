package controller

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	passwordResetInvalidMessage = "This password reset link is invalid or has expired. Request a new one."
	passwordResetPolicyMessage  = "Password must contain between 8 and 128 characters."
	passwordResetStartPath      = "/api/user/password-reset/start"
	passwordResetVerifyPath     = "/api/user/password-reset/verify"
	passwordResetCompletePath   = "/api/user/password-reset/complete"
	passwordResetServerAddress  = "https://console.example.com"
	passwordResetOldPassword    = "old-account-password"
	passwordResetNewPassword    = "chosen-new-password"
	// Background mail is awaited by polling the mailbox, never by sleeping.
	passwordResetMailWait = 10 * time.Second
	// A request that must not produce mail is watched for this long after the
	// mail of a later request arrived.
	passwordResetNoMailWindow = 500 * time.Millisecond
)

var passwordResetLinkPattern = regexp.MustCompile(`https://console\.example\.com/user/reset\?token=([A-Za-z0-9_-]+)`)

// setupPasswordResetTest runs on the database selected by
// TEST_SECURITY_DIALECT and delivers mail to a local SMTP listener.
func setupPasswordResetTest(t *testing.T) *securityMailbox {
	t.Helper()
	setupSecurityEnrollmentTest(t)
	isolateEmailAddressLimits()
	configureEmailDelivery(t, map[string]string{"EmailProvider": "smtp"})
	mailbox := newSecurityMailbox(t)
	previousAddress := system_setting.ServerAddress
	system_setting.ServerAddress = passwordResetServerAddress
	t.Cleanup(func() { system_setting.ServerAddress = previousAddress })
	return mailbox
}

func createPasswordResetUser(t *testing.T, username, email string) *model.User {
	t.Helper()
	hash, err := common.HashAccountPassword(passwordResetOldPassword)
	require.NoError(t, err)
	user := &model.User{Username: username, Password: hash, Email: email, Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: username}
	require.NoError(t, model.DB.Create(user).Error)
	return user
}

// passwordResetCall serves the handler under its real route, as the browser
// would call it from a page shown in acceptLanguage.
func passwordResetCall(t *testing.T, path string, body any, handler gin.HandlerFunc, acceptLanguage string) (*httptest.ResponseRecorder, securityEnrollmentResponse) {
	t.Helper()
	payload, err := common.Marshal(body)
	require.NoError(t, err)
	engine := gin.New()
	engine.POST(path, handler)
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	if acceptLanguage != "" {
		request.Header.Set("Accept-Language", acceptLanguage)
	}
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	var reply securityEnrollmentResponse
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &reply), response.Body.String())
	return response, reply
}

func startPasswordReset(t *testing.T, email, acceptLanguage string) *httptest.ResponseRecorder {
	t.Helper()
	response, reply := passwordResetCall(t, passwordResetStartPath, map[string]string{"email": email}, PasswordResetStart, acceptLanguage)
	require.Equal(t, http.StatusOK, response.Code)
	require.True(t, reply.Success, response.Body.String())
	return response
}

func verifyPasswordReset(t *testing.T, token string) securityEnrollmentResponse {
	t.Helper()
	_, reply := passwordResetCall(t, passwordResetVerifyPath, map[string]string{"token": token}, PasswordResetVerify, "")
	return reply
}

func completePasswordReset(t *testing.T, token, password string) (*httptest.ResponseRecorder, securityEnrollmentResponse) {
	t.Helper()
	return passwordResetCall(t, passwordResetCompletePath, map[string]string{"token": token, "password": password}, PasswordResetComplete, "")
}

func mailedResetTokens(mailbox *securityMailbox, receiver string) []string {
	var tokens []string
	for _, mail := range registrationMail(mailbox, receiver) {
		if match := passwordResetLinkPattern.FindStringSubmatch(mail); match != nil {
			tokens = append(tokens, match[1])
		}
	}
	return tokens
}

func waitForResetTokens(t *testing.T, mailbox *securityMailbox, receiver string, count int) []string {
	t.Helper()
	require.Eventually(t, func() bool {
		return len(mailedResetTokens(mailbox, receiver)) >= count
	}, passwordResetMailWait, 10*time.Millisecond, "expected %d password reset links for %s", count, receiver)
	tokens := mailedResetTokens(mailbox, receiver)
	require.Len(t, tokens, count)
	return tokens
}

func encodedMailSubject(subject string) string {
	return "Subject: =?UTF-8?B?" + base64.StdEncoding.EncodeToString([]byte(subject)) + "?="
}

func countPasswordResetFlows(t *testing.T, consumed bool) int64 {
	t.Helper()
	query := model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", model.AuthFlowPurposePasswordReset)
	if consumed {
		query = query.Where("consumed_at IS NOT NULL")
	} else {
		query = query.Where("consumed_at IS NULL")
	}
	var count int64
	require.NoError(t, query.Count(&count).Error)
	return count
}

// OWASP Forgot Password Cheat Sheet / ASVS 5.0 V6.3.8: the response is the
// same whether or not an enabled account uses the address, and only that
// account receives a link. The link carries a random token and no address.
func TestPasswordResetStartDoesNotRevealAccounts(t *testing.T) {
	mailbox := setupPasswordResetTest(t)
	owner := createPasswordResetUser(t, "reset-owner", "Reset-Owner@Example.com")
	disabled := createPasswordResetUser(t, "reset-disabled", "reset-disabled@example.com")
	require.NoError(t, model.DB.Model(disabled).Update("status", common.UserStatusDisabled).Error)
	deleted := createPasswordResetUser(t, "reset-deleted", "reset-deleted@example.com")
	require.NoError(t, model.DB.Delete(deleted).Error)
	createPasswordResetUser(t, "reset-dup-1", "reset-dup@example.com")
	createPasswordResetUser(t, "reset-dup-2", "Reset-Dup@example.com")

	silent := []string{"reset-unknown@example.com", "reset-disabled@example.com", "reset-deleted@example.com", "reset-dup@example.com"}
	var bodies []string
	for _, address := range append(append([]string(nil), silent...), " Reset-Owner@Example.com ") {
		bodies = append(bodies, startPasswordReset(t, address, "").Body.String())
	}
	for index, body := range bodies {
		assert.Equal(t, bodies[0], body, "response %d differs", index)
	}

	token := waitForResetTokens(t, mailbox, "reset-owner@example.com", 1)[0]
	mail := registrationMail(mailbox, "reset-owner@example.com")[0]
	assert.Contains(t, mail, `href="`+passwordResetServerAddress+`/user/reset?token=`+token+`"`)
	assert.NotContains(t, mail, "email=", "the link must not carry the address")
	assert.Contains(t, mail, encodedMailSubject(i18n.Translate("", i18n.MsgEmailPasswordResetSubject, map[string]any{"SystemName": common.SystemName})))
	assert.Never(t, func() bool {
		for _, address := range silent {
			if len(registrationMail(mailbox, address)) > 0 {
				return true
			}
		}
		return false
	}, passwordResetNoMailWindow, 20*time.Millisecond, "only the enabled account with a unique address receives mail")

	var flows []model.AuthFlow
	require.NoError(t, model.DB.Where("purpose = ?", model.AuthFlowPurposePasswordReset).Find(&flows).Error)
	require.Len(t, flows, 1)
	assert.Equal(t, owner.Id, flows[0].UserId)
	assert.NotEqual(t, token, flows[0].TokenHash, "only the token hash is stored")
	assert.NotContains(t, flows[0].Payload, token)
	assert.WithinDuration(t, time.Now().Add(model.PasswordResetTTL), flows[0].ExpiresAt, time.Minute)
}

func TestPasswordResetStartLimitsEachAddress(t *testing.T) {
	mailbox := setupPasswordResetTest(t)
	createPasswordResetUser(t, "limit-owner", "limit-owner@example.com")
	for _, address := range []string{"limit-owner@example.com", "limit-unknown@example.com"} {
		t.Run(address, func(t *testing.T) {
			startPasswordReset(t, address, "")
			response, reply := passwordResetCall(t, passwordResetStartPath, map[string]string{"email": strings.ToUpper(address)}, PasswordResetStart, "")
			assert.Equal(t, http.StatusTooManyRequests, response.Code)
			assert.False(t, reply.Success)
			assert.Equal(t, registrationResendWait, reply.MessageKey)
		})
	}
	waitForResetTokens(t, mailbox, "limit-owner@example.com", 1)
	assert.Never(t, func() bool {
		return len(registrationMail(mailbox, "limit-owner@example.com")) > 1 || len(registrationMail(mailbox, "limit-unknown@example.com")) > 0
	}, passwordResetNoMailWindow, 20*time.Millisecond, "a limited request must not send mail")

	for _, address := range []string{"", "not-an-email"} {
		_, reply := passwordResetCall(t, passwordResetStartPath, map[string]string{"email": address}, PasswordResetStart, "")
		assert.False(t, reply.Success)
		assert.Equal(t, "Invalid parameters", reply.MessageKey, address)
	}
}

func TestPasswordResetVerifyIsReadOnly(t *testing.T) {
	mailbox := setupPasswordResetTest(t)
	createPasswordResetUser(t, "verify-owner", "verify-owner@example.com")
	startPasswordReset(t, "verify-owner@example.com", "")
	token := waitForResetTokens(t, mailbox, "verify-owner@example.com", 1)[0]
	for range 2 {
		reply := verifyPasswordReset(t, token)
		require.True(t, reply.Success, reply.Message)
		var data struct {
			Email     string `json:"email"`
			ExpiresAt int64  `json:"expires_at"`
		}
		require.NoError(t, common.Unmarshal(reply.Data, &data))
		assert.Equal(t, "***@example.com", data.Email, "the page shows a masked address")
		assert.Greater(t, data.ExpiresAt, time.Now().Add(model.PasswordResetTTL-time.Minute).Unix())
	}
	assert.Equal(t, int64(1), countPasswordResetFlows(t, false), "verification does not consume the link")
	for _, garbage := range []string{"", "garbage-token", token + "x"} {
		reply := verifyPasswordReset(t, garbage)
		assert.False(t, reply.Success)
		assert.Equal(t, passwordResetInvalidMessage, reply.MessageKey, garbage)
	}
}

// OWASP Forgot Password Cheat Sheet: the user chooses the new password under
// the normal policy, every session ends, every outstanding link dies, the user
// is notified and is not signed in.
func TestPasswordResetCompleteChangesPasswordAndEndsSessions(t *testing.T) {
	mailbox := setupPasswordResetTest(t)
	owner := createPasswordResetUser(t, "complete-owner", "complete-owner@example.com")
	bundle, err := service.CreateLoginSession(owner.Id, "password", "127.0.0.1", "reset-test")
	require.NoError(t, err)
	identity, err := service.ParseAccessToken(bundle.AccessToken)
	require.NoError(t, err)
	startPasswordReset(t, "complete-owner@example.com", "")
	first := waitForResetTokens(t, mailbox, "complete-owner@example.com", 1)[0]
	require.NoError(t, service.SendPasswordResetLink("complete-owner@example.com", "", passwordResetServerAddress))
	second := waitForResetTokens(t, mailbox, "complete-owner@example.com", 2)[1]
	require.NotEqual(t, first, second)

	_, reply := completePasswordReset(t, first, "short")
	assert.False(t, reply.Success)
	assert.Equal(t, passwordResetPolicyMessage, reply.MessageKey)
	assert.Equal(t, int64(2), countPasswordResetFlows(t, false), "a rejected password leaves the link usable")

	response, reply := completePasswordReset(t, first, passwordResetNewPassword)
	require.True(t, reply.Success, response.Body.String())
	assert.NotContains(t, response.Body.String(), "access_token", "a reset never signs the user in")
	assert.Empty(t, response.Header().Values("Set-Cookie"))

	var stored model.User
	require.NoError(t, model.DB.First(&stored, owner.Id).Error)
	assert.True(t, common.ValidatePasswordAndHash(passwordResetNewPassword, stored.Password))
	assert.False(t, common.ValidatePasswordAndHash(passwordResetOldPassword, stored.Password))
	assert.Equal(t, owner.AuthVersion+1, stored.AuthVersion)
	_, _, err = service.ValidateLoginSession(identity)
	assert.Error(t, err, "existing sessions end")
	session, err := model.GetUserSessionBySID(identity.SessionID)
	require.NoError(t, err)
	assert.Equal(t, model.UserSessionStatusRevoked, session.Status)
	assert.Equal(t, "password_reset", session.RevokedReason)
	assert.Zero(t, countPasswordResetFlows(t, false), "every outstanding link of the account is consumed")

	for _, token := range []string{first, second} {
		_, reply := completePasswordReset(t, token, "another-new-password")
		assert.Equal(t, passwordResetInvalidMessage, reply.MessageKey, "links are single use")
		assert.Equal(t, passwordResetInvalidMessage, verifyPasswordReset(t, token).MessageKey)
	}
	require.NoError(t, model.DB.First(&stored, owner.Id).Error)
	assert.True(t, common.ValidatePasswordAndHash(passwordResetNewPassword, stored.Password))

	mails := registrationMail(mailbox, "complete-owner@example.com")
	require.Len(t, mails, 3)
	assert.Contains(t, mails[2], encodedMailSubject(i18n.Translate("", i18n.MsgEmailSecurityNoticeSubject, map[string]any{"SystemName": common.SystemName})))
	assert.Contains(t, mails[2], i18n.Translate("", i18n.MsgSecurityEventPasswordUpdated))
	assert.NotContains(t, mails[2], passwordResetNewPassword)

	var audits []model.AuditLog
	require.NoError(t, model.LOG_DB.Where("user_id = ?", owner.Id).Find(&audits).Error)
	encoded, err := common.Marshal(audits)
	require.NoError(t, err)
	assert.Contains(t, string(encoded), "user.password_change")
	assert.Contains(t, string(encoded), "password_reset")
	for _, secret := range []string{first, second, passwordResetNewPassword, passwordResetOldPassword} {
		assert.NotContains(t, string(encoded), secret)
	}
}

// Two outstanding links of one account used at the same moment change the
// password once; the other link is reported as used, not as a database error.
func TestPasswordResetConcurrentLinksChangeThePasswordOnce(t *testing.T) {
	mailbox := setupPasswordResetTest(t)
	owner := createPasswordResetUser(t, "race-owner", "race-owner@example.com")
	for range 2 {
		require.NoError(t, service.SendPasswordResetLink("race-owner@example.com", "", passwordResetServerAddress))
	}
	tokens := waitForResetTokens(t, mailbox, "race-owner@example.com", 2)
	start := make(chan struct{})
	bodies := make(chan string, len(tokens))
	for index, token := range tokens {
		go func() {
			<-start
			engine := gin.New()
			engine.POST(passwordResetCompletePath, PasswordResetComplete)
			body := fmt.Sprintf(`{"token":%q,"password":"%s-%d"}`, token, passwordResetNewPassword, index)
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, passwordResetCompletePath, strings.NewReader(body)))
			bodies <- response.Body.String()
		}()
	}
	close(start)
	succeeded := 0
	for range tokens {
		var reply securityEnrollmentResponse
		require.NoError(t, common.UnmarshalJsonStr(<-bodies, &reply))
		if reply.Success {
			succeeded++
			continue
		}
		assert.Equal(t, passwordResetInvalidMessage, reply.MessageKey)
	}
	assert.Equal(t, 1, succeeded)
	var stored model.User
	require.NoError(t, model.DB.First(&stored, owner.Id).Error)
	assert.Equal(t, owner.AuthVersion+1, stored.AuthVersion)
	assert.Zero(t, countPasswordResetFlows(t, false))
}

// A link only works for the account state it was sent for.
func TestPasswordResetRejectsExpiredLinksAndChangedAccounts(t *testing.T) {
	mailbox := setupPasswordResetTest(t)
	for index, test := range []struct {
		name   string
		change func(t *testing.T, user *model.User)
	}{
		{"expired", func(t *testing.T, user *model.User) {
			require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("user_id = ?", user.Id).Update("expires_at", time.Now().Add(-time.Second)).Error)
		}},
		{"email changed", func(t *testing.T, user *model.User) {
			require.NoError(t, model.DB.Model(user).Update("email", "moved-away@example.com").Error)
		}},
		{"account disabled", func(t *testing.T, user *model.User) {
			require.NoError(t, model.DB.Model(user).Update("status", common.UserStatusDisabled).Error)
		}},
		{"account deleted", func(t *testing.T, user *model.User) {
			require.NoError(t, model.DB.Delete(user).Error)
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			email := fmt.Sprintf("changed-%d@example.com", index)
			user := createPasswordResetUser(t, fmt.Sprintf("changed-%d", index), email)
			require.NoError(t, service.SendPasswordResetLink(email, "", passwordResetServerAddress))
			token := waitForResetTokens(t, mailbox, email, 1)[0]
			test.change(t, user)

			assert.Equal(t, passwordResetInvalidMessage, verifyPasswordReset(t, token).MessageKey)
			_, reply := completePasswordReset(t, token, passwordResetNewPassword)
			assert.False(t, reply.Success)
			assert.Equal(t, passwordResetInvalidMessage, reply.MessageKey)
			var stored model.User
			require.NoError(t, model.DB.Unscoped().First(&stored, user.Id).Error)
			assert.True(t, common.ValidatePasswordAndHash(passwordResetOldPassword, stored.Password))
			assert.Equal(t, user.AuthVersion, stored.AuthVersion)
		})
	}
}

// Mail sent from an anonymous page is written in the language of that page,
// which the web console states in Accept-Language. A language the account
// saved takes precedence for mail about that account.
func TestPasswordResetMailLanguage(t *testing.T) {
	mailbox := setupPasswordResetTest(t)
	systemName := map[string]any{"SystemName": common.SystemName}
	for index, test := range []struct {
		name           string
		saved          string
		acceptLanguage string
		want           string
	}{
		{"page in chinese", "", "zh-CN", "zh-CN"},
		{"page in english", "", "en", "en"},
		{"saved language wins", "en", "zh-CN", "en"},
	} {
		t.Run(test.name, func(t *testing.T) {
			email := fmt.Sprintf("language-%d@example.com", index)
			user := createPasswordResetUser(t, fmt.Sprintf("language-%d", index), email)
			if test.saved != "" {
				require.NoError(t, model.DB.Model(user).Update("setting", `{"language":"`+test.saved+`"}`).Error)
			}
			startPasswordReset(t, email, test.acceptLanguage)
			waitForResetTokens(t, mailbox, email, 1)
			mail := registrationMail(mailbox, email)[0]
			assert.Contains(t, mail, encodedMailSubject(i18n.Translate(test.want, i18n.MsgEmailPasswordResetSubject, systemName)))
			assert.Contains(t, mail, i18n.Translate(test.want, i18n.MsgEmailPasswordResetGreeting, systemName))
		})
	}
}

func TestRegistrationEmailFollowsPageLanguage(t *testing.T) {
	mailbox := setupRegistrationEmailTest(t)
	systemName := map[string]any{"SystemName": common.SystemName}
	for _, lang := range []string{"zh-CN", "en"} {
		t.Run(lang, func(t *testing.T) {
			email := "page-language-" + lang + "@example.com"
			response, reply := passwordResetCall(t, registrationStartPath, map[string]string{"email": email}, RegisterEmailStart, lang)
			require.True(t, reply.Success, response.Body.String())
			mails := registrationMail(mailbox, model.NormalizeEmail(email))
			require.Len(t, mails, 1)
			assert.Contains(t, mails[0], encodedMailSubject(i18n.Translate(lang, i18n.MsgEmailVerificationSubject, systemName)))
		})
	}
	require.NotEqual(t, i18n.Translate("zh-CN", i18n.MsgEmailVerificationSubject, systemName), i18n.Translate("en", i18n.MsgEmailVerificationSubject, systemName))
}
