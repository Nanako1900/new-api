package service

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Monitor console SSO: a dashboard session issues a one-time authorization
// code (RFC 6749 4.1 with PKCE S256, RFC 7636) to the monitor console origin,
// which redeems it for a read-only monitor session. The monitor session is a
// child of the dashboard session that issued it and ends with it.
const (
	MonitorRefreshCookieName = "new_api_monitor_refresh"
	// MonitorBindingCookieName carries a digest of the code the browser just
	// requested, so only that browser can redeem it.
	MonitorBindingCookieName = "new_api_monitor_txn"
	MonitorLoginMethod       = "monitor_sso"
	MonitorCodeTTL           = 60 * time.Second
	// MonitorSessionIdleTimeout ends a monitor session that was not refreshed
	// for this long; an open console refreshes every 15 minutes.
	MonitorSessionIdleTimeout = 24 * time.Hour

	monitorRefreshCookiePath      = "/api/monitor/auth"
	monitorReplacedRevokeReason   = "monitor_replaced"
	monitorCodeReplayRevokeReason = "monitor_code_replay"
)

var (
	ErrMonitorDisabled           = errors.New("monitor console is disabled")
	ErrMonitorRedirectURIInvalid = errors.New("monitor redirect uri is not allowed")
	ErrMonitorChallengeInvalid   = errors.New("monitor code challenge is invalid")
	ErrMonitorGrantInvalid       = errors.New("monitor authorization grant is invalid")
	ErrMonitorSessionInvalid     = errors.New("monitor session is invalid")
	ErrMonitorRefreshRace        = errors.New("monitor session refresh is already in progress")
	ErrMonitorIssuanceLimit      = errors.New("monitor session issuance limit reached")

	// A PKCE S256 challenge is base64url(SHA-256) without padding: 43 chars.
	pkceChallengePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	// RFC 7636 4.1: code_verifier = 43*128 unreserved characters.
	pkceVerifierPattern = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)
	// monitorSessionNamespace scopes the monitor session IDs derived from codes.
	monitorSessionNamespace = uuid.MustParse("3b8c5f0e-6a1d-4f7b-9e2c-8d4a7c1b5e90")
)

type monitorCodePayload struct {
	Challenge       string `json:"challenge"`
	RedirectURI     string `json:"redirect_uri"`
	UserAuthVersion int64  `json:"uv"`
}

// MonitorBundle is a signed-in monitor session: its access token, the session
// row and the raw refresh token for the HttpOnly cookie.
type MonitorBundle struct {
	AccessToken     string
	AccessExpiresAt int64
	Session         *model.UserSession
	RefreshToken    string
}

// CreateMonitorAuthorizationCode issues a 60 second, single-use code for the
// dashboard session parent. redirectURI must exactly equal a configured
// callback and the challenge must be an S256 PKCE challenge.
func CreateMonitorAuthorizationCode(parent AuthIdentity, redirectURI, challenge, method string) (string, error) {
	if !common.MonitorSSOEnabled {
		return "", ErrMonitorDisabled
	}
	if !slices.Contains(common.MonitorRedirectURIs, redirectURI) {
		return "", ErrMonitorRedirectURIInvalid
	}
	if method != "S256" || !pkceChallengePattern.MatchString(challenge) {
		return "", ErrMonitorChallengeInvalid
	}
	if _, _, err := ValidateLoginSession(parent); err != nil {
		return "", err
	}
	payload, err := common.Marshal(monitorCodePayload{Challenge: challenge, RedirectURI: redirectURI, UserAuthVersion: parent.UserAuthVersion})
	if err != nil {
		return "", err
	}
	code, _, err := model.CreateAuthFlow(model.AuthFlowCreate{
		Purpose:   model.AuthFlowPurposeMonitorCode,
		UserId:    parent.UserID,
		SessionId: parent.SessionID,
		Payload:   string(payload),
		ExpiresAt: time.Now().Add(MonitorCodeTTL),
	})
	return code, err
}

// MonitorCodeBinding is the digest stored in the binding cookie for code.
func MonitorCodeBinding(code string) string {
	return common.GenerateHMACWithKey(authSigningKey("monitor-code-binding"), code)
}

