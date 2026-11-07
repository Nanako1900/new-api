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
import axios from 'axios'

import { api, refreshAuthentication, type RefreshOutcome } from '@/lib/api'
import { captchaHeaders } from '@/lib/captcha'
import { AuthOperationError } from '@/lib/secure-verification'
import {
  getServerErrorMessageKey,
  getServerMessage,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  clearPasswordEncryptionCache,
  encryptPassword,
} from './lib/password-encryption'
import { getAffiliateCode } from './lib/storage'
import type { TelegramAuthorization } from './lib/telegram-login'
import type { VerificationOperation } from './secure-verification/types'
import type {
  LoginPayload,
  LoginResponse,
  Login2FAResponse,
  TwoFAPayload,
  RegisterPayload,
  PasswordResetLink,
  RegistrationEmailFlow,
  VerifiedRegistrationEmail,
  ApiResponse,
} from './types'

// ============================================================================
// Authentication APIs
// ============================================================================

// ----------------------------------------------------------------------------
// Login & Logout
// ----------------------------------------------------------------------------

// User login with username and password
export async function login(payload: LoginPayload): Promise<LoginResponse> {
  try {
    let passwordFields:
      | { password: string }
      | { password_encrypted: string; encryption_key_id: string }
    if (payload.passwordEncryptionEnabled) {
      const encryptedPassword = await encryptPassword(payload.password)
      passwordFields = {
        password_encrypted: encryptedPassword.password_encrypted,
        encryption_key_id: encryptedPassword.encryption_key_id,
      }
    } else {
      passwordFields = { password: payload.password }
    }
    const res = await api.post<LoginResponse>(
      '/api/user/login',
      {
        username: payload.username,
        ...passwordFields,
      },
      { skipAuthRefresh: true, headers: captchaHeaders(payload.captcha) }
    )
    if (payload.passwordEncryptionEnabled && !res.data?.success) {
      clearPasswordEncryptionCache()
    }
    return res.data
  } catch (error: unknown) {
    if (payload.passwordEncryptionEnabled) {
      clearPasswordEncryptionCache()
    }
    throw error
  }
}

// Two-factor authentication login
export async function login2fa(payload: TwoFAPayload) {
  const res = await api.post<Login2FAResponse>('/api/user/login/2fa', payload, {
    skipAuthRefresh: true,
  })
  return res.data
}

interface LogoutRuntime {
  getExpectedSID: () => string | undefined
  request: (expectedSID?: string) => Promise<ApiResponse>
  refresh: () => Promise<RefreshOutcome>
}

export async function executeLogout(
  runtime: LogoutRuntime,
  allowMismatchRecovery = true
): Promise<ApiResponse> {
  try {
    return await runtime.request(runtime.getExpectedSID())
  } catch (error: unknown) {
    const code = axios.isAxiosError(error)
      ? error.response?.data?.code
      : undefined
    if (
      allowMismatchRecovery &&
      axios.isAxiosError(error) &&
      error.response?.status === 409 &&
      code === 'AUTH_SESSION_MISMATCH'
    ) {
      const outcome = await runtime.refresh()
      if (outcome.kind === 'authenticated') {
        return executeLogout(runtime, false)
      }
      if (outcome.kind === 'anonymous') {
        return { success: true, message: '' }
      }
    }
    throw error
  }
}

// User logout
export async function logout(): Promise<ApiResponse> {
  return executeLogout({
    getExpectedSID: () => useAuthStore.getState().auth.session?.sid,
    request: async (sid) => {
      const res = await api.post('/api/user/auth/logout', undefined, {
        headers: sid ? { 'X-Auth-Session': sid } : undefined,
        skipAuthRefresh: true,
        skipErrorHandler: true,
      })
      return res.data
    },
    refresh: refreshAuthentication,
  })
}

// ----------------------------------------------------------------------------
// Password Management
// ----------------------------------------------------------------------------

// Ask for a password reset link. The answer is the same whether or not an
// account uses the address; the email stays out of the URL.
export async function sendPasswordResetEmail(
  email: string,
  captcha?: string
): Promise<ApiResponse> {
  const res = await api.post(
    '/api/user/password-reset/start',
    { email },
    { skipAuthRefresh: true, headers: captchaHeaders(captcha) }
  )
  return res.data
}

// Check a reset link token without spending it; answers the masked address.
export async function verifyPasswordResetToken(
  token: string
): Promise<ApiResponse<PasswordResetLink>> {
  const res = await api.post(
    '/api/user/password-reset/verify',
    { token },
    { skipAuthRefresh: true }
  )
  return res.data
}

