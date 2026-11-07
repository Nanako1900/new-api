package controller

import (
	"bytes"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	registrationInvalidMessage      = "Email verification expired or is invalid. Please verify your email again."
	registrationUnavailableMessage  = "Email delivery is not configured. Password registration is unavailable."
	registrationCodeIncorrect       = "Email verification code is incorrect."
	registrationTooManyCodes        = "Too many incorrect codes. Start email verification again."
	registrationDeliveryFailed      = "Verification email could not be sent. Start email verification again."
	registrationResendWait          = "Please wait before requesting another verification code."
	registrationUsernameTaken       = "Username already exists or has been deleted"
	registrationEmailAlreadyInUse   = "Email address is already in use"
	registrationUsernameContainsAt  = "Username cannot contain @"
	registrationStartPath           = "/api/user/register/email/start"
	registrationVerifyPath          = "/api/user/register/email/verify"
	registrationRegisterPath        = "/api/user/register"
	registrationTestPassword        = "registration-password"
	registrationVerifiedLifetimeMin = 29 * time.Minute
)

type registrationStartData struct {
	FlowToken string `json:"flow_token"`
	Email     string `json:"email"`
	ExpiresAt int64  `json:"expires_at"`
	ResendAt  int64  `json:"resend_at"`
}

// setupRegistrationEmailTest runs on the database selected by
// TEST_SECURITY_DIALECT and delivers mail to a local SMTP listener. The
// deprecated EmailVerificationEnabled option stays off to prove that password
// registration verifies the address regardless of it.
func setupRegistrationEmailTest(t *testing.T) *securityMailbox {
	t.Helper()
	setupSecurityEnrollmentTest(t)
	isolateEmailAddressLimits()
	require.NoError(t, model.DB.AutoMigrate(&model.Token{}))
	configureEmailDelivery(t, map[string]string{"EmailProvider": "smtp"})
	mailbox := newSecurityMailbox(t)
	previousRegister, previousPasswordRegister := common.RegisterEnabled, common.PasswordRegisterEnabled
	previousVerification, previousQuota := common.EmailVerificationEnabled, common.QuotaForNewUser
	previousDomain, previousAlias := common.EmailDomainRestrictionEnabled, common.EmailAliasRestrictionEnabled
	previousDefaultToken := constant.GenerateDefaultToken
	common.RegisterEnabled, common.PasswordRegisterEnabled = true, true
	common.EmailVerificationEnabled, common.QuotaForNewUser = false, 0
	common.EmailDomainRestrictionEnabled, common.EmailAliasRestrictionEnabled = false, false
	constant.GenerateDefaultToken = true
	t.Cleanup(func() {
		common.RegisterEnabled, common.PasswordRegisterEnabled = previousRegister, previousPasswordRegister
		common.EmailVerificationEnabled, common.QuotaForNewUser = previousVerification, previousQuota
		common.EmailDomainRestrictionEnabled, common.EmailAliasRestrictionEnabled = previousDomain, previousAlias
		constant.GenerateDefaultToken = previousDefaultToken
	})
	return mailbox
}

// isolateEmailAddressLimits gives the test a fresh per-address mail limit. The
// limiter lives for the whole test process and keys each address by an HMAC of
// the session secret, so a new secret keeps reruns (-count=N) and later tests
// from inheriting earlier tests' limits. setupSecurityEnrollmentTest restores
// the previous secret when the test ends.
func isolateEmailAddressLimits() {
	common.SessionSecret = "email-limit-test-" + common.GetRandomString(16)
}

// registrationRequest serves the handler under its real route so the login
// method derived from the route path is exercised as in production.
func registrationRequest(t *testing.T, path string, body any, handler gin.HandlerFunc) (*httptest.ResponseRecorder, securityEnrollmentResponse) {
	t.Helper()
	payload, err := common.Marshal(body)
	require.NoError(t, err)
	engine := gin.New()
	engine.POST(path, handler)
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	var reply securityEnrollmentResponse
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &reply), response.Body.String())
	return response, reply
}

func startRegistrationEmail(t *testing.T, email string) registrationStartData {
	t.Helper()
	response, reply := registrationRequest(t, registrationStartPath, map[string]string{"email": email}, RegisterEmailStart)
	require.Equal(t, http.StatusOK, response.Code)
	require.True(t, reply.Success, response.Body.String())
	var data registrationStartData
	require.NoError(t, common.Unmarshal(reply.Data, &data))
	require.NotEmpty(t, data.FlowToken)
	return data
}

