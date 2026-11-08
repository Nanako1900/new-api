package common

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"path"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const (
	DefaultMonitorSessionTTLHours  = 7 * 24
	DefaultMonitorStreamMaxPerUser = 5
	DefaultMonitorStreamMaxPerNode = 2000
	// MonitorSessionMaxTTL caps the configured TTL at the dashboard login
	// session lifetime. Issuance also ends a monitor session no later than its
	// parent session, which is the bound that actually applies.
	MonitorSessionMaxTTL = 30 * 24 * time.Hour
)

// Monitor console SSO settings. The monitor console is a separate origin that
// signs in with the dashboard session through an authorization code + PKCE
// flow and receives a read-only monitor session.
var (
	MonitorSSOEnabled bool
	// MonitorRedirectURIs are the exact callback URLs an authorization code may
	// be sent to. Comparison is exact string equality, never prefix or pattern.
	MonitorRedirectURIs []string
	// MonitorOrigins are the origins of MonitorRedirectURIs: the only origins
	// granted CORS on the monitor API.
	MonitorOrigins    []string
	MonitorSessionTTL = time.Duration(DefaultMonitorSessionTTLHours) * time.Hour
	// MonitorStreamMaxPerUser and MonitorStreamMaxPerNode bound the live
	// monitor streams one node serves, per user and in total.
	MonitorStreamMaxPerUser = DefaultMonitorStreamMaxPerUser
	MonitorStreamMaxPerNode = DefaultMonitorStreamMaxPerNode
)

// InitMonitorSSOSettings reads MONITOR_SSO_ENABLED, MONITOR_REDIRECT_URIS and
// MONITOR_SESSION_TTL_HOURS, plus the stream limits MONITOR_STREAM_MAX_PER_USER
// and MONITOR_STREAM_MAX_PER_NODE. It must run after InitSessionCookieSettings,
// because secure cookie mode decides whether plain-http callbacks are allowed.
//
// An invalid MONITOR_SSO_ENABLED or MONITOR_REDIRECT_URIS value is an error and
// leaves the monitor console disabled. MONITOR_REDIRECT_URIS is not read while
// the console is disabled, so it can be switched off without removing them.
// An invalid TTL or stream limit falls back to its default, like the other
// session limits.
func InitMonitorSSOSettings() error {
	MonitorSSOEnabled = false
	MonitorRedirectURIs = nil
	MonitorOrigins = nil

	ttlHours := positiveUserSessionEnv("MONITOR_SESSION_TTL_HOURS", DefaultMonitorSessionTTLHours)
	if maxHours := int(MonitorSessionMaxTTL / time.Hour); ttlHours > maxHours {
		SysError(LogText("%s exceeds the maximum, using the maximum: %d", "MONITOR_SESSION_TTL_HOURS", maxHours))
		ttlHours = maxHours
	}
	MonitorSessionTTL = time.Duration(ttlHours) * time.Hour
	MonitorStreamMaxPerUser = positiveUserSessionEnv("MONITOR_STREAM_MAX_PER_USER", DefaultMonitorStreamMaxPerUser)
	MonitorStreamMaxPerNode = positiveUserSessionEnv("MONITOR_STREAM_MAX_PER_NODE", DefaultMonitorStreamMaxPerNode)

	enabledRaw := strings.TrimSpace(os.Getenv("MONITOR_SSO_ENABLED"))
	if enabledRaw == "" || strings.EqualFold(enabledRaw, "false") {
		return nil
	}
	if !strings.EqualFold(enabledRaw, "true") {
		return fmt.Errorf("MONITOR_SSO_ENABLED must be true or false")
	}

	redirectURIsRaw := strings.TrimSpace(os.Getenv("MONITOR_REDIRECT_URIS"))
	if redirectURIsRaw == "" {
		return fmt.Errorf("MONITOR_SSO_ENABLED=true requires MONITOR_REDIRECT_URIS")
	}
	var redirectURIs, origins []string
	for rawURI := range strings.SplitSeq(redirectURIsRaw, ",") {
		redirectURI := strings.TrimSpace(rawURI)
		origin, err := monitorRedirectOrigin(redirectURI)
		if err != nil {
			return fmt.Errorf("invalid MONITOR_REDIRECT_URIS entry %q: %w", redirectURI, err)
		}
		if !slices.Contains(redirectURIs, redirectURI) {
			redirectURIs = append(redirectURIs, redirectURI)
		}
		if !slices.Contains(origins, origin) {
			origins = append(origins, origin)
		}
	}

	MonitorRedirectURIs = redirectURIs
	MonitorOrigins = origins
	MonitorSSOEnabled = true
	return nil
}

// monitorRedirectOrigin validates one configured monitor callback URL and
// returns its origin. The URL must have a single canonical spelling: lowercase
// ASCII host without a trailing dot, IP literals in their shortest form, no
// default or zero-padded port, and a clean path with default escaping. That
// keeps the exact comparison against client input unambiguous and makes the
// derived origin equal to the Origin header a browser sends. Plain http is
// accepted only for loopback IP literals while secure cookie mode is off,
// which is local development.
func monitorRedirectOrigin(redirectURI string) (string, error) {
	if redirectURI == "" {
		return "", fmt.Errorf("the URL is empty")
	}
	parsed, err := url.Parse(redirectURI)
	if err != nil {
		return "", err
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || strings.Contains(redirectURI, "#") {
		return "", fmt.Errorf("the URL must not carry user info, a query or a fragment")
	}
	if parsed.Path == "" || parsed.Path == "/" {
		return "", fmt.Errorf("the URL must name a callback path")
	}
	if parsed.RawPath != "" || path.Clean(parsed.Path) != parsed.Path {
		return "", fmt.Errorf("the URL path must be clean and use default escaping")
	}
	host := parsed.Hostname()
	if strings.HasSuffix(host, ".") || strings.ContainsFunc(host, func(r rune) bool { return r > unicode.MaxASCII }) {
		return "", fmt.Errorf("the host must be ASCII (punycode) without a trailing dot")
	}
	ip := net.ParseIP(host)
	if ip != nil && ip.String() != host {
		return "", fmt.Errorf("an IP host must be written as %s", ip.String())
	}
	// Browsers read a host whose last label is numeric (127.1, 0x7f000001) as
	// an IPv4 address that net.ParseIP rejects, so its Origin would never match.
	if lastLabel := host[strings.LastIndex(host, ".")+1:]; ip == nil && (strings.Trim(lastLabel, "0123456789") == "" || strings.HasPrefix(strings.ToLower(lastLabel), "0x")) {
		return "", fmt.Errorf("a numeric host must be a dotted-decimal IPv4 address")
	}
	if port := parsed.Port(); port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 1 || number > 65535 || strconv.Itoa(number) != port {
			return "", fmt.Errorf("the port must be a number from 1 to 65535 without leading zeros")
		}
	}
	origin, err := NormalizeOrigin(parsed.Scheme + "://" + parsed.Host)
	if err != nil {
		return "", err
	}
	if canonical := origin + parsed.EscapedPath(); canonical != redirectURI {
		return "", fmt.Errorf("the URL is not canonical, expected %s", canonical)
	}
	if parsed.Scheme == "https" {
		return origin, nil
	}
	if SessionCookieSecure {
		return "", fmt.Errorf("SESSION_COOKIE_SECURE=true requires https callbacks")
	}
	if ip == nil || !ip.IsLoopback() {
		return "", fmt.Errorf("plain http callbacks are only allowed on loopback IP addresses")
	}
	return origin, nil
}
