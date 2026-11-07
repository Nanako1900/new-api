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
 * Server messages (English source keys) the sign-up steps answer in place
 * instead of with a toast.
 */
export const REGISTRATION_MESSAGES = {
  wrongCode: 'Email verification code is incorrect.',
  usernameTaken: 'Username already exists or has been deleted',
  usernameHasAt: 'Username cannot contain @',
} as const

/** These end the email check: the user starts step 1 again. */
const RESTART_MESSAGES: ReadonlySet<string> = new Set([
  'Email verification expired or is invalid. Please verify your email again.',
  'Too many incorrect codes. Start email verification again.',
])

/**
 * The message key of a failed request, from a `success: false` response or
 * from the error a rejected request threw.
 */
export function getRegistrationMessageKey(failure: unknown): string {
  for (const source of getServerErrorSources(failure)) {
    if (typeof source.message_key === 'string' && source.message_key) {
      return source.message_key
    }
  }
  return ''
}

export function endsEmailCheck(messageKey: string): boolean {
  return RESTART_MESSAGES.has(messageKey)
}