func verifyRegistrationEmail(t *testing.T, flowToken, code string) securityEnrollmentResponse {
	t.Helper()
	_, reply := registrationRequest(t, registrationVerifyPath, map[string]string{"flow_token": flowToken, "code": code}, RegisterEmailVerify)
	return reply
}

func registerWithToken(t *testing.T, username, flowToken string) (*httptest.ResponseRecorder, securityEnrollmentResponse) {
	t.Helper()
	return registrationRequest(t, registrationRegisterPath, map[string]string{
		"username": username, "password": registrationTestPassword, "registration_token": flowToken,
	}, Register)
}

func registrationMail(mailbox *securityMailbox, receiver string) []string {
	mailbox.mutex.Lock()
	defer mailbox.mutex.Unlock()
	return append([]string(nil), mailbox.mail[receiver]...)
}

func countRegistrationFlows(t *testing.T, consumed bool) int64 {
	t.Helper()
	query := model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", model.AuthFlowPurposeEmailRegistration)
	if consumed {
		query = query.Where("consumed_at IS NOT NULL")
	} else {
		query = query.Where("consumed_at IS NULL")
	}
	var count int64
	require.NoError(t, query.Count(&count).Error)
	return count
}

// OWASP ASVS 5.0 V6.3: the start step must not reveal whether an address is
// registered. A free address receives a code, a taken (or soft-deleted) one
// receives a notice, and both get the same response shape.
func TestRegistrationEmailStartDoesNotRevealRegisteredAddresses(t *testing.T) {
	mailbox := setupRegistrationEmailTest(t)
	active := &model.User{Username: "taken-active", Password: "x", Email: "taken-active@example.com", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, AffCode: "reg1"}
	deleted := &model.User{Username: "taken-deleted", Password: "x", Email: "taken-deleted@example.com", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, AffCode: "reg2"}
	require.NoError(t, model.DB.Create(active).Error)
	require.NoError(t, model.DB.Create(deleted).Error)
	require.NoError(t, model.DB.Delete(deleted).Error)

	free := startRegistrationEmail(t, "  Free-Start@Example.com ")
	assert.Equal(t, "free-start@example.com", free.Email)
	code := mailbox.code(t, free.Email)
	for _, address := range []string{"Taken-Active@Example.com", "taken-deleted@example.com"} {
		t.Run(address, func(t *testing.T) {
			response, reply := registrationRequest(t, registrationStartPath, map[string]string{"email": address}, RegisterEmailStart)
			require.Equal(t, http.StatusOK, response.Code)
			require.True(t, reply.Success, response.Body.String())
			var fields, freeFields map[string]any
			require.NoError(t, common.Unmarshal(reply.Data, &fields))
			freePayload, err := common.Marshal(free)
			require.NoError(t, err)
			require.NoError(t, common.Unmarshal(freePayload, &freeFields))
			assert.ElementsMatch(t, mapKeys(freeFields), mapKeys(fields))
			var taken registrationStartData
			require.NoError(t, common.Unmarshal(reply.Data, &taken))
			assert.Equal(t, strings.ToLower(address), taken.Email)
			assert.InDelta(t, free.ExpiresAt, taken.ExpiresAt, 5)
			assert.InDelta(t, free.ResendAt, taken.ResendAt, 5)

			mails := registrationMail(mailbox, taken.Email)
			require.Len(t, mails, 1)
			assert.NotRegexp(t, `<strong>[0-9]{6}</strong>`, mails[0], "a registered address must never receive a usable code")
			assert.Contains(t, mails[0], i18n.Translate("", i18n.MsgEmailRegistrationNoticeAttempt, map[string]any{"SystemName": common.SystemName}))
			// Even the code sent to another address cannot verify this flow.
			assert.Equal(t, registrationCodeIncorrect, verifyRegistrationEmail(t, taken.FlowToken, code).MessageKey)
		})
	}
	reply := verifyRegistrationEmail(t, free.FlowToken, code)
	assert.True(t, reply.Success, reply.Message)
}

func mapKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return keys
}

