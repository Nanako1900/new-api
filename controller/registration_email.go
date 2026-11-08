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

	"github.com/gin-gonic/gin"
)

// rejectUnavailablePasswordRegistration answers and returns true when password
// sign-up is off. Password sign-up always verifies the email address, so it is
// unavailable while no email delivery is configured.
func rejectUnavailablePasswordRegistration(c *gin.Context) bool {
	switch {
	case !common.RegisterEnabled:
		common.ApiErrorT(c, "New user registration has been disabled by administrator")
	case !common.PasswordRegisterEnabled:
		common.ApiErrorT(c, "Password registration has been disabled by administrator, please use third-party account verification")
	case !common.IsEmailDeliveryConfigured():
		common.ApiErrorT(c, "Email delivery is not configured. Password registration is unavailable.")
	default:
		return false
	}
	return true
}

// RegisterEmailStart emails a sign-up code, or a notice when the address is
// already registered; the response is the same either way.
func RegisterEmailStart(c *gin.Context) {
	if rejectUnavailablePasswordRegistration(c) {
		return
	}
	var request struct {
		Email string `json:"email"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	email, err := service.ValidateAccountEmail(request.Email)
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	if !middleware.AllowEmailVerificationAddress(c, email) {
		common.ApiErrorStatus(c, http.StatusTooManyRequests, common.NewMessage("Please wait before requesting another verification code."))
		return
	}
	// The address may not belong to an account yet, so the mail follows the
	// request language.
	data, err := service.StartEmailRegistration(email, i18n.StatedLang(c))
	if err != nil {
		if errors.Is(err, service.ErrEmailBindingDelivery) {
			common.ApiErrorT(c, "Verification email could not be sent. Start email verification again.")
			return
		}
		logger.LogError(c.Request.Context(), common.LogText("failed to start registration email verification: %v", err))
		common.ApiErrorT(c, "Database error, please contact the administrator")
		return
	}
	common.ApiSuccess(c, data)
}

// RegisterEmailVerify checks the emailed code. A verified flow token is what
// Register accepts as proof of the address.
func RegisterEmailVerify(c *gin.Context) {
	var request struct {
		FlowToken string `json:"flow_token"`
		Code      string `json:"code"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	flow, state, err := model.VerifyEmailRegistration(request.FlowToken, request.Code)
	switch {
	case err == nil:
		common.ApiSuccess(c, gin.H{"email": state.Email, "expires_at": flow.ExpiresAt.Unix()})
	case errors.Is(err, model.ErrEmailRegistrationInvalid):
		common.ApiErrorT(c, "Email verification expired or is invalid. Please verify your email again.")
	case errors.Is(err, model.ErrEmailBindingCodeInvalid):
		common.ApiErrorT(c, "Email verification code is incorrect.")
	case errors.Is(err, model.ErrEmailBindingLocked):
		common.ApiErrorT(c, "Too many incorrect codes. Start email verification again.")
	default:
		logger.LogError(c.Request.Context(), common.LogText("failed to verify registration email: %v", err))
		common.ApiErrorT(c, "Database error, please contact the administrator")
	}
}