// ExchangeMonitorCode redeems an authorization code for a monitor session.
// binding must come from the browser that requested the code, which stops a
// code read from a log or Referer from being redeemed elsewhere; a foreign
// attempt does not burn the code. Otherwise the code is consumed before the
// remaining checks, so a failed attempt burns it, and a replayed code revokes
// the session it issued. Every grant failure is ErrMonitorGrantInvalid with
// its reason in the message.
func ExchangeMonitorCode(code, verifier, redirectURI, binding, ip, userAgent string) (*MonitorBundle, error) {
	if !common.MonitorSSOEnabled {
		return nil, ErrMonitorDisabled
	}
	code = strings.TrimSpace(code)
	if code == "" || redirectURI == "" || !pkceVerifierPattern.MatchString(verifier) {
		return nil, fmt.Errorf("%w: malformed request", ErrMonitorGrantInvalid)
	}
	if subtle.ConstantTimeCompare([]byte(binding), []byte(MonitorCodeBinding(code))) != 1 {
		return nil, fmt.Errorf("%w: code not bound to this browser", ErrMonitorGrantInvalid)
	}
	flow, err := model.ConsumeAuthFlow(code, model.AuthFlowMatch{Purpose: model.AuthFlowPurposeMonitorCode})
	if err != nil {
		if errors.Is(err, model.ErrAuthFlowConsumed) {
			handleMonitorCodeReplay(code)
			return nil, fmt.Errorf("%w: code replayed", ErrMonitorGrantInvalid)
		}
		if errors.Is(err, model.ErrAuthFlowInvalid) || errors.Is(err, model.ErrAuthFlowExpired) {
			return nil, fmt.Errorf("%w: unknown or expired code", ErrMonitorGrantInvalid)
		}
		return nil, err
	}
	var payload monitorCodePayload
	if err := common.UnmarshalJsonStr(flow.Payload, &payload); err != nil {
		return nil, fmt.Errorf("%w: unreadable code", ErrMonitorGrantInvalid)
	}
	challenge := sha256.Sum256([]byte(verifier))
	if subtle.ConstantTimeCompare([]byte(payload.RedirectURI), []byte(redirectURI)) != 1 || !slices.Contains(common.MonitorRedirectURIs, redirectURI) {
		return nil, fmt.Errorf("%w: redirect uri mismatch", ErrMonitorGrantInvalid)
	}
	if subtle.ConstantTimeCompare([]byte(base64.RawURLEncoding.EncodeToString(challenge[:])), []byte(payload.Challenge)) != 1 {
		return nil, fmt.Errorf("%w: pkce verifier mismatch", ErrMonitorGrantInvalid)
	}
	parent, err := activeMonitorParent(flow.UserId, flow.SessionId, payload.UserAuthVersion)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	issued, err := model.CountMonitorSessionsCreatedSince(parent.UserID, now.Unix()-common.UserSessionIssuanceWindowSeconds)
	if err != nil {
		return nil, err
	}
	if issued >= int64(common.UserSessionIssuanceLimit) {
		return nil, ErrMonitorIssuanceLimit
	}
	if _, err := model.RevokeChildUserSessions(parent.UserID, parent.SID, monitorReplacedRevokeReason); err != nil {
		return nil, err
	}
	session, refreshSecret, err := newLoginSession(parent.UserID, parent.UserAuthVersion, MonitorLoginMethod, ip, userAgent)
	if err != nil {
		return nil, err
	}
	session.SID = monitorSessionSID(code)
	session.Kind = model.UserSessionKindMonitor
	session.ParentSID = parent.SID
	session.ExpiresAt = min(now.Add(common.MonitorSessionTTL).Unix(), parent.ExpiresAt)
	if err := model.CreateUserSession(session); err != nil {
		return nil, err
	}
	// The parent may have been revoked, or the code replayed, between the
	// checks above and the insert; neither would have seen this row, so check
	// both again now that it exists.
	if _, err := activeMonitorParent(parent.UserID, parent.SID, payload.UserAuthVersion); err != nil {
		_, _ = model.RevokeUserSession(session.UserID, session.SID, model.UserSessionRevokedReasonParent)
		return nil, err
	}
	if replayed, err := model.IsAuthFlowReplayed(code, model.AuthFlowPurposeMonitorCode); err != nil || replayed {
		_, _ = model.RevokeUserSession(session.UserID, session.SID, monitorCodeReplayRevokeReason)
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("%w: code replayed", ErrMonitorGrantInvalid)
	}
	return issueMonitorBundle(session, session.SID+"."+refreshSecret)
}