func TestRegistrationEmailStartLimitsEachAddress(t *testing.T) {
	mailbox := setupRegistrationEmailTest(t)
	require.NoError(t, model.DB.Create(&model.User{Username: "cooldown-owner", Password: "x", Email: "cooldown-taken@example.com", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, AffCode: "reg3"}).Error)
	for _, address := range []string{"cooldown-free@example.com", "cooldown-taken@example.com"} {
		t.Run(address, func(t *testing.T) {
			startRegistrationEmail(t, address)
			response, reply := registrationRequest(t, registrationStartPath, map[string]string{"email": strings.ToUpper(address)}, RegisterEmailStart)
			assert.Equal(t, http.StatusTooManyRequests, response.Code)
			assert.False(t, reply.Success)
			assert.Equal(t, registrationResendWait, reply.MessageKey)
			assert.Len(t, registrationMail(mailbox, address), 1, "a limited request must not send mail")
		})
	}
	startRegistrationEmail(t, "cooldown-other@example.com")
}

func TestRegistrationEmailStartRequiresWorkingDelivery(t *testing.T) {
	t.Run("not configured", func(t *testing.T) {
		setupRegistrationEmailTest(t)
		common.SMTPServer = ""
		for _, request := range []struct {
			path    string
			body    map[string]string
			handler gin.HandlerFunc
		}{
			{registrationStartPath, map[string]string{"email": "unconfigured@example.com"}, RegisterEmailStart},
			{registrationRegisterPath, map[string]string{"username": "unconfigured", "password": registrationTestPassword, "registration_token": "token"}, Register},
		} {
			_, reply := registrationRequest(t, request.path, request.body, request.handler)
			assert.False(t, reply.Success)
			assert.Equal(t, registrationUnavailableMessage, reply.MessageKey, request.path)
		}
		assert.Zero(t, countRegistrationFlows(t, false)+countRegistrationFlows(t, true))
	})
	t.Run("delivery fails", func(t *testing.T) {
		setupRegistrationEmailTest(t)
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		require.NoError(t, err)
		common.SMTPPort = listener.Addr().(*net.TCPAddr).Port
		require.NoError(t, listener.Close())
		response, reply := registrationRequest(t, registrationStartPath, map[string]string{"email": "undeliverable@example.com"}, RegisterEmailStart)
		assert.False(t, reply.Success)
		assert.Equal(t, registrationDeliveryFailed, reply.MessageKey)
		assert.NotContains(t, response.Body.String(), "127.0.0.1", "transport details stay in the server log")
		assert.Zero(t, countRegistrationFlows(t, false), "a flow whose mail was not delivered must not stay usable")
		assert.Equal(t, int64(1), countRegistrationFlows(t, true))
	})
}

func TestRegistrationEmailVerifyLimitsAttempts(t *testing.T) {
	mailbox := setupRegistrationEmailTest(t)
	flow := startRegistrationEmail(t, "attempts@example.com")
	code := mailbox.code(t, flow.Email)
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	for attempt := 1; attempt <= model.EmailRegistrationMaxAttempts; attempt++ {
		reply := verifyRegistrationEmail(t, flow.FlowToken, wrong)
		assert.False(t, reply.Success)
		if attempt < model.EmailRegistrationMaxAttempts {
			assert.Equal(t, registrationCodeIncorrect, reply.MessageKey, "attempt %d", attempt)
		} else {
			assert.Equal(t, registrationTooManyCodes, reply.MessageKey, "attempt %d", attempt)
		}
	}
	var stored model.AuthFlow
	require.NoError(t, model.DB.Where("purpose = ?", model.AuthFlowPurposeEmailRegistration).First(&stored).Error)
	var state model.EmailRegistrationState
	require.NoError(t, common.UnmarshalJsonStr(stored.Payload, &state))
	assert.Equal(t, model.EmailRegistrationMaxAttempts, state.FailedAttempts, "failed attempts are committed even though verification fails")
	assert.NotContains(t, stored.Payload, code, "only the code hash is stored")
	assert.Equal(t, registrationTooManyCodes, verifyRegistrationEmail(t, flow.FlowToken, code).MessageKey, "the correct code no longer works once locked")
	_, reply := registerWithToken(t, "attempts-user", flow.FlowToken)
	assert.Equal(t, registrationInvalidMessage, reply.MessageKey)
}

