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
  sendEmailVerification,
  sendPasswordResetEmail,
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

  it('register sends the captcha token in a header and keeps it out of the body', async () => {
    await register({
      username: 'alice',
      password: 'secret',
      captcha: captchaToken,
    })

    expect(sentUrl(sent[0])).toBe('/api/user/register')
    expect(sent[0].headers.get('X-Captcha-Token')).toBe(captchaToken)
    expect(JSON.parse(sent[0].data as string)).toEqual({
      username: 'alice',
      password: 'secret',
    })
  })

  it.each([
    ['email verification', sendEmailVerification, '/api/verification'],
    ['password reset', sendPasswordResetEmail, '/api/reset_password'],
  ])(
    '%s sends the captcha token in a header and only the email in the URL',
    async (_name, send, path) => {
      await send('alice@example.com', captchaToken)

      expect(sentUrl(sent[0])).toBe(`${path}?email=alice%40example.com`)
      expect(sent[0].headers.get('X-Captcha-Token')).toBe(captchaToken)
    }
  )

  it('without a captcha token, sends no captcha header', async () => {
    await sendPasswordResetEmail('alice@example.com')

    expect(sent[0].headers.has('X-Captcha-Token')).toBe(false)
  })
})