// RefreshMonitorSession rotates a monitor refresh token. Only monitor sessions
// whose parent dashboard session is still active can be refreshed.
func RefreshMonitorSession(rawRefreshToken, ip, userAgent string) (*MonitorBundle, error) {
	if !common.MonitorSSOEnabled {
		return nil, ErrMonitorDisabled
	}
	sid, secret, ok := splitRefreshToken(rawRefreshToken)
	if !ok {
		return nil, ErrMonitorSessionInvalid
	}
	session, err := model.GetUserSessionCached(sid)
	if err != nil {
		if errors.Is(err, model.ErrUserSessionInactive) || errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMonitorSessionInvalid
		}
		return nil, err
	}
	if session.Kind != model.UserSessionKindMonitor {
		return nil, ErrMonitorSessionInvalid
	}
	if time.Since(time.Unix(session.LastActiveAt, 0)) > MonitorSessionIdleTimeout {
		if _, err := model.RevokeUserSession(session.UserID, sid, "monitor_idle_timeout"); err != nil {
			return nil, err
		}
		return nil, ErrMonitorSessionInvalid
	}
	identity := AuthIdentity{UserID: session.UserID, SessionID: sid, UserAuthVersion: session.UserAuthVersion, SessionVersion: session.Version}
	if _, _, err := ValidateMonitorAccess(identity); err != nil {
		return nil, err
	}
	rotated, nextRefreshToken, recovered, err := rotateSessionRefreshToken(session, secret)
	if err != nil {
		switch {
		case errors.Is(err, ErrRefreshRace):
			return nil, ErrMonitorRefreshRace
		case errors.Is(err, ErrLoginSessionRevoked), errors.Is(err, ErrRefreshTokenInvalid):
			return nil, ErrMonitorSessionInvalid
		}
		return nil, err
	}
	if !recovered {
		rotated.IP = truncateAuthMetadata(ip, 64)
		rotated.UserAgent = truncateAuthMetadata(userAgent, 512)
	}
	return issueMonitorBundle(rotated, nextRefreshToken)
}

// RevokeMonitorSession signs the monitor console out and reports whether a
// session was ended. It only ever ends a monitor session, never the dashboard
// session a cookie might carry.
func RevokeMonitorSession(rawRefreshToken string) (bool, error) {
	sid, secret, ok := splitRefreshToken(rawRefreshToken)
	if !ok {
		return false, nil
	}
	session, err := model.GetUserSessionCached(sid)
	if err != nil {
		if errors.Is(err, model.ErrUserSessionInactive) || errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	if session.Kind != model.UserSessionKindMonitor {
		return false, nil
	}
	return model.RevokeUserSessionByRefreshHash(sid, hashRefreshSecret(secret), "logout")
}

// RevokeMonitorSessionByAccessToken signs out the monitor session a valid
// monitor access token names; an invalid token is already signed out.
func RevokeMonitorSessionByAccessToken(rawAccessToken string) error {
	identity, err := ParseMonitorAccessToken(rawAccessToken)
	if err != nil {
		return nil
	}
	session, _, err := ValidateMonitorAccess(identity)
	if err != nil {
		if errors.Is(err, ErrMonitorSessionInvalid) {
			return nil
		}
		return err
	}
	_, err = model.RevokeUserSession(session.UserID, session.SID, "logout")
	return err
}

// ValidateMonitorAccess checks the monitor session named by a monitor access
// token: it must be live, unchanged since the token was issued, and its parent
// dashboard session must still be active. A monitor session whose parent ended
// is revoked on the spot.
func ValidateMonitorAccess(identity AuthIdentity) (*model.UserSession, *model.UserBase, error) {
	session, err := model.GetUserSessionCached(identity.SessionID)
	if err != nil {
		if errors.Is(err, model.ErrUserSessionInactive) || errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrMonitorSessionInvalid
		}
		return nil, nil, err
	}
	if session.Kind != model.UserSessionKindMonitor || session.UserID != identity.UserID ||
		session.Status != model.UserSessionStatusActive || session.RevokedAt != 0 || session.ExpiresAt <= time.Now().Unix() ||
		session.Version != identity.SessionVersion || session.UserAuthVersion != identity.UserAuthVersion {
		return nil, nil, ErrMonitorSessionInvalid
	}
	if _, err := activeMonitorParent(session.UserID, session.ParentSID, session.UserAuthVersion); err != nil {
		if errors.Is(err, ErrMonitorGrantInvalid) {
			if _, revokeErr := model.RevokeUserSession(session.UserID, session.SID, model.UserSessionRevokedReasonParent); revokeErr != nil {
				common.SysError(common.LogText("failed to revoke a monitor session whose parent ended: %s", revokeErr.Error()))
			}
			return nil, nil, ErrMonitorSessionInvalid
		}
		return nil, nil, err
	}
	user, err := model.GetUserCache(session.UserID)
	if err != nil {
		return nil, nil, err
	}
	if user.Status != common.UserStatusEnabled || user.AuthVersion != session.UserAuthVersion {
		return nil, nil, ErrMonitorSessionInvalid
	}
	return session, user, nil
}

