package service

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	testMonitorRedirectURI        = "https://my.meowapi.dev/auth/callback"
	testMonitorStagingRedirectURI = "https://staging.my.meowapi.dev/auth/callback"
	// RFC 7636 Appendix B.
	testPKCEVerifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	testPKCEChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
)

func enableMonitorSSOForTest(t *testing.T) {
	t.Helper()
	enabled, redirectURIs, ttl := common.MonitorSSOEnabled, common.MonitorRedirectURIs, common.MonitorSessionTTL
	common.MonitorSSOEnabled = true
	common.MonitorRedirectURIs = []string{testMonitorRedirectURI, testMonitorStagingRedirectURI}
	common.MonitorSessionTTL = 7 * 24 * time.Hour
	t.Cleanup(func() {
		common.MonitorSSOEnabled, common.MonitorRedirectURIs, common.MonitorSessionTTL = enabled, redirectURIs, ttl
	})
}

func newMonitorTestParent(t *testing.T, user *model.User) (AuthIdentity, *AuthBundle) {
	t.Helper()
	bundle, err := CreateLoginSession(user.Id, "password", "127.0.0.1", "test-agent")
	require.NoError(t, err)
	identity, err := ParseAccessToken(bundle.AccessToken)
	require.NoError(t, err)
	return identity, bundle
}

func issueMonitorTestCode(t *testing.T, parent AuthIdentity) string {
	t.Helper()
	code, err := CreateMonitorAuthorizationCode(parent, testMonitorRedirectURI, testPKCEChallenge, "S256")
	require.NoError(t, err)
	return code
}

// exchangeMonitorTestCode redeems a code from the browser that requested it,
// that is with its binding cookie.
func exchangeMonitorTestCode(code, verifier, redirectURI string) (*MonitorBundle, error) {
	return ExchangeMonitorCode(code, verifier, redirectURI, MonitorCodeBinding(code), "127.0.0.1", "monitor-agent")
}

func signInMonitorForTest(t *testing.T, parent AuthIdentity) *MonitorBundle {
	t.Helper()
	bundle, err := exchangeMonitorTestCode(issueMonitorTestCode(t, parent), testPKCEVerifier, testMonitorRedirectURI)
	require.NoError(t, err)
	return bundle
}

func monitorIdentity(t *testing.T, bundle *MonitorBundle) AuthIdentity {
	t.Helper()
	identity, err := ParseMonitorAccessToken(bundle.AccessToken)
	require.NoError(t, err)
	return identity
}

func TestMonitorSSOIssuesReadOnlySessionBoundToParent(t *testing.T) {
	useTestSessionSecret(t)
	user := setupAuthSessionTestDB(t)
	enableMonitorSSOForTest(t)
	parent, parentBundle := newMonitorTestParent(t, user)

	bundle := signInMonitorForTest(t, parent)

	assert.Equal(t, model.UserSessionKindMonitor, bundle.Session.Kind)
	assert.Equal(t, parent.SessionID, bundle.Session.ParentSID)
	assert.Equal(t, MonitorLoginMethod, bundle.Session.LoginMethod)
	assert.LessOrEqual(t, bundle.Session.ExpiresAt, parentBundle.Session.ExpiresAt, "a monitor session never outlives its parent")
	identity := monitorIdentity(t, bundle)
	_, cachedUser, err := ValidateMonitorAccess(identity)
	require.NoError(t, err)
	assert.Equal(t, user.Id, cachedUser.Id)

	_, err = ParseAccessToken(bundle.AccessToken)
	assert.Error(t, err, "a monitor token must not parse as a dashboard token")
	_, internal, err := ParseDashboardAccessToken(bundle.AccessToken)
	assert.True(t, internal, "a monitor token must not fall through to PAT lookup")
	assert.ErrorIs(t, err, ErrAuthTokenInvalid)
	_, err = ParseMonitorAccessToken(parentBundle.AccessToken)
	assert.Error(t, err, "a dashboard token must not parse as a monitor token")

	refreshed, err := RefreshMonitorSession(bundle.RefreshToken, "127.0.0.2", "monitor-agent-2")
	require.NoError(t, err)
	assert.NotEqual(t, bundle.RefreshToken, refreshed.RefreshToken)
	_, _, err = ValidateMonitorAccess(monitorIdentity(t, refreshed))
	require.NoError(t, err)
}

