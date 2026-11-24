package relay

import (
	"context"
	"crypto/rand"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service/contentsafety"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

const (
	// Reasoning models spend part of max_tokens on hidden reasoning before
	// the JSON reply, so the llm_json budget leaves room well beyond the
	// reply itself.
	llmJSONReviewMaxTokens = uint(1024)
	// A Qwen3Guard reply is two short lines.
	qwen3GuardReviewMaxTokens = uint(128)
)

// reviewRequestMessages builds the chat messages and the reply budget of one
// review call to engine.
//
// llm_json sends the review prompt with its reply contract as the system
// message and the unit, fenced as data, as the user message.
//
// qwen3guard sends what the chat template of Qwen3Guard-Gen moderates: user
// turns and no system prompt of ours, of which it judges only the last. The
// unit goes last; its context, the user's earlier message, goes before it as
// a turn of its own, so it is read but not judged. Every unit is judged as
// prompt input, assistant and tool text included, because all of it goes to
// the upstream provider as input.
func reviewRequestMessages(engine, prompt string, unit contentsafety.Unit) ([]dto.Message, uint, error) {
	if engine == operation_setting.ContentReviewEngineQwen3Guard {
		messages := make([]dto.Message, 0, 2)
		if unit.Context != "" {
			messages = append(messages, dto.Message{Role: "user", Content: unit.Context})
		}
		return append(messages, dto.Message{Role: "user", Content: unit.Text}), qwen3GuardReviewMaxTokens, nil
	}
	system, user, err := contentsafety.ReviewMessages(prompt, []contentsafety.Unit{unit}, rand.Text())
	if err != nil {
		return nil, 0, err
	}
	return []dto.Message{{Role: "system", Content: system}, {Role: "user", Content: user}}, llmJSONReviewMaxTokens, nil
}

// parseReviewReply reads the verdict on one unit from a reply of engine.
// Anything else than a complete verdict is contentsafety.ErrUnparseable.
func parseReviewReply(engine, reply string) (contentsafety.Verdict, error) {
	if engine == operation_setting.ContentReviewEngineQwen3Guard {
		return contentsafety.ParseQwen3GuardVerdict(reply)
	}
	verdicts, err := contentsafety.ParseVerdicts(reply, 1)
	if err != nil {
		return contentsafety.Verdict{}, err
	}
	return verdicts[0], nil
}

// escalateReview asks the escalation model, with the llm_json engine, about
// a unit the first reviewer found controversial or refused to read, within
// the same ctx. Its verdict replaces the first one. An escalation that does
// not conclude, or that its channel refuses too, keeps the first verdict.
func escalateReview(ctx context.Context, requestId string, cfg operation_setting.ContentSafetySetting, prompt string, first unitReview) unitReview {
	escalation := cfg
	escalation.ReviewEngine, escalation.ReviewGroup, escalation.ReviewModel = operation_setting.ContentReviewEngineLLMJSON, cfg.EscalateGroup, cfg.EscalateModel
	second := reviewUnitOnChannels(ctx, requestId, escalation, prompt, first.unit)
	if second.failure != "" || second.refused {
		reason := second.failure
		if reason == "" {
			reason = model.ContentSafetyFailureRefused
		}
		common.SysLog(common.LogText("content safety escalation to %s kept the first verdict (request_id=%s): %s: %q", cfg.EscalateModel, requestId, reason, second.detail))
		escalation := fmt.Sprintf("escalation to %s kept the first verdict: %s", cfg.EscalateModel, reason)
		if second.detail != "" {
			escalation += ": " + second.detail
		}
		if first.detail != "" {
			escalation = first.detail + "; " + escalation
		}
		first.detail = escalation
		first.tokens += second.tokens
		return first
	}
	second.tokens += first.tokens
	second.escalatedModel = cfg.EscalateModel
	return second
}

// escalatedModelOf names the escalation model when it gave any of reviews.
func escalatedModelOf(reviews []unitReview) string {
	for _, review := range reviews {
		if review.escalatedModel != "" {
			return review.escalatedModel
		}
	}
	return ""
}