func TestRegistrationEmailVerifyIsSingleUseAndExpires(t *testing.T) {
	mailbox := setupRegistrationEmailTest(t)
	t.Run("single use", func(t *testing.T) {
		flow := startRegistrationEmail(t, "single-use@example.com")
		code := mailbox.code(t, flow.Email)
		reply := verifyRegistrationEmail(t, flow.FlowToken, code)
		require.True(t, reply.Success, reply.Message)
		var verified struct {
			Email     string `json:"email"`
			ExpiresAt int64  `json:"expires_at"`
		}
		require.NoError(t, common.Unmarshal(reply.Data, &verified))
		assert.Equal(t, flow.Email, verified.Email)
		assert.Greater(t, verified.ExpiresAt, time.Now().Add(registrationVerifiedLifetimeMin).Unix(), "verification extends the flow for the password step")
		assert.Equal(t, registrationInvalidMessage, verifyRegistrationEmail(t, flow.FlowToken, code).MessageKey)
	})
	t.Run("expired", func(t *testing.T) {
		flow := startRegistrationEmail(t, "expired@example.com")
		code := mailbox.code(t, flow.Email)
		require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ? AND consumed_at IS NULL", model.AuthFlowPurposeEmailRegistration).
			Update("expires_at", time.Now().Add(-time.Second)).Error)
		assert.Equal(t, registrationInvalidMessage, verifyRegistrationEmail(t, flow.FlowToken, code).MessageKey)
	})
	t.Run("unknown token", func(t *testing.T) {
		assert.Equal(t, registrationInvalidMessage, verifyRegistrationEmail(t, "unknown-flow-token", "123456").MessageKey)
	})
}

func TestRegistrationRegisterSignsInAndConsumesVerifiedEmail(t *testing.T) {
	mailbox := setupRegistrationEmailTest(t)
	flow := startRegistrationEmail(t, "New-Member@Example.com")
	code := mailbox.code(t, flow.Email)

	_, reply := registerWithToken(t, "new-member", flow.FlowToken)
	assert.Equal(t, registrationInvalidMessage, reply.MessageKey, "an unverified flow cannot register")
	_, reply = registerWithToken(t, "new-member", "")
	assert.Equal(t, registrationInvalidMessage, reply.MessageKey)
	require.True(t, verifyRegistrationEmail(t, flow.FlowToken, code).Success)
	inviter := &model.User{Username: "inviter", Password: "x", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, AffCode: "invt"}
	require.NoError(t, model.DB.Create(inviter).Error)

	response, reply := registrationRequest(t, registrationRegisterPath, map[string]string{
		"username": "new-member", "password": registrationTestPassword, "registration_token": flow.FlowToken, "aff_code": "invt",
	}, Register)
	require.True(t, reply.Success, response.Body.String())
	assert.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	var login struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		Session     struct {
			LoginMethod string `json:"login_method"`
		} `json:"session"`
		User struct {
			Username string `json:"username"`
			Email    string `json:"email"`
		} `json:"user"`
	}
	require.NoError(t, common.Unmarshal(reply.Data, &login))
	assert.NotEmpty(t, login.AccessToken)
	assert.NotEmpty(t, login.TokenType)
	assert.Equal(t, "password", login.Session.LoginMethod)
	assert.Equal(t, "new-member", login.User.Username)
	assert.Equal(t, "new-member@example.com", login.User.Email)

	var user model.User
	require.NoError(t, model.DB.Where("username = ?", "new-member").First(&user).Error)
	assert.Equal(t, "new-member@example.com", user.Email)
	assert.Equal(t, common.RoleCommonUser, user.Role)
	assert.Equal(t, "new-member", user.DisplayName)
	assert.Equal(t, inviter.Id, user.InviterId, "the inviter from the affiliate code is recorded")
	assert.True(t, common.ValidatePasswordAndHash(registrationTestPassword, user.Password))
	var tokens int64
	require.NoError(t, model.DB.Model(&model.Token{}).Where("user_id = ?", user.Id).Count(&tokens).Error)
	assert.Equal(t, int64(1), tokens, "the default token is created with the account")
	assert.Equal(t, int64(1), countRegistrationFlows(t, true))

	_, reply = registerWithToken(t, "replayed-member", flow.FlowToken)
	assert.Equal(t, registrationInvalidMessage, reply.MessageKey, "a registration token is single use")
	var replayed int64
	require.NoError(t, model.DB.Model(&model.User{}).Where("username = ?", "replayed-member").Count(&replayed).Error)
	assert.Zero(t, replayed)

	var audits []model.AuditLog
	require.NoError(t, model.LOG_DB.Find(&audits).Error)
	encoded, err := common.Marshal(audits)
	require.NoError(t, err)
	assert.Contains(t, string(encoded), "Logged in successfully via password")
	assert.NotContains(t, string(encoded), flow.FlowToken)
	assert.NotContains(t, string(encoded), registrationTestPassword)
	assert.NotRegexp(t, `(^|\D)`+code+`(\D|$)`, string(encoded))
}

