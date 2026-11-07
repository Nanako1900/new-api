package service

import (
	"errors"
	"fmt"
	"html"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
)

type EmailRegistrationData struct {
	FlowToken string `json:"flow_token"`
	Email     string `json:"email"`
	ExpiresAt int64  `json:"expires_at"`
	ResendAt  int64  `json:"resend_at"`
}

// StartEmailRegistration sends a sign-up code to an address that has no
// account yet. An address that already belongs to an account (soft-deleted
// accounts included) gets a notice instead, and its flow can never be
// verified. Both cases do the same work and return the same data, so the
// response does not reveal whether the address is registered. email must come
// from ValidateAccountEmail.
func StartEmailRegistration(email string, lang string) (*EmailRegistrationData, error) {
	taken := false
	if err := model.EnsureEmailAvailable(email, 0); err != nil {
		if !errors.Is(err, model.ErrEmailAlreadyTaken) {
			return nil, err
		}
		taken = true
	}
	// Hash a code even for a registered address so both cases take as long.
	codes, err := generateEmailBindingCodes(false)
	if err != nil {
		return nil, err
	}
	state := model.EmailRegistrationState{Email: email, CodeHash: codes.NewHash}
	if taken {
		state.CodeHash = ""
	}
	payload, err := common.Marshal(state)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	token, flow, err := model.CreateAuthFlow(model.AuthFlowCreate{
		Purpose: model.AuthFlowPurposeEmailRegistration, Payload: string(payload), ExpiresAt: now.Add(model.EmailRegistrationCodeTTL),
	})
	if err != nil {
		return nil, err
	}
	systemName := map[string]any{"SystemName": common.SystemName}
	subject := i18n.Translate(lang, i18n.MsgEmailVerificationSubject, systemName)
	content := fmt.Sprintf("<p>%s</p><p>%s</p><p>%s</p>",
		i18n.Translate(lang, i18n.MsgEmailVerificationGreeting, systemName),
		i18n.Translate(lang, i18n.MsgEmailVerificationCode, map[string]any{"Code": html.EscapeString(codes.New)}),
		i18n.Translate(lang, i18n.MsgEmailVerificationValidity, map[string]any{"Minutes": int(model.EmailRegistrationCodeTTL / time.Minute)}))
	if taken {
		subject = i18n.Translate(lang, i18n.MsgEmailRegistrationNoticeSubject, systemName)
		content = fmt.Sprintf("<p>%s</p><p>%s</p>",
			i18n.Translate(lang, i18n.MsgEmailRegistrationNoticeAttempt, systemName),
			i18n.Translate(lang, i18n.MsgEmailRegistrationNoticeAdvice))
	}
	if err := common.SendEmail(subject, email, content); err != nil {
		// The provider error may name hosts or accounts; it stays in the server
		// log. A flow whose mail was not delivered must not stay usable.
		common.SysError(common.LogText("failed to send registration verification email: %v", err))
		if _, consumeErr := model.ConsumeAuthFlow(token, model.AuthFlowMatch{Purpose: model.AuthFlowPurposeEmailRegistration}); consumeErr != nil {
			common.SysError(common.LogText("failed to close undelivered registration flow: %v", consumeErr))
		}
		return nil, ErrEmailBindingDelivery
	}
	return &EmailRegistrationData{
		FlowToken: token, Email: email, ExpiresAt: flow.ExpiresAt.Unix(),
		ResendAt: now.Add(model.EmailRegistrationResendDelay).Unix(),
	}, nil
}

// VerifiedEmailRegistration returns the address proven by a verified, unused
// registration flow token, re-applying the site's email policy in case it
// changed after verification. It does not consume the token.
func VerifiedEmailRegistration(token string) (string, error) {
	flow, err := model.GetAuthFlow(token, model.AuthFlowMatch{Purpose: model.AuthFlowPurposeEmailRegistration})
	if err != nil {
		if errors.Is(err, model.ErrAuthFlowInvalid) || errors.Is(err, model.ErrAuthFlowExpired) || errors.Is(err, model.ErrAuthFlowConsumed) {
			return "", model.ErrEmailRegistrationInvalid
		}
		return "", err
	}
	var state model.EmailRegistrationState
	if err := common.UnmarshalJsonStr(flow.Payload, &state); err != nil || !state.Verified {
		return "", model.ErrEmailRegistrationInvalid
	}
	return ValidateAccountEmail(state.Email)
}

// CompleteEmailRegistration creates user with the address verified by the
// registration flow token and consumes the flow.
func CompleteEmailRegistration(token string, user *model.User, inviterId int, defaultToken *model.Token) error {
	email, err := VerifiedEmailRegistration(token)
	if err != nil {
		return err
	}
	return model.CompleteEmailRegistration(token, email, user, inviterId, defaultToken)
}
