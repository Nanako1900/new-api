/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { z } from 'zod'

import { accountPasswordSchema } from '@/lib/password-policy'

// ============================================================================
// Form Schemas
// ============================================================================

export const loginFormSchema = z.object({
  username: z.string().min(1, 'Please enter your username or email'),
  password: z.string().min(1, 'Please enter your password'),
})

// Sign-up step 1: the address to verify (backend: valid email, at most 50).
export const registrationEmailSchema = z.object({
  email: z
    .string()
    .trim()
    .email({ message: 'Please enter a valid email address' })
    .max(50, { message: 'Please enter a valid email address' }),
})

// Sign-up step 1: the code sent to that address.
export const registrationCodeSchema = z.object({
  code: z
    .string()
    .regex(/^\d{6}$/, 'Enter the 6-digit email verification code.'),
})

const USERNAME_MAX_LENGTH = 20

// Sign-up step 2. Mirrors the backend: a trimmed username of at most 20
// characters without "@", and the shared account password policy.
export const accountSetupSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1, 'Please enter your username')
      .refine(
        (username) => [...username].length <= USERNAME_MAX_LENGTH,
        'Username must be 20 characters or fewer'
      )
      .refine(
        (username) => !username.includes('@'),
        'Username cannot contain @'
      ),
    password: accountPasswordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ['confirmPassword'],
  })

export const forgotPasswordFormSchema = z.object({
  email: z.string().email({
    message: 'Please enter a valid email address',
  }),
})

// The new password chosen on the reset link page (shared password policy).
export const passwordResetFormSchema = z
  .object({
    password: accountPasswordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ['confirmPassword'],
  })

export const otpFormSchema = z.object({
  otp: z.string().min(1, 'Please enter a code.'),
})

// ============================================================================
// Validation Constants
// ============================================================================

export const PASSWORD_MIN_LENGTH = 8
export const OTP_LENGTH = 6
// Mirrors model.EmailRegistrationResendDelay. Counted from when the code entry
// appears rather than from the server's resend_at, so device clock skew cannot
// stretch or skip the wait.
export const REGISTRATION_RESEND_SECONDS = 60
export const BACKUP_CODE_LENGTH = 9 // XXXX-XXXX format
export const BACKUP_CODE_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/i
export const OTP_REGEX = /^\d{6}$/

// ============================================================================
// Countdown Constants
// ============================================================================

// Mirrors the per-address limit of one mail a minute that the reset start
// endpoint enforces (middleware.AllowEmailVerificationAddress); a shorter
// countdown would offer a resend the server is certain to reject.
export const PASSWORD_RESET_COUNTDOWN = 60 // seconds

// ============================================================================
// OAuth Constants
// ============================================================================

export const OAUTH_POPUP_CALLBACK_MESSAGE = 'oauth:popup:callback'
export const OAUTH_POPUP_RESULT_MESSAGE = 'oauth:popup:result'
export const TELEGRAM_BIND_RESULT_MESSAGE = 'telegram:binding:result'
