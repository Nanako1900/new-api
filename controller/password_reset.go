package controller

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

const passwordResetInvalidKey = "This password reset link is invalid or has expired. Request a new one."

// PasswordResetStart answers every well-formed address the same way at once.
// Looking up the account and mailing the link happen afterwards, so neither
// the response nor its timing shows whether the address has an account.
func PasswordResetStart(c *gin.Context) {
	var request struct {
		Email string `json:"email"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	email := model.NormalizeEmail(request.Email)
	if err := common.Validate.Var(email, "required,email"); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if !middleware.AllowEmailVerificationAddress(c, email) {
		common.ApiErrorStatus(c, http.StatusTooManyRequests, common.NewMessage("Please wait before requesting another verification code."))
		return
	}
	// The task outlives the request and gin reuses the context, so read what
	// the mail needs now. The page states its language in Accept-Language.
	lang, serverAddress := i18n.StatedLang(c), system_setting.ServerAddress
	gopool.Go(func() {
		if err := service.SendPasswordResetLink(email, lang, serverAddress); err != nil {
			common.SysError(common.LogText("failed to send password reset link: %v", err))
		}
	})
	common.ApiSuccess(c, nil)
}

// PasswordResetVerify reports whether a reset link can still be used, and the
// masked address it was sent to. It does not consume the link.
func PasswordResetVerify(c *gin.Context) {
	var request struct {
		Token string `json:"token"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	flow, email, err := model.GetPasswordReset(request.Token)
	switch {
	case err == nil:
		common.ApiSuccess(c, gin.H{"email": common.MaskEmail(email), "expires_at": flow.ExpiresAt.Unix()})
	case errors.Is(err, model.ErrPasswordResetInvalid):
		common.ApiErrorT(c, passwordResetInvalidKey)
	default:
		logger.LogError(c.Request.Context(), common.LogText("failed to check password reset link: %v", err))
		common.ApiErrorT(c, "Database error, please contact the administrator")
	}
}

// PasswordResetComplete sets the password the user chose, ends every session
// of the account and notifies it. The user then signs in normally, so the
// reset never bypasses two-factor authentication or passkeys.
func PasswordResetComplete(c *gin.Context) {
	var request struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := common.ValidateNewAccountPassword(request.Password); err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	user, err := service.CompletePasswordReset(request.Token, request.Password)
	switch {
	case err == nil:
	case errors.Is(err, model.ErrPasswordResetInvalid):
		common.ApiErrorT(c, passwordResetInvalidKey)
		return
	case errors.Is(err, common.ErrAccountPasswordLength), errors.Is(err, common.ErrPasswordLegacyLimit):
		writeSecurityOperationError(c, err)
		return
	default:
		logger.LogError(c.Request.Context(), common.LogText("failed to complete password reset: %v", err))
		common.ApiErrorT(c, "Database error, please contact the administrator")
		return
	}
	// The committed auth version already rejects every older session; these
	// steps make that visible at once, so their failures are only logged.
	if err := model.PublishUserAuthCache(user.Id); err != nil {
		logger.LogError(c.Request.Context(), common.LogText("failed to publish auth cache after password reset of user %d: %v", user.Id, err))
	}
	if _, err := model.RevokeAllUserSessions(user.Id, "password_reset"); err != nil {
		logger.LogError(c.Request.Context(), common.LogText("failed to revoke sessions after password reset of user %d: %v", user.Id, err))
	}
	notificationFailed := false
	if err := service.NotifyAccountSecurityChange(service.AccountMailLanguage(c, user.Id), user.Email, i18n.MsgSecurityEventPasswordUpdated); err != nil {
		notificationFailed = true
		logger.LogError(c.Request.Context(), common.LogText("failed to send password reset notice to user %d: %v", user.Id, err))
	}
	recordUserSecurityAudit(c, user.Id, "user.password_change", map[string]any{"success": true, "method": "password_reset", "notification_failed": notificationFailed})
	common.ApiSuccess(c, nil)
}