func TestMonitorAuthorizationRejectsInvalidRequests(t *testing.T) {
	useTestSessionSecret(t)
	user := setupAuthSessionTestDB(t)
	enableMonitorSSOForTest(t)
	parent, _ := newMonitorTestParent(t, user)
	monitor := monitorIdentity(t, signInMonitorForTest(t, parent))
	tests := []struct {
		name        string
		disabled    bool
		identity    AuthIdentity
		redirectURI string
		challenge   string
		method      string
		wantErr     error
	}{
		{name: "disabled console", disabled: true, wantErr: ErrMonitorDisabled},
		{name: "unknown callback", redirectURI: "https://evil.example/auth/callback", wantErr: ErrMonitorRedirectURIInvalid},
		{name: "callback with extra path", redirectURI: testMonitorRedirectURI + "/x", wantErr: ErrMonitorRedirectURIInvalid},
		{name: "callback with query", redirectURI: testMonitorRedirectURI + "?next=/", wantErr: ErrMonitorRedirectURIInvalid},
		{name: "plain challenge method", method: "plain", wantErr: ErrMonitorChallengeInvalid},
		{name: "short challenge", challenge: testPKCEChallenge[:42], wantErr: ErrMonitorChallengeInvalid},
		{name: "challenge outside base64url", challenge: "+" + testPKCEChallenge[1:], wantErr: ErrMonitorChallengeInvalid},
		{name: "monitor session cannot issue codes", identity: monitor, wantErr: ErrLoginSessionRevoked},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			common.MonitorSSOEnabled = !test.disabled
			t.Cleanup(func() { common.MonitorSSOEnabled = true })
			identity, redirectURI, challenge, method := parent, testMonitorRedirectURI, testPKCEChallenge, "S256"
			if test.identity.SessionID != "" {
				identity = test.identity
			}
			if test.redirectURI != "" {
				redirectURI = test.redirectURI
			}
			if test.challenge != "" {
				challenge = test.challenge
			}
			if test.method != "" {
				method = test.method
			}
			code, err := CreateMonitorAuthorizationCode(identity, redirectURI, challenge, method)
			assert.ErrorIs(t, err, test.wantErr)
			assert.Empty(t, code)
		})
	}
}

func TestMonitorCodeExchangeRejectsBadGrants(t *testing.T) {
	tests := []struct {
		name    string
		prepare func(t *testing.T, user *model.User, parent AuthIdentity, code string)
		attempt func(code string) (*MonitorBundle, error)
	}{
		{name: "wrong verifier burns the code", attempt: func(code string) (*MonitorBundle, error) {
			if _, err := exchangeMonitorTestCode(code, testPKCEVerifier[:42]+"A", testMonitorRedirectURI); err == nil {
				return nil, nil
			}
			return exchangeMonitorTestCode(code, testPKCEVerifier, testMonitorRedirectURI)
		}},
		{name: "different allowed callback", attempt: func(code string) (*MonitorBundle, error) {
			return exchangeMonitorTestCode(code, testPKCEVerifier, testMonitorStagingRedirectURI)
		}},
		{name: "expired code", prepare: func(t *testing.T, _ *model.User, _ AuthIdentity, _ string) {
			require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", model.AuthFlowPurposeMonitorCode).
				Update("expires_at", time.Now().Add(-time.Second)).Error)
		}},
		{name: "parent signed out before the exchange", prepare: func(t *testing.T, user *model.User, parent AuthIdentity, _ string) {
			_, err := model.RevokeUserSession(user.Id, parent.SessionID, "logout")
			require.NoError(t, err)
		}},
		{name: "user security changed before the exchange", prepare: func(t *testing.T, user *model.User, _ AuthIdentity, _ string) {
			_, err := model.BumpUserAuthVersion(user.Id)
			require.NoError(t, err)
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			useTestSessionSecret(t)
			user := setupAuthSessionTestDB(t)
			enableMonitorSSOForTest(t)
			parent, _ := newMonitorTestParent(t, user)
			code := issueMonitorTestCode(t, parent)
			if test.prepare != nil {
				test.prepare(t, user, parent, code)
			}
			attempt := test.attempt
			if attempt == nil {
				attempt = func(code string) (*MonitorBundle, error) {
					return exchangeMonitorTestCode(code, testPKCEVerifier, testMonitorRedirectURI)
				}
			}

			bundle, err := attempt(code)

			assert.ErrorIs(t, err, ErrMonitorGrantInvalid)
			assert.Nil(t, bundle)
			var monitorSessions int64
			require.NoError(t, model.DB.Model(&model.UserSession{}).Where("kind = ?", model.UserSessionKindMonitor).Count(&monitorSessions).Error)
			assert.Zero(t, monitorSessions, "a rejected grant must not leave a monitor session behind")
		})
	}
}