// The register route has no captcha of its own, so it must not reveal whether a
// username exists to a caller without a verified registration token
// (OWASP ASVS 5.0 V6.3.8).
func TestRegistrationRegisterChecksTokenBeforeUsername(t *testing.T) {
	setupRegistrationEmailTest(t)
	unverified := startRegistrationEmail(t, "unverified@example.com")
	for _, username := range []string{"enrollment-user", "unknown-member"} {
		for _, token := range []string{"", "bogus-token", unverified.FlowToken} {
			_, reply := registerWithToken(t, username, token)
			assert.Equal(t, registrationInvalidMessage, reply.MessageKey, "username %q with token %q", username, token)
		}
	}
}

func TestRegistrationRegisterRejectsInvalidAccounts(t *testing.T) {
	mailbox := setupRegistrationEmailTest(t)
	flow := startRegistrationEmail(t, "rejected@example.com")
	require.True(t, verifyRegistrationEmail(t, flow.FlowToken, mailbox.code(t, flow.Email)).Success)
	for _, test := range []struct {
		username string
		message  string
	}{
		{"user@name", registrationUsernameContainsAt},
		{"enrollment-user", registrationUsernameTaken},
	} {
		_, reply := registerWithToken(t, test.username, flow.FlowToken)
		assert.False(t, reply.Success)
		assert.Equal(t, test.message, reply.MessageKey, test.username)
	}
	assert.Zero(t, countRegistrationFlows(t, true), "rejected requests leave the verified flow usable")

	// Another account claims the address after verification.
	require.NoError(t, model.DB.Create(&model.User{Username: "address-claimer", Password: "x", Email: "rejected@example.com", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, AffCode: "reg4"}).Error)
	_, reply := registerWithToken(t, "late-member", flow.FlowToken)
	assert.False(t, reply.Success)
	assert.Equal(t, registrationEmailAlreadyInUse, reply.MessageKey)
	var created int64
	require.NoError(t, model.DB.Model(&model.User{}).Where("username = ?", "late-member").Count(&created).Error)
	assert.Zero(t, created)
}

func TestRegistrationStatusReportsEmailDelivery(t *testing.T) {
	for _, test := range []struct {
		name       string
		options    map[string]string
		server     string
		from       string
		account    string
		configured bool
	}{
		{"smtp with sender", map[string]string{"EmailProvider": "smtp"}, "smtp.example.com", "sender@example.com", "", true},
		{"legacy smtp account as sender", map[string]string{}, "smtp.example.com", "", "account@example.com", true},
		{"smtp without server", map[string]string{"EmailProvider": "smtp"}, "", "sender@example.com", "", false},
		{"smtp without sender address", map[string]string{"EmailProvider": "smtp"}, "smtp.example.com", "", "account", false},
		{"resend", map[string]string{"EmailProvider": "resend", "ResendApiKey": "re_key", "ResendFrom": "sender@example.com"}, "", "", "", true},
		{"resend without key", map[string]string{"EmailProvider": "resend", "ResendFrom": "sender@example.com"}, "smtp.example.com", "sender@example.com", "", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			configureEmailDelivery(t, test.options)
			common.SMTPServer, common.SMTPFrom, common.SMTPAccount = test.server, test.from, test.account
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
			GetStatus(c)
			var reply struct {
				Data struct {
					EmailVerification       bool `json:"email_verification"`
					EmailDeliveryConfigured bool `json:"email_delivery_configured"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &reply))
			assert.True(t, reply.Data.EmailVerification, "password registration always verifies the email address")
			assert.Equal(t, test.configured, reply.Data.EmailDeliveryConfigured)
			assert.NotContains(t, response.Body.String(), "re_key")
		})
	}
}
