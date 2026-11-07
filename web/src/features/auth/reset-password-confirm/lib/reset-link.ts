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
import { getServerErrorSources } from '@/lib/server-error-message'

/**
 * Where the inline script in index.html puts the token from an emailed reset
 * link, so the token leaves the address bar before any analytics script runs.
 * Keep in sync with that script.
 */
export const PASSWORD_RESET_TOKEN_STORAGE_KEY = 'newapi:password-reset-token'

/** The token index.html moved out of the URL, if any. Does not remove it. */
export function readStoredPasswordResetToken(): string {
  try {
    return sessionStorage.getItem(PASSWORD_RESET_TOKEN_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** The server's answer for a missing, expired, used or outdated link. */
export const PASSWORD_RESET_LINK_INVALID =
  'This password reset link is invalid or has expired. Request a new one.'

/** Error code of a new password the server's password policy rejects. */
const PASSWORD_POLICY_REJECTED = 'PASSWORD_POLICY_REJECTED'

export type PasswordResetFailure =
  | { kind: 'invalid-link' }
  | { kind: 'password-policy'; messageKey: string }
  | { kind: 'other' }

/**
 * Sort a failed reset request (a `success: false` response or the error a
 * rejected request threw) into what the page answers in place.
 */
export function classifyPasswordResetFailure(
  failure: unknown
): PasswordResetFailure {
  for (const source of getServerErrorSources(failure)) {
    const messageKey =
      typeof source.message_key === 'string' ? source.message_key : ''
    if (messageKey === PASSWORD_RESET_LINK_INVALID) {
      return { kind: 'invalid-link' }
    }
    if (source.code === PASSWORD_POLICY_REJECTED && messageKey) {
      return { kind: 'password-policy', messageKey }
    }
  }
  return { kind: 'other' }
}
