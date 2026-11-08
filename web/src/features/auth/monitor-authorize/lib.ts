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

// The monitor console (a separate origin) starts its sign-in here with an
// authorization code + PKCE request. The server re-validates every field; these
// checks only reject a malformed link before it reaches the server.
export const monitorAuthorizeSearchSchema = z.object({
  redirect_uri: z.string().optional(),
  state: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
})

export type MonitorAuthorizeSearch = z.infer<
  typeof monitorAuthorizeSearchSchema
>

export type MonitorAuthorizeRequest = {
  redirectUri: string
  state: string
  codeChallenge: string
}

const statePattern = /^[A-Za-z0-9_-]{16,128}$/
const challengePattern = /^[A-Za-z0-9_-]{43}$/

export const MONITOR_INVALID_LINK_MESSAGE =
  'This sign-in link is invalid. Open the monitor console again to sign in.'

const monitorErrorMessages: Record<string, string> = {
  MONITOR_DISABLED: 'The monitor console is not enabled on this site.',
  MONITOR_REDIRECT_URI_INVALID:
    'This monitor console address is not allowed to sign in.',
  MONITOR_CHALLENGE_INVALID: MONITOR_INVALID_LINK_MESSAGE,
  MONITOR_REQUEST_INVALID: MONITOR_INVALID_LINK_MESSAGE,
}

const MONITOR_UNKNOWN_ERROR_MESSAGE =
  'Could not sign in to the monitor console. Please try again.'

export function parseMonitorAuthorizeRequest(
  search: MonitorAuthorizeSearch
): MonitorAuthorizeRequest | null {
  const redirectUri = search.redirect_uri ?? ''
  const state = search.state ?? ''
  const codeChallenge = search.code_challenge ?? ''
  if (
    search.code_challenge_method !== 'S256' ||
    !statePattern.test(state) ||
    !challengePattern.test(codeChallenge)
  ) {
    return null
  }
  let callback: URL
  try {
    callback = new URL(redirectUri)
  } catch {
    return null
  }
  if (
    (callback.protocol !== 'https:' && callback.protocol !== 'http:') ||
    callback.search !== '' ||
    callback.hash !== '' ||
    callback.username !== '' ||
    callback.password !== ''
  ) {
    return null
  }
  return { redirectUri, state, codeChallenge }
}

// The code and state travel in the URL fragment: browsers never send it to a
// server, so the code cannot end up in access logs, CDN logs or Referers.
export function monitorCallbackUrl(
  redirectUri: string,
  code: string,
  state: string
): string {
  const callback = new URL(redirectUri)
  callback.hash = new URLSearchParams({ code, state }).toString()
  return callback.toString()
}

// Returns the i18n key describing a failed authorization; whether a retry can
// help is decided by the caller from the same code.
export function monitorAuthorizeErrorMessage(code: string | undefined): string {
  return (code && monitorErrorMessages[code]) || MONITOR_UNKNOWN_ERROR_MESSAGE
}

export function isRetryableMonitorAuthorizeError(
  code: string | undefined
): boolean {
  return code === undefined || !(code in monitorErrorMessages)
}
