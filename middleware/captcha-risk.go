package middleware

import (
	"context"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

const (
	captchaRiskKeyPrefix = "captchaRisk:v1"
	// captchaRiskStoreTimeout bounds the risk bookkeeping of one request.
	captchaRiskStoreTimeout = 2 * time.Second

	// captchaVerifiedContextKey marks a request whose GeeTest result was
	// confirmed.
	captchaVerifiedContextKey = "captcha_verified"
	// captchaRiskReservationsContextKey holds the risk events the request
	// recorded, so WithdrawCaptchaRisk can take them back.
	captchaRiskReservationsContextKey = "captcha_risk_reservations"
)

// captchaRiskNow is the clock of risk evaluation. Tests move it.
var captchaRiskNow = time.Now

// captchaRiskKeyBy names what a risk signal counts per.
type captchaRiskKeyBy int

const (
	captchaRiskPerSite captchaRiskKeyBy = iota
	captchaRiskPerSubject
	captchaRiskPerIP
)

// captchaRiskSignal is one rule of risk mode. "count" is the number of events
// recorded within window before the current request; the request needs the
// check when count >= limit.
type captchaRiskSignal struct {
	kind  string // key segment
	keyBy captchaRiskKeyBy
	// distinct counts subjects (usernames, accounts) instead of events.
	distinct bool
	// excludeSubject leaves the current subject out of the count.
	excludeSubject bool
	limit          int
	window         time.Duration
	// hold keeps a site-wide signal on for this long once it fires, so the
	// check does not switch on and off while attackers solve challenges.
	hold time.Duration
}

// captchaRiskPolicies is the risk-mode policy of every scope, documented in
// docs/authentication.md. Site-wide signals come first so their hold starts
// even when another signal would also fire.
var captchaRiskPolicies = map[CaptchaScope][]captchaRiskSignal{
	// Recorded for each failed password login.
	CaptchaScopeLogin: {
		{kind: "site", keyBy: captchaRiskPerSite, limit: 30, window: 5 * time.Minute, hold: 15 * time.Minute},
		{kind: "user", keyBy: captchaRiskPerSubject, limit: 3, window: 15 * time.Minute},
		{kind: "ip", keyBy: captchaRiskPerIP, limit: 5, window: 15 * time.Minute},
		{kind: "ip-users", keyBy: captchaRiskPerIP, distinct: true, limit: 3, window: 15 * time.Minute},
	},
	// Recorded for each sign-up or password reset email request that passes
	// the gate.
	CaptchaScopeEmail: {
		{kind: "site", keyBy: captchaRiskPerSite, limit: 30, window: 10 * time.Minute, hold: 30 * time.Minute},
		{kind: "ip", keyBy: captchaRiskPerIP, limit: 2, window: time.Hour},
	},
	// Recorded for each successful check-in.
	CaptchaScopeCheckin: {
		{kind: "site", keyBy: captchaRiskPerSite, limit: 60, window: 10 * time.Minute, hold: 30 * time.Minute},
		{kind: "ip-users", keyBy: captchaRiskPerIP, distinct: true, excludeSubject: true, limit: 1, window: 24 * time.Hour},
	},
}

func (signal captchaRiskSignal) key(scope CaptchaScope, network, subject string) string {
	id := "all"
	switch signal.keyBy {
	case captchaRiskPerSubject:
		id = subject
	case captchaRiskPerIP:
		id = network
	}
	return captchaRiskKeyPrefix + ":" + string(scope) + ":" + signal.kind + ":" + id
}

func (signal captchaRiskSignal) holdKey(scope CaptchaScope) string {
	return captchaRiskKeyPrefix + ":" + string(scope) + ":hold:" + signal.kind
}

// captchaRiskSubject is how a subject is stored: a login username only as a
// keyed hash of its folded form, a check-in account as its user ID.
func captchaRiskSubject(scope CaptchaScope, subject string) string {
	if scope != CaptchaScopeLogin {
		return subject
	}
	return common.GenerateHMACWithKey([]byte(common.SessionSecret), "captcha-risk:login:"+foldLoginName(subject))
}

// foldLoginName folds the spellings a database may treat as the same login
// name into one: surrounding space, compatibility forms, accents and case
// (MySQL's default collations ignore accents and case). The failure count is
// keyed on the name as submitted, before any account lookup, so whether a
// name needs the check never depends on whether its account exists.
func foldLoginName(name string) string {
	decomposed := norm.NFKD.String(strings.TrimSpace(name))
	var unmarked strings.Builder
	unmarked.Grow(len(decomposed))
	for _, r := range decomposed {
		if !unicode.Is(unicode.Mn, r) {
			unmarked.WriteRune(r)
		}
	}
	return cases.Fold().String(unmarked.String())
}

// captchaRiskNetwork is the client network that per-IP signals count by: an
// IPv4 address on its own, an IPv6 address by its /64, because one IPv6 host
// usually controls the whole /64.
func captchaRiskNetwork(clientIP string) string {
	addr, err := netip.ParseAddr(clientIP)
	if err != nil {
		return clientIP
	}
	addr = addr.Unmap()
	if addr.Is4() {
		return addr.String()
	}
	prefix, err := addr.WithZone("").Prefix(64)
	if err != nil {
		return clientIP
	}
	return prefix.String()
}

func captchaRiskRecording() bool {
	return common.GeetestCheckEnabled && common.GeetestCheckMode == common.GeetestCheckModeRisk
}

// captchaRiskStoreContext keeps the risk bookkeeping of a request running when
// the client goes away: a client that half-closes its connection must not
// skip being recorded.
func captchaRiskStoreContext(c *gin.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(c.Request.Context()), captchaRiskStoreTimeout)
}