// Set the new password and spend the token. Signs out every session and does
// not sign the user in.
export async function completePasswordReset(
  token: string,
  password: string
): Promise<ApiResponse> {
  const res = await api.post(
    '/api/user/password-reset/complete',
    { token, password },
    { skipAuthRefresh: true }
  )
  return res.data
}

// ----------------------------------------------------------------------------
// OAuth
// ----------------------------------------------------------------------------

// Start GitHub OAuth flow
export async function githubOAuthStart(clientId: string, state: string) {
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&state=${state}&scope=user:email`
  window.open(url)
}

// Get OAuth state for CSRF protection
export async function createOAuthAuthorization(
  provider: string,
  intent: 'login' | 'bind' | 'verify',
  operation?: VerificationOperation,
  signal?: AbortSignal,
  proofToken?: string
): Promise<{ state: string; authorizationUrl?: string }> {
  const aff = intent === 'login' ? getAffiliateCode() : ''
  const res = await api.post(
    '/api/oauth/state',
    {
      provider,
      intent,
      aff: aff || undefined,
      scope: operation?.scope,
      ...(operation?.context ? { context: operation.context } : {}),
    },
    {
      skipAuthRefresh: intent === 'login',
      ...(proofToken ? { headers: { 'X-Security-Proof': proofToken } } : {}),
      singleUseAuthorization: intent === 'bind',
      signal,
      skipBusinessError: true,
      skipErrorHandler: true,
    }
  )
  if (res.data?.success) {
    if (typeof res.data.data === 'string') return { state: res.data.data }
    if (typeof res.data.data?.flow_token === 'string') {
      return {
        state: res.data.data.flow_token,
        authorizationUrl: res.data.data.authorization_url,
      }
    }
  }
  throw new AuthOperationError(
    getServerErrorMessageKey(res.data) ||
      getServerMessage(res.data) ||
      'Failed to initialize OAuth',
    res.data?.code
  )
}

export async function createOAuthFlow(
  provider: string,
  intent: 'login' | 'bind' | 'verify',
  operation?: VerificationOperation,
  signal?: AbortSignal
): Promise<string> {
  return (await createOAuthAuthorization(provider, intent, operation, signal))
    .state
}

// WeChat login by authorization code
export async function wechatLoginByCode(code: string): Promise<ApiResponse> {
  const res = await api.get('/api/oauth/wechat', { params: { code } })
  return res.data
}

export async function telegramLogin(
  authorization: TelegramAuthorization
): Promise<ApiResponse> {
  const res = await api.get('/api/oauth/telegram/login', {
    params: authorization,
    disableDuplicate: true,
    skipAuthRefresh: true,
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  return res.data
}

// ----------------------------------------------------------------------------
// Registration
// ----------------------------------------------------------------------------

// Start the email check of a password sign-up. The answer has the same shape
// whether or not the address is already registered.
export async function startRegistrationEmail(
  email: string,
  captcha?: string
): Promise<ApiResponse<RegistrationEmailFlow>> {
  const res = await api.post(
    '/api/user/register/email/start',
    { email },
    { skipAuthRefresh: true, headers: captchaHeaders(captcha) }
  )
  return res.data
}

// Confirm the 6-digit code; the flow token then becomes the registration token.
export async function verifyRegistrationEmail(
  flowToken: string,
  code: string
): Promise<ApiResponse<VerifiedRegistrationEmail>> {
  const res = await api.post(
    '/api/user/register/email/verify',
    { flow_token: flowToken, code },
    { skipAuthRefresh: true }
  )
  return res.data
}

// Create the account with a verified registration token; a success signs the
// user in and answers like login (session bundle or verification challenge).
export async function register(
  payload: RegisterPayload
): Promise<LoginResponse> {
  const res = await api.post<LoginResponse>('/api/user/register', payload, {
    skipAuthRefresh: true,
  })
  return res.data
}

// Confirm an authenticated, server-owned email binding flow.
export async function bindEmail(
  flowToken: string,
  newCode: string,
  oldCode = '',
  signal?: AbortSignal
): Promise<ApiResponse> {
  const res = await api.post(
    '/api/oauth/email/bind',
    {
      flow_token: flowToken,
      new_code: newCode,
      old_code: oldCode,
    },
    { singleUseAuthorization: true, signal }
  )
  return res.data
}