func TestMonitorCodeReplayRevokesTheIssuedSession(t *testing.T) {
	useTestSessionSecret(t)
	user := setupAuthSessionTestDB(t)
	enableMonitorSSOForTest(t)
	parent, _ := newMonitorTestParent(t, user)
	code := issueMonitorTestCode(t, parent)
	bundle, err := exchangeMonitorTestCode(code, testPKCEVerifier, testMonitorRedirectURI)
	require.NoError(t, err)

	replayed, err := exchangeMonitorTestCode(code, testPKCEVerifier, testMonitorRedirectURI)

	assert.ErrorIs(t, err, ErrMonitorGrantInvalid)
	assert.Nil(t, replayed)
	_, _, err = ValidateMonitorAccess(monitorIdentity(t, bundle))
	assert.ErrorIs(t, err, ErrMonitorSessionInvalid, "a replayed code must revoke the session it issued (RFC 6749 4.1.2)")
}

func TestMonitorSessionEndsWithItsParent(t *testing.T) {
	tests := []struct {
		name      string
		endParent func(t *testing.T, user *model.User, parentSID string)
	}{
		{name: "parent revoked", endParent: func(t *testing.T, user *model.User, parentSID string) {
			_, err := model.RevokeUserSession(user.Id, parentSID, "logout")
			require.NoError(t, err)
		}},
		{name: "parent revoked without the cascade", endParent: func(t *testing.T, _ *model.User, parentSID string) {
			require.NoError(t, model.DB.Model(&model.UserSession{}).Where("sid = ?", parentSID).
				Updates(map[string]any{"status": model.UserSessionStatusRevoked, "revoked_at": time.Now().Unix()}).Error)
		}},
		{name: "parent row deleted", endParent: func(t *testing.T, _ *model.User, parentSID string) {
			require.NoError(t, model.DB.Where("sid = ?", parentSID).Delete(&model.UserSession{}).Error)
		}},
		{name: "password changed", endParent: func(t *testing.T, user *model.User, _ string) {
			_, err := model.BumpUserAuthVersion(user.Id)
			require.NoError(t, err)
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			useTestSessionSecret(t)
			user := setupAuthSessionTestDB(t)
			enableMonitorSSOForTest(t)
			parent, _ := newMonitorTestParent(t, user)
			bundle := signInMonitorForTest(t, parent)

			test.endParent(t, user, parent.SessionID)

			_, _, err := ValidateMonitorAccess(monitorIdentity(t, bundle))
			assert.ErrorIs(t, err, ErrMonitorSessionInvalid)
			_, err = RefreshMonitorSession(bundle.RefreshToken, "", "")
			assert.ErrorIs(t, err, ErrMonitorSessionInvalid)
		})
	}
}

