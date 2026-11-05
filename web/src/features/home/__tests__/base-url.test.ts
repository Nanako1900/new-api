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
import { expect, test } from 'vitest'

import { resolveBaseUrl } from '../lib/base-url'

const ORIGIN = 'https://meowapi.dev'

test('configured server address with trailing slashes yields a single /v1 suffix', () => {
  expect(resolveBaseUrl(' https://api.example.com// ', ORIGIN)).toBe(
    'https://api.example.com/v1'
  )
})

test.each([undefined, '', '   ', 42])(
  'missing or invalid server address (%s) falls back to the current origin',
  (serverAddress) => {
    expect(resolveBaseUrl(serverAddress, ORIGIN)).toBe('https://meowapi.dev/v1')
  }
)
