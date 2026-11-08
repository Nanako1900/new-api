package service

import (
	"errors"
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
)

// SendPasswordResetLink mails a link for choosing a new password when exactly
// one enabled account uses email. Any other address gets no mail and no error,
// so the caller can treat every address alike. email must be normalized; the
// link is valid only while the account still uses it. statedLang is the
// language the request stated, used unless the account saved one.
// serverAddress is the console origin the link points to. It may run outside
// the request, so it takes no request context.
func SendPasswordResetLink(email, statedLang, serverAddress string) error {
	user, err := model.GetUniqueUserByEmail(email)
	if err != nil {
		if errors.Is(err, model.ErrEmailNotFound) || errors.Is(err, model.ErrEmailAmbiguous) {
			return nil
		}
		return err
	}
	if user.Status != common.UserStatusEnabled {
		return nil
	}
	token, _, err := model.CreatePasswordReset(user.Id, email)
	if err != nil {
		return err
	}
	lang := user.GetSetting().Language
	if lang == "" {
		lang = statedLang
	}
	// The address of the account stays out of the link: the token alone
	// identifies the reset, and URLs end up in logs and browser history.
	link := map[string]any{"Link": html.EscapeString(strings.TrimSuffix(serverAddress, "/") + "/user/reset?token=" + token)}
	systemName := map[string]any{"SystemName": common.SystemName}
	subject := i18n.Translate(lang, i18n.MsgEmailPasswordResetSubject, systemName)
	content := fmt.Sprintf("<p>%s</p><p>%s</p><p>%s</p><p>%s</p><p>%s</p>",
		i18n.Translate(lang, i18n.MsgEmailPasswordResetGreeting, systemName),
		i18n.Translate(lang, i18n.MsgEmailPasswordResetAction, link),
		i18n.Translate(lang, i18n.MsgEmailPasswordResetLinkFallback, link),
		i18n.Translate(lang, i18n.MsgEmailPasswordResetValidity, map[string]any{"Minutes": int(model.PasswordResetTTL / time.Minute)}),
		i18n.Translate(lang, i18n.MsgEmailPasswordResetIgnore))
	if err := common.SendEmail(subject, email, content); err != nil {
		// A link that was not delivered must not stay usable.
		if _, consumeErr := model.ConsumeAuthFlow(token, model.AuthFlowMatch{Purpose: model.AuthFlowPurposePasswordReset, UserId: user.Id}); consumeErr != nil {
			common.SysError(common.LogText("failed to close undelivered password reset flow of user %d: %v", user.Id, consumeErr))
		}
		return fmt.Errorf("send password reset email to user %d: %w", user.Id, err)
	}
	return nil
}

// CompletePasswordReset sets password, which must already satisfy the
// password policy, on the account of the reset link and consumes every
// outstanding reset link of that account. It returns the account.
func CompletePasswordReset(token, password string) (*model.User, error) {
	// Reject unusable links before spending a password hash on them.
	if _, _, err := model.GetPasswordReset(token); err != nil {
		return nil, err
	}
	hash, err := common.HashAccountPassword(password)
	if err != nil {
		return nil, err
	}
	return model.CompletePasswordReset(token, hash)
}