func TestMonitorRefreshAndLogoutRejectDashboardTokens(t *testing.T) {
	useTestSessionSecret(t)
	user := setupAuthSessionTestDB(t)
	enableMonitorSSOForTest(t)
	parent, parentBundle := newMonitorTestParent(t, user)
	bundle := signInMonitorForTest(t, parent)

	_, err := RefreshMonitorSession(parentBundle.RefreshToken, "", "")
	assert.ErrorIs(t, err, ErrMonitorSessionInvalid, "the monitor refresh endpoint must not rotate a dashboard session")
	_, err = RefreshMonitorSession("not-a-refresh-token", "", "")
	assert.ErrorIs(t, err, ErrMonitorSessionInvalid)

	revoked, err := RevokeMonitorSession(parentBundle.RefreshToken)
	require.NoError(t, err)
	assert.False(t, revoked)
	_, _, err = ValidateLoginSession(parent)
	require.NoError(t, err, "monitor logout must never end a dashboard session")

	revoked, err = RevokeMonitorSession(bundle.RefreshToken)
	require.NoError(t, err)
	assert.True(t, revoked)
	_, _, err = ValidateMonitorAccess(monitorIdentity(t, bundle))
	assert.ErrorIs(t, err, ErrMonitorSessionInvalid)
	_, _, err = ValidateLoginSession(parent)
	assert.NoError(t, err, "monitor logout leaves the main site signed in")
}

func TestMonitorSignInKeepsOneSessionPerParent(t *testing.T) {
	useTestSessionSecret(t)
	user := setupAuthSessionTestDB(t)
	enableMonitorSSOForTest(t)
	parent, _ := newMonitorTestParent(t, user)
	first := signInMonitorForTest(t, parent)

	second := signInMonitorForTest(t, parent)

	_, _, err := ValidateMonitorAccess(monitorIdentity(t, first))
	assert.ErrorIs(t, err, ErrMonitorSessionInvalid, "a new monitor sign-in replaces the previous one of the same parent")
	_, _, err = ValidateMonitorAccess(monitorIdentity(t, second))
	assert.NoError(t, err)
}

func TestMonitorSessionsUseTheirOwnIssuanceLimit(t *testing.T) {
	useTestSessionSecret(t)
	user := setupAuthSessionTestDB(t)
	enableMonitorSSOForTest(t)
	common.UserSessionIssuanceLimit = 2
	parent, _ := newMonitorTestParent(t, user)
	signInMonitorForTest(t, parent)
	signInMonitorForTest(t, parent)

	_, err := CreateLoginSession(user.Id, "password", "127.0.0.1", "test-agent")
	require.NoError(t, err, "monitor sign-ins must not use up the dashboard issuance limit")
	_, err = exchangeMonitorTestCode(issueMonitorTestCode(t, parent), testPKCEVerifier, testMonitorRedirectURI)
	assert.ErrorIs(t, err, ErrMonitorIssuanceLimit)
}

func TestMonitorCodeExchangeRequiresTheIssuingBrowser(t *testing.T) {
	useTestSessionSecret(t)
	user := setupAuthSessionTestDB(t)
	enableMonitorSSOForTest(t)
	parent, _ := newMonitorTestParent(t, user)
	code := issueMonitorTestCode(t, parent)

	for _, binding := range []string{"", MonitorCodeBinding(code + "x")} {
		bundle, err := ExchangeMonitorCode(code, testPKCEVerifier, testMonitorRedirectURI, binding, "", "")
		assert.ErrorIs(t, err, ErrMonitorGrantInvalid, "a code redeemed outside the browser that requested it is rejected")
		assert.Nil(t, bundle)
	}

	bundle, err := exchangeMonitorTestCode(code, testPKCEVerifier, testMonitorRedirectURI)
	require.NoError(t, err, "a rejected foreign attempt must not burn the victim's code")
	assert.Equal(t, model.UserSessionKindMonitor, bundle.Session.Kind)
}

func TestMonitorSessionExpiresAfterInactivity(t *testing.T) {
	useTestSessionSecret(t)
	user := setupAuthSessionTestDB(t)
	enableMonitorSSOForTest(t)
	parent, _ := newMonitorTestParent(t, user)
	bundle := signInMonitorForTest(t, parent)
	require.NoError(t, model.DB.Model(&model.UserSession{}).Where("sid = ?", bundle.Session.SID).
		Update("last_active_at", time.Now().Add(-MonitorSessionIdleTimeout-time.Minute).Unix()).Error)

	_, err := RefreshMonitorSession(bundle.RefreshToken, "", "")

	assert.ErrorIs(t, err, ErrMonitorSessionInvalid)
	stored, err := model.GetUserSessionBySID(bundle.Session.SID)
	require.NoError(t, err)
	assert.Equal(t, model.UserSessionStatusRevoked, stored.Status)
}
