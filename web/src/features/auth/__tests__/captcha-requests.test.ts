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
import type { InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { api } from '@/lib/api'

import {
  login,
  register,
  sendPasswordResetEmail,
  startRegistrationEmail,
  verifyRegistrationEmail,
} from '../api'

const captchaToken = JSON.stringify({
  lot_number: 'lot',
  captcha_output: 'output',
  pass_token: 'pass',
  gen_time: '1700000000',
})

const originalAdapter = api.defaults.adapter
let sent: InternalAxiosRequestConfig[] = []

beforeEach(() => {
  sent = []
  api.defaults.adapter = async (config) => {
    sent.push(config)
    return {
      data: { success: true, message: '' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
})

function sentUrl(config: InternalAxiosRequestConfig): string {
  return api.getUri(config)
}

describe('captcha-guarded auth requests', () => {
  it('login sends the captcha token in a header and not in the URL', async () => {
    await login({
      username: 'alice',
      password: 'secret',
      captcha: captchaToken,
    })

    expect(sent).toHaveLength(1)
    expect(sentUrl(sent[0])).toBe('/api/user/login')
    expect(sent[0].headers.get('X-Captcha-Token')).toBe(captchaToken)
  })

  it('starting the sign-up email check sends the captcha token only in a header', async () => {
    await startRegistrationEmail('alice@example.com', captchaToken)

    expect(sentUrl(sent[0])).toBe('/api/user/register/email/start')
    expect(sent[0].method).toBe('post')
    expect(sent[0].headers.get('X-Captcha-Token')).toBe(captchaToken)
    expect(JSON.parse(sent[0].data as string)).toEqual({
      email: 'alice@example.com',
    })
  })

  it('verifying the sign-up code sends the flow token and code without a captcha', async () => {
    await verifyRegistrationEmail('flow-1', '123456')

    expect(sentUrl(sent[0])).toBe('/api/user/register/email/verify')
    expect(sent[0].headers.has('X-Captcha-Token')).toBe(false)
    expect(JSON.parse(sent[0].data as string)).toEqual({
      flow_token: 'flow-1',
      code: '123456',
    })
  })

  it('register sends the registration token and no captcha', async () => {
    await register({
      username: 'alice',
      password: 'Correct-Horse-9',
      registration_token: 'flow-1',
      aff_code: 'INVITE',
    })

    expect(sentUrl(sent[0])).toBe('/api/user/register')
    expect(sent[0].headers.has('X-Captcha-Token')).toBe(false)
    expect(JSON.parse(sent[0].data as string)).toEqual({
      username: 'alice',
      password: 'Correct-Horse-9',
      registration_token: 'flow-1',
      aff_code: 'INVITE',
    })
  })

  it('asking for a password reset link posts the email as JSON and the captcha token only in a header', async () => {
    await sendPasswordResetEmail('alice@example.com', captchaToken)

    expect(sentUrl(sent[0])).toBe('/api/user/password-reset/start')
    expect(sent[0].method).toBe('post')
    expect(sent[0].headers.get('X-Captcha-Token')).toBe(captchaToken)
    expect(JSON.parse(sent[0].data as string)).toEqual({
      email: 'alice@example.com',
    })
  })

  it('without a captcha token, sends no captcha header', async () => {
    await sendPasswordResetEmail('alice@example.com')

    expect(sent[0].headers.has('X-Captcha-Token')).toBe(false)
  })
})
