package common

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInitMonitorSSOSettings(t *testing.T) {
	defaultTTL := time.Duration(DefaultMonitorSessionTTLHours) * time.Hour
	tests := []struct {
		name         string
		secure       bool
		enabled      string
		redirectURIs string
		ttlHours     string
		wantErr      bool
		wantEnabled  bool
		wantURIs     []string
		wantOrigins  []string
		wantTTL      time.Duration
	}{
		{name: "disabled by default", wantTTL: defaultTTL},
		{name: "disabled ignores callbacks", enabled: "false", redirectURIs: "not a url", wantTTL: defaultTTL},
		{
			name: "enabled with exact https callbacks", secure: true, enabled: "true",
			redirectURIs: "https://my.meowapi.dev/auth/callback, https://my.meowapi.dev/auth/callback,https://staging.my.meowapi.dev/auth/callback",
			wantEnabled:  true,
			wantURIs:     []string{"https://my.meowapi.dev/auth/callback", "https://staging.my.meowapi.dev/auth/callback"},
			wantOrigins:  []string{"https://my.meowapi.dev", "https://staging.my.meowapi.dev"},
			wantTTL:      defaultTTL,
		},
		{
			name: "http loopback ip callbacks allowed in local development", enabled: "true",
			redirectURIs: "http://127.0.0.1:5173/auth/callback,http://[::1]:5173/auth/callback",
			wantEnabled:  true,
			wantURIs:     []string{"http://127.0.0.1:5173/auth/callback", "http://[::1]:5173/auth/callback"},
			wantOrigins:  []string{"http://127.0.0.1:5173", "http://[::1]:5173"},
			wantTTL:      defaultTTL,
		},
		{name: "http localhost name rejected", enabled: "true", redirectURIs: "http://localhost:5173/auth/callback", wantErr: true},
		{name: "non canonical loopback ip rejected", enabled: "true", redirectURIs: "http://[0:0:0:0:0:0:0:1]:5173/auth/callback", wantErr: true},
		{name: "ipv4 mapped loopback rejected", enabled: "true", redirectURIs: "http://[::ffff:127.0.0.1]:5173/auth/callback", wantErr: true},
		{name: "invalid enabled flag", enabled: "yes", redirectURIs: "https://my.meowapi.dev/auth/callback", wantErr: true},
		{name: "enabled requires a callback", secure: true, enabled: "true", wantErr: true},
		{name: "http callback rejected with secure cookies", secure: true, enabled: "true", redirectURIs: "http://my.meowapi.dev/auth/callback", wantErr: true},
		{name: "http callback rejected outside loopback", enabled: "true", redirectURIs: "http://my.meowapi.dev/auth/callback", wantErr: true},
		{name: "callback with query rejected", secure: true, enabled: "true", redirectURIs: "https://my.meowapi.dev/auth/callback?next=1", wantErr: true},
		{name: "callback with fragment rejected", secure: true, enabled: "true", redirectURIs: "https://my.meowapi.dev/auth/callback#done", wantErr: true},
		{name: "callback without path rejected", secure: true, enabled: "true", redirectURIs: "https://my.meowapi.dev", wantErr: true},
		{name: "callback with userinfo rejected", secure: true, enabled: "true", redirectURIs: "https://user@my.meowapi.dev/auth/callback", wantErr: true},
		{name: "non canonical callback rejected", secure: true, enabled: "true", redirectURIs: "https://MY.meowapi.dev:443/auth/callback", wantErr: true},
		{name: "empty callback entry rejected", secure: true, enabled: "true", redirectURIs: "https://my.meowapi.dev/auth/callback,,", wantErr: true},
		{name: "dot segment callback rejected", secure: true, enabled: "true", redirectURIs: "https://my.meowapi.dev/auth/../evil", wantErr: true},
		{name: "encoded dot segment callback rejected", secure: true, enabled: "true", redirectURIs: "https://my.meowapi.dev/auth/%2e%2e/evil", wantErr: true},
		{name: "empty path segment callback rejected", secure: true, enabled: "true", redirectURIs: "https://my.meowapi.dev//evil.com/callback", wantErr: true},
		{name: "trailing slash callback rejected", secure: true, enabled: "true", redirectURIs: "https://my.meowapi.dev/auth/callback/", wantErr: true},
		{name: "non default path escaping rejected", secure: true, enabled: "true", redirectURIs: "https://my.meowapi.dev/auth/c%61llback", wantErr: true},
		{name: "trailing dot host rejected", secure: true, enabled: "true", redirectURIs: "https://my.meowapi.dev./auth/callback", wantErr: true},
		{name: "non punycode host rejected", secure: true, enabled: "true", redirectURIs: "https://bücher.de/auth/callback", wantErr: true},
		{name: "numeric ipv4 shorthand host rejected", secure: true, enabled: "true", redirectURIs: "https://127.1/auth/callback", wantErr: true},
		{name: "hex ipv4 host rejected", secure: true, enabled: "true", redirectURIs: "https://0x7f000001/auth/callback", wantErr: true},
		{name: "numeric final label host rejected", secure: true, enabled: "true", redirectURIs: "https://my.meowapi.123/auth/callback", wantErr: true},
		{name: "zero padded port rejected", secure: true, enabled: "true", redirectURIs: "https://my.meowapi.dev:0443/auth/callback", wantErr: true},
		{name: "out of range port rejected", secure: true, enabled: "true", redirectURIs: "https://my.meowapi.dev:65536/auth/callback", wantErr: true},
		{
			name: "session ttl is capped at the login session lifetime", secure: true, enabled: "true",
			redirectURIs: "https://my.meowapi.dev/auth/callback", ttlHours: "100000",
			wantEnabled: true,
			wantURIs:    []string{"https://my.meowapi.dev/auth/callback"},
			wantOrigins: []string{"https://my.meowapi.dev"},
			wantTTL:     MonitorSessionMaxTTL,
		},
		{
			name: "session ttl that would overflow is capped", secure: true, enabled: "true",
			redirectURIs: "https://my.meowapi.dev/auth/callback", ttlHours: "3000000",
			wantEnabled: true,
			wantURIs:    []string{"https://my.meowapi.dev/auth/callback"},
			wantOrigins: []string{"https://my.meowapi.dev"},
			wantTTL:     MonitorSessionMaxTTL,
		},
		{
			name: "non positive session ttl falls back to the default", secure: true, enabled: "true",
			redirectURIs: "https://my.meowapi.dev/auth/callback", ttlHours: "0",
			wantEnabled: true,
			wantURIs:    []string{"https://my.meowapi.dev/auth/callback"},
			wantOrigins: []string{"https://my.meowapi.dev"},
			wantTTL:     defaultTTL,
		},
	}
	previousSecure := SessionCookieSecure
	t.Cleanup(func() {
		SessionCookieSecure = previousSecure
		MonitorSSOEnabled = false
		MonitorRedirectURIs = nil
		MonitorOrigins = nil
	})
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			SessionCookieSecure = test.secure
			t.Setenv("MONITOR_SSO_ENABLED", test.enabled)
			t.Setenv("MONITOR_REDIRECT_URIS", test.redirectURIs)
			t.Setenv("MONITOR_SESSION_TTL_HOURS", test.ttlHours)

			err := InitMonitorSSOSettings()
			if test.wantErr {
				require.Error(t, err)
				assert.False(t, MonitorSSOEnabled, "a rejected configuration must leave the monitor console disabled")
				assert.Empty(t, MonitorRedirectURIs)
				assert.Empty(t, MonitorOrigins)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, test.wantEnabled, MonitorSSOEnabled)
			assert.Equal(t, test.wantURIs, MonitorRedirectURIs)
			assert.Equal(t, test.wantOrigins, MonitorOrigins)
			assert.Equal(t, test.wantTTL, MonitorSessionTTL)
		})
	}
}

func TestInitMonitorSSOStreamLimits(t *testing.T) {
	t.Cleanup(func() {
		MonitorStreamMaxPerUser = DefaultMonitorStreamMaxPerUser
		MonitorStreamMaxPerNode = DefaultMonitorStreamMaxPerNode
	})
	t.Setenv("MONITOR_SSO_ENABLED", "")
	t.Setenv("MONITOR_STREAM_MAX_PER_USER", "3")
	t.Setenv("MONITOR_STREAM_MAX_PER_NODE", "0")

	require.NoError(t, InitMonitorSSOSettings())

	assert.Equal(t, 3, MonitorStreamMaxPerUser)
	assert.Equal(t, DefaultMonitorStreamMaxPerNode, MonitorStreamMaxPerNode, "a non positive limit falls back to the default")
}
