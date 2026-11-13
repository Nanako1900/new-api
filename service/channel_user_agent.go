package service

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

const originalUserAgentKey = "channel_policy_original_user_agent"

type channelUserAgent struct {
	value   string
	invalid bool
}

// Claude Code's entrypoint suffix varies (cli, sdk-cli, vscode, etc.). This
// recognizes the product/version envelope; it is not proof of client identity.
var claudeCodeUserAgent = regexp.MustCompile(`^claude-cli/[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?(?: \([ -~]+\))?$`)

// CaptureChannelUserAgent freezes the ingress value before header overrides.
// It is also called by the shared channel setup for direct relay entrypoints.
func CaptureChannelUserAgent(c *gin.Context) {
	if _, exists := c.Get(originalUserAgentKey); exists {
		return
	}
	ua := channelUserAgent{invalid: true}
	if c.Request != nil {
		values := c.Request.Header.Values("User-Agent")
		if len(values) > 0 {
			ua.value = values[0][:min(len(values[0]), dto.MaxChannelUserAgentLength)]
			ua.invalid = len(values) != 1 || len(values[0]) > dto.MaxChannelUserAgentLength || strings.TrimSpace(ua.value) == ""
			for _, char := range ua.value {
				if char < 32 || char == 127 {
					ua.invalid = true
					break
				}
			}
		}
	}
	c.Set(originalUserAgentKey, ua)
}

// EnforceChannelUserAgent is a local admission decision. It never disables a
// channel or permits fallback to another channel after rejecting a request.
func EnforceChannelUserAgent(c *gin.Context, channel *model.Channel, modelName string) *types.NewAPIError {
	if channel == nil {
		return nil
	}
	CaptureChannelUserAgent(c)
	value, _ := c.Get(originalUserAgentKey)
	ua := value.(channelUserAgent)
	settings := dto.ChannelSettings{}
	var configErr error
	if channel.Setting != nil && *channel.Setting != "" {
		configErr = common.UnmarshalJsonStr(*channel.Setting, &settings)
	}
	policy := settings.UserAgentPolicy
	if configErr == nil {
		configErr = policy.Validate()
	}
	if configErr == nil && (policy == nil || !policy.Enabled) {
		return nil
	}

	reason := "not_allowed"
	code := types.ErrorCodeUserAgentNotAllowed
	status := http.StatusForbidden
	messageID := i18n.MsgChannelUserAgentNotAllowed
	content := "This channel does not allow this client User-Agent"
	profile := ""
	if policy != nil {
		profile = policy.Profile
	}
	if configErr != nil {
		reason = "invalid_policy"
		code = types.ErrorCodeUserAgentPolicyInvalid
		status = http.StatusServiceUnavailable
		messageID = i18n.MsgChannelUserAgentPolicyInvalid
		content = "The channel User-Agent restriction is invalid; contact the administrator"
	} else if ua.invalid {
		reason = "missing_or_invalid_user_agent"
	} else {
		allowed := policy.Profile == "claude_code" && claudeCodeUserAgent.MatchString(ua.value)
		if policy.Profile == "custom" {
			for _, rule := range policy.Rules {
				if (rule.Match == "exact" && ua.value == rule.Value) || (rule.Match == "prefix" && strings.HasPrefix(ua.value, rule.Value)) {
					allowed = true
					break
				}
			}
		}
		if allowed {
			return nil
		}
	}

	// Quote the bounded untrusted value before either log sink sees it. Do not
	// include request bodies, credentials, or the configured allowlist.
	quotedUA := strconv.QuoteToASCII(ua.value)
	logger.LogWarn(c, common.LogText("user_agent_rejected channel_id=%d user_id=%d token_id=%d model=%q user_agent=%s reason=%s", channel.Id, c.GetInt("id"), c.GetInt("token_id"), modelName, quotedUA, reason))
	if constant.ErrorLogEnabled {
		other := model.NewLogOther()
		other.SetPublic("content_parts", []*common.Message{common.NewMessage(content)})
		other.SetPublic("error_code", code)
		other.SetPublic("status_code", status)
		if c.Request != nil && c.Request.URL != nil {
			other.SetPublic("request_path", c.Request.URL.Path)
		}
		other.MergeAdmin(map[string]any{"user_agent_policy": map[string]any{
			"user_agent": quotedUA, "profile": profile, "reason": reason,
		}})
		model.RecordErrorLog(c, c.GetInt("id"), channel.Id, modelName, c.GetString("token_name"), content, c.GetInt("token_id"), 0, false, c.GetString("group"), other)
	}
	return types.NewErrorWithStatusCode(errors.New(i18n.T(c, messageID)), code, status, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
}
