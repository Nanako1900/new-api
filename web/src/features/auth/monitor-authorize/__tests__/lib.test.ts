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
import { describe, expect, test } from 'vitest'

import {
  isRetryableMonitorAuthorizeError,
  monitorAuthorizeErrorMessage,
  monitorCallbackUrl,
  parseMonitorAuthorizeRequest,
} from '../lib'

const valid = {
  redirect_uri: 'https://my.meowapi.dev/auth/callback',
  state: 'state-value_0123456789',
  // RFC 7636 Appendix B.
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
}

describe('parseMonitorAuthorizeRequest', () => {
  test('accepts a well-formed S256 sign-in link', () => {
    expect(parseMonitorAuthorizeRequest(valid)).toEqual({
      redirectUri: valid.redirect_uri,
      state: valid.state,
      codeChallenge: valid.code_challenge,
    })
  })

  test.each([
    ['a missing method', { code_challenge_method: undefined }],
    ['the plain method', { code_challenge_method: 'plain' }],
    ['a short state', { state: 'short' }],
    ['a state outside base64url', { state: 'state value 0123456789' }],
    ['a short challenge', { code_challenge: valid.code_challenge.slice(1) }],
    [
      'a callback with a query',
      { redirect_uri: `${valid.redirect_uri}?next=/` },
    ],
    ['a callback with a fragment', { redirect_uri: `${valid.redirect_uri}#x` }],
    ['a script callback', { redirect_uri: 'javascript:alert(1)' }],
    [
      'a callback with credentials',
      { redirect_uri: 'https://user:pass@my.meowapi.dev/auth/callback' },
    ],
    ['a relative callback', { redirect_uri: '/auth/callback' }],
  ])('rejects %s', (_, override) => {
    expect(parseMonitorAuthorizeRequest({ ...valid, ...override })).toBeNull()
  })
})

test('monitorCallbackUrl puts the code and state in the fragment, never in the query', () => {
  const url = new URL(
    monitorCallbackUrl(valid.redirect_uri, 'code+/=', valid.state)
  )
  expect(url.origin + url.pathname).toBe(valid.redirect_uri)
  expect(url.search).toBe('')
  const fragment = new URLSearchParams(url.hash.slice(1))
  expect(fragment.get('code')).toBe('code+/=')
  expect(fragment.get('state')).toBe(valid.state)
})

test('server error codes map to an explanation and a retry decision', () => {
  expect(monitorAuthorizeErrorMessage('MONITOR_DISABLED')).toBe(
    'The monitor console is not enabled on this site.'
  )
  expect(isRetryableMonitorAuthorizeError('MONITOR_REDIRECT_URI_INVALID')).toBe(
    false
  )
  expect(monitorAuthorizeErrorMessage(undefined)).toBe(
    'Could not sign in to the monitor console. Please try again.'
  )
  expect(isRetryableMonitorAuthorizeError(undefined)).toBe(true)
  expect(isRetryableMonitorAuthorizeError('MONITOR_INTERNAL_ERROR')).toBe(true)
})
