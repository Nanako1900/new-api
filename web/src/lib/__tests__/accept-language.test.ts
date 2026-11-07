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
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { api } from '../api'

const originalAdapter = api.defaults.adapter
let sent: InternalAxiosRequestConfig[] = []

async function sentLanguage(): Promise<unknown> {
  sent = []
  await api.post('/api/user/password-reset/start', {
    email: 'alice@example.com',
  })
  return sent[0].headers.get('Accept-Language')
}

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

afterEach(async () => {
  api.defaults.adapter = originalAdapter
  await i18next.changeLanguage('en')
})

describe('Accept-Language of API requests', () => {
  it.each([
    ['zhCN', 'zh-CN'],
    ['zhTW', 'zh-TW'],
    ['en', 'en'],
    ['fr', 'fr'],
    ['ru', 'ru'],
    ['ja', 'ja'],
    ['vi', 'vi'],
  ])('with the interface in %s, sends %s', async (language, expected) => {
    await i18next.changeLanguage(language)

    expect(await sentLanguage()).toBe(expected)
  })

  it('with an interface language that is not a locale, sends no header so the browser default applies', async () => {
    await i18next.changeLanguage('not_a_language')

    expect(await sentLanguage()).toBeUndefined()
  })

  it('after a language switch, the next request uses the new language', async () => {
    await i18next.changeLanguage('ja')
    expect(await sentLanguage()).toBe('ja')

    await i18next.changeLanguage('zhTW')

    expect(await sentLanguage()).toBe('zh-TW')
  })

  it('keeps an Accept-Language header the caller set explicitly', async () => {
    await i18next.changeLanguage('fr')

    await api.get('/api/status', {
      headers: { 'Accept-Language': 'ru' },
      disableDuplicate: true,
    })

    expect(sent[0].headers.get('Accept-Language')).toBe('ru')
  })
})
