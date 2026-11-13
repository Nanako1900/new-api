package dto

import (
	"errors"
	"strings"
)

// ChannelUserAgentPolicy filters client-declared identifiers, not client identity.
// The gateway enforces it before using the selected channel.
type ChannelUserAgentPolicy struct {
	Enabled bool                   `json:"enabled"`
	Profile string                 `json:"profile"`
	Rules   []ChannelUserAgentRule `json:"rules,omitempty"`
}

type ChannelUserAgentRule struct {
	Match string `json:"match"`
	Value string `json:"value"`
}

const (
	MaxChannelUserAgentLength = 1024
	MaxChannelUserAgentRules  = 20
)

func (p *ChannelUserAgentPolicy) Validate() error {
	if p == nil || !p.Enabled {
		return nil
	}
	switch p.Profile {
	case "claude_code":
		if len(p.Rules) != 0 {
			return errors.New("The Claude Code User-Agent preset cannot include custom rules")
		}
	case "custom":
		if len(p.Rules) == 0 || len(p.Rules) > MaxChannelUserAgentRules {
			return errors.New("User-Agent allowlist must contain between 1 and 20 rules")
		}
		for _, rule := range p.Rules {
			if rule.Match != "exact" && rule.Match != "prefix" {
				return errors.New("User-Agent rules must use exact or prefix matching")
			}
			if strings.TrimSpace(rule.Value) == "" || len(rule.Value) > MaxChannelUserAgentLength || strings.ContainsAny(rule.Value, "\r\n\x00") {
				return errors.New("User-Agent rule values must contain 1 to 1024 bytes without control characters")
			}
			for _, char := range rule.Value {
				if char < 32 || char == 127 {
					return errors.New("User-Agent rule values must contain 1 to 1024 bytes without control characters")
				}
			}
		}
	default:
		return errors.New("Select a valid User-Agent restriction profile")
	}
	return nil
}
