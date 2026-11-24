package contentsafety

import (
	"fmt"
	"strings"
)

// qwen3GuardCategory is where a category Qwen3Guard names lands in this
// gateway's policy. A category outside the policy is "other" and at most
// controversial: it is logged and counted lightly, never blocked.
type qwen3GuardCategory struct {
	category string
	inPolicy bool
}

// qwen3GuardCategories maps the unsafe-content categories of Qwen3Guard-Gen's
// prompt moderation onto Categories. The policy covers what gets AI provider
// accounts banned. Qwen3Guard does not tell sexual_minors from sexual,
// terrorism from weapons, or cyber_attack from fraud; an escalation model
// does, for the controversial verdicts it reviews again.
//
//	Qwen3Guard category             Category    Level
//	Violent                         weapons     as given
//	Non-violent Illegal Acts        other       as given
//	Sexual Content or Sexual Acts   sexual      as given
//	Suicide & Self-Harm             self_harm   as given
//	PII                             other       at most controversial
//	Unethical Acts                  other       at most controversial
//	Politically Sensitive Topics    other       at most controversial
//	Copyright Violation             other       at most controversial
//	Jailbreak                       other       at most controversial
//	None, missing or unknown        other       as given
//
// With several categories the first one in the policy decides; the level is
// capped only when every category named lies outside the policy.
var qwen3GuardCategories = map[string]qwen3GuardCategory{
	"Violent":                       {category: "weapons", inPolicy: true},
	"Non-violent Illegal Acts":      {category: "other", inPolicy: true},
	"Sexual Content or Sexual Acts": {category: "sexual", inPolicy: true},
	"Suicide & Self-Harm":           {category: "self_harm", inPolicy: true},
	"PII":                           {category: "other"},
	"Unethical Acts":                {category: "other"},
	"Politically Sensitive Topics":  {category: "other"},
	"Copyright Violation":           {category: "other"},
	"Jailbreak":                     {category: "other"},
}

// ParseQwen3GuardVerdict reads a Qwen3Guard-Gen prompt moderation reply, a
// "Safety: Safe|Unsafe|Controversial" line and a "Categories: ..." line of
// comma-separated names or None, into a verdict. A "Refusal:" line belongs to
// response moderation and is ignored. A reply without exactly one known
// Safety line is ErrUnparseable. The reason of a non-safe verdict is the
// categories Qwen3Guard named, since it gives no other explanation.
func ParseQwen3GuardVerdict(reply string) (Verdict, error) {
	var verdict Verdict
	var names []string
	for line := range strings.SplitSeq(reply, "\n") {
		line = strings.TrimSpace(line)
		if value, ok := strings.CutPrefix(line, "Safety:"); ok {
			if verdict.Level != "" {
				return Verdict{}, fmt.Errorf("%w: more than one Safety line", ErrUnparseable)
			}
			verdict.Level = strings.ToLower(strings.TrimSpace(value))
			continue
		}
		value, ok := strings.CutPrefix(line, "Categories:")
		if !ok {
			continue
		}
		for name := range strings.SplitSeq(value, ",") {
			name = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(name), "."))
			if name != "" && name != "None" {
				names = append(names, name)
			}
		}
	}
	switch verdict.Level {
	case LevelSafe:
		return verdict, nil
	case LevelControversial, LevelUnsafe:
	case "":
		return Verdict{}, fmt.Errorf("%w: no Safety line", ErrUnparseable)
	default:
		return Verdict{}, fmt.Errorf("%w: unknown Safety level %q", ErrUnparseable, verdict.Level)
	}
	verdict.Category, verdict.Reason = "other", truncateRunes(strings.Join(names, ", "), maxReasonRunes)
	inPolicy, unknown := "", false
	for _, name := range names {
		mapped, known := qwen3GuardCategories[name]
		switch {
		case !known:
			unknown = true
		case mapped.inPolicy && inPolicy == "":
			inPolicy = mapped.category
		}
	}
	switch {
	case inPolicy != "":
		verdict.Category = inPolicy
	case len(names) > 0 && !unknown:
		verdict.Level = LevelControversial
	}
	return verdict, nil
}