// activeMonitorParent returns the dashboard session that issued, or is about
// to issue, a monitor session. A missing, ended or security-changed parent is
// ErrMonitorGrantInvalid.
func activeMonitorParent(userID int, parentSID string, userAuthVersion int64) (*model.UserSession, error) {
	if userID <= 0 || parentSID == "" {
		return nil, ErrMonitorGrantInvalid
	}
	parent, err := model.GetUserSessionCached(parentSID)
	if err != nil {
		if errors.Is(err, model.ErrUserSessionInactive) || errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMonitorGrantInvalid
		}
		return nil, err
	}
	if parent.Kind != model.UserSessionKindDashboard || parent.UserID != userID ||
		parent.Status != model.UserSessionStatusActive || parent.RevokedAt != 0 || parent.ExpiresAt <= time.Now().Unix() ||
		parent.UserAuthVersion != userAuthVersion {
		return nil, ErrMonitorGrantInvalid
	}
	user, err := model.GetUserCache(userID)
	if err != nil {
		return nil, err
	}
	if user.Status != common.UserStatusEnabled || user.AuthVersion != userAuthVersion {
		return nil, ErrMonitorGrantInvalid
	}
	return parent, nil
}

// monitorSessionSID derives the session ID a code issues, so a replayed code
// can find and revoke that session without storing anything extra.
func monitorSessionSID(code string) string {
	digest := common.GenerateHMACWithKey(authSigningKey("monitor-code-session"), code)
	return uuid.NewSHA1(monitorSessionNamespace, []byte(digest)).String()
}

// handleMonitorCodeReplay revokes the session a replayed code issued. When
// the first redemption has not stored its session yet, the replay mark makes
// that redemption revoke it right after the insert.
func handleMonitorCodeReplay(code string) {
	if err := model.MarkAuthFlowReplayed(code, model.AuthFlowPurposeMonitorCode); err != nil {
		common.SysError(common.LogText("failed to mark a replayed monitor code: %s", err.Error()))
	}
	session, err := model.GetUserSessionBySID(monitorSessionSID(code))
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			common.SysError(common.LogText("failed to look up the monitor session of a replayed code: %s", err.Error()))
		}
		return
	}
	if _, err := model.RevokeUserSession(session.UserID, session.SID, monitorCodeReplayRevokeReason); err != nil {
		common.SysError(common.LogText("failed to revoke the monitor session of a replayed code: %s", err.Error()))
	}
}

func issueMonitorBundle(session *model.UserSession, rawRefreshToken string) (*MonitorBundle, error) {
	accessToken, accessExpiresAt, err := IssueMonitorAccessToken(AuthIdentity{
		UserID:          session.UserID,
		SessionID:       session.SID,
		UserAuthVersion: session.UserAuthVersion,
		SessionVersion:  session.Version,
	})
	if err != nil {
		return nil, err
	}
	return &MonitorBundle{AccessToken: accessToken, AccessExpiresAt: accessExpiresAt, Session: session, RefreshToken: rawRefreshToken}, nil
}

// monitorCookieSecure marks monitor cookies Secure in secure cookie mode, and
// whenever every monitor origin is https: an https monitor page can only reach
// this host over https, so the flag never breaks a working setup.
func monitorCookieSecure() bool {
	if common.SessionCookieSecure {
		return true
	}
	if len(common.MonitorOrigins) == 0 {
		return false
	}
	for _, origin := range common.MonitorOrigins {
		if !strings.HasPrefix(origin, "https://") {
			return false
		}
	}
	return true
}

// WriteMonitorBindingCookie binds a freshly issued code to this browser for
// as long as the code lives. It is sent only to the monitor auth endpoints.
func WriteMonitorBindingCookie(c *gin.Context, code string) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     MonitorBindingCookieName,
		Value:    MonitorCodeBinding(code),
		Path:     monitorRefreshCookiePath,
		MaxAge:   int(MonitorCodeTTL / time.Second),
		HttpOnly: true,
		Secure:   monitorCookieSecure(),
		SameSite: http.SameSiteStrictMode,
	})
}

func ClearMonitorBindingCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     MonitorBindingCookieName,
		Value:    "",
		Path:     monitorRefreshCookiePath,
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		Secure:   monitorCookieSecure(),
		SameSite: http.SameSiteStrictMode,
	})
}

// WriteMonitorRefreshCookie stores the monitor refresh token in an HttpOnly,
// SameSite=Strict, host-only cookie scoped to the monitor auth endpoints. The
// monitor origin must be same-site with this host for the browser to send it.
func WriteMonitorRefreshCookie(c *gin.Context, bundle *MonitorBundle) {
	expiresAt := time.Unix(bundle.Session.ExpiresAt, 0)
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     MonitorRefreshCookieName,
		Value:    bundle.RefreshToken,
		Path:     monitorRefreshCookiePath,
		MaxAge:   max(int(time.Until(expiresAt)/time.Second), 1),
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   monitorCookieSecure(),
		SameSite: http.SameSiteStrictMode,
	})
}

func ClearMonitorRefreshCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     MonitorRefreshCookieName,
		Value:    "",
		Path:     monitorRefreshCookiePath,
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		Secure:   monitorCookieSecure(),
		SameSite: http.SameSiteStrictMode,
	})
}
