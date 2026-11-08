package model

import (
	"errors"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	EmailRegistrationCodeTTL     = 10 * time.Minute
	EmailRegistrationCompleteTTL = 30 * time.Minute
	EmailRegistrationResendDelay = time.Minute
	EmailRegistrationMaxAttempts = 5
)

// ErrEmailRegistrationInvalid covers a missing, consumed, expired or already
// verified registration flow so callers cannot tell these states apart.
var ErrEmailRegistrationInvalid = errors.New("Email verification expired or is invalid. Please verify your email again.")

// EmailRegistrationState is server-owned payload and is never returned to the
// client. CodeHash is empty for an address that already belongs to an account,
// so that flow can never be verified.
type EmailRegistrationState struct {
	Email          string `json:"email"`
	CodeHash       string `json:"code_hash"`
	FailedAttempts int    `json:"failed_attempts"`
	Verified       bool   `json:"verified"`
	VerifiedAt     int64  `json:"verified_at"`
}

// emailRegistrationDecoyHash is compared when a flow has no code hash, so a
// registered address takes as long to reject as a wrong code for a free one.
var emailRegistrationDecoyHash = sync.OnceValue(func() string {
	hash, err := common.Password2Hash(common.GetRandomString(32))
	if err != nil {
		return ""
	}
	return hash
})

// VerifyEmailRegistration checks the emailed code. Failed attempts are
// committed even though verification fails; success clears the code hash and
// gives the caller EmailRegistrationCompleteTTL to choose the account details.
func VerifyEmailRegistration(token, code string) (*AuthFlow, *EmailRegistrationState, error) {
	if token == "" {
		return nil, nil, ErrEmailRegistrationInvalid
	}
	var flow *AuthFlow
	var state *EmailRegistrationState
	var verificationError error
	err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		flow, state, err = lockEmailRegistrationWithTx(tx, token)
		if err != nil {
			return err
		}
		if state.Verified {
			return ErrEmailRegistrationInvalid
		}
		if state.FailedAttempts >= EmailRegistrationMaxAttempts {
			return ErrEmailBindingLocked
		}
		code, codeError := common.ValidateNumericCode(code)
		hash := state.CodeHash
		if hash == "" {
			hash = emailRegistrationDecoyHash()
		}
		if codeError != nil || !common.ValidatePasswordAndHash(code, hash) || state.CodeHash == "" {
			state.FailedAttempts++
			verificationError = ErrEmailBindingCodeInvalid
			if state.FailedAttempts >= EmailRegistrationMaxAttempts {
				verificationError = ErrEmailBindingLocked
			}
			payload, err := common.Marshal(state)
			if err != nil {
				return err
			}
			return tx.Model(flow).Update("payload", string(payload)).Error
		}
		now := time.Now()
		state.Verified, state.VerifiedAt, state.CodeHash = true, now.Unix(), ""
		payload, err := common.Marshal(state)
		if err != nil {
			return err
		}
		flow.ExpiresAt = now.Add(EmailRegistrationCompleteTTL)
		return tx.Model(flow).Updates(map[string]any{"payload": string(payload), "expires_at": flow.ExpiresAt}).Error
	})
	if err != nil {
		return nil, nil, err
	}
	if verificationError != nil {
		return nil, nil, verificationError
	}
	return flow, state, nil
}

// CompleteEmailRegistration creates user with the verified address of the
// flow and consumes the flow in the same transaction. defaultToken, when not
// nil, is created for the new user in that transaction too.
func CompleteEmailRegistration(token, email string, user *User, inviterId int, defaultToken *Token) error {
	if token == "" || email == "" || email != NormalizeEmail(email) {
		return ErrEmailRegistrationInvalid
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		// Acquire ownership protection before the first consistent read. Under
		// MySQL REPEATABLE READ, a snapshot created before this lock could hide
		// an address claimed by a concurrent transaction while we were waiting.
		if err := lockNormalizedEmail(tx, email); err != nil {
			return err
		}
		flow, state, err := lockEmailRegistrationWithTx(tx, token)
		if err != nil {
			return err
		}
		if !state.Verified || state.Email != email {
			return ErrEmailRegistrationInvalid
		}
		user.Email = email
		if err := user.InsertWithTx(tx, inviterId); err != nil {
			return err
		}
		if defaultToken != nil {
			defaultToken.UserId = user.Id
			if err := tx.Create(defaultToken).Error; err != nil {
				return err
			}
		}
		return tx.Model(flow).Update("consumed_at", time.Now()).Error
	})
}

func lockEmailRegistrationWithTx(tx *gorm.DB, token string) (*AuthFlow, *EmailRegistrationState, error) {
	match := AuthFlowMatch{Purpose: AuthFlowPurposeEmailRegistration}
	// Make the first statement a write so SQLite does not have to upgrade a
	// deferred read transaction. A no-op update also locks the row on MySQL and
	// PostgreSQL; do not interpret dialect-dependent RowsAffected as success.
	if err := applyAuthFlowMatch(tx.Model(&AuthFlow{}), token, match).
		Where("consumed_at IS NULL AND expires_at > ?", time.Now()).
		UpdateColumn("payload", gorm.Expr("payload")).Error; err != nil {
		return nil, nil, err
	}
	var flow AuthFlow
	if err := applyAuthFlowMatch(tx, token, match).First(&flow).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrEmailRegistrationInvalid
		}
		return nil, nil, err
	}
	if flow.ConsumedAt != nil || !flow.ExpiresAt.After(time.Now()) {
		return nil, nil, ErrEmailRegistrationInvalid
	}
	var state EmailRegistrationState
	if err := common.UnmarshalJsonStr(flow.Payload, &state); err != nil || state.Email == "" || state.Email != NormalizeEmail(state.Email) {
		return nil, nil, ErrEmailRegistrationInvalid
	}
	return &flow, &state, nil
}