type captchaRiskReservation struct {
	key, member string
}

func captchaRiskReservations(c *gin.Context) []captchaRiskReservation {
	value, _ := c.Get(captchaRiskReservationsContextKey)
	reservations, _ := value.([]captchaRiskReservation)
	return reservations
}

// reportCaptchaRiskStoreError logs a risk store error. Without a confirmed
// GeeTest result the request then needs the check.
func reportCaptchaRiskStoreError(err error, verified bool) {
	if verified {
		common.SysError(common.LogText("Failed to update GeeTest risk events: %s", err.Error()))
		return
	}
	common.SysError(common.LogText("GeeTest risk check failed, requiring human verification: %s", err.Error()))
}

// captchaRiskHoldActive reports whether a site-wide hold of scope is on.
func captchaRiskHoldActive(ctx context.Context, store captchaRiskStore, scope CaptchaScope, now time.Time) (bool, error) {
	for _, signal := range captchaRiskPolicies[scope] {
		if signal.hold == 0 {
			continue
		}
		held, err := store.HoldActive(ctx, signal.holdKey(scope), now)
		if err != nil || held {
			return true, err
		}
	}
	return false, nil
}

// takeCaptchaRisk records the request as an event of the scope's signals and
// reports whether it may go on. Recording and counting are one atomic store
// step, so parallel requests cannot all slip under a limit, and every write
// happens before the request is let through, so a store that refuses writes
// fails closed. A request with a confirmed GeeTest result is recorded and
// always goes on. A rejected request is not recorded.
func takeCaptchaRisk(c *gin.Context, scope CaptchaScope, subject string) bool {
	verified := c.GetBool(captchaVerifiedContextKey)
	store, err := currentCaptchaRiskStore()
	if err != nil {
		reportCaptchaRiskStoreError(err, verified)
		return verified
	}
	ctx, cancel := captchaRiskStoreContext(c)
	defer cancel()
	now := captchaRiskNow()
	if !verified {
		held, err := captchaRiskHoldActive(ctx, store, scope, now)
		if err != nil {
			reportCaptchaRiskStoreError(err, false)
		}
		if held {
			return false
		}
	}
	network := captchaRiskNetwork(c.ClientIP())
	reserved := slices.Clip(captchaRiskReservations(c))
	for _, signal := range captchaRiskPolicies[scope] {
		key := signal.key(scope, network, subject)
		member := subject
		if !signal.distinct {
			member = strconv.FormatInt(now.UnixNano(), 10) + "-" + common.GetRandomString(8)
		}
		prior, present, err := store.Reserve(ctx, key, member, now, signal.window)
		if err != nil {
			reportCaptchaRiskStoreError(err, verified)
			if verified {
				continue
			}
			c.Set(captchaRiskReservationsContextKey, reserved)
			WithdrawCaptchaRisk(c)
			return false
		}
		if !present {
			reserved = append(reserved, captchaRiskReservation{key: key, member: member})
		}
		if signal.excludeSubject && present {
			prior--
		}
		if verified || prior < signal.limit {
			continue
		}
		if signal.hold > 0 {
			started, err := store.SetHold(ctx, signal.holdKey(scope), now, now.Add(signal.hold))
			if err != nil {
				reportCaptchaRiskStoreError(err, true)
			} else if started {
				common.SysLog(common.LogText("GeeTest risk hold started for %s requests: %d site-wide events within %d minutes, every request needs human verification for the next %d minutes",
					scope, prior, int(signal.window.Minutes()), int(signal.hold.Minutes())))
			}
		}
		c.Set(captchaRiskReservationsContextKey, reserved)
		WithdrawCaptchaRisk(c)
		return false
	}
	c.Set(captchaRiskReservationsContextKey, reserved)
	return true
}

// WithdrawCaptchaRisk takes back the risk events the gate recorded for this
// request when the request turns out not to be one: a password login that
// succeeded or stopped before the password check, or a check-in that did not
// happen. Events of other requests stay; a store error is logged and leaves
// the events counted.
func WithdrawCaptchaRisk(c *gin.Context) {
	reservations := captchaRiskReservations(c)
	if len(reservations) == 0 {
		return
	}
	c.Set(captchaRiskReservationsContextKey, []captchaRiskReservation(nil))
	store, err := currentCaptchaRiskStore()
	if err != nil {
		reportCaptchaRiskStoreError(err, true)
		return
	}
	ctx, cancel := captchaRiskStoreContext(c)
	defer cancel()
	for _, reservation := range reservations {
		if err := store.Remove(ctx, reservation.key, reservation.member); err != nil {
			reportCaptchaRiskStoreError(err, true)
		}
	}
}
