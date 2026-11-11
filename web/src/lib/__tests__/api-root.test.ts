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

import { resolveApiRoot } from '../api-root'

const ORIGIN = 'https://www.meowapi.dev'

describe('server address fallback', () => {
  test('configured server address loses its whitespace and trailing slashes', () => {
    expect(
      resolveApiRoot({ server_address: ' https://api.example.com// ' }, ORIGIN)
    ).toBe('https://api.example.com')
  })

  test.each([undefined, '', '   ', 42])(
    'missing or invalid server address (%s) falls back to the current origin',
    (serverAddress) => {
      expect(resolveApiRoot({ server_address: serverAddress }, ORIGIN)).toBe(
        ORIGIN
      )
    }
  )

  test('missing status falls back to the current origin', () => {
    expect(resolveApiRoot(null, ORIGIN)).toBe(ORIGIN)
  })

  test('legacy camelCase and nested data shapes are still read', () => {
    expect(
      resolveApiRoot({ serverAddress: 'https://legacy.example.com' }, ORIGIN)
    ).toBe('https://legacy.example.com')
    expect(
      resolveApiRoot(
        { data: { server_address: 'https://nested.example.com' } },
        ORIGIN
      )
    ).toBe('https://nested.example.com')
  })
})

describe('API info entries', () => {
  test('the first entry wins over the server address', () => {
    const status = {
      server_address: 'https://www.meowapi.dev',
      api_info: [
        { url: 'https://api.meowapi.dev', route: 'Primary' },
        { url: 'https://backup.meowapi.dev', route: 'Backup' },
      ],
    }
    expect(resolveApiRoot(status, ORIGIN)).toBe('https://api.meowapi.dev')
  })

  test('entries nested under data are read', () => {
    const status = { data: { api_info: [{ url: 'https://api.meowapi.dev' }] } }
    expect(resolveApiRoot(status, ORIGIN)).toBe('https://api.meowapi.dev')
  })

  test.each([
    [' https://api.meowapi.dev/ ', 'https://api.meowapi.dev'],
    ['https://api.meowapi.dev/v1', 'https://api.meowapi.dev'],
    ['https://api.meowapi.dev/v1/', 'https://api.meowapi.dev'],
    ['https://api.meowapi.dev/v1beta', 'https://api.meowapi.dev'],
    ['https://api.meowapi.dev/v1/chat/completions', 'https://api.meowapi.dev'],
    ['https://api.meowapi.dev/v1/messages', 'https://api.meowapi.dev'],
    ['https://api.meowapi.dev/v1?region=cn#top', 'https://api.meowapi.dev'],
    ['https://gw.example.com/openai/v1', 'https://gw.example.com/openai'],
    ['https://gw.example.com/v1/openai', 'https://gw.example.com/v1/openai'],
    ['https://gw.example.com/api//v1', 'https://gw.example.com/api'],
  ])('URL %s is reduced to the API root %s', (url, expected) => {
    expect(resolveApiRoot({ api_info: [{ url }] }, ORIGIN)).toBe(expected)
  })

  test('entries without a parseable http(s) URL are skipped', () => {
    const status = {
      server_address: 'https://www.meowapi.dev',
      api_info: [
        { url: '' },
        { url: 'ftp://files.example.com' },
        { url: 'https://' },
        { route: 'no url' },
        null,
      ],
    }
    expect(resolveApiRoot(status, ORIGIN)).toBe('https://www.meowapi.dev')
  })

  test.each([[[]], ['https://api.meowapi.dev']])(
    'an empty or non-array value (%j) falls back to the server address',
    (apiInfo) => {
      const status = {
        server_address: 'https://www.meowapi.dev',
        api_info: apiInfo,
      }
      expect(resolveApiRoot(status, ORIGIN)).toBe('https://www.meowapi.dev')
    }
  )
})
