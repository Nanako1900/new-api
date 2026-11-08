package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const PasswordResetTTL = 30 * time.Minute

// ErrPasswordResetInvalid covers a missing, consumed or expired reset link and
// an account that is no longer enabled or no longer uses the address the link
// was sent to, so callers cannot tell these states apart.
var ErrPasswordResetInvalid = errors.New("This password reset link is invalid or has expired. Request a new one.")

// PasswordResetState is server-owned payload and is never returned to the
// client. Email is the normalized address the link was sent to.
type PasswordResetState struct {
	Email string `json:"email"`
}

// CreatePasswordReset stores a reset flow for the account and returns the
// token for the emailed link. Only an HMAC of the token is stored.
func CreatePasswordReset(userId int, email string) (string, *AuthFlow, error) {
	if userId <= 0 || email == "" || email != NormalizeEmail(email) {
		return "", nil, ErrPasswordResetInvalid
	}
	payload, err := common.Marshal(PasswordResetState{Email: email})
	if err != nil {
		return "", nil, err
	}
	return CreateAuthFlow(AuthFlowCreate{
		Purpose: AuthFlowPurposePasswordReset, UserId: userId, Payload: string(payload), ExpiresAt: time.Now().Add(PasswordResetTTL),
	})
}

// GetPasswordReset checks a reset link without consuming it and returns the
// address it was sent to.
func GetPasswordReset(token string) (*AuthFlow, string, error) {
	flow, err := GetAuthFlow(token, AuthFlowMatch{Purpose: AuthFlowPurposePasswordReset})
	if err != nil {
		if errors.Is(err, ErrAuthFlowInvalid) || errors.Is(err, ErrAuthFlowExpired) || errors.Is(err, ErrAuthFlowConsumed) {
			return nil, "", ErrPasswordResetInvalid
		}
		return nil, "", err
	}
	state, err := parsePasswordResetState(flow)
	if err != nil {
		return nil, "", err
	}
	var user User
	if err := DB.Select("id", "email", "status").Where("id = ?", flow.UserId).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, "", ErrPasswordResetInvalid
		}
		return nil, "", err
	}
	if user.Status != common.UserStatusEnabled || NormalizeEmail(user.Email) != state.Email {
		return nil, "", ErrPasswordResetInvalid
	}
	return flow, state.Email, nil
}

// CompletePasswordReset stores passwordHash for the account of the reset link,
// bumps its auth version and consumes this and every other outstanding reset
// link of the account in one transaction. It returns the account; the caller
// revokes its sessions and notifies it after the commit.
func CompletePasswordReset(token, passwordHash string) (*User, error) {
	if passwordHash == "" {
		return nil, ErrPasswordResetInvalid
	}
	pending, _, err := GetPasswordReset(token)
	if err != nil {
		return nil, err
	}
	var user User
	err = DB.Transaction(func(tx *gorm.DB) error {
		// Lock the account before its flows, the order account deletion uses,
		// so two outstanding links of one account completed at once queue up
		// instead of deadlocking on each other's flow rows.
		if err := lockForUpdate(tx).Where("id = ?", pending.UserId).First(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrPasswordResetInvalid
			}
			return err
		}
		state, err := lockPasswordResetWithTx(tx, token, user.Id)
		if err != nil {
			return err
		}
		if user.Status != common.UserStatusEnabled || NormalizeEmail(user.Email) != state.Email {
			return ErrPasswordResetInvalid
		}
		if _, err := IncrementUserAuthVersionWithTx(tx, user.Id); err != nil {
			return err
		}
		if err := tx.Model(&User{}).Where("id = ?", user.Id).Update("password", passwordHash).Error; err != nil {
			return err
		}
		return tx.Model(&AuthFlow{}).
			Where("purpose = ? AND user_id = ? AND consumed_at IS NULL", AuthFlowPurposePasswordReset, user.Id).
			Update("consumed_at", time.Now()).Error
	})
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func lockPasswordResetWithTx(tx *gorm.DB, token string, userId int) (*PasswordResetState, error) {
	match := AuthFlowMatch{Purpose: AuthFlowPurposePasswordReset, UserId: userId}
	// Claim the flow row with a write, as lockEmailRegistrationWithTx does. A
	// no-op update locks the row on MySQL and PostgreSQL; do not interpret
	// dialect-dependent RowsAffected as success.
	if err := applyAuthFlowMatch(tx.Model(&AuthFlow{}), token, match).
		Where("consumed_at IS NULL AND expires_at > ?", time.Now()).
		UpdateColumn("payload", gorm.Expr("payload")).Error; err != nil {
		return nil, err
	}
	var flow AuthFlow
	if err := applyAuthFlowMatch(tx, token, match).First(&flow).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPasswordResetInvalid
		}
		return nil, err
	}
	if flow.ConsumedAt != nil || !flow.ExpiresAt.After(time.Now()) {
		return nil, ErrPasswordResetInvalid
	}
	return parsePasswordResetState(&flow)
}

func parsePasswordResetState(flow *AuthFlow) (*PasswordResetState, error) {
	var state PasswordResetState
	if err := common.UnmarshalJsonStr(flow.Payload, &state); err != nil || flow.UserId <= 0 || state.Email == "" || state.Email != NormalizeEmail(state.Email) {
		return nil, ErrPasswordResetInvalid
	}
	return &state, nil
}
